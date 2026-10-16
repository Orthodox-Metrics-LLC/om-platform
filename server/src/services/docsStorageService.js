/**
 * OM Docs storage contract — canonical manifests, frontmatter standards, SHA-256
 * dedupe detection, safe (dry-run-default) cleanup, per-work-packet folders, and
 * append-only event history.
 *
 * The DATABASE is the source of truth for workflow state (docs_dropbox_files,
 * docs_pickup_files, om_agent_dispatches). This module makes the FILE layer
 * durable, portable, and reconstructable — it derives manifests from the DB +
 * disk hashes, and never invents authority the DB doesn't already hold.
 *
 * Dedupe identity: files are compared by CONTENT hash (body with any YAML
 * frontmatter stripped) so that adding standard frontmatter does not falsely
 * make byte-identical documents look unique. `file_hash` (whole file) is also
 * tracked for provenance / stale-detection.
 *
 * Storage layout (backward compatible):
 *   storage/docs-dropbox/            drop files (UUID.md | OMPKT-*.md) + index.json
 *   storage/docs-pickup/files/       pickup result files (UUID.md)
 *   storage/docs-pickup/index.json   pickup manifest
 *   storage/docs-work-packets/index.json   unified work-packet manifest
 *   storage/om-docs/work-packets/<work_packet_id>/   new work-packet folder model
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getAppPool } = require('../config/db');

let yaml;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

const PROD_ROOT = process.env.OM_PROD_ROOT || '/var/www/orthodoxmetrics/prod';
const DROPBOX_ROOT = process.env.DOCS_DROPBOX_ROOT || path.join(PROD_ROOT, 'storage', 'docs-dropbox');
const PICKUP_ROOT = process.env.DOCS_PICKUP_ROOT || path.join(PROD_ROOT, 'storage', 'docs-pickup');
const PICKUP_FILES_DIR = path.join(PICKUP_ROOT, 'files');
const WORK_PACKETS_MANIFEST_DIR = path.join(PROD_ROOT, 'storage', 'docs-work-packets');
const WORK_PACKET_FOLDER_ROOT = path.join(PROD_ROOT, 'storage', 'om-docs', 'work-packets');

const OMPKT_RE = /OMPKT-\d{8}-\d{4}/g;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const IGNORED_NAMES = new Set(['index.json', '.gitkeep', 'files', 'incoming', 'edited', 'revisions']);
const MANIFEST_VERSION = 1;

const MIME_MAP = {
  '.md': 'text/markdown', '.txt': 'text/plain', '.html': 'text/html',
  '.json': 'application/json', '.csv': 'text/csv', '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function guessMime(name) {
  return MIME_MAP[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

function toIso(dt) {
  if (!dt) return null;
  try {
    if (dt instanceof Date) return dt.toISOString();
    return new Date(dt).toISOString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Frontmatter helpers (optional js-yaml with a scalar/flow-array fallback)
// ---------------------------------------------------------------------------

function splitFrontmatter(content) {
  const text = String(content ?? '');
  const match = text.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: null, body: text, hasFrontmatter: false };
  return { frontmatter: parseYamlBlock(match[1]), body: match[2], hasFrontmatter: true };
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
    if (value == null || value === '') { lines.push(`${key}:`); continue; }
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(String(v))).join(', ')}]`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }
  return lines.join('\n');
}

function applyFrontmatter(content, frontmatter) {
  const { body } = splitFrontmatter(content);
  const block = stringifyYamlBlock(frontmatter);
  return `---\n${block}\n---\n\n${String(body).replace(/^\s+/, '')}`;
}

function inferTitle(body) {
  const m = String(body || '').match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

function extractOmpktRefs(text) {
  const set = new Set();
  const matches = String(text || '').match(OMPKT_RE);
  if (matches) matches.forEach((r) => set.add(r));
  return [...set];
}

function looksLikeTest(title, size, body) {
  const t = String(title || '').toLowerCase();
  if (/^test (doc|handoff|item|report)/.test(t)) return true;
  if (size < 60 && /^#\s*test\b/i.test(String(body || '').trim())) return true;
  return false;
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Disk enumeration
// ---------------------------------------------------------------------------

function listDropDiskFiles() {
  if (!fs.existsSync(DROPBOX_ROOT)) return [];
  return fs.readdirSync(DROPBOX_ROOT, { withFileTypes: true })
    .filter((d) => d.isFile() && !IGNORED_NAMES.has(d.name) && !d.name.startsWith('.'))
    .map((d) => ({
      name: d.name,
      absPath: path.join(DROPBOX_ROOT, d.name),
      relPath: d.name,
      agentPath: `storage/docs-dropbox/${d.name}`,
    }));
}

function listPickupDiskFiles() {
  const out = [];
  if (fs.existsSync(PICKUP_FILES_DIR)) {
    for (const d of fs.readdirSync(PICKUP_FILES_DIR, { withFileTypes: true })) {
      if (!d.isFile() || d.name.startsWith('.')) continue;
      out.push({
        name: d.name,
        absPath: path.join(PICKUP_FILES_DIR, d.name),
        relPath: `files/${d.name}`,
        agentPath: `storage/docs-pickup/files/${d.name}`,
      });
    }
  }
  // Root-level named pickup files (legacy, e.g. OMBRAIN-ARCHITECTURE-REPORT.md)
  if (fs.existsSync(PICKUP_ROOT)) {
    for (const d of fs.readdirSync(PICKUP_ROOT, { withFileTypes: true })) {
      if (!d.isFile() || IGNORED_NAMES.has(d.name) || d.name.startsWith('.')) continue;
      out.push({
        name: d.name,
        absPath: path.join(PICKUP_ROOT, d.name),
        relPath: d.name,
        agentPath: `storage/docs-pickup/${d.name}`,
      });
    }
  }
  return out;
}

function readFileInfo(absPath) {
  const raw = fs.readFileSync(absPath);
  const stat = fs.statSync(absPath);
  const text = raw.toString('utf8');
  const { frontmatter, body, hasFrontmatter } = splitFrontmatter(text);
  const fileHash = crypto.createHash('sha256').update(raw).digest('hex');
  const contentHash = hashContent(body);
  return {
    size: stat.size,
    mtime: stat.mtime,
    text,
    frontmatter,
    body,
    hasFrontmatter,
    fileHash,
    contentHash,
    title: (frontmatter && frontmatter.title) || inferTitle(body),
    titleConfidence: (frontmatter && frontmatter.title) ? 'frontmatter' : (inferTitle(body) ? 'inferred' : 'unknown'),
    ompktRefs: extractOmpktRefs(text),
  };
}

// ---------------------------------------------------------------------------
// DB row loaders
// ---------------------------------------------------------------------------

async function loadDropRows() {
  const [rows] = await getAppPool().query('SELECT * FROM docs_dropbox_files WHERE deleted_at IS NULL');
  return rows;
}

async function loadPickupRows() {
  const [rows] = await getAppPool().query('SELECT * FROM docs_pickup_files');
  return rows;
}

async function loadDispatchRows() {
  try {
    const [rows] = await getAppPool().query('SELECT * FROM om_agent_dispatches');
    return rows;
  } catch {
    return [];
  }
}

function parseMeta(row) {
  if (!row || !row.metadata_json) return {};
  if (typeof row.metadata_json === 'object') return row.metadata_json;
  try { return JSON.parse(row.metadata_json); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Scan — read-only dedupe / orphan / stale / mismatch detection
// ---------------------------------------------------------------------------

async function scanStorage() {
  const dropRows = await loadDropRows();
  const pickupRows = await loadPickupRows();

  const dropByStorage = new Map();
  for (const r of dropRows) {
    if (r.storage_path) dropByStorage.set(r.storage_path.replace(/\\/g, '/'), r);
    if (r.file_name) dropByStorage.set(r.file_name, r);
  }
  const pickupByStorage = new Map();
  for (const r of pickupRows) {
    if (r.storage_path) pickupByStorage.set(r.storage_path.replace(/\\/g, '/'), r);
  }

  const drop = [];
  const dropContentHashes = new Map(); // contentHash -> [entries]
  for (const f of listDropDiskFiles()) {
    const info = readFileInfo(f.absPath);
    const dbRow = dropByStorage.get(f.relPath) || dropByStorage.get(f.name) || null;
    const entry = {
      store: 'drop', name: f.name, relPath: f.relPath, agentPath: f.agentPath,
      size: info.size, fileHash: info.fileHash, contentHash: info.contentHash,
      hasFrontmatter: info.hasFrontmatter, title: info.title, titleConfidence: info.titleConfidence,
      ompktRefs: info.ompktRefs, mtime: toIso(info.mtime),
      workPacketId: (info.frontmatter && info.frontmatter.work_packet_id) || (dbRow && dbRow.work_packet_id) || info.ompktRefs[0] || null,
      inDb: Boolean(dbRow), dbId: dbRow ? dbRow.id : null,
      dbSize: dbRow ? dbRow.size_bytes : null, dbHash: dbRow ? dbRow.sha256 : null,
      staleSize: dbRow ? dbRow.size_bytes !== info.size : false,
      staleHash: dbRow && dbRow.sha256 ? dbRow.sha256 !== info.fileHash : false,
    };
    drop.push(entry);
    if (!dropContentHashes.has(info.contentHash)) dropContentHashes.set(info.contentHash, []);
    dropContentHashes.get(info.contentHash).push(entry);
  }

  const pickup = [];
  const pickupContentHashes = new Map();
  for (const f of listPickupDiskFiles()) {
    const info = readFileInfo(f.absPath);
    const dbRow = pickupByStorage.get(f.relPath) || null;
    const meta = parseMeta(dbRow);
    const wp = (info.frontmatter && info.frontmatter.work_packet_id)
      || (meta.workPacketId || meta.work_packet_id)
      || info.ompktRefs[0] || null;
    const entry = {
      store: 'pickup', name: f.name, relPath: f.relPath, agentPath: f.agentPath,
      size: info.size, fileHash: info.fileHash, contentHash: info.contentHash,
      hasFrontmatter: info.hasFrontmatter, title: info.title, titleConfidence: info.titleConfidence,
      ompktRefs: info.ompktRefs, mtime: toIso(info.mtime),
      workPacketId: wp,
      dispatchId: meta.returnedFromDispatch || meta.dispatch_id || null,
      sourceFileId: meta.sourceFileId || meta.source_file_id || null,
      resultType: looksLikeTest(info.title, info.size, info.body) ? 'test'
        : (dbRow ? 'agent_completion' : 'unknown'),
      legacyOrphan: !wp && !(meta.sourceFileId || meta.source_file_id),
      status: dbRow ? dbRow.status : null,
      inDb: Boolean(dbRow), dbId: dbRow ? dbRow.id : null,
      dbSize: dbRow ? dbRow.size_bytes : null, dbHash: dbRow ? dbRow.sha256 : null,
      staleSize: dbRow ? dbRow.size_bytes !== info.size : false,
      staleHash: dbRow && dbRow.sha256 ? dbRow.sha256 !== info.fileHash : false,
    };
    pickup.push(entry);
    if (!pickupContentHashes.has(info.contentHash)) pickupContentHashes.set(info.contentHash, []);
    pickupContentHashes.get(info.contentHash).push(entry);
  }

  // Duplicate groups within pickup (content-hash based, active files only)
  const duplicateGroups = [];
  for (const [h, members] of pickupContentHashes.entries()) {
    const active = members.filter((m) => m.status !== 'deleted');
    if (active.length > 1) {
      duplicateGroups.push({
        contentHash: h,
        title: active[0].title,
        size: active[0].size,
        members: active.map((m) => ({ name: m.name, relPath: m.relPath, status: m.status, dbId: m.dbId, mtime: m.mtime })),
        redundant: active.length - 1,
      });
    }
  }

  // Pickups that are byte/content copies of a DROP file
  const crossCopies = [];
  for (const [h, members] of pickupContentHashes.entries()) {
    if (dropContentHashes.has(h)) {
      const dropSrc = dropContentHashes.get(h)[0];
      crossCopies.push({
        contentHash: h,
        dropSource: { name: dropSrc.name, relPath: dropSrc.relPath, workPacketId: dropSrc.workPacketId },
        pickupCopies: members.filter((m) => m.status !== 'deleted').map((m) => ({ name: m.name, relPath: m.relPath, dbId: m.dbId })),
      });
    }
  }

  const tests = pickup.filter((p) => p.resultType === 'test' && p.status !== 'archived' && p.status !== 'deleted');
  const orphans = pickup.filter((p) => p.legacyOrphan && p.status !== 'deleted');
  const staleDb = [...drop, ...pickup].filter((e) => e.inDb && (e.staleSize || e.staleHash));

  // disk-vs-manifest mismatch (does a manifest exist and match disk?)
  const diskVsManifest = compareManifestToDisk();

  const summary = {
    generatedAt: new Date().toISOString(),
    dropFiles: drop.length,
    pickupFiles: pickup.length,
    dropTracked: drop.filter((d) => d.inDb).length,
    dropUntracked: drop.filter((d) => !d.inDb).length,
    pickupTracked: pickup.filter((p) => p.inDb).length,
    pickupUntracked: pickup.filter((p) => !p.inDb).length,
    duplicateGroups: duplicateGroups.length,
    redundantPickupCopies: duplicateGroups.reduce((n, g) => n + g.redundant, 0),
    crossCopyGroups: crossCopies.length,
    testFiles: tests.length,
    legacyOrphans: orphans.length,
    staleDbRecords: staleDb.length,
    dropMissingFrontmatter: drop.filter((d) => !d.hasFrontmatter).length,
    pickupMissingFrontmatter: pickup.filter((p) => !p.hasFrontmatter).length,
    reclaimableBytes: duplicateGroups.reduce((n, g) => n + g.size * g.redundant, 0),
  };

  return { summary, drop, pickup, duplicateGroups, crossCopies, tests, orphans, staleDb, diskVsManifest };
}

// ---------------------------------------------------------------------------
// Manifest builders (DB-sourced, disk-enriched)
// ---------------------------------------------------------------------------

function diskInfoForRel(store, relPath) {
  const root = store === 'drop' ? DROPBOX_ROOT : PICKUP_ROOT;
  const abs = path.resolve(root, relPath);
  if (!abs.startsWith(path.resolve(root)) || !fs.existsSync(abs)) return null;
  try { return readFileInfo(abs); } catch { return null; }
}

async function buildDropboxManifestData() {
  const rows = await loadDropRows();
  const files = rows.map((r) => {
    const rel = (r.storage_path || r.file_name || '').replace(/\\/g, '/');
    const info = diskInfoForRel('drop', rel);
    const meta = parseMeta(r);
    return {
      id: r.id,
      work_packet_id: r.work_packet_id || null,
      storedName: r.file_name,
      originalName: r.original_file_name || null,
      kind: 'drop',
      title: r.title || (info && info.title) || null,
      title_confidence: r.title ? 'frontmatter' : (info && info.titleConfidence) || 'unknown',
      source_type: r.source_type || meta.sourceType || 'unknown',
      source_filename: r.original_file_name || r.file_name,
      canonical_storage_path: rel,
      display_path: r.target_path || rel,
      agent_path: r.agent_path || `storage/docs-dropbox/${r.file_name}`,
      file_hash: (info && info.fileHash) || r.sha256 || null,
      content_hash: (info && info.contentHash) || null,
      size_bytes: (info && info.size) != null ? info.size : (r.size_bytes || 0),
      mime_type: r.mime_type || guessMime(r.file_name),
      target_system: r.target_system || null,
      assigned_agent: r.assigned_agent || null,
      visibility: r.target_visibility || null,
      status: r.status,
      created_by: r.uploaded_by_email || null,
      created_at: toIso(r.uploaded_at),
      updated_at: toIso(r.updated_at || r.last_status_change_at || r.uploaded_at),
      current_dispatch_id: r.current_dispatch_id || null,
      pickup_result_id: r.returned_pickup_id || null,
      archived_at: r.status === 'archived' ? toIso(r.updated_at) : null,
      deleted: false,
      on_disk: Boolean(info),
    };
  });
  // Ensure completeness: append any on-disk drop file missing from the DB.
  const covered = new Set(files.map((f) => f.canonical_storage_path));
  for (const f of listDropDiskFiles()) {
    if (covered.has(f.relPath)) continue;
    const info = diskInfoForRel('drop', f.relPath);
    files.push({
      id: path.basename(f.name, path.extname(f.name)),
      work_packet_id: (info && info.frontmatter && info.frontmatter.work_packet_id) || (info && info.ompktRefs[0]) || null,
      storedName: f.name, originalName: null, kind: 'drop',
      title: info && info.title, title_confidence: (info && info.titleConfidence) || 'unknown',
      source_type: 'unknown', source_filename: f.name,
      canonical_storage_path: f.relPath, display_path: f.relPath, agent_path: f.agentPath,
      file_hash: info && info.fileHash, content_hash: info && info.contentHash,
      size_bytes: (info && info.size) || 0, mime_type: guessMime(f.name),
      target_system: null, assigned_agent: null, visibility: null, status: 'untracked',
      created_by: null, created_at: info && toIso(info.mtime), updated_at: info && toIso(info.mtime),
      current_dispatch_id: null, pickup_result_id: null, archived_at: null,
      deleted: false, on_disk: true, source: 'disk_only',
    });
  }
  return { version: MANIFEST_VERSION, kind: 'drop', generated_at: new Date().toISOString(), count: files.length, files };
}

async function buildPickupManifestData() {
  const rows = await loadPickupRows();
  const files = rows.map((r) => {
    const rel = (r.storage_path || '').replace(/\\/g, '/');
    const info = diskInfoForRel('pickup', rel);
    const meta = parseMeta(r);
    const wp = meta.workPacketId || meta.work_packet_id || (info && info.ompktRefs[0]) || null;
    return {
      id: r.id,
      pickup_id: r.pickup_id || r.id,
      work_packet_id: wp,
      storedName: r.file_name,
      originalName: r.original_file_name || null,
      kind: 'pickup',
      title: r.title || (info && info.title) || null,
      title_confidence: r.title ? 'frontmatter' : (info && info.titleConfidence) || 'unknown',
      result_type: looksLikeTest(r.title || (info && info.title), (info && info.size) || r.size_bytes || 0, info && info.body)
        ? 'test' : 'agent_completion',
      canonical_storage_path: rel,
      display_path: rel,
      agent_path: r.agent_path || `storage/docs-pickup/${rel}`,
      file_hash: (info && info.fileHash) || r.sha256 || null,
      content_hash: (info && info.contentHash) || null,
      size_bytes: (info && info.size) != null ? info.size : (r.size_bytes || 0),
      mime_type: r.mime_type || guessMime(r.file_name),
      dispatch_id: meta.returnedFromDispatch || meta.dispatch_id || null,
      source_file_id: meta.sourceFileId || meta.source_file_id || null,
      legacy_orphan: !wp && !(meta.sourceFileId || meta.source_file_id),
      correlation_status: (wp || meta.sourceFileId || meta.source_file_id) ? 'linked' : 'unlinked',
      visibility: meta.visibility || meta.document_visibility || null,
      status: r.status,
      created_by: r.saved_by_email || null,
      created_at: toIso(r.saved_at),
      updated_at: toIso(r.picked_up_at || r.archived_at || r.saved_at),
      archived_at: toIso(r.archived_at),
      deleted: r.status === 'deleted',
      on_disk: Boolean(info),
    };
  });
  // Ensure completeness: append any on-disk pickup file missing from the DB.
  const covered = new Set(files.map((f) => f.canonical_storage_path));
  for (const f of listPickupDiskFiles()) {
    if (covered.has(f.relPath)) continue;
    const info = diskInfoForRel('pickup', f.relPath);
    const wp = (info && info.frontmatter && info.frontmatter.work_packet_id) || (info && info.ompktRefs[0]) || null;
    files.push({
      id: path.basename(f.name, path.extname(f.name)),
      pickup_id: path.basename(f.name, path.extname(f.name)),
      work_packet_id: wp, storedName: f.name, originalName: null, kind: 'pickup',
      title: info && info.title, title_confidence: (info && info.titleConfidence) || 'unknown',
      result_type: looksLikeTest(info && info.title, (info && info.size) || 0, info && info.body) ? 'test' : 'unknown',
      canonical_storage_path: f.relPath, display_path: f.relPath, agent_path: f.agentPath,
      file_hash: info && info.fileHash, content_hash: info && info.contentHash,
      size_bytes: (info && info.size) || 0, mime_type: guessMime(f.name),
      dispatch_id: null, source_file_id: null, legacy_orphan: !wp, correlation_status: wp ? 'linked' : 'unlinked',
      visibility: null, status: 'untracked', created_by: null,
      created_at: info && toIso(info.mtime), updated_at: info && toIso(info.mtime), archived_at: null,
      deleted: false, on_disk: true, source: 'disk_only',
    });
  }
  return { version: MANIFEST_VERSION, kind: 'pickup', generated_at: new Date().toISOString(), count: files.length, files };
}

async function buildWorkPacketsManifestData() {
  const [dropRows, pickupRows, dispatchRows] = await Promise.all([loadDropRows(), loadPickupRows(), loadDispatchRows()]);
  const byWp = new Map();

  const ensure = (wp) => {
    if (!byWp.has(wp)) {
      byWp.set(wp, {
        work_packet_id: wp, id: wp, title: null, source_type: null, source_filename: null,
        canonical_storage_path: null, display_path: null, agent_path: null,
        file_hash: null, size_bytes: null, mime_type: null, target_system: null,
        assigned_agent: null, visibility: null, status: null, created_by: null,
        created_at: null, updated_at: null, current_dispatch_id: null,
        pickup_result_id: null, archived_at: null, deleted: false,
        dispatch_ids: [], pickup_result_ids: [],
      });
    }
    return byWp.get(wp);
  };

  for (const r of dropRows) {
    if (!r.work_packet_id) continue;
    const rel = (r.storage_path || r.file_name || '').replace(/\\/g, '/');
    const info = diskInfoForRel('drop', rel);
    const rec = ensure(r.work_packet_id);
    rec.title = r.title || (info && info.title) || rec.title;
    rec.source_type = r.source_type || rec.source_type;
    rec.source_filename = r.original_file_name || r.file_name;
    rec.canonical_storage_path = rel;
    rec.display_path = r.target_path || rel;
    rec.agent_path = r.agent_path || `storage/docs-dropbox/${r.file_name}`;
    rec.file_hash = (info && info.fileHash) || r.sha256 || rec.file_hash;
    rec.size_bytes = (info && info.size) != null ? info.size : (r.size_bytes || rec.size_bytes);
    rec.mime_type = r.mime_type || guessMime(r.file_name);
    rec.target_system = r.target_system || rec.target_system;
    rec.assigned_agent = r.assigned_agent || rec.assigned_agent;
    rec.visibility = r.target_visibility || rec.visibility;
    rec.status = r.status;
    rec.created_by = r.uploaded_by_email || rec.created_by;
    rec.created_at = toIso(r.uploaded_at);
    rec.updated_at = toIso(r.updated_at || r.last_status_change_at || r.uploaded_at);
    rec.current_dispatch_id = r.current_dispatch_id || rec.current_dispatch_id;
    rec.pickup_result_id = r.returned_pickup_id || rec.pickup_result_id;
    rec.archived_at = r.status === 'archived' ? toIso(r.updated_at) : rec.archived_at;
  }

  for (const d of dispatchRows) {
    if (!d.work_packet_id) continue;
    const rec = ensure(d.work_packet_id);
    if (!rec.dispatch_ids.includes(d.dispatch_id)) rec.dispatch_ids.push(d.dispatch_id);
    if (!rec.assigned_agent) rec.assigned_agent = d.assigned_agent;
  }

  for (const p of pickupRows) {
    const meta = parseMeta(p);
    const wp = meta.workPacketId || meta.work_packet_id;
    if (!wp) continue;
    const rec = ensure(wp);
    const pid = p.pickup_id || p.id;
    if (!rec.pickup_result_ids.includes(pid)) rec.pickup_result_ids.push(pid);
    if (!rec.pickup_result_id) rec.pickup_result_id = pid;
  }

  const packets = [...byWp.values()];
  return { version: MANIFEST_VERSION, kind: 'work_packets', generated_at: new Date().toISOString(), count: packets.length, packets };
}

function writeManifest(absPath, data, { dryRun }) {
  if (dryRun) return { path: absPath, wrote: false, count: data.count };
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(data, null, 2));
  return { path: absPath, wrote: true, count: data.count };
}

async function rebuildManifests({ dryRun = true } = {}) {
  const [dropData, pickupData, wpData] = await Promise.all([
    buildDropboxManifestData(), buildPickupManifestData(), buildWorkPacketsManifestData(),
  ]);
  return {
    dryRun,
    dropbox: writeManifest(path.join(DROPBOX_ROOT, 'index.json'), dropData, { dryRun }),
    pickup: writeManifest(path.join(PICKUP_ROOT, 'index.json'), pickupData, { dryRun }),
    workPackets: writeManifest(path.join(WORK_PACKETS_MANIFEST_DIR, 'index.json'), wpData, { dryRun }),
  };
}

function readManifest(absPath) {
  if (!fs.existsSync(absPath)) return null;
  try { return JSON.parse(fs.readFileSync(absPath, 'utf8')); } catch { return null; }
}

function compareManifestToDisk() {
  const result = { dropbox: null, pickup: null };
  const check = (store, root, manifestPath, diskList) => {
    const manifest = readManifest(manifestPath);
    if (!manifest || !Array.isArray(manifest.files)) return { exists: false };
    const diskSet = new Set(diskList.map((f) => f.relPath));
    const manifestSet = new Set(manifest.files.map((f) => f.canonical_storage_path).filter(Boolean));
    const missingOnDisk = [...manifestSet].filter((p) => !diskSet.has(p) && !manifest.files.find((m) => m.canonical_storage_path === p && m.deleted));
    const missingFromManifest = [...diskSet].filter((p) => !manifestSet.has(p));
    return { exists: true, generated_at: manifest.generated_at, missingOnDisk, missingFromManifest };
  };
  result.dropbox = check('drop', DROPBOX_ROOT, path.join(DROPBOX_ROOT, 'index.json'), listDropDiskFiles());
  result.pickup = check('pickup', PICKUP_ROOT, path.join(PICKUP_ROOT, 'index.json'), listPickupDiskFiles());
  return result;
}

async function verifyManifests() {
  return { generatedAt: new Date().toISOString(), ...compareManifestToDisk() };
}

// ---------------------------------------------------------------------------
// Safe cleanup actions (dry-run default; destructive requires confirm=true)
// ---------------------------------------------------------------------------

async function recordPickupAudit(pool, fileId, eventType, actor, details) {
  try {
    await pool.query(
      `INSERT INTO docs_pickup_audit_events (file_id, event_type, actor_id, actor_email, actor_name, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fileId, eventType, actor?.id ?? null, actor?.email ?? null, actor?.name ?? null, details ? JSON.stringify(details) : null],
    );
  } catch { /* audit best-effort */ }
}

