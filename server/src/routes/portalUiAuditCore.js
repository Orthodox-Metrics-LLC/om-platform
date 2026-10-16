/**
 * portalUiAuditCore — Shared constants, validators, and job-spawning logic
 * for the Frontend/Portal UI Audit routes (portal-ui-audit.js v1 and
 * portal-ui-auditv2.js). These two route files were near-total duplicates
 * (jscpd flagged ~809 duplicated lines / 15 clones between them); v2 adds
 * preset-driven scope resolution, artifact pagination, recent-runs merging,
 * and bulk delete on top of the same path-safety, redaction, and CLI-spawn
 * core used by v1.
 *
 * Nothing here changes the CLI arguments, path-safety checks, secret
 * redaction, or spawn behavior — this is a verbatim extraction of the
 * identical code that existed in both files.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { spawn } = require('child_process');
const crypto = require('crypto');
const { OM_ASSETS_ROOT, STORAGE_ROOT } = require('../assets/omAssetsConstants');

const OM_ROOT = path.resolve('/var/www/om-platform');
const TOOL_ROOT = path.join(OM_ROOT, 'scripts', 'portal-ui-audit');
const ARTIFACTS_ROOT = path.join(TOOL_ROOT, '.om-artifacts');
const PROJECT_ROOT = path.join(OM_ROOT, 'front-end');
const DEFAULT_CONFIG = path.join(TOOL_ROOT, 'portal-ui-audit.yaml');

const MODES = Object.freeze({
  'source-only': 'scan-source',
  runtime: 'scan-runtime',
  all: 'all',
});
const FAIL_ON = new Set(['critical', 'high', 'medium', 'low', 'informational', 'none']);
const SCOPES = new Set(['portal', 'public', 'authentication', 'custom', 'all']);
const PRESETS = new Set([
  'quick-public',
  'full-public',
  'authentication',
  'portal',
  'complete-frontend',
]);
const ALLOWED_HOSTS = new Set([
  'orthodoxmetrics.com',
  'www.orthodoxmetrics.com',
  'localhost',
  '127.0.0.1',
]);
const MAX_LOG_CHARS = 400_000;
const MAX_CONCURRENT = 1;
const TIMEOUT_MS = {
  'source-only': 15 * 60 * 1000,
  runtime: 60 * 60 * 1000,
  all: 90 * 60 * 1000,
  'preview-routes': 5 * 60 * 1000,
};

const SECRET_RE =
  /(password|passwd|secret|token|api[_-]?key|authorization|bearer)\s*[:=]\s*["']?[^\s"',}]+/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._\-+=/]+\b/gi;
const ENV_PASS_RE = /\bPORTAL_UI_AUDIT_PASSWORD\s*=\s*\S+/gi;

function redact(text) {
  if (!text) return '';
  return String(text)
    .replace(SECRET_RE, '$1=[REDACTED]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(ENV_PASS_RE, 'PORTAL_UI_AUDIT_PASSWORD=[REDACTED]');
}

function appendLog(job, chunk) {
  const cleaned = redact(chunk);
  job.logs = (job.logs || '') + cleaned;
  if (job.logs.length > MAX_LOG_CHARS) {
    job.logs = job.logs.slice(-MAX_LOG_CHARS);
  }
}

function resolvePythonBin() {
  const venvBin = path.join(TOOL_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(venvBin)) return venvBin;
  return 'python3';
}

function assertInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Path escapes allowed root');
  }
  return resolved;
}

function sanitizeRunId(raw) {
  const s = String(raw || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(s)) {
    throw new Error('Invalid run id');
  }
  return s;
}

function hostAllowed(hostname) {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .split(':')[0];
  if (!host) return false;
  if (ALLOWED_HOSTS.has(host)) return true;
  for (const allowed of ALLOWED_HOSTS) {
    if (host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function validateBaseUrl(url) {
  const u = String(url || '').trim();
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error('Invalid base-url');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('base-url must be http(s)');
  }
  if (u.length > 300) throw new Error('base-url too long');
  if (!hostAllowed(parsed.hostname)) {
    throw new Error(
      `base-url host not allowed (OM hosts only): ${parsed.hostname}`,
    );
  }
  return u.replace(/\/$/, '');
}

function validateScope(scope) {
  const s = String(scope || 'portal').trim().toLowerCase();
  if (!SCOPES.has(s)) throw new Error('Invalid scope');
  return s;
}

function validatePreset(preset) {
  if (preset == null || preset === '') return null;
  const p = String(preset).trim().toLowerCase();
  if (!PRESETS.has(p)) throw new Error('Invalid preset');
  return p;
}

function defaultRoutePrefixForScope(scope) {
  switch (scope) {
    case 'public':
    case 'custom':
    case 'all':
      return '/';
    case 'authentication':
      return '/auth';
    case 'portal':
    default:
      return '/portal';
  }
}

function validateRoutePrefix(prefix) {
  const p = String(prefix || '/portal').trim() || '/portal';
  if (!p.startsWith('/') || p.includes('..') || /[\s;|&`$<>]/.test(p) || p.length > 80) {
    throw new Error('Invalid route-prefix');
  }
  return p;
}

/**
 * Resolve a Playwright storage-state path for the CLI.
 *
 * Preferred input (Admin Assets): path relative to om-assets root, e.g.
 *   internal/playwright/storage_state.json
 * Also accepted:
 *   om-assets/internal/playwright/storage_state.json  (relative to server/storage)
 *   absolute path under an allowlisted root
 * If a directory under Admin Assets is given (e.g. internal/playwright), prefer
 * storage_state.json inside it, else the sole *.json file.
 * Never returns/logs file contents (cookies).
 */
