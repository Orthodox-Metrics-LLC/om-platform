/**
 * Work Accountability Reporting — normalized analytics, exports, and persistence.
 * Single source of truth for summary / markdown / json / csv / email reports.
 */

const fs = require('fs');
const path = require('path');
const { getAppPool } = require('../config/db');
const {
  aggregateAccountability,
  workItemCompletion,
  completedInWindow,
} = require('./workAccountabilityAggregatorService');
const { resolveWorkAccountabilityRange, bucketForDays } = require('./workAccountabilityRange');

const PERIOD_DAYS = {
  '30d': 30,
  '60d': 60,
  '90d': 90,
  '6m': 183,
  '1y': 365,
};

// Rolling-hours presets that mirror the Command Center's FilterBar/Exceptions-Inbox
// windowing (see workAccountabilityAggregatorService.parseWindow's "rolling" mode).
// Keeping these on the exact same rolling-timestamp basis (vs. day-truncated from/to)
// is what lets a report's executive_summary.exceptions_critical reconcile bit-for-bit
// with a live /exceptions or /overview query for the same window.
const PERIOD_HOURS = {
  '24h': 24,
  '7d': 168,
};

const CREDENTIAL_RE = /(?:api[_-]?key|password|secret|token|bearer)\s*[:=]\s*\S+/gi;

const REPORT_CACHE_TTL_MS = 120_000;
const reportCache = new Map();

function reportCacheKey(options, period) {
  return JSON.stringify({
    period_key: period.period_key,
    from: period.from,
    to: period.to,
    hours: period.hours || null,
    repo: options.repo || null,
    agent: options.agent || null,
  });
}

function getCachedReport(key) {
  const entry = reportCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > REPORT_CACHE_TTL_MS) {
    reportCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedReport(key, data) {
  reportCache.set(key, { ts: Date.now(), data });
  if (reportCache.size > 16) {
    const oldest = [...reportCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) reportCache.delete(oldest[0]);
  }
}

function redactString(s) {
  if (!s || typeof s !== 'string') return s;
  return s.replace(CREDENTIAL_RE, '[REDACTED]');
}

function redactValue(v) {
  if (typeof v === 'string') return redactString(v);
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (/password|secret|token|api_key|apikey/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactValue(val);
      }
    }
    return out;
  }
  return v;
}

function parseReportPeriod(options = {}) {
  // Canonical resolver: the report window, bucket, and label all derive from the
  // exact same range value the Command Center's global FilterBar sends to
  // /overview, /timeline, /agents, and /exceptions — so a report never silently
  // uses a different (or shorter) window than the rest of the cockpit.
  const r = resolveWorkAccountabilityRange({
    range: options.range,
    period: options.period,
    hours: options.hours,
    from: options.from,
    to: options.to,
  });
  return {
    period_key: r.mode === 'custom' ? `custom:${r.from}:${r.to}` : r.preset,
    from: r.from,
    to: r.to,
    start: r.start,
    end: r.end,
    label: r.label,
    days: r.days,
    bucket: r.bucket,
    mode: r.mode,
    hours: r.mode === 'rolling' ? r.hours : undefined,
  };
}

function previousPeriod(period) {
  const fromDt = new Date(period.from);
  const toDt = new Date(period.to);
  const spanMs = toDt.getTime() - fromDt.getTime();
  const prevTo = new Date(fromDt.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - spanMs);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
    label: `Previous ${period.days}d`,
  };
}