/** Soft-delete exact-duplicate pickups (content-hash), keeping the earliest per group. */
async function dedupeExactPickups({ dryRun = true, confirm = false, actor = null } = {}) {
  const scan = await scanStorage();
  const pool = getAppPool();
  const planned = [];
  for (const group of scan.duplicateGroups) {
    const members = group.members
      .filter((m) => m.dbId && m.status !== 'deleted')
      .sort((a, b) => new Date(a.mtime || 0) - new Date(b.mtime || 0));
    if (members.length < 2) continue;
    const keeper = members[0];
    for (const dup of members.slice(1)) {
      planned.push({ keep: keeper.dbId, remove: dup.dbId, contentHash: group.contentHash, name: dup.name });
    }
  }
  let applied = 0;
  if (!dryRun && confirm) {
    for (const p of planned) {
      await pool.query(
        `UPDATE docs_pickup_files SET status='deleted', deleted_at=NOW(),
           deleted_by_email=?, deleted_by_name=?,
           notes = CONCAT(COALESCE(notes,''), '\n[dedupe] duplicate of ', ?)
         WHERE id=? AND status<>'deleted'`,
        [actor?.email ?? 'system', actor?.name ?? 'storage-cleanup', p.keep, p.remove],
      );
      await recordPickupAudit(pool, p.remove, 'duplicate_removed', actor, { keptId: p.keep, contentHash: p.contentHash });
      applied += 1;
    }
  }
  return { action: 'dedupe_exact_pickups', dryRun: dryRun || !confirm, plannedCount: planned.length, applied, planned };
}