function validateStorageState(raw) {
  if (raw == null || raw === '') return null;
  const p = String(raw).trim();
  if (p.includes('\0') || p.includes('..')) throw new Error('Invalid storage-state path');
  if (/[\s;|&`$<>]/.test(p)) throw new Error('Invalid storage-state path');

  const assetsRoot = path.resolve(OM_ASSETS_ROOT);
  const storageRoot = path.resolve(STORAGE_ROOT);
  const allowedRoots = [
    assetsRoot,
    TOOL_ROOT,
    path.join(OM_ROOT, 'scripts'),
    '/var/lib/omstudio',
    '/var/lib/orthodoxmetrics',
  ];

  let candidate;
  if (path.isAbsolute(p)) {
    candidate = path.resolve(p);
  } else {
    const normalized = p.replace(/^\/+/, '').replace(/\\/g, '/');
    if (normalized.startsWith('om-assets/')) {
      candidate = path.resolve(storageRoot, normalized);
    } else if (normalized.startsWith('storage/om-assets/')) {
      candidate = path.resolve(OM_ROOT, 'server', normalized);
    } else {
      // Default: Admin Assets relative path (scope/folder/file.json)
      candidate = path.resolve(assetsRoot, normalized);
    }
  }

  const underAllowed = (resolved) =>
    allowedRoots.some((root) => {
      const r = path.resolve(root);
      return resolved === r || resolved.startsWith(r + path.sep);
    });

  if (!underAllowed(candidate)) {
    throw new Error(
      'storage-state path not in an allowed directory (use Admin Assets path like internal/playwright/storage_state.json)',
    );
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    const preferred = path.join(candidate, 'storage_state.json');
    if (fs.existsSync(preferred) && fs.statSync(preferred).isFile()) {
      candidate = preferred;
    } else {
      const jsonFiles = fs
        .readdirSync(candidate)
        .filter((name) => name.toLowerCase().endsWith('.json'))
        .map((name) => path.join(candidate, name))
        .filter((fp) => fs.statSync(fp).isFile());
      if (jsonFiles.length === 1) {
        candidate = jsonFiles[0];
      } else if (jsonFiles.length === 0) {
        throw new Error(
          'storage-state directory has no .json file — upload storage_state.json under that Admin Assets folder',
        );
      } else {
        throw new Error(
          'storage-state directory has multiple .json files — specify the full file path (e.g. internal/playwright/storage_state.json)',
        );
      }
    }
  }

  if (!underAllowed(candidate)) {
    throw new Error('storage-state path not in an allowed directory');
  }
  if (!candidate.toLowerCase().endsWith('.json')) {
    throw new Error('storage-state path must be a .json file');
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error('storage-state file not found');
  }
  return candidate;
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    command: job.command,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    error: job.error ? redact(job.error) : null,
    outputDir: job.outputDirRel,
    args: job.safeArgs,
    logs: job.logs || '',
    pid: job.pid || null,
  };
}

function countSeverities(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, informational: 0, total: 0 };
  if (!Array.isArray(findings)) return counts;
  for (const f of findings) {
    const sev = String(f?.severity || '').toLowerCase();
    if (sev in counts) counts[sev] += 1;
    counts.total += 1;
  }
  return counts;
}

function buildArgs({
  mode,
  baseUrl,
  routePrefix,
  failOn,
  headless,
  storageState,
  outputDir,
  scope,
  preset,
  dryRun,
  themes,
  maxRoutes,
  routes,
}) {
  const command = dryRun ? 'preview-routes' : MODES[mode];
  if (!command) throw new Error('Invalid mode');
  const args = [
    '-m',
    'portal_ui_audit',
    command,
    '--project-root',
    PROJECT_ROOT,
    '--base-url',
    baseUrl,
    '--route-prefix',
    routePrefix,
    '--output',
    outputDir,
    '--fail-on',
    failOn,
    '--verbose',
  ];
  if (scope) {
    args.push('--scope', scope);
  }
  if (preset) {
    args.push('--preset', preset);
  }
  if (dryRun) {
    args.push('--dry-run');
  }
  if (Array.isArray(themes)) {
    for (const t of themes) {
      if (t === 'light' || t === 'dark') args.push('--theme', t);
    }
  }
  if (maxRoutes != null && Number.isFinite(Number(maxRoutes))) {
    const n = Math.max(1, Math.min(500, Number(maxRoutes)));
    args.push('--max-routes', String(n));
  }
  if (Array.isArray(routes)) {
    for (const r of routes.slice(0, 40)) {
      const routePath = String(r || '').trim();
      if (routePath.startsWith('/') && routePath.length < 120 && !/[\s;|&`$<>]/.test(routePath)) {
        args.push('--route', routePath);
      }
    }
  }
  if (fs.existsSync(DEFAULT_CONFIG)) {
    args.push('--config', DEFAULT_CONFIG);
  }
  if (!dryRun && mode !== 'source-only') {
    args.push(headless ? '--headless' : '--no-headless');
  }
  if (storageState) {
    args.push('--storage-state', storageState);
  }
  return { command, args };
}

