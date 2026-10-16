/**
 * OM Docs Dropbox — inbound document staging, classification, edit, and promotion.
 *
 * Storage layout:
 *   storage/docs-dropbox/              — original uploads (uuid.ext)
 *   storage/docs-dropbox/edited/       — working edited copies
 *   storage/docs-dropbox/revisions/    — .rev-NNN.md backups per file id
 *   storage/docs-dropbox/index.json    — legacy index (migrated on sync)
 *
 * Promotion target: OM_DOCS_SRC (default /var/www/workspaces/om-docs)
 *   public   → docs/<section?>/<slug>.md
 *   internal → docs/internal/<section?>/<slug>.md
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getAppPool } = require('../config/db');
const { generateWorkPacketId } = require('./workPacketService');

let yaml;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

let storage;
try { storage = require('./docsStorageService'); } catch { storage = null; }

const ALLOWED_EXTENSIONS = new Set(['.md', '.html', '.txt', '.pdf', '.zip', '.json', '.docx']);
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.sh', '.bat', '.cmd', '.com', '.msi', '.app', '.deb', '.rpm',
  '.jar', '.bin', '.so', '.dylib', '.php', '.phtml', '.cgi', '.pl', '.rb',
]);
const EDITABLE_EXTENSIONS = new Set(['.md', '.txt']);
const PREVIEW_TEXT_EXTENSIONS = new Set(['.md', '.txt', '.html']);
const PREVIEW_JSON_EXTENSIONS = new Set(['.json']);
const PREVIEW_METADATA_ONLY_EXTENSIONS = new Set([
  '.pdf', '.zip', '.docx', '.xlsx', '.xls', '.doc', '.pptx', '.ppt',
]);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const AGENT_PATH_PREFIX = 'storage/docs-dropbox';

const VALID_STATUSES = new Set([
  'uploaded', 'reviewed', 'edited', 'ready_for_public_docs', 'ready_for_internal_docs',
  'promoted', 'rejected', 'archived',
  'dropped', 'ready_for_agent', 'picked_up', 'cancelled',
]);

const DOC_TYPES = new Set([
  'guide', 'reference', 'runbook', 'policy', 'architecture', 'api', 'release_notes', 'other',
]);

// Agents that can be assigned a pasted prompt / dropbox work packet.
const ASSIGNED_AGENTS = new Set(['Cursor', 'OMBrain', 'OMAI', 'OMStudio', 'OMWorkshop']);

// Statuses in which a pasted prompt may still be edited in place.
const PASTE_EDITABLE_STATUSES = new Set(['dropped', 'ready_for_agent', 'edited']);

// Max characters accepted for a pasted prompt (well under MEDIUMTEXT limits).
const MAX_PROMPT_CHARS = 500000;
// Warn (but allow) below this many characters.
const SHORT_PROMPT_CHARS = 40;
// Max characters for operator file summary (short prompt on uploaded attachments).
const MAX_SHORT_PROMPT_CHARS = 50000;

const TAB_STATUS_MAP = {
  uploaded: ['uploaded', 'dropped', 'ready_for_agent', 'picked_up'],
  needs_review: ['uploaded', 'reviewed', 'edited', 'dropped', 'ready_for_agent'],
  ready_public: ['ready_for_public_docs'],
  ready_internal: ['ready_for_internal_docs'],
  promoted: ['promoted'],
  archived: ['archived', 'rejected', 'cancelled'],
  all: null,
};

const MIME_MAP = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const SECRET_PATTERNS = [
  { name: 'JWT', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    name: 'API key / token',
    pattern: /(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|auth[_-]?token)\s*[:=]\s*['"]?[\w-]{12,}/gi,
  },
  { name: 'Bearer token', pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    name: 'Password assignment',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{4,}/gi,
  },
  {
    name: '.env secret',
    pattern: /^[A-Z][A-Z0-9_]*=(?:['"]?[^\s'"]{8,}['"]?)$/gm,
  },
  {
    name: 'Authorization header',
    pattern: /Authorization\s*:\s*(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{12,}/gi,
  },
];

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/;

function getStorageRoot() {
  if (process.env.DOCS_DROPBOX_ROOT) return process.env.DOCS_DROPBOX_ROOT;
  return path.join('/var/www/orthodoxmetrics/prod', 'storage', 'docs-dropbox');
}

function getOmDocsRoot() {
  if (process.env.OM_DOCS_SRC) return process.env.OM_DOCS_SRC;
  return '/var/www/workspaces/om-docs';
}

function getEditedDir() {
  return path.join(getStorageRoot(), 'edited');
}

function getRevisionsDir(fileId) {
  return path.join(getStorageRoot(), 'revisions', fileId);
}

function getLegacyIndexPath() {
  return path.join(getStorageRoot(), 'index.json');
}

function ensureStorageDirs() {
  const root = getStorageRoot();
  for (const dir of [root, getEditedDir(), path.join(root, 'revisions')]) {
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

function slugFromTitle(title) {
  const slug = String(title || 'untitled')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
  return slug || 'untitled';
}

/** Infer a human title from the first meaningful line of a pasted prompt. */
function inferTitleFromPrompt(promptText) {
  const lines = String(promptText || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/^#+\s*/, '').replace(/^[-*>]\s*/, '').trim();
    if (line) return line.slice(0, 120);
  }
  return 'Untitled Prompt';
}

/** Slug for a pasted prompt: from title, else inferred from prompt body. */
function slugForPaste(title, promptText) {
  const base = (title && String(title).trim()) || inferTitleFromPrompt(promptText);
  return slugFromTitle(base);
}

/**
 * Assemble the generated markdown document for a pasted prompt: YAML front
 * matter (in the exact contract order) followed by the title heading and the
 * verbatim prompt under an "Original Prompt" section. Prompt text formatting,
 * code blocks, and line breaks are preserved as-is.
 */
function buildAttachmentsMarkdownSection(attachments = []) {
  if (!attachments.length) return '';
  const rows = attachments.map((a) => `| ${a.originalName} | \`${a.agentPath}\` | ${a.sizeBytes} |`);
  return `\n## Attached Files\n\n| File | Agent path | Size (bytes) |\n| --- | --- | ---: |\n${rows.join('\n')}\n`;
}

function buildPastedPromptMarkdown(fm, promptText, attachments = []) {
  const orderedKeys = [
    'work_packet_id', 'source_type', 'source_filename', 'source_file_hash',
    'title', 'target_system', 'assigned_agent', 'document_visibility',
    'status', 'created_by', 'created', 'updated',
  ];
  const lines = orderedKeys.map((key) => {
    const value = fm[key];
    if (value == null || value === '') return `${key}:`;
    return `${key}: ${String(value)}`;
  });
  if (attachments.length) {
    lines.push('attached_files:');
    for (const att of attachments) {
      lines.push(`  - name: ${JSON.stringify(att.originalName)}`);
      lines.push(`    path: ${JSON.stringify(att.agentPath)}`);
    }
  }
  const body = String(promptText ?? '');
  const attachSection = buildAttachmentsMarkdownSection(attachments);
  return `---\n${lines.join('\n')}\n---\n\n# ${fm.title || 'Untitled Prompt'}\n\n## Original Prompt\n\n${body}${attachSection}`;
}

function buildTargetPath(visibility, location, slug, ext = '.md') {
  const safeSlug = slugFromTitle(slug);
  const safeExt = ext.startsWith('.') ? ext : `.${ext}`;
  const section = String(location || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.\./g, '');

  const parts = visibility === 'internal' ? ['docs', 'internal'] : ['docs'];
  if (section) parts.push(...section.split('/').filter(Boolean));
  parts.push(`${safeSlug}${safeExt}`);
  return parts.join('/');
}

