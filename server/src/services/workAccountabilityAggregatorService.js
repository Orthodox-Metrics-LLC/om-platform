/**
 * Work Accountability Aggregator — normalized accountability threads across fleet data sources.
 * Wraps existing git report / agent scan services; uses Promise.allSettled for partial failure.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getAppPool, getOmaiPool } = require('../config/db');
const { getRepoMeta, formatDuration } = require('./workSessionConstants');
const {
  GIT_REPO_ROOTS,
  repoAvailable,
  buildGitAccountabilityReport,
} = require('./workAccountabilityGitService');
const { scanAgentActivity } = require('./workAccountabilityAgentSourcesService');
const { resolveWorkAccountabilityRange } = require('./workAccountabilityRange');
const {
  fetchDailyItemsForAnalytics,
  attachCompletionEvents,
  resolveCompletionTimestamp,
  completionDataQuality,
} = require('./workAccountabilityItemsRepository');

const GOVERNED_BRANCH_RE = /^(feature|fix|chore|docs)\/(omd|omod|omad|omsd)-\d+\/\d{4}-\d{2}-\d{2}\/[a-z0-9-]+$/i;
const WORK_ITEM_IN_BRANCH_RE = /(?:omd|omod|omad|omsd)-(\d+)/i;

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const AGG_CACHE_TTL_MS = 90_000;
const aggCache = new Map();

function aggregationCacheKey(window, options = {}) {
  return JSON.stringify({
    mode: window.mode,
    from: window.from,
    to: window.to,
    hours: window.hours || null,
    repo: options.repo || null,
    agent: options.agent || null,
    backfill: options.backfill !== false,
    includeArchivedCompleted: options.includeArchivedCompleted !== false,
  });
}

function getCachedAggregation(key) {
  const entry = aggCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > AGG_CACHE_TTL_MS) {
    aggCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedAggregation(key, data) {
  aggCache.set(key, { ts: Date.now(), data });
  if (aggCache.size > 24) {
    const oldest = [...aggCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) aggCache.delete(oldest[0]);
  }
}

function parseWindow(options = {}) {
  const r = resolveWorkAccountabilityRange({
    range: options.range,
    period: options.period,
    hours: options.hours,
    from: options.from,
    to: options.to,
  });
  const sqlFrom = r.start.toISOString().slice(0, 19).replace('T', ' ');
  return {
    from: r.from,
    to: r.to,
    // Rolling + calendar windows stay open-ended (sqlTo=null) so rows up to "now"
    // are included and reconcile exactly with the Exceptions Inbox / Overview KPIs.
    // Calendar windows anchor sqlFrom to the first day of the earliest month, so
    // earlier-month completions are captured. Custom windows are day-truncated at both ends.
    sqlFrom,
    sqlTo: r.mode === 'custom' ? `${r.to} 23:59:59` : null,
    hours: r.mode === 'rolling' ? r.hours : undefined,
    bucket: r.bucket,
    preset: r.preset,
    label: r.label,
    mode: r.mode,
    months: r.months || null,
    start: r.start,
    end: r.end,
  };
}

function threadKey(repo, branch) {
  return `${repo || 'unknown'}::${branch || 'main'}`;
}

function itemThreadKey(itemId) {
  return `item::${itemId}`;
}

function hashExceptionId(type, ref) {
  return crypto.createHash('sha256').update(`${type}::${ref}`).digest('hex').slice(0, 32);
}

function extractWorkItemIdFromBranch(branch) {
  if (!branch) return null;
  const m = branch.match(WORK_ITEM_IN_BRANCH_RE);
  return m ? Number(m[1]) : null;
}

function workItemPrefix(repoTarget) {
  const map = {
    orthodoxmetrics: 'OMOD',
    omai: 'OMAD',
    omstudio: 'OMSD',
  };
  return map[repoTarget] || 'OMD';
}

function formatWorkItemRef(item) {
  if (!item?.id) return null;
  const prefix = workItemPrefix(item.repo_target);
  return {
    id: item.id,
    code: `${prefix}-${item.id}`,
    title: item.title,
    status: item.status,
    repo_target: item.repo_target,
    github_branch: item.github_branch,
    github_pr_number: item.github_pr_number || null,
    github_pr_url: item.github_pr_url || null,
    github_pr_state: item.github_pr_state || null,
    agent_tool: item.agent_tool || item.assigned_agent || null,
    updated_at: item.updated_at,
    created_at: item.created_at,
    completed_at: item.completed_at,
    completed_at_source: item.completed_at_source || null,
    github_pr_merged_at: item.github_pr_merged_at || null,
    // Completion-EVENT fallback timestamp (populated by attachCompletionEvents
    // only when completed_at + github_pr_merged_at are both missing).
    completion_event_at: item.completion_event_at || null,
    completion_event_type: item.completion_event_type || null,
    archived: item.archived_at != null,
    archived_at: item.archived_at || null,
  };
}

/**
 * Resolve the *actual completion timestamp* of a work item. Thin wrapper around
 * the shared repository resolver so the aggregator, bucketing, and KPI code all
 * use ONE completion-priority definition:
 *
 *   completed_at → github_pr_merged_at → completion EVENT timestamp → null
 *
 * We never treat `updated_at` or `archived_at` as a completion date. Inferred
 * completions (completed_at_source = 'inferred_from_updated_at') surface as
 * `inferred: true` so the UI can flag them.
 *
 * @returns {{ts: (string|Date|null), inferred: boolean, field: (string|null)}}
 */
