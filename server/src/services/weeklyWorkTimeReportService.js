/**
 * weeklyWorkTimeReportService.js — "Work Time" operational analytics report.
 *
 * Produces a RAW-hours-focused work-time report for real human operators and
 * renders it as an inline-SVG HTML email; also powers the on-demand
 * view/generate/send actions on the Work Accountability Command Center.
 *
 * The report is structured as an operational analytics report:
 *   Executive Summary · Key Metrics (KPIs) · Monthly Trend · Weekly Breakdown
 *   (7-day) · Operator Breakdown · Repository Breakdown · OMD Work-Item Linkage
 *   · Notable Activity · Data Quality / Methodology.
 *
 * ── Raw emphasis ────────────────────────────────────────────────────────────
 *   This report centers on RAW hours = SUM(duration for status IN
 *   ('completed','active')); active sessions measured as (now − started_at),
 *   faithful to what Timer Analytics shows. Cancelled sessions are excluded.
 *   The 10h/session capping rule is preserved (CAP_PER_SESSION_SECONDS) but is
 *   no longer the headline — it is surfaced only as a data-quality note (how
 *   many sessions ran longer than the sanity cap).
 *
 * Data source: orthodoxmetrics_db.work_sessions (the human header timer). This
 * deliberately does NOT read omai_db.om_daily_work_sessions (agent sessions).
 * Period-level OMD work-item activity IS read from omai_db.om_daily_items
 * (created / completed / updated counts) when that cross-DB read is available.
 *
 * ── Real human operator filter ──────────────────────────────────────────────
 *   Included: active users whose role/email/name is not a known service, agent,
 *   or test account, AND who logged at least one session in the window.
 */

const { getAppPool } = require('../config/db');
const { resolveRepoTarget, getRepoMeta, formatDuration } = require('./workSessionConstants');
const { resolveWorkAccountabilityRange } = require('./workAccountabilityRange');

// ── Config ───────────────────────────────────────────────────────────────────

/** Default weekly recipient. Override with WORK_TIME_REPORT_RECIPIENT. */
const REPORT_RECIPIENT = process.env.WORK_TIME_REPORT_RECIPIENT || 'info@orthodoxmetrics.com';

/** Single-session sanity cap (seconds). 10h — used only for the methodology note. */
const CAP_PER_SESSION_SECONDS = 10 * 3600;

/** Default range preset when none is supplied. */
const DEFAULT_RANGE = '6m';

/** Roles that are never real human operators. */
const SERVICE_ROLES = new Set(['brain_ingest', 'agent']);

/** Explicit denylist of known service / agent / test accounts (documented). */
const SERVICE_ACCOUNT_EMAILS = new Set([
  'omsvc@orthodoxmetrics.com',
  'omsvc-cursor@orthodoxmetrics.com',
  'omsvc-windsurf@orthodoxmetrics.com',
  'brain-ingest@orthodoxmetrics.com',
  'nickeypain+super@gmail.com', // omsvc alias
  'records@orthodoxmetrics.com', // 'ws' windsurf service user
  'next1452@gmail.com', // Test / Test
  'nickeypain@gmail.com', // Nick Test
]);

// Brand palette.
const NAVY = '#1a2e52';
const GOLD = '#d4af37';
const PARCHMENT = '#fdfcf9';
const MUTED = '#6b7280';
const RAW_COLOR = '#1a2e52';
const RAW_SOFT = '#8fa4c8';
const ACCENT = '#0369a1';

// ── Date helpers ──────────────────────────────────────────────────────────────

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
}

/** Monday (YYYY-MM-DD) of the week containing dateStr (Mon–Sun week convention). */
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1=Mon..7=Sun
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function hoursFromSeconds(s) {
  return Math.round((Number(s) || 0) / 3600 * 10) / 10;
}