/** Archive test/placeholder pickup files (status=archived + result_type=test tag). */
async function archiveTests({ dryRun = true, confirm = false, actor = null } = {}) {
  const scan = await scanStorage();
  const pool = getAppPool();
  const planned = scan.tests.map((t) => ({ id: t.dbId, name: t.name, title: t.title }));
  let applied = 0;
  if (!dryRun && confirm) {
    for (const t of planned) {
      if (!t.id) continue;
      await pool.query(
        `UPDATE docs_pickup_files SET status='archived', archived_at=NOW(),
           archived_by_email=?, archived_by_name=?,
           metadata_json = JSON_SET(COALESCE(metadata_json,'{}'), '$.result_type', 'test')
         WHERE id=? AND status NOT IN ('archived','deleted')`,
        [actor?.email ?? 'system', actor?.name ?? 'storage-cleanup', t.id],
      );
      await recordPickupAudit(pool, t.id, 'test_archived', actor, { title: t.title });
      applied += 1;
    }
  }
  return { action: 'archive_tests', dryRun: dryRun || !confirm, plannedCount: planned.length, applied, planned };
}

/** Tag legacy-orphan pickups (unlinked) — reversible metadata tag, no deletion. */
async function quarantineOrphans({ dryRun = true, confirm = false, actor = null } = {}) {
  const scan = await scanStorage();
  const pool = getAppPool();
  const planned = scan.orphans.map((o) => ({ id: o.dbId, name: o.name, title: o.title }));
  let applied = 0;
  if (!dryRun && confirm) {
    for (const o of planned) {
      if (!o.id) continue;
      await pool.query(
        `UPDATE docs_pickup_files SET
           metadata_json = JSON_SET(JSON_SET(COALESCE(metadata_json,'{}'),
             '$.legacy_orphan', true), '$.correlation_status', 'unlinked')
         WHERE id=?`,
        [o.id],
      );
      await recordPickupAudit(pool, o.id, 'orphan_quarantined', actor, { title: o.title });
      applied += 1;
    }
  }
  return { action: 'quarantine_orphans', dryRun: dryRun || !confirm, plannedCount: planned.length, applied, planned };
}