function workItemCompletion(wi) {
  return resolveCompletionTimestamp(wi);
}

/** True when `ts` falls inside the resolved [start, end] window. */
function isWithinWindow(ts, start, end) {
  if (!ts || !start || !end) return false;
  const d = new Date(ts).getTime();
  if (Number.isNaN(d)) return false;
  return d >= new Date(start).getTime() && d <= new Date(end).getTime();
}

/** Count work items whose completion timestamp lands inside the window. */
function completedInWindow(threads, start, end) {
  let count = 0;
  for (const t of threads) {
    if (t.work_item?.status !== 'done') continue;
    const { ts } = workItemCompletion(t.work_item);
    if (isWithinWindow(ts, start, end)) count += 1;
  }
  return count;
}

function computeConfidence(thread) {
  let score = 0;
  if (thread.work_item) score += 3;
  if (thread.session) score += 2;
  if (thread.commits?.length) score += 2;
  if (thread.pr?.number) score += 2;
  if (thread.timer_sessions?.length) score += 1;
  if (thread.transcripts?.length) score += 1;
  if (thread.change_sets?.length) score += 1;
  if (score >= 8) return 'exact';
  if (score >= 5) return 'strong';
  if (score >= 3) return 'medium';
  if (score >= 1) return 'weak';
  return 'unknown';
}

function inferSeverity(status, exceptions) {
  const types = new Set(exceptions.map((e) => e.type));
  if (types.has('direct_commit_to_main') || types.has('detached_head_deploy')) return 'critical';
  if (types.has('branch_without_governed_session') || types.has('pr_merged_session_open')) return 'high';
  if (types.has('commit_without_work_item') || types.has('timer_session_divergence')) return 'medium';
  if (exceptions.length) return 'low';
  if (status === 'blocked') return 'high';
  if (status === 'in_review') return 'medium';
  return 'info';
}

async function settled(name, fn) {
  try {
    const value = await fn();
    return { name, status: 'fulfilled', value };
  } catch (err) {
    console.warn(`[work-accountability] ${name} failed:`, err.message);
    return { name, status: 'rejected', error: err.message };
  }
}

/**
 * Fetch work items for the accountability window via the shared repository.
 *
 * @param {string} sqlFrom
 * @param {string|null} sqlTo
 * @param {number} limit
 * @param {boolean} includeArchivedCompleted - true for historical/completion
 *   analytics (archived-completed items included); false excludes archived rows.
 */
async function fetchDailyItems(sqlFrom, sqlTo = null, limit = 300, includeArchivedCompleted = true) {
  let pool;
  try {
    pool = getOmaiPool();
  } catch {
    return [];
  }
  const rows = await fetchDailyItemsForAnalytics(pool, {
    sqlFrom,
    sqlTo,
    limit,
    includeArchivedCompleted,
  });
  // Recover completion timestamps for Done items missing completed_at + PR-merge
  // from the om_daily_item_events history so they still bucket into the right month.
  await attachCompletionEvents(pool, rows);
  return rows;
}

async function fetchGovernedSessions(sqlFrom) {
  let pool;
  try {
    pool = getOmaiPool();
  } catch {
    return [];
  }
  const [rows] = await pool.query(
    `SELECT s.id, s.item_id, s.repo_target AS repo_name, s.branch_type, s.status,
            s.agent_tool, s.started_at, s.stopped_at AS closed_at,
            s.github_branch, s.duration_seconds
     FROM om_daily_work_sessions s
     WHERE s.started_at >= ?
     ORDER BY s.started_at DESC
     LIMIT 500`,
    [sqlFrom],
  );
  return rows;
}

async function fetchItemEvents(sqlFrom) {
  let pool;
  try {
    pool = getOmaiPool();
  } catch {
    return [];
  }
  const [rows] = await pool.query(
    `SELECT id, item_id, event_type, actor AS actor_type, metadata AS metadata_json, created_at
     FROM om_daily_item_events
     WHERE created_at >= ?
     ORDER BY created_at DESC
     LIMIT 500`,
    [sqlFrom],
  );
  return rows.map((r) => {
    let meta = r.metadata_json;
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch { meta = null; }
    }
    return { ...r, metadata_json: meta };
  });
}

