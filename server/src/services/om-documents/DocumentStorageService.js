'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isValidDocumentId } = require('./documentId');
const {
  getPlansRoot,
  assertUnderPlans,
  toRelative,
  packageDirFor,
  parsePackageLocation,
  inboxProducerRoots,
  LIFECYCLE_DIRS,
  PRODUCERS,
  WORKING_HORIZONS,
} = require('./plansPaths');

const ALLOWED_EXTENSIONS = new Set([
  '.md', '.txt', '.html', '.json', '.csv', '.pdf', '.docx', '.zip',
]);
const BLOCKED_EXTENSIONS = new Set([
  '.sh', '.bash', '.php', '.py', '.js', '.ts', '.exe', '.bin', '.bat', '.cmd',
  '.ps1', '.msi', '.dll', '.so', '.jar',
]);
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.html', '.json', '.csv']);
const OMDOC_DIR_RE = /^OMDOC-\d{8}-[A-Z0-9]{6}$/;

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function validateExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!ext) return { ok: false, reason: 'File must have an extension' };
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `Extension ${ext} is not allowed` };
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `Only ${[...ALLOWED_EXTENSIONS].join(', ')} files are allowed` };
  }
  return { ok: true, ext };
}

function sanitizeFileName(name) {
  const base = path.basename(String(name || 'document.md'));
  return base.replace(/[^\w.\- ()[\]]+/g, '_').replace(/^\.+/, '').slice(0, 200) || 'document.md';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeManifest(packageDir, manifest) {
  const abs = assertUnderPlans(path.join(packageDir, 'manifest.json'));
  fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function readManifest(packageDir) {
  const abs = assertUnderPlans(path.join(packageDir, 'manifest.json'));
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

function buildManifest({ documentId, title, source, producer, primaryFile, createdAt, legacy, parentDocumentId, relatedDispatchId }) {
  const m = {
    document_id: documentId,
    title: title || documentId,
    source: source || 'HUMAN',
    producer: producer || 'manual',
    created_at: createdAt || new Date().toISOString(),
    primary_file: primaryFile,
  };
  if (parentDocumentId) m.parent_document_id = parentDocumentId;
  if (relatedDispatchId) m.related_dispatch_id = relatedDispatchId;
  if (legacy) m.legacy = legacy;
  return m;
}

/**
 * Create a document package on the plans share.
 * @returns {{ packageDir, relativePath, primaryFile, sizeBytes, sha256, manifest }}
 */
function createDocument({
  documentId,
  title,
  producer = 'manual',
  source = 'HUMAN',
  lifecycle = 'inbox',
  horizon = null,
  primaryFileName = 'document.md',
  contentBuffer,
  attachments = [],
  legacy = null,
  parentDocumentId = null,
  relatedDispatchId = null,
}) {
  if (!isValidDocumentId(documentId)) {
    throw Object.assign(new Error('INVALID_DOCUMENT_ID'), { code: 'INVALID_DOCUMENT_ID' });
  }
  const check = validateExtension(primaryFileName);
  if (!check.ok) {
    throw Object.assign(new Error(check.reason), { code: 'INVALID_EXTENSION' });
  }
  if (!Buffer.isBuffer(contentBuffer) && typeof contentBuffer !== 'string') {
    throw Object.assign(new Error('CONTENT_REQUIRED'), { code: 'CONTENT_REQUIRED' });
  }
  const buf = Buffer.isBuffer(contentBuffer) ? contentBuffer : Buffer.from(String(contentBuffer), 'utf8');
  const primaryFile = sanitizeFileName(primaryFileName);
  const packageDir = packageDirFor({ lifecycle, producer, horizon, documentId });
  if (fs.existsSync(packageDir)) {
    throw Object.assign(new Error('PACKAGE_EXISTS'), { code: 'PACKAGE_EXISTS' });
  }
  ensureDir(packageDir);
  ensureDir(path.join(packageDir, 'attachments'));
  const primaryAbs = assertUnderPlans(path.join(packageDir, primaryFile));
  fs.writeFileSync(primaryAbs, buf);
  for (const att of attachments) {
    if (!att || !att.name || att.buffer == null) continue;
    const attCheck = validateExtension(att.name);
    if (!attCheck.ok) continue;
    const attName = sanitizeFileName(att.name);
    fs.writeFileSync(
      assertUnderPlans(path.join(packageDir, 'attachments', attName)),
      Buffer.isBuffer(att.buffer) ? att.buffer : Buffer.from(String(att.buffer)),
    );
  }
  const manifest = buildManifest({
    documentId,
    title,
    source,
    producer,
    primaryFile,
    legacy,
    parentDocumentId,
    relatedDispatchId,
  });
  writeManifest(packageDir, manifest);
  return {
    packageDir,
    relativePath: toRelative(packageDir),
    primaryFile,
    sizeBytes: buf.length,
    sha256: sha256Buffer(buf),
    manifest,
  };
}

function getDocumentPackage(packageDirOrRelative) {
  const plansRoot = getPlansRoot();
  const abs = path.isAbsolute(packageDirOrRelative)
    ? assertUnderPlans(packageDirOrRelative, plansRoot)
    : assertUnderPlans(path.join(plansRoot, packageDirOrRelative), plansRoot);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return null;
  }
  const location = parsePackageLocation(abs);
  const manifest = readManifest(abs);
  const primaryFile = manifest?.primary_file || null;
  let primaryAbs = primaryFile ? path.join(abs, primaryFile) : null;
  if (primaryAbs && !fs.existsSync(primaryAbs)) primaryAbs = null;
  return {
    packageDir: abs,
    relativePath: toRelative(abs),
    location,
    manifest,
    primaryFile,
    primaryAbs,
    exists: true,
  };
}

function moveDocument(fromRelativeOrAbs, { lifecycle, producer, horizon, documentId }) {
  const plansRoot = getPlansRoot();
  const fromAbs = path.isAbsolute(fromRelativeOrAbs)
    ? assertUnderPlans(fromRelativeOrAbs, plansRoot)
    : assertUnderPlans(path.join(plansRoot, fromRelativeOrAbs), plansRoot);
  if (!fs.existsSync(fromAbs)) {
    throw Object.assign(new Error('PACKAGE_MISSING'), { code: 'PACKAGE_MISSING' });
  }
  const toAbs = packageDirFor({ lifecycle, producer, horizon, documentId });
  if (path.resolve(fromAbs) === path.resolve(toAbs)) {
    return { packageDir: toAbs, relativePath: toRelative(toAbs) };
  }
  ensureDir(path.dirname(toAbs));
  if (fs.existsSync(toAbs)) {
    throw Object.assign(new Error('TARGET_EXISTS'), { code: 'TARGET_EXISTS' });
  }
  fs.renameSync(fromAbs, toAbs);
  const manifest = readManifest(toAbs) || {};
  manifest.updated_at = new Date().toISOString();
  writeManifest(toAbs, manifest);
  return { packageDir: toAbs, relativePath: toRelative(toAbs) };
}

function archiveDocument(fromRelativeOrAbs, documentId) {
  return moveDocument(fromRelativeOrAbs, {
    lifecycle: 'archived',
    producer: null,
    horizon: null,
    documentId,
  });
}

function quarantineDocument(fromRelativeOrAbs, documentId) {
  return moveDocument(fromRelativeOrAbs, {
    lifecycle: 'quarantined',
    producer: null,
    horizon: null,
    documentId,
  });
}

function addAttachment(packageDirOrRelative, name, buffer) {
  const pkg = getDocumentPackage(packageDirOrRelative);
  if (!pkg) throw Object.assign(new Error('PACKAGE_MISSING'), { code: 'PACKAGE_MISSING' });
  const check = validateExtension(name);
  if (!check.ok) throw Object.assign(new Error(check.reason), { code: 'INVALID_EXTENSION' });
  const attDir = path.join(pkg.packageDir, 'attachments');
  ensureDir(attDir);
  const safe = sanitizeFileName(name);
  const abs = assertUnderPlans(path.join(attDir, safe));
  fs.writeFileSync(abs, Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer)));
  return { name: safe, path: toRelative(abs) };
}

