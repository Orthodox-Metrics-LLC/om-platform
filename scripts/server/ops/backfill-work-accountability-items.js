#!/usr/bin/env node
/**
 * Historical work-item backfill for Work Accountability Command Center.
 *
 * Populates omai_db.om_daily_items with grouped, done-status items derived from
 * merged GitHub PRs and direct-to-main git commits (Dec 2025 → present).
 *
 * Idempotent via metadata.backfill_key — safe to re-run.
 *
 * Usage:
 *   node server/scripts/backfill-work-accountability-items.js [--dry-run] [--since=2025-12-01]
 */

const fs = require('fs');
const path = require('path');
const SERVER_ROOT = require('path').resolve(__dirname, '../../../server');

const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SINCE_DEFAULT = '2025-12-01';
const BACKFILL_SOURCE = 'historical_backfill';

const GH_REPOS = [
  { slug: 'omrecords82/prod-current', repo_target: 'orthodoxmetrics', cwd: '/var/www/orthodoxmetrics/prod' },
  { slug: 'omrecords82/omai', repo_target: 'omai', cwd: '/var/www/omai' },
];

const CWD_BY_TARGET = Object.fromEntries(GH_REPOS.map((r) => [r.repo_target, r.cwd]));

// Fixed reference string required for backfilled items (original prompt unknown).
const BACKFILL_REFERENCE = 'Original Cursor prompt unavailable; backfilled from GitHub commit history.';