function resolveUnderRoot(relativePath) {
  const root = path.resolve(getStorageRoot());
  const full = path.resolve(root, relativePath);
  if (!full.startsWith(root + path.sep) && full !== root) return null;
  return full;
}

function resolveUnderOmDocs(relativePath) {
  const root = path.resolve(getOmDocsRoot());
  const full = path.resolve(root, relativePath);
  if (!full.startsWith(root + path.sep) && full !== root) return null;
  return full;
}

function validatePromoteTarget(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!normalized || normalized.includes('..')) {
    return { ok: false, reason: 'Invalid promotion path' };
  }
  if (!normalized.startsWith('docs/')) {
    return { ok: false, reason: 'Promotion target must be under docs/' };
  }
  if (normalized === 'docs' || normalized === 'docs/internal') {
    return { ok: false, reason: 'Promotion target must include a filename' };
  }
  return { ok: true, normalized };
}

function guessMime(ext) {
  return MIME_MAP[ext] || 'application/octet-stream';
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sha256Content(content) {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function toIso(dt) {
  if (!dt) return null;
  if (dt instanceof Date) return dt.toISOString();
  return new Date(dt).toISOString();
}

function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function actorSnapshot(row, prefix) {
  const id = row[`${prefix}_id`];
  const email = row[`${prefix}_email`];
  const name = row[`${prefix}_name`];
  if (!id && !email && !name) return null;
  return { id: id ?? null, email: email ?? null, name: name || email || 'unknown', role: null };
}

function rowToApi(row) {
  if (!row) return null;
  const tags = parseJsonField(row.tags);
  const metadataJson = parseJsonField(row.metadata_json);
  return {
    id: row.id,
    workPacketId: row.work_packet_id || null,
    omDailyItemId: row.om_daily_item_id ?? null,
    intakeType: row.intake_type || 'documentation_only',
    workItemMode: row.work_item_mode || 'none',
    omDailyItemLinkedAt: toIso(row.om_daily_item_linked_at),
    omDailyItemLinkedByEmail: row.om_daily_item_linked_by_email || null,
    sourceType: row.source_type || 'uploaded_file',
    targetSystem: row.target_system || null,
    assignedAgent: row.assigned_agent || null,
    currentDispatchId: row.current_dispatch_id || null,
    returnedPickupId: row.returned_pickup_id || null,
    promptText: row.prompt_text ?? null,
    shortPrompt: row.short_prompt ?? null,
    fileName: row.file_name,
    originalName: row.original_file_name,
    originalFileName: row.original_file_name,
    storedName: row.file_name,
    storagePath: row.storage_path,
    editedStoragePath: row.edited_storage_path,
    agentPath: row.agent_path,
    editedAgentPath: row.edited_agent_path,
    title: row.title,
    description: row.description,
    docType: row.doc_type,
    targetVisibility: row.target_visibility,
    targetDocsLocation: row.target_docs_location,
    targetSlug: row.target_slug,
    targetPath: row.target_path,
    owner: row.owner,
    tags,
    status: row.status,
    notes: row.notes,
    uploadedBy: actorSnapshot(row, 'uploaded_by') || {
      id: null, email: null, name: 'unknown', role: null,
    },
    uploadedAt: toIso(row.uploaded_at),
    editedBy: actorSnapshot(row, 'edited_by'),
    editedAt: toIso(row.edited_at),
    reviewedBy: actorSnapshot(row, 'reviewed_by'),
    reviewedAt: toIso(row.reviewed_at),
    readyBy: actorSnapshot(row, 'ready_by'),
    readyAt: toIso(row.ready_at),
    promotedBy: actorSnapshot(row, 'promoted_by'),
    promotedAt: toIso(row.promoted_at),
    promotedPath: row.promoted_path,
    rejectedBy: actorSnapshot(row, 'rejected_by'),
    rejectedAt: toIso(row.rejected_at),
    archivedBy: actorSnapshot(row, 'archived_by'),
    archivedAt: toIso(row.archived_at),
    deletedBy: actorSnapshot(row, 'deleted_by'),
    deletedAt: toIso(row.deleted_at),
    deleted: Boolean(row.deleted_at),
    size: row.size_bytes,
    sizeBytes: row.size_bytes,
    mimeType: row.mime_type,
    sha256: row.sha256,
    revisionCount: row.revision_count || 0,
    lastStatusChangeAt: toIso(row.last_status_change_at),
    metadataJson,
  };
}

async function recordAuditEvent(pool, fileId, eventType, actor, details = null) {
  await pool.query(
    `INSERT INTO docs_dropbox_audit_events
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

function splitFrontmatter(content) {
  const text = String(content ?? '');
  const match = text.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: text };
  }
  return { frontmatter: parseYamlBlock(match[1]), body: match[2] };
}

function parseYamlBlock(block) {
  if (yaml) {
    try {
      const parsed = yaml.load(block);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  const fm = {};
  for (const line of String(block).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      val = val.replace(/^['"]|['"]$/g, '');
    }
    fm[m[1]] = val;
  }
  return fm;
}

function stringifyYamlBlock(obj) {
  if (yaml) {
    return yaml.dump(obj, { indent: 2, lineWidth: -1, noRefs: true }).trimEnd();
  }
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value == null || value === '') continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(String(v))).join(', ')}]`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }
  return lines.join('\n');
}

function mergeFrontmatter(existing, fields) {
  return { ...existing, ...fields };
}

function buildPublicFrontmatter(fields) {
  const fm = {};
  if (fields.title) fm.title = fields.title;
  if (fields.hideNav != null) fm.hide_nav = Boolean(fields.hideNav);
  return fm;
}

function buildInternalFrontmatter(fields) {
  const fm = { visibility: 'internal' };
  if (fields.title) fm.title = fields.title;
  if (fields.owner) fm.owner = fields.owner;
  if (fields.systems) fm.systems = fields.systems;
  if (fields.tags) fm.tags = fields.tags;
  if (fields.brainIngest != null) fm.brain_ingest = fields.brainIngest;
  if (fields.lastReviewed) fm.last_reviewed = fields.lastReviewed;
  if (fields.riskLevel) fm.risk_level = fields.riskLevel;
  return fm;
}

function applyFrontmatter(content, frontmatter) {
  const { body } = splitFrontmatter(content);
  const block = stringifyYamlBlock(frontmatter);
  return `---\n${block}\n---\n\n${body.replace(/^\s+/, '')}`;
}

async function insertFileRecord(pool, record, actor = null) {
  await pool.query(
    `INSERT INTO docs_dropbox_files (
      id, work_packet_id, om_daily_item_id, source_type, intake_type, work_item_mode,
      file_name, original_file_name, storage_path, edited_storage_path,
      agent_path, edited_agent_path, title, description, prompt_text, doc_type,
      target_system, assigned_agent,
      target_visibility, target_docs_location, target_slug, target_path,
      owner, tags, status, notes,
      uploaded_by_id, uploaded_by_email, uploaded_by_name, uploaded_at,
      size_bytes, mime_type, sha256, revision_count, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.workPacketId || null,
      record.omDailyItemId ?? null,
      record.sourceType || 'uploaded_file',
      record.intakeType || 'documentation_only',
      record.workItemMode || 'none',
      record.fileName,
      record.originalFileName,
      record.storagePath,
      record.editedStoragePath || null,
      record.agentPath,
      record.editedAgentPath || null,
      record.title || null,
      record.description || null,
      record.promptText ?? null,
      record.docType || null,
      record.targetSystem || null,
      record.assignedAgent || null,
      record.targetVisibility || null,
      record.targetDocsLocation || null,
      record.targetSlug || null,
      record.targetPath || null,
      record.owner || null,
      record.tags ? JSON.stringify(record.tags) : null,
      record.status || 'uploaded',
      record.notes || null,
      record.uploadedBy?.id ?? null,
      record.uploadedBy?.email ?? null,
      record.uploadedBy?.name || 'unknown',
      record.uploadedAt ? new Date(record.uploadedAt) : new Date(),
      record.sizeBytes || 0,
      record.mimeType || null,
      record.sha256 || null,
      record.revisionCount || 0,
      record.metadataJson ? JSON.stringify(record.metadataJson) : null,
    ],
  );
  await recordAuditEvent(pool, record.id, record.uploadEventType || 'upload', actor || record.uploadedBy, {
    source: record.source || 'upload',
    originalFileName: record.originalFileName,
    workPacketId: record.workPacketId || null,
  });
}

async function getFileById(id) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT * FROM docs_dropbox_files WHERE id = ? LIMIT 1',
    [id],
  );
  return rows[0] || null;
}

async function listFiles(tab = 'uploaded') {
  const pool = getAppPool();
  await syncAll();
  const statuses = TAB_STATUS_MAP[tab] ?? TAB_STATUS_MAP.uploaded;
  let sql = 'SELECT * FROM docs_dropbox_files WHERE deleted_at IS NULL';
  const params = [];
  if (statuses) {
    sql += ` AND status IN (${statuses.map(() => '?').join(', ')})`;
    params.push(...statuses);
  }
  sql += ' ORDER BY uploaded_at DESC';
  const [rows] = await pool.query(sql, params);
  return rows.map(rowToApi);
}

function getOriginalFilePath(row) {
  return resolveUnderRoot(row.storage_path);
}

function getWorkingFilePath(row) {
  if (row.edited_storage_path) {
    const edited = resolveUnderRoot(row.edited_storage_path);
    if (edited && fs.existsSync(edited)) return edited;
  }
  return getOriginalFilePath(row);
}

function isEditableRow(row) {
  const ext = path.extname(row.file_name).toLowerCase();
  return EDITABLE_EXTENSIONS.has(ext);
}

async function registerDiskFile(pool, opts) {
  const {
    sourcePath,
    storageRelative,
    originalFileName,
    uploadedBy,
    metadataJson,
    status,
    source,
    mimeType,
  } = opts;

  const ext = path.extname(originalFileName).toLowerCase();
  const id = path.basename(storageRelative, ext);
  const stat = fs.statSync(sourcePath);
  const sha256 = sha256File(sourcePath);
  const agentPath = `${AGENT_PATH_PREFIX}/${storageRelative.replace(/\\/g, '/')}`;

  const record = {
    id,
    fileName: path.basename(storageRelative),
    originalFileName: sanitizeOriginalName(originalFileName),
    storagePath: storageRelative.replace(/\\/g, '/'),
    agentPath,
    status: status || 'uploaded',
    uploadedBy: uploadedBy || { id: null, email: null, name: 'unknown', role: null },
    uploadedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
    mimeType: mimeType || guessMime(ext),
    sha256,
    metadataJson: metadataJson || null,
    source: source || 'scan',
  };

  await insertFileRecord(pool, record, uploadedBy);
  return record.id;
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

  const root = getStorageRoot();
  for (const entry of index.files) {
    if (!entry?.id || !entry?.storedName) continue;

    const [existing] = await pool.query(
      'SELECT id FROM docs_dropbox_files WHERE id = ? LIMIT 1',
      [entry.id],
    );
    if (existing.length) continue;

    const legacyPath = path.join(root, entry.storedName);
    if (!fs.existsSync(legacyPath)) continue;

    const ext = path.extname(entry.storedName).toLowerCase();
    const storageRelative = entry.storedName;
    let status = 'uploaded';
    if (entry.deleted) {
      await pool.query(
        `INSERT INTO docs_dropbox_files (
          id, file_name, original_file_name, storage_path, agent_path, status,
          uploaded_by_id, uploaded_by_email, uploaded_by_name, uploaded_at,
          deleted_at, deleted_by_id, deleted_by_email, deleted_by_name,
          size_bytes, mime_type, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          entry.storedName,
          entry.originalName || entry.storedName,
          storageRelative,
          entry.agentPath || `${AGENT_PATH_PREFIX}/${entry.storedName}`,
          'archived',
          entry.uploadedBy?.id ?? null,
          entry.uploadedBy?.email ?? null,
          entry.uploadedBy?.name || 'unknown',
          entry.uploadedAt ? new Date(entry.uploadedAt) : new Date(),
          entry.deletedAt ? new Date(entry.deletedAt) : new Date(),
          entry.deletedBy?.id ?? null,
          entry.deletedBy?.email ?? null,
          entry.deletedBy?.name ?? null,
          entry.size || 0,
          entry.mimeType || guessMime(ext),
          JSON.stringify({ migratedFromIndex: true, legacyDeleted: true }),
        ],
      );
      continue;
    }

    await pool.query(
      `INSERT INTO docs_dropbox_files (
        id, file_name, original_file_name, storage_path, agent_path, status,
        uploaded_by_id, uploaded_by_email, uploaded_by_name, uploaded_at,
        size_bytes, mime_type, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.storedName,
        entry.originalName || entry.storedName,
        storageRelative,
        entry.agentPath || `${AGENT_PATH_PREFIX}/${entry.storedName}`,
        status,
        entry.uploadedBy?.id ?? null,
        entry.uploadedBy?.email ?? null,
        entry.uploadedBy?.name || 'unknown',
        entry.uploadedAt ? new Date(entry.uploadedAt) : new Date(),
        entry.size || 0,
        entry.mimeType || guessMime(ext),
        JSON.stringify({ migratedFromIndex: true }),
      ],
    );
    await recordAuditEvent(pool, entry.id, 'upload', entry.uploadedBy, {
      source: 'legacy_index_migration',
    });
  }
}

async function syncRootFiles(pool) {
  const root = getStorageRoot();
  if (!fs.existsSync(root)) return;

  const skip = new Set(['index.json', 'edited', 'revisions']);
  const names = fs.readdirSync(root).filter((name) => {
    if (name.startsWith('.') || skip.has(name)) return false;
    const full = path.join(root, name);
    if (!fs.statSync(full).isFile()) return false;
    return validateExtension(name).ok;
  });

  for (const name of names) {
    const storageRelative = name;
    const [existing] = await pool.query(
      'SELECT id FROM docs_dropbox_files WHERE storage_path = ? OR file_name = ? LIMIT 1',
      [storageRelative, name],
    );
    if (existing.length) continue;

    const sourcePath = path.join(root, name);
    await registerDiskFile(pool, {
      sourcePath,
      storageRelative,
      originalFileName: name,
      source: 'root_scan',
    });
  }
}

/** Assign Work Packet ids to any existing rows that predate the registry. */
async function ensureWorkPackets(pool) {
  const [rows] = await pool.query(
    "SELECT id, uploaded_at FROM docs_dropbox_files WHERE work_packet_id IS NULL OR work_packet_id = ''",
  );
  for (const row of rows) {
    const when = row.uploaded_at ? new Date(row.uploaded_at) : new Date();
    const workPacketId = await generateWorkPacketId(pool, {
      date: when,
      sourceType: 'uploaded_file',
      origin: 'dropbox',
      refId: row.id,
    });
    await pool.query(
      "UPDATE docs_dropbox_files SET work_packet_id = ? WHERE id = ? AND (work_packet_id IS NULL OR work_packet_id = '')",
      [workPacketId, row.id],
    );
  }
}

async function syncAll() {
  ensureStorageDirs();
  const pool = getAppPool();
  await syncLegacyIndex(pool);
  await syncRootFiles(pool);
  await ensureWorkPackets(pool);
}

function scanSecrets(content) {
  const warnings = [];
  const text = String(content ?? '');
  for (const { name, pattern } of SECRET_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(text)) warnings.push(name);
  }
  return warnings;
}

async function getContent(id) {
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');

  const filePath = getWorkingFilePath(row);
  if (!filePath || !fs.existsSync(filePath)) throw new Error('NOT_ON_DISK');

  if (!isEditableRow(row) && !PREVIEW_TEXT_EXTENSIONS.has(path.extname(row.file_name).toLowerCase())) {
    throw new Error('CONTENT_NOT_TEXT');
  }

  return {
    id: row.id,
    content: fs.readFileSync(filePath, 'utf-8'),
    path: row.edited_storage_path || row.storage_path,
    secretWarnings: scanSecrets(fs.readFileSync(filePath, 'utf-8')),
  };
}

async function saveContent(id, content, actor, note = null) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');
  if (!isEditableRow(row)) throw new Error('NOT_EDITABLE');
  if (['promoted', 'rejected', 'archived', 'picked_up', 'cancelled'].includes(row.status)) {
    throw new Error('INVALID_STATUS');
  }

  const text = String(content ?? '');
  const revisionNumber = (row.revision_count || 0) + 1;
  const revDir = getRevisionsDir(id);
  if (!fs.existsSync(revDir)) fs.mkdirSync(revDir, { recursive: true });

  const backupRelative = `revisions/${id}/rev-${String(revisionNumber).padStart(3, '0')}.md`;
  const backupPath = path.join(getStorageRoot(), backupRelative);
  const priorPath = getWorkingFilePath(row);
  const priorContent = priorPath && fs.existsSync(priorPath)
    ? fs.readFileSync(priorPath, 'utf-8')
    : text;

  fs.writeFileSync(backupPath, priorContent, 'utf-8');

  const editedDir = getEditedDir();
  const ext = path.extname(row.file_name).toLowerCase();
  const editedName = `${id}${ext}`;
  const editedRelative = `edited/${editedName}`;
  const editedPath = path.join(editedDir, editedName);
  fs.writeFileSync(editedPath, text, 'utf-8');

  const editedAgentPath = `${AGENT_PATH_PREFIX}/${editedRelative}`;

  await pool.query(
    `INSERT INTO docs_dropbox_revisions
      (file_id, revision_number, content, content_sha256, backup_path,
       edited_by_id, edited_by_email, edited_by_name, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      revisionNumber,
      priorContent,
      sha256Content(priorContent),
      backupRelative,
      actor?.id ?? null,
      actor?.email ?? null,
      actor?.name ?? null,
      note,
    ],
  );

  const newStatus = ['uploaded', 'reviewed'].includes(row.status) ? 'edited' : row.status;

  await pool.query(
    `UPDATE docs_dropbox_files SET
      edited_storage_path = ?, edited_agent_path = ?,
      edited_at = NOW(), edited_by_id = ?, edited_by_email = ?, edited_by_name = ?,
      revision_count = ?, status = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      editedRelative,
      editedAgentPath,
      actor?.id ?? null,
      actor?.email ?? null,
      actor?.name ?? null,
      revisionNumber,
      newStatus,
      id,
    ],
  );

  await recordAuditEvent(pool, id, 'edit', actor, { revisionNumber, note });
  return rowToApi(await getFileById(id));
}

/**
 * Persist markup annotations for a document. Annotations (highlights, comments,
 * drawings, rectangles, text notes) are stored on the file's metadata_json under
 * a `markup` key so they survive reloads without a new table. Returns the file.
 */
async function saveMarkup(id, annotations, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');

  const list = Array.isArray(annotations) ? annotations : [];
  const metadata = parseJsonField(row.metadata_json) || {};
  metadata.markup = {
    annotations: list,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.email || actor?.name || null,
  };

  await pool.query(
    'UPDATE docs_dropbox_files SET metadata_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(metadata), id],
  );
  await recordAuditEvent(pool, id, 'markup_saved', actor, { count: list.length });
  return rowToApi(await getFileById(id));
}

/**
 * Persist an operator-authored short prompt for a dropbox file (especially
 * attachments without inline preview). Separate from prompt_text (long agent dispatch).
 */
async function saveShortPrompt(id, shortPrompt, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');

  const text = typeof shortPrompt === 'string' ? shortPrompt : '';
  if (text.length > MAX_SHORT_PROMPT_CHARS) throw new Error('SHORT_PROMPT_TOO_LARGE');

  const trimmed = text.trim();
  await pool.query(
    'UPDATE docs_dropbox_files SET short_prompt = ?, updated_at = NOW() WHERE id = ?',
    [trimmed || null, id],
  );
  await recordAuditEvent(pool, id, 'short_prompt_saved', actor, { length: trimmed.length });
  return rowToApi(await getFileById(id));
}

async function getRevisions(id) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');

  const [rows] = await pool.query(
    `SELECT * FROM docs_dropbox_revisions
     WHERE file_id = ?
     ORDER BY revision_number DESC`,
    [id],
  );

  return rows.map((r) => ({
    id: r.id,
    fileId: r.file_id,
    revisionNumber: r.revision_number,
    contentSha256: r.content_sha256,
    backupPath: r.backup_path,
    editedBy: {
      id: r.edited_by_id,
      email: r.edited_by_email,
      name: r.edited_by_name,
    },
    note: r.note,
    createdAt: toIso(r.created_at),
  }));
}

async function updateClassification(id, fields, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');
  if (['promoted', 'rejected', 'archived'].includes(row.status)) throw new Error('INVALID_STATUS');

  const docType = fields.docType ?? fields.doc_type ?? row.doc_type;
  if (docType && !DOC_TYPES.has(docType)) throw new Error('INVALID_DOC_TYPE');

  const targetVisibility = fields.targetVisibility ?? fields.target_visibility ?? row.target_visibility;
  const targetDocsLocation = fields.targetDocsLocation ?? fields.target_docs_location ?? row.target_docs_location;
  const targetSlug = fields.targetSlug ?? fields.target_slug ?? row.target_slug;
  const title = fields.title ?? row.title;

  let targetPath = fields.targetPath ?? fields.target_path ?? row.target_path;
  if (targetVisibility && targetSlug) {
    targetPath = buildTargetPath(
      targetVisibility,
      targetDocsLocation,
      targetSlug,
      path.extname(row.file_name).toLowerCase() || '.md',
    );
  }

  const tags = fields.tags != null ? fields.tags : parseJsonField(row.tags);
  const owner = fields.owner ?? row.owner;

  await pool.query(
    `UPDATE docs_dropbox_files SET
      title = ?, description = ?, doc_type = ?,
      target_visibility = ?, target_docs_location = ?, target_slug = ?, target_path = ?,
      owner = ?, tags = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      title,
      fields.description ?? row.description,
      docType,
      targetVisibility,
      targetDocsLocation,
      targetSlug,
      targetPath,
      owner,
      tags ? JSON.stringify(tags) : null,
      id,
    ],
  );

  await recordAuditEvent(pool, id, 'metadata_update', actor, {
    title,
    docType,
    targetVisibility,
    targetDocsLocation,
    targetSlug,
    targetPath,
  });

  return rowToApi(await getFileById(id));
}

