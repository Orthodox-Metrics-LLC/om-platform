/**
 * OM Docs Pickup — persistent document handoff with DB metadata + disk storage.
 *
 * Storage layout:
 *   storage/docs-pickup/files/     — canonical stored files
 *   storage/docs-pickup/incoming/  — agent drop dirs: <timestamp>-<slug>/
 *   storage/docs-pickup/index.json — legacy index (migrated on sync)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getAppPool } = require('../config/db');

const ALLOWED_EXTENSIONS = new Set(['.md', '.html', '.txt', '.pdf', '.zip', '.json', '.csv', '.docx']);
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.sh', '.bat', '.cmd', '.com', '.msi', '.app', '.deb', '.rpm',
  '.jar', '.bin', '.so', '.dylib', '.php', '.phtml', '.cgi', '.pl', '.rb',
]);
const PREVIEW_TEXT_EXTENSIONS = new Set(['.md', '.txt', '.html']);
const PREVIEW_JSON_EXTENSIONS = new Set(['.json', '.csv']);
const PREVIEW_METADATA_ONLY_EXTENSIONS = new Set(['.pdf', '.zip', '.docx']);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const AGENT_PATH_PREFIX = 'storage/docs-pickup';
const INCOMING_PROCESSED_SUFFIX = '.processed';
const VALID_STATUSES = new Set([
  'waiting', 'viewed', 'downloaded', 'picked_up', 'archived', 'expired', 'deleted',
]);
const TAB_STATUS_MAP = {
  waiting: ['waiting', 'viewed', 'downloaded'],
  picked_up: ['picked_up'],
  archived: ['archived'],
  deleted: ['deleted'],
  expired: ['expired'],
  all: null,
};

const MIME_MAP = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const SECRET_PATTERNS = [
  { name: 'JWT', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'API key / token', pattern: /(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|auth[_-]?token)\s*[:=]\s*['"]?[\w-]{12,}/gi },
  { name: 'Bearer token', pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

function getStorageRoot() {
  if (process.env.DOCS_PICKUP_ROOT) return process.env.DOCS_PICKUP_ROOT;
  return path.join('/var/www/orthodoxmetrics/prod', 'storage', 'docs-pickup');
}

function getFilesDir() {
  return path.join(getStorageRoot(), 'files');
}

function getIncomingDir() {
  return path.join(getStorageRoot(), 'incoming');
}

function getLegacyIndexPath() {
  return path.join(getStorageRoot(), 'index.json');
}

function ensureStorageDirs() {
  const root = getStorageRoot();
  for (const dir of [root, getFilesDir(), getIncomingDir()]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeOriginalName(name) {
  const base = path.basename(String(name || 'file'));
  return base.replace(/[^\w.\- ()[\]]+/g, '_').replace(/^\.+/, '').slice(0, 200) || 'file';
}

function validateExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!ext) return { ok: false, reason: 'File must have an extension' };
  if (BLOCKED_EXTENSIONS.has(ext)) return { ok: false, reason: `Extension ${ext} is not allowed` };
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `Only ${[...ALLOWED_EXTENSIONS].join(', ')} files are allowed` };
  }
  return { ok: true, ext };
}

function resolveUnderRoot(relativePath) {
  const root = path.resolve(getStorageRoot());
  const full = path.resolve(root, relativePath);
  if (!full.startsWith(root + path.sep) && full !== root) return null;
  return full;
}

function guessMime(ext) {
  return MIME_MAP[ext] || 'application/octet-stream';
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function toIso(dt) {
  if (!dt) return null;
  if (dt instanceof Date) return dt.toISOString();
  return new Date(dt).toISOString();
}

function rowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    pickupId: row.pickup_id || null,
    // Grouping (Phase 1) — additive; null/'standalone' for ungrouped rows and for
    // databases where the 20260713 grouping migration has not yet been applied.
    parentId: row.parent_id || null,
    groupId: row.group_id || null,
    relationType: row.relation_type || 'standalone',
    groupTitle: row.group_title || null,
    savedAtDay: toIso(row.saved_at) ? toIso(row.saved_at).slice(0, 10) : null,
    fileName: row.file_name,
    originalName: row.original_file_name,
    originalFileName: row.original_file_name,
    title: row.title || null,
    filingState: row.filing_state || 'none',
    filingReceipt: row.filing_receipt || null,
    proposedCategory: row.proposed_category || null,
    proposedVisibility: row.proposed_visibility || null,
    proposedTargetDocsPath: row.proposed_target_docs_path || null,
    filedDocsPath: row.filed_docs_path || null,
    filedAt: toIso(row.filed_at),
    storagePath: row.storage_path,
    agentPath: row.agent_path,
    description: row.description,
    status: row.status,
    savedBy: {
      id: row.saved_by_id,
      email: row.saved_by_email,
      name: row.saved_by_name || row.saved_by_email || 'unknown',
      role: null,
    },
    savedAt: toIso(row.saved_at),
    viewedAt: toIso(row.viewed_at),
    viewedBy: row.viewed_by_id || row.viewed_by_email ? {
      id: row.viewed_by_id,
      email: row.viewed_by_email,
      name: row.viewed_by_name,
      role: null,
    } : null,
    downloadedAt: toIso(row.downloaded_at),
    downloadedBy: row.downloaded_by_id || row.downloaded_by_email ? {
      id: row.downloaded_by_id,
      email: row.downloaded_by_email,
      name: row.downloaded_by_name,
      role: null,
    } : null,
    downloadCount: row.download_count || 0,
    pickedUpAt: toIso(row.picked_up_at),
    pickedUpBy: row.picked_up_by_id || row.picked_up_by_email ? {
      id: row.picked_up_by_id,
      email: row.picked_up_by_email,
      name: row.picked_up_by_name,
      role: null,
    } : null,
    archivedAt: toIso(row.archived_at),
    archivedBy: row.archived_by_id || row.archived_by_email ? {
      id: row.archived_by_id,
      email: row.archived_by_email,
      name: row.archived_by_name,
      role: null,
    } : null,
    deletedAt: toIso(row.deleted_at),
    deletedBy: row.deleted_by_id || row.deleted_by_email ? {
      id: row.deleted_by_id,
      email: row.deleted_by_email,
      name: row.deleted_by_name,
      role: null,
    } : null,
    size: row.size_bytes,
    sizeBytes: row.size_bytes,
    mimeType: row.mime_type,
    sha256: row.sha256,
    notes: row.notes,
    metadataJson: row.metadata_json,
    storedName: row.file_name,
  };
}

async function recordAuditEvent(pool, fileId, eventType, actor, details = null) {
  await pool.query(
    `INSERT INTO docs_pickup_audit_events
      (file_id, event_type, actor_id, actor_email, actor_name, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      fileId,
      eventType,
      actor?.id ?? null,
      actor?.email ?? null,
      actor?.name ?? null,
      details ? JSON.stringify(details) : null,
    ],
  );
}

function isProcessedIncomingDir(dirName) {
  return typeof dirName === 'string' && dirName.endsWith(INCOMING_PROCESSED_SUFFIX);
}

async function fileRecordExists(pool, { id, storagePath, sha256 } = {}) {
  if (id) {
    const [byId] = await pool.query(
      'SELECT id FROM docs_pickup_files WHERE id = ? LIMIT 1',
      [id],
    );
    if (byId.length) return byId[0].id;
  }
  if (storagePath) {
    const normalized = storagePath.replace(/\\/g, '/');
    const [byPath] = await pool.query(
      'SELECT id FROM docs_pickup_files WHERE storage_path = ? LIMIT 1',
      [normalized],
    );
    if (byPath.length) return byPath[0].id;
  }
  if (sha256) {
    const [byHash] = await pool.query(
      'SELECT id FROM docs_pickup_files WHERE sha256 = ? LIMIT 1',
      [sha256],
    );
    if (byHash.length) return byHash[0].id;
  }
  return null;
}

async function insertFileRecord(pool, record, actor = null) {
  const existingId = await fileRecordExists(pool, {
    id: record.id,
    storagePath: record.storagePath,
    sha256: record.sha256,
  });
  if (existingId) return existingId;

  const columns = [
    'id', 'file_name', 'original_file_name', 'storage_path', 'agent_path', 'description', 'status',
    'saved_by_id', 'saved_by_email', 'saved_by_name', 'saved_at',
    'size_bytes', 'mime_type', 'sha256', 'notes', 'metadata_json',
  ];
  const values = [
    record.id,
    record.fileName,
    record.originalFileName,
    record.storagePath,
    record.agentPath,
    record.description || null,
    record.status || 'waiting',
    record.savedBy?.id ?? null,
    record.savedBy?.email ?? null,
    record.savedBy?.name ?? 'agent',
    record.savedAt ? new Date(record.savedAt) : new Date(),
    record.sizeBytes || 0,
    record.mimeType || null,
    record.sha256 || null,
    record.notes || null,
    record.metadataJson ? JSON.stringify(record.metadataJson) : null,
  ];

  // Optional Phase 1 grouping passthrough. Only reference the new columns when a
  // value is actually supplied, so this INSERT stays valid on databases where the
  // 20260713 grouping migration has not yet been applied (no behavior change when
  // parentPickupId/groupId are absent, which is the default).
  if (record.parentId || record.groupId) {
    if (record.parentId) { columns.push('parent_id'); values.push(record.parentId); }
    if (record.groupId) { columns.push('group_id'); values.push(record.groupId); }
    columns.push('relation_type');
    values.push(record.relationType || (record.parentId ? 'child' : 'standalone'));
  }

  await pool.query(
    `INSERT INTO docs_pickup_files (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    values,
  );
  await recordAuditEvent(pool, record.id, 'file_registered', actor || record.savedBy, {
    source: record.source || 'upload',
    originalFileName: record.originalFileName,
  });
  return record.id;
}

async function getFileById(id) {
  const pool = getAppPool();
  const [rows] = await pool.query('SELECT * FROM docs_pickup_files WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function listFiles(tab = 'waiting') {
  const pool = getAppPool();
  await syncAll();
  const statuses = TAB_STATUS_MAP[tab] ?? TAB_STATUS_MAP.waiting;
  let sql = 'SELECT * FROM docs_pickup_files';
  const params = [];
  if (statuses) {
    sql += ` WHERE status IN (${statuses.map(() => '?').join(', ')})`;
    params.push(...statuses);
  }
  sql += ' ORDER BY saved_at DESC';
  const [rows] = await pool.query(sql, params);
  return rows.map(rowToApi);
}

// Resolve an optional parent reference (raw docs_pickup_files.id OR public pickup_id)
// to the raw id. Returns null when the parent cannot be found so we never write an
// invalid self-referential FK (grouping passthrough stays a safe no-op).
async function resolveParentFileId(pool, ref) {
  if (!ref) return null;
  try {
    const [rows] = await pool.query(
      'SELECT id FROM docs_pickup_files WHERE id = ? OR pickup_id = ? LIMIT 1',
      [ref, ref],
    );
    return rows.length ? rows[0].id : null;
  } catch {
    return null;
  }
}

async function registerDiskFile(pool, opts) {
  const {
    sourcePath,
    storageRelative,
    originalFileName,
    description,
    savedBy,
    metadataJson,
    status,
    source,
    parentPickupId,
    groupId,
  } = opts;

  const ext = path.extname(originalFileName).toLowerCase();
  const id = path.basename(storageRelative, ext);
  const stat = fs.statSync(sourcePath);
  const sha256 = sha256File(sourcePath);
  const agentPath = `${AGENT_PATH_PREFIX}/${storageRelative.replace(/\\/g, '/')}`;

  // Optional grouping passthrough (Phase 1) — no-op unless a drop supplies these.
  const parentId = parentPickupId ? await resolveParentFileId(pool, parentPickupId) : null;

  const record = {
    id,
    fileName: path.basename(storageRelative),
    originalFileName: sanitizeOriginalName(originalFileName),
    storagePath: storageRelative.replace(/\\/g, '/'),
    agentPath,
    description: description || null,
    status: status || 'waiting',
    savedBy: savedBy || { id: null, email: null, name: 'agent', role: null },
    savedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
    mimeType: guessMime(ext),
    sha256,
    metadataJson: metadataJson || null,
    source: source || 'scan',
    parentId,
    groupId: groupId || null,
    relationType: parentId ? 'child' : undefined,
  };

  const insertedId = await insertFileRecord(pool, record, savedBy);

  // Phase 2: link metadata-supplied grouping hints into the group registry +
  // parent promotion. No-op unless parentPickupId/groupId were provided.
  if (parentId || groupId) {
    await reconcileRegisteredGrouping(pool, insertedId, {
      parentId,
      groupId: groupId || null,
      meta: metadataJson || {},
    }, savedBy);
  }

  return insertedId;
}

async function syncLegacyIndex(pool) {
  const indexPath = getLegacyIndexPath();
  if (!fs.existsSync(indexPath)) return;

  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } catch {
    return;
  }
  if (!Array.isArray(index.files)) return;

  const filesDir = getFilesDir();
  for (const entry of index.files) {
    if (!entry?.id || !entry?.storedName) continue;

    const [existing] = await pool.query(
      'SELECT id FROM docs_pickup_files WHERE id = ? LIMIT 1',
      [entry.id],
    );
    if (existing.length) continue;

    const legacyPath = path.join(getStorageRoot(), entry.storedName);
    if (!fs.existsSync(legacyPath)) continue;

    const ext = path.extname(entry.storedName).toLowerCase();
    const destRelative = `files/${entry.storedName}`;
    const destPath = path.join(filesDir, entry.storedName);
    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(legacyPath, destPath);
    }

    let status = 'waiting';
    if (entry.deleted) status = 'deleted';
    else if (entry.pickedUp) status = 'picked_up';

    await pool.query(
      `INSERT INTO docs_pickup_files (
        id, file_name, original_file_name, storage_path, agent_path, description, status,
        saved_by_id, saved_by_email, saved_by_name, saved_at,
        picked_up_at, picked_up_by_id, picked_up_by_email, picked_up_by_name,
        deleted_at, deleted_by_id, deleted_by_email, deleted_by_name,
        size_bytes, mime_type, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.storedName,
        entry.originalName || entry.storedName,
        destRelative,
        entry.agentPath || `${AGENT_PATH_PREFIX}/${entry.storedName}`,
        entry.description || null,
        status,
        entry.savedBy?.id ?? null,
        entry.savedBy?.email ?? null,
        entry.savedBy?.name || 'agent',
        entry.savedAt ? new Date(entry.savedAt) : new Date(),
        entry.pickedUpAt ? new Date(entry.pickedUpAt) : null,
        entry.pickedUpBy?.id ?? null,
        entry.pickedUpBy?.email ?? null,
        entry.pickedUpBy?.name ?? null,
        entry.deletedAt ? new Date(entry.deletedAt) : null,
        entry.deletedBy?.id ?? null,
        entry.deletedBy?.email ?? null,
        entry.deletedBy?.name ?? null,
        entry.size || 0,
        entry.mimeType || guessMime(ext),
        JSON.stringify({ migratedFromIndex: true }),
      ],
    );
    await recordAuditEvent(pool, entry.id, 'file_registered', entry.savedBy, {
      source: 'legacy_index_migration',
    });
  }
}

async function syncLegacyRootFiles(pool) {
  const root = getStorageRoot();
  const filesDir = getFilesDir();
  const names = fs.readdirSync(root).filter((name) => {
    if (name === 'index.json' || name === 'files' || name === 'incoming' || name.startsWith('.')) {
      return false;
    }
    const check = validateExtension(name);
    return check.ok;
  });

  for (const name of names) {
    const [existing] = await pool.query(
      'SELECT id FROM docs_pickup_files WHERE storage_path = ? OR file_name = ? LIMIT 1',
      [name, name],
    );
    if (existing.length) continue;

    const sourcePath = path.join(root, name);
    const destRelative = `files/${name}`;
    const destPath = path.join(filesDir, name);
    if (!fs.existsSync(destPath)) fs.copyFileSync(sourcePath, destPath);

    await registerDiskFile(pool, {
      sourcePath: destPath,
      storageRelative: destRelative,
      originalFileName: name,
      source: 'legacy_root_scan',
    });
  }
}

async function syncFilesDir(pool) {
  const filesDir = getFilesDir();
  if (!fs.existsSync(filesDir)) return;

  const names = fs.readdirSync(filesDir).filter((name) => {
    if (name.startsWith('.')) return false;
    return validateExtension(name).ok;
  });

  for (const name of names) {
    const storageRelative = `files/${name}`;
    const [existing] = await pool.query(
      'SELECT id FROM docs_pickup_files WHERE storage_path = ? LIMIT 1',
      [storageRelative],
    );
    if (existing.length) continue;

    const filePath = path.join(filesDir, name);
    await registerDiskFile(pool, {
      sourcePath: filePath,
      storageRelative,
      originalFileName: name,
      source: 'files_dir_scan',
    });
  }
}

async function syncIncomingDirs(pool) {
  const incomingDir = getIncomingDir();
  if (!fs.existsSync(incomingDir)) return;

  const dirs = fs.readdirSync(incomingDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !isProcessedIncomingDir(d.name));

  for (const dirEnt of dirs) {
    const dirName = dirEnt.name;
    const dirPath = path.join(incomingDir, dirName);

    let meta = {};
    const metaPath = path.join(dirPath, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {
        meta = {};
      }
    }

    const docFiles = fs.readdirSync(dirPath).filter((name) => {
      if (name === 'metadata.json' || name.startsWith('.')) return false;
      return validateExtension(name).ok;
    });

    let registeredAny = false;

    for (const docName of docFiles) {
      const sourcePath = path.join(dirPath, docName);
      const contentHash = sha256File(sourcePath);
      const existingId = await fileRecordExists(pool, { sha256: contentHash });
      if (existingId) continue;

      const ext = path.extname(docName).toLowerCase();
      const id = crypto.randomUUID();
      const storedName = `${id}${ext}`;
      const destRelative = `files/${storedName}`;
      const destPath = path.join(getFilesDir(), storedName);

      fs.copyFileSync(sourcePath, destPath);

      const savedBy = meta.savedBy || meta.saved_by || {
        id: meta.saved_by_id ?? null,
        email: meta.saved_by_email ?? null,
        name: meta.saved_by_name || meta.agent || 'agent',
      };

      await registerDiskFile(pool, {
        sourcePath: destPath,
        storageRelative: destRelative,
        originalFileName: meta.originalFileName || meta.original_file_name || docName,
        description: meta.description || null,
        savedBy,
        metadataJson: { ...meta, incomingDir: dirName, sourceDocument: docName },
        source: 'incoming_scan',
        // Optional Phase 1 grouping hints (no-op when absent).
        parentPickupId: meta.parentPickupId || meta.parent_pickup_id || null,
        groupId: meta.groupId || meta.group_id || null,
      });
      registeredAny = true;
    }

    // Mark incoming dir processed (rename, don't delete agent artifacts)
    const processedPath = path.join(incomingDir, `${dirName}${INCOMING_PROCESSED_SUFFIX}`);
    if (!fs.existsSync(processedPath)) {
      try {
        fs.renameSync(dirPath, processedPath);
      } catch {
        // non-fatal — dir may already be gone or target exists
      }
    } else if (registeredAny) {
      // Source dir still present alongside processed copy — avoid re-import on next sync
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
      } catch {
        // non-fatal
      }
    }
  }
}

async function applyHardDeleteRetention(pool) {
  const days = parseInt(process.env.DOCS_PICKUP_HARD_DELETE_DAYS || '0', 10);
  if (!days || days < 1) return;

  const [rows] = await pool.query(
    `SELECT id, storage_path FROM docs_pickup_files
     WHERE status = 'deleted'
       AND deleted_at IS NOT NULL
       AND deleted_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days],
  );

  for (const row of rows) {
    const full = resolveUnderRoot(row.storage_path);
    if (full && fs.existsSync(full)) {
      try { fs.unlinkSync(full); } catch { /* ignore */ }
    }
    await pool.query('DELETE FROM docs_pickup_files WHERE id = ?', [row.id]);
  }
}