/** Repair stale DB size/hash where they disagree with disk. */
async function repairStale({ dryRun = true, confirm = false } = {}) {
  const scan = await scanStorage();
  const pool = getAppPool();
  const planned = scan.staleDb.map((e) => ({
    store: e.store, dbId: e.dbId, name: e.name,
    fromSize: e.dbSize, toSize: e.size, fromHash: e.dbHash, toHash: e.fileHash,
  }));
  let applied = 0;
  if (!dryRun && confirm) {
    for (const p of planned) {
      const table = p.store === 'drop' ? 'docs_dropbox_files' : 'docs_pickup_files';
      await pool.query(`UPDATE ${table} SET size_bytes=?, sha256=? WHERE id=?`, [p.toSize, p.toHash, p.dbId]);
      applied += 1;
    }
  }
  return { action: 'repair_stale', dryRun: dryRun || !confirm, plannedCount: planned.length, applied, planned };
}

// ---------------------------------------------------------------------------
// Work-packet folder model + append-only event history (for NEW items)
// ---------------------------------------------------------------------------

function workPacketFolder(wp) {
  const safe = String(wp || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe) return null;
  return path.join(WORK_PACKET_FOLDER_ROOT, safe);
}

function ensureWorkPacketFolder(wp, meta = {}) {
  const dir = workPacketFolder(wp);
  if (!dir) return null;
  for (const sub of ['', 'source', 'dispatches', 'pickup', 'revisions']) {
    const p = sub ? path.join(dir, sub) : dir;
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, JSON.stringify({ work_packet_id: wp, created_at: new Date().toISOString(), ...meta }, null, 2));
  }
  const packetPath = path.join(dir, 'packet.md');
  if (!fs.existsSync(packetPath)) {
    const fm = {
      record_type: 'om_docs_work_packet', work_packet_id: wp,
      title: meta.title || wp, created_at: new Date().toISOString(),
    };
    fs.writeFileSync(packetPath, `---\n${stringifyYamlBlock(fm)}\n---\n\n# ${meta.title || wp}\n`);
  }
  return dir;
}

