/**
 * Work Accountability Git Report — aggregates git activity across OM repos
 * for rolling 24h (or calendar-day) engineering accountability reports.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getAppPool, getOmaiPool } = require('../config/db');
const { getRepoMeta } = require('./workSessionConstants');
const { scanAgentActivity } = require('./workAccountabilityAgentSourcesService');

const GIT_REPO_ROOTS = {
  orthodoxmetrics: '/var/www/om-platform',
  omai: '/var/www/omai',
  'omai-ops': '/var/omai-ops',
};

const ACTIVE_CS_STATUSES = new Set([
  'draft', 'active', 'ready_for_staging', 'staged', 'in_review', 'approved',
]);

function repoAvailable(repoTarget) {
  const root = GIT_REPO_ROOTS[repoTarget];
  if (!root) return false;
  try {
    return fs.existsSync(path.join(root, '.git'));
  } catch {
    return false;
  }
}

function gitExec(repoTarget, gitArgs, timeout = 20000) {
  const cwd = GIT_REPO_ROOTS[repoTarget];
  if (!repoAvailable(repoTarget)) return '';
  try {
    return execFileSync('git', gitArgs, {
      cwd,
      encoding: 'utf-8',
      timeout,
      maxBuffer: 6 * 1024 * 1024,
    }).trim();
  } catch (err) {
    if (err.stdout) return String(err.stdout).trim();
    return '';
  }
}

function parseBranchFromDecorations(decorations) {
  if (!decorations) return 'unknown';
  const parts = decorations.split(',').map((s) => s.trim());
  for (const part of parts) {
    const m = part.match(/HEAD -> ([^\s,]+)/);
    if (m) return m[1];
    const ref = part.match(/origin\/(.+)/);
    if (ref && ref[1] !== 'HEAD') return ref[1];
  }
  const head = parts.find((p) => p.startsWith('origin/'));
  if (head) return head.replace('origin/', '');
  return 'detached';
}

function parseSinceGitArgs({ hours, date, from, to }) {
  if (from && to) {
    return ['--since', `${from} 00:00:00`, '--until', `${to} 23:59:59`];
  }
  if (date) {
    return ['--since', `${date} 00:00:00`, '--until', `${date} 23:59:59`];
  }
  const h = Math.min(Math.max(Number(hours) || 24, 1), 8760);
  return ['--since', `${h} hours ago`];
}

function parseSinceArgs(options = {}) {
  if (options.from && options.to) {
    return {
      gitSinceArgs: parseSinceGitArgs({ from: options.from, to: options.to }),
      logArgs: `--since="${options.from} 00:00:00" --until="${options.to} 23:59:59"`,
      sqlFrom: `${options.from} 00:00:00`,
      sqlTo: `${options.to} 23:59:59`,
      label: `${options.from} → ${options.to}`,
      mode: 'custom_range',
    };
  }
  if (options.date) {
    return {
      gitSinceArgs: parseSinceGitArgs({ date: options.date }),
      logArgs: `--since="${options.date} 00:00:00" --until="${options.date} 23:59:59"`,
      sqlFrom: `${options.date} 00:00:00`,
      sqlTo: `${options.date} 23:59:59`,
      label: options.date,
      mode: 'calendar_day',
    };
  }
  const h = Math.min(Math.max(Number(options.hours) || 24, 1), 8760);
  const sqlFrom = options.since
    || new Date(Date.now() - h * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  return {
    gitSinceArgs: parseSinceGitArgs({ hours: h }),
    logArgs: `--since="${h} hours ago"`,
    sqlFrom,
    sqlTo: null,
    label: `Last ${h} hours`,
    mode: 'rolling',
    hours: h,
  };
}

/** Skip per-commit git show/name-rev for wide windows — those N×2 shell calls dominate 6m reports. */
function isLightweightGitWindow(window) {
  if (!window) return false;
  if (window.hours && window.hours > 720) return true;
  if (window.mode === 'custom_range' && window.sqlFrom && window.sqlTo) {
    const spanDays = (new Date(window.sqlTo) - new Date(window.sqlFrom)) / 86400000;
    return spanDays > 30;
  }
  return false;
}