/**
 * Build a `startJob(options)` function bound to a specific job registry
 * (each of v1/v2 keeps its own `jobs` Map — audits started via one version
 * are not visible to the other), a log-line prefix, and a scope resolver
 * (v1: plain validateScope; v2: preset-aware resolveScopeForRun).
 */
function createStartJob({ jobs, logPrefix, resolveScope }) {
  return function startJob(options) {
    const running = [...jobs.values()].filter((j) => j.status === 'running' || j.status === 'queued');
    if (running.length >= MAX_CONCURRENT) {
      const err = new Error('An audit is already running. Wait for it to finish.');
      err.code = 'BUSY';
      throw err;
    }

    const mode = options.mode;
    const dryRun = Boolean(options.dryRun);
    const preset = validatePreset(options.preset);
    const scope = resolveScope(options.scope, preset);
    const baseUrl = validateBaseUrl(options.baseUrl || 'https://orthodoxmetrics.com');
    const routePrefix = validateRoutePrefix(
      options.routePrefix || defaultRoutePrefixForScope(scope),
    );
    const failOn = String(options.failOn || 'critical').toLowerCase();
    if (!FAIL_ON.has(failOn)) throw new Error('Invalid fail-on');
    const headless = options.headless !== false;
    const storageState = validateStorageState(options.storageState);
    const themes = Array.isArray(options.themes) ? options.themes : undefined;
    const maxRoutes = options.maxRoutes != null ? Number(options.maxRoutes) : undefined;
    const routes = Array.isArray(options.routes) ? options.routes : undefined;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const runSlug = sanitizeRunId(
      options.runName || `ui-${scope}-${dryRun ? 'preview' : mode}-${stamp}`,
    );
    const outputDir = assertInside(ARTIFACTS_ROOT, path.join(ARTIFACTS_ROOT, runSlug));
    fs.mkdirSync(ARTIFACTS_ROOT, { recursive: true });

    const { command, args } = buildArgs({
      mode,
      baseUrl,
      routePrefix,
      failOn,
      headless,
      storageState,
      outputDir,
      scope,
      preset,
      dryRun,
      themes,
      maxRoutes,
      routes,
    });

    const jobId = `job-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const pythonBin = resolvePythonBin();
    const timeoutMs = dryRun
      ? TIMEOUT_MS['preview-routes']
      : TIMEOUT_MS[mode] || TIMEOUT_MS.all;

    const job = {
      id: jobId,
      status: 'running',
      mode: dryRun ? 'preview-routes' : mode,
      command,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      error: null,
      logs: '',
      pid: null,
      outputDir,
      outputDirRel: path.relative(TOOL_ROOT, outputDir),
      safeArgs: {
        mode: dryRun ? 'preview-routes' : mode,
        scope,
        preset,
        dryRun,
        baseUrl,
        routePrefix,
        failOn,
        headless,
        themes: themes || null,
        maxRoutes: maxRoutes || null,
        storageState: storageState ? '[path set]' : null,
        projectRoot: PROJECT_ROOT,
        output: path.relative(TOOL_ROOT, outputDir),
        pythonBin,
        timeoutMs,
        toolName: 'frontend-ui-audit',
        compatibilityAlias: 'portal-ui-audit',
      },
      child: null,
      timer: null,
    };
    jobs.set(jobId, job);

    appendLog(
      job,
      `[frontend-ui-audit] Starting ${command} (read-only; scope=${scope})\n` +
        `[frontend-ui-audit] cwd=${TOOL_ROOT}\n` +
        `[frontend-ui-audit] ${pythonBin} ${args.join(' ')}\n`,
    );

    const child = spawn(pythonBin, args, {
      cwd: TOOL_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: TOOL_ROOT,
        // Do not inject UI-supplied passwords; rely on server env if present.
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    job.child = child;
    job.pid = child.pid;

    child.stdout.on('data', (buf) => appendLog(job, buf.toString('utf8')));
    child.stderr.on('data', (buf) => appendLog(job, buf.toString('utf8')));

    job.timer = setTimeout(() => {
      if (job.status === 'running' && job.child) {
        appendLog(job, `\n[${logPrefix}] Timeout after ${timeoutMs}ms — sending SIGTERM\n`);
        try {
          job.child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          if (job.status === 'running' && job.child) {
            try {
              job.child.kill('SIGKILL');
            } catch {
              /* ignore */
            }
          }
        }, 10_000);
        job.error = `Timed out after ${timeoutMs}ms`;
      }
    }, timeoutMs);

    child.on('error', (err) => {
      job.status = 'error';
      job.error = redact(err.message);
      job.finishedAt = new Date().toISOString();
      appendLog(job, `\n[${logPrefix}] spawn error: ${job.error}\n`);
      if (job.timer) clearTimeout(job.timer);
    });

    child.on('close', (code, signal) => {
      if (job.timer) clearTimeout(job.timer);
      job.exitCode = code;
      job.finishedAt = new Date().toISOString();
      job.child = null;
      if (job.status === 'running') {
        if (signal) {
          job.status = 'error';
          job.error = job.error || `Killed by signal ${signal}`;
        } else if (code === 0 || code === 1) {
          // 0 = pass, 1 = threshold findings — both are successful runs
          job.status = 'complete';
        } else {
          job.status = 'error';
          job.error = `CLI exited with code ${code}`;
        }
      }
      appendLog(
        job,
        `\n[${logPrefix}] Finished status=${job.status} exit=${code} signal=${signal || '-'}\n`,
      );
    });

    return job;
  };
}

async function readArtifactSeverity(findingsPath) {
  if (!fs.existsSync(findingsPath)) return { severityCounts: null, highest: null };
  try {
    const findings = JSON.parse(await fsp.readFile(findingsPath, 'utf8'));
    const severityCounts = countSeverities(findings);
    const highest =
      ['critical', 'high', 'medium', 'low', 'informational'].find((s) => severityCounts[s] > 0) ||
      'none';
    return { severityCounts, highest };
  } catch {
    return { severityCounts: null, highest: null };
  }
}

async function listArtifactRunEntries(artifactsRoot = ARTIFACTS_ROOT) {
  await fsp.mkdir(artifactsRoot, { recursive: true });
  const entries = await fsp.readdir(artifactsRoot, { withFileTypes: true });
  const runs = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.')) continue;
    const dir = path.join(artifactsRoot, ent.name);
    try {
      assertInside(artifactsRoot, dir);
    } catch {
      continue;
    }
    const summaryPath = path.join(dir, 'summary.md');
    const reportPath = path.join(dir, 'report.html');
    const findingsPath = path.join(dir, 'json', 'findings.json');
    let mtimeMs = 0;
    try {
      mtimeMs = (await fsp.stat(dir)).mtimeMs;
    } catch {
      /* ignore */
    }
    runs.push({
      id: ent.name,
      mtimeMs,
      hasSummary: fs.existsSync(summaryPath),
      hasReport: fs.existsSync(reportPath),
      hasFindings: fs.existsSync(findingsPath),
      findingsPath,
    });
  }
  runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return runs;
}

async function enrichArtifactRunEntry(entry) {
  const { severityCounts, highest } = await readArtifactSeverity(entry.findingsPath);
  return {
    id: entry.id,
    mtimeMs: entry.mtimeMs,
    hasSummary: entry.hasSummary,
    hasReport: entry.hasReport,
    hasFindings: entry.hasFindings,
    severityCounts,
    highest,
  };
}

/**
 * Mount the artifact-serving routes that are byte-identical between v1 and
 * v2: summary.md, findings.json (top 25 by severity), report.html (sandboxed
 * CSP), and arbitrary run-relative files (screenshots/diffs) with strict
 * path-traversal checks.
 */
function mountArtifactRoutes(router) {
  router.get('/artifacts/:runId/summary', async (req, res) => {
    try {
      const runId = sanitizeRunId(req.params.runId);
      const file = assertInside(ARTIFACTS_ROOT, path.join(ARTIFACTS_ROOT, runId, 'summary.md'));
      if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: 'summary.md not found' });
      const text = redact(await fsp.readFile(file, 'utf8'));
      res.type('text/markdown').send(text);
    } catch (err) {
      res.status(400).json({ success: false, error: redact(err.message) });
    }
  });

  router.get('/artifacts/:runId/findings', async (req, res) => {
    try {
      const runId = sanitizeRunId(req.params.runId);
      const file = assertInside(
        ARTIFACTS_ROOT,
        path.join(ARTIFACTS_ROOT, runId, 'json', 'findings.json'),
      );
      if (!fs.existsSync(file)) {
        return res.status(404).json({ success: false, error: 'findings.json not found' });
      }
      const findings = JSON.parse(await fsp.readFile(file, 'utf8'));
      const severityCounts = countSeverities(findings);
      const top = (Array.isArray(findings) ? findings : [])
        .slice()
        .sort((a, b) => {
          const order = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 };
          return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
        })
        .slice(0, 25)
        .map((f) => ({
          id: f.id,
          title: f.title,
          severity: f.severity,
          category: f.category,
          summary: f.summary,
          page: f.page || (Array.isArray(f.routes) ? f.routes[0] : undefined),
          rule: f.rule || f.id,
          source: f.source,
          classification: f.classification,
          scope: f.scope,
        }));
      res.json({ success: true, severityCounts, findings: top, total: severityCounts.total });
    } catch (err) {
      res.status(400).json({ success: false, error: redact(err.message) });
    }
  });

  router.get('/artifacts/:runId/report', async (req, res) => {
    try {
      const runId = sanitizeRunId(req.params.runId);
      const file = assertInside(ARTIFACTS_ROOT, path.join(ARTIFACTS_ROOT, runId, 'report.html'));
      if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: 'report.html not found' });
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; script-src 'none'; frame-ancestors 'self'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.type('html');
      res.sendFile(file);
    } catch (err) {
      res.status(400).json({ success: false, error: redact(err.message) });
    }
  });

  /**
   * Serve a single file from an artifact run (screenshots, diffs, etc.).
   * Query: ?path=screenshots/foo.png  (relative to the run directory; no ..)
   * Used by the FE to rewrite relative img src when report.html is opened as a blob URL.
   */
  router.get('/artifacts/:runId/file', async (req, res) => {
    try {
      const runId = sanitizeRunId(req.params.runId);
      const relRaw = String(req.query.path || '').trim().replace(/\\/g, '/');
      if (!relRaw || relRaw.startsWith('/') || relRaw.includes('..')) {
        return res.status(400).json({ success: false, error: 'Invalid path' });
      }
      if (!/^[a-zA-Z0-9._\-\/]+$/.test(relRaw) || relRaw.length > 240) {
        return res.status(400).json({ success: false, error: 'Invalid path' });
      }
      const runRoot = assertInside(ARTIFACTS_ROOT, path.join(ARTIFACTS_ROOT, runId));
      if (!fs.existsSync(runRoot) || !fs.statSync(runRoot).isDirectory()) {
        return res.status(404).json({ success: false, error: 'Run not found' });
      }
      const file = assertInside(runRoot, path.join(runRoot, relRaw));
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }
      const ext = path.extname(file).toLowerCase();
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.gif'
                ? 'image/gif'
                : ext === '.html'
                  ? 'text/html; charset=utf-8'
                  : ext === '.md'
                    ? 'text/markdown; charset=utf-8'
                    : ext === '.json'
                      ? 'application/json; charset=utf-8'
                      : 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=300');
      if (ext === '.html') {
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; script-src 'none'; frame-ancestors 'self'",
        );
      }
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      res.status(400).json({ success: false, error: redact(err.message) });
    }
  });
}

module.exports = {
  OM_ROOT,
  TOOL_ROOT,
  ARTIFACTS_ROOT,
  PROJECT_ROOT,
  DEFAULT_CONFIG,
  MODES,
  FAIL_ON,
  SCOPES,
  PRESETS,
  ALLOWED_HOSTS,
  MAX_LOG_CHARS,
  MAX_CONCURRENT,
  TIMEOUT_MS,
  redact,
  appendLog,
  resolvePythonBin,
  assertInside,
  sanitizeRunId,
  hostAllowed,
  validateBaseUrl,
  validateScope,
  validatePreset,
  defaultRoutePrefixForScope,
  validateRoutePrefix,
  validateStorageState,
  publicJob,
  countSeverities,
  buildArgs,
  createStartJob,
  readArtifactSeverity,
  listArtifactRunEntries,
  enrichArtifactRunEntry,
  mountArtifactRoutes,
};
