/**
 * docsPickupFilingService — governed internal-documentation filing for OM Docs
 * Pickup.
 *
 * Governance contract (mirrors settingsApprovalService / commit f50e85839):
 *   - A document destined for docs/internal/ is never filed on request. A filing
 *     request is recorded (state filing_requested → approval_pending) and a Brain
 *     Approval request is created in OMStudio.
 *   - OMBrain may request/track/explain/execute deterministic filing AFTER
 *     approval, but can never self-authorize placement. A human super_admin
 *     approves; only then does the doc become approved_waiting_to_file and
 *     eligible to be filed.
 *   - Filing is deterministic: copy the stored pickup file into the canonical
 *     docs/internal/<category>/ path in the om-docs repo, preserving checksum.
 *
 * pickup_id  : OMDOC-PICKUP-YYYYMMDD-XXXXX  (stable, unique, UI-visible)
 * receipt    : OM-XXXXX                     (5 uppercase alphanumerics)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getAppPool } = require('../config/db');
const { getFileById, getAbsoluteFilePath } = require('./docsPickupService');

let mirror;
try {
  mirror = require('./docsFilingApprovalMirror');
} catch {
  mirror = { mirrorFilingRequest: async () => null, mirrorFilingDecision: async () => null };
}

// ── Canonical category → docs/internal path mapping ─────────────────────────
const DOCS_INTERNAL_ROOT = 'docs/internal';
const CATEGORY_MAP = {
  architecture: { label: 'Architecture', dir: 'docs/internal/architecture' },
  'design-system': { label: 'Design System', dir: 'docs/internal/design-system' },
  'product-docs': { label: 'Product Docs', dir: 'docs/internal/product-docs' },
  'api-integrations': { label: 'API & Integrations', dir: 'docs/internal/api-integrations' },
  operations: { label: 'Operations', dir: 'docs/internal/operations' },
};
// Display-label aliases → canonical keys (case/space/punct-insensitive).
const CATEGORY_ALIASES = {
  architecture: 'architecture',
  'design system': 'design-system',
  designsystem: 'design-system',
  'product docs': 'product-docs',
  productdocs: 'product-docs',
  product: 'product-docs',
  'api & integrations': 'api-integrations',
  'api integrations': 'api-integrations',
  'api and integrations': 'api-integrations',
  apiintegrations: 'api-integrations',
  api: 'api-integrations',
  operations: 'operations',
  ops: 'operations',
};

const ALLOWED_DOC_EXTENSIONS = new Set(['.md', '.mdx']);
const SHELL_METACHAR = /[;&|`$<>(){}!*?\\"'\r\n\t]/;
const FILING_REQUEST_SOURCES = new Set(['ombrain_cli', 'ombrain_chat', 'omdocs_pickup_ui']);
const FILING_DOMAINS = ['documentation', 'internal_docs', 'filing'];
const FILING_REASON =
  'Internal documentation filing request. This document is proposed for '
  + 'docs/internal/ and requires human superadmin approval before it can be filed.';

function getDocsRepoRoot() {
  return process.env.OM_DOCS_REPO_ROOT || '/var/www/workspaces/om-docs';
}

function normalizeCategory(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (CATEGORY_MAP[raw]) return raw;
  const key = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
  const collapsed = key.replace(/[^a-z0-9]/g, '');
  if (CATEGORY_ALIASES[collapsed]) return CATEGORY_ALIASES[collapsed];
  return null;
}

function categoryLabel(canonical) {
  return CATEGORY_MAP[canonical] ? CATEGORY_MAP[canonical].label : canonical;
}

function slugify(name) {
  return String(name || 'document')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'document';
}

/**
 * Validate a proposed docs/internal target path. Returns { ok, path } (normalized
 * forward-slash relative path) or { ok:false, error }.
 */