function monthKeyOf(dateStr) {
  return String(dateStr).slice(0, 7); // YYYY-MM
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function dayLabel(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function dayShort(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

function longWeekLabel(mondayStr) {
  const start = new Date(mondayStr + 'T12:00:00Z');
  const end = new Date(addDays(mondayStr, 6) + 'T12:00:00Z');
  const s = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const e = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${s} – ${e}`;
}

/** Enumerate YYYY-MM month keys spanning [fromDate, toDate] inclusive. */
function monthKeysBetween(fromDate, toDate) {
  const keys = [];
  let y = Number(fromDate.slice(0, 4));
  let m = Number(fromDate.slice(5, 7));
  const endY = Number(toDate.slice(0, 4));
  const endM = Number(toDate.slice(5, 7));
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard++ < 240) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return keys;
}

/** Most-recent COMPLETE Mon–Sun week at or before `reference` (YYYY-MM-DD). */
function priorCompleteWeek(reference) {
  const refStr = reference ? String(reference).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const thisMonday = mondayOf(refStr);
  const start = addDays(thisMonday, -7);
  const end = addDays(start, 6);
  return { start, end, label: longWeekLabel(start) };
}

function pctDelta(current, previous) {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ── Operator filter ────────────────────────────────────────────────────────────

function classifyAccount(user) {
  const email = (user.email || '').toLowerCase();
  const role = (user.role || '').toLowerCase();
  const first = (user.first_name || '').trim().toLowerCase();
  const last = (user.last_name || '').trim().toLowerCase();

  if (!user.is_active) return { human: false, reason: 'inactive account' };
  if (SERVICE_ROLES.has(role)) return { human: false, reason: `service role (${role})` };
  if (SERVICE_ACCOUNT_EMAILS.has(email)) return { human: false, reason: 'service/test account (denylist)' };
  if (email.startsWith('omsvc')) return { human: false, reason: 'omsvc service account' };
  if (email.includes('brain-ingest')) return { human: false, reason: 'brain-ingest service account' };
  if (email.includes('+super')) return { human: false, reason: 'omsvc alias' };
  if (first === 'test' && (last === 'test' || last === '')) return { human: false, reason: 'test account' };
  if (first === 'omsvc' || first === 'ws') return { human: false, reason: 'service account (name)' };
  return { human: true, reason: null };
}

function displayName(user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || (user.email ? user.email.split('@')[0] : `user ${user.id}`);
}

async function classifyOperators() {
  const pool = getAppPool();
  const [users] = await pool.query(
    'SELECT id, email, role, is_active, first_name, last_name FROM users'
  );
  const humans = [];
  const excluded = [];
  for (const u of users) {
    const c = classifyAccount(u);
    if (c.human) {
      humans.push({ id: u.id, email: u.email, role: u.role, name: displayName(u) });
    } else {
      excluded.push({ id: u.id, email: u.email, role: u.role, reason: c.reason });
    }
  }
  return { humans, excluded };
}

// ── OMD work-item activity (cross-DB, best-effort) ──────────────────────────────

/**
 * Read period-level OMD work-item activity from omai_db.om_daily_items. This is
 * ecosystem-wide (all agents + operators), NOT per human operator — the
 * work_sessions → om_daily_items link is not yet populated (see data quality).
 */
async function fetchOmdPeriodActivity(fromDate, toDate) {
  const result = {
    available: false,
    created: null,
    completed: null,
    updated: null,
    by_repo: {},
    reason: null,
  };
  try {
    const pool = getAppPool();
    const from = `${fromDate} 00:00:00`;
    const to = `${toDate} 23:59:59`;
    const [rows] = await pool.query(
      `SELECT
         SUM(created_at >= ? AND created_at <= ?)                              AS created,
         SUM(completed_at IS NOT NULL AND completed_at >= ? AND completed_at <= ?) AS completed,
         SUM(updated_at >= ? AND updated_at <= ?)                              AS updated
       FROM omai_db.om_daily_items
       WHERE archived_at IS NULL`,
      [from, to, from, to, from, to]
    );
    const [byRepo] = await pool.query(
      `SELECT repo_target,
              SUM(created_at >= ? AND created_at <= ?) AS created,
              SUM(completed_at IS NOT NULL AND completed_at >= ? AND completed_at <= ?) AS completed
       FROM omai_db.om_daily_items
       WHERE archived_at IS NULL
       GROUP BY repo_target`,
      [from, to, from, to]
    );
    result.available = true;
    result.created = Number(rows[0]?.created || 0);
    result.completed = Number(rows[0]?.completed || 0);
    result.updated = Number(rows[0]?.updated || 0);
    for (const r of byRepo) {
      const key = resolveRepoTarget(r.repo_target);
      const cur = result.by_repo[key] || { created: 0, completed: 0 };
      cur.created += Number(r.created || 0);
      cur.completed += Number(r.completed || 0);
      result.by_repo[key] = cur;
    }
  } catch (err) {
    result.available = false;
    result.reason = `omai_db.om_daily_items not readable (${err.code || err.message})`;
  }
  return result;
}

// ── Core computation ────────────────────────────────────────────────────────────

/**
 * Build the raw-focused work-time report.
 *
 * @param {object} opts
 * @param {string} [opts.range]     Canonical range preset (24h/7d/30d/3m/6m/12m/custom).
 * @param {string} [opts.from]      Custom window start (YYYY-MM-DD) when range=custom.
 * @param {string} [opts.to]        Custom window end (YYYY-MM-DD) when range=custom.
 * @param {number} [opts.weeks]     Legacy: trailing weeks (mapped to a rolling window).
 * @param {string} [opts.endDate]   Optional target-week selector (YYYY-MM-DD).
 * @param {string} [opts.weekStart] Optional explicit target-week Monday.
 */
async function buildWeeklyWorkTimeReport(opts = {}) {
  // Resolve the analytics window from the canonical range util so every chart
  // respects the selected period.
  let rangeInput;
  if (opts.from && opts.to) {
    rangeInput = { from: opts.from, to: opts.to };
  } else if (opts.range) {
    rangeInput = { range: opts.range };
  } else if (opts.weeks) {
    rangeInput = { hours: Math.max(1, Number(opts.weeks)) * 7 * 24 };
  } else {
    rangeInput = { range: DEFAULT_RANGE };
  }
  const resolved = resolveWorkAccountabilityRange(rangeInput);
  const windowFrom = resolved.from;
  const windowTo = resolved.to;

  // Selected week: the most-recent complete Mon–Sun week at or before the
  // window end (or an explicit override). WoW compares to the prior week.
  const weekRef = opts.weekStart || opts.endDate || windowTo;
  const targetWeek = opts.weekStart
    ? { start: mondayOf(opts.weekStart), end: addDays(mondayOf(opts.weekStart), 6), label: longWeekLabel(mondayOf(opts.weekStart)) }
    : priorCompleteWeek(weekRef);
  const priorWeek = { start: addDays(targetWeek.start, -7), end: addDays(targetWeek.start, -1) };

  const { humans, excluded } = await classifyOperators();
  const humanIds = humans.map((h) => h.id);

  const range = {
    preset: resolved.preset,
    mode: resolved.mode,
    label: resolved.label,
    from: windowFrom,
    to: windowTo,
    bucket: resolved.bucket,
    months: resolved.months || null,
  };

  const monthKeys = monthKeysBetween(windowFrom, windowTo);

  // Pull the widest window we need (analytics window ∪ prior-week) in one pass.
  const queryFrom = priorWeek.start < windowFrom ? priorWeek.start : windowFrom;
  const queryTo = windowTo;

  const omdActivity = await fetchOmdPeriodActivity(windowFrom, windowTo);

  if (humanIds.length === 0) {
    return emptyReport({ range, targetWeek, monthKeys, excluded, omdActivity });
  }

  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT user_id, started_at, ended_at, duration_seconds, status, repo_target, daily_item_id, om_daily_session_id
       FROM work_sessions
      WHERE user_id IN (?)
        AND status IN ('completed', 'active')
        AND started_at >= ? AND started_at <= ?
      ORDER BY started_at`,
    [humanIds, queryFrom + ' 00:00:00', queryTo + ' 23:59:59']
  );

  const now = Date.now();
  const humanById = new Map(humans.map((h) => [h.id, h]));

  // Accumulators for the analytics window.
  const monthMap = new Map();   // month -> { raw, days:Set, sessions, repos:Set }
  const repoMap = new Map();    // repo  -> { raw, sessions, days:Set, last }
  const opMap = new Map();      // user  -> { raw, days:Set, sessions, repos:Map, last }
  const targetDayMap = new Map(); // date -> { raw, sessions, repos:Map }
  const priorDayMap = new Map();
  let sessionsLinked = 0;
  let sessionsTotalInWindow = 0;
  let overCapSessions = 0;

  for (const s of rows) {
    const day = dateOnly(s.started_at);
    if (!day) continue;
    const stored = Number(s.duration_seconds) || 0;
    const isActive = s.status === 'active';
    const rawSeconds = isActive
      ? Math.max(0, Math.floor((now - new Date(s.started_at).getTime()) / 1000))
      : stored;
    const repo = resolveRepoTarget(s.repo_target);
    const inWindow = day >= windowFrom && day <= windowTo;

    // Target-week / prior-week daily breakdown (independent of analytics window).
    if (day >= targetWeek.start && day <= targetWeek.end) {
      const d = targetDayMap.get(day) || { raw: 0, sessions: 0, repos: new Map() };
      d.raw += rawSeconds; d.sessions += 1;
      d.repos.set(repo, (d.repos.get(repo) || 0) + rawSeconds);
      targetDayMap.set(day, d);
    }
    if (day >= priorWeek.start && day <= priorWeek.end) {
      const d = priorDayMap.get(day) || { raw: 0, sessions: 0 };
      d.raw += rawSeconds; d.sessions += 1;
      priorDayMap.set(day, d);
    }

    if (!inWindow) continue;
    sessionsTotalInWindow += 1;
    if (s.daily_item_id || s.om_daily_session_id) sessionsLinked += 1;
    if (!isActive && stored > CAP_PER_SESSION_SECONDS) overCapSessions += 1;

    // Monthly.
    const mk = monthKeyOf(day);
    const mo = monthMap.get(mk) || { raw: 0, days: new Set(), sessions: 0, repos: new Set() };
    mo.raw += rawSeconds; mo.sessions += 1; mo.days.add(day); mo.repos.add(repo);
    monthMap.set(mk, mo);

    // Repository.
    const rp = repoMap.get(repo) || { raw: 0, sessions: 0, days: new Set(), last: null };
    rp.raw += rawSeconds; rp.sessions += 1; rp.days.add(day);
    if (!rp.last || day > rp.last) rp.last = day;
    repoMap.set(repo, rp);

    // Operator.
    const op = opMap.get(s.user_id) || { raw: 0, days: new Set(), sessions: 0, repos: new Map(), last: null };
    op.raw += rawSeconds; op.sessions += 1; op.days.add(day);
    op.repos.set(repo, (op.repos.get(repo) || 0) + rawSeconds);
    if (!op.last || day > op.last) op.last = day;
    opMap.set(s.user_id, op);
  }

  // ── Monthly trend ────────────────────────────────────────────────────────────
  const rollingWindow = [];
  const monthlyTrend = monthKeys.map((mk, idx) => {
    const mo = monthMap.get(mk) || { raw: 0, days: new Set(), sessions: 0, repos: new Set() };
    const rawHours = hoursFromSeconds(mo.raw);
    const activeDays = mo.days.size;
    rollingWindow.push(rawHours);
    if (rollingWindow.length > 3) rollingWindow.shift();
    const prev = idx > 0 ? monthMap.get(monthKeys[idx - 1]) : null;
    const prevRaw = prev ? hoursFromSeconds(prev.raw) : null;
    return {
      month: mk,
      label: monthLabel(mk),
      raw_hours: rawHours,
      active_days: activeDays,
      avg_hours_per_active_day: activeDays > 0 ? Math.round(mo.raw / activeDays / 3600 * 10) / 10 : 0,
      sessions: mo.sessions,
      repos_touched: mo.repos.size,
      mom_delta_pct: idx > 0 ? pctDelta(rawHours, prevRaw) : null,
      rolling_3m_avg: rollingWindow.length === 3
        ? Math.round((rollingWindow.reduce((a, b) => a + b, 0) / 3) * 10) / 10
        : null,
    };
  });

  const monthsWithData = monthlyTrend.filter((m) => m.raw_hours > 0);
  const highestMonth = monthsWithData.reduce((a, b) => (!a || b.raw_hours > a.raw_hours ? b : a), null);
  const lowestMonth = monthsWithData.reduce((a, b) => (!a || b.raw_hours < a.raw_hours ? b : a), null);

  // ── Weekly (7-day) breakdown ─────────────────────────────────────────────────
  const weekDays = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(targetWeek.start, i);
    const d = targetDayMap.get(date);
    const topRepos = d
      ? Array.from(d.repos.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([repo, sec]) => ({ repo_target: repo, label: getRepoMeta(repo).label, color: getRepoMeta(repo).color, raw_hours: hoursFromSeconds(sec) }))
      : [];
    weekDays.push({
      date,
      label: dayLabel(date),
      dow: dayShort(date),
      raw_hours: d ? hoursFromSeconds(d.raw) : 0,
      sessions: d ? d.sessions : 0,
      top_repos: topRepos,
      active: !!(d && d.raw > 0),
    });
  }
  const weekTotalSeconds = Array.from(targetDayMap.values()).reduce((a, d) => a + d.raw, 0);
  const weekSessions = Array.from(targetDayMap.values()).reduce((a, d) => a + d.sessions, 0);
  const weekActiveDays = weekDays.filter((d) => d.active).length;
  const priorWeekSeconds = Array.from(priorDayMap.values()).reduce((a, d) => a + d.raw, 0);
  const weekTotalHours = hoursFromSeconds(weekTotalSeconds);
  const priorWeekHours = hoursFromSeconds(priorWeekSeconds);

  const weeklyBreakdown = {
    week: targetWeek,
    week_convention: 'Mon–Sun',
    days: weekDays,
    summary: {
      total_raw_hours: weekTotalHours,
      active_days: weekActiveDays,
      avg_raw_hours_per_active_day: weekActiveDays > 0 ? Math.round(weekTotalSeconds / weekActiveDays / 3600 * 10) / 10 : 0,
      sessions: weekSessions,
      prior_week_raw_hours: priorWeekHours,
      wow_delta_pct: pctDelta(weekTotalHours, priorWeekHours),
    },
  };

  // ── Repository breakdown ─────────────────────────────────────────────────────
  const repositories = Array.from(repoMap.entries())
    .map(([repo_target, v]) => ({
      repo_target,
      label: getRepoMeta(repo_target).label,
      color: getRepoMeta(repo_target).color,
      raw_hours: hoursFromSeconds(v.raw),
      sessions: v.sessions,
      active_days: v.days.size,
      last_activity: v.last,
      omd_items_in_period: omdActivity.available ? (omdActivity.by_repo[repo_target] || { created: 0, completed: 0 }) : null,
    }))
    .sort((a, b) => b.raw_hours - a.raw_hours);

  // ── Operator breakdown ───────────────────────────────────────────────────────
  const operators = Array.from(opMap.entries())
    .map(([user_id, v]) => {
      const h = humanById.get(user_id) || {};
      const topRepos = Array.from(v.repos.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([repo, sec]) => ({ repo_target: repo, label: getRepoMeta(repo).label, color: getRepoMeta(repo).color, raw_hours: hoursFromSeconds(sec) }));
      return {
        user_id,
        name: h.name || `user ${user_id}`,
        email: h.email || null,
        role: h.role || null,
        raw_hours: hoursFromSeconds(v.raw),
        active_days: v.days.size,
        avg_hours_per_active_day: v.days.size > 0 ? Math.round(v.raw / v.days.size / 3600 * 10) / 10 : 0,
        sessions: v.sessions,
        top_repos: topRepos,
        omd_item_count: null, // work_sessions.daily_item_id not populated (see data quality)
        last_activity: v.last,
      };
    })
    .filter((o) => o.raw_hours > 0)
    .sort((a, b) => b.raw_hours - a.raw_hours);

  // ── Aggregate monthly trend chart data (already all-operator combined) ────────
  // (monthlyTrend already aggregates every human operator.)

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const totalRawSeconds = Array.from(monthMap.values()).reduce((a, m) => a + m.raw, 0);
  const activeDaysAll = new Set();
  for (const op of opMap.values()) for (const d of op.days) activeDaysAll.add(d);
  const totalActiveDays = activeDaysAll.size;
  const totalRawHours = hoursFromSeconds(totalRawSeconds);
  const coverageRate = sessionsTotalInWindow > 0 && sessionsLinked > 0
    ? Math.round((sessionsLinked / sessionsTotalInWindow) * 1000) / 10
    : (sessionsTotalInWindow > 0 ? 0 : null);

  const kpis = {
    total_raw_hours: totalRawHours,
    active_days: totalActiveDays,
    avg_hours_per_active_day: totalActiveDays > 0 ? Math.round(totalRawSeconds / totalActiveDays / 3600 * 10) / 10 : 0,
    work_sessions: sessionsTotalInWindow,
    repositories_touched: repositories.length,
    operators: operators.length,
    omd_items_created: omdActivity.available ? omdActivity.created : null,
    omd_items_completed: omdActivity.available ? omdActivity.completed : null,
    omd_items_updated: omdActivity.available ? omdActivity.updated : null,
    omd_coverage_rate: {
      value: coverageRate,
      available: sessionsLinked > 0,
      reason: sessionsLinked > 0 ? null : 'work_sessions.daily_item_id is not populated — no session is linked to an OMD item yet',
    },
    unlinked_work_evidence: {
      value: sessionsTotalInWindow - sessionsLinked,
      available: sessionsTotalInWindow > 0,
      reason: sessionsLinked > 0 ? null : 'all sessions are unlinked (no OMD linkage recorded on work_sessions)',
    },
  };

  // ── OMD linkage analytics ────────────────────────────────────────────────────
  const omdLinkage = {
    session_link_available: sessionsLinked > 0,
    sessions_total: sessionsTotalInWindow,
    sessions_linked: sessionsLinked,
    sessions_unlinked: sessionsTotalInWindow - sessionsLinked,
    coverage_rate: coverageRate,
    period_items: omdActivity.available
      ? { created: omdActivity.created, completed: omdActivity.completed, updated: omdActivity.updated }
      : null,
    period_items_available: omdActivity.available,
    period_items_reason: omdActivity.reason,
    scope_note: 'Period OMD counts are ecosystem-wide (all agents + operators) from omai_db.om_daily_items; they are not attributed to individual operators because work_sessions carries no OMD link yet.',
    missing_fields: sessionsLinked > 0 ? [] : [
      'work_sessions.daily_item_id (populate on session start when a work item is active)',
      'work_sessions.om_daily_session_id (link the header timer to the governed OMD work session)',
    ],
  };

  // ── Deterministic insights & notable activity ────────────────────────────────
  const insights = buildInsights({ monthlyTrend, monthsWithData, weeklyBreakdown, repositories, operators, omdLinkage, kpis });
  const notable = buildNotable({ highestMonth, lowestMonth, weeklyBreakdown, repositories, operators });

  // ── Data quality / methodology ───────────────────────────────────────────────
  const dataQuality = {
    source: 'orthodoxmetrics_db.work_sessions (human header timer)',
    methodology: 'Raw hours = SUM(duration for completed + active sessions); active sessions measured as (now − started_at). Cancelled sessions excluded.',
    notes: [
      overCapSessions > 0
        ? `${overCapSessions} session(s) in this window ran longer than the ${CAP_PER_SESSION_SECONDS / 3600}h single-session sanity cap — raw totals may reflect left-running timers.`
        : `No session exceeded the ${CAP_PER_SESSION_SECONDS / 3600}h single-session sanity cap.`,
      'Agent sessions in omai_db.om_daily_work_sessions are deliberately excluded.',
      omdLinkage.session_link_available
        ? null
        : 'Per-operator / per-session OMD linkage is unavailable: work_sessions.daily_item_id and om_daily_session_id are not yet populated.',
      omdActivity.available ? null : `OMD period activity unavailable: ${omdActivity.reason}`,
    ].filter(Boolean),
    excluded_accounts: excluded,
  };

  const executiveSummary = buildExecutiveSummary({ range, kpis, monthlyTrend, weeklyBreakdown, operators, repositories });

  return {
    report_type: 'work_time',
    generated_at: new Date().toISOString(),
    recipient: REPORT_RECIPIENT,
    cap_per_session_hours: CAP_PER_SESSION_SECONDS / 3600,
    data_source: dataQuality.source,
    range,
    window: { start: windowFrom, end: windowTo },
    target_week: targetWeek,
    executive_summary: executiveSummary,
    kpis,
    monthly_trend: monthlyTrend,
    monthly_summary: {
      highest_month: highestMonth,
      lowest_month: lowestMonth,
      months_with_data: monthsWithData.length,
    },
    weekly_breakdown: weeklyBreakdown,
    operators,
    repositories,
    omd_linkage: omdLinkage,
    notable_activity: notable,
    insights,
    data_quality: dataQuality,
    excluded_accounts: excluded,
    // Back-compat convenience for any older caller.
    totals: {
      week: {
        raw_hours: weekTotalHours,
        days_worked: weekActiveDays,
        operators_count: operators.length,
      },
    },
  };
}

function emptyReport({ range, targetWeek, monthKeys, excluded, omdActivity }) {
  const monthlyTrend = monthKeys.map((mk) => ({
    month: mk, label: monthLabel(mk), raw_hours: 0, active_days: 0,
    avg_hours_per_active_day: 0, sessions: 0, repos_touched: 0, mom_delta_pct: null, rolling_3m_avg: null,
  }));
  const weekDays = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(targetWeek.start, i);
    weekDays.push({ date, label: dayLabel(date), dow: dayShort(date), raw_hours: 0, sessions: 0, top_repos: [], active: false });
  }
  return {
    report_type: 'work_time',
    generated_at: new Date().toISOString(),
    recipient: REPORT_RECIPIENT,
    cap_per_session_hours: CAP_PER_SESSION_SECONDS / 3600,
    data_source: 'orthodoxmetrics_db.work_sessions (human header timer)',
    range,
    window: { start: range.from, end: range.to },
    target_week: targetWeek,
    executive_summary: 'No human operator work time was logged for the selected range.',
    kpis: {
      total_raw_hours: 0, active_days: 0, avg_hours_per_active_day: 0, work_sessions: 0,
      repositories_touched: 0, operators: 0,
      omd_items_created: omdActivity.available ? omdActivity.created : null,
      omd_items_completed: omdActivity.available ? omdActivity.completed : null,
      omd_items_updated: omdActivity.available ? omdActivity.updated : null,
      omd_coverage_rate: { value: null, available: false, reason: 'no sessions in range' },
      unlinked_work_evidence: { value: 0, available: false, reason: 'no sessions in range' },
    },
    monthly_trend: monthlyTrend,
    monthly_summary: { highest_month: null, lowest_month: null, months_with_data: 0 },
    weekly_breakdown: {
      week: targetWeek, week_convention: 'Mon–Sun', days: weekDays,
      summary: { total_raw_hours: 0, active_days: 0, avg_raw_hours_per_active_day: 0, sessions: 0, prior_week_raw_hours: 0, wow_delta_pct: null },
    },
    operators: [],
    repositories: [],
    omd_linkage: {
      session_link_available: false, sessions_total: 0, sessions_linked: 0, sessions_unlinked: 0,
      coverage_rate: null,
      period_items: omdActivity.available ? { created: omdActivity.created, completed: omdActivity.completed, updated: omdActivity.updated } : null,
      period_items_available: omdActivity.available, period_items_reason: omdActivity.reason,
      scope_note: 'Period OMD counts are ecosystem-wide from omai_db.om_daily_items.',
      missing_fields: ['work_sessions.daily_item_id', 'work_sessions.om_daily_session_id'],
    },
    notable_activity: ['No human operator work time was logged for the selected range.'],
    insights: ['No human operator work time was logged for the selected range.'],
    data_quality: {
      source: 'orthodoxmetrics_db.work_sessions (human header timer)',
      methodology: 'Raw hours = SUM(duration for completed + active sessions).',
      notes: ['No sessions matched the selected range.'],
      excluded_accounts: excluded,
    },
    excluded_accounts: excluded,
    totals: { week: { raw_hours: 0, days_worked: 0, operators_count: 0 } },
  };
}