function fetchCommitsForRepo(repoTarget, windowOrLogArgs, opts = {}) {
  const gitSinceArgs = Array.isArray(windowOrLogArgs)
    ? windowOrLogArgs
    : parseSinceGitArgs({ hours: 24 });
  const lightweight = opts.lightweight === true;

  const out = gitExec(repoTarget, [
    'log',
    ...gitSinceArgs,
    lightweight
      ? '--pretty=format:%H|%h|%an|%aI|%s|%D'
      : '--pretty=format:%H|%h|%an|%aI|%s',
    '--no-merges',
  ], lightweight ? 45000 : 20000);
  if (!out) return [];

  return out.split('\n').filter(Boolean).map((line) => {
    const parts = line.split('|');
    const [fullHash, shortHash, author, timestamp, message] = parts;
    let branch = 'main';
    if (lightweight) {
      branch = parseBranchFromDecorations(parts[5] || '');
      if (branch === 'unknown' || branch === 'detached') branch = 'main';
    } else {
      try {
        const nameRev = gitExec(repoTarget, ['name-rev', '--name-only', fullHash]);
        branch = nameRev
          .replace(/^remotes\/origin\//, '')
          .replace(/~\d+$/, '')
          .split('^')[0]
          .trim() || 'main';
        if (branch === 'HEAD') branch = 'main';
      } catch {
        branch = 'unknown';
      }
    }
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    if (!lightweight) {
      try {
        const stat = gitExec(repoTarget, ['show', '--shortstat', '--format=', fullHash]);
        const fm = stat.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
        if (fm) {
          filesChanged = Number(fm[1]) || 0;
          insertions = Number(fm[2]) || 0;
          deletions = Number(fm[3]) || 0;
        }
      } catch {
        // ignore per-commit stat failures
      }
    }

    return {
      full_hash: fullHash,
      sha: shortHash,
      author,
      timestamp,
      message,
      branch,
      files_changed: filesChanged,
      insertions,
      deletions,
      repo_target: repoTarget,
    };
  });
}

function fetchRepoSnapshot(repoTarget) {
  if (!repoAvailable(repoTarget)) {
    return { repo_target: repoTarget, available: false };
  }

  const branch = gitExec(repoTarget, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';
  const statusLines = gitExec(repoTarget, ['status', '--porcelain']);
  const uncommitted = statusLines ? statusLines.split('\n').filter(Boolean) : [];
  let ahead = 0;
  let behind = 0;
  try {
    const ab = gitExec(repoTarget, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    const [a, b] = ab.split(/\s+/).map(Number);
    ahead = a || 0;
    behind = b || 0;
  } catch {
    // no upstream
  }

  let lastCommit = null;
  try {
    const lc = gitExec(repoTarget, ['log', '-1', '--pretty=format:%H|%h|%s|%aI']);
    const [full, short, message, at] = lc.split('|');
    lastCommit = { full_hash: full, sha: short, message, timestamp: at };
  } catch {
    lastCommit = null;
  }

  let deploy = null;
  if (repoTarget === 'orthodoxmetrics') {
    try {
      const deployPath = path.join(GIT_REPO_ROOTS.orthodoxmetrics, '.last-deploy.json');
      if (fs.existsSync(deployPath)) {
        deploy = JSON.parse(fs.readFileSync(deployPath, 'utf-8'));
      }
    } catch {
      deploy = null;
    }
  }

  return {
    repo_target: repoTarget,
    available: true,
    label: getRepoMeta(repoTarget).label,
    current_branch: branch,
    uncommitted_count: uncommitted.length,
    uncommitted_files: uncommitted.slice(0, 12).map((l) => ({
      status: l.substring(0, 2).trim(),
      file: l.substring(3),
    })),
    ahead,
    behind,
    last_commit: lastCommit,
    last_deploy: deploy
      ? {
          commit: deploy.head_commit_short || deploy.head_commit,
          at: deploy.deployed_at,
          target: deploy.deploy_target,
          by: deploy.deployed_by,
        }
      : null,
  };
}

async function fetchChangeSets() {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT id, code, title, status, git_branch, priority, change_type,
            staging_commit_sha, prod_commit_sha, updated_at, created_at
     FROM change_sets
     WHERE status NOT IN ('rolled_back')
       AND (updated_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
            OR status IN ('draft','active','ready_for_staging','staged','in_review','approved'))
     ORDER BY updated_at DESC
     LIMIT 100`,
  );
  return rows;
}

async function fetchChangeSetItems(changeSetIds) {
  if (!changeSetIds.length) return new Map();
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT csi.change_set_id, csi.om_daily_item_id
     FROM change_set_items csi
     WHERE csi.change_set_id IN (${changeSetIds.map(() => '?').join(',')})`,
    changeSetIds,
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.change_set_id)) map.set(row.change_set_id, []);
    map.get(row.change_set_id).push(row.om_daily_item_id);
  }
  return map;
}