async function fetchTimerSessions(sqlFrom) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT id, user_id, repo_target, daily_item_id, work_focus, om_daily_session_id,
            started_at, ended_at, duration_seconds, status, summary_note, start_context
     FROM work_sessions
     WHERE started_at >= ?
     ORDER BY started_at DESC
     LIMIT 300`,
    [sqlFrom],
  );
  return rows.map((row) => {
    let ctx = row.start_context;
    if (typeof ctx === 'string') {
      try { ctx = JSON.parse(ctx); } catch { ctx = null; }
    }
    return { ...row, start_context: ctx, github_branch: ctx?.github_branch || null };
  });
}

async function fetchChangeSets(sqlFrom) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT id, code, title, status, git_branch, priority, change_type,
            staging_commit_sha, prod_commit_sha, updated_at, created_at
     FROM change_sets
     WHERE updated_at >= ? OR status IN ('draft','active','ready_for_staging','staged','in_review','approved')
     ORDER BY updated_at DESC
     LIMIT 150`,
    [sqlFrom],
  );
  return rows;
}

async function fetchPromptPlans(sqlFrom) {
  const pool = getAppPool();
  try {
    const [rows] = await pool.query(
      `SELECT id, title, status, agent_tool, change_set_code, created_at, updated_at
       FROM prompt_plans
       WHERE updated_at >= ? OR status IN ('active','draft','paused')
       ORDER BY updated_at DESC
       LIMIT 100`,
      [sqlFrom],
    );
    return rows;
  } catch {
    return [];
  }
}

async function fetchDocsPickup(sqlFrom) {
  const pool = getAppPool();
  try {
    const [rows] = await pool.query(
      `SELECT id, original_filename, status, source_path, word_count, uploaded_at, picked_up_at
       FROM docs_pickup_files
       WHERE uploaded_at >= ? OR picked_up_at >= ?
       ORDER BY uploaded_at DESC
       LIMIT 100`,
      [sqlFrom, sqlFrom],
    );
    return rows;
  } catch {
    return [];
  }
}

async function fetchBrainEvents(sqlFrom) {
  const url = process.env.OMBRAIN_EVENTS_URL || 'http://127.0.0.1:8390/audit/findings?limit=50';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.findings || data.events || []);
    return items.slice(0, 50).map((e) => ({
      event_type: e.event_type || e.type || 'brain_event',
      source: e.source || 'ombrain',
      summary: (e.summary || e.message || e.title || '').slice(0, 200),
      at: e.timestamp || e.created_at || e.at,
    }));
  } catch {
    return [];
  }
}

async function fetchExceptionReviews() {
  const pool = getAppPool();
  try {
    const [rows] = await pool.query(
      `SELECT exception_id, exception_type, status, reviewed_by, reviewed_at,
              snooze_until, note, updated_at
       FROM work_accountability_exception_reviews
       WHERE status != 'open' OR snooze_until IS NULL OR snooze_until > NOW()`,
    );
    const map = new Map();
    for (const row of rows) map.set(row.exception_id, row);
    return map;
  } catch {
    return new Map();
  }
}

function readDeployMetadata() {
  try {
    const p = path.join(GIT_REPO_ROOTS.orthodoxmetrics, '.last-deploy.json');
    if (!fs.existsSync(p)) return { present: false, data: null };
    return { present: true, data: JSON.parse(fs.readFileSync(p, 'utf-8')) };
  } catch {
    return { present: false, data: null };
  }
}

function loadFeatureRegistryRoutes() {
  try {
    const registryPath = path.join(
      __dirname,
      '../../../front-end/src/config/featureRegistry.ts',
    );
    const src = fs.readFileSync(registryPath, 'utf-8');
    const routes = new Set();
    const re = /route:\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(src))) routes.add(m[1]);
    return routes;
  } catch {
    return new Set();
  }
}

function redactTranscript(t) {
  return {
    session_id: t.session_id,
    platform: t.platform,
    platform_label: t.platform_label,
    title: (t.title || '').slice(0, 200),
    started_at: t.started_at,
    ended_at: t.ended_at,
    prompt_count: t.prompt_count,
    tool_call_count: t.tool_call_count,
    tools: (t.tools || []).slice(0, 15),
    source_type: t.source_type,
    confidence: t.confidence || 'medium',
  };
}

