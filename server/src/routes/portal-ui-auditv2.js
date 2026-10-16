/**
 * Frontend UI Audit v2 — Developer Tools API
 *
 * Spawns the read-only portal-ui-audit / frontend-ui-audit CLI under
 * scripts/portal-ui-auditv2, polls job status/logs, and serves artifacts from a
 * fixed artifacts root. Super_admin only. No arbitrary shell; whitelisted args only.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { requireAuth, requireRole } = require('../middleware/auth');
const core = require('./portalUiAuditCore');

const {
  TOOL_ROOT,
  ARTIFACTS_ROOT,
  PROJECT_ROOT,
  DEFAULT_CONFIG,
  MODES,
  FAIL_ON,
  SCOPES,
  PRESETS,
  ALLOWED_HOSTS,
  redact,
  resolvePythonBin,
  assertInside,
  sanitizeRunId,
  validateScope,
  publicJob,
  createStartJob,
  listArtifactRunEntries,
  enrichArtifactRunEntry,
} = core;

const router = express.Router();

/** Preset metadata aligned with scripts/portal-ui-audit/portal_ui_audit/scopes.py */
const PRESET_DETAILS = Object.freeze({
  'quick-public': {
    label: 'Quick Public',
    scope: 'public',
    mode: 'runtime',
    description: 'Fast public website smoke: core marketing pages, typography, links, SEO.',
    maxRoutes: 8,
    failOn: 'high',
    themes: ['light'],
    seoEnabled: true,
  },
  'full-public': {
    label: 'Full Public',
    scope: 'public',
    mode: 'all',
    description: 'Full public website audit including source + runtime + responsive viewports.',
    maxRoutes: 40,
    failOn: 'medium',
    themes: ['light', 'dark'],
    seoEnabled: true,
  },
  authentication: {
    label: 'Authentication',
    scope: 'authentication',
    mode: 'runtime',
    description: 'Auth pages only (login/register/forgot). No authenticated portal crawl.',
    maxRoutes: 12,
    failOn: 'high',
    themes: ['light'],
    seoEnabled: true,
  },
  portal: {
    label: 'Portal',
    scope: 'portal',
    mode: 'all',
    description: 'Classic church portal audit (preserves prior Portal UI Audit behavior).',
    maxRoutes: 80,
    failOn: 'critical',
    themes: ['light'],
    seoEnabled: false,
  },
  'complete-frontend': {
    label: 'Complete Frontend',
    scope: 'all',
    mode: 'all',
    description: 'Portal + public website + authentication pages.',
    maxRoutes: 120,
    failOn: 'medium',
    themes: ['light', 'dark'],
    seoEnabled: true,
  },
});

/** @type {Map<string, object>} */
const jobs = new Map();

function presetDetail(preset) {
  return preset ? PRESET_DETAILS[preset] || null : null;
}

function resolveScopeForRun(scope, preset) {
  const detail = presetDetail(preset);
  if (detail?.scope) return validateScope(detail.scope);
  return validateScope(scope || 'portal');
}

const startJob = createStartJob({
  jobs,
  logPrefix: 'portal-ui-auditv2',
  resolveScope: resolveScopeForRun,
});

function activeArtifactRunIds() {
  const ids = new Set();
  for (const job of jobs.values()) {
    if (job.status !== 'running' && job.status !== 'queued') continue;
    const runId = path.basename(job.outputDir || '');
    if (runId) ids.add(runId);
  }
  return ids;
}

async function deleteArtifactRuns(rawIds, artifactsRoot = ARTIFACTS_ROOT) {
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new Error('No run ids provided');
  }
  if (rawIds.length > 50) {
    throw new Error('Too many run ids (max 50)');
  }

  const activeIds = activeArtifactRunIds();
  const deleted = [];
  const blocked = [];
  const notFound = [];
  const errors = [];

  for (const raw of rawIds) {
    let runId;
    try {
      runId = sanitizeRunId(raw);
    } catch (err) {
      errors.push({ id: String(raw || ''), error: err.message });
      continue;
    }

    if (activeIds.has(runId)) {
      blocked.push(runId);
      continue;
    }

    let runDir;
    try {
      runDir = assertInside(artifactsRoot, path.join(artifactsRoot, runId));
    } catch (err) {
      errors.push({ id: runId, error: err.message });
      continue;
    }

    if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
      notFound.push(runId);
      continue;
    }

    try {
      await fsp.rm(runDir, { recursive: true, force: true });
      deleted.push(runId);
    } catch (err) {
      errors.push({ id: runId, error: redact(err.message) });
    }
  }

  return { deleted, blocked, notFound, errors };
}

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 100;