async function syncAll() {
  ensureStorageDirs();
  const pool = getAppPool();
  await syncLegacyIndex(pool);
  await syncLegacyRootFiles(pool);
  await syncFilesDir(pool);
  await syncIncomingDirs(pool);
  await applyHardDeleteRetention(pool);
}

function scanSecrets(content) {
  const warnings = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(content)) warnings.push(name);
  }
  return warnings;
}

function getAbsoluteFilePath(row) {
  return resolveUnderRoot(row.storage_path);
}

async function markViewed(id, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.status === 'deleted') throw new Error('NOT_FOUND');
  if (['picked_up', 'archived', 'expired'].includes(row.status)) {
    // still allow viewed timestamp update for audit
  }
  const newStatus = ['waiting'].includes(row.status) ? 'viewed' : row.status;
  await pool.query(
    `UPDATE docs_pickup_files SET
      status = ?, viewed_at = NOW(), viewed_by_id = ?, viewed_by_email = ?, viewed_by_name = ?
     WHERE id = ?`,
    [newStatus, actor.id, actor.email, actor.name, id],
  );
  await recordAuditEvent(pool, id, 'viewed', actor);
  return rowToApi(await getFileById(id));
}

async function recordDownload(id, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.status === 'deleted') throw new Error('NOT_FOUND');

  const newStatus = ['waiting', 'viewed'].includes(row.status) ? 'downloaded' : row.status;
  await pool.query(
    `UPDATE docs_pickup_files SET
      status = ?, download_count = download_count + 1,
      downloaded_at = NOW(), downloaded_by_id = ?, downloaded_by_email = ?, downloaded_by_name = ?
     WHERE id = ?`,
    [newStatus, actor.id, actor.email, actor.name, id],
  );
  await recordAuditEvent(pool, id, 'downloaded', actor);
}