// ── Deterministic (rule-based) insight generation ──────────────────────────────

function buildInsights({ monthlyTrend, monthsWithData, weeklyBreakdown, repositories, operators, omdLinkage, kpis }) {
  const out = [];

  // Month-over-month raw trend (last two months with data).
  if (monthsWithData.length >= 2) {
    const last = monthsWithData[monthsWithData.length - 1];
    const prev = monthsWithData[monthsWithData.length - 2];
    const delta = pctDelta(last.raw_hours, prev.raw_hours);
    if (delta != null && Math.abs(delta) >= 1) {
      out.push(`Raw work time ${delta >= 0 ? 'increased' : 'decreased'} ${Math.abs(delta)}% in ${last.label} vs ${prev.label} (${prev.raw_hours}h → ${last.raw_hours}h).`);
    } else if (delta != null) {
      out.push(`Raw work time held roughly steady from ${prev.label} to ${last.label} (${last.raw_hours}h).`);
    }
  }

  // Week-over-week.
  const ws = weeklyBreakdown.summary;
  if (ws.wow_delta_pct != null && Math.abs(ws.wow_delta_pct) >= 1) {
    out.push(`Raw hours ${ws.wow_delta_pct >= 0 ? 'increased' : 'decreased'} ${Math.abs(ws.wow_delta_pct)}% for the week of ${weeklyBreakdown.week.label} vs the prior week (${ws.prior_week_raw_hours}h → ${ws.total_raw_hours}h).`);
  } else if (ws.total_raw_hours > 0 && ws.prior_week_raw_hours === 0) {
    out.push(`${ws.total_raw_hours}h of raw work was logged the week of ${weeklyBreakdown.week.label}; the prior week had none.`);
  }

  // Weekly concentration.
  if (ws.total_raw_hours > 0 && ws.active_days > 0) {
    const days = [...weeklyBreakdown.days].filter((d) => d.raw_hours > 0).sort((a, b) => b.raw_hours - a.raw_hours);
    const half = Math.max(1, Math.ceil(ws.active_days / 2));
    const topShare = days.slice(0, half).reduce((a, d) => a + d.raw_hours, 0);
    const pct = Math.round((topShare / ws.total_raw_hours) * 100);
    out.push(`${half} active day${half > 1 ? 's' : ''} accounted for ${pct}% of the selected week's ${ws.total_raw_hours}h.`);
  }

  // Repo concentration.
  const reposWithHours = repositories.filter((r) => r.raw_hours > 0);
  if (reposWithHours.length > 0) {
    const total = reposWithHours.reduce((a, r) => a + r.raw_hours, 0);
    if (reposWithHours.length === 1) {
      out.push(`All raw work in the range was attributed to a single repository (${reposWithHours[0].label}).`);
    } else {
      const top = reposWithHours[0];
      const share = Math.round((top.raw_hours / total) * 100);
      out.push(`Work spanned ${reposWithHours.length} repositories; ${top.label} led with ${share}% of raw hours.`);
    }
  }

  // Operators.
  if (operators.length === 1) {
    out.push(`A single operator (${operators[0].name}) logged all ${kpis.total_raw_hours}h of raw work in the range.`);
  } else if (operators.length > 1) {
    out.push(`${operators.length} operators logged raw work in the range; ${operators[0].name} led with ${operators[0].raw_hours}h.`);
  }

  // OMD linkage.
  if (!omdLinkage.session_link_available) {
    out.push('No OMD-linked work sessions were found for this activity range (session→work-item linkage is not yet recorded).');
  }
  if (omdLinkage.period_items_available && omdLinkage.period_items) {
    out.push(`Across the ecosystem this period: ${omdLinkage.period_items.created} OMD item(s) created, ${omdLinkage.period_items.completed} completed.`);
  }

  return out.length ? out : ['No notable patterns detected for the selected range.'];
}

