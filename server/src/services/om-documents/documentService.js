'use strict';

const crypto = require('crypto');
const path = require('path');
const { getAppPool } = require('../../config/db');
const { generateUniqueDocumentId, isValidDocumentId } = require('./documentId');
const {
  PRODUCER_TO_SOURCE,
  SOURCE_TO_PRODUCER,
  WORKING_HORIZONS,
} = require('./plansPaths');
const storage = require('./DocumentStorageService');
const { scanSecrets } = require('./secretScan');

function uuid() {
  return crypto.randomUUID();
}

function actorFields(actor = {}) {
  return {
    id: actor.id || actor.userId || null,
    email: actor.email || null,
    name: actor.name || actor.displayName || null,
  };
}

async function documentIdExists(documentId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT document_id FROM om_documents WHERE document_id = ? LIMIT 1',
    [documentId],
  );
  return rows.length > 0;
}

async function recordAudit(documentId, eventType, actor, details = null) {
  const pool = getAppPool();
  const a = actorFields(actor);
  await pool.query(
    `INSERT INTO om_document_audit_events
      (document_id, event_type, actor_id, actor_email, actor_name, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [documentId, eventType, a.id, a.email, a.name, details ? JSON.stringify(details) : null],
  );
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    description: row.description,
    source: row.source,
    producer: row.producer,
    lifecycle: row.lifecycle,
    physicalPath: row.physical_path,
    relativePath: row.relative_path,
    primaryFile: row.primary_file,
    horizon: row.horizon,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    sha256: row.sha256,
    parentDocumentId: row.parent_document_id,
    relatedDispatchId: row.related_dispatch_id,
    workPacketId: row.work_packet_id,
    viewedAt: row.viewed_at,
    downloadedAt: row.downloaded_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    quarantineReason: row.quarantine_reason,
    legacy: row.legacy_json
      ? (typeof row.legacy_json === 'string' ? JSON.parse(row.legacy_json) : row.legacy_json)
      : null,
    metadata: row.metadata_json
      ? (typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json)
      : null,
    filingState: row.filing_state,
    filingReceipt: row.filing_receipt,
    proposedCategory: row.proposed_category,
    proposedTargetDocsPath: row.proposed_target_docs_path,
    filedDocsPath: row.filed_docs_path,
    filedAt: row.filed_at,
    createdBy: {
      id: row.created_by_id,
      email: row.created_by_email,
      name: row.created_by_name,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getByDocumentId(documentId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT * FROM om_documents WHERE document_id = ? LIMIT 1',
    [documentId],
  );
  return mapRow(rows[0]);
}

async function getById(id) {
  const pool = getAppPool();
  const [rows] = await pool.query('SELECT * FROM om_documents WHERE id = ? LIMIT 1', [id]);
  return mapRow(rows[0]);
}

async function listDocuments({
  lifecycle = null,
  source = null,
  q = null,
  includeDeleted = false,
  limit = 200,
  offset = 0,
} = {}) {
  const pool = getAppPool();
  const where = [];
  const params = [];
  if (!includeDeleted) {
    where.push('deleted_at IS NULL');
  }
  if (lifecycle && lifecycle !== 'all') {
    where.push('lifecycle = ?');
    params.push(lifecycle);
  }
  if (source) {
    where.push('source = ?');
    params.push(source);
  }
  if (q) {
    where.push('(title LIKE ? OR document_id LIKE ? OR description LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [counts] = await pool.query(
    `SELECT lifecycle, COUNT(*) AS cnt FROM om_documents
     WHERE deleted_at IS NULL GROUP BY lifecycle`,
  );
  const countMap = Object.fromEntries(counts.map((r) => [r.lifecycle, Number(r.cnt)]));
  const [rows] = await pool.query(
    `SELECT * FROM om_documents ${sqlWhere}
     ORDER BY updated_at DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit) || 200, Number(offset) || 0],
  );
  return {
    items: rows.map(mapRow),
    counts: countMap,
  };
}