async function markPickedUp(id, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.status === 'deleted') throw new Error('NOT_FOUND');
  if (row.status === 'picked_up') return rowToApi(row);

  await pool.query(
    `UPDATE docs_pickup_files SET
      status = 'picked_up', picked_up_at = NOW(),
      picked_up_by_id = ?, picked_up_by_email = ?, picked_up_by_name = ?
     WHERE id = ?`,
    [actor.id, actor.email, actor.name, id],
  );
  await recordAuditEvent(pool, id, 'picked_up', actor);
  return rowToApi(await getFileById(id));
}

async function archiveFile(id, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.status === 'deleted') throw new Error('NOT_FOUND');

  await pool.query(
    `UPDATE docs_pickup_files SET
      status = 'archived', archived_at = NOW(),
      archived_by_id = ?, archived_by_email = ?, archived_by_name = ?
     WHERE id = ?`,
    [actor.id, actor.email, actor.name, id],
  );
  await recordAuditEvent(pool, id, 'archived', actor);
  return rowToApi(await getFileById(id));
}

async function restoreFile(id, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row) throw new Error('NOT_FOUND');
  if (!['archived', 'deleted', 'expired'].includes(row.status)) {
    throw new Error('INVALID_STATUS');
  }

  const restoredStatus = row.picked_up_at ? 'picked_up' : 'waiting';
  await pool.query(
    `UPDATE docs_pickup_files SET
      status = ?,
      archived_at = NULL, archived_by_id = NULL, archived_by_email = NULL, archived_by_name = NULL,
      deleted_at = NULL, deleted_by_id = NULL, deleted_by_email = NULL, deleted_by_name = NULL
     WHERE id = ?`,
    [restoredStatus, id],
  );
  await recordAuditEvent(pool, id, 'restored', actor, { restoredStatus });
  return rowToApi(await getFileById(id));
}