function buildNotable({ highestMonth, lowestMonth, weeklyBreakdown, repositories, operators }) {
  const out = [];
  if (highestMonth) out.push(`Highest-volume month: ${highestMonth.label} (${highestMonth.raw_hours}h across ${highestMonth.active_days} active day${highestMonth.active_days === 1 ? '' : 's'}).`);
  if (lowestMonth && lowestMonth.month !== (highestMonth && highestMonth.month)) {
    out.push(`Lowest-volume month with activity: ${lowestMonth.label} (${lowestMonth.raw_hours}h).`);
  }
  const busiestDay = [...weeklyBreakdown.days].sort((a, b) => b.raw_hours - a.raw_hours)[0];
  if (busiestDay && busiestDay.raw_hours > 0) {
    out.push(`Busiest day in the selected week: ${busiestDay.label} (${busiestDay.raw_hours}h).`);
  }
  if (repositories[0] && repositories[0].raw_hours > 0) {
    out.push(`Top repository over the range: ${repositories[0].label} (${repositories[0].raw_hours}h, ${repositories[0].sessions} session${repositories[0].sessions === 1 ? '' : 's'}).`);
  }
  if (operators[0]) {
    out.push(`Most active operator: ${operators[0].name} (${operators[0].raw_hours}h over ${operators[0].active_days} active day${operators[0].active_days === 1 ? '' : 's'}).`);
  }
  return out.length ? out : ['No notable activity for the selected range.'];
}