function detectExceptions(ctx) {
  const exceptions = [];
  const {
    thread, governedSessionsByBranch, branchesWithSession, deployMeta,
    featureRoutes, gitSnapshots,
  } = ctx;

  const branch = thread.branch;
  const repo = thread.repo;
  const item = thread.work_item;

  if (branch && branch !== 'main' && GOVERNED_BRANCH_RE.test(branch)) {
    const hasSession = branchesWithSession.has(`${repo}::${branch}`);
    if (!hasSession) {
      exceptions.push({
        type: 'branch_without_governed_session',
        severity: 'high',
        message: `Branch ${branch} matches governed pattern but has no om_daily_work_sessions row`,
      });
    }
  }

  if (thread.commits?.length && !item && !extractWorkItemIdFromBranch(branch)) {
    exceptions.push({
      type: 'commit_without_work_item',
      severity: 'medium',
      message: `Commits on ${branch} without linked work item`,
    });
  }

  if (item && ['in_progress', 'self_review'].includes(item.status) && !thread.commits?.length) {
    exceptions.push({
      type: 'work_item_in_progress_no_commits',
      severity: 'medium',
      message: `${item.code} is ${item.status} but no commits in window`,
    });
  }

  if (item?.github_pr_state === 'merged' && thread.session?.status === 'active') {
    exceptions.push({
      type: 'pr_merged_session_open',
      severity: 'high',
      message: `PR merged for ${item.code} but governed session still open`,
    });
  }

  if (item?.status === 'done' && branch && branch !== 'main' && GOVERNED_BRANCH_RE.test(branch)) {
    exceptions.push({
      type: 'work_item_done_branch_exists',
      severity: 'low',
      message: `${item.code} is done but branch ${branch} may still exist`,
    });
  }

  const timerIds = new Set((thread.timer_sessions || []).map((t) => t.om_daily_session_id).filter(Boolean));
  if (thread.session && thread.timer_sessions?.length) {
    const linked = timerIds.has(thread.session.id);
    if (!linked && thread.timer_sessions.length > 0) {
      exceptions.push({
        type: 'timer_session_divergence',
        severity: 'medium',
        message: 'Timer sessions exist without matching governed om_daily_session_id',
      });
    }
  }

  if (branch === 'main' && thread.commits?.some((c) => !/merge pull request/i.test(c.message))) {
    const snap = gitSnapshots?.[repo];
    if (snap?.current_branch === 'main') {
      exceptions.push({
        type: 'direct_commit_to_main',
        severity: 'critical',
        message: `Direct commits to main on ${getRepoMeta(repo).label}`,
      });
    }
  }

  const snap = gitSnapshots?.[repo];
  if (snap?.current_branch?.startsWith('(') || snap?.current_branch === 'HEAD') {
    exceptions.push({
      type: 'detached_head_deploy',
      severity: 'critical',
      message: `Detached HEAD on ${getRepoMeta(repo).label} deploy tree`,
    });
  }

  if (repo === 'orthodoxmetrics' && deployMeta && !deployMeta.present) {
    exceptions.push({
      type: 'missing_last_deploy_json',
      severity: 'medium',
      message: 'Missing .last-deploy.json in prod deploy tree',
    });
  }

  if (thread.transcripts?.length && computeConfidence(thread) === 'weak') {
    exceptions.push({
      type: 'weak_transcript_match',
      severity: 'low',
      message: 'Agent transcript overlap is time-based only (weak confidence)',
    });
  }

  if (repo === 'om-workshop' || branch?.startsWith('workshop/')) {
    exceptions.push({
      type: 'om_workshop_not_first_class',
      severity: 'info',
      message: 'Workshop branch outside governed OMOD/OMAD namespace',
    });
  }

  const route = '/devel-tools/work-accountability';
  if (featureRoutes.size && !featureRoutes.has(route)) {
    exceptions.push({
      type: 'feature_route_not_in_registry',
      severity: 'low',
      message: 'work-accountability route not registered in featureRegistry.ts',
    });
  }

  return exceptions;
}

