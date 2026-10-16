/**
 * Work Session Backfill — enrich sparse work_sessions rows with OM Daily,
 * git activity, and change-set context for accountability reporting.
 */

const { getAppPool, getOmaiPool } = require('../config/db');
const { normalizeRepoTarget, formatDuration } = require('./workSessionConstants');
const {
  GIT_REPO_ROOTS,
  fetchCommitsForRepo,
  repoAvailable,
} = require('./workAccountabilityGitService');
const {
  scanAgentActivity,
  agentSessionsForWorkSession,
  pickBestAgentTitle,
} = require('./workAccountabilityAgentSourcesService');

function parseJsonField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sessionEndTime(session) {
  if (session.ended_at) return new Date(session.ended_at);
  if (session.duration_seconds) {
    return new Date(new Date(session.started_at).getTime() + session.duration_seconds * 1000);
  }
  return new Date();
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  const as = new Date(aStart).getTime();
  const ae = new Date(aEnd).getTime();
  const bs = new Date(bStart).getTime();
  const be = new Date(bEnd).getTime();
  return as <= be && bs <= ae;
}

function needsBackfill(session) {
  const ctx = parseJsonField(session.start_context) || {};
  return (
    !session.repo_target
    || session.repo_target === 'unknown'
    || !session.work_focus
    || !session.summary_note
    || !session.daily_item_id
    || !session.om_daily_session_id
    || !ctx.github_branch
    || !ctx.commits_during_session?.length
  );
}

async function fetchSessionsForBackfill({ userId, sinceSqlFrom, limit = 200 }) {
  const pool = getAppPool();
  const params = [sinceSqlFrom];
  let userClause = '';
  if (userId) {
    userClause = ' AND user_id = ?';
    params.push(userId);
  }
  params.push(limit);

  const [rows] = await pool.query(
    `SELECT id, user_id, source_system, repo_target, daily_item_id, work_focus,
            om_daily_session_id, started_at, ended_at, duration_seconds, status,
            start_context, end_context, summary_note
     FROM work_sessions
     WHERE started_at >= ?
       AND status IN ('completed', 'active', 'cancelled')
       ${userClause}
     ORDER BY started_at DESC
     LIMIT ?`,
    params,
  );
  return rows;
}

async function fetchDailySessions(sinceSqlFrom) {
  let pool;
  try {
    pool = getOmaiPool();
  } catch {
    return [];
  }
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.item_id, s.started_by, s.started_at, s.stopped_at, s.duration_seconds,
              s.status, s.repo_target, s.github_branch, s.session_note, s.stop_summary, s.agent_tool,
              i.title AS item_title, i.status AS item_status, i.priority, i.category,
              i.github_branch AS item_github_branch
       FROM om_daily_work_sessions s
       JOIN om_daily_items i ON i.id = s.item_id
       WHERE s.started_at >= ?
       ORDER BY s.started_at DESC
       LIMIT 500`,
      [sinceSqlFrom],
    );
    return rows;
  } catch (err) {
    console.warn('[SessionBackfill] om_daily_work_sessions:', err.message);
    return [];
  }
}

async function fetchDailyItemsByIds(ids) {
  if (!ids.length) return new Map();
  let pool;
  try {
    pool = getOmaiPool();
  } catch {
    return new Map();
  }
  try {
    const [rows] = await pool.query(
      `SELECT id, title, status, priority, category, repo_target, github_branch
       FROM om_daily_items WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    return new Map(rows.map((r) => [r.id, r]));
  } catch {
    return new Map();
  }
}

async function fetchChangeSetsByBranch() {
  const pool = getAppPool();
  try {
    const [rows] = await pool.query(
      `SELECT id, code, title, status, git_branch, updated_at
       FROM change_sets
       WHERE git_branch IS NOT NULL AND git_branch != ''
         AND status NOT IN ('rolled_back')
         AND updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       ORDER BY updated_at DESC
       LIMIT 100`,
    );
    const map = new Map();
    for (const row of rows) {
      const key = String(row.git_branch).toLowerCase();
      if (!map.has(key)) map.set(key, row);
    }
    return map;
  } catch {
    return new Map();
  }
}

function normalizeGitBranch(branch) {
  if (!branch || branch === 'HEAD' || branch === 'detached' || branch === 'unknown') return null;
  return branch;
}
  const startMs = new Date(startedAt).getTime() - 5 * 60 * 1000;
  const endMs = new Date(endedAt).getTime() + 5 * 60 * 1000;
  return commits.filter((c) => {
    const t = new Date(c.timestamp).getTime();
    return t >= startMs && t <= endMs;
  });
}

function buildSummaryFromCommits(commits, dailyItem, changeSet) {
  const parts = [];
  if (dailyItem?.title) parts.push(dailyItem.title);
  else if (changeSet) parts.push(`${changeSet.code}: ${changeSet.title}`);
  if (commits.length) {
    const lines = commits.slice(0, 5).map((c) => `${c.sha} ${c.message}`);
    parts.push(lines.join('; '));
    if (commits.length > 5) parts.push(`+${commits.length - 5} more commit(s)`);
  }
  return parts.join(' — ').slice(0, 2000) || null;
}