function buildExecutiveSummary({ range, kpis, monthlyTrend, weeklyBreakdown, operators, repositories }) {
  if (kpis.work_sessions === 0) return `No human operator work time was logged for ${range.label}.`;
  const parts = [];
  parts.push(`Operators logged ${kpis.total_raw_hours}h of raw work time across ${kpis.active_days} active day(s) and ${kpis.work_sessions} session(s) over ${range.label}.`);
  const monthsWithData = monthlyTrend.filter((m) => m.raw_hours > 0);
  if (monthsWithData.length >= 2) {
    const last = monthsWithData[monthsWithData.length - 1];
    const prev = monthsWithData[monthsWithData.length - 2];
    const delta = pctDelta(last.raw_hours, prev.raw_hours);
    if (delta != null) parts.push(`Month-over-month, raw hours ${delta >= 0 ? 'rose' : 'fell'} ${Math.abs(delta)}% into ${last.label}.`);
  }
  const ws = weeklyBreakdown.summary;
  if (ws.total_raw_hours > 0) {
    parts.push(`The most recent complete week (${weeklyBreakdown.week.label}) saw ${ws.total_raw_hours}h over ${ws.active_days} active day(s).`);
  }
  if (repositories.filter((r) => r.raw_hours > 0).length > 0) {
    parts.push(`Work concentrated on ${repositories.filter((r) => r.raw_hours > 0).length} repository/repositories, led by ${repositories[0].label}.`);
  }
  return parts.join(' ');
}