function buildThreadsFromSources(sources, filters = {}) {
  const {
    gitReport,
    dailyItems,
    governedSessions,
    timerSessions,
    changeSets,
    promptPlans,
    docs,
    brainEvents,
    itemEvents,
    agentSessions,
    deployMeta,
    featureRoutes,
  } = sources;

  const itemById = new Map(dailyItems.map((i) => [i.id, i]));
  const governedByBranch = new Map();
  const branchesWithSession = new Set();
  for (const s of governedSessions) {
    const branch = s.github_branch || s.branch_name;
    const repo = s.repo_name || s.repo_target || 'orthodoxmetrics';
    const key = `${repo}::${branch}`;
    governedByBranch.set(key, s);
    branchesWithSession.add(key);
  }

  const gitSnapshots = {};
  for (const snap of gitReport?.repo_snapshots || []) {
    gitSnapshots[snap.repo_target] = snap;
  }

  const threads = new Map();

  const ensureThread = (id, seed) => {
    if (!threads.has(id)) {
      threads.set(id, {
        id,
        confidence: 'unknown',
        thread_type: seed.thread_type || 'branch',
        work_item: null,
        repo: seed.repo || 'orthodoxmetrics',
        branch: seed.branch || 'main',
        session: null,
        timer_sessions: [],
        commits: [],
        pr: null,
        deploy: null,
        transcripts: [],
        docs: [],
        brain_events: [],
        change_sets: [],
        prompt_plans: [],
        status: seed.status || 'idle',
        severity: 'info',
        evidence_chain: [],
        missing_links: [],
        follow_up_items: [],
        timestamps: { started_at: null, last_activity_at: null },
        title: seed.title || id,
      });
    }
    return threads.get(id);
  };

  for (const wi of gitReport?.work_items || []) {
    const id = threadKey(wi.repo_target, wi.branch);
    const t = ensureThread(id, {
      repo: wi.repo_target,
      branch: wi.branch,
      title: wi.title,
      status: wi.status,
      thread_type: wi.daily_items?.length ? 'work_item' : 'branch',
    });
    t.commits = wi.commits || [];
    t.follow_up_items = wi.follow_ups || [];
    t.status = wi.status;
    t.timestamps.started_at = wi.started_at;
    t.timestamps.last_activity_at = wi.last_activity_at;
    if (wi.daily_items?.[0]) t.work_item = formatWorkItemRef(wi.daily_items[0]);
    if (wi.change_set) {
      t.change_sets.push({
        id: wi.change_set.id,
        code: wi.change_set.code,
        title: wi.change_set.title,
        status: wi.change_set.status,
        git_branch: wi.change_set.git_branch,
      });
    }
    for (const ws of wi.work_sessions || []) {
      t.timer_sessions.push({
        id: ws.id,
        duration_formatted: ws.duration_formatted,
        work_focus: ws.work_focus,
        status: ws.status,
        om_daily_session_id: ws.om_daily_session_id,
        started_at: ws.started_at,
      });
    }
    for (const ag of wi.agent_sessions || []) {
      t.transcripts.push(redactTranscript({ ...ag, confidence: 'medium' }));
    }
    t.evidence_chain.push({ source: 'git_report', at: gitReport?.generated_at });
  }

  for (const item of dailyItems) {
    const ref = formatWorkItemRef(item);
    const branch = item.github_branch || `item/${item.id}`;
    const repo = item.repo_target || 'orthodoxmetrics';
    const id = item.github_branch ? threadKey(repo, branch) : itemThreadKey(item.id);
    const t = ensureThread(id, {
      repo,
      branch,
      title: `${ref.code}: ${item.title}`,
      thread_type: 'work_item',
      status: item.status,
    });
    t.work_item = ref;
    if (item.github_pr_number) {
      t.pr = {
        number: item.github_pr_number,
        url: item.github_pr_url,
        state: item.github_pr_state,
      };
    }
    const sessKey = item.github_branch ? `${repo}::${item.github_branch}` : null;
    if (sessKey && governedByBranch.has(sessKey)) {
      const gs = governedByBranch.get(sessKey);
      t.session = {
        id: gs.id,
        item_id: gs.item_id,
        status: gs.status,
        agent_tool: gs.agent_tool,
        branch_name: gs.branch_name || gs.github_branch,
        started_at: gs.started_at,
        closed_at: gs.closed_at,
        merged_pr_number: gs.merged_pr_number,
      };
    }
    t.evidence_chain.push({ source: 'om_daily_items', id: item.id, at: item.updated_at });
  }

  for (const cs of changeSets) {
    const branch = cs.git_branch || `change-set/${cs.code.toLowerCase()}`;
    const id = threadKey('orthodoxmetrics', branch);
    const t = ensureThread(id, {
      repo: 'orthodoxmetrics',
      branch,
      title: `${cs.code}: ${cs.title}`,
      thread_type: 'change_set',
      status: cs.status,
    });
    if (!t.change_sets.some((c) => c.code === cs.code)) {
      t.change_sets.push({
        id: cs.id,
        code: cs.code,
        title: cs.title,
        status: cs.status,
        git_branch: cs.git_branch,
      });
    }
  }

  for (const doc of docs) {
    const id = threadKey('orthodoxmetrics', 'docs-pickup');
    const t = ensureThread(id, {
      repo: 'orthodoxmetrics',
      branch: 'docs-pickup',
      title: 'Docs Pickup handoffs',
      thread_type: 'docs',
    });
    t.docs.push({
      id: doc.id,
      filename: doc.original_filename,
      status: doc.status,
      word_count: doc.word_count,
      uploaded_at: doc.uploaded_at,
    });
  }

  for (const ev of itemEvents.slice(0, 100)) {
    const item = itemById.get(ev.item_id);
    if (!item) continue;
    const id = item.github_branch
      ? threadKey(item.repo_target || 'orthodoxmetrics', item.github_branch)
      : itemThreadKey(item.id);
    const t = ensureThread(id, {
      repo: item.repo_target,
      branch: item.github_branch || 'main',
      title: item.title,
      thread_type: 'work_item',
    });
    t.brain_events.push({
      event_type: ev.event_type,
      actor_type: ev.actor_type,
      at: ev.created_at,
      source: 'om_daily_item_events',
    });
  }

  for (const be of brainEvents) {
    const id = threadKey('orthodoxmetrics', 'platform-events');
    const t = ensureThread(id, {
      repo: 'orthodoxmetrics',
      branch: 'platform-events',
      title: 'OMBrain platform events',
      thread_type: 'platform',
    });
    t.brain_events.push(be);
  }

  if (deployMeta?.present && deployMeta.data) {
    const id = threadKey('orthodoxmetrics', 'main');
    const t = ensureThread(id, {
      repo: 'orthodoxmetrics',
      branch: 'main',
      title: 'OrthodoxMetrics — main / deploy',
      thread_type: 'deploy',
    });
    t.deploy = {
      commit: deployMeta.data.head_commit_short || deployMeta.data.head_commit,
      deployed_at: deployMeta.data.deployed_at,
      deploy_target: deployMeta.data.deploy_target,
      deployed_by: deployMeta.data.deployed_by,
      branch: deployMeta.data.branch,
    };
  }

  const allThreads = [...threads.values()];

  for (const t of allThreads) {
    if (!t.work_item) t.missing_links.push('work_item');
    if (!t.session && t.branch && GOVERNED_BRANCH_RE.test(t.branch)) t.missing_links.push('governed_session');
    if (!t.commits?.length && ['in_progress', 'self_review'].includes(t.work_item?.status)) {
      t.missing_links.push('commits');
    }
    if (!t.pr && t.work_item?.github_pr_number) {
      t.pr = {
        number: t.work_item.github_pr_number,
        url: t.work_item.github_pr_url,
        state: t.work_item.github_pr_state,
      };
    }
    const exc = detectExceptions({
      thread: t,
      governedSessionsByBranch: governedByBranch,
      branchesWithSession,
      deployMeta,
      featureRoutes,
      gitSnapshots,
    });
    t.exceptions = exc;
    t.severity = inferSeverity(t.status, exc);
    t.confidence = computeConfidence(t);
  }

  let filtered = allThreads;
  if (filters.repo) {
    filtered = filtered.filter((t) => t.repo === filters.repo);
  }
  if (filters.agent) {
    filtered = filtered.filter(
      (t) => t.session?.agent_tool === filters.agent
        || t.work_item?.agent_tool === filters.agent
        || t.transcripts.some((tr) => tr.platform?.includes(filters.agent)),
    );
  }

  filtered.sort((a, b) => {
    const sd = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
    if (sd !== 0) return sd;
    return new Date(b.timestamps.last_activity_at || 0) - new Date(a.timestamps.last_activity_at || 0);
  });

  return { threads: filtered, gitSnapshots, agentSessions };
}