function parsePaginationParams(query) {
  const pageRaw = Number.parseInt(String(query?.page ?? '1'), 10);
  const pageSizeRaw = Number.parseInt(String(query?.pageSize ?? query?.limit ?? DEFAULT_PAGE_SIZE), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  let pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : DEFAULT_PAGE_SIZE;
  pageSize = Math.min(MAX_PAGE_SIZE, pageSize);
  return { page, pageSize };
}

function paginateArray(items, page, pageSize) {
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

async function listArtifactRuns(options = {}) {
  const entries = await listArtifactRunEntries(options.artifactsRoot);
  const paginate = options.page != null || options.pageSize != null;
  const { page, pageSize } = paginate
    ? {
        page: options.page || 1,
        pageSize: Math.min(MAX_PAGE_SIZE, options.pageSize || DEFAULT_PAGE_SIZE),
      }
    : { page: 1, pageSize: entries.length || DEFAULT_PAGE_SIZE };

  const paged = paginate
    ? paginateArray(entries, page, pageSize)
    : { items: entries, total: entries.length, page: 1, pageSize: entries.length, totalPages: entries.length ? 1 : 0 };

  const runs = [];
  for (const entry of paged.items) {
    runs.push(await enrichArtifactRunEntry(entry));
  }

  return {
    runs,
    total: paged.total,
    page: paged.page,
    pageSize: paged.pageSize,
    totalPages: paged.totalPages,
  };
}

function runIdFromOutputDir(outputDir) {
  return path.basename(String(outputDir || '')) || null;
}

async function listRecentRunsPaginated(jobMap, options = {}) {
  const page = options.page || 1;
  const pageSize = Math.min(MAX_PAGE_SIZE, options.pageSize || DEFAULT_PAGE_SIZE);
  const artifactsRoot = options.artifactsRoot || ARTIFACTS_ROOT;

  const linkedRunIds = new Set();
  const jobRows = [...jobMap.values()].map((job) => {
    const runId = runIdFromOutputDir(job.outputDir);
    if (runId) linkedRunIds.add(runId);
    return {
      key: `job:${job.id}`,
      kind: 'job',
      status: job.status,
      when: job.startedAt || job.createdAt,
      mode: job.mode,
      scope: String(job.safeArgs?.scope || job.args?.scope || '—'),
      runId,
      jobId: job.id,
      artifactId: runId,
      job,
    };
  });

  const artifactEntries = await listArtifactRunEntries(artifactsRoot);
  const artifactById = new Map(artifactEntries.map((entry) => [entry.id, entry]));
  const artifactRows = artifactEntries
    .filter((entry) => !linkedRunIds.has(entry.id))
    .map((entry) => ({
      key: `artifact:${entry.id}`,
      kind: 'artifact',
      status: 'artifact',
      when: entry.mtimeMs,
      mode: 'Saved report',
      scope: '—',
      runId: entry.id,
      jobId: null,
      artifactId: entry.id,
      artifactEntry: entry,
      job: null,
    }));

  const merged = [...jobRows, ...artifactRows].sort(
    (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
  );
  const paged = paginateArray(merged, page, pageSize);
  const rows = [];

  for (const row of paged.items) {
    let counts = null;
    let highest = null;
    let artifact = null;

    const artifactEntry =
      row.artifactEntry ||
      (row.artifactId ? artifactById.get(row.artifactId) || null : null);

    if (artifactEntry) {
      const enriched = await enrichArtifactRunEntry(artifactEntry);
      artifact = enriched;
      counts = enriched.severityCounts;
      highest = enriched.highest;
    }

    rows.push({
      key: row.key,
      kind: row.kind,
      status: row.status,
      when: row.when,
      mode: row.mode,
      scope: row.scope,
      runId: row.runId,
      jobId: row.jobId,
      artifactId: row.artifactId,
      counts,
      highest,
      job: row.job ? publicJob(row.job) : null,
      artifact,
    });
  }

  return {
    rows,
    total: paged.total,
    page: paged.page,
    pageSize: paged.pageSize,
    totalPages: paged.totalPages,
  };
}

router.use(requireAuth, requireRole(['super_admin']));

router.get('/meta', async (req, res) => {
  try {
    const pythonBin = resolvePythonBin();
    const venvPresent = fs.existsSync(path.join(TOOL_ROOT, '.venv', 'bin', 'python'));
    const configPresent = fs.existsSync(DEFAULT_CONFIG);
    res.json({
      success: true,
      toolName: 'Frontend UI Audit v2',
      compatibilityAlias: 'Portal UI Audit v2',
      toolRoot: TOOL_ROOT,
      artifactsRoot: ARTIFACTS_ROOT,
      projectRoot: PROJECT_ROOT,
      pythonBin,
      venvPresent,
      configPresent,
      readOnly: true,
      modes: Object.keys(MODES),
      scopes: [...SCOPES],
      presets: [...PRESETS],
      failOn: [...FAIL_ON],
      allowedHosts: [...ALLOWED_HOSTS],
      defaults: {
        baseUrl: 'https://orthodoxmetrics.com',
        routePrefix: '/portal',
        scope: 'portal',
        mode: 'source-only',
        failOn: 'critical',
        headless: true,
        themes: ['light'],
      },
      presetDetails: PRESET_DETAILS,
      notes: [
        'Frontend UI Audit covers portal, public website, and authentication pages. Portal-only runs remain fully supported.',
        'Audit is read-only (no mutating HTTP except optional auth login inside the CLI). Custom URL hosts are limited to OrthodoxMetrics allowlisted hosts.',
        'Passwords are never accepted from this UI. Runtime auth uses server env PORTAL_UI_AUDIT_USER / PORTAL_UI_AUDIT_PASSWORD or an Admin Assets storage-state path.',
        'Runtime / all modes require Playwright Chromium in the tool venv on the server. Use Preview routes for dry-run discovery before a full crawl.',
      ],
      storageStateHint: {
        format: 'internal/<folder>/<file>.json',
        example: 'internal/playwright/storage_state.json',
        uploadAt: '/admin/assets (scope: Internal, folder: playwright)',
        assetsRoot: 'server/storage/om-assets',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: redact(err.message) });
  }
});

router.post('/runs', (req, res) => {
  try {
    const body = req.body || {};
    const dryRun = Boolean(body.dryRun || body.previewRoutes);
    const mode = String(body.mode || (dryRun ? 'source-only' : 'source-only'));
    if (!dryRun && !MODES[mode]) {
      return res.status(400).json({ success: false, error: 'Invalid mode' });
    }
    const job = startJob({
      mode: dryRun ? 'source-only' : mode,
      dryRun,
      scope: body.scope,
      preset: body.preset,
      baseUrl: body.baseUrl,
      routePrefix: body.routePrefix,
      failOn: body.failOn,
      headless: body.headless,
      storageState: body.storageState,
      runName: body.runName,
      themes: body.themes,
      maxRoutes: body.maxRoutes,
      routes: body.routes,
    });
    return res.status(202).json({ success: true, job: publicJob(job) });
  } catch (err) {
    const status = err.code === 'BUSY' ? 409 : 400;
    return res.status(status).json({ success: false, error: redact(err.message) });
  }
});

/** Synchronous-ish route preview: spawn dry-run and return job (poll like normal). */
router.post('/preview-routes', (req, res) => {
  try {
    const body = req.body || {};
    const job = startJob({
      mode: 'source-only',
      dryRun: true,
      scope: body.scope || 'public',
      preset: body.preset,
      baseUrl: body.baseUrl,
      routePrefix: body.routePrefix,
      failOn: 'none',
      headless: true,
      runName: body.runName,
      maxRoutes: body.maxRoutes,
      routes: body.routes,
    });
    return res.status(202).json({ success: true, job: publicJob(job) });
  } catch (err) {
    const status = err.code === 'BUSY' ? 409 : 400;
    return res.status(status).json({ success: false, error: redact(err.message) });
  }
});

router.get('/runs', (req, res) => {
  const { page, pageSize } = parsePaginationParams(req.query);
  const sorted = [...jobs.values()].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt)),
  );
  const result = paginateArray(sorted, page, pageSize);
  res.json({
    success: true,
    jobs: result.items.map(publicJob),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  });
});

router.get('/runs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  return res.json({ success: true, job: publicJob(job) });
});