async function softDeleteFile(id, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.status === 'deleted') throw new Error('NOT_FOUND');

  await pool.query(
    `UPDATE docs_pickup_files SET
      status = 'deleted', deleted_at = NOW(),
      deleted_by_id = ?, deleted_by_email = ?, deleted_by_name = ?
     WHERE id = ?`,
    [actor.id, actor.email, actor.name, id],
  );
  await recordAuditEvent(pool, id, 'deleted', actor);
  return rowToApi(await getFileById(id));
}

async function addNote(id, noteText, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.status === 'deleted') throw new Error('NOT_FOUND');

  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${actor.name || actor.email}: ${noteText}`;
  const notes = row.notes ? `${row.notes}\n${line}` : line;

  await pool.query('UPDATE docs_pickup_files SET notes = ? WHERE id = ?', [notes, id]);
  await recordAuditEvent(pool, id, 'note_added', actor, { note: noteText });
  return rowToApi(await getFileById(id));
}

async function buildPreview(id) {
  const row = await getFileById(id);
  if (!row || row.status === 'deleted') throw new Error('NOT_FOUND');

  const filePath = getAbsoluteFilePath(row);
  if (!filePath || !fs.existsSync(filePath)) throw new Error('NOT_ON_DISK');

  const ext = path.extname(row.file_name).toLowerCase();

  if (PREVIEW_TEXT_EXTENSIONS.has(ext)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const secretWarnings = scanSecrets(content);
    return {
      id: row.id,
      originalName: row.original_file_name,
      previewType: 'text',
      contentType: ext === '.html' ? 'text/html' : 'text/plain; charset=utf-8',
      content,
      secretWarnings,
    };
  }

  if (PREVIEW_JSON_EXTENSIONS.has(ext)) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    let formatted = raw;
    try {
      formatted = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      formatted = raw;
    }
    const secretWarnings = scanSecrets(formatted);
    return {
      id: row.id,
      originalName: row.original_file_name,
      previewType: 'json',
      contentType: 'application/json',
      content: formatted,
      secretWarnings,
    };
  }

  if (PREVIEW_METADATA_ONLY_EXTENSIONS.has(ext)) {
    const stat = fs.statSync(filePath);
    return {
      id: row.id,
      originalName: row.original_file_name,
      previewType: 'metadata',
      contentType: row.mime_type,
      content: null,
      metadata: {
        sizeBytes: stat.size,
        mimeType: row.mime_type,
        sha256: row.sha256,
        message: 'Preview not available for this file type. Use Download.',
      },
      secretWarnings: [],
    };
  }

  throw new Error('PREVIEW_UNSUPPORTED');
}

async function getAuditEvents(fileId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT * FROM docs_pickup_audit_events WHERE file_id = ? ORDER BY created_at DESC LIMIT 100`,
    [fileId],
  );
  return rows.map((r) => ({
    id: r.id,
    fileId: r.file_id,
    eventType: r.event_type,
    actor: { id: r.actor_id, email: r.actor_email, name: r.actor_name },
    details: r.details,
    createdAt: toIso(r.created_at),
  }));
}