async function aggregateAccountability(options = {}) {
  const started = Date.now();
  const window = parseWindow(options);
  const filters = {
    repo: options.repo || null,
    agent: options.agent || null,
  };
  // Historical/completion analytics keep archived-completed items (default).
  // Active/current callers can pass includeArchivedCompleted:false to exclude
  // every archived row from the fetched set.
  const includeArchivedCompleted = options.includeArchivedCompleted !== false;

  const cacheKey = aggregationCacheKey(window, options);
  const cached = getCachedAggregation(cacheKey);
  if (cached) {
    console.log(`[work-accountability] aggregate cache hit (${Date.now() - started}ms) ${window.label}`);
    return cached;
  }

  // Calendar windows have no rolling `hours`; derive a representative span so
  // downstream hour-based scans (agent activity, session backfill) cover the full
  // calendar window rather than defaulting to 24h.
  const hours = window.hours
    || (window.start && window.end
      ? Math.max(1, Math.round((new Date(window.end) - new Date(window.start)) / 3600000))
      : 24);
  const wideWindow = window.mode === 'custom' || window.mode === 'calendar' || (window.hours && window.hours > 720);
  // Multi-month windows (>30d) must not truncate the archived-completed backlog.
  // ~700+ Done items get bulk-archived after their month closes; with the old
  // `ceil(hours/6)` heuristic a 6m window capped at LIMIT 732 and — because rows
  // are ORDER BY completed/updated/created DESC — silently dropped the OLDEST
  // completions (Jan–early Apr), so earlier-month completed work never reached the
  // Command Center even though the Schedule page (which fetches archived Done items
  // unbounded) showed the full history. Give 3m/6m/12m/custom the full 2000-row cap
  // (well above the ~760 total in-range items) so completed history is complete;
  // short rolling windows keep the lighter heuristic.
  const itemLimit = wideWindow
    ? 2000
    : Math.min(Math.max(Math.ceil(hours / 6), 300), 2000);
  const gitLightweight = wideWindow || hours > 720;
  const gitOpts = {
    hours: window.mode === 'rolling' ? hours : undefined,
    // Calendar + custom windows drive git by explicit from/to so commit history
    // spans the full calendar window (open-ended --until defaults to now).
    from: (window.mode === 'custom' || window.mode === 'calendar') ? window.from : undefined,
    to: (window.mode === 'custom' || window.mode === 'calendar') ? window.to : undefined,
    date: window.mode === 'calendar_day' ? window.from : undefined,
    backfill: options.backfill !== false,
    lightweight: gitLightweight,
  };

  const results = await Promise.allSettled([
    buildGitAccountabilityReport(gitOpts),
    fetchDailyItems(window.sqlFrom, window.sqlTo, itemLimit, includeArchivedCompleted),
    fetchGovernedSessions(window.sqlFrom),
    fetchTimerSessions(window.sqlFrom),
    fetchChangeSets(window.sqlFrom),
    fetchPromptPlans(window.sqlFrom),
    fetchDocsPickup(window.sqlFrom),
    fetchBrainEvents(window.sqlFrom),
    fetchItemEvents(window.sqlFrom),
    Promise.resolve(scanAgentActivity({ since: window.sqlFrom, hours })),
    Promise.resolve(readDeployMetadata()),
    Promise.resolve(loadFeatureRegistryRoutes()),
    fetchExceptionReviews(),
  ]);

  const pick = (idx, fallback) => (
    results[idx].status === 'fulfilled' ? results[idx].value : fallback
  );

  const sourceErrors = results
    .map((r, i) => (r.status === 'rejected' ? { index: i, error: r.reason?.message } : null))
    .filter(Boolean);

  const gitReport = pick(0, { work_items: [], repo_snapshots: [], totals: {} });
  const agentScan = pick(9, { sessions: [], source_status: [], totals: {} });
  const reviewMap = pick(12, new Map());

  const { threads, gitSnapshots } = buildThreadsFromSources({
    gitReport,
    dailyItems: pick(1, []),
    governedSessions: pick(2, []),
    timerSessions: pick(3, []),
    changeSets: pick(4, []),
    promptPlans: pick(5, []),
    docs: pick(6, []),
    brainEvents: pick(7, []),
    itemEvents: pick(8, []),
    agentSessions: agentScan.sessions || [],
    deployMeta: pick(10, { present: false }),
    featureRoutes: pick(11, new Set()),
  }, filters);

  const flatExceptions = [];
  for (const t of threads) {
    for (const ex of t.exceptions || []) {
      const exceptionId = hashExceptionId(ex.type, `${t.id}::${ex.message}`);
      const review = reviewMap.get(exceptionId);
      if (review?.status === 'snoozed' && review.snooze_until && new Date(review.snooze_until) > new Date()) {
        continue;
      }
      if (review?.status === 'reviewed') {
        ex.review_status = 'reviewed';
        ex.reviewed_at = review.reviewed_at;
      } else {
        ex.review_status = 'open';
      }
      flatExceptions.push({
        id: exceptionId,
        thread_id: t.id,
        thread_title: t.title,
        repo: t.repo,
        branch: t.branch,
        work_item_code: t.work_item?.code || null,
        ...ex,
      });
    }
  }

  flatExceptions.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

  // Completions are counted by their actual completion timestamp falling inside
  // the window (not merely "status===done in the fetched set"), so the KPI card
  // reconciles with the Monthly Completions chart's in-window buckets.
  const workItemsDoneInWindow = completedInWindow(threads, window.start, window.end);

  const kpis = {
    threads: threads.length,
    exceptions_open: flatExceptions.filter((e) => e.review_status === 'open').length,
    exceptions_critical: flatExceptions.filter((e) => e.severity === 'critical' && e.review_status === 'open').length,
    commits: gitReport.totals?.commits || 0,
    work_items_active: threads.filter((t) => t.work_item && !['done', 'cancelled'].includes(t.work_item.status)).length,
    work_items_done: workItemsDoneInWindow,
    agent_sessions: agentScan.totals?.sessions || 0,
    governed_sessions: pick(2, []).filter((s) => s.status === 'active').length,
    repos_active: gitReport.totals?.repos_active || 0,
    source_errors: sourceErrors.length,
  };

  // Dev-only diagnostics: how the resolved window mapped source rows into the
  // in-window completion counts, and which completion timestamp field drove each.
  const doneThreads = threads.filter((t) => t.work_item?.status === 'done');
  const completionFieldCounts = {};
  let inferredCompletions = 0;
  let completionsWithoutTs = 0;
  for (const t of doneThreads) {
    const { ts, inferred, field } = workItemCompletion(t.work_item);
    if (!ts) { completionsWithoutTs += 1; continue; }
    const key = field || 'unknown';
    completionFieldCounts[key] = (completionFieldCounts[key] || 0) + 1;
    if (inferred) inferredCompletions += 1;
  }
  // Data-quality drift over the raw fetched rows (archived-completed inclusion,
  // completion-timestamp coverage). Debug/audit only — never an operator alert.
  const fetchedItems = pick(1, []);
  const dataQuality = completionDataQuality(fetchedItems);
  const archivedFetched = fetchedItems.filter((i) => i.archived_at != null).length;

  const diagnostics = {
    range: window.preset,
    mode: window.mode,
    from: window.from,
    to: window.to,
    start: window.start ? new Date(window.start).toISOString() : null,
    end: window.end ? new Date(window.end).toISOString() : null,
    bucket: window.bucket,
    months: window.months || null,
    include_archived_completed: includeArchivedCompleted,
    source_records: {
      daily_items_fetched: fetchedItems.length,
      archived_completed_fetched: archivedFetched,
      threads_total: threads.length,
      done_threads: doneThreads.length,
    },
    completions: {
      done_threads: doneThreads.length,
      in_window: workItemsDoneInWindow,
      inferred: inferredCompletions,
      without_timestamp: completionsWithoutTs,
      by_completion_field: completionFieldCounts,
    },
    data_quality: {
      done_without_completion_ts: dataQuality.done_without_completion_ts_count,
      archived_completed_missing_ts: dataQuality.archived_completed_missing_ts_count,
      inferred_completions: dataQuality.inferred_completions,
    },
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[work-accountability][diag] range=${diagnostics.range} mode=${diagnostics.mode} `
      + `start=${diagnostics.start} end=${diagnostics.end} bucket=${diagnostics.bucket} `
      + `daily_items=${diagnostics.source_records.daily_items_fetched} done=${diagnostics.completions.done_threads} `
      + `completed_in_window=${diagnostics.completions.in_window} inferred=${diagnostics.completions.inferred} `
      + `fields=${JSON.stringify(diagnostics.completions.by_completion_field)}`,
    );
  }

  const result = {
    generated_at: new Date().toISOString(),
    window,
    filters,
    kpis,
    diagnostics,
    threads,
    exceptions: flatExceptions,
    agent_activity: {
      totals: agentScan.totals || {},
      source_status: agentScan.source_status || [],
      sessions: (agentScan.sessions || []).slice(0, 50).map(redactTranscript),
    },
    git_report_summary: {
      totals: gitReport.totals || {},
      repo_snapshots: gitReport.repo_snapshots || [],
      // OM Daily items touched in-window with no git-thread linkage. Surfaced here
      // (rather than a dedicated tab) so the Exceptions tab can flag orphaned work
      // after the legacy 24h Git Report tab was retired.
      orphan_daily_items: gitReport.orphan_daily_items || [],
    },
    prompt_plans: pick(5, []),
    partial_failures: sourceErrors,
  };

  setCachedAggregation(cacheKey, result);
  console.log(`[work-accountability] aggregate ${window.label} in ${Date.now() - started}ms (${threads.length} threads, ${gitReport.totals?.commits || 0} commits)`);
  return result;
}

function buildTimeline(aggregate) {
  const byDay = new Map();
  for (const t of aggregate.threads) {
    const day = (t.timestamps.last_activity_at || t.timestamps.started_at || aggregate.generated_at)
      .toString()
      .slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({
      thread_id: t.id,
      title: t.title,
      severity: t.severity,
      confidence: t.confidence,
      status: t.status,
      repo: t.repo,
      branch: t.branch,
      work_item_code: t.work_item?.code || null,
      commit_count: t.commits?.length || 0,
      exception_count: (t.exceptions || []).length,
      last_activity_at: t.timestamps.last_activity_at,
    });
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({
      date,
      thread_count: items.length,
      items: items.sort((a, b) => new Date(b.last_activity_at || 0) - new Date(a.last_activity_at || 0)),
    }));
}

async function getThreadById(threadId, options = {}) {
  const agg = await aggregateAccountability(options);
  const thread = agg.threads.find((t) => t.id === threadId);
  if (!thread) return null;
  return { ...agg, thread };
}

async function reviewException(exceptionId, { userId, action, note, snoozeHours }) {
  const pool = getAppPool();
  const status = action === 'snooze' ? 'snoozed' : 'reviewed';
  const snoozeUntil = action === 'snooze'
    ? new Date(Date.now() + (Number(snoozeHours) || 24) * 3600 * 1000)
    : null;

  await pool.query(
    `INSERT INTO work_accountability_exception_reviews
       (exception_id, exception_type, status, reviewed_by, reviewed_at, snooze_until, note)
     VALUES (?, 'unknown', ?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       reviewed_by = VALUES(reviewed_by),
       reviewed_at = VALUES(reviewed_at),
       snooze_until = VALUES(snooze_until),
       note = VALUES(note),
       updated_at = NOW()`,
    [exceptionId, status, userId, snoozeUntil, note || null],
  );
  return { exception_id: exceptionId, status, snooze_until: snoozeUntil };
}

module.exports = {
  aggregateAccountability,
  buildTimeline,
  getThreadById,
  reviewException,
  parseWindow,
  threadKey,
  workItemCompletion,
  isWithinWindow,
  completedInWindow,
};