async function fetchDailyItems(sinceSqlFrom) {
  let pool;
  try {
    pool = getOmaiPool();
  } catch {
    return [];
  }
  try {
    const [rows] = await pool.query(
      `SELECT id, title, status, priority, category, repo_target, github_branch,
              updated_at, created_at, completed_at
       FROM om_daily_items
       WHERE status != 'cancelled'
         AND (updated_at >= ? OR created_at >= ?)
       ORDER BY updated_at DESC
       LIMIT 200`,
      [sinceSqlFrom, sinceSqlFrom],
    );
    return rows;
  } catch (err) {
    console.warn('[GitReport] om_daily_items:', err.message);
    return [];
  }
}

async function fetchDailyItemsByIds(ids) {
  if (!ids.length) return [];
  let pool;
  try {
    pool = getOmaiPool();
  } catch {
    return [];
  }
  try {
    const [rows] = await pool.query(
      `SELECT id, title, status, priority, repo_target, github_branch, updated_at
       FROM om_daily_items WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    return rows;
  } catch {
    return [];
  }
}

async function fetchWorkSessions(sinceSqlFrom) {
  const pool = getAppPool();
  try {
    const [rows] = await pool.query(
      `SELECT id, user_id, repo_target, work_focus, daily_item_id, started_at, ended_at,
              duration_seconds, status, summary_note, om_daily_session_id, start_context
       FROM work_sessions
       WHERE started_at >= ?
       ORDER BY started_at DESC
       LIMIT 100`,
      [sinceSqlFrom],
    );
    return rows.map((row) => {
      let ctx = row.start_context;
      if (typeof ctx === 'string') {
        try { ctx = JSON.parse(ctx); } catch { ctx = null; }
      }
      return {
        ...row,
        start_context: ctx,
        github_branch: ctx?.github_branch || null,
        commits_during_session: ctx?.commits_during_session || [],
        change_set_code: ctx?.change_set_code || null,
        daily_item_title: ctx?.daily_item_title || null,
      };
    });
  } catch {
    return [];
  }
}

function inferWorkStatus({ branch, changeSet, commits, snapshot, onMain }) {
  if (snapshot?.uncommitted_count > 0 && commits.length === 0) return 'uncommitted';
  if (changeSet?.status === 'promoted' || (onMain && commits.length > 0)) return 'deployed';
  if (changeSet?.status === 'rejected') return 'blocked';
  if (['in_review', 'staged', 'approved', 'ready_for_staging'].includes(changeSet?.status)) return 'in_review';
  if (commits.length === 1 && branch !== 'main') return 'started';
  if (commits.length > 0 || ACTIVE_CS_STATUSES.has(changeSet?.status)) return 'in_progress';
  return 'idle';
}

function statusLabel(status) {
  const map = {
    deployed: 'Deployed / on main',
    in_progress: 'In progress',
    started: 'Started today',
    in_review: 'In review / staging',
    blocked: 'Blocked',
    uncommitted: 'Uncommitted local work',
    idle: 'Idle',
  };
  return map[status] || status;
}

function buildFollowUps({ snapshot, changeSet, dailyItems, branch, commits }) {
  const items = [];
  if (snapshot?.uncommitted_count > 0) {
    items.push(`Commit or stash ${snapshot.uncommitted_count} uncommitted file(s) on ${snapshot.current_branch}`);
  }
  if (snapshot?.ahead > 0) {
    items.push(`Push ${snapshot.ahead} commit(s) on ${branch || snapshot.current_branch} to origin`);
  }
  if (snapshot?.behind > 0) {
    items.push(`Pull/rebase — branch is ${snapshot.behind} commit(s) behind origin`);
  }
  if (changeSet?.status === 'in_review') {
    items.push(`Complete review for ${changeSet.code}`);
  }
  if (changeSet?.status === 'staged') {
    items.push(`Promote ${changeSet.code} to production when validated`);
  }
  if (changeSet?.status === 'active' && !commits.length) {
    items.push(`No git commits linked to ${changeSet.code} in this period — verify branch ${changeSet.git_branch || '(unset)'}`);
  }
  for (const item of dailyItems) {
    if (item.status === 'blocked') {
      items.push(`Unblock OM Daily #${item.id}: ${item.title}`);
    } else if (['backlog', 'in_progress', 'review'].includes(item.status)) {
      items.push(`OM Daily #${item.id} still ${item.status.replace('_', ' ')}: ${item.title}`);
    }
  }
  if (branch && branch !== 'main' && commits.length > 0 && !changeSet) {
    items.push(`Link branch ${branch} to a change set or OM Daily item for traceability`);
  }
  if (commits.length > 0 && branch === 'main' && snapshot?.last_deploy?.commit) {
    const latest = commits[0]?.sha;
    if (latest && snapshot.last_deploy.commit && !String(snapshot.last_deploy.commit).startsWith(latest)) {
      items.push(`Latest main commit ${latest} may not be deployed yet (prod @ ${snapshot.last_deploy.commit})`);
    }
  }
  return [...new Set(items)];
}

