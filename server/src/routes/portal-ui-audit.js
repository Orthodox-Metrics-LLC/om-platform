/**
 * Frontend UI Audit (compatibility alias: Portal UI Audit) — Developer Tools API
 *
 * Spawns the read-only portal-ui-audit / frontend-ui-audit CLI under
 * scripts/portal-ui-audit, polls job status/logs, and serves artifacts from a
 * fixed artifacts root. Super_admin only. No arbitrary shell; whitelisted args only.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
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
  validateScope,
  publicJob,
  createStartJob,
  listArtifactRunEntries,
  enrichArtifactRunEntry,
} = core;

const router = express.Router();

/** @type {Map<string, object>} */
const jobs = new Map();

const startJob = createStartJob({
  jobs,
  logPrefix: 'portal-ui-audit',
  resolveScope: (scope) => validateScope(scope || 'portal'),
});

async function listArtifactRuns() {
  const entries = await listArtifactRunEntries(ARTIFACTS_ROOT);
  const runs = [];
  for (const entry of entries) {
    runs.push(await enrichArtifactRunEntry(entry));
  }
  return runs;
}

router.use(requireAuth, requireRole(['super_admin']));

router.get('/meta', async (req, res) => {
  try {
    const pythonBin = resolvePythonBin();
    const venvPresent = fs.existsSync(path.join(TOOL_ROOT, '.venv', 'bin', 'python'));
    const configPresent = fs.existsSync(DEFAULT_CONFIG);
    res.json({
      success: true,
      toolName: 'Frontend UI Audit',
      compatibilityAlias: 'Portal UI Audit',
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
      presetDetails: {
        'quick-public': {
          label: 'Quick Public',
          scope: 'public',
          mode: 'runtime',
          description: 'Fast public website smoke audit',
        },
        'full-public': {
          label: 'Full Public',
          scope: 'public',
          mode: 'all',
          description: 'Full public website audit',
        },
        authentication: {
          label: 'Authentication',
          scope: 'authentication',
          mode: 'runtime',
          description: 'Auth pages only',
        },
        portal: {
          label: 'Portal',
          scope: 'portal',
          mode: 'all',
          description: 'Classic church portal audit',
        },
        'complete-frontend': {
          label: 'Complete Frontend',
          scope: 'all',
          mode: 'all',
          description: 'Portal + public + authentication',
        },
      },
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
  const list = [...jobs.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50)
    .map(publicJob);
  res.json({ success: true, jobs: list });
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
    core.appendLog(job, '\n[portal-ui-audit] Cancelled by operator\n');
    return res.json({ success: true, job: publicJob(job) });
  } catch (err) {
    return res.status(500).json({ success: false, error: redact(err.message) });
  }
});

router.get('/artifacts', async (req, res) => {
  try {
    const runs = await listArtifactRuns();
    res.json({ success: true, runs });
  } catch (err) {
    res.status(500).json({ success: false, error: redact(err.message) });
  }
});

core.mountArtifactRoutes(router);

module.exports = router;