function loadEnv() {
  for (const envFile of ['.env.production', '.env']) {
    const p = path.join(REPO_ROOT, envFile);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
  if (!process.env.DB_HOST) {
    try {
      const pid = execFileSync('pgrep', ['-f', 'orthodoxmetrics/prod/server/dist/index.js'], { encoding: 'utf8' })
        .trim().split('\n')[0];
      if (pid) {
        const envRaw = fs.readFileSync(`/proc/${pid}/environ`);
        for (const part of envRaw.toString('utf8').split('\0')) {
          if (part.startsWith('DB_')) {
            const eq = part.indexOf('=');
            process.env[part.slice(0, eq)] = part.slice(eq + 1);
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    since: args.find((a) => a.startsWith('--since='))?.split('=')[1] || SINCE_DEFAULT,
  };
}

function ghJson(args) {
  try {
    const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    return JSON.parse(out || '[]');
  } catch (err) {
    console.warn('[backfill] gh failed:', err.message);
    return [];
  }
}

function gitLog(cwd, since) {
  try {
    const out = execFileSync(
      'git',
      ['log', 'main', `--since=${since} 00:00:00`, '--pretty=format:%H|%h|%aI|%s', '--no-merges'],
      { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
    );
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const [fullHash, shortHash, timestamp, message] = line.split('|');
      return { fullHash, shortHash, timestamp, message };
    });
  } catch {
    return [];
  }
}

// Union of changed file paths across a set of commits (evidence for grouped
// direct-to-main items). One git call per group; read-only.
function changedFilesForCommits(cwd, shortHashes) {
  if (!cwd || !shortHashes || !shortHashes.length) return [];
  try {
    const out = execFileSync(
      'git',
      ['show', '--name-only', '--format=', ...shortHashes],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

const WORK_ITEM_RE = /(?:omod|omad|omsd|omd)-(\d+)/i;

function extractWorkItemId(branch) {
  const m = (branch || '').match(WORK_ITEM_RE);
  return m ? Number(m[1]) : null;
}

function inferCategory(title, branch, repoTarget) {
  const blob = `${title} ${branch}`.toLowerCase();
  const rules = [
    [/ocr|feeder|vision|digitiz/, 'om-ocr'],
    [/brain|ombrain|rag|paschalion|saints|theology|llm/, 'omai-ai'],
    [/ledger|conversation|intake|prompt.?plan|sdlc|work.?item|omai-development|lifecycle/, 'omai-sdlc'],
    [/workflow|catalog|execution/, 'omai-backend'],
    [/tailwind|berry|kombai|dashboard|roadmap|development hub/, 'omai-frontend'],
    [/cert|certificate|record|baptism|marriage|funeral|portal|enroll|onboard/, 'om-records'],
    [/auth|login|session|oidc|keycloak|recaptcha/, 'om-auth'],
    [/deploy|nginx|ops|sync|replica|worktree|workspace/, 'om-devops'],
    [/docs-pickup|docs-dropbox|mkdocs|pickup/, 'docs'],
    [/latest-news|campaign|newsletter/, 'om-frontend'],
    [/assets.?library|gallery/, 'om-frontend'],
    [/cemetery|map digitizer/, 'om-frontend'],
    [/crm|ccc/, 'om-admin'],
    [/accountability|work-session|timer/, 'om-devops'],
    [/change.?set|prompt.?plan/, 'omai-sdlc'],
  ];
  for (const [re, cat] of rules) {
    if (re.test(blob)) return cat;
  }
  if (repoTarget === 'omai') return 'omai-backend';
  if (/fix|bug|hotfix/.test(blob)) return 'om-backend';
  if (/feat|feature/.test(blob)) return 'om-frontend';
  return 'om-backend';
}

function inferTaskType(title, branch) {
  const blob = `${title} ${branch}`.toLowerCase();
  if (/fix|hotfix|bug/.test(blob)) return 'bugfix';
  if (/chore|cleanup|gitignore/.test(blob)) return 'chore';
  if (/docs|adr/.test(blob)) return 'docs';
  if (/refactor|migrate/.test(blob)) return 'refactor';
  if (/migration|schema/.test(blob)) return 'migration';
  return 'feature';
}

function inferAgent(branch) {
  if (/cursor/i.test(branch)) return 'cursor';
  if (/claude/i.test(branch)) return 'claude_cli';
  if (/windsurf/i.test(branch)) return 'windsurf';
  return 'cursor';
}

function extractScope(message) {
  const m = message.match(/^(?:feat|fix|chore|docs|refactor|test)\(([^)]+)\)/i);
  if (m) return m[1].toLowerCase();
  const lead = message.match(/^(feat|fix|chore|docs|refactor|test):\s*(.+)/i);
  if (lead) return lead[2].split(/[\s:,]/)[0].toLowerCase().slice(0, 40);
  return 'general';
}

// Grouping scope for direct-to-main commits. Uses the conventional-commit
// scope when present; otherwise falls back to the inferred subsystem (om-ocr,
// om-auth, om-frontend, …) instead of dumping everything into a single
// non-meaningful "general" bucket. Keeps related work grouped by real subsystem
// + week while giving major/standalone commits their own item.
function deriveGroupScope(message, repoTarget) {
  const s = extractScope(message);
  if (s && s !== 'general') return s;
  return inferCategory(message, 'main', repoTarget);
}

function weekKey(iso) {
  const d = new Date(iso);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return mon.toISOString().slice(0, 10);
}

function normalizeTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.replace('T', ' ').slice(0, 19);
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
  }
  return null;
}

function buildMetadata(entry) {
  const files = entry.changed_files || [];
  return JSON.stringify({
    backfill_key: entry.backfill_key,
    backfill_version: 2,
    backfill_source: BACKFILL_SOURCE,
    backfilled_from_github: true,
    reference: BACKFILL_REFERENCE,
    github_repo: entry.github_repo || null,
    github_pr_number: entry.pr_number || null,
    commit_hashes: entry.commit_hashes || [],
    commit_count: entry.commit_count || 0,
    merged_at: entry.completed_at || null,
    changed_files: files.slice(0, 60),
    changed_files_count: files.length,
  });
}

async function findExisting(pool, entry) {
  const [byKey] = await pool.query(
    `SELECT id, status, completed_at FROM om_daily_items
     WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.backfill_key')) = ?
     LIMIT 1`,
    [entry.backfill_key],
  );
  if (byKey.length) return byKey[0];

  if (entry.pr_number && entry.github_repo) {
    const [byPr] = await pool.query(
      `SELECT id, status, completed_at FROM om_daily_items
       WHERE github_pr_number = ? AND (github_repo = ? OR github_repo IS NULL)
       LIMIT 1`,
      [entry.pr_number, entry.github_repo],
    );
    if (byPr.length) return byPr[0];
  }

  if (entry.work_item_id) {
    const [byId] = await pool.query(
      'SELECT id, status, completed_at FROM om_daily_items WHERE id = ? LIMIT 1',
      [entry.work_item_id],
    );
    if (byId.length) return byId[0];
  }

  // Only dedup by branch for REAL PR/feature branches. Direct-to-main entries
  // all share github_branch='main', so matching on it collapses every grouped
  // commit item onto a single row (the historical direct-to-main backfill bug).
  // Those entries dedup solely on their unique metadata.backfill_key above.
  if (entry.github_branch && entry.github_branch !== 'main' && entry.github_branch !== 'master') {
    const [byBranch] = await pool.query(
      `SELECT id, status, completed_at FROM om_daily_items
       WHERE github_branch = ? AND repo_target = ?
       ORDER BY id DESC LIMIT 1`,
      [entry.github_branch, entry.repo_target],
    );
    if (byBranch.length) return byBranch[0];
  }

  return null;
}

async function upsertItem(pool, entry, dryRun) {
  const existing = await findExisting(pool, entry);
  const completedAt = normalizeTimestamp(entry.completed_at);
  const createdAt = normalizeTimestamp(entry.created_at) || completedAt;
  const metadata = buildMetadata(entry);

  if (existing) {
    const updates = [];
    const params = [];
    if (existing.status !== 'done' && existing.status !== 'cancelled') {
      updates.push('status = ?');
      params.push('done');
    }
    if (!existing.completed_at && completedAt) {
      updates.push('completed_at = ?');
      params.push(completedAt);
    }
    if (entry.pr_number) {
      updates.push('github_pr_number = COALESCE(github_pr_number, ?)');
      params.push(entry.pr_number);
      updates.push("github_pr_state = 'merged'");
      updates.push('github_pr_merged_at = COALESCE(github_pr_merged_at, ?)');
      params.push(completedAt);
    }
    if (entry.github_branch) {
      updates.push('github_branch = COALESCE(github_branch, ?)');
      params.push(entry.github_branch);
    }
    if (entry.changed_files && entry.changed_files.length) {
      updates.push('changed_files = COALESCE(changed_files, ?)');
      params.push(JSON.stringify(entry.changed_files.slice(0, 60)));
    }
    updates.push('metadata = ?');
    params.push(metadata);
    updates.push('source = ?');
    params.push(BACKFILL_SOURCE);
    params.push(existing.id);

    if (!updates.length) return { action: 'skip', id: existing.id };
    const sql = `UPDATE om_daily_items SET ${updates.join(', ')} WHERE id = ?`;
    if (dryRun) return { action: 'update', id: existing.id, sql };
    await pool.query(sql, params);
    return { action: 'update', id: existing.id };
  }

  const title = entry.title.length > 250 ? `${entry.title.slice(0, 247)}...` : entry.title;
  const sql = `INSERT INTO om_daily_items (
    title, task_type, description, horizon, status, priority, category, source,
    agent_tool, branch_type, repo_target, github_branch, github_repo,
    github_pr_number, github_pr_url, github_pr_state, github_pr_merged_at,
    metadata, changed_files, progress, created_at, completed_at, updated_at
  ) VALUES (?, ?, ?, '30', 'done', 'medium', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'merged', ?, ?, ?, 100, ?, ?, ?)`;

  const params = [
    title,
    entry.task_type || 'feature',
    entry.description || null,
    entry.category,
    BACKFILL_SOURCE,
    entry.agent_tool || null,
    entry.branch_type || entry.task_type || 'feature',
    entry.repo_target,
    entry.github_branch || null,
    entry.github_repo || null,
    entry.pr_number || null,
    entry.pr_url || null,
    completedAt,
    metadata,
    entry.changed_files && entry.changed_files.length ? JSON.stringify(entry.changed_files.slice(0, 60)) : null,
    createdAt,
    completedAt,
    completedAt,
  ];

  if (dryRun) return { action: 'insert', title, sql };
  const [result] = await pool.query(sql, params);
  return { action: 'insert', id: result.insertId, title };
}

function collectMergedPrs(since) {
  const byBranch = new Map();
  for (const repo of GH_REPOS) {
    const prs = ghJson([
      'pr', 'list', '--repo', repo.slug, '--state', 'merged', '--limit', '500',
      '--json', 'number,title,mergedAt,headRefName,url',
    ]);
    for (const pr of prs) {
      if (!pr.mergedAt || pr.mergedAt < since) continue;
      const branchKey = `${repo.repo_target}::${pr.headRefName}`;
      const prev = byBranch.get(branchKey);
      if (!prev || pr.mergedAt > prev.mergedAt) {
        byBranch.set(branchKey, { ...pr, repo_target: repo.repo_target, github_repo: repo.slug });
      }
    }
  }
  return [...byBranch.values()];
}

function collectMainCommitGroups(since, stats = {}) {
  const groups = new Map();
  const prTitles = new Set();
  stats.skippedOmdReferenced = stats.skippedOmdReferenced || [];

  for (const repo of GH_REPOS) {
    const prs = ghJson([
      'pr', 'list', '--repo', repo.slug, '--state', 'merged', '--limit', '500',
      '--json', 'title,mergedAt',
    ]);
    for (const pr of prs) {
      if (pr.mergedAt >= since) prTitles.add(pr.title.trim().toLowerCase());
    }

    const commits = gitLog(repo.cwd, since);
    for (const c of commits) {
      if (prTitles.has(c.message.trim().toLowerCase())) continue;
      // Skip commits that already reference an OMD/OMOD/OMAD/OMSD work item —
      // that work is (or will be) represented by its own item; backfilling it
      // would double-represent it (incl. any concurrent in-flight OMD work).
      const refId = extractWorkItemId(c.message);
      if (refId) {
        stats.skippedOmdReferenced.push({ repo_target: repo.repo_target, sha: c.shortHash, omd: refId, message: c.message });
        continue;
      }
      const scope = deriveGroupScope(c.message, repo.repo_target);
      const wk = weekKey(c.timestamp);
      const key = `${repo.repo_target}::main::${scope}::${wk}`;
      if (!groups.has(key)) {
        groups.set(key, {
          repo_target: repo.repo_target,
          scope,
          week: wk,
          commits: [],
        });
      }
      groups.get(key).commits.push(c);
    }
  }

  return [...groups.values()].filter((g) => g.commits.length > 0);
}

async function repairCompletedAt(pool, dryRun) {
  const [rows] = await pool.query(
    `SELECT id, metadata, created_at FROM om_daily_items
     WHERE status = 'done' AND completed_at IS NULL`,
  );
  let fixed = 0;
  for (const row of rows) {
    let meta = row.metadata;
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch { meta = {}; }
    }
    const date = meta?.merged_at || meta?.date || row.created_at;
    const completedAt = normalizeTimestamp(date);
    if (!completedAt) continue;
    if (!dryRun) {
      await pool.query('UPDATE om_daily_items SET completed_at = ? WHERE id = ?', [completedAt, row.id]);
    }
    fixed += 1;
  }
  return fixed;
}

async function main() {
  loadEnv();
  const opts = parseArgs();
  const { getOmaiPool } = require(SERVER_ROOT + '/src/config/db');
  const pool = getOmaiPool();

  const stats = { inserted: 0, updated: 0, skipped: 0, repaired: 0, prs: 0, commitGroups: 0 };

  console.log(`[backfill] since=${opts.since} dryRun=${opts.dryRun}`);

  stats.repaired = await repairCompletedAt(pool, opts.dryRun);
  console.log(`[backfill] repaired completed_at on ${stats.repaired} existing done items`);

  const prs = collectMergedPrs(opts.since);
  stats.prs = prs.length;
  console.log(`[backfill] processing ${prs.length} merged PR branches`);

  for (const pr of prs) {
    const workItemId = extractWorkItemId(pr.headRefName);
    const entry = {
      backfill_key: `pr-branch:${pr.repo_target}:${pr.headRefName}`,
      title: pr.title,
      description: `Historical backfill from merged PR #${pr.number} (${pr.headRefName})`,
      repo_target: pr.repo_target,
      github_repo: pr.github_repo,
      github_branch: pr.headRefName,
      pr_number: pr.number,
      pr_url: pr.url,
      completed_at: pr.mergedAt,
      created_at: pr.mergedAt,
      work_item_id: workItemId,
      category: inferCategory(pr.title, pr.headRefName, pr.repo_target),
      task_type: inferTaskType(pr.title, pr.headRefName),
      branch_type: inferTaskType(pr.title, pr.headRefName),
      agent_tool: inferAgent(pr.headRefName),
    };

    const result = await upsertItem(pool, entry, opts.dryRun);
    if (result.action === 'insert') stats.inserted += 1;
    else if (result.action === 'update') stats.updated += 1;
    else stats.skipped += 1;
  }

  const commitGroups = collectMainCommitGroups(opts.since, stats);
  stats.commitGroups = commitGroups.length;
  stats.skippedOmdReferencedCount = (stats.skippedOmdReferenced || []).length;
  console.log(`[backfill] processing ${commitGroups.length} direct-main commit groups`);
  console.log(`[backfill] skipped ${stats.skippedOmdReferencedCount} direct-main commits already referencing an OMD id (verify/link, not duplicated)`);

  for (const group of commitGroups) {
    const cwd = CWD_BY_TARGET[group.repo_target];
    if (group.commits.length === 1) {
      const c = group.commits[0];
      const entry = {
        backfill_key: `commit:${group.repo_target}:${c.shortHash}`,
        title: c.message.length > 250 ? `${c.message.slice(0, 247)}...` : c.message,
        description: `Direct-to-main commit ${c.shortHash} on ${group.repo_target}.\n${BACKFILL_REFERENCE}`,
        repo_target: group.repo_target,
        github_branch: 'main',
        completed_at: c.timestamp,
        created_at: c.timestamp,
        commit_hashes: [c.shortHash],
        commit_count: 1,
        changed_files: changedFilesForCommits(cwd, [c.shortHash]),
        category: inferCategory(c.message, 'main', group.repo_target),
        task_type: inferTaskType(c.message, 'main'),
        branch_type: inferTaskType(c.message, 'main'),
      };
      const result = await upsertItem(pool, entry, opts.dryRun);
      if (result.action === 'insert') stats.inserted += 1;
      else if (result.action === 'update') stats.updated += 1;
      else stats.skipped += 1;
      continue;
    }

    const first = group.commits[group.commits.length - 1];
    const last = group.commits[0];
    const sampleTitle = group.commits.find((c) => c.message.length > 20)?.message || first.message;
    const entry = {
      backfill_key: `main-group:${group.repo_target}:${group.scope}:${group.week}`,
      title: `${group.scope}: ${sampleTitle.slice(0, 120)} (${group.commits.length} commits)`,
      description: `Grouped direct-to-main commits for subsystem "${group.scope}" week of ${group.week} on ${group.repo_target}.\n`
        + group.commits.slice(0, 12).map((c) => `- ${c.shortHash} ${c.message}`).join('\n')
        + `\n\n${BACKFILL_REFERENCE}`,
      repo_target: group.repo_target,
      github_branch: 'main',
      completed_at: last.timestamp,
      created_at: first.timestamp,
      commit_hashes: group.commits.map((c) => c.shortHash).slice(0, 20),
      commit_count: group.commits.length,
      changed_files: changedFilesForCommits(cwd, group.commits.map((c) => c.shortHash)),
      category: inferCategory(sampleTitle, group.scope, group.repo_target),
      task_type: inferTaskType(sampleTitle, group.scope),
      branch_type: inferTaskType(sampleTitle, group.scope),
    };
    const result = await upsertItem(pool, entry, opts.dryRun);
    if (result.action === 'insert') stats.inserted += 1;
    else if (result.action === 'update') stats.updated += 1;
    else stats.skipped += 1;
  }

  const [[totals]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'done') AS done,
            SUM(status = 'done' AND completed_at >= ?) AS done_since
     FROM om_daily_items WHERE source = ?`,
    [`${opts.since} 00:00:00`, BACKFILL_SOURCE],
  );

  const skippedSample = (stats.skippedOmdReferenced || []).slice(0, 20);
  delete stats.skippedOmdReferenced;
  console.log(JSON.stringify({ stats, skipped_omd_referenced_sample: skippedSample, backfill_totals: totals }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