const BULK_ACTIONS = new Set(['view', 'pick_up', 'archive', 'restore', 'delete', 'note']);

function isValidBulkId(id) {
  return id && typeof id === 'string' && !id.includes('..') && !id.includes('/');
}

async function bulkAction(ids, action, actor, options = {}) {
  if (!BULK_ACTIONS.has(action)) {
    throw new Error('INVALID_ACTION');
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('IDS_REQUIRED');
  }
  if (ids.length > 200) {
    throw new Error('IDS_LIMIT');
  }

  const uniqueIds = [...new Set(ids.filter(isValidBulkId))];
  const results = [];
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of uniqueIds) {
    try {
      const row = await getFileById(id);
      if (!row) {
        results.push({ id, status: 'error', reason: 'Not found' });
        failed += 1;
        continue;
      }

      let skipReason = null;
      switch (action) {
        case 'view':
          if (row.status === 'deleted') skipReason = 'Deleted files cannot be marked viewed';
          else await markViewed(id, actor);
          break;
        case 'pick_up':
          if (row.status === 'picked_up') skipReason = 'Already picked up';
          else if (['archived', 'deleted'].includes(row.status)) skipReason = `Cannot pick up ${row.status} file`;
          else await markPickedUp(id, actor);
          break;
        case 'archive':
          if (row.status === 'archived') skipReason = 'Already archived';
          else if (row.status === 'deleted') skipReason = 'Deleted files cannot be archived';
          else await archiveFile(id, actor);
          break;
        case 'restore':
          if (!['archived', 'deleted', 'expired'].includes(row.status)) {
            skipReason = 'File is not archived, deleted, or expired';
          } else {
            await restoreFile(id, actor);
          }
          break;
        case 'delete':
          if (row.status === 'deleted') skipReason = 'Already deleted';
          else await softDeleteFile(id, actor);
          break;
        case 'note': {
          const note = typeof options.note === 'string' ? options.note.trim() : '';
          if (!note) throw new Error('NOTE_REQUIRED');
          if (row.status === 'deleted') skipReason = 'Cannot add note to deleted file';
          else await addNote(id, note.slice(0, 2000), actor);
          break;
        }
        default:
          skipReason = 'Unknown action';
      }

      if (skipReason) {
        results.push({ id, status: 'skipped', reason: skipReason });
        skipped += 1;
      } else {
        results.push({ id, status: 'ok' });
        succeeded += 1;
      }
    } catch (err) {
      results.push({ id, status: 'error', reason: err.message || 'Action failed' });
      failed += 1;
    }
  }

  return { action, succeeded, skipped, failed, total: uniqueIds.length, results };
}