router.post('/runs/:jobId/cancel', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  if (job.status !== 'running' || !job.child) {
    return res.status(400).json({ success: false, error: 'Job is not running' });
  }
  try {
    job.child.kill('SIGTERM');
    job.status = 'cancelled';
    job.error = 'Cancelled by operator';
    core.appendLog(job, '\n[portal-ui-auditv2] Cancelled by operator\n');
    return res.json({ success: true, job: publicJob(job) });
  } catch (err) {
    return res.status(500).json({ success: false, error: redact(err.message) });
  }
});

router.get('/recent-runs', async (req, res) => {
  try {
    const { page, pageSize } = parsePaginationParams(req.query);
    const result = await listRecentRunsPaginated(jobs, { page, pageSize });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: redact(err.message) });
  }
});

router.get('/artifacts', async (req, res) => {
  try {
    const { page, pageSize } = parsePaginationParams(req.query);
    const result = await listArtifactRuns({ page, pageSize });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: redact(err.message) });
  }
});

router.delete('/artifacts', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = await deleteArtifactRuns(ids);
    const hasFailures =
      result.blocked.length > 0 || result.notFound.length > 0 || result.errors.length > 0;
    const status = result.deleted.length === 0 && hasFailures ? 400 : 200;
    return res.status(status).json({ success: result.deleted.length > 0 || !hasFailures, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, error: redact(err.message) });
  }
});

core.mountArtifactRoutes(router);

module.exports = router;
module.exports.__test = {
  sanitizeRunId,
  assertInside,
  deleteArtifactRuns,
  activeArtifactRunIds,
  resolveScopeForRun,
  PRESET_DETAILS,
  ARTIFACTS_ROOT,
  parsePaginationParams,
  paginateArray,
  listArtifactRunEntries,
  listArtifactRuns,
  listRecentRunsPaginated,
};
