/**
 * OM Assets Library — storage paths, scopes, visibility, enums
 */

const path = require('path');

const STORAGE_ROOT = path.join(__dirname, '../../storage');
const OM_ASSETS_ROOT = path.join(STORAGE_ROOT, 'om-assets');

const SCOPES = new Set(['public', 'church', 'site', 'internal']);

const VISIBILITIES = new Set(['public', 'authenticated', 'internal_only']);

const SOURCE_TYPES = new Set(['upload', 'import', 'legacy', 'generated', 'screenshot', 'promote_copy', 'quarantine']);

const OWNER_SYSTEMS = new Set([
  'om', 'omai', 'omstudio', 'omworkshop', 'ombrain', 'certificate_studio', 'public_website',
]);

/**
 * What an asset is. The old category enum mixed these kinds with subjects
 * (cross, screenshot, header). Subjects now live in primary/secondary tags.
 */
const ASSET_TYPES = new Set([
  'image', 'icon', 'logo', 'font', 'document', 'video', 'template', 'background', 'flagged',
]);

/** Subjects that used to be categories. They define a type, they are not the type. */
const ASSET_SUBJECTS = new Set([
  'layout', 'border', 'cross', 'seal', 'header', 'watermark', 'signature', 'divider', 'branding',
  'diagram', 'infrastructure', 'ui_reference', 'screenshot', 'church_photo', 'clergy', 'certificate',
  'map', 'document_scan', 'marketing', 'social_media',
]);

const LEGACY_BUCKETS = new Set(['content', 'misc']);

const SUBJECT_TYPE = {
  layout: 'image',
  border: 'image',
  cross: 'icon',
  seal: 'image',
  header: 'image',
  watermark: 'image',
  signature: 'image',
  divider: 'image',
  branding: 'logo',
  diagram: 'image',
  infrastructure: 'image',
  ui_reference: 'image',
  screenshot: 'image',
  church_photo: 'image',
  clergy: 'image',
  certificate: 'image',
  map: 'image',
  document_scan: 'document',
  marketing: 'image',
  social_media: 'image',
};

/** @deprecated use ASSET_TYPES. Kept so existing imports still see the writable set. */
const CATEGORIES = ASSET_TYPES;

function typeFromFile(fileType, mime) {
  const raw = `${mime || ''} ${fileType || ''}`.toLowerCase();
  if (raw.includes('video') || /\b(mp4|webm|mov|m4v|ogv)\b/.test(raw)) return 'video';
  if (raw.includes('font') || /\b(woff2?|ttf|otf)\b/.test(raw)) return 'font';
  if (
    raw.includes('pdf') || raw.includes('html') || raw.includes('zip')
    || raw.includes('text/') || raw.includes('word') || raw.includes('document')
    || raw.includes('sheet') || raw.includes('presentation') || raw.includes('json')
  ) return 'document';
  return 'image';
}

function normalizeTag(value) {
  if (value == null) return null;
  const tag = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!tag || tag.length > 40 || /^\d+$/.test(tag)) return null;
  return tag;
}

/**
 * Collapse a legacy category, a type, and optional tags into the stored shape.
 * `screenshot` becomes type `image` with primary tag `screenshot`.
 */
function normalizeClassification({ category, primary_tag, secondary_tag, file_type, mime_type } = {}) {
  const raw = String(category || '').trim().toLowerCase();
  let type = ASSET_TYPES.has(raw) ? raw : null;
  let primary = normalizeTag(primary_tag);
  let secondary = normalizeTag(secondary_tag);

  if (!type && ASSET_SUBJECTS.has(raw)) {
    type = SUBJECT_TYPE[raw] || typeFromFile(file_type, mime_type);
    if (!primary) primary = raw;
  } else if (!type) {
    type = typeFromFile(file_type, mime_type);
  }

  if (primary === type) primary = null;
  if (secondary === type || secondary === primary) secondary = null;
  return { category: type, primary_tag: primary, secondary_tag: secondary };
}

function isCustomTagToken(token) {
  return typeof token === 'string' && /^[a-z][a-z0-9]{2,24}$/.test(token) && !/^\d+$/.test(token);
}

function takeVocab(tokens, index, vocab) {
  if (index >= tokens.length) return null;
  const two = tokens[index + 1] ? `${tokens[index]}_${tokens[index + 1]}` : '';
  if (two && vocab.has(two)) return { value: two, next: index + 2 };
  if (vocab.has(tokens[index])) return { value: tokens[index], next: index + 1 };
  return null;
}

function takeTag(tokens, index) {
  return takeVocab(tokens, index, ASSET_SUBJECTS)
    || (isCustomTagToken(tokens[index]) ? { value: tokens[index], next: index + 1 } : null);
}