function pctDelta(current, previous) {
  if (previous == null || previous === 0) {
    if (current == null || current === 0) return null;
    return current > 0 ? 100 : null;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function avgConfidenceScore(threads) {
  const weights = { exact: 5, strong: 4, medium: 3, weak: 2, unknown: 1 };
  if (!threads.length) return null;
  const sum = threads.reduce((a, t) => a + (weights[t.confidence] || 1), 0);
  return Math.round((sum / threads.length) * 20) / 20;
}

function governanceScore(threads, exceptions) {
  if (!threads.length) return null;
  const openExc = exceptions.filter((e) => e.review_status === 'open');
  const critical = openExc.filter((e) => e.severity === 'critical').length;
  const high = openExc.filter((e) => e.severity === 'high').length;
  const governed = threads.filter((t) => t.session || t.work_item).length;
  const governedPct = governed / threads.length;
  let score = Math.round(governedPct * 70);
  score -= critical * 15;
  score -= high * 5;
  score -= openExc.length * 2;
  return Math.max(0, Math.min(100, score));
}

function evidenceScore(threads) {
  const avg = avgConfidenceScore(threads);
  if (avg == null) return null;
  return Math.round((avg / 5) * 100);
}

function completionRate(threads) {
  const withItem = threads.filter((t) => t.work_item);
  if (!withItem.length) return null;
  const done = withItem.filter((t) => t.work_item.status === 'done').length;
  return Math.round((done / withItem.length) * 1000) / 10;
}

function averageCycleTimeHours(threads) {
  const durations = [];
  for (const t of threads) {
    const wi = t.work_item;
    if (!wi?.created_at || !wi?.completed_at) continue;
    const ms = new Date(wi.completed_at) - new Date(wi.created_at);
    if (ms > 0) durations.push(ms / 3600000);
  }
  if (!durations.length) return null;
  return Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;
}

function confidenceTiers(threads) {
  const tiers = { exact: 0, strong: 0, medium: 0, weak: 0, unknown: 0 };
  for (const t of threads) {
    tiers[t.confidence] = (tiers[t.confidence] || 0) + 1;
  }
  return tiers;
}

function repoBreakdown(threads, exceptions) {
  const map = new Map();
  for (const t of threads) {
    const repo = t.repo || 'unknown';
    if (!map.has(repo)) {
      map.set(repo, {
        repo,
        threads: 0,
        commits: 0,
        work_items: 0,
        exceptions_open: 0,
        done: 0,
      });
    }
    const row = map.get(repo);
    row.threads += 1;
    row.commits += t.commits?.length || 0;
    if (t.work_item) row.work_items += 1;
    if (t.work_item?.status === 'done') row.done += 1;
  }
  for (const ex of exceptions) {
    if (ex.review_status !== 'open') continue;
    const repo = ex.repo || 'unknown';
    if (!map.has(repo)) {
      map.set(repo, { repo, threads: 0, commits: 0, work_items: 0, exceptions_open: 0, done: 0 });
    }
    map.get(repo).exceptions_open += 1;
  }
  return [...map.values()].sort((a, b) => b.threads - a.threads);
}

function agentBreakdown(threads, agentActivity) {
  const map = new Map();
  for (const t of threads) {
    const agents = new Set();
    if (t.session?.agent_tool) agents.add(t.session.agent_tool);
    if (t.work_item?.agent_tool) agents.add(t.work_item.agent_tool);
    for (const tr of t.transcripts || []) {
      if (tr.platform) agents.add(tr.platform);
    }
    for (const agent of agents) {
      if (!map.has(agent)) {
        map.set(agent, { agent, threads: 0, sessions: 0, commits: 0, work_items_done: 0 });
      }
      const row = map.get(agent);
      row.threads += 1;
      row.commits += t.commits?.length || 0;
      if (t.work_item?.status === 'done') row.work_items_done += 1;
    }
  }
  for (const s of agentActivity?.sessions || []) {
    const agent = s.platform || 'unknown';
    if (!map.has(agent)) {
      map.set(agent, { agent, threads: 0, sessions: 0, commits: 0, work_items_done: 0 });
    }
    map.get(agent).sessions += 1;
  }
  return [...map.values()].sort((a, b) => b.threads - a.threads);
}

function statusBreakdown(threads) {
  const map = new Map();
  for (const t of threads) {
    const st = t.work_item?.status || t.status || 'unknown';
    map.set(st, (map.get(st) || 0) + 1);
  }
  return [...map.entries()].map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

function exceptionBreakdown(exceptions) {
  const byType = new Map();
  const bySeverity = new Map();
  for (const ex of exceptions) {
    if (ex.review_status !== 'open') continue;
    byType.set(ex.type, (byType.get(ex.type) || 0) + 1);
    bySeverity.set(ex.severity, (bySeverity.get(ex.severity) || 0) + 1);
  }
  return {
    by_type: [...byType.entries()].map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    by_severity: [...bySeverity.entries()].map(([severity, count]) => ({ severity, count }))
      .sort((a, b) => b.count - a.count),
    total_open: exceptions.filter((e) => e.review_status === 'open').length,
    total_critical: exceptions.filter((e) => e.severity === 'critical' && e.review_status === 'open').length,
  };
}

function deployBreakdown(threads, gitSummary) {
  const deployThreads = threads.filter((t) => t.deploy || t.thread_type === 'deploy');
  const snapshots = gitSummary?.repo_snapshots || [];
  return {
    deploy_events: deployThreads.map((t) => ({
      repo: t.repo,
      commit: t.deploy?.commit || null,
      deployed_at: t.deploy?.deployed_at || null,
      deployed_by: t.deploy?.deployed_by || null,
      branch: t.deploy?.branch || t.branch,
    })),
    repo_snapshots: snapshots.map((s) => ({
      repo: s.repo_target,
      current_branch: s.current_branch,
      commits_in_window: s.commits_in_window,
      head_commit: s.head_commit_short || s.head_commit,
    })),
  };
}

function workTimeBreakdown(threads) {
  let timerSeconds = 0;
  let governedSeconds = 0;
  let timerCount = 0;
  let governedCount = 0;
  for (const t of threads) {
    for (const ts of t.timer_sessions || []) {
      timerCount += 1;
      if (ts.duration_seconds) timerSeconds += ts.duration_seconds;
    }
    if (t.session?.duration_seconds) {
      governedSeconds += t.session.duration_seconds;
      governedCount += 1;
    }
  }
  return {
    timer_sessions: timerCount,
    timer_hours: timerSeconds ? Math.round((timerSeconds / 3600) * 10) / 10 : null,
    governed_sessions: governedCount,
    governed_hours: governedSeconds ? Math.round((governedSeconds / 3600) * 10) / 10 : null,
  };
}

function hourKey(iso) {
  // 'YYYY-MM-DD HH:00' — unique within a 24h window and lexically sortable.
  return `${new Date(iso).toISOString().slice(0, 13).replace('T', ' ')}:00`;
}

function dayKey(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

function weekKey(iso) {
  const d = new Date(iso);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setUTCDate(diff);
  return monday.toISOString().slice(0, 10);
}

function monthKey(iso) {
  // MUST normalize through Date: MySQL datetime columns (completed_at) come back
  // as JS Date objects, and `Date.toString()` yields "Fri May 08 2026 …" whose
  // .slice(0,7) = "Fri May" — which never matches the "YYYY-MM" bucket keys, so
  // every monthly Completion bucket silently rendered 0 despite in-window
  // completions. new Date(iso).toISOString() gives a canonical "YYYY-MM" for both
  // Date objects and ISO/MySQL strings (consistent with hour/day/week keys).
  return new Date(iso).toISOString().slice(0, 7);
}

function bucketKey(iso, bucket) {
  if (bucket === 'hour') return hourKey(iso);
  if (bucket === 'day') return dayKey(iso);
  if (bucket === 'month') return monthKey(iso);
  return weekKey(iso);
}

/**
 * Every bucket key spanning [start, end] for the given bucket size, in
 * chronological order. Guarantees the chart covers the *full* window even when
 * some buckets have zero activity (no silent collapse to the active buckets only).
 */
function generateBucketKeys(start, end, bucket) {
  const keys = [];
  const cur = new Date(start.getTime());
  const guard = 2000; // hard cap so a mis-sized bucket can never spin
  let i = 0;
  if (bucket === 'hour') {
    cur.setUTCMinutes(0, 0, 0);
    while (cur <= end && i++ < guard) {
      keys.push(hourKey(cur.toISOString()));
      cur.setUTCHours(cur.getUTCHours() + 1);
    }
  } else if (bucket === 'day') {
    cur.setUTCHours(0, 0, 0, 0);
    while (cur <= end && i++ < guard) {
      keys.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  } else if (bucket === 'month') {
    cur.setUTCDate(1);
    cur.setUTCHours(0, 0, 0, 0);
    while (cur <= end && i++ < guard) {
      keys.push(cur.toISOString().slice(0, 7));
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  } else { // week — align to Monday
    const day = cur.getUTCDay();
    cur.setUTCDate(cur.getUTCDate() + ((day === 0 ? -6 : 1) - day));
    cur.setUTCHours(0, 0, 0, 0);
    while (cur <= end && i++ < guard) {
      keys.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 7);
    }
  }
  return keys;
}

function emptyBucket() {
  return { threads: 0, commits: 0, exceptions: 0, completed: 0 };
}

/**
 * @param {Array} threads
 * @param {string} bucket - hour|day|week|month
 * @param {{start:Date,end:Date}} [window] - when provided, zero-fills the full span.
 * @param {object} [diag] - optional diagnostics accumulator (dev only).
 *
 * Threads/exceptions bucket by the thread's last activity timestamp.
 * Commits bucket INDEPENDENTLY by EACH commit's own author/commit timestamp (so a
 * long-lived branch's commit history is spread across the months it actually
 * happened, not collapsed into the branch's most-recent-activity month).
 * Completions bucket INDEPENDENTLY by the work item's actual completion
 * timestamp (completed_at → github_pr_merged_at), so an archived item completed
 * in an earlier month lands in that month's bucket — not the (recent) activity
 * bucket. Completions whose timestamp is outside the window naturally fall
 * outside the generated bucket keys and are dropped from the chart.
 */
function bucketTrends(threads, bucket, window, diag) {
  const counts = new Map();
  const ensure = (key) => {
    if (!counts.has(key)) counts.set(key, emptyBucket());
    return counts.get(key);
  };

  // The canonical bucket keys that define the chart's x-axis. Completions whose
  // bucket key is NOT in this set (out-of-window) are excluded — this is the
  // single source of truth so the chart, diagnostics, and the completions KPI all
  // count the exact same set.
  const orderedKeys = window && window.start && window.end
    ? generateBucketKeys(window.start, window.end, bucket)
    : null;
  const keySet = orderedKeys ? new Set(orderedKeys) : null;

  for (const t of threads) {
    const at = t.timestamps.last_activity_at || t.timestamps.started_at;
    if (at) {
      const row = ensure(bucketKey(at, bucket));
      row.threads += 1;
      row.exceptions += (t.exceptions || []).length;
    }
    // Commits bucket INDEPENDENTLY by each commit's own author/commit timestamp,
    // NOT the thread's single last-activity bucket. A long-lived branch (above all
    // `main`) accumulates commits across many months but has one recent
    // last_activity_at; attributing `t.commits.length` to that single bucket
    // collapsed the entire window's commit history into the current month (the
    // ~1,900-commit "July spike"). Each commit carries its %aI author date in
    // `timestamp` (see fetchCommitsForRepo); bucket by that, guarded to the
    // in-window key set exactly like completions so out-of-window edges are dropped.
    for (const c of t.commits || []) {
      const cAt = c.timestamp || c.authored_at || c.committed_at || at;
      if (!cAt) continue;
      const cKey = bucketKey(cAt, bucket);
      if (!keySet || keySet.has(cKey)) {
        ensure(cKey).commits += 1;
      }
    }
    if (t.work_item?.status === 'done') {
      const { ts, inferred, field } = workItemCompletion(t.work_item);
      if (ts) {
        const cKey = bucketKey(ts, bucket);
        if (!keySet || keySet.has(cKey)) {
          ensure(cKey).completed += 1;
          if (diag) {
            diag.completed_by_field[field || 'unknown'] = (diag.completed_by_field[field || 'unknown'] || 0) + 1;
            if (inferred) diag.inferred_completions += 1;
          }
        }
      } else if (diag) {
        diag.completions_without_ts += 1;
      }
    }
  }

  const finalKeys = orderedKeys || [...counts.keys()].sort((a, b) => a.localeCompare(b));
  return finalKeys.map((key) => ({ period: key, ...(counts.get(key) || emptyBucket()) }));
}

/** Trend bucket size from report window length (days) — delegates to the shared resolver. */
function resolveTrendGranularity(days) {
  return bucketForDays(days);
}

const TREND_GRANULARITY_META = {
  hour: { label: 'Hourly breakdown', periodHeader: 'Hour', csvSection: 'hourly_trends' },
  day: { label: 'Daily breakdown', periodHeader: 'Day', csvSection: 'daily_trends' },
  week: { label: 'Weekly breakdown', periodHeader: 'Week', csvSection: 'weekly_trends' },
  month: { label: 'Monthly breakdown', periodHeader: 'Month', csvSection: 'monthly_trends' },
};

function buildActivityTrends(threads, period, diag) {
  // Accepts either a resolved period object ({ bucket, start, end, days }) or a
  // bare day count (back-compat for older callers).
  const p = (period && typeof period === 'object') ? period : { days: period };
  const bucket = p.bucket || bucketForDays(p.days);
  const meta = TREND_GRANULARITY_META[bucket] || TREND_GRANULARITY_META.week;
  const window = (p.start && p.end)
    ? { start: new Date(p.start), end: new Date(p.end) }
    : null;
  const trends = bucketTrends(threads, bucket, window, diag);
  const bucketKeys = window ? generateBucketKeys(window.start, window.end, bucket) : trends.map((t) => t.period);
  return { granularity: bucket, ...meta, trends, bucketKeys };
}

function topCompletedWork(threads) {
  return threads
    .filter((t) => t.work_item?.status === 'done')
    .map((t) => ({
      id: t.id,
      code: t.work_item.code,
      title: t.work_item.title,
      repo: t.repo,
      branch: t.branch,
      completed_at: t.work_item.completed_at,
      commits: t.commits?.length || 0,
      confidence: t.confidence,
    }))
    .sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0))
    .slice(0, 25);
}

function staleWork(threads, staleDays = 7) {
  const cutoff = Date.now() - staleDays * 86400000;
  return threads
    .filter((t) => {
      if (!t.work_item) return false;
      if (['done', 'cancelled'].includes(t.work_item.status)) return false;
      const at = t.timestamps.last_activity_at || t.work_item.updated_at;
      return at && new Date(at).getTime() < cutoff;
    })
    .map((t) => ({
      id: t.id,
      code: t.work_item.code,
      title: t.work_item.title,
      status: t.work_item.status,
      repo: t.repo,
      last_activity_at: t.timestamps.last_activity_at,
      days_stale: Math.floor((Date.now() - new Date(t.timestamps.last_activity_at || t.work_item.updated_at)) / 86400000),
    }))
    .sort((a, b) => b.days_stale - a.days_stale)
    .slice(0, 25);
}

function orphanedActivity(threads) {
  return threads
    .filter((t) => !t.work_item && ((t.commits?.length || 0) > 0 || (t.transcripts?.length || 0) > 0))
    .map((t) => ({
      id: t.id,
      title: t.title,
      repo: t.repo,
      branch: t.branch,
      commits: t.commits?.length || 0,
      transcripts: t.transcripts?.length || 0,
      confidence: t.confidence,
    }))
    .sort((a, b) => (b.commits + b.transcripts) - (a.commits + a.transcripts))
    .slice(0, 25);
}

function missingEvidence(threads) {
  return threads
    .filter((t) => t.missing_links?.length > 0)
    .map((t) => ({
      id: t.id,
      title: t.title,
      repo: t.repo,
      branch: t.branch,
      missing_links: t.missing_links,
      work_item_code: t.work_item?.code || null,
      confidence: t.confidence,
    }))
    .slice(0, 25);
}

function buildRecommendations(report) {
  const recs = [];
  const es = report.executive_summary;
  if (es.exceptions_critical > 0) {
    recs.push({
      priority: 'critical',
      title: 'Resolve critical exceptions',
      detail: `${es.exceptions_critical} critical exception(s) require immediate review.`,
    });
  }
  if (es.governance_score != null && es.governance_score < 60) {
    recs.push({
      priority: 'high',
      title: 'Improve governance coverage',
      detail: 'Governance score is below 60 — ensure governed sessions exist for active branches.',
    });
  }
  if (es.evidence_score != null && es.evidence_score < 50) {
    recs.push({
      priority: 'high',
      title: 'Strengthen evidence chains',
      detail: 'Link work items, commits, PRs, and timer sessions to raise evidence confidence.',
    });
  }
  if (report.stale_work?.length > 5) {
    recs.push({
      priority: 'medium',
      title: 'Clear stale work items',
      detail: `${report.stale_work.length} work items show no activity in 7+ days.`,
    });
  }
  if (report.orphaned_activity?.length > 3) {
    recs.push({
      priority: 'medium',
      title: 'Link orphaned commits/transcripts',
      detail: 'Activity exists without work item linkage — reconcile via backfill.',
    });
  }
  if (report.missing_evidence?.length > 5) {
    recs.push({
      priority: 'low',
      title: 'Fill missing evidence links',
      detail: 'Multiple threads have incomplete evidence chains.',
    });
  }
  if (!recs.length) {
    recs.push({
      priority: 'info',
      title: 'No urgent actions',
      detail: 'Accountability metrics are within acceptable ranges for this period.',
    });
  }
  return recs;
}

function buildExecutiveSummary(agg, prevAgg, period) {
  const threads = agg.threads || [];
  const exceptions = agg.exceptions || [];
  const prevThreads = prevAgg?.threads || [];
  const prevExceptions = prevAgg?.exceptions || [];

  const metrics = {
    threads: threads.length,
    commits: agg.kpis?.commits || 0,
    work_items_active: agg.kpis?.work_items_active || 0,
    // Count completions by actual completion timestamp inside the window, matching
    // the Monthly Completions chart (not raw status===done in the fetched set).
    work_items_done: (period && period.start && period.end)
      ? completedInWindow(threads, period.start, period.end)
      : threads.filter((t) => t.work_item?.status === 'done').length,
    agent_sessions: agg.kpis?.agent_sessions || 0,
    governed_sessions: agg.kpis?.governed_sessions || 0,
    repos_active: agg.kpis?.repos_active || 0,
    exceptions_open: agg.kpis?.exceptions_open || 0,
    exceptions_critical: agg.kpis?.exceptions_critical || 0,
    governance_score: governanceScore(threads, exceptions),
    evidence_score: evidenceScore(threads),
    completion_rate: completionRate(threads),
    average_cycle_time_hours: averageCycleTimeHours(threads),
    confidence_tiers: confidenceTiers(threads),
    source_errors: agg.kpis?.source_errors || 0,
  };

  const prevMetrics = prevAgg ? {
    threads: prevThreads.length,
    commits: prevAgg.kpis?.commits || 0,
    work_items_done: prevThreads.filter((t) => t.work_item?.status === 'done').length,
    exceptions_open: prevAgg.kpis?.exceptions_open || 0,
    governance_score: governanceScore(prevThreads, prevExceptions),
    evidence_score: evidenceScore(prevThreads),
    completion_rate: completionRate(prevThreads),
  } : null;

  const deltas = prevMetrics ? {
    threads: pctDelta(metrics.threads, prevMetrics.threads),
    commits: pctDelta(metrics.commits, prevMetrics.commits),
    work_items_done: pctDelta(metrics.work_items_done, prevMetrics.work_items_done),
    exceptions_open: pctDelta(metrics.exceptions_open, prevMetrics.exceptions_open),
    governance_score: metrics.governance_score != null && prevMetrics.governance_score != null
      ? Math.round((metrics.governance_score - prevMetrics.governance_score) * 10) / 10
      : null,
    evidence_score: metrics.evidence_score != null && prevMetrics.evidence_score != null
      ? Math.round((metrics.evidence_score - prevMetrics.evidence_score) * 10) / 10
      : null,
    completion_rate: metrics.completion_rate != null && prevMetrics.completion_rate != null
      ? Math.round((metrics.completion_rate - prevMetrics.completion_rate) * 10) / 10
      : null,
  } : null;

  return {
    ...metrics,
    previous_period: prevAgg ? {
      label: period.previous_label,
      from: period.previous_from,
      to: period.previous_to,
      metrics: prevMetrics,
    } : null,
    deltas,
  };
}

async function fetchAggregationForPeriod(period, options = {}) {
  const base = {
    repo: options.repo || null,
    agent: options.agent || null,
    // Reports re-scan git + DB — skip session backfill to keep 6m/90d builds under client timeout.
    backfill: options.backfill === true,
    // Reports are historical/completion analytics: always include archived-completed items.
    includeArchivedCompleted: true,
  };
  // Rolling windows must be passed through as `hours` (not from/to) so the aggregator
  // computes the identical exact-timestamp boundary used by /overview and /exceptions —
  // from/to would otherwise get day-truncated and silently widen or narrow the window.
  // Custom windows pass explicit from/to (day-truncated). For canonical presets
  // (rolling AND calendar), pass the range key so the aggregator re-resolves the
  // IDENTICAL window (same calendar-month alignment / same rolling boundary) — never
  // a re-derived hours value, which would lose calendar alignment and bucket size.
  if (period.mode === 'custom') {
    return aggregateAccountability({ ...base, from: period.from, to: period.to });
  }
  if (period.period_key && !String(period.period_key).startsWith('custom')) {
    return aggregateAccountability({ ...base, range: period.period_key });
  }
  if (period.mode === 'rolling' && period.hours) {
    return aggregateAccountability({ ...base, hours: period.hours });
  }
  return aggregateAccountability({ ...base, from: period.from, to: period.to });
}

async function buildAccountabilityReport(options = {}) {
  const started = Date.now();
  const period = parseReportPeriod(options);
  const cacheKey = reportCacheKey(options, period);
  const cached = getCachedReport(cacheKey);
  if (cached) {
    console.log(`[work-accountability-report] cache hit (${Date.now() - started}ms) ${period.period_key}`);
    return cached;
  }

  const prev = previousPeriod(period);
  period.previous_from = prev.from;
  period.previous_to = prev.to;
  period.previous_label = prev.label;

  const aggOpts = {
    repo: options.repo || null,
    agent: options.agent || null,
    backfill: options.backfill === true,
  };

  const [currentResult, previousResult] = await Promise.allSettled([
    fetchAggregationForPeriod(period, aggOpts),
    // NOTE: spread `...period` first, then override from/to/mode — spreading it last
    // (as before) clobbered prev.from/prev.to with the *current* period's dates, so the
    // "previous period" comparison was silently re-fetching the current window and every
    // period-over-period delta in the executive summary was meaningless (always ~0).
    fetchAggregationForPeriod({ ...period, from: prev.from, to: prev.to, mode: 'custom' }, { ...aggOpts, backfill: false }),
  ]);

  const agg = currentResult.status === 'fulfilled' ? currentResult.value : {
    threads: [], exceptions: [], kpis: {}, agent_activity: {}, git_report_summary: {},
    partial_failures: [{ error: currentResult.reason?.message }],
    generated_at: new Date().toISOString(),
    window: { label: period.label, from: period.from, to: period.to },
  };
  const prevAgg = previousResult.status === 'fulfilled' ? previousResult.value : null;

  const partial_failures = [
    ...(agg.partial_failures || []),
    ...(currentResult.status === 'rejected' ? [{ source: 'current', error: currentResult.reason?.message }] : []),
    ...(previousResult.status === 'rejected' ? [{ source: 'previous', error: previousResult.reason?.message }] : []),
  ];

  const executive_summary = buildExecutiveSummary(agg, prevAgg, period);
  const trendDiag = { inferred_completions: 0, completions_without_ts: 0, completed_by_field: {} };
  const activityTrends = buildActivityTrends(agg.threads, period, trendDiag);

  const diagnostics = {
    range: period.period_key,
    mode: period.mode,
    computed_start: period.from,
    computed_end: period.to,
    bucket: activityTrends.granularity,
    bucket_labels: activityTrends.bucketKeys,
    bucket_count: activityTrends.bucketKeys.length,
    source_records: {
      threads_before_filter: agg.diagnostics?.source_records?.daily_items_fetched ?? null,
      threads_total: agg.threads?.length ?? 0,
      done_threads: agg.diagnostics?.completions?.done_threads ?? null,
    },
    completions: {
      in_window: executive_summary.work_items_done,
      inferred: trendDiag.inferred_completions,
      without_timestamp: trendDiag.completions_without_ts,
      by_completion_field: trendDiag.completed_by_field,
    },
    // Archived-completed inclusion + completion-timestamp coverage from the
    // shared repository (debug/audit detail only).
    include_archived_completed: agg.diagnostics?.include_archived_completed ?? true,
    archived_completed_fetched: agg.diagnostics?.source_records?.archived_completed_fetched ?? null,
    data_quality: agg.diagnostics?.data_quality ?? null,
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[work-accountability-report] range=${period.period_key} mode=${period.mode} resolved start=${period.from} end=${period.to} `
      + `bucket=${activityTrends.granularity} buckets=${activityTrends.bucketKeys.length} `
      + `[${activityTrends.bucketKeys.join(', ')}] `
      + `completed_in_window=${diagnostics.completions.in_window} inferred=${diagnostics.completions.inferred} `
      + `fields=${JSON.stringify(diagnostics.completions.by_completion_field)}`,
    );
  }

  const report = {
    generated_at: new Date().toISOString(),
    period: {
      key: period.period_key,
      label: period.label,
      from: period.from,
      to: period.to,
      days: period.days,
      trends_granularity: activityTrends.granularity,
    },
    executive_summary,
    repo_breakdown: repoBreakdown(agg.threads, agg.exceptions),
    agent_breakdown: agentBreakdown(agg.threads, agg.agent_activity),
    status_breakdown: statusBreakdown(agg.threads),
    exception_breakdown: exceptionBreakdown(agg.exceptions),
    deploy_breakdown: deployBreakdown(agg.threads, agg.git_report_summary),
    work_time_breakdown: workTimeBreakdown(agg.threads),
    activity_trends: activityTrends.trends,
    trends_granularity: activityTrends.granularity,
    trends_label: activityTrends.label,
    trends_period_header: activityTrends.periodHeader,
    weekly_trends: activityTrends.granularity === 'week' ? activityTrends.trends : [],
    monthly_trends: activityTrends.granularity === 'month' ? activityTrends.trends : [],
    top_completed_work: topCompletedWork(agg.threads),
    stale_work: staleWork(agg.threads),
    orphaned_activity: orphanedActivity(agg.threads),
    missing_evidence: missingEvidence(agg.threads),
    exceptions: (agg.exceptions || []).map((ex) => ({
      id: ex.id,
      type: ex.type,
      severity: ex.severity,
      message: redactString(ex.message),
      thread_title: ex.thread_title,
      repo: ex.repo,
      branch: ex.branch,
      work_item_code: ex.work_item_code,
      review_status: ex.review_status,
    })),
    partial_failures,
    degraded: partial_failures.length > 0 || (agg.kpis?.source_errors || 0) > 0,
  };

  // Dev-only diagnostics block (selected range, computed window, bucket labels,
  // source-record counts, completion-field usage). Stripped in production.
  if (process.env.NODE_ENV !== 'production') {
    report.diagnostics = diagnostics;
  }

  report.recommendations = buildRecommendations(report);

  const finalReport = redactValue(report);
  setCachedReport(cacheKey, finalReport);
  console.log(`[work-accountability-report] built ${period.period_key} in ${Date.now() - started}ms`);
  return finalReport;
}

function generateMarkdown(report) {
  const es = report.executive_summary;
  const lines = [
    '# Work Accountability Analytics Report',
    '',
    `**Period:** ${report.period.label} (${report.period.from} → ${report.period.to})`,
    `**Generated:** ${report.generated_at}`,
    report.degraded ? '**⚠ Degraded data** — some sources were unavailable.' : '',
    '',
    '## Executive Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Governance Score | ${es.governance_score ?? '—'} |`,
    `| Evidence Score | ${es.evidence_score ?? '—'} |`,
    `| Completion Rate | ${es.completion_rate != null ? `${es.completion_rate}%` : '—'} |`,
    `| Avg Cycle Time | ${es.average_cycle_time_hours != null ? `${es.average_cycle_time_hours}h` : '—'} |`,
    `| Threads | ${es.threads} |`,
    `| Commits | ${es.commits} |`,
    `| Work Items Done | ${es.work_items_done} |`,
    `| Open Exceptions | ${es.exceptions_open} (${es.exceptions_critical} critical) |`,
    `| Agent Sessions | ${es.agent_sessions} |`,
    '',
  ];

  if (es.deltas) {
    lines.push('### Period-over-Period Deltas', '');
    for (const [k, v] of Object.entries(es.deltas)) {
      if (v == null) continue;
      const suffix = ['governance_score', 'evidence_score', 'completion_rate'].includes(k) ? '' : '%';
      lines.push(`- **${k.replace(/_/g, ' ')}:** ${v > 0 ? '+' : ''}${v}${suffix}`);
    }
    lines.push('');
  }

  if (es.confidence_tiers) {
    lines.push('### Evidence Confidence Tiers', '');
    for (const [tier, count] of Object.entries(es.confidence_tiers)) {
      lines.push(`- ${tier}: ${count}`);
    }
    lines.push('');
  }

  if (report.repo_breakdown?.length) {
    lines.push('## Repository Breakdown', '');
    for (const r of report.repo_breakdown) {
      lines.push(`- **${r.repo}** — ${r.threads} threads, ${r.commits} commits, ${r.exceptions_open} open exceptions`);
    }
    lines.push('');
  }

  if (report.agent_breakdown?.length) {
    lines.push('## Agent Productivity', '');
    for (const a of report.agent_breakdown.slice(0, 15)) {
      lines.push(`- **${a.agent}** — ${a.threads} threads, ${a.sessions} sessions, ${a.work_items_done} done`);
    }
    lines.push('');
  }

  if (report.exception_breakdown?.by_type?.length) {
    lines.push('## Exception Breakdown', '');
    for (const ex of report.exception_breakdown.by_type.slice(0, 20)) {
      lines.push(`- [${ex.count}] ${ex.type}`);
    }
    lines.push('');
  }

  const trendRows = report.activity_trends?.length
    ? report.activity_trends
    : report.weekly_trends;
  if (trendRows?.length) {
    const trendLabel = report.trends_label || 'Weekly breakdown';
    const periodHeader = report.trends_period_header || 'Week';
    // Buckets already span the full window (and are bounded by bucket size), so show
    // them all up to a generous cap rather than silently trimming to a short tail.
    const trendLimit = Math.min(trendRows.length, 200);
    lines.push(`## ${trendLabel}`, '');
    lines.push(`| ${periodHeader} | Threads | Commits | Completed |`);
    lines.push('|------|---------|---------|-----------|');
    for (const w of trendRows.slice(-trendLimit)) {
      lines.push(`| ${w.period} | ${w.threads} | ${w.commits} | ${w.completed} |`);
    }
    lines.push('');
  }

  if (report.top_completed_work?.length) {
    lines.push('## Top Completed Work', '');
    for (const w of report.top_completed_work.slice(0, 15)) {
      lines.push(`- **${w.code}** ${w.title} (${w.commits} commits, ${w.confidence})`);
    }
    lines.push('');
  }

  if (report.stale_work?.length) {
    lines.push('## Stale Work', '');
    for (const w of report.stale_work.slice(0, 10)) {
      lines.push(`- **${w.code}** — ${w.days_stale}d stale, status: ${w.status}`);
    }
    lines.push('');
  }

  if (report.recommendations?.length) {
    lines.push('## Recommendations', '');
    for (const r of report.recommendations) {
      lines.push(`- **[${r.priority}]** ${r.title} — ${r.detail}`);
    }
    lines.push('');
  }

  return lines.filter((l) => l !== undefined).join('\n');
}

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, columns) {
  const header = columns.map((c) => csvEscape(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => csvEscape(c.get(row))).join(','));
  return [header, ...body].join('\n');
}

function generateCsvExports(report) {
  const threads = [
    ...(report.top_completed_work || []).map((w) => ({ ...w, category: 'completed' })),
    ...(report.stale_work || []).map((w) => ({ ...w, category: 'stale' })),
    ...(report.orphaned_activity || []).map((w) => ({ ...w, category: 'orphaned' })),
  ];

  return {
    threads: toCsv(threads, [
      { header: 'category', get: (r) => r.category },
      { header: 'id', get: (r) => r.id },
      { header: 'code', get: (r) => r.code || '' },
      { header: 'title', get: (r) => r.title },
      { header: 'repo', get: (r) => r.repo || '' },
      { header: 'branch', get: (r) => r.branch || '' },
      { header: 'status', get: (r) => r.status || '' },
      { header: 'confidence', get: (r) => r.confidence || '' },
    ]),
    exceptions: toCsv(report.exceptions || [], [
      { header: 'id', get: (r) => r.id },
      { header: 'type', get: (r) => r.type },
      { header: 'severity', get: (r) => r.severity },
      { header: 'message', get: (r) => r.message },
      { header: 'repo', get: (r) => r.repo },
      { header: 'branch', get: (r) => r.branch },
      { header: 'work_item_code', get: (r) => r.work_item_code || '' },
      { header: 'review_status', get: (r) => r.review_status },
    ]),
    agents: toCsv(report.agent_breakdown || [], [
      { header: 'agent', get: (r) => r.agent },
      { header: 'threads', get: (r) => r.threads },
      { header: 'sessions', get: (r) => r.sessions },
      { header: 'commits', get: (r) => r.commits },
      { header: 'work_items_done', get: (r) => r.work_items_done },
    ]),
    repos: toCsv(report.repo_breakdown || [], [
      { header: 'repo', get: (r) => r.repo },
      { header: 'threads', get: (r) => r.threads },
      { header: 'commits', get: (r) => r.commits },
      { header: 'work_items', get: (r) => r.work_items },
      { header: 'done', get: (r) => r.done },
      { header: 'exceptions_open', get: (r) => r.exceptions_open },
    ]),
    activity_trends: toCsv(report.activity_trends || report.weekly_trends || [], [
      { header: (report.trends_period_header || 'period').toLowerCase(), get: (r) => r.period },
      { header: 'threads', get: (r) => r.threads },
      { header: 'commits', get: (r) => r.commits },
      { header: 'exceptions', get: (r) => r.exceptions },
      { header: 'completed', get: (r) => r.completed },
    ]),
    weekly_trends: toCsv(report.weekly_trends || [], [
      { header: 'week', get: (r) => r.period },
      { header: 'threads', get: (r) => r.threads },
      { header: 'commits', get: (r) => r.commits },
      { header: 'exceptions', get: (r) => r.exceptions },
      { header: 'completed', get: (r) => r.completed },
    ]),
  };
}

function generateCombinedCsv(report) {
  const exports = generateCsvExports(report);
  const sections = [
    '# threads',
    exports.threads,
    '# exceptions',
    exports.exceptions,
    '# agents',
    exports.agents,
    '# repos',
    exports.repos,
    `# ${report.trends_granularity || 'weekly'}_trends`,
    exports.activity_trends,
  ];
  return sections.join('\n\n');
}

async function persistReportRecord({
  period, format, userId, status, emailedTo, storagePath, errorMessage, metadata,
}) {
  try {
    const pool = getAppPool();
    const [result] = await pool.query(
      `INSERT INTO work_accountability_reports
         (period_key, from_date, to_date, generated_by, format, status, emailed_to, storage_path, error_message, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        period.period_key || period.key,
        period.from,
        period.to,
        userId || null,
        format,
        status,
        emailedTo || null,
        storagePath || null,
        errorMessage || null,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
    return result.insertId;
  } catch (err) {
    console.warn('[work-accountability-reporting] persist failed:', err.message);
    return null;
  }
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function buildDailyReport(options = {}) {
  // Delegate all window resolution (range / period / hours / custom from-to) to
  // buildAccountabilityReport → parseReportPeriod → the shared range resolver.
  const report = await buildAccountabilityReport({
    range: options.range,
    period: options.period,
    hours: options.hours,
    from: options.from,
    to: options.to,
    backfill: options.backfill,
  });
  return wrapDailyReport(report);
}

function wrapDailyReport(report) {
  const markdown = generateMarkdown(report);
  return {
    markdown,
    json: {
      generated_at: report.generated_at,
      window: { label: report.period.label, from: report.period.from, to: report.period.to },
      kpis: {
        threads: report.executive_summary.threads,
        exceptions_open: report.executive_summary.exceptions_open,
        exceptions_critical: report.executive_summary.exceptions_critical,
        commits: report.executive_summary.commits,
        work_items_active: report.executive_summary.work_items_active,
        agent_sessions: report.executive_summary.agent_sessions,
        governed_sessions: report.executive_summary.governed_sessions,
        repos_active: report.executive_summary.repos_active,
        source_errors: report.executive_summary.source_errors,
      },
      exceptions: report.exceptions,
      threads: [
        ...report.top_completed_work,
        ...report.stale_work.map((w) => ({ id: w.id, title: w.title, status: w.status })),
      ],
      executive_summary: report.executive_summary,
      recommendations: report.recommendations,
    },
    full_report: report,
  };
}

async function buildSummaryReport(options = {}) {
  return buildAccountabilityReport(options);
}

async function exportReport(options = {}, format = 'json') {
  const report = await buildAccountabilityReport(options);
  const periodKey = report.period.key.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (format === 'md' || format === 'markdown') {
    return { content: generateMarkdown(report), contentType: 'text/markdown', report };
  }
  if (format === 'csv') {
    return { content: generateCombinedCsv(report), contentType: 'text/csv', report };
  }
  return { content: JSON.stringify(report, null, 2), contentType: 'application/json', report };
}

async function queueEmailReport({ userId, recipient, options = {} }) {
  const pool = getAppPool();
  let email = recipient;
  if (email && !isValidEmail(email)) {
    throw new Error('Invalid recipient email address');
  }
  if (!email) {
    const [users] = await pool.query('SELECT email FROM users WHERE id = ?', [userId]);
    email = users[0]?.email;
  }
  if (!email || !isValidEmail(email)) {
    throw new Error('No valid recipient email available');
  }

  const { content, report } = await exportReport(options, 'md');
  const subject = `Work Accountability Report — ${report.period.label}`;

  await pool.query(
    `INSERT INTO notification_queue
       (user_id, notification_type_id, recipient_email, subject, message, html_message,
        priority, delivery_method, scheduled_at, status)
     VALUES (?, 90, ?, ?, ?, ?, 'normal', 'email', NOW(), 'pending')`,
    [
      userId,
      email.trim(),
      subject,
      'See HTML body for markdown report.',
      `<pre style="font-family:monospace;white-space:pre-wrap">${content.replace(/</g, '&lt;')}</pre>`,
    ],
  );

  await persistReportRecord({
    period: report.period,
    format: 'email',
    userId,
    status: 'queued',
    emailedTo: email.trim(),
    metadata: { period_key: report.period.key },
  });

  return { queued: true, recipient: email.trim() };
}

module.exports = {
  parseReportPeriod,
  buildAccountabilityReport,
  buildSummaryReport,
  buildDailyReport,
  generateMarkdown,
  generateCsvExports,
  generateCombinedCsv,
  exportReport,
  queueEmailReport,
  persistReportRecord,
  isValidEmail,
  resolveTrendGranularity,
  buildActivityTrends,
  PERIOD_DAYS,
  PERIOD_HOURS,
};
