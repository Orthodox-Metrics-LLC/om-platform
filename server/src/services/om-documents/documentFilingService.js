'use strict';

/**
 * Governed filing for OM Documents (plans → om-docs docs/internal/).
 * Approval does NOT write; File now performs the deterministic copy.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getAppPool } = require('../../config/db');
const documentService = require('./documentService');
const storage = require('./DocumentStorageService');
const { scanSecrets } = require('./secretScan');
const { assertUnderPlans } = require('./plansPaths');

let mirror;
try {
  mirror = require('../docsFilingApprovalMirror');
} catch {
  mirror = { mirrorFilingRequest: async () => null, mirrorFilingDecision: async () => null };
}

const CATEGORY_MAP = {
  architecture: { label: 'Architecture', dir: 'docs/internal/architecture' },
  'design-system': { label: 'Design System', dir: 'docs/internal/design-system' },
  'product-docs': { label: 'Product Docs', dir: 'docs/internal/product-docs' },
  'api-integrations': { label: 'API & Integrations', dir: 'docs/internal/api-integrations' },
  operations: { label: 'Operations', dir: 'docs/internal/operations' },
};

const CATEGORY_ALIASES = {
  architecture: 'architecture',
  'design system': 'design-system',
  'product docs': 'product-docs',
  product: 'product-docs',
  'api & integrations': 'api-integrations',
  'api integrations': 'api-integrations',
  api: 'api-integrations',
  operations: 'operations',
  ops: 'operations',
};

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
  return CATEGORY_ALIASES[collapsed] || null;
}

function slugify(name) {
  return String(name || 'document')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'document';
}

function validateTargetPath(proposedPath, canonicalCategory) {
  if (!proposedPath || typeof proposedPath !== 'string') {
    return { ok: false, error: 'TARGET_REQUIRED' };
  }
  let normalized = proposedPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..') || /[;&|`$<>(){}!*?\\"'\r\n\t]/.test(normalized)) {
    return { ok: false, error: 'INVALID_TARGET' };
  }
  const expectedRoot = CATEGORY_MAP[canonicalCategory]?.dir;
  if (!expectedRoot) return { ok: false, error: 'INVALID_CATEGORY' };
  if (!normalized.startsWith('docs/internal/')) {
    return { ok: false, error: 'MUST_BE_INTERNAL' };
  }
  if (!normalized.startsWith(`${expectedRoot}/`) && normalized !== `${expectedRoot}.md`) {
    if (!normalized.startsWith(expectedRoot)) {
      return { ok: false, error: 'CATEGORY_PATH_MISMATCH' };
    }
  }
  const ext = path.extname(normalized).toLowerCase();
  if (ext !== '.md' && ext !== '.mdx') {
    return { ok: false, error: 'INVALID_EXTENSION' };
  }
  return { ok: true, path: normalized };
}

function generateReceipt() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(5);
  let suffix = '';
  for (let i = 0; i < 5; i += 1) suffix += alphabet[bytes[i] % alphabet.length];
  return `OM-${suffix}`;
}

function listCategories() {
  return Object.entries(CATEGORY_MAP).map(([key, v]) => ({
    key,
    label: v.label,
    dir: v.dir,
  }));
}

async function createFilingRequest(documentId, {
  category,
  targetPath = null,
  reason = null,
  requestSource = 'om_documents_ui',
  actor = {},
} = {}) {
  const doc = await documentService.getByDocumentId(documentId);
  if (!doc || doc.deletedAt) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  const canonical = normalizeCategory(category);
  if (!canonical) throw Object.assign(new Error('INVALID_CATEGORY'), { code: 'INVALID_CATEGORY' });

  const proposed = targetPath
    || `${CATEGORY_MAP[canonical].dir}/${slugify(doc.title)}.md`;
  const validated = validateTargetPath(proposed, canonical);
  if (!validated.ok) {
    throw Object.assign(new Error(validated.error), { code: validated.error });
  }

  const file = storage.readPrimaryFile(doc.relativePath);
  if (file.text == null) {
    throw Object.assign(new Error('NOT_MARKDOWN'), { code: 'NOT_MARKDOWN' });
  }
  const secrets = scanSecrets(file.text);
  if (secrets.length) {
    const err = Object.assign(new Error('SECRET_SCAN_BLOCKED'), { code: 'SECRET_SCAN_BLOCKED' });
    err.secrets = secrets;
    throw err;
  }

  const receipt = generateReceipt();
  const pool = getAppPool();
  await pool.query(
    `INSERT INTO om_document_filing_requests (
      receipt, document_id, title, source_filename, proposed_target_path,
      category, visibility, requesting_actor_email, requesting_actor_name,
      request_source, reason, status, checksum
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      receipt,
      documentId,
      doc.title,
      doc.primaryFile,
      validated.path,
      canonical,
      'internal',
      actor.email || null,
      actor.name || null,
      requestSource,
      reason || 'Internal documentation filing request.',
      'approval_pending',
      file.sha256,
    ],
  );
  await pool.query(
    `UPDATE om_documents SET
      filing_state = 'approval_pending',
      filing_receipt = ?,
      proposed_category = ?,
      proposed_target_docs_path = ?
     WHERE document_id = ?`,
    [receipt, canonical, validated.path, documentId],
  );
  await documentService.recordAudit(documentId, 'filing_requested', actor, {
    receipt,
    target: validated.path,
  });

  try {
    await mirror.mirrorFilingRequest({
      receipt,
      pickup_id: documentId,
      title: doc.title,
      proposed_target_path: validated.path,
      category: canonical,
      visibility: 'internal',
      checksum: file.sha256,
      reason: reason || 'Internal documentation filing request.',
    });
  } catch {
    /* best-effort */
  }

  return {
    receipt,
    documentId,
    status: 'approval_pending',
    proposedTargetPath: validated.path,
    category: canonical,
  };
}