function validateTargetPath(proposedPath, canonicalCategory) {
  if (!proposedPath || typeof proposedPath !== 'string') {
    return { ok: false, error: 'target path is required' };
  }
  const p = proposedPath.trim();
  if (!p) return { ok: false, error: 'target path is required' };
  if (path.isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p)) {
    return { ok: false, error: 'target path must be relative to the repo root' };
  }
  if (SHELL_METACHAR.test(p)) {
    return { ok: false, error: 'target path contains disallowed characters' };
  }
  if (p.split(/[\\/]/).some((seg) => seg === '..')) {
    return { ok: false, error: 'path traversal (..) is not allowed' };
  }
  const norm = p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
  if (!norm.startsWith(`${DOCS_INTERNAL_ROOT}/`)) {
    return { ok: false, error: `target path must be under ${DOCS_INTERNAL_ROOT}/` };
  }
  const ext = path.extname(norm).toLowerCase();
  if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
    return { ok: false, error: `unsupported extension ${ext || '(none)'} — only .md/.mdx` };
  }
  // Defense in depth: resolved absolute path must stay under <repoRoot>/docs/internal.
  const root = path.resolve(getDocsRepoRoot());
  const internalRoot = path.resolve(root, DOCS_INTERNAL_ROOT);
  const full = path.resolve(root, norm);
  if (full !== internalRoot && !full.startsWith(internalRoot + path.sep)) {
    return { ok: false, error: 'resolved target escapes docs/internal root' };
  }
  // If a category is supplied, the path must live under that category dir.
  if (canonicalCategory && CATEGORY_MAP[canonicalCategory]) {
    const catDir = `${CATEGORY_MAP[canonicalCategory].dir}/`;
    if (!norm.startsWith(catDir)) {
      return { ok: false, error: `path must be under ${CATEGORY_MAP[canonicalCategory].dir}/ for category ${canonicalCategory}` };
    }
  }
  return { ok: true, path: norm, absolute: full };
}

function defaultTargetPath(canonicalCategory, fileName) {
  const dir = CATEGORY_MAP[canonicalCategory] ? CATEGORY_MAP[canonicalCategory].dir : `${DOCS_INTERNAL_ROOT}/${canonicalCategory}`;
  return `${dir}/${slugify(fileName)}.md`;
}

// ── ID + receipt generation ─────────────────────────────────────────────────
function randomSuffix(len) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function genPickupId(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `OMDOC-PICKUP-${y}${m}${d}-${randomSuffix(5)}`;
}

async function genUniquePickupId(pool, date) {
  for (let i = 0; i < 12; i += 1) {
    const candidate = genPickupId(date);
    const [rows] = await pool.query('SELECT 1 FROM docs_pickup_files WHERE pickup_id = ? LIMIT 1', [candidate]);
    if (!rows.length) return candidate;
  }
  return `OMDOC-PICKUP-${Date.now()}-${randomSuffix(5)}`;
}

async function genUniqueReceipt(pool) {
  for (let i = 0; i < 20; i += 1) {
    const candidate = `OM-${randomSuffix(5)}`;
    const [a] = await pool.query('SELECT 1 FROM docs_pickup_filing_requests WHERE receipt = ? LIMIT 1', [candidate]);
    const [b] = await pool.query('SELECT 1 FROM docs_pickup_files WHERE filing_receipt = ? LIMIT 1', [candidate]);
    if (!a.length && !b.length) return candidate;
  }
  throw new Error('could not allocate a unique receipt');
}

/** Backfill pickup_id for any rows missing one. Idempotent, safe to call often. */
async function ensurePickupIds() {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT id, saved_at FROM docs_pickup_files WHERE pickup_id IS NULL OR pickup_id = \'\'',
  );
  for (const row of rows) {
    const when = row.saved_at ? new Date(row.saved_at) : new Date();
    const pickupId = await genUniquePickupId(pool, when);
    await pool.query('UPDATE docs_pickup_files SET pickup_id = ? WHERE id = ? AND (pickup_id IS NULL OR pickup_id = \'\')', [pickupId, row.id]);
  }
  return rows.length;
}