async function insertFrontmatter(id, fields, actor) {
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');
  if (!isEditableRow(row)) throw new Error('NOT_EDITABLE');

  const visibility = fields.targetVisibility
    ?? fields.target_visibility
    ?? row.target_visibility
    ?? 'public';

  const { content: current } = await getContent(id);
  const { frontmatter: existing } = splitFrontmatter(current);

  const templateFields = visibility === 'internal'
    ? buildInternalFrontmatter({
      title: fields.title ?? row.title,
      owner: fields.owner ?? row.owner,
      systems: fields.systems,
      tags: fields.tags ?? parseJsonField(row.tags),
      brainIngest: fields.brainIngest ?? fields.brain_ingest,
      lastReviewed: fields.lastReviewed ?? fields.last_reviewed,
      riskLevel: fields.riskLevel ?? fields.risk_level,
    })
    : buildPublicFrontmatter({
      title: fields.title ?? row.title,
      hideNav: fields.hideNav ?? fields.hide_nav,
    });

  const merged = mergeFrontmatter(existing, templateFields);
  const updated = applyFrontmatter(current, merged);
  const saved = await saveContent(id, updated, actor, 'frontmatter merge');

  const pool = getAppPool();
  await recordAuditEvent(pool, id, 'frontmatter_update', actor, {
    visibility,
    keys: Object.keys(templateFields),
  });

  return saved;
}