async function createDocument({
  title,
  description = null,
  producer = 'manual',
  source = null,
  content,
  primaryFileName = 'document.md',
  attachments = [],
  parentDocumentId = null,
  relatedDispatchId = null,
  workPacketId = null,
  legacy = null,
  metadata = null,
  actor = {},
}) {
  const a = actorFields(actor);
  const resolvedSource = source || PRODUCER_TO_SOURCE[producer] || 'HUMAN';
  const resolvedProducer = producer || SOURCE_TO_PRODUCER[resolvedSource] || 'manual';
  const documentId = await generateUniqueDocumentId(documentIdExists);
  const created = storage.createDocument({
    documentId,
    title: title || documentId,
    producer: resolvedProducer,
    source: resolvedSource,
    lifecycle: 'inbox',
    primaryFileName,
    contentBuffer: content,
    attachments,
    legacy,
    parentDocumentId,
    relatedDispatchId,
  });
  const id = uuid();
  const pool = getAppPool();
  await pool.query(
    `INSERT INTO om_documents (
      id, document_id, title, description, source, producer, lifecycle,
      physical_path, relative_path, primary_file, mime_type, size_bytes, sha256,
      parent_document_id, related_dispatch_id, work_packet_id,
      created_by_id, created_by_email, created_by_name,
      updated_by_id, updated_by_email, updated_by_name,
      legacy_json, metadata_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      documentId,
      title || documentId,
      description,
      resolvedSource,
      resolvedProducer,
      'inbox',
      created.packageDir,
      created.relativePath,
      created.primaryFile,
      path.extname(created.primaryFile).toLowerCase() === '.md' ? 'text/markdown' : null,
      created.sizeBytes,
      created.sha256,
      parentDocumentId,
      relatedDispatchId,
      workPacketId,
      a.id,
      a.email,
      a.name,
      a.id,
      a.email,
      a.name,
      legacy ? JSON.stringify(legacy) : null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
  await recordAudit(documentId, 'created', a, {
    relative_path: created.relativePath,
    producer: resolvedProducer,
  });
  return getByDocumentId(documentId);
}

async function moveDocument(documentId, { lifecycle, horizon = null, producer = null }, actor = {}) {
  const doc = await getByDocumentId(documentId);
  if (!doc || doc.deletedAt) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  if (lifecycle === 'working' && horizon && !WORKING_HORIZONS.has(horizon)) {
    throw Object.assign(new Error('INVALID_HORIZON'), { code: 'INVALID_HORIZON' });
  }
  const a = actorFields(actor);
  const moved = storage.moveDocument(doc.relativePath, {
    lifecycle,
    producer: producer || doc.producer,
    horizon: lifecycle === 'working' ? (horizon || '24-hours-out') : null,
    documentId: doc.documentId,
  });
  const pool = getAppPool();
  await pool.query(
    `UPDATE om_documents SET
      lifecycle = ?, horizon = ?, physical_path = ?, relative_path = ?,
      updated_by_id = ?, updated_by_email = ?, updated_by_name = ?,
      quarantine_reason = CASE WHEN ? = 'quarantined' THEN quarantine_reason ELSE NULL END
     WHERE document_id = ?`,
    [
      lifecycle,
      lifecycle === 'working' ? (horizon || '24-hours-out') : null,
      moved.packageDir,
      moved.relativePath,
      a.id,
      a.email,
      a.name,
      lifecycle,
      documentId,
    ],
  );
  await recordAudit(documentId, 'moved', a, {
    from: doc.lifecycle,
    to: lifecycle,
    horizon: lifecycle === 'working' ? (horizon || '24-hours-out') : null,
    relative_path: moved.relativePath,
  });
  return getByDocumentId(documentId);
}

async function archiveDocument(documentId, actor = {}) {
  return moveDocument(documentId, { lifecycle: 'archived' }, actor);
}

async function quarantineDocument(documentId, reason, actor = {}) {
  const doc = await getByDocumentId(documentId);
  if (!doc) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  const updated = await moveDocument(documentId, { lifecycle: 'quarantined' }, actor);
  const pool = getAppPool();
  await pool.query(
    'UPDATE om_documents SET quarantine_reason = ? WHERE document_id = ?',
    [reason || 'quarantined', documentId],
  );
  await recordAudit(documentId, 'quarantined', actorFields(actor), { reason });
  return getByDocumentId(documentId) || updated;
}

async function updateDocument(documentId, patch, actor = {}) {
  const doc = await getByDocumentId(documentId);
  if (!doc || doc.deletedAt) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  const a = actorFields(actor);
  const fields = [];
  const params = [];
  if (patch.title != null) {
    fields.push('title = ?');
    params.push(String(patch.title).slice(0, 500));
  }
  if (patch.description !== undefined) {
    fields.push('description = ?');
    params.push(patch.description);
  }
  if (!fields.length) return doc;
  fields.push('updated_by_id = ?', 'updated_by_email = ?', 'updated_by_name = ?');
  params.push(a.id, a.email, a.name, documentId);
  const pool = getAppPool();
  await pool.query(
    `UPDATE om_documents SET ${fields.join(', ')} WHERE document_id = ?`,
    params,
  );
  await recordAudit(documentId, 'metadata_updated', a, patch);
  return getByDocumentId(documentId);
}

async function readContent(documentId, { markViewed = false } = {}, actor = {}) {
  const doc = await getByDocumentId(documentId);
  if (!doc || doc.deletedAt) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  const file = storage.readPrimaryFile(doc.relativePath);
  const warnings = file.text != null ? scanSecrets(file.text) : [];
  if (markViewed) {
    const a = actorFields(actor);
    const pool = getAppPool();
    await pool.query(
      `UPDATE om_documents SET viewed_at = NOW(), viewed_by_id = ?, viewed_by_email = ?, viewed_by_name = ?
       WHERE document_id = ?`,
      [a.id, a.email, a.name, documentId],
    );
    await recordAudit(documentId, 'viewed', a, null);
  }
  return { document: doc, ...file, secretWarnings: warnings };
}

async function writeContent(documentId, content, actor = {}) {
  const doc = await getByDocumentId(documentId);
  if (!doc || doc.deletedAt) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  const a = actorFields(actor);
  const result = storage.writePrimaryFile(doc.relativePath, content);
  const pool = getAppPool();
  await pool.query(
    `UPDATE om_documents SET
      size_bytes = ?, sha256 = ?,
      edited_at = NOW(), edited_by_id = ?, edited_by_email = ?, edited_by_name = ?,
      updated_by_id = ?, updated_by_email = ?, updated_by_name = ?
     WHERE document_id = ?`,
    [result.sizeBytes, result.sha256, a.id, a.email, a.name, a.id, a.email, a.name, documentId],
  );
  await recordAudit(documentId, 'edited', a, { size_bytes: result.sizeBytes });
  return getByDocumentId(documentId);
}

async function markDownloaded(documentId, actor = {}) {
  const doc = await getByDocumentId(documentId);
  if (!doc || doc.deletedAt) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  const a = actorFields(actor);
  const pool = getAppPool();
  await pool.query(
    `UPDATE om_documents SET downloaded_at = NOW(), downloaded_by_id = ?, downloaded_by_email = ?, downloaded_by_name = ?
     WHERE document_id = ?`,
    [a.id, a.email, a.name, documentId],
  );
  await recordAudit(documentId, 'downloaded', a, null);
  return storage.readPrimaryFile(doc.relativePath);
}

async function listAudit(documentId, limit = 100) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT * FROM om_document_audit_events
     WHERE document_id = ? ORDER BY created_at DESC LIMIT ?`,
    [documentId, Number(limit) || 100],
  );
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    eventType: r.event_type,
    actor: { id: r.actor_id, email: r.actor_email, name: r.actor_name },
    details: r.details
      ? (typeof r.details === 'string' ? JSON.parse(r.details) : r.details)
      : null,
    createdAt: r.created_at,
  }));
}