async function resolveBulkDownloadFiles(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('IDS_REQUIRED');
  }
  if (ids.length > 100) {
    throw new Error('IDS_LIMIT');
  }

  const files = [];
  const skipped = [];

  for (const id of [...new Set(ids.filter(isValidBulkId))]) {
    const row = await getFileById(id);
    if (!row || row.status === 'deleted') {
      skipped.push({ id, reason: 'Not found or deleted' });
      continue;
    }
    const filePath = getAbsoluteFilePath(row);
    if (!filePath || !fs.existsSync(filePath)) {
      skipped.push({ id, reason: 'File missing on disk' });
      continue;
    }
    files.push({ row, filePath });
  }

  if (files.length === 0) {
    throw new Error('NO_DOWNLOADABLE');
  }

  return { files, skipped };
}

// ── Parent/child grouping (Phase 2) ─────────────────────────────────────────
// All operations are NON-DESTRUCTIVE: they only set/clear the additive
// parent_id / group_id / relation_type columns and append audit events. No
// pickup row, stored file, or history is ever removed.

const GROUP_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomGroupSuffix(len = 5) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += GROUP_ID_ALPHABET[bytes[i] % GROUP_ID_ALPHABET.length];
  return out;
}

function groupIdForDate(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `OMGRP-${y}${m}${d}-${randomGroupSuffix(5)}`;
}

async function genUniqueGroupId(pool, date = new Date()) {
  for (let i = 0; i < 20; i += 1) {
    const candidate = groupIdForDate(date);
    const [rows] = await pool.query('SELECT 1 FROM docs_pickup_groups WHERE group_id = ? LIMIT 1', [candidate]);
    if (!rows.length) return candidate;
  }
  return `OMGRP-${Date.now()}-${randomGroupSuffix(5)}`;
}