async function markReviewed(id, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');
  if (['promoted', 'rejected', 'archived'].includes(row.status)) throw new Error('INVALID_STATUS');

  const newStatus = row.status === 'uploaded' ? 'reviewed' : row.status;
  await pool.query(
    `UPDATE docs_dropbox_files SET
      status = ?, reviewed_at = NOW(),
      reviewed_by_id = ?, reviewed_by_email = ?, reviewed_by_name = ?,
      updated_at = NOW()
     WHERE id = ?`,
    [newStatus, actor?.id ?? null, actor?.email ?? null, actor?.name ?? null, id],
  );
  await recordAuditEvent(pool, id, 'reviewed', actor);
  return rowToApi(await getFileById(id));
}

async function markReady(id, actor, visibility = null) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');
  if (['promoted', 'rejected', 'archived'].includes(row.status)) throw new Error('INVALID_STATUS');

  const vis = visibility || row.target_visibility;
  if (!vis || !['public', 'internal'].includes(vis)) throw new Error('VISIBILITY_REQUIRED');

  const status = vis === 'internal' ? 'ready_for_internal_docs' : 'ready_for_public_docs';
  const eventType = vis === 'internal' ? 'marked_ready_internal' : 'marked_ready_public';

  await pool.query(
    `UPDATE docs_dropbox_files SET
      status = ?, target_visibility = ?,
      ready_at = NOW(), ready_by_id = ?, ready_by_email = ?, ready_by_name = ?,
      updated_at = NOW()
     WHERE id = ?`,
    [status, vis, actor?.id ?? null, actor?.email ?? null, actor?.name ?? null, id],
  );
  await recordAuditEvent(pool, id, eventType, actor, { visibility: vis });
  return rowToApi(await getFileById(id));
}