async function decideFiling(receipt, decision, { note = null, actor = {} } = {}) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT * FROM om_document_filing_requests WHERE receipt = ? LIMIT 1',
    [receipt],
  );
  const req = rows[0];
  if (!req) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  if (!['filing_requested', 'approval_pending'].includes(req.status)) {
    throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
  }
  const approved = decision === 'approve';
  const newStatus = approved ? 'approved_waiting_to_file' : 'rejected';
  const docState = approved ? 'approved_waiting_to_file' : 'rejected';
  await pool.query(
    `UPDATE om_document_filing_requests SET
      status = ?, decision_note = ?, decided_by_email = ?, decided_by_name = ?, decided_at = NOW()
     WHERE receipt = ?`,
    [newStatus, note, actor.email || null, actor.name || null, receipt],
  );
  await pool.query(
    'UPDATE om_documents SET filing_state = ? WHERE document_id = ?',
    [docState, req.document_id],
  );
  await documentService.recordAudit(req.document_id, approved ? 'filing_approved' : 'filing_rejected', actor, {
    receipt,
    note,
  });
  try {
    await mirror.mirrorFilingDecision({ receipt, decision: approved ? 'approved' : 'rejected', note });
  } catch {
    /* best-effort */
  }
  return { receipt, status: newStatus, documentId: req.document_id };
}

async function fileApprovedRequest(receipt, actor = {}) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT * FROM om_document_filing_requests WHERE receipt = ? LIMIT 1',
    [receipt],
  );
  const req = rows[0];
  if (!req) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  if (req.status !== 'approved_waiting_to_file') {
    throw Object.assign(new Error('NOT_APPROVED'), { code: 'NOT_APPROVED' });
  }
  const doc = await documentService.getByDocumentId(req.document_id);
  if (!doc) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });

  const file = storage.readPrimaryFile(doc.relativePath);
  if (file.sha256 !== req.checksum) {
    throw Object.assign(new Error('CHECKSUM_MISMATCH'), { code: 'CHECKSUM_MISMATCH' });
  }
  if (file.text == null) {
    throw Object.assign(new Error('NOT_MARKDOWN'), { code: 'NOT_MARKDOWN' });
  }
  const secrets = scanSecrets(file.text);
  if (secrets.length) {
    const err = Object.assign(new Error('SECRET_SCAN_BLOCKED'), { code: 'SECRET_SCAN_BLOCKED' });
    err.secrets = secrets;
    throw err;
  }

  const docsRoot = getDocsRepoRoot();
  const targetAbs = path.resolve(docsRoot, req.proposed_target_path);
  const relToDocs = path.relative(path.resolve(docsRoot), targetAbs);
  if (relToDocs.startsWith('..') || path.isAbsolute(relToDocs)) {
    throw Object.assign(new Error('PATH_TRAVERSAL'), { code: 'PATH_TRAVERSAL' });
  }
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  fs.writeFileSync(targetAbs, file.text, 'utf8');

  await pool.query(
    `UPDATE om_document_filing_requests SET
      status = 'filed', filed_docs_path = ?, filed_at = NOW(),
      filed_by_email = ?, filed_by_name = ?
     WHERE receipt = ?`,
    [req.proposed_target_path, actor.email || null, actor.name || null, receipt],
  );
  await pool.query(
    `UPDATE om_documents SET
      filing_state = 'filed', filed_docs_path = ?, filed_at = NOW()
     WHERE document_id = ?`,
    [req.proposed_target_path, req.document_id],
  );
  await documentService.recordAudit(req.document_id, 'filed', actor, {
    receipt,
    path: req.proposed_target_path,
  });
  return {
    receipt,
    documentId: req.document_id,
    filedDocsPath: req.proposed_target_path,
    status: 'filed',
  };
}

async function getFilingRequest(receipt) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT * FROM om_document_filing_requests WHERE receipt = ? LIMIT 1',
    [receipt],
  );
  return rows[0] || null;
}

async function listWaitingToFile() {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT * FROM om_document_filing_requests
     WHERE status = 'approved_waiting_to_file'
     ORDER BY decided_at DESC`,
  );
  return rows;
}

module.exports = {
  CATEGORY_MAP,
  listCategories,
  normalizeCategory,
  validateTargetPath,
  createFilingRequest,
  decideFiling,
  fileApprovedRequest,
  getFilingRequest,
  listWaitingToFile,
  getDocsRepoRoot,
  // silence unused import lint if tree-shaken
  assertUnderPlans,
};