function groupKey(repoTarget, branch) {
  return `${repoTarget}::${branch || 'main'}`;
}

async function buildGitAccountabilityReport(options = {}) {
  const window = parseSinceArgs(options);
  const lightweight = options.lightweight === true || isLightweightGitWindow(window);

  if (options.backfill !== false && !lightweight) {
    try {
      const { backfillWorkSessions } = require('./workSessionBackfillService');
      await backfillWorkSessions({
        since: window.sqlFrom,
        hours: window.hours,
        dryRun: false,
      });
    } catch (err) {
      console.warn('[GitReport] session backfill skipped:', err.message);
    }
  }

  const repoTargets = Object.keys(GIT_REPO_ROOTS).filter(repoAvailable);

  const snapshots = {};
  const allCommits = [];
  for (const repo of repoTargets) {
    snapshots[repo] = fetchRepoSnapshot(repo);
    allCommits.push(...fetchCommitsForRepo(repo, window.gitSinceArgs, { lightweight }));
  }

  allCommits.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  let agentActivity = { sessions: [], totals: { sessions: 0 }, source_status: [] };
  try {
    agentActivity = scanAgentActivity({
      since: window.sqlFrom,
      until: window.sqlTo || new Date().toISOString().slice(0, 19).replace('T', ' '),
      hours: window.hours,
    });
  } catch (err) {
    console.warn('[GitReport] agent activity scan skipped:', err.message);
  }

  const [changeSets, workSessions, dailyItemsRecent] = await Promise.all([
    fetchChangeSets(),
    fetchWorkSessions(window.sqlFrom),
    fetchDailyItems(window.sqlFrom),
  ]);

  const csItemMap = await fetchChangeSetItems(changeSets.map((cs) => cs.id));
  const linkedItemIds = [...new Set([...csItemMap.values()].flat())];
  const linkedDailyItems = await fetchDailyItemsByIds(linkedItemIds);
  const dailyById = new Map();
  for (const item of [...dailyItemsRecent, ...linkedDailyItems]) {
    dailyById.set(item.id, item);
  }

  const groups = new Map();

  const ensureGroup = (key, seed) => {
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        repo_target: seed.repo_target,
        branch: seed.branch,
        title: seed.title,
        change_set: null,
        daily_items: [],
        commits: [],
        work_sessions: [],
        agent_sessions: [],
        snapshot: snapshots[seed.repo_target] || null,
        started_at: null,
        last_activity_at: null,
        status: 'idle',
        status_label: '',
        follow_ups: [],
      });
    }
    return groups.get(key);
  };

  for (const cs of changeSets) {
    const repo = 'orthodoxmetrics';
    const branch = cs.git_branch || `change-set/${cs.code.toLowerCase()}`;
    const key = groupKey(repo, branch);
    const g = ensureGroup(key, {
      repo_target: repo,
      branch,
      title: `${cs.code}: ${cs.title}`,
    });
    g.change_set = {
      id: cs.id,
      code: cs.code,
      title: cs.title,
      status: cs.status,
      git_branch: cs.git_branch,
      prod_commit_sha: cs.prod_commit_sha,
      updated_at: cs.updated_at,
    };
    const itemIds = csItemMap.get(cs.id) || [];
    for (const id of itemIds) {
      const item = dailyById.get(id);
      if (item && !g.daily_items.some((d) => d.id === item.id)) {
        g.daily_items.push(item);
      }
    }
  }

  for (const commit of allCommits) {
    const branch = commit.branch === 'detached' ? 'main' : commit.branch;
    const key = groupKey(commit.repo_target, branch);
    const g = ensureGroup(key, {
      repo_target: commit.repo_target,
      branch,
      title: branch === 'main'
        ? `${getRepoMeta(commit.repo_target).label} — main`
        : `${getRepoMeta(commit.repo_target).label} — ${branch}`,
    });
    g.commits.push(commit);
    if (!g.started_at || commit.timestamp < g.started_at) g.started_at = commit.timestamp;
    if (!g.last_activity_at || commit.timestamp > g.last_activity_at) g.last_activity_at = commit.timestamp;
  }

  for (const session of workSessions) {
    const repo = session.repo_target || 'orthodoxmetrics';
    const branch = session.github_branch
      || snapshots[repo]?.current_branch
      || 'main';
    const key = groupKey(repo, branch);
    const title = session.work_focus
      || session.daily_item_title
      || session.summary_note?.slice(0, 120)
      || `${getRepoMeta(repo).label} — timer session`;
    const g = ensureGroup(key, {
      repo_target: repo,
      branch,
      title,
    });
    const { formatDuration } = require('./workSessionConstants');
    g.work_sessions.push({
      ...session,
      duration_formatted: session.duration_seconds
        ? formatDuration(session.duration_seconds)
        : null,
    });
    const at = session.started_at;
    if (!g.started_at || at < g.started_at) g.started_at = at;
    if (!g.last_activity_at || at > g.last_activity_at) g.last_activity_at = at;
    if (session.daily_item_id) {
      const item = dailyById.get(session.daily_item_id);
      if (item && !g.daily_items.some((d) => d.id === item.id)) g.daily_items.push(item);
    }
  }

  for (const repo of repoTargets) {
    const snap = snapshots[repo];
    if (snap?.uncommitted_count > 0) {
      const key = groupKey(repo, snap.current_branch);
      const g = ensureGroup(key, {
        repo_target: repo,
        branch: snap.current_branch,
        title: `${getRepoMeta(repo).label} — uncommitted on ${snap.current_branch}`,
      });
      g.snapshot = snap;
    }
  }

  for (const agentSession of agentActivity.sessions || []) {
    const repo = agentSession.repo_target || 'unknown';
    const branch = snapshots[repo]?.current_branch || 'main';
    const key = groupKey(repo, branch);
    const g = ensureGroup(key, {
      repo_target: repo,
      branch,
      title: agentSession.title || `${getRepoMeta(repo).label} — agent session`,
    });
    g.agent_sessions.push({
      session_id: agentSession.session_id,
      platform: agentSession.platform,
      platform_label: agentSession.platform_label,
      title: agentSession.title,
      started_at: agentSession.started_at,
      ended_at: agentSession.ended_at,
      prompt_count: agentSession.prompt_count,
      tool_call_count: agentSession.tool_call_count,
      tools: agentSession.tools,
      source_type: agentSession.source_type,
    });
    const at = agentSession.ended_at || agentSession.started_at;
    if (!g.started_at || agentSession.started_at < g.started_at) g.started_at = agentSession.started_at;
    if (!g.last_activity_at || at > g.last_activity_at) g.last_activity_at = at;
  }

  const workItems = [];
  for (const g of groups.values()) {
    g.commits.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const onMain = g.branch === 'main' || g.branch === 'master';
    g.status = inferWorkStatus({
      branch: g.branch,
      changeSet: g.change_set,
      commits: g.commits,
      snapshot: g.snapshot,
      onMain,
    });
    g.status_label = statusLabel(g.status);
    g.follow_ups = buildFollowUps({
      snapshot: g.snapshot,
      changeSet: g.change_set,
      dailyItems: g.daily_items,
      branch: g.branch,
      commits: g.commits,
    });
    if (
      g.commits.length
      || g.change_set
      || g.work_sessions.length
      || g.agent_sessions.length
      || g.snapshot?.uncommitted_count
    ) {
      workItems.push(g);
    }
  }

  workItems.sort((a, b) => {
    const order = { uncommitted: 0, blocked: 1, in_review: 2, in_progress: 3, started: 4, deployed: 5, idle: 6 };
    const diff = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (diff !== 0) return diff;
    return new Date(b.last_activity_at || 0) - new Date(a.last_activity_at || 0);
  });

  const totals = {
    commits: allCommits.length,
    repos_active: repoTargets.filter((r) => allCommits.some((c) => c.repo_target === r)).length,
    work_items: workItems.length,
    change_sets_active: changeSets.filter((cs) => ACTIVE_CS_STATUSES.has(cs.status)).length,
    uncommitted_repos: repoTargets.filter((r) => snapshots[r]?.uncommitted_count > 0).length,
    authors: [...new Set(allCommits.map((c) => c.author))],
    agent_sessions: agentActivity.totals?.sessions || 0,
  };

  return {
    generated_at: new Date().toISOString(),
    window,
    totals,
    repo_snapshots: repoTargets.map((r) => snapshots[r]),
    work_items: workItems,
    recent_commits: allCommits.slice(0, 50),
    orphan_daily_items: dailyItemsRecent.filter(
      (item) => !workItems.some((w) => w.daily_items.some((d) => d.id === item.id)),
    ).slice(0, 20),
    agent_activity: {
      totals: agentActivity.totals,
      source_status: agentActivity.source_status,
      sessions: (agentActivity.sessions || []).slice(0, 100),
    },
  };
}

module.exports = {
  GIT_REPO_ROOTS,
  repoAvailable,
  isLightweightGitWindow,
  buildGitAccountabilityReport,
  fetchCommitsForRepo,
};