function buildWorkFocus(session, dailyItem, dailySession, commits, changeSet, agentTitle) {
  if (session.work_focus) return session.work_focus;
  if (dailyItem?.title) return dailyItem.title;
  if (dailySession?.item_title) return dailySession.item_title;
  if (changeSet) return `${changeSet.code}: ${changeSet.title}`;
  if (agentTitle) return agentTitle.slice(0, 255);
  if (commits[0]?.message) return commits[0].message.slice(0, 255);
  return null;
}

function enrichSessionFields(session, {
  dailyByOmId,
  dailyByItemId,
  changeSetsByBranch,
  commitsByRepo,
  agentScan,
}) {
  const ctx = parseJsonField(session.start_context) || {};
  const sources = [];
  const patch = {};
  const meta = {
    github_branch: ctx.github_branch || null,
    commits_during_session: ctx.commits_during_session || [],
    change_set_code: ctx.change_set_code || null,
    daily_item_title: ctx.daily_item_title || null,
    agent_tool: ctx.agent_tool || null,
  };

  let dailySession = null;
  if (session.om_daily_session_id) {
    dailySession = dailyByOmId.get(Number(session.om_daily_session_id)) || null;
    if (dailySession) sources.push('om_daily_session_id');
  }

  if (!dailySession) {
    const end = sessionEndTime(session);
    for (const ds of dailyByOmId.values()) {
      if (Number(ds.started_by) !== Number(session.user_id)) continue;
      const dsEnd = ds.stopped_at || (ds.duration_seconds
        ? new Date(new Date(ds.started_at).getTime() + ds.duration_seconds * 1000)
        : end);
      if (overlaps(session.started_at, end, ds.started_at, dsEnd)) {
        dailySession = ds;
        sources.push('time_overlap_daily_session');
        if (!patch.om_daily_session_id && !session.om_daily_session_id) {
          patch.om_daily_session_id = ds.id;
        }
        break;
      }
    }
  }

  let dailyItem = null;
  const itemId = patch.daily_item_id || session.daily_item_id || dailySession?.item_id;
  if (itemId) {
    dailyItem = dailyByItemId.get(Number(itemId)) || null;
    if (dailyItem) {
      sources.push('om_daily_item');
      if (!session.daily_item_id && !patch.daily_item_id) patch.daily_item_id = dailyItem.id;
    }
  }

  const repoFromDaily = normalizeRepoTarget(
    dailySession?.repo_target || dailyItem?.repo_target || ctx.repo_target,
  );
  if ((!session.repo_target || session.repo_target === 'unknown') && repoFromDaily) {
    patch.repo_target = repoFromDaily;
    sources.push('repo_from_daily');
  }

  const branch = dailySession?.github_branch
    || dailyItem?.github_branch
    || dailyItem?.item_github_branch
    || meta.github_branch;

  let sessionCommits = [];
  const reposToScan = repoFromDaily && GIT_REPO_ROOTS[repoFromDaily]
    ? [repoFromDaily]
    : Object.keys(GIT_REPO_ROOTS).filter(repoAvailable);

  for (const repo of reposToScan) {
    const repoCommits = commitsByRepo[repo] || [];
    const matched = commitsInWindow(repoCommits, session.started_at, sessionEndTime(session));
    sessionCommits = sessionCommits.concat(matched);
  }
  sessionCommits.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (sessionCommits.length) {
    sources.push('git_commits');
    meta.commits_during_session = sessionCommits.map((c) => ({
      sha: c.sha,
      message: c.message,
      repo_target: c.repo_target,
      branch: c.branch,
      timestamp: c.timestamp,
    }));
    if ((!session.repo_target || session.repo_target === 'unknown') && sessionCommits[0]) {
      patch.repo_target = sessionCommits[0].repo_target;
    }
    if (!meta.github_branch && sessionCommits[0]?.branch) {
      meta.github_branch = normalizeGitBranch(sessionCommits[0].branch);
    }
  }

  const preferredRepo = patch.repo_target || session.repo_target;
  if (!meta.github_branch && sessionCommits.length && preferredRepo) {
    const repoCommit = sessionCommits.find((c) => c.repo_target === preferredRepo);
    meta.github_branch = normalizeGitBranch(repoCommit?.branch) || meta.github_branch;
  }

  const csKey = (meta.github_branch || normalizeGitBranch(branch) || '').toLowerCase();
  const changeSet = csKey ? changeSetsByBranch.get(csKey) : null;
  if (changeSet) {
    sources.push('change_set');
    meta.change_set_code = changeSet.code;
  }

  if (branch && !meta.github_branch) meta.github_branch = normalizeGitBranch(branch);
  if (dailyItem?.title) meta.daily_item_title = dailyItem.title;
  if (dailySession?.agent_tool) meta.agent_tool = dailySession.agent_tool;

  const agentMatches = agentScan ? agentSessionsForWorkSession(session, agentScan) : [];
  const agentTitle = pickBestAgentTitle(agentMatches);
  if (agentMatches.length) {
    sources.push('agent_transcripts');
    meta.agent_session_ids = agentMatches.map((s) => s.session_id).slice(0, 5);
    if (agentTitle) meta.agent_session_title = agentTitle;
    if ((!session.repo_target || session.repo_target === 'unknown') && agentMatches[0]?.repo_target) {
      patch.repo_target = agentMatches[0].repo_target;
    }
  }

  const workFocus = buildWorkFocus(session, dailyItem, dailySession, sessionCommits, changeSet, agentTitle);
  if (!session.work_focus && workFocus) patch.work_focus = workFocus;

  const summary = buildSummaryFromCommits(sessionCommits, dailyItem, changeSet)
    || dailySession?.stop_summary
    || dailySession?.session_note
    || (agentTitle ? `Agent: ${agentTitle}`.slice(0, 2000) : null)
    || null;
  if (!session.summary_note && summary) patch.summary_note = summary;

  const duration = Number(session.duration_seconds) || 0;
  if (!session.summary_note && !patch.summary_note && duration > 0 && (workFocus || patch.work_focus)) {
    patch.summary_note = `${formatDuration(duration)} on ${workFocus || patch.work_focus}`;
    sources.push('duration_summary');
  }

  const backfillCtx = {
    ...ctx,
    ...meta,
    backfill: {
      at: new Date().toISOString(),
      sources: [...new Set(sources)],
      complete: sources.length > 0,
    },
  };

  return {
    sessionId: session.id,
    patch,
    start_context: backfillCtx,
    enriched: {
      repo_target: patch.repo_target || session.repo_target,
      work_focus: patch.work_focus || session.work_focus,
      summary_note: patch.summary_note || session.summary_note,
      daily_item_id: patch.daily_item_id || session.daily_item_id,
      om_daily_session_id: patch.om_daily_session_id || session.om_daily_session_id,
      github_branch: meta.github_branch,
      commits_count: meta.commits_during_session.length,
      change_set_code: meta.change_set_code,
      daily_item_title: meta.daily_item_title,
      sources,
    },
    changed: Object.keys(patch).length > 0 || sources.length > 0,
  };
}

