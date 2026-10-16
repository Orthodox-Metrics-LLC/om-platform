/**
 * Work session analytics — combines global timer + OM Daily item sessions,
 * grouped by repo and day for weekly/monthly accountability reports.
 */

const { getAppPool, getOmaiPool } = require('../config/db');
const { OM_REPOS, getRepoMeta, resolveRepoTarget, formatDuration } = require('./workSessionConstants');

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
}

function eachDayInRange(from, to) {
  const days = [];
  const cur = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function emptyRepoMap() {
  const map = {};
  for (const key of Object.keys(OM_REPOS)) {
    map[key] = { total_seconds: 0, session_count: 0 };
  }
  return map;
}

function addToRepo(map, repoTarget, seconds) {
  const key = resolveRepoTarget(repoTarget);
  map[key].total_seconds += seconds;
  map[key].session_count += 1;
}

async function fetchGlobalSessions(userId, from, to) {
  const pool = getAppPool();
  try {
    const [rows] = await pool.query(
      `SELECT id, started_at, ended_at, duration_seconds, status, repo_target,
              daily_item_id, work_focus, summary_note, om_daily_session_id, source_system,
              start_context
       FROM work_sessions
       WHERE user_id = ? AND status IN ('completed', 'active', 'cancelled')
         AND started_at >= ? AND started_at <= ?
       ORDER BY started_at`,
      [userId, from, to + ' 23:59:59']
    );
    return rows;
  } catch (err) {
    if (err.message?.includes('repo_target')) return [];
    throw err;
  }
}

async function fetchDailyItemSessions(userId, from, to) {
  let pool;
  try {
    pool = getOmaiPool();
  } catch {
    return [];
  }

  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.item_id, s.started_at, s.stopped_at, s.duration_seconds, s.status,
              s.repo_target, s.github_branch, s.session_note, s.stop_summary, s.agent_tool,
              i.title AS item_title, i.status AS item_status
       FROM om_daily_work_sessions s
       JOIN om_daily_items i ON i.id = s.item_id
       WHERE (s.started_by = ? OR i.assigned_to = ? OR i.created_by = ?)
         AND s.started_at >= ? AND s.started_at <= ?
       ORDER BY s.started_at`,
      [userId, userId, userId, from, to + ' 23:59:59']
    );
    return rows;
  } catch (err) {
    console.warn('[WorkAnalytics] om_daily_work_sessions query failed:', err.message);
    return [];
  }
}

async function fetchCompletedItems(userId, from, to) {
  let pool;
  try {
    pool = getOmaiPool();
  } catch {
    return [];
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, title, repo_target, status, completed_at, github_branch, category, priority, source
       FROM om_daily_items
       WHERE status IN ('done', 'approved')
         AND completed_at IS NOT NULL
         AND completed_at >= ? AND completed_at <= ?
         AND (
           assigned_to = ? OR created_by = ? OR source IN ('historical_backfill', 'system', 'agent')
         )
       ORDER BY completed_at DESC`,
      [from, to + ' 23:59:59', userId, userId]
    );
    return rows;
  } catch (err) {
    console.warn('[WorkAnalytics] completed items query failed:', err.message);
    return [];
  }
}

/**
 * Build unified analytics for a date range.
 */