/** Read type + primary + secondary off a filename. Returns null when nothing matches. */
function classifyFilename(filename) {
  if (!filename) return null;
  const base = path.basename(String(filename));
  const stem = base
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[\s.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const tokens = stem.split('_').filter(Boolean);
  if (!tokens.length) return null;

  let index = 0;
  let type = null;
  let primary = null;
  let secondary = null;

  const two = tokens[1] ? `${tokens[0]}_${tokens[1]}` : '';
  if (two && ASSET_SUBJECTS.has(two)) {
    primary = two;
    type = SUBJECT_TYPE[two] || 'image';
    index = 2;
  } else {
    const typeHit = takeVocab(tokens, 0, ASSET_TYPES);
    if (typeHit && typeHit.value !== 'flagged') {
      type = typeHit.value;
      index = typeHit.next;
    } else {
      const subjectHit = takeVocab(tokens, 0, ASSET_SUBJECTS);
      if (!subjectHit) return null;
      primary = subjectHit.value;
      type = SUBJECT_TYPE[primary] || 'image';
      index = subjectHit.next;
    }
  }

  if (!primary) {
    const primaryHit = takeTag(tokens, index);
    if (primaryHit && primaryHit.value !== type) {
      primary = primaryHit.value;
      index = primaryHit.next;
    }
  }
  if (primary) {
    const secondaryHit = takeTag(tokens, index);
    if (secondaryHit && secondaryHit.value !== type && secondaryHit.value !== primary) {
      secondary = secondaryHit.value;
    }
  }

  if (!type) return null;
  if (!primary && !ASSET_TYPES.has(tokens[0])) return null;
  return { category: type, primary_tag: primary, secondary_tag: secondary };
}

const PLATFORM_ADMIN_ROLES = new Set(['super_admin', 'admin']);
const SUPER_ADMIN_ROLES = new Set(['super_admin']);
const CHURCH_ASSET_WRITE_ROLES = new Set(['super_admin', 'admin', 'church_admin']);

// Cap sized for video uploads (previously 15MB, image-only). Videos are large,
// so allow up to 500MB per file; nginx client_max_body_size must be >= this.
const UPLOAD_MAX_BYTES = 500 * 1024 * 1024;
// .json allowed for internal tooling artifacts (e.g. Playwright storage_state)
// Document extensions (html/htm, doc(x), txt, md, zip, csv, xls(x), ppt(x))
// support the Documents Manager — standalone document files distinct from
// the image/video/font asset types above.
const ALLOWED_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|pdf|woff2?|ttf|otf|ico|mp4|webm|mov|m4v|ogv|ogg|json|html?|docx?|txt|md|zip|csv|xlsx?|pptx?)$/i;

/** Default visibility when scope is set and visibility omitted */
function defaultVisibilityForScope(scope) {
  switch (scope) {
    case 'public':
      return 'public';
    case 'church':
      return 'authenticated';
    case 'site':
      return 'authenticated';
    case 'internal':
      return 'internal_only';
    default:
      return 'authenticated';
  }
}

/** Logical storage prefix (not necessarily physical path) */
function logicalStoragePrefix(scope, churchId) {
  if (scope === 'public') return 'assets/public';
  if (scope === 'site') return 'assets/site';
  if (scope === 'internal') return 'assets/internal';
  if (scope === 'church') {
    if (!churchId) throw new Error('church_id required for church scope');
    return `assets/church/${churchId}`;
  }
  throw new Error(`Invalid scope: ${scope}`);
}

function buildLogicalStoragePath(scope, churchId, fileName) {
  const prefix = logicalStoragePrefix(scope, churchId);
  return `${prefix}/${fileName}`;
}

function scopeStorageDir(scope, churchId) {
  if (scope === 'public') return path.join(OM_ASSETS_ROOT, 'public');
  if (scope === 'site') return path.join(OM_ASSETS_ROOT, 'site');
  if (scope === 'internal') return path.join(OM_ASSETS_ROOT, 'internal');
  if (scope === 'church') {
    if (!churchId) throw new Error('church_id required for church scope');
    return path.join(OM_ASSETS_ROOT, `church-${churchId}`);
  }
  throw new Error(`Invalid scope: ${scope}`);
}

function resolveAbsolutePath(relativePath) {
  if (!relativePath) return null;
  if (path.isAbsolute(relativePath)) return relativePath;
  const normalized = relativePath.replace(/^\/+/, '');
  const full = path.join(STORAGE_ROOT, normalized);
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(STORAGE_ROOT))) {
    return null;
  }
  return resolved;
}

function toRelativeStoragePath(absolutePath) {
  return path.relative(STORAGE_ROOT, absolutePath).split(path.sep).join('/');
}

function mimeFromExt(ext) {
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.ogv': 'video/ogg',
    '.ogg': 'video/ogg',
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.zip': 'application/zip',
    '.csv': 'text/csv',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

module.exports = {
  STORAGE_ROOT,
  OM_ASSETS_ROOT,
  SCOPES,
  VISIBILITIES,
  SOURCE_TYPES,
  OWNER_SYSTEMS,
  CATEGORIES,
  ASSET_TYPES,
  ASSET_SUBJECTS,
  LEGACY_BUCKETS,
  SUBJECT_TYPE,
  typeFromFile,
  normalizeTag,
  normalizeClassification,
  classifyFilename,
  PLATFORM_ADMIN_ROLES,
  SUPER_ADMIN_ROLES,
  CHURCH_ASSET_WRITE_ROLES,
  UPLOAD_MAX_BYTES,
  ALLOWED_EXTENSIONS,
  defaultVisibilityForScope,
  logicalStoragePrefix,
  buildLogicalStoragePath,
  scopeStorageDir,
  resolveAbsolutePath,
  toRelativeStoragePath,
  mimeFromExt,
};