function deleteAttachment(packageDirOrRelative, name) {
  const pkg = getDocumentPackage(packageDirOrRelative);
  if (!pkg) throw Object.assign(new Error('PACKAGE_MISSING'), { code: 'PACKAGE_MISSING' });
  const abs = assertUnderPlans(path.join(pkg.packageDir, 'attachments', path.basename(name)));
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  return true;
}

function readPrimaryFile(packageDirOrRelative) {
  const pkg = getDocumentPackage(packageDirOrRelative);
  if (!pkg || !pkg.primaryAbs) {
    throw Object.assign(new Error('PRIMARY_MISSING'), { code: 'PRIMARY_MISSING' });
  }
  const ext = path.extname(pkg.primaryFile).toLowerCase();
  const buf = fs.readFileSync(pkg.primaryAbs);
  return {
    buffer: buf,
    text: TEXT_EXTENSIONS.has(ext) ? buf.toString('utf8') : null,
    primaryFile: pkg.primaryFile,
    sizeBytes: buf.length,
    sha256: sha256Buffer(buf),
    mimeHint: ext,
  };
}

function writePrimaryFile(packageDirOrRelative, content) {
  const pkg = getDocumentPackage(packageDirOrRelative);
  if (!pkg || !pkg.primaryAbs) {
    throw Object.assign(new Error('PRIMARY_MISSING'), { code: 'PRIMARY_MISSING' });
  }
  const ext = path.extname(pkg.primaryFile).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw Object.assign(new Error('NOT_EDITABLE'), { code: 'NOT_EDITABLE' });
  }
  const text = String(content ?? '');
  fs.writeFileSync(pkg.primaryAbs, text, 'utf8');
  const manifest = pkg.manifest || {};
  manifest.updated_at = new Date().toISOString();
  writeManifest(pkg.packageDir, manifest);
  return {
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    sha256: sha256Buffer(Buffer.from(text, 'utf8')),
  };
}