async function buildWorkAnalytics(userId, periodStart, periodEnd) {
  const from = dateOnly(periodStart);
  const to = dateOnly(periodEnd);

  const [globalSessions, itemSessions, completedItems] = await Promise.all([
    fetchGlobalSessions(userId, from, to),
    fetchDailyItemSessions(userId, from, to),
    fetchCompletedItems(userId, from, to),
  ]);

  const linkedDailySessionIds = new Set(
    globalSessions
      .filter(s => s.om_daily_session_id)
      .map(s => Number(s.om_daily_session_id))
  );

  const byRepo = emptyRepoMap();
  const byDayMap = new Map();
  const sessionDetails = [];
  let totalSeconds = 0;
  let untaggedCount = 0;

  const ensureDay = (day) => {
    if (!byDayMap.has(day)) {
      byDayMap.set(day, {
        date: day,
        total_seconds: 0,
        session_count: 0,
        repos: emptyRepoMap(),
        sessions: [],
        items_worked: [],
      });
    }
    return byDayMap.get(day);
  };

  for (const s of globalSessions) {
    if (s.status === 'cancelled') continue;
    let seconds = Number(s.duration_seconds) || 0;
    if (s.status === 'active') {
      seconds = Math.max(0, Math.floor((Date.now() - new Date(s.started_at).getTime()) / 1000));
    }
    const repo = resolveRepoTarget(s.repo_target);
    if (!s.repo_target) untaggedCount += 1;

    let ctx = s.start_context;
    if (typeof ctx === 'string') {
      try { ctx = JSON.parse(ctx); } catch { ctx = null; }
    }

    totalSeconds += seconds;
    addToRepo(byRepo, repo, seconds);

    const day = dateOnly(s.started_at);
    const dayRow = ensureDay(day);
    dayRow.total_seconds += seconds;
    dayRow.session_count += 1;
    addToRepo(dayRow.repos, repo, seconds);

    const detail = {
      id: `global-${s.id}`,
      type: 'global',
      started_at: s.started_at,
      ended_at: s.ended_at,
      duration_seconds: seconds,
      repo_target: repo,
      daily_item_id: s.daily_item_id,
      work_focus: s.work_focus || ctx?.daily_item_title,
      summary_note: s.summary_note,
      source_system: s.source_system,
      github_branch: ctx?.github_branch || null,
      change_set_code: ctx?.change_set_code || null,
      commits_count: ctx?.commits_during_session?.length || 0,
      backfill_sources: ctx?.backfill?.sources || [],
    };
    dayRow.sessions.push(detail);
    sessionDetails.push(detail);
  }

  for (const s of itemSessions) {
    if (linkedDailySessionIds.has(Number(s.id))) continue;
    if (s.status === 'abandoned') continue;

    let seconds = Number(s.duration_seconds) || 0;
    if (s.status === 'active') {
      seconds = Math.max(0, Math.floor((Date.now() - new Date(s.started_at).getTime()) / 1000));
    }
    const repo = resolveRepoTarget(s.repo_target);
    totalSeconds += seconds;
    addToRepo(byRepo, repo, seconds);

    const day = dateOnly(s.started_at);
    const dayRow = ensureDay(day);
    dayRow.total_seconds += seconds;
    dayRow.session_count += 1;
    addToRepo(dayRow.repos, repo, seconds);

    const detail = {
      id: `daily-${s.id}`,
      type: 'daily_item',
      started_at: s.started_at,
      ended_at: s.stopped_at,
      duration_seconds: seconds,
      repo_target: repo,
      daily_item_id: s.item_id,
      work_focus: s.item_title,
      summary_note: s.stop_summary || s.session_note,
      github_branch: s.github_branch,
      agent_tool: s.agent_tool,
    };
    dayRow.sessions.push(detail);
    sessionDetails.push(detail);

    if (!dayRow.items_worked.some(i => i.item_id === s.item_id)) {
      dayRow.items_worked.push({
        item_id: s.item_id,
        title: s.item_title,
        repo_target: repo,
      });
    }
  }

  const allDays = eachDayInRange(from, to);
  const daysWorked = allDays.filter(d => byDayMap.has(d) && byDayMap.get(d).total_seconds > 0);
  const missingDays = allDays.filter(d => !byDayMap.has(d) || byDayMap.get(d).total_seconds === 0);

  const byDay = allDays.map(date => {
    const row = byDayMap.get(date) || {
      date,
      total_seconds: 0,
      session_count: 0,
      repos: emptyRepoMap(),
      sessions: [],
      items_worked: [],
    };
    return {
      ...row,
      total_formatted: formatDuration(row.total_seconds),
      repos: Object.entries(row.repos)
        .filter(([, v]) => v.total_seconds > 0 || v.session_count > 0)
        .map(([repo_target, v]) => ({
          repo_target,
          ...getRepoMeta(repo_target),
          total_seconds: v.total_seconds,
          total_formatted: formatDuration(v.total_seconds),
          session_count: v.session_count,
        })),
    };
  });

  const byRepoList = Object.entries(byRepo)
    .map(([repo_target, v]) => ({
      repo_target,
      github_repo: getRepoMeta(repo_target).github_repo,
      label: getRepoMeta(repo_target).label,
      color: getRepoMeta(repo_target).color,
      total_seconds: v.total_seconds,
      total_formatted: formatDuration(v.total_seconds),
      session_count: v.session_count,
      items_completed: completedItems.filter(i => resolveRepoTarget(i.repo_target) === repo_target).length,
    }))
    .filter(r => r.total_seconds > 0 || r.session_count > 0 || r.items_completed > 0)
    .sort((a, b) => b.total_seconds - a.total_seconds);

  const completedByRepo = {};
  for (const item of completedItems) {
    const repo = item.repo_target || 'orthodoxmetrics';
    if (!completedByRepo[repo]) completedByRepo[repo] = [];
    completedByRepo[repo].push(item);
  }

  return {
    period: { from, to },
    totals: {
      total_seconds: totalSeconds,
      total_formatted: formatDuration(totalSeconds),
      session_count: sessionDetails.length,
      days_worked: daysWorked.length,
      days_in_period: allDays.length,
      untagged_sessions: untaggedCount,
      items_completed: completedItems.length,
    },
    by_repo: byRepoList,
    by_day: byDay,
    completed_items: completedItems.map(i => ({
      id: i.id,
      title: i.title,
      repo_target: i.repo_target || 'orthodoxmetrics',
      github_repo: getRepoMeta(i.repo_target).github_repo,
      completed_at: i.completed_at,
      github_branch: i.github_branch,
      category: i.category,
    })),
    completed_by_repo: completedByRepo,
    accountability: {
      missing_days: missingDays,
      untagged_sessions: untaggedCount,
      avg_seconds_per_day: daysWorked.length > 0 ? Math.round(totalSeconds / daysWorked.length) : 0,
      avg_formatted: formatDuration(daysWorked.length > 0 ? Math.round(totalSeconds / daysWorked.length) : 0),
    },
  };
}

module.exports = {
  buildWorkAnalytics,
  formatDuration,
  getRepoMeta,
};