// ── audit / history helpers ─────────────────────────────────────────────────
async function recordAudit(pool, fileId, eventType, actor, details = null) {
  await pool.query(
    `INSERT INTO docs_pickup_audit_events (file_id, event_type, actor_id, actor_email, actor_name, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [fileId, eventType, actor?.id ?? null, actor?.email ?? null, actor?.name ?? null, details ? JSON.stringify(details) : null],
  );
}

async function recordStatusHistory(pool, receipt, fromState, toState, actor, source, note) {
  await pool.query(
    `INSERT INTO docs_pickup_filing_status_history (receipt, from_state, to_state, actor, source, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [receipt, fromState || null, toState, actor?.name || actor?.email || (typeof actor === 'string' ? actor : null), source || 'system', note || null],
  );
}

function requestRowToApi(row) {
  if (!row) return null;
  let domains = row.domains;
  if (typeof domains === 'string') { try { domains = JSON.parse(domains); } catch { /* keep */ } }
  return {
    receipt: row.receipt,
    pickupId: row.pickup_id,
    pickupFileId: row.pickup_file_id,
    title: row.title,
    sourceFilename: row.source_filename,
    proposedTargetPath: row.proposed_target_path,
    category: row.category,
    categoryLabel: categoryLabel(row.category),
    visibility: row.visibility,
    requestingActor: row.requesting_actor,
    requestSource: row.request_source,
    reason: row.reason,
    classification: row.classification,
    domains,
    checksum: row.checksum,
    status: row.status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    decisionNote: row.decision_note,
    filedDocsPath: row.filed_docs_path,
    filedBy: row.filed_by,
    filedAt: row.filed_at,
    filingError: row.filing_error,
    omstudioRef: row.omstudio_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getFilingRequestByReceipt(receipt) {
  const pool = getAppPool();
  const [rows] = await pool.query('SELECT * FROM docs_pickup_filing_requests WHERE receipt = ? LIMIT 1', [receipt]);
  return rows[0] || null;
}

/** Resolve a pickup file by pickup_id (OMDOC-PICKUP-...) or by internal uuid. */
async function resolvePickup(idOrPickupId) {
  const pool = getAppPool();
  await ensurePickupIds();
  if (/^OMDOC-PICKUP-/i.test(String(idOrPickupId))) {
    const [rows] = await pool.query('SELECT * FROM docs_pickup_files WHERE pickup_id = ? LIMIT 1', [idOrPickupId]);
    return rows[0] || null;
  }
  return getFileById(idOrPickupId);
}

// ── 1. Create a filing request (never files) ────────────────────────────────
async function createFilingRequest(input = {}) {
  const {
    idOrPickupId,
    category: categoryInput,
    visibility = 'internal',
    targetPath: targetPathInput,
    title: titleInput,
    requestingActor,
    requestSource = 'omdocs_pickup_ui',
    actor = null,
  } = input;

  const pool = getAppPool();
  await ensurePickupIds();

  if (!FILING_REQUEST_SOURCES.has(requestSource)) {
    return { ok: false, error: `invalid request_source: ${requestSource}` };
  }

  const row = await resolvePickup(idOrPickupId);
  if (!row) return { ok: false, error: 'pickup item not found' };
  if (row.status === 'deleted') return { ok: false, error: 'pickup item is deleted' };

  // File must exist on disk and match its recorded checksum.
  const filePath = getAbsoluteFilePath(row);
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'pickup file is not present on disk' };
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (row.sha256 && row.sha256 !== actualHash) {
    return { ok: false, error: 'checksum mismatch — pickup file changed on disk' };
  }

  const canonical = normalizeCategory(categoryInput || row.proposed_category);
  if (!canonical) {
    return { ok: false, error: `category is required — one of: ${Object.values(CATEGORY_MAP).map((c) => c.label).join(', ')}` };
  }

  const title = (titleInput || row.title || row.original_file_name || '').toString().slice(0, 255) || row.original_file_name;
  const targetPath = (targetPathInput && targetPathInput.trim())
    ? targetPathInput.trim()
    : defaultTargetPath(canonical, title || row.original_file_name);
  const pathCheck = validateTargetPath(targetPath, canonical);
  if (!pathCheck.ok) return { ok: false, error: pathCheck.error };

  // Prevent duplicate open request for the same pickup item.
  const [openRows] = await pool.query(
    "SELECT receipt FROM docs_pickup_filing_requests WHERE pickup_file_id = ? AND status IN ('submitted','approved') LIMIT 1",
    [row.id],
  );
  if (openRows.length) {
    return { ok: false, error: `an open filing request already exists for this item (${openRows[0].receipt})` };
  }

  const receipt = await genUniqueReceipt(pool);
  await pool.query(
    `INSERT INTO docs_pickup_filing_requests
      (receipt, pickup_file_id, pickup_id, title, source_filename, proposed_target_path, category,
       visibility, requesting_actor, request_source, reason, classification, domains, checksum, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
    [
      receipt, row.id, row.pickup_id, title, row.original_file_name, pathCheck.path, canonical,
      visibility, requestingActor || (actor && (actor.email || actor.name)) || 'ombrain', requestSource,
      FILING_REASON, 'requires_human_superadmin', JSON.stringify(FILING_DOMAINS), actualHash,
    ],
  );

  await pool.query(
    `UPDATE docs_pickup_files
       SET filing_state = 'approval_pending', filing_receipt = ?, title = ?,
           proposed_category = ?, proposed_visibility = ?, proposed_target_docs_path = ?
     WHERE id = ?`,
    [receipt, title, canonical, visibility, pathCheck.path, row.id],
  );

  await recordAudit(pool, row.id, 'filing_requested', actor, {
    receipt, category: canonical, target_path: pathCheck.path, request_source: requestSource, pickup_id: row.pickup_id,
  });
  await recordStatusHistory(pool, receipt, 'filing_requested', 'submitted', actor || requestingActor, 'create', null);

  // Mirror into OMStudio Brain Approvals (best-effort, non-blocking).
  let omstudioRef = null;
  try {
    const req = await getFilingRequestByReceipt(receipt);
    omstudioRef = await mirror.mirrorFilingRequest(requestRowToApi(req));
    if (omstudioRef) {
      await pool.query('UPDATE docs_pickup_filing_requests SET omstudio_ref = ? WHERE receipt = ?', [omstudioRef, receipt]);
    }
  } catch (e) {
    await recordAudit(pool, row.id, 'approval_submitted', { name: 'system' }, { receipt, mirror_error: e.message }).catch(() => {});
  }
  await recordAudit(pool, row.id, 'approval_submitted', actor || { name: 'system' }, { receipt, omstudio_ref: omstudioRef });

  const finalReq = await getFilingRequestByReceipt(receipt);
  return { ok: true, request: requestRowToApi(finalReq), pickup: { id: row.id, pickupId: row.pickup_id, filingState: 'approval_pending' } };
}

// ── 2. Approve (human super_admin only) ─────────────────────────────────────
async function approveFilingRequest(receipt, actor, note) {
  const pool = getAppPool();
  const req = await getFilingRequestByReceipt(receipt);
  if (!req) return { ok: false, error: 'filing request not found' };
  if (req.status !== 'submitted') return { ok: false, error: `request is ${req.status}; cannot approve` };

  const role = (actor && actor.role) || '';
  if (String(role).toLowerCase() !== 'super_admin') {
    return { ok: false, error: 'only a human super_admin can approve internal-doc filing' };
  }
  const approver = actor.email || actor.name || 'super_admin';

  await pool.query(
    `UPDATE docs_pickup_filing_requests SET status = 'approved', approved_by = ?, approved_at = NOW(), decision_note = ? WHERE receipt = ?`,
    [approver, note || null, receipt],
  );
  await pool.query(
    `UPDATE docs_pickup_files SET filing_state = 'approved_waiting_to_file' WHERE id = ?`,
    [req.pickup_file_id],
  );
  await recordAudit(pool, req.pickup_file_id, 'approved', actor, { receipt });
  await recordAudit(pool, req.pickup_file_id, 'waiting_to_file', actor, { receipt });
  await recordStatusHistory(pool, receipt, 'submitted', 'approved', actor, 'superadmin_decision', note || null);
  mirror.mirrorFilingDecision(req.omstudio_ref, 'approved', approver, note).catch(() => {});

  const finalReq = await getFilingRequestByReceipt(receipt);
  return { ok: true, request: requestRowToApi(finalReq) };
}

// ── 3. Reject ───────────────────────────────────────────────────────────────
async function rejectFilingRequest(receipt, actor, note) {
  const pool = getAppPool();
  const req = await getFilingRequestByReceipt(receipt);
  if (!req) return { ok: false, error: 'filing request not found' };
  if (req.status !== 'submitted') return { ok: false, error: `request is ${req.status}; cannot reject` };

  const role = (actor && actor.role) || '';
  if (String(role).toLowerCase() !== 'super_admin') {
    return { ok: false, error: 'only a human super_admin can reject internal-doc filing' };
  }
  const rejecter = actor.email || actor.name || 'super_admin';

  await pool.query(
    `UPDATE docs_pickup_filing_requests SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), decision_note = ? WHERE receipt = ?`,
    [rejecter, note || null, receipt],
  );
  await pool.query(`UPDATE docs_pickup_files SET filing_state = 'rejected' WHERE id = ?`, [req.pickup_file_id]);
  await recordAudit(pool, req.pickup_file_id, 'rejected', actor, { receipt, note: note || null });
  await recordStatusHistory(pool, receipt, 'submitted', 'rejected', actor, 'superadmin_decision', note || null);
  mirror.mirrorFilingDecision(req.omstudio_ref, 'rejected', rejecter, note).catch(() => {});

  const finalReq = await getFilingRequestByReceipt(receipt);
  return { ok: true, request: requestRowToApi(finalReq) };
}

// ── 4. File an approved request (deterministic placement into om-docs) ───────
async function fileApprovedRequest(receipt, actor, opts = {}) {
  const pool = getAppPool();
  const req = await getFilingRequestByReceipt(receipt);
  if (!req) return { ok: false, error: 'filing request not found' };
  if (req.status === 'filed') return { ok: false, error: 'request already filed' };
  if (req.status !== 'approved') return { ok: false, error: `request is ${req.status}; only approved requests can be filed` };

  const row = await getFileById(req.pickup_file_id);
  if (!row) return { ok: false, error: 'pickup item not found' };

  // Optionally re-target before filing (still fully validated).
  let targetPath = req.proposed_target_path;
  if (opts.overrideTargetPath && opts.overrideTargetPath !== req.proposed_target_path) {
    const check = validateTargetPath(opts.overrideTargetPath, req.category);
    if (!check.ok) return { ok: false, error: check.error };
    targetPath = check.path;
    await pool.query('UPDATE docs_pickup_filing_requests SET proposed_target_path = ? WHERE receipt = ?', [targetPath, receipt]);
  }
  const check = validateTargetPath(targetPath, req.category);
  if (!check.ok) return { ok: false, error: check.error };

  const srcPath = getAbsoluteFilePath(row);
  if (!srcPath || !fs.existsSync(srcPath)) {
    await markFilingFailed(pool, receipt, row.id, actor, 'source file missing on disk');
    return { ok: false, error: 'source file missing on disk' };
  }
  // Preserve checksum integrity: source must still match the requested checksum.
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(srcPath)).digest('hex');
  if (req.checksum && req.checksum !== actualHash) {
    await markFilingFailed(pool, receipt, row.id, actor, 'checksum mismatch at file time');
    return { ok: false, error: 'checksum mismatch — source changed since approval' };
  }

  try {
    const destAbs = check.absolute;
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(srcPath, destAbs);

    const filer = actor?.email || actor?.name || 'super_admin';
    await pool.query(
      `UPDATE docs_pickup_filing_requests SET status = 'filed', filed_docs_path = ?, filed_by = ?, filed_at = NOW() WHERE receipt = ?`,
      [check.path, filer, receipt],
    );
    await pool.query(
      `UPDATE docs_pickup_files
         SET filing_state = 'filed', filed_docs_path = ?, filed_at = NOW(),
             filed_by_id = ?, filed_by_email = ?, filed_by_name = ?
       WHERE id = ?`,
      [check.path, actor?.id ?? null, actor?.email ?? null, actor?.name ?? null, row.id],
    );
    await recordAudit(pool, row.id, 'filed', actor, { receipt, filed_docs_path: check.path, checksum: actualHash });
    await recordStatusHistory(pool, receipt, 'approved', 'filed', actor, 'system', check.path);

    const finalReq = await getFilingRequestByReceipt(receipt);
    return { ok: true, request: requestRowToApi(finalReq), filedPath: check.path, absolutePath: destAbs };
  } catch (e) {
    await markFilingFailed(pool, receipt, row.id, actor, e.message);
    return { ok: false, error: `filing failed: ${e.message}` };
  }
}

async function markFilingFailed(pool, receipt, fileId, actor, message) {
  await pool.query(`UPDATE docs_pickup_filing_requests SET status = 'failed', filing_error = ? WHERE receipt = ?`, [message, receipt]);
  await pool.query(`UPDATE docs_pickup_files SET filing_state = 'failed' WHERE id = ?`, [fileId]);
  await recordAudit(pool, fileId, 'failed', actor, { receipt, error: message });
  await recordStatusHistory(pool, receipt, 'approved', 'failed', actor, 'system', message);
}

// ── read helpers ─────────────────────────────────────────────────────────────
async function listFilingRequests({ status, limit = 100 } = {}) {
  const pool = getAppPool();
  let sql = 'SELECT * FROM docs_pickup_filing_requests WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Number(limit));
  const [rows] = await pool.query(sql, params);
  return rows.map(requestRowToApi);
}

async function listWaitingToFile() {
  return listFilingRequests({ status: 'approved' });
}

async function getFilingRequest(receipt) {
  const req = await getFilingRequestByReceipt(receipt);
  if (!req) return null;
  const pool = getAppPool();
  const [hist] = await pool.query(
    'SELECT from_state, to_state, actor, source, note, changed_at FROM docs_pickup_filing_status_history WHERE receipt = ? ORDER BY id ASC',
    [receipt],
  );
  return { ...requestRowToApi(req), statusHistory: hist };
}

module.exports = {
  CATEGORY_MAP,
  DOCS_INTERNAL_ROOT,
  FILING_REASON,
  FILING_DOMAINS,
  getDocsRepoRoot,
  normalizeCategory,
  categoryLabel,
  slugify,
  validateTargetPath,
  defaultTargetPath,
  genPickupId,
  genUniquePickupId,
  genUniqueReceipt,
  ensurePickupIds,
  resolvePickup,
  createFilingRequest,
  approveFilingRequest,
  rejectFilingRequest,
  fileApprovedRequest,
  listFilingRequests,
  listWaitingToFile,
  getFilingRequest,
  getFilingRequestByReceipt,
  requestRowToApi,
};