async function promoteFile(id, actor, options = {}) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');

  const allowedPromoteStatuses = new Set(['ready_for_public_docs', 'ready_for_internal_docs', 'edited', 'reviewed']);
  if (!allowedPromoteStatuses.has(row.status)) throw new Error('INVALID_STATUS');

  const targetRelative = options.targetPath
    || options.target_path
    || row.target_path
    || (row.target_visibility && row.target_slug
      ? buildTargetPath(
        row.target_visibility,
        row.target_docs_location,
        row.target_slug,
        path.extname(row.file_name).toLowerCase() || '.md',
      )
      : null);

  if (!targetRelative) throw new Error('TARGET_PATH_REQUIRED');

  const targetCheck = validatePromoteTarget(targetRelative);
  if (!targetCheck.ok) throw new Error(targetCheck.reason);

  const normalizedTarget = targetCheck.normalized;
  const isInternalTarget = normalizedTarget.startsWith('docs/internal/');
  const isPublicTarget = normalizedTarget.startsWith('docs/') && !isInternalTarget;

  if (row.target_visibility === 'internal' && isPublicTarget && !options.confirmInternalAsPublic) {
    throw new Error('CONFIRM_INTERNAL_AS_PUBLIC');
  }

  const workingPath = getWorkingFilePath(row);
  if (!workingPath || !fs.existsSync(workingPath)) throw new Error('NOT_ON_DISK');

  const content = fs.readFileSync(workingPath, 'utf-8');
  const secretWarnings = scanSecrets(content);

  if (secretWarnings.length) {
    if (!options.superAdminOverride) {
      await recordAuditEvent(pool, id, 'secret_block', actor, { warnings: secretWarnings, targetPath: normalizedTarget });
      const err = new Error('SECRET_SCAN_BLOCKED');
      err.warnings = secretWarnings;
      throw err;
    }
    await recordAuditEvent(pool, id, 'super_admin_override', actor, {
      warnings: secretWarnings,
      targetPath: normalizedTarget,
    });
  }

  const destPath = resolveUnderOmDocs(normalizedTarget);
  if (!destPath) throw new Error('INVALID_PROMOTE_PATH');

  const docsRoot = path.resolve(getOmDocsRoot(), 'docs');
  if (!destPath.startsWith(docsRoot + path.sep) && destPath !== docsRoot) {
    throw new Error('INVALID_PROMOTE_PATH');
  }

  if (fs.existsSync(destPath) && !options.confirmOverwrite) {
    throw new Error('CONFIRM_OVERWRITE');
  }

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  fs.copyFileSync(workingPath, destPath);

  await pool.query(
    `UPDATE docs_dropbox_files SET
      status = 'promoted',
      promoted_at = NOW(), promoted_by_id = ?, promoted_by_email = ?, promoted_by_name = ?,
      promoted_path = ?, target_path = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      actor?.id ?? null,
      actor?.email ?? null,
      actor?.name ?? null,
      normalizedTarget,
      normalizedTarget,
      id,
    ],
  );

  await recordAuditEvent(pool, id, 'promote', actor, {
    promotedPath: normalizedTarget,
    confirmOverwrite: Boolean(options.confirmOverwrite),
    confirmInternalAsPublic: Boolean(options.confirmInternalAsPublic),
    secretWarnings,
  });

  return rowToApi(await getFileById(id));
}

async function archiveFile(id, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');

  await pool.query(
    `UPDATE docs_dropbox_files SET
      status = 'archived',
      archived_at = NOW(), archived_by_id = ?, archived_by_email = ?, archived_by_name = ?,
      updated_at = NOW()
     WHERE id = ?`,
    [actor?.id ?? null, actor?.email ?? null, actor?.name ?? null, id],
  );
  await recordAuditEvent(pool, id, 'archive', actor);
  return rowToApi(await getFileById(id));
}

async function rejectFile(id, actor, reason = null) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');

  await pool.query(
    `UPDATE docs_dropbox_files SET
      status = 'rejected',
      rejected_at = NOW(), rejected_by_id = ?, rejected_by_email = ?, rejected_by_name = ?,
      notes = CASE WHEN ? IS NULL THEN notes ELSE CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE '\n' END, ?) END,
      updated_at = NOW()
     WHERE id = ?`,
    [
      actor?.id ?? null,
      actor?.email ?? null,
      actor?.name ?? null,
      reason,
      reason ? `[rejected] ${reason}` : null,
      id,
    ],
  );
  await recordAuditEvent(pool, id, 'reject', actor, reason ? { reason } : null);
  return rowToApi(await getFileById(id));
}

async function softDeleteFile(id, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');

  await pool.query(
    `UPDATE docs_dropbox_files SET
      deleted_at = NOW(), deleted_by_id = ?, deleted_by_email = ?, deleted_by_name = ?,
      updated_at = NOW()
     WHERE id = ?`,
    [actor?.id ?? null, actor?.email ?? null, actor?.name ?? null, id],
  );
  await recordAuditEvent(pool, id, 'delete', actor);
  return rowToApi(await getFileById(id));
}

/**
 * Preview the markdown that a pasted prompt would generate — WITHOUT allocating
 * a Work Packet id or writing anything. Used by the "Preview generated markdown"
 * button. The work_packet_id shows a placeholder assigned at creation time.
 */
function previewPastedPrompt(fields = {}) {
  const promptText = String(fields.promptText ?? fields.prompt_text ?? '');
  const title = (fields.title && String(fields.title).trim()) || inferTitleFromPrompt(promptText);
  const slug = slugForPaste(fields.title, promptText);
  const visibility = fields.documentVisibility === 'public' || fields.targetVisibility === 'public'
    ? 'public' : 'internal';
  const placeholderId = 'OMPKT-YYYYMMDD-#### (assigned on create)';
  const filename = `<OMPKT-id>-${slug}.md`;
  const sourceFileHash = promptText ? sha256Content(promptText) : '';
  const nowIso = new Date().toISOString();

  const fm = {
    work_packet_id: placeholderId,
    source_type: 'pasted_prompt',
    source_filename: filename,
    source_file_hash: sourceFileHash,
    title,
    target_system: fields.targetSystem || fields.target_system || '',
    assigned_agent: fields.assignedAgent || fields.assigned_agent || '',
    document_visibility: visibility,
    status: 'dropped',
    created_by: fields.createdBy || '',
    created: nowIso,
    updated: nowIso,
  };

  return {
    markdown: buildPastedPromptMarkdown(fm, promptText),
    filename,
    slug,
    title,
    documentVisibility: visibility,
    sourceFileHash,
    shortPrompt: promptText.trim().length > 0 && promptText.trim().length < SHORT_PROMPT_CHARS,
  };
}

/**
 * Create a Dropbox item from a pasted prompt. Allocates a shared Work Packet id,
 * generates a markdown file into the same storage path uploads land in (so agents
 * pick it up identically), records it, and returns the API row.
 */
async function createPastedPrompt(fields, actor) {
  const pool = getAppPool();
  const promptText = String(fields.promptText ?? fields.prompt_text ?? '');

  if (!promptText.trim()) throw new Error('EMPTY_PROMPT');
  if (promptText.length > MAX_PROMPT_CHARS) throw new Error('PROMPT_TOO_LARGE');

  const visibility = fields.documentVisibility === 'public' || fields.targetVisibility === 'public'
    ? 'public' : 'internal';
  const assignedAgent = fields.assignedAgent || fields.assigned_agent || null;
  if (assignedAgent && !ASSIGNED_AGENTS.has(assignedAgent)) throw new Error('INVALID_AGENT');
  const targetSystem = fields.targetSystem || fields.target_system || null;

  const title = (fields.title && String(fields.title).trim()) || inferTitleFromPrompt(promptText);
  const slug = slugForPaste(fields.title, promptText);

  ensureStorageDirs();

  const id = crypto.randomUUID();
  const workPacketId = await generateWorkPacketId(pool, {
    sourceType: 'pasted_prompt',
    origin: 'dropbox',
    refId: id,
    createdByEmail: actor?.email || null,
  });

  const filename = `${workPacketId}-${slug}.md`;
  const storageRelative = filename;
  const diskPath = path.join(getStorageRoot(), filename);
  const agentPath = `${AGENT_PATH_PREFIX}/${storageRelative}`;
  const sourceFileHash = sha256Content(promptText);
  const nowIso = new Date().toISOString();

  const frontmatter = {
    work_packet_id: workPacketId,
    source_type: 'pasted_prompt',
    source_filename: filename,
    source_file_hash: sourceFileHash,
    title,
    target_system: targetSystem || '',
    assigned_agent: assignedAgent || '',
    document_visibility: visibility,
    status: 'dropped',
    created_by: actor?.email || actor?.name || 'unknown',
    created: nowIso,
    updated: nowIso,
  };
  const markdown = buildPastedPromptMarkdown(frontmatter, promptText);

  fs.writeFileSync(diskPath, markdown, 'utf-8');

  await insertFileRecord(pool, {
    id,
    workPacketId,
    sourceType: 'pasted_prompt',
    intakeType: fields.intakeType || fields.intake_type || 'documentation_only',
    workItemMode: fields.workItemMode || fields.work_item_mode || 'none',
    fileName: filename,
    originalFileName: filename,
    storagePath: storageRelative,
    agentPath,
    title,
    description: null,
    promptText,
    targetSystem,
    assignedAgent,
    targetVisibility: visibility,
    targetSlug: slug,
    status: 'dropped',
    uploadedBy: actor,
    uploadedAt: nowIso,
    sizeBytes: Buffer.byteLength(markdown, 'utf-8'),
    mimeType: 'text/markdown',
    sha256: sourceFileHash,
    source: 'paste',
    uploadEventType: 'pasted_prompt_created',
    metadataJson: { sourceType: 'pasted_prompt', workPacketId },
  }, actor);

  await recordAuditEvent(pool, id, 'generated_markdown_created', actor, {
    workPacketId,
    filename,
    sourceFileHash,
    agentPath,
  });

  // Work-packet folder model for NEW items + append-only event history (best-effort).
  try {
    if (storage && workPacketId) {
      storage.ensureWorkPacketFolder(workPacketId, { title, assigned_agent: assignedAgent, target_system: targetSystem });
      storage.appendPacketEvent(workPacketId, 'uploaded', {
        file_id: id, source_type: 'pasted_prompt', title,
        assigned_agent: assignedAgent || null, visibility,
        actor: actor?.email || actor?.name || 'unknown',
      });
    }
  } catch { /* non-fatal */ }

  return rowToApi(await getFileById(id));
}

function getAttachmentsDir(workPacketId) {
  const safe = String(workPacketId || '').replace(/[^A-Za-z0-9._-]/g, '');
  return path.join(getStorageRoot(), 'attachments', safe);
}

/** Persist uploaded attachment files for an existing dropbox item (same work packet). */
async function persistSubmissionAttachments(primaryRow, multerFiles, actor) {
  const pool = getAppPool();
  if (!primaryRow || primaryRow.deleted_at) throw new Error('NOT_FOUND');
  const workPacketId = primaryRow.work_packet_id;
  if (!workPacketId) throw new Error('WORK_PACKET_REQUIRED');

  const files = Array.isArray(multerFiles) ? multerFiles.filter((f) => f && f.path) : [];
  if (!files.length) return rowToApi(primaryRow);

  const attachDir = getAttachmentsDir(workPacketId);
  if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });

  const metadata = parseJsonField(primaryRow.metadata_json) || {};
  const existing = Array.isArray(metadata.attachments) ? metadata.attachments : [];
  const attachments = [...existing];

  for (const f of files) {
    const originalName = sanitizeOriginalName(f.originalname);
    const check = validateExtension(originalName);
    if (!check.ok) {
      try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      throw new Error(check.reason);
    }
    if (f.size > MAX_FILE_SIZE) {
      try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      throw new Error(`File ${originalName} exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit`);
    }

    const attId = crypto.randomUUID();
    const storedName = `${attId}${check.ext}`;
    const storageRelative = `attachments/${workPacketId}/${storedName}`.replace(/\\/g, '/');
    const destPath = path.join(getStorageRoot(), storageRelative);
    fs.renameSync(f.path, destPath);

    const att = {
      id: attId,
      originalName,
      storagePath: storageRelative,
      agentPath: `${AGENT_PATH_PREFIX}/${storageRelative}`,
      sizeBytes: f.size,
      mimeType: f.mimetype || guessMime(check.ext),
      sha256: sha256File(destPath),
    };
    attachments.push(att);

    try {
      if (storage) {
        const wpDir = storage.ensureWorkPacketFolder(workPacketId, {
          title: primaryRow.title,
          assigned_agent: primaryRow.assigned_agent,
          target_system: primaryRow.target_system,
        });
        if (wpDir) {
          const sourceDir = path.join(wpDir, 'source');
          if (!fs.existsSync(sourceDir)) fs.mkdirSync(sourceDir, { recursive: true });
          fs.copyFileSync(destPath, path.join(sourceDir, originalName));
        }
      }
    } catch { /* non-fatal */ }
  }

  metadata.attachments = attachments;
  await pool.query(
    'UPDATE docs_dropbox_files SET metadata_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(metadata), primaryRow.id],
  );

  if (primaryRow.source_type === 'pasted_prompt' && primaryRow.prompt_text) {
    const diskPath = getOriginalFilePath(primaryRow);
    if (diskPath && fs.existsSync(diskPath)) {
      const { frontmatter } = splitFrontmatter(fs.readFileSync(diskPath, 'utf-8'));
      const fm = { ...frontmatter, updated: new Date().toISOString() };
      const markdown = buildPastedPromptMarkdown(fm, primaryRow.prompt_text, attachments);
      fs.writeFileSync(diskPath, markdown, 'utf-8');
      const newSize = Buffer.byteLength(markdown, 'utf-8');
      await pool.query(
        'UPDATE docs_dropbox_files SET size_bytes = ?, sha256 = ?, updated_at = NOW() WHERE id = ?',
        [newSize, sha256Content(markdown), primaryRow.id],
      );
    }
  }

  await recordAuditEvent(pool, primaryRow.id, 'attachments_added', actor, {
    workPacketId,
    count: files.length,
    names: attachments.map((a) => a.originalName),
  });

  try {
    if (storage) {
      storage.appendPacketEvent(workPacketId, 'attachments_added', {
        file_id: primaryRow.id,
        count: files.length,
        actor: actor?.email || actor?.name || 'unknown',
      });
    }
  } catch { /* non-fatal */ }

  return rowToApi(await getFileById(primaryRow.id));
}

/** Register a single multer upload as a dropbox file row (used by /upload and /submit). */
async function registerMulterUpload(multerFile, actor, opts = {}) {
  const pool = getAppPool();
  const originalName = sanitizeOriginalName(multerFile.originalname);
  const check = validateExtension(originalName);
  if (!check.ok) {
    try { fs.unlinkSync(multerFile.path); } catch { /* ignore */ }
    throw new Error(check.reason);
  }

  const id = path.basename(multerFile.filename || multerFile.path, check.ext)
    || crypto.randomUUID();
  const storageRelative = multerFile.filename || path.basename(multerFile.path);
  const promptText = opts.promptText != null ? String(opts.promptText) : null;

  const workPacketId = await generateWorkPacketId(pool, {
    sourceType: 'uploaded_file',
    origin: 'dropbox',
    refId: id,
    createdByEmail: actor?.email || null,
  });

  await dropboxInsertUploadedRecord(pool, {
    id,
    workPacketId,
    fileName: storageRelative,
    originalFileName: originalName,
    storagePath: storageRelative,
    agentPath: `${AGENT_PATH_PREFIX}/${storageRelative}`,
    status: 'uploaded',
    intakeType: opts.intakeType || 'documentation_only',
    workItemMode: opts.workItemMode || 'none',
    uploadedBy: actor,
    uploadedAt: new Date().toISOString(),
    sizeBytes: multerFile.size,
    mimeType: multerFile.mimetype || guessMime(check.ext),
    sha256: sha256File(multerFile.path),
    title: path.basename(originalName, check.ext).replace(/[-_]+/g, ' '),
    promptText: promptText && promptText.trim() ? promptText.trim() : null,
  }, actor);

  try {
    if (storage && workPacketId) {
      storage.ensureWorkPacketFolder(workPacketId, { title: originalName });
      storage.appendPacketEvent(workPacketId, 'uploaded', {
        file_id: id, source_type: 'uploaded_file', title: originalName,
        actor: actor?.email || actor?.name || 'unknown',
      });
    }
  } catch { /* non-fatal */ }

  return rowToApi(await getFileById(id));
}

async function dropboxInsertUploadedRecord(pool, record, actor) {
  await insertFileRecord(pool, {
    ...record,
    sourceType: 'uploaded_file',
    source: 'upload',
    uploadEventType: 'upload',
    metadataJson: record.metadataJson || { workPacketId: record.workPacketId },
  }, actor);
}

/**
 * Unified dropbox submission: prompt only, files only, or prompt + attached files
 * as one work packet. At least one of prompt text or files is required.
 */
async function createDropboxSubmission(fields, actor, multerFiles = []) {
  const promptText = String(fields.promptText ?? fields.prompt_text ?? '');
  const trimmedPrompt = promptText.trim();
  const files = Array.isArray(multerFiles) ? multerFiles.filter((f) => f && f.path) : [];
  const intakeType = fields.intakeType || fields.intake_type || 'documentation_only';
  const workItemMode = fields.workItemMode || fields.work_item_mode || 'none';
  const createWorkItemOnSubmit = fields.createWorkItemOnSubmit === true
    || fields.createWorkItemOnSubmit === 'true'
    || String(fields.createWorkItemOnSubmit || '').toLowerCase() === 'true';

  if (!trimmedPrompt && !files.length) throw new Error('EMPTY_SUBMISSION');
  if (trimmedPrompt && trimmedPrompt.length > MAX_PROMPT_CHARS) throw new Error('PROMPT_TOO_LARGE');

  let result;
  if (trimmedPrompt) {
    const primary = await createPastedPrompt({
      ...fields,
      promptText: trimmedPrompt,
      intakeType,
      workItemMode,
    }, actor);
    if (!files.length) {
      result = primary;
    } else {
      const row = await getFileById(primary.id);
      result = await persistSubmissionAttachments(row, files, actor);
    }
  } else if (files.length === 1) {
    result = await registerMulterUpload(files[0], actor, { promptText: null, intakeType, workItemMode });
  } else {
    const primary = await registerMulterUpload(files[0], actor, { promptText: null, intakeType, workItemMode });
    const row = await getFileById(primary.id);
    result = await persistSubmissionAttachments(row, files.slice(1), actor);
  }

  if (createWorkItemOnSubmit && intakeType !== 'documentation_only') {
    const bridge = require('./docsWorkItemBridgeService');
    if (bridge.canUseWorkItems(actor)) {
      const mode = workItemMode === 'relaxed' ? 'relaxed' : 'governed';
      const createFn = mode === 'relaxed' ? bridge.createRelaxedWorkItem : bridge.createGovernedWorkItem;
      try {
        const linked = await createFn(result.id, actor, {
          title: fields.title,
          targetSystem: fields.targetSystem,
          assignedAgent: fields.assignedAgent,
          category: fields.category,
          priority: fields.priority,
          intakeType,
          workItemMode: mode,
          repoTarget: fields.repoTarget,
        });
        return linked.file;
      } catch (err) {
        console.error('[DocsDropbox] submit work-item create failed (row saved):', err.message || err);
        return result;
      }
    }
  }

  return result;
}

const INTAKE_TYPES = new Set(['documentation_only', 'work_item', 'hybrid']);

function normalizeIntakeType(value) {
  if (value == null || value === '' || value === 'documentation') return 'documentation_only';
  return String(value);
}

/** Mark a (pasted or uploaded) item ready for an agent to pick up. */
async function markReadyForAgent(id, actor, opts = {}) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');
  if (!['dropped', 'edited', 'ready_for_agent', 'uploaded', 'reviewed'].includes(row.status)) {
    throw new Error('INVALID_STATUS');
  }
  const assignedAgent = String(opts.assignedAgent ?? opts.assigned_agent ?? row.assigned_agent ?? '').trim();
  if (!assignedAgent) throw new Error('ASSIGNED_AGENT_REQUIRED');
  if (!ASSIGNED_AGENTS.has(assignedAgent)) throw new Error('INVALID_AGENT');

  await pool.query(
    `UPDATE docs_dropbox_files SET
      status = 'ready_for_agent',
      assigned_agent = ?,
      ready_at = NOW(), ready_by_id = ?, ready_by_email = ?, ready_by_name = ?,
      updated_at = NOW()
     WHERE id = ?`,
    [assignedAgent, actor?.id ?? null, actor?.email ?? null, actor?.name ?? null, id],
  );
  await recordAuditEvent(pool, id, 'marked_ready_for_agent', actor, {
    workPacketId: row.work_packet_id,
    assignedAgent,
  });
  return rowToApi(await getFileById(id));
}

/** Set intake_type on a dropbox row. Cannot downgrade work_item/hybrid → documentation_only. */
async function updateIntakeType(id, intakeType, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');
  if (['promoted', 'rejected', 'archived', 'cancelled'].includes(row.status)) {
    throw new Error('INVALID_STATUS');
  }

  const next = normalizeIntakeType(intakeType);
  if (!INTAKE_TYPES.has(next)) throw new Error('INVALID_INTAKE_TYPE');

  const current = normalizeIntakeType(row.intake_type);
  if ((current === 'work_item' || current === 'hybrid') && next === 'documentation_only') {
    throw new Error('INTAKE_TYPE_IMMUTABLE');
  }

  await pool.query(
    `UPDATE docs_dropbox_files SET intake_type = ?, updated_at = NOW() WHERE id = ?`,
    [next, id],
  );
  await recordAuditEvent(pool, id, 'intake_type_updated', actor, {
    from: current,
    to: next,
    workPacketId: row.work_packet_id,
  });
  return rowToApi(await getFileById(id));
}

/** Mark an item as picked up by an agent (blocks further edits). */
async function markPickedUp(id, actor) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');
  if (['promoted', 'rejected', 'archived', 'cancelled'].includes(row.status)) {
    throw new Error('INVALID_STATUS');
  }
  await pool.query(
    "UPDATE docs_dropbox_files SET status = 'picked_up', updated_at = NOW() WHERE id = ?",
    [id],
  );
  await recordAuditEvent(pool, id, 'agent_picked_up', actor, { workPacketId: row.work_packet_id });
  return rowToApi(await getFileById(id));
}

/** Cancel an item. Terminal but preserves the row + Work Packet id for audit. */
async function cancelFile(id, actor, reason = null) {
  const pool = getAppPool();
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');
  if (['promoted', 'rejected', 'archived', 'cancelled'].includes(row.status)) {
    throw new Error('INVALID_STATUS');
  }
  await pool.query(
    `UPDATE docs_dropbox_files SET
      status = 'cancelled',
      notes = CASE WHEN ? IS NULL THEN notes ELSE CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE '\n' END, ?) END,
      updated_at = NOW()
     WHERE id = ?`,
    [reason, reason ? `[cancelled] ${reason}` : null, id],
  );
  await recordAuditEvent(pool, id, 'cancelled', actor, reason ? { reason } : null);
  return rowToApi(await getFileById(id));
}

async function buildPreview(id) {
  const row = await getFileById(id);
  if (!row || row.deleted_at) throw new Error('NOT_FOUND');

  const filePath = getWorkingFilePath(row);
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
      editable: EDITABLE_EXTENSIONS.has(ext),
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
      editable: false,
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
      shortPrompt: row.short_prompt ?? null,
      metadata: {
        sizeBytes: stat.size,
        mimeType: row.mime_type,
        sha256: row.sha256,
        message: 'Preview not available for this file type. Use Download.',
      },
      secretWarnings: [],
      editable: false,
    };
  }

  throw new Error('PREVIEW_UNSUPPORTED');
}

async function getAuditEvents(fileId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT * FROM docs_dropbox_audit_events
     WHERE file_id = ?
     ORDER BY created_at DESC
     LIMIT 100`,
    [fileId],
  );
  return rows.map((r) => ({
    id: r.id,
    fileId: r.file_id,
    eventType: r.event_type,
    actor: { id: r.actor_id, email: r.actor_email, name: r.actor_name },
    details: parseJsonField(r.details),
    createdAt: toIso(r.created_at),
  }));
}