function groupToApi(g) {
  if (!g) return null;
  return {
    id: g.id,
    groupId: g.group_id,
    parentPickupFileId: g.parent_pickup_file_id || null,
    title: g.title || null,
    featureTag: g.feature_tag || null,
    workPacketId: g.work_packet_id || null,
    createdBy: g.created_by || null,
    createdAt: toIso(g.created_at),
    note: g.note || null,
  };
}

// Resolve a pickup by raw uuid id OR public pickup_id (OMDOC-PICKUP-...).
async function resolvePickupRow(pool, ref) {
  if (!ref) return null;
  const [rows] = await pool.query(
    'SELECT * FROM docs_pickup_files WHERE id = ? OR pickup_id = ? LIMIT 1',
    [ref, ref],
  );
  return rows[0] || null;
}

async function getGroupByGroupId(pool, groupId) {
  if (!groupId) return null;
  const [rows] = await pool.query('SELECT * FROM docs_pickup_groups WHERE group_id = ? LIMIT 1', [groupId]);
  return rows[0] || null;
}

async function insertGroupRow(pool, opts) {
  await pool.query(
    `INSERT INTO docs_pickup_groups
      (group_id, parent_pickup_file_id, title, feature_tag, work_packet_id, created_by, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.groupId,
      opts.parentPickupFileId || null,
      opts.title || null,
      opts.featureTag || null,
      opts.workPacketId || null,
      opts.createdBy || null,
      opts.note || null,
    ],
  );
}

// Promote a pickup to relation_type='parent', creating its group registry row on
// first promotion. Idempotent: re-promoting an existing parent reuses its group.
async function promoteToParent(pool, parentRow, groupMeta = {}, actor = null) {
  let groupId = parentRow.group_id || null;
  if (!groupId) {
    groupId = await genUniqueGroupId(pool);
    await insertGroupRow(pool, {
      groupId,
      parentPickupFileId: parentRow.id,
      title: groupMeta.title || parentRow.title || parentRow.original_file_name || null,
      featureTag: groupMeta.featureTag || null,
      workPacketId: groupMeta.workPacketId || null,
      createdBy: actor?.email || actor?.name || null,
      note: groupMeta.note || null,
    });
  } else if (!(await getGroupByGroupId(pool, groupId))) {
    // Column referenced a group with no registry row (e.g. metadata drop) — backfill it.
    await insertGroupRow(pool, {
      groupId,
      parentPickupFileId: parentRow.id,
      title: groupMeta.title || parentRow.title || parentRow.original_file_name || null,
      featureTag: groupMeta.featureTag || null,
      workPacketId: groupMeta.workPacketId || null,
      createdBy: actor?.email || actor?.name || null,
      note: groupMeta.note || null,
    });
  }
  if (parentRow.relation_type !== 'parent' || parentRow.group_id !== groupId || parentRow.parent_id) {
    await pool.query(
      "UPDATE docs_pickup_files SET relation_type = 'parent', group_id = ?, parent_id = NULL WHERE id = ?",
      [groupId, parentRow.id],
    );
    await recordAuditEvent(pool, parentRow.id, 'parent_assigned', actor, { groupId, role: 'parent' });
  }
  return groupId;
}

async function assignChildRow(pool, childRow, parentRow, groupId, actor = null) {
  await pool.query(
    "UPDATE docs_pickup_files SET parent_id = ?, group_id = ?, relation_type = 'child' WHERE id = ?",
    [parentRow.id, groupId, childRow.id],
  );
  await recordAuditEvent(pool, childRow.id, 'parent_assigned', actor, { parentId: parentRow.id, groupId });
  await recordAuditEvent(pool, childRow.id, 'grouped', actor, { groupId, role: 'child' });
}

// Create a group around a parent pickup, optionally assigning children.
async function createGroup({ parentRef, title, featureTag, workPacketId, childRefs = [], note } = {}, actor = null) {
  const pool = getAppPool();
  const parentRow = await resolvePickupRow(pool, parentRef);
  if (!parentRow) throw new Error('PARENT_NOT_FOUND');
  if (parentRow.status === 'deleted') throw new Error('PARENT_DELETED');

  const groupId = await promoteToParent(pool, parentRow, { title, featureTag, workPacketId, note }, actor);
  await recordAuditEvent(pool, parentRow.id, 'grouped', actor, { groupId, role: 'parent', title: title || null });

  const assignedChildren = [];
  const skipped = [];
  for (const childRef of Array.isArray(childRefs) ? childRefs : []) {
    const childRow = await resolvePickupRow(pool, childRef);
    if (!childRow) { skipped.push({ ref: childRef, reason: 'not_found' }); continue; }
    if (childRow.id === parentRow.id) { skipped.push({ ref: childRef, reason: 'is_parent' }); continue; }
    if (childRow.status === 'deleted') { skipped.push({ ref: childRef, reason: 'deleted' }); continue; }
    await assignChildRow(pool, childRow, parentRow, groupId, actor);
    assignedChildren.push(childRow.id);
  }

  const group = await getGroupByGroupId(pool, groupId);
  return {
    group: groupToApi(group),
    parent: rowToApi(await getFileById(parentRow.id)),
    assignedChildren,
    skipped,
  };
}

// Assign `childRef` as a child of `parentRef` (POST /:id/parent). Promotes the
// parent and reuses its group. Guards against self-parenting and trivial cycles.
async function assignParent(childRef, parentRef, actor = null, groupMeta = {}) {
  const pool = getAppPool();
  const childRow = await resolvePickupRow(pool, childRef);
  if (!childRow) throw new Error('CHILD_NOT_FOUND');
  const parentRow = await resolvePickupRow(pool, parentRef);
  if (!parentRow) throw new Error('PARENT_NOT_FOUND');
  if (childRow.id === parentRow.id) throw new Error('SELF_PARENT');
  if (childRow.status === 'deleted' || parentRow.status === 'deleted') throw new Error('DELETED');
  if (parentRow.parent_id === childRow.id) throw new Error('CYCLE');

  const groupId = await promoteToParent(pool, parentRow, groupMeta, actor);
  await assignChildRow(pool, childRow, parentRow, groupId, actor);
  return {
    child: rowToApi(await getFileById(childRow.id)),
    parent: rowToApi(await getFileById(parentRow.id)),
    groupId,
  };
}

// Ungroup a pickup (DELETE /:id/parent). Non-destructive: clears grouping columns
// only. Ungrouping a parent also detaches (does NOT delete) its children.
async function ungroupPickup(ref, actor = null) {
  const pool = getAppPool();
  const row = await resolvePickupRow(pool, ref);
  if (!row) throw new Error('NOT_FOUND');

  const ungrouped = [];
  if (row.relation_type === 'parent') {
    const [children] = await pool.query('SELECT id FROM docs_pickup_files WHERE parent_id = ?', [row.id]);
    for (const c of children) {
      await pool.query(
        "UPDATE docs_pickup_files SET parent_id = NULL, group_id = NULL, relation_type = 'standalone' WHERE id = ?",
        [c.id],
      );
      await recordAuditEvent(pool, c.id, 'ungrouped', actor, { formerParentId: row.id });
      ungrouped.push(c.id);
    }
  }
  await pool.query(
    "UPDATE docs_pickup_files SET parent_id = NULL, group_id = NULL, relation_type = 'standalone' WHERE id = ?",
    [row.id],
  );
  await recordAuditEvent(pool, row.id, 'ungrouped', actor, {
    formerRelation: row.relation_type,
    formerGroupId: row.group_id || null,
    formerParentId: row.parent_id || null,
  });
  ungrouped.push(row.id);

  return { ungrouped, pickup: rowToApi(await getFileById(row.id)) };
}

async function listGroups() {
  const pool = getAppPool();
  const [groups] = await pool.query('SELECT * FROM docs_pickup_groups ORDER BY created_at DESC');
  const [counts] = await pool.query(
    'SELECT group_id, COUNT(*) AS cnt FROM docs_pickup_files WHERE group_id IS NOT NULL GROUP BY group_id',
  );
  const countMap = new Map(counts.map((c) => [c.group_id, Number(c.cnt)]));
  return groups.map((g) => ({ ...groupToApi(g), memberCount: countMap.get(g.group_id) || 0 }));
}

// Best-effort reconciliation of grouping hints supplied via metadata.json at
// registration time. No-op unless a drop carried parentPickupId/groupId. Never
// throws into the sync path (grouping is advisory at registration).
async function reconcileRegisteredGrouping(pool, fileId, { parentId, groupId, meta = {} } = {}, actor = null) {
  if (!parentId && !groupId) return;
  try {
    const childRow = await resolvePickupRow(pool, fileId);
    if (!childRow) return;
    if (parentId) {
      const parentRow = await resolvePickupRow(pool, parentId);
      if (parentRow && parentRow.id !== childRow.id) {
        const gid = await promoteToParent(pool, parentRow, {
          title: meta.groupTitle || meta.title || null,
          featureTag: meta.featureTag || meta.feature_tag || null,
          workPacketId: meta.workPacketId || meta.work_packet_id || null,
        }, actor);
        await assignChildRow(pool, childRow, parentRow, gid, actor);
        return;
      }
    }
    if (groupId) {
      if (!(await getGroupByGroupId(pool, groupId))) {
        await insertGroupRow(pool, {
          groupId,
          parentPickupFileId: null,
          title: meta.groupTitle || meta.title || null,
          featureTag: meta.featureTag || meta.feature_tag || null,
          workPacketId: meta.workPacketId || meta.work_packet_id || null,
          createdBy: actor?.email || actor?.name || null,
        });
      }
    }
  } catch (err) {
    console.warn('[DocsPickup] grouping reconcile (non-fatal):', err.message);
  }
}

module.exports = {
  ALLOWED_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  MAX_FILE_SIZE,
  AGENT_PATH_PREFIX,
  VALID_STATUSES,
  TAB_STATUS_MAP,
  getStorageRoot,
  getFilesDir,
  ensureStorageDirs,
  sanitizeOriginalName,
  validateExtension,
  rowToApi,
  syncAll,
  listFiles,
  getFileById,
  insertFileRecord,
  getAbsoluteFilePath,
  markViewed,
  recordDownload,
  markPickedUp,
  archiveFile,
  restoreFile,
  softDeleteFile,
  addNote,
  buildPreview,
  getAuditEvents,
  bulkAction,
  resolveBulkDownloadFiles,
  BULK_ACTIONS,
  guessMime,
  sha256File,
  // Grouping (Phase 2)
  createGroup,
  assignParent,
  ungroupPickup,
  listGroups,
  resolvePickupRow,
  groupToApi,
};