/** Append an event to the work packet's events.jsonl (mirrors DB audit/OMBrain). */
function appendPacketEvent(wp, type, data = {}) {
  try {
    const dir = workPacketFolder(wp);
    if (!dir) return false;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), type, ...data });
    fs.appendFileSync(path.join(dir, 'events.jsonl'), line + '\n');
    return true;
  } catch {
    return false;
  }
}

function readPacketEvents(wp, limit = 500) {
  const dir = workPacketFolder(wp);
  if (!dir) return [];
  const file = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

module.exports = {
  // paths
  DROPBOX_ROOT, PICKUP_ROOT, PICKUP_FILES_DIR, WORK_PACKETS_MANIFEST_DIR, WORK_PACKET_FOLDER_ROOT,
  // frontmatter
  splitFrontmatter, parseYamlBlock, stringifyYamlBlock, applyFrontmatter, inferTitle,
  extractOmpktRefs, looksLikeTest, hashContent,
  // disk + db loaders
  listDropDiskFiles, listPickupDiskFiles, readFileInfo,
  loadDropRows, loadPickupRows, loadDispatchRows, parseMeta,
  // scan + manifests
  scanStorage, buildDropboxManifestData, buildPickupManifestData, buildWorkPacketsManifestData,
  rebuildManifests, verifyManifests, readManifest, compareManifestToDisk,
  // cleanup
  dedupeExactPickups, archiveTests, quarantineOrphans, repairStale,
  // work-packet folders + events
  workPacketFolder, ensureWorkPacketFolder, appendPacketEvent, readPacketEvents,
};