module.exports = {
  ALLOWED_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  MAX_FILE_SIZE,
  AGENT_PATH_PREFIX,
  VALID_STATUSES,
  TAB_STATUS_MAP,
  DOC_TYPES,
  ASSIGNED_AGENTS,
  MAX_PROMPT_CHARS,
  SHORT_PROMPT_CHARS,
  MAX_SHORT_PROMPT_CHARS,
  PREVIEW_METADATA_ONLY_EXTENSIONS,
  getStorageRoot,
  getEditedDir,
  getRevisionsDir,
  ensureStorageDirs,
  sanitizeOriginalName,
  validateExtension,
  slugFromTitle,
  slugForPaste,
  inferTitleFromPrompt,
  buildPastedPromptMarkdown,
  buildTargetPath,
  rowToApi,
  syncAll,
  listFiles,
  previewPastedPrompt,
  createPastedPrompt,
  createDropboxSubmission,
  persistSubmissionAttachments,
  registerMulterUpload,
  buildAttachmentsMarkdownSection,
  markReadyForAgent,
  updateIntakeType,
  markPickedUp,
  cancelFile,
  getFileById,
  insertFileRecord,
  getWorkingFilePath,
  getOriginalFilePath,
  buildPreview,
  getContent,
  saveContent,
  saveMarkup,
  saveShortPrompt,
  getRevisions,
  updateClassification,
  insertFrontmatter,
  markReady,
  markReviewed,
  promoteFile,
  archiveFile,
  rejectFile,
  softDeleteFile,
  getAuditEvents,
  scanSecrets,
  guessMime,
  sha256File,
  resolveUnderRoot,
  getOmDocsRoot,
};