async function backfillWorkSessions(options = {}) {
  const hours = Math.min(Math.max(Number(options.hours) || 168, 1), 720);
  const sinceSqlFrom = options.since
    || new Date(Date.now() - hours * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const dryRun = options.dryRun === true || options.dry_run === '1';
  const userId = options.userId || options.user_id || null;

  const sessions = await fetchSessionsForBackfill({ userId, sinceSqlFrom, limit: options.limit || 200 });
  const candidates = sessions.filter(needsBackfill);

  const [dailySessions, changeSetsByBranch] = await Promise.all([
    fetchDailySessions(sinceSqlFrom),
    fetchChangeSetsByBranch(),
  ]);

  const dailyByOmId = new Map(dailySessions.map((s) => [Number(s.id), s]));
  const itemIds = [
    ...new Set([
      ...sessions.map((s) => s.daily_item_id).filter(Boolean),
      ...dailySessions.map((s) => s.item_id).filter(Boolean),
    ]),
  ];
  const dailyByItemId = await fetchDailyItemsByIds(itemIds);

  const gitSinceArgs = ['--since', sinceSqlFrom];
  const commitsByRepo = {};
  for (const repo of Object.keys(GIT_REPO_ROOTS)) {
    if (!repoAvailable(repo)) continue;
    commitsByRepo[repo] = fetchCommitsForRepo(repo, gitSinceArgs);
  }

  let agentScan = null;
  try {
    agentScan = scanAgentActivity({ since: sinceSqlFrom, hours });
  } catch (err) {
    console.warn('[SessionBackfill] agent scan skipped:', err.message);
  }

  const results = [];
  let updated = 0;

  for (const session of candidates) {
    const result = enrichSessionFields(session, {
      dailyByOmId,
      dailyByItemId,
      changeSetsByBranch,
      commitsByRepo,
      agentScan,
    });
    results.push(result);

    if (!result.changed || dryRun) continue;

    const sets = [];
    const params = [];
    for (const [key, val] of Object.entries(result.patch)) {
      sets.push(`${key} = ?`);
      params.push(val);
    }
    sets.push('start_context = ?');
    params.push(JSON.stringify(result.start_context));
    sets.push('updated_at = NOW()');
    params.push(result.sessionId);

    await getAppPool().query(
      `UPDATE work_sessions SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    updated += 1;
  }

  // Include sessions that only received start_context metadata (no column patch)
  const enrichedCount = results.filter((r) => r.changed).length;

  return {
    dry_run: dryRun,
    since: sinceSqlFrom,
    scanned: sessions.length,
    candidates: candidates.length,
    updated,
    enriched: enrichedCount,
    sessions: results.filter((r) => r.changed),
  };
}

module.exports = {
  backfillWorkSessions,
  enrichSessionFields,
  needsBackfill,
};