// ── Email rendering (inline SVG, email-safe) ──────────────────────────────────

function svgBarChart(items, opts = {}) {
  const { width = 560, height = 200, valueKey = 'raw_hours', labelKey = 'label', color = RAW_COLOR, unit = 'h' } = opts;
  if (!items.length) return '<p style="color:#888;">No data for this window.</p>';
  const padL = 40; const padR = 12; const padT = 16; const padB = 34;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const maxVal = Math.max(...items.map((i) => Number(i[valueKey]) || 0), 1);
  const gap = 8;
  const barW = Math.max(6, (chartW - gap * (items.length - 1)) / items.length);

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
    const y = padT + chartH * (1 - pct);
    const val = Math.round(maxVal * pct);
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>
            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="${MUTED}">${val}${unit}</text>`;
  }).join('');

  let bars = '';
  items.forEach((item, idx) => {
    const val = Number(item[valueKey]) || 0;
    const h = (val / maxVal) * chartH;
    const x = padL + idx * (barW + gap);
    const barColor = item.active === false ? '#e5e7eb' : color;
    bars += `<rect x="${x}" y="${padT + chartH - h}" width="${barW}" height="${Math.max(0, h)}" rx="2" fill="${barColor}"/>`;
    if (val > 0) {
      bars += `<text x="${x + barW / 2}" y="${padT + chartH - h - 3}" text-anchor="middle" font-size="8" fill="${MUTED}">${val}</text>`;
    }
    const showLabel = items.length <= 14 || idx % 2 === 0 || idx === items.length - 1;
    if (showLabel) {
      bars += `<text x="${x + barW / 2}" y="${height - 10}" text-anchor="middle" font-size="9" fill="${MUTED}">${item[labelKey]}</text>`;
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
    ${gridLines}
    ${bars}
    <line x1="${padL}" y1="${padT + chartH}" x2="${width - padR}" y2="${padT + chartH}" stroke="${GOLD}" stroke-width="2"/>
  </svg>`;
}

function kpiCardHtml(value, label, note) {
  return `<td width="25%" style="padding:6px;">
    <div style="background:${PARCHMENT};border:1px solid rgba(212,175,55,0.25);border-radius:8px;padding:14px;text-align:center;">
      <div style="font-size:22px;font-weight:700;color:${NAVY};line-height:1.1;">${value}</div>
      <div style="font-size:10px;color:${MUTED};text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">${label}</div>
      ${note ? `<div style="font-size:9px;color:${MUTED};margin-top:2px;">${note}</div>` : ''}
    </div>
  </td>`;
}

function sectionHeading(title, subtitle) {
  return `<h2 style="margin:0 0 4px;font-size:17px;color:${NAVY};">${title}</h2>
    <div style="height:3px;width:44px;background:${GOLD};margin-bottom:8px;border-radius:2px;"></div>
    ${subtitle ? `<p style="margin:0 0 12px;font-size:12px;color:${MUTED};">${subtitle}</p>` : ''}`;
}

function fmtHours(h) { return `${h}h`; }
function fmtDelta(pct) {
  if (pct == null) return '—';
  const arrow = pct >= 0 ? '▲' : '▼';
  return `${arrow} ${Math.abs(pct)}%`;
}