function verifyFilesystemState(packageDirOrRelative) {
  const pkg = getDocumentPackage(packageDirOrRelative);
  const issues = [];
  if (!pkg) return { ok: false, issues: ['package_missing'] };
  if (!pkg.manifest) issues.push('manifest_missing');
  if (pkg.manifest && pkg.location?.documentId && pkg.manifest.document_id !== pkg.location.documentId) {
    issues.push('manifest_document_id_mismatch');
  }
  if (!pkg.primaryAbs) issues.push('primary_missing');
  if (pkg.location && !isValidDocumentId(pkg.location.documentId)) {
    issues.push('invalid_document_id_in_path');
  }
  return { ok: issues.length === 0, issues, package: pkg };
}

/**
 * Scan producer inboxes (and optionally other lifecycle roots) for OMDOC packages.
 * Returns discovered packages; does not mutate DB.
 */
function scanPackages({ includeAllLifecycles = false } = {}) {
  const found = [];
  const roots = [];
  if (includeAllLifecycles) {
    for (const [lifecycle, dir] of Object.entries(LIFECYCLE_DIRS)) {
      if (lifecycle === 'inbox') {
        roots.push(...inboxProducerRoots().map((r) => ({ root: r, lifecycle })));
      } else if (lifecycle === 'working') {
        for (const h of WORKING_HORIZONS) {
          roots.push({ root: path.join(getPlansRoot(), dir, h), lifecycle, horizon: h });
        }
      } else {
        roots.push({ root: path.join(getPlansRoot(), dir), lifecycle });
      }
    }
  } else {
    for (const r of inboxProducerRoots()) {
      roots.push({ root: r, lifecycle: 'inbox' });
    }
  }

  for (const { root, lifecycle, horizon } of roots) {
    if (!fs.existsSync(root)) continue;
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || !OMDOC_DIR_RE.test(ent.name)) continue;
      const packageDir = path.join(root, ent.name);
      const verified = verifyFilesystemState(packageDir);
      found.push({
        documentId: ent.name,
        lifecycle,
        horizon: horizon || null,
        packageDir,
        relativePath: toRelative(packageDir),
        ok: verified.ok,
        issues: verified.issues,
        manifest: verified.package?.manifest || null,
        producer: verified.package?.location?.producer
          || (lifecycle === 'inbox' ? path.basename(root) : null),
      });
    }
  }
  return found;
}

module.exports = {
  ALLOWED_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  TEXT_EXTENSIONS,
  OMDOC_DIR_RE,
  validateExtension,
  sanitizeFileName,
  createDocument,
  getDocumentPackage,
  moveDocument,
  archiveDocument,
  quarantineDocument,
  addAttachment,
  deleteAttachment,
  readPrimaryFile,
  writePrimaryFile,
  verifyFilesystemState,
  scanPackages,
  readManifest,
  writeManifest,
  buildManifest,
  sha256Buffer,
};