/**
 * Reconcile FS packages with DB. Never destroys data.
 */
async function reconcile({ includeAllLifecycles = true } = {}, actor = {}) {
  const scanned = storage.scanPackages({ includeAllLifecycles });
  const pool = getAppPool();
  const [dbRows] = await pool.query(
    'SELECT document_id, relative_path, lifecycle, deleted_at FROM om_documents',
  );
  const byId = new Map(dbRows.map((r) => [r.document_id, r]));
  const report = {
    registered: [],
    alreadyPresent: [],
    flagged: [],
    missingOnDisk: [],
    duplicates: [],
  };
  const seenIds = new Set();

  for (const pkg of scanned) {
    if (seenIds.has(pkg.documentId)) {
      report.duplicates.push(pkg);
      continue;
    }
    seenIds.add(pkg.documentId);
    if (!pkg.ok) {
      report.flagged.push(pkg);
      continue;
    }
    const existing = byId.get(pkg.documentId);
    if (!existing) {
      const id = uuid();
      const manifest = pkg.manifest || {};
      const primary = storage.getDocumentPackage(pkg.packageDir);
      let sizeBytes = 0;
      let sha = null;
      try {
        const file = storage.readPrimaryFile(pkg.packageDir);
        sizeBytes = file.sizeBytes;
        sha = file.sha256;
      } catch {
        /* ignore */
      }
      await pool.query(
        `INSERT INTO om_documents (
          id, document_id, title, description, source, producer, lifecycle,
          physical_path, relative_path, primary_file, horizon, size_bytes, sha256,
          parent_document_id, related_dispatch_id, created_by_name
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          pkg.documentId,
          manifest.title || pkg.documentId,
          null,
          manifest.source || PRODUCER_TO_SOURCE[pkg.producer] || 'SYSTEM',
          pkg.producer || SOURCE_TO_PRODUCER[manifest.source] || 'manual',
          pkg.lifecycle,
          pkg.packageDir,
          pkg.relativePath,
          manifest.primary_file || primary?.primaryFile || 'document.md',
          pkg.horizon,
          sizeBytes,
          sha,
          manifest.parent_document_id || null,
          manifest.related_dispatch_id || null,
          'reconcile',
        ],
      );
      await recordAudit(pkg.documentId, 'reconciled_registered', actorFields(actor), {
        relative_path: pkg.relativePath,
      });
      report.registered.push(pkg);
    } else {
      if (existing.relative_path !== pkg.relativePath) {
        report.flagged.push({
          ...pkg,
          issues: [...(pkg.issues || []), 'db_path_mismatch'],
          dbRelativePath: existing.relative_path,
        });
      } else {
        report.alreadyPresent.push(pkg.documentId);
      }
    }
  }

  for (const row of dbRows) {
    if (row.deleted_at) continue;
    if (!seenIds.has(row.document_id)) {
      const verified = storage.verifyFilesystemState(row.relative_path);
      if (!verified.ok) {
        report.missingOnDisk.push({
          documentId: row.document_id,
          relativePath: row.relative_path,
          issues: verified.issues,
        });
      }
    }
  }

  return report;
}

module.exports = {
  mapRow,
  getByDocumentId,
  getById,
  listDocuments,
  createDocument,
  moveDocument,
  archiveDocument,
  quarantineDocument,
  updateDocument,
  readContent,
  writeContent,
  markDownloaded,
  listAudit,
  reconcile,
  recordAudit,
  documentIdExists,
  isValidDocumentId,
};