function renderReportHtml(report) {
  const {
    range, kpis, monthly_trend, monthly_summary, weekly_breakdown, operators,
    repositories, omd_linkage, notable_activity, insights, data_quality, excluded_accounts,
  } = report;
  const generatedAt = new Date(report.generated_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

  const kpiCards1 = `<table width="100%" cellpadding="0" cellspacing="0"><tr>
    ${kpiCardHtml(fmtHours(kpis.total_raw_hours), 'Total Raw Hours')}
    ${kpiCardHtml(kpis.active_days, 'Active Days')}
    ${kpiCardHtml(fmtHours(kpis.avg_hours_per_active_day), 'Avg / Active Day')}
    ${kpiCardHtml(kpis.work_sessions, 'Work Sessions')}
  </tr></table>`;
  const kpiCards2 = `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr>
    ${kpiCardHtml(kpis.repositories_touched, 'Repositories')}
    ${kpiCardHtml(kpis.omd_items_created == null ? 'n/a' : kpis.omd_items_created, 'OMD Items Created', 'ecosystem-wide')}
    ${kpiCardHtml(kpis.omd_items_completed == null ? 'n/a' : kpis.omd_items_completed, 'OMD Items Completed', 'ecosystem-wide')}
    ${kpiCardHtml(kpis.omd_coverage_rate.available ? `${kpis.omd_coverage_rate.value}%` : 'n/a', 'OMD Coverage', kpis.omd_coverage_rate.available ? 'sessions linked' : 'not tracked yet')}
  </tr></table>`;

  const monthRows = monthly_trend.map((m) => `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;">${m.label}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;font-weight:700;color:${NAVY};">${m.raw_hours}h</td>
    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;">${m.active_days}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;">${m.avg_hours_per_active_day}h</td>
    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;">${m.sessions}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:12px;text-align:right;color:${m.mom_delta_pct == null ? MUTED : (m.mom_delta_pct >= 0 ? '#047857' : '#b91c1c')};">${fmtDelta(m.mom_delta_pct)}</td>
  </tr>`).join('');

  const weekDayRows = weekly_breakdown.days.map((d) => `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;">${d.dow} <span style="color:${MUTED};font-size:11px;">${d.date.slice(5)}</span></td>
    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;font-weight:${d.active ? 700 : 400};color:${d.active ? NAVY : MUTED};">${d.raw_hours}h</td>
    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;">${d.sessions}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:12px;color:${MUTED};">${d.top_repos.map((r) => `${r.label} ${r.raw_hours}h`).join(', ') || '—'}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:12px;text-align:center;">${d.active ? `<span style="color:#047857;">●</span>` : `<span style="color:#d1d5db;">○</span>`}</td>
  </tr>`).join('');

  const operatorRows = operators.length
    ? operators.map((op) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;"><strong>${op.name}</strong><br/><span style="font-size:11px;color:${MUTED};">${op.role || ''}</span></td>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;font-weight:700;color:${NAVY};">${op.raw_hours}h</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;">${op.active_days}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;">${op.avg_hours_per_active_day}h</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;">${op.sessions}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:12px;color:${MUTED};">${op.top_repos.map((r) => r.label).join(', ') || '—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:12px;text-align:right;color:${MUTED};">${op.last_activity || '—'}</td>
      </tr>`).join('')
    : `<tr><td colspan="7" style="padding:16px;text-align:center;color:${MUTED};font-size:14px;">No human operator work logged for this range.</td></tr>`;

  const repoRows = repositories.length
    ? repositories.map((r) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${r.color};margin-right:6px;"></span>${r.label}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;font-weight:700;color:${NAVY};">${r.raw_hours}h</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;">${r.sessions}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;">${r.active_days}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:12px;text-align:right;color:${MUTED};">${r.last_activity || '—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-size:12px;text-align:center;color:${MUTED};">${r.omd_items_in_period ? `${r.omd_items_in_period.created}c / ${r.omd_items_in_period.completed}d` : 'n/a'}</td>
      </tr>`).join('')
    : `<tr><td colspan="6" style="padding:16px;text-align:center;color:${MUTED};font-size:14px;">No repository activity for this range.</td></tr>`;

  const insightList = insights.map((i) => `<li style="margin:0 0 6px;">${i}</li>`).join('');
  const notableList = notable_activity.map((i) => `<li style="margin:0 0 6px;">${i}</li>`).join('');
  const excludedList = (excluded_accounts || []).map((e) => `${e.email} <span style="color:${MUTED};">(${e.reason})</span>`).join(' · ');
  const dqNotes = (data_quality.notes || []).map((n) => `<li style="margin:0 0 6px;">${n}</li>`).join('');

  const omdSection = omd_linkage.session_link_available
    ? `<p style="margin:0 0 8px;font-size:13px;color:${NAVY};">Session→OMD coverage: <strong>${omd_linkage.coverage_rate}%</strong> (${omd_linkage.sessions_linked}/${omd_linkage.sessions_total} sessions linked).</p>`
    : `<p style="margin:0 0 8px;font-size:13px;color:${MUTED};">No work sessions are linked to OMD work items yet. Needed fields: <code>${omd_linkage.missing_fields.join('</code>, <code>')}</code>.</p>`;
  const omdPeriod = omd_linkage.period_items_available && omd_linkage.period_items
    ? `<p style="margin:0;font-size:13px;color:${NAVY};">Ecosystem OMD activity this period: <strong>${omd_linkage.period_items.created}</strong> created · <strong>${omd_linkage.period_items.completed}</strong> completed · <strong>${omd_linkage.period_items.updated}</strong> updated. <span style="color:${MUTED};font-size:11px;">(not attributed per-operator)</span></p>`
    : `<p style="margin:0;font-size:12px;color:${MUTED};">Ecosystem OMD activity unavailable: ${omd_linkage.period_items_reason || 'source not readable'}.</p>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Work Time Report</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${NAVY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(26,46,82,0.1);">
        <tr><td style="height:6px;background:linear-gradient(90deg,${NAVY},${GOLD},${NAVY});"></td></tr>
        <tr><td style="background:${PARCHMENT};padding:26px 32px 18px;text-align:center;border-bottom:1px solid rgba(26,46,82,0.08);">
          <div style="font-size:12px;letter-spacing:0.14em;font-weight:600;color:${GOLD};">ORTHODOX METRICS · WORK ACCOUNTABILITY</div>
          <h1 style="margin:8px 0 4px;font-size:26px;font-weight:700;color:${NAVY};">Work Time Report</h1>
          <p style="margin:0;font-size:14px;color:${MUTED};">${range.label} · ${range.from} → ${range.to} · Raw hours</p>
        </td></tr>

        <tr><td style="padding:22px 32px 8px;">
          ${sectionHeading('Executive Summary')}
          <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:${NAVY};">${report.executive_summary}</p>
        </td></tr>

        <tr><td style="padding:8px 26px 8px;">
          ${kpiCards1}
          ${kpiCards2}
        </td></tr>

        <tr><td style="padding:16px 32px 8px;">
          ${sectionHeading('Monthly Trend', `Raw hours per calendar month across ${range.label}.`)}
          ${svgBarChart(monthly_trend, { valueKey: 'raw_hours', labelKey: 'label', color: RAW_COLOR })}
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px;">
            <thead><tr style="background:#f9fafb;">
              <th style="text-align:left;padding:6px 10px;font-size:11px;color:${MUTED};">Month</th>
              <th style="text-align:right;padding:6px 10px;font-size:11px;color:${MUTED};">Raw Hours</th>
              <th style="text-align:center;padding:6px 10px;font-size:11px;color:${MUTED};">Active Days</th>
              <th style="text-align:right;padding:6px 10px;font-size:11px;color:${MUTED};">Avg/Day</th>
              <th style="text-align:center;padding:6px 10px;font-size:11px;color:${MUTED};">Sessions</th>
              <th style="text-align:right;padding:6px 10px;font-size:11px;color:${MUTED};">MoM</th>
            </tr></thead>
            <tbody>${monthRows}</tbody>
          </table>
        </td></tr>

        <tr><td style="padding:16px 32px 8px;">
          ${sectionHeading(`Weekly Breakdown — ${weekly_breakdown.week.label}`, `7-day view (${weekly_breakdown.week_convention}). Week total ${weekly_breakdown.summary.total_raw_hours}h · ${weekly_breakdown.summary.active_days} active day(s) · WoW ${fmtDelta(weekly_breakdown.summary.wow_delta_pct)}.`)}
          ${svgBarChart(weekly_breakdown.days, { valueKey: 'raw_hours', labelKey: 'dow', color: ACCENT, height: 180 })}
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px;">
            <thead><tr style="background:#f9fafb;">
              <th style="text-align:left;padding:6px 10px;font-size:11px;color:${MUTED};">Day</th>
              <th style="text-align:right;padding:6px 10px;font-size:11px;color:${MUTED};">Raw</th>
              <th style="text-align:center;padding:6px 10px;font-size:11px;color:${MUTED};">Sessions</th>
              <th style="text-align:left;padding:6px 10px;font-size:11px;color:${MUTED};">Top Repos</th>
              <th style="text-align:center;padding:6px 10px;font-size:11px;color:${MUTED};">Active</th>
            </tr></thead>
            <tbody>${weekDayRows}</tbody>
          </table>
        </td></tr>

        <tr><td style="padding:16px 32px 8px;">
          ${sectionHeading('Operator Breakdown', `Real human operators over ${range.label}.`)}
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <thead><tr style="background:#f9fafb;">
              <th style="text-align:left;padding:6px 10px;font-size:11px;color:${MUTED};">Operator</th>
              <th style="text-align:right;padding:6px 10px;font-size:11px;color:${MUTED};">Raw</th>
              <th style="text-align:center;padding:6px 10px;font-size:11px;color:${MUTED};">Days</th>
              <th style="text-align:right;padding:6px 10px;font-size:11px;color:${MUTED};">Avg/Day</th>
              <th style="text-align:center;padding:6px 10px;font-size:11px;color:${MUTED};">Sessions</th>
              <th style="text-align:left;padding:6px 10px;font-size:11px;color:${MUTED};">Top Repos</th>
              <th style="text-align:right;padding:6px 10px;font-size:11px;color:${MUTED};">Last Activity</th>
            </tr></thead>
            <tbody>${operatorRows}</tbody>
          </table>
        </td></tr>

        <tr><td style="padding:16px 32px 8px;">
          ${sectionHeading('Repository Breakdown', `Raw hours by repository over ${range.label}.`)}
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <thead><tr style="background:#f9fafb;">
              <th style="text-align:left;padding:6px 10px;font-size:11px;color:${MUTED};">Repository</th>
              <th style="text-align:right;padding:6px 10px;font-size:11px;color:${MUTED};">Raw</th>
              <th style="text-align:center;padding:6px 10px;font-size:11px;color:${MUTED};">Sessions</th>
              <th style="text-align:center;padding:6px 10px;font-size:11px;color:${MUTED};">Active Days</th>
              <th style="text-align:right;padding:6px 10px;font-size:11px;color:${MUTED};">Last Activity</th>
              <th style="text-align:center;padding:6px 10px;font-size:11px;color:${MUTED};">OMD (c/d)</th>
            </tr></thead>
            <tbody>${repoRows}</tbody>
          </table>
        </td></tr>

        <tr><td style="padding:16px 32px 8px;">
          ${sectionHeading('Work Item Linkage / OMD Coverage')}
          ${omdSection}
          ${omdPeriod}
        </td></tr>

        <tr><td style="padding:16px 32px 8px;">
          ${sectionHeading('Insights')}
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:${NAVY};">${insightList}</ul>
        </td></tr>

        <tr><td style="padding:8px 32px 8px;">
          ${sectionHeading('Notable Activity')}
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:${NAVY};">${notableList}</ul>
        </td></tr>

        <tr><td style="padding:16px 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:${PARCHMENT};border-radius:8px;border:1px solid rgba(212,175,55,0.2);">
            <tr><td style="padding:16px 20px;font-size:12px;line-height:1.7;color:${NAVY};">
              <p style="margin:0 0 6px;"><strong>Data Quality / Methodology.</strong> Source: <code>${data_quality.source}</code>. ${data_quality.methodology}</p>
              <ul style="margin:0 0 6px;padding-left:18px;color:${MUTED};">${dqNotes}</ul>
              ${excludedList ? `<p style="margin:0;font-size:11px;color:${MUTED};"><strong>Excluded accounts:</strong> ${excludedList}</p>` : ''}
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="background:${PARCHMENT};padding:18px 32px;border-top:1px solid rgba(26,46,82,0.08);text-align:center;">
          <p style="margin:0 0 4px;font-size:13px;color:${NAVY};font-weight:600;">Orthodox Metrics — Work Accountability</p>
          <p style="margin:0;font-size:11px;color:${MUTED};">Generated ${generatedAt}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Delivery ──────────────────────────────────────────────────────────────────

async function sendEmail(html, { recipient, range }) {
  const nodemailer = require('nodemailer');
  const { getActiveEmailConfig } = require('../api/settings');

  const dbConfig = await getActiveEmailConfig();
  const senderName = (dbConfig && dbConfig.sender_name) || 'Orthodox Metrics';
  const senderEmail = (dbConfig && dbConfig.sender_email) || process.env.SMTP_USER || 'info@orthodoxmetrics.com';

  const transportOpts = {
    host: (dbConfig && dbConfig.smtp_host) || process.env.SMTP_HOST || '127.0.0.1',
    port: (dbConfig && dbConfig.smtp_port) || parseInt(process.env.SMTP_PORT || '25', 10),
    secure: !!((dbConfig && dbConfig.smtp_secure) ?? (process.env.SMTP_SECURE === 'true')),
  };
  if (dbConfig && dbConfig.smtp_user && dbConfig.smtp_pass) {
    transportOpts.auth = { user: dbConfig.smtp_user, pass: dbConfig.smtp_pass };
  }

  const transporter = nodemailer.createTransport(transportOpts);
  const subject = `Work Time Report — ${range.label}`;
  const info = await transporter.sendMail({
    from: `"${senderName}" <${senderEmail}>`,
    to: recipient,
    subject,
    html,
    text: `Work Time report for ${range.label} (${range.from} → ${range.to}). Open the HTML version for KPIs, monthly trend, the 7-day weekly breakdown, and operator/repository/OMD sections.`,
  });
  return { messageId: info.messageId, subject, from: senderEmail, to: recipient };
}

/**
 * Generate and (optionally) send the work-time report.
 */
async function generateAndSendWeeklyWorkTimeReport(opts = {}) {
  const report = await buildWeeklyWorkTimeReport(opts);
  const html = renderReportHtml(report);
  const recipient = opts.recipient || REPORT_RECIPIENT;

  let delivery = null;
  if (!opts.dryRun) {
    delivery = await sendEmail(html, { recipient, range: report.range });
  }
  return { report, html, sent: !opts.dryRun, delivery };
}

/**
 * Cron entry — send the report for the default range (last complete week context
 * within the default multi-month window).
 */
async function processWeeklyWorkTimeReport() {
  try {
    const { report, delivery } = await generateAndSendWeeklyWorkTimeReport({ range: DEFAULT_RANGE });
    console.log(
      `[WorkTime] Sent report for ${report.range.label} to ${report.recipient} `
      + `(${report.operators.length} operators, ${report.kpis.total_raw_hours}h raw). `
      + `messageId=${delivery && delivery.messageId}`
    );
  } catch (err) {
    console.error('[WorkTime] Failed to process work-time report:', err.message);
  }
}

module.exports = {
  REPORT_RECIPIENT,
  CAP_PER_SESSION_SECONDS,
  DEFAULT_RANGE,
  buildWeeklyWorkTimeReport,
  renderReportHtml,
  generateAndSendWeeklyWorkTimeReport,
  processWeeklyWorkTimeReport,
  classifyOperators,
};
