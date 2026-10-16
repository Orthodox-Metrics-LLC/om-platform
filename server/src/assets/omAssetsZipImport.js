/**
 * Secure ZIP → Asset Manager media import.
 *
 * Archives are analyzed first and stored in a temporary directory. The caller
 * reviews the generated manifest (destination/category/folder/renamed files),
 * then explicitly commits it. Import never trusts archive paths and rejects
 * symlinks, encrypted entries, unsupported files, zip bombs and invalid media.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const { getAppPool } = require('../config/db');
const {
  CATEGORIES,
  UPLOAD_MAX_BYTES,
  defaultVisibilityForScope,
  scopeStorageDir,
  buildLogicalStoragePath,
  toRelativeStoragePath,
  mimeFromExt,
} = require('./omAssetsConstants');
const {
  createAssetRecord,
  getAssetById,
  hashFileBuffer,
  normalizeDirectoryPath,
} = require('./omAssetsService');
const smartAnalyze = require('./omAssetsSmartAnalyze');

const ZIP_TEMP_ROOT = path.join(__dirname, '../../storage/om-assets/import-temp');
const ZIP_UPLOAD_ROOT = path.join(ZIP_TEMP_ROOT, 'uploads');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.ogg']);
const MAX_ENTRIES = 500;
const MAX_IMAGE_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_ENTRY_BYTES = UPLOAD_MAX_BYTES;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ZIP_BYTES = MAX_TOTAL_BYTES;
const MAX_ZIP_CHUNK_COUNT = 64;
const MAX_ZIP_CHUNK_BYTES = 96 * 1024 * 1024;
const CHUNK_UPLOAD_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_COMPRESSION_RATIO = 120;
const GENERIC_NAME = /^(image|img|photo|picture|screenshot|chatgpt|dall.?e|untitled|download|[0-9a-f]{8}-[0-9a-f-]{20,})(?:[\s_-]*\d+)?$/i;
const GENERATED_SOURCE_NAME = /^(?:https?|www)-|(?:^|-)[0-9a-f]{24,}(?:-|$)/i;

fs.mkdirSync(ZIP_UPLOAD_ROOT, { recursive: true });

function archiveSlug(filename) {
  return smartAnalyze.slugifySegment(path.basename(filename, path.extname(filename))) || 'asset-import';
}

function titleFromSlug(value) {
  return String(value || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()).trim();
}

function inferArchiveDefaults(filename) {
  const slug = archiveSlug(filename);
  let category = 'misc';
  if (/map|region|country|geograph/.test(slug)) category = 'map';
  else if (/church|cathedral|chapel|temple/.test(slug)) category = 'church_photo';
  else if (/robe|clergy|priest|deacon|avatar|headshot|people|person/.test(slug)) category = 'clergy';
  else if (/illustration|marketing|campaign|hero/.test(slug)) category = 'marketing';
  else if (/background|wallpaper/.test(slug)) category = 'background';
  else if (/icon/.test(slug)) category = 'icon';
  return {
    archive_slug: slug,
    category,
    folder: normalizeDirectoryPath(`imports/${slug}`),
    tags: [...new Set(slug.split('-').filter((part) => part.length > 1))],
  };
}

function isSymlink(entry) {
  const mode = (entry.header?.attr || 0) >>> 16;
  return (mode & 0o170000) === 0o120000;
}

function isHiddenOrMetadata(name) {
  const parts = name.replace(/\\/g, '/').split('/');
  return parts.some((part) => !part || part === '__MACOSX' || part.startsWith('.'));
}

function mediaTypeForExtension(ext) {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

function hasVideoContainerSignature(buffer, ext) {
  if (['.mp4', '.m4v', '.mov'].includes(ext)) return buffer.length >= 12 && buffer.toString('latin1', 4, 8) === 'ftyp';
  if (ext === '.webm') return buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  if (['.ogv', '.ogg'].includes(ext)) return buffer.length >= 4 && buffer.toString('latin1', 0, 4) === 'OggS';
  return false;
}

function probeVideoBuffer(buffer, ext) {
  return new Promise((resolve, reject) => {
    if (!hasVideoContainerSignature(buffer, ext)) {
      reject(new Error('Invalid video container'));
      return;
    }

    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height:format=duration',
      '-of', 'json',
      'pipe:0',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new Error('Video analysis timed out'));
    }, 15000);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', fail);
    // ffprobe can finish probing before Node finishes writing a large buffer.
    // That closes stdin with EPIPE; it is not itself a video validation failure.
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') fail(error); });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'Invalid video data'));
        return;
      }
      try {
        const parsed = JSON.parse(stdout || '{}');
        const stream = (parsed.streams || []).find((item) => item.codec_type === 'video');
        if (!stream) throw new Error('No video stream found');
        resolve({
          width: Number(stream.width) || null,
          height: Number(stream.height) || null,
          duration: Number(parsed.format?.duration) || null,
        });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(buffer);
  });
}

function isGeneratedSourceName(originalStem) {
  return GENERIC_NAME.test(originalStem)
    || /^(chatgpt|dall-e|untitled|download)(-|$)/i.test(originalStem)
    || GENERATED_SOURCE_NAME.test(originalStem);
}

function buildSmartFilename(slug, originalName, index, strategy = 'smart') {
  const ext = path.extname(originalName).toLowerCase() === '.jpeg' ? '.jpg' : path.extname(originalName).toLowerCase();
  const originalStem = smartAnalyze.slugifySegment(path.basename(originalName, path.extname(originalName)));
  const sequence = String(index + 1).padStart(3, '0');
  if (strategy === 'preserve') return smartAnalyze.sanitizeFilename(`${originalStem || sequence}${ext}`, ext);
  const isGeneric = isGeneratedSourceName(originalStem);
  if (strategy === 'sequential' || !originalStem || isGeneric) return `${slug}-${sequence}${ext}`;
  const stem = originalStem.startsWith(slug) ? originalStem : `${slug}-${originalStem}`;
  return smartAnalyze.sanitizeFilename(`${stem}${ext}`, ext);
}

function inspectArchive(zipPath, originalFilename, namingStrategy = 'smart') {
  const zip = new AdmZip(zipPath);
  const rawEntries = zip.getEntries();
  if (rawEntries.length > MAX_ENTRIES) throw new Error(`Archive contains too many entries (maximum ${MAX_ENTRIES})`);

  const defaults = inferArchiveDefaults(originalFilename);
  const manifest = [];
  let totalBytes = 0;
  let imageIndex = 0;

  for (const entry of rawEntries) {
    const rawName = String(entry.entryName || '');
    const normalizedEntry = rawName.replace(/\\/g, '/');
    if (normalizedEntry.startsWith('/') || /^[a-z]:\//i.test(normalizedEntry) || normalizedEntry.split('/').includes('..')) {
      throw new Error('Archive contains an unsafe path');
    }
    if (entry.isDirectory || isHiddenOrMetadata(rawName)) continue;
    if (entry.header?.flags & 0x1) throw new Error('Encrypted ZIP entries are not supported');
    if (isSymlink(entry)) throw new Error('ZIP symlinks are not permitted');

    const safeBase = path.basename(rawName.replace(/\\/g, '/'));
    const ext = path.extname(safeBase).toLowerCase();
    const size = Number(entry.header?.size || 0);
    const mediaType = mediaTypeForExtension(ext);
    if (!mediaType) {
      manifest.push({ original_name: rawName, status: 'skipped', reason: 'Unsupported media type' });
      continue;
    }
    const maxEntryBytes = mediaType === 'video' ? MAX_VIDEO_ENTRY_BYTES : MAX_IMAGE_ENTRY_BYTES;
    if (size <= 0 || size > maxEntryBytes) throw new Error(`${safeBase} exceeds the per-file limit`);
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Archive expands beyond the 2 GB safety limit');

    const storedFilename = buildSmartFilename(defaults.archive_slug, safeBase, imageIndex, namingStrategy);
    const stem = path.basename(storedFilename, path.extname(storedFilename));
    manifest.push({
      index: imageIndex,
      entry_name: rawName,
      original_name: safeBase,
      stored_filename: storedFilename,
      title: titleFromSlug(stem),
      alt_text: titleFromSlug(stem),
      media_type: mediaType,
      size,
      status: 'ready',
    });
    imageIndex += 1;
  }

  if (!imageIndex) throw new Error('The ZIP does not contain supported images or videos');
  const zipBytes = Math.max(1, fs.statSync(zipPath).size);
  if (totalBytes / zipBytes > MAX_COMPRESSION_RATIO) throw new Error('Archive compression ratio exceeds the safety limit');
  return { ...defaults, total_bytes: totalBytes, manifest };
}

function chunkUploadDir(uploadId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(uploadId || ''))) throw new Error('Invalid upload id');
  return path.join(ZIP_UPLOAD_ROOT, uploadId);
}

function readChunkState(uploadId, userId) {
  const dir = chunkUploadDir(uploadId);
  const stateFile = path.join(dir, 'upload.json');
  if (!fs.existsSync(stateFile)) throw new Error('ZIP upload session not found');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (Number(state.user_id) !== Number(userId)) throw new Error('ZIP upload session not found');
  return { ...state, dir };
}

function createChunkUpload({ filename, totalBytes, totalChunks, userId }) {
  const total = Number(totalBytes);
  const chunks = Number(totalChunks);
  if (path.extname(filename || '').toLowerCase() !== '.zip') throw new Error('Only .zip archives are accepted');
  if (!Number.isFinite(total) || total <= 0 || total > MAX_ZIP_BYTES) throw new Error('ZIP exceeds the 2 GB upload limit');
  if (!Number.isInteger(chunks) || chunks <= 0 || chunks > MAX_ZIP_CHUNK_COUNT) throw new Error('Invalid ZIP chunk count');

  cleanupExpiredChunkUploads();
  const uploadId = crypto.randomUUID();
  const dir = chunkUploadDir(uploadId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'upload.json'), JSON.stringify({
    filename: String(filename).slice(0, 255),
    total_bytes: total,
    total_chunks: chunks,
    user_id: userId || null,
    created_at: Date.now(),
  }));
  return { upload_id: uploadId };
}

function saveChunkUploadPart({ uploadId, userId, chunkIndex, partPath }) {
  const state = readChunkState(uploadId, userId);
  const index = Number(chunkIndex);
  if (!Number.isInteger(index) || index < 0 || index >= state.total_chunks) throw new Error('Invalid ZIP chunk index');
  const target = path.join(state.dir, `${index}.part`);
  fs.copyFileSync(partPath, target);
  fs.unlinkSync(partPath);
  return { upload_id: uploadId, chunk_index: index };
}

function completeChunkUpload({ uploadId, userId }) {
  const state = readChunkState(uploadId, userId);
  const outputPath = path.join(ZIP_TEMP_ROOT, `${uploadId}.zip`);
  let actualBytes = 0;
  try {
    fs.writeFileSync(outputPath, Buffer.alloc(0));
    for (let index = 0; index < state.total_chunks; index += 1) {
      const part = path.join(state.dir, `${index}.part`);
      if (!fs.existsSync(part)) throw new Error(`Missing ZIP chunk ${index + 1}`);
      const data = fs.readFileSync(part);
      actualBytes += data.length;
      if (actualBytes > state.total_bytes) throw new Error('ZIP upload exceeds declared size');
      fs.appendFileSync(outputPath, data);
    }
    if (actualBytes !== state.total_bytes) throw new Error('ZIP upload size mismatch');
  } catch (error) {
    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    throw error;
  }
  fs.rmSync(state.dir, { recursive: true, force: true });
  return { zipPath: outputPath, originalFilename: state.filename };
}

function cleanupExpiredChunkUploads() {
  if (!fs.existsSync(ZIP_UPLOAD_ROOT)) return;
  for (const name of fs.readdirSync(ZIP_UPLOAD_ROOT)) {
    const dir = path.join(ZIP_UPLOAD_ROOT, name);
    const stateFile = path.join(dir, 'upload.json');
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (Date.now() - Number(state.created_at || 0) > CHUNK_UPLOAD_TTL_MS) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

async function cleanupExpiredImports() {
  const pool = getAppPool();
  const [rows] = await pool.query(
    "SELECT id, temp_path FROM om_asset_zip_imports WHERE status='analyzed' AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR) LIMIT 200",
  );
  for (const row of rows) {
    try { if (row.temp_path) fs.unlinkSync(row.temp_path); } catch { /* ignore */ }
    await pool.query("UPDATE om_asset_zip_imports SET status='expired', completed_at=NOW() WHERE id=?", [row.id]);
  }
}

async function createAnalysis({ zipPath, originalFilename, scope, churchId, category, folder, namingStrategy, userId }) {
  await cleanupExpiredImports();
  const inferred = inspectArchive(zipPath, originalFilename, namingStrategy);
  const resolvedCategory = CATEGORIES.has(category) ? category : inferred.category;
  const resolvedFolder = normalizeDirectoryPath(folder || inferred.folder);
  const token = crypto.randomUUID();
  const pool = getAppPool();
  const [result] = await pool.query(
    `INSERT INTO om_asset_zip_imports
     (import_token, archive_filename, archive_slug, scope, church_id, category, folder,
      naming_strategy, total_entries, manifest_json, temp_path, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [token, String(originalFilename).slice(0, 255), inferred.archive_slug, scope,
      scope === 'church' ? churchId : null, resolvedCategory, resolvedFolder,
      namingStrategy, inferred.manifest.filter((entry) => entry.status === 'ready').length,
      JSON.stringify(inferred.manifest), zipPath, userId || null],
  );
  return {
    id: result.insertId,
    import_token: token,
    archive_filename: originalFilename,
    archive_slug: inferred.archive_slug,
    scope,
    church_id: scope === 'church' ? churchId : null,
    category: resolvedCategory,
    folder: resolvedFolder,
    naming_strategy: namingStrategy,
    tags: inferred.tags,
    total_bytes: inferred.total_bytes,
    manifest: inferred.manifest,
  };
}

async function getImport(token, userId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT * FROM om_asset_zip_imports WHERE import_token = ? AND created_by = ? LIMIT 1',
    [token, userId || null],
  );
  return rows[0] || null;
}

async function commitImport({ token, userId, overrides = {}, skipDuplicates = true }) {
  const row = await getImport(token, userId);
  if (!row) throw new Error('ZIP import not found');
  if (row.status !== 'analyzed' || !fs.existsSync(row.temp_path)) throw new Error('ZIP import is no longer available');

  const pool = getAppPool();
  const scope = overrides.scope || row.scope;
  const churchId = scope === 'church' ? Number(overrides.church_id || row.church_id) : null;
  const category = CATEGORIES.has(overrides.category) ? overrides.category : row.category;
  const folder = normalizeDirectoryPath(overrides.folder || row.folder || '');
  const visibility = defaultVisibilityForScope(scope);
  const manifest = typeof row.manifest_json === 'string' ? JSON.parse(row.manifest_json) : row.manifest_json;
  const editedEntries = new Map((overrides.entries || []).map((entry) => [entry.entry_name, entry]));
  const zip = new AdmZip(row.temp_path);
  const byName = new Map(zip.getEntries().map((entry) => [entry.entryName, entry]));
  const targetDir = folder ? path.join(scopeStorageDir(scope, churchId), folder) : scopeStorageDir(scope, churchId);
  const resolvedRoot = path.resolve(scopeStorageDir(scope, churchId));
  const resolvedTarget = path.resolve(targetDir);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Invalid import folder');
  fs.mkdirSync(resolvedTarget, { recursive: true });

  await pool.query("UPDATE om_asset_zip_imports SET status='importing' WHERE id = ?", [row.id]);
  const report = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const original of manifest) {
    if (original.status !== 'ready') { report.push(original); skipped += 1; continue; }
    const edit = editedEntries.get(original.entry_name) || {};
    const entry = byName.get(original.entry_name);
    if (!entry || isSymlink(entry)) { report.push({ ...original, status: 'failed', error: 'Archive entry unavailable' }); failed += 1; continue; }
    let outputPath = null;
    try {
      const buffer = entry.getData();
      const sourceExt = path.extname(original.original_name || '').toLowerCase();
      const mediaType = original.media_type || mediaTypeForExtension(sourceExt);
      const maxEntryBytes = mediaType === 'video' ? MAX_VIDEO_ENTRY_BYTES : MAX_IMAGE_ENTRY_BYTES;
      if (!mediaType) throw new Error('Unsupported media type');
      if (buffer.length !== Number(original.size) || buffer.length > maxEntryBytes) throw new Error('File size does not match analyzed manifest');
      const media = mediaType === 'video'
        ? await probeVideoBuffer(buffer, sourceExt)
        : await sharp(buffer, { animated: true, limitInputPixels: 16000 * 16000 }).metadata();
      if (!media.width || !media.height || (mediaType === 'image' && !media.format)) {
        throw new Error(mediaType === 'video' ? 'Invalid video data' : 'Invalid image data');
      }
      const hash = hashFileBuffer(buffer);
      if (skipDuplicates) {
        const [duplicates] = await pool.query(
          "SELECT id, name FROM om_assets WHERE content_hash = ? AND status != 'archived' LIMIT 1",
          [hash],
        );
        if (duplicates.length) {
          report.push({ ...original, status: 'duplicate', duplicate_asset_id: duplicates[0].id });
          skipped += 1;
          continue;
        }
      }

      const originalStem = smartAnalyze.slugifySegment(path.basename(original.original_name || '', path.extname(original.original_name || '')));
      const requestedFilename = edit.stored_filename || original.stored_filename;
      const shouldResequence = isGeneratedSourceName(originalStem) && requestedFilename === original.stored_filename;
      const desired = smartAnalyze.sanitizeFilename(
        shouldResequence
          ? buildSmartFilename(row.archive_slug, original.original_name, Number(original.index) || 0, 'smart')
          : requestedFilename,
        path.extname(original.stored_filename),
      );
      if (path.extname(desired).toLowerCase() !== sourceExt) throw new Error(`Imported filename must keep the original ${sourceExt} extension`);
      const resolved = await smartAnalyze.resolveStoredFilename({
        pool, scope, churchId, desiredName: desired, targetDir: resolvedTarget,
        contentHash: hash, fsMod: fs,
      });
      outputPath = path.join(resolvedTarget, resolved.filename);
      fs.writeFileSync(outputPath, buffer, { flag: 'wx' });
      const logicalName = folder ? `${folder}/${resolved.filename}` : resolved.filename;
      const tags = [...new Set([row.archive_slug, ...(overrides.tags || [])])];
      const asset = await createAssetRecord({
        name: resolved.filename,
        title: String(edit.title || original.title).slice(0, 255),
        alt_text: String(edit.alt_text || original.alt_text).slice(0, 500),
        description: `Imported from ${row.archive_filename}`,
        scope,
        visibility,
        church_id: churchId,
        collection_id: overrides.collection_id ? Number(overrides.collection_id) : null,
        folder,
        category,
        file_path: toRelativeStoragePath(outputPath),
        storage_path: buildLogicalStoragePath(scope, churchId, logicalName),
        file_type: mimeFromExt(path.extname(resolved.filename)),
        mime_type: mimeFromExt(path.extname(resolved.filename)),
        width: media.width,
        height: media.height,
        file_size: buffer.length,
        metadata_json: {
          zip_import_id: row.id,
          archive_filename: row.archive_filename,
          archive_entry: original.entry_name,
          directory: folder,
          media_type: mediaType,
          duration_seconds: media.duration || null,
          tags,
        },
        product_tags: tags,
        sha256: hash,
        source_type: 'import',
        owner_system: 'om',
        uploaded_by: userId,
        created_by: userId,
        original_filename: original.original_name,
        stored_filename: resolved.filename,
        display_name: String(edit.title || original.title).slice(0, 255),
        content_hash: hash,
        smart_rename_applied: true,
        smart_metadata_applied: true,
        classification_source: 'smart',
        category_confidence: 0.9,
      });
      report.push({ ...original, stored_filename: resolved.filename, status: 'imported', asset_id: asset.id });
      imported += 1;
    } catch (error) {
      if (outputPath) { try { fs.unlinkSync(outputPath); } catch { /* ignore */ } }
      report.push({ ...original, status: 'failed', error: error.message });
      failed += 1;
    }
  }

  const status = failed ? (imported ? 'partial' : 'failed') : 'completed';
  await pool.query(
    `UPDATE om_asset_zip_imports SET status=?, imported_count=?, skipped_count=?, failed_count=?,
     report_json=?, completed_at=NOW() WHERE id=?`,
    [status, imported, skipped, failed, JSON.stringify(report), row.id],
  );
  try { fs.unlinkSync(row.temp_path); } catch { /* ignore */ }
  return { id: row.id, import_token: token, status, imported_count: imported, skipped_count: skipped, failed_count: failed, report };
}

async function cancelImport(token, userId) {
  const row = await getImport(token, userId);
  if (!row || row.status !== 'analyzed') return false;
  try { if (row.temp_path) fs.unlinkSync(row.temp_path); } catch { /* ignore */ }
  const pool = getAppPool();
  await pool.query("UPDATE om_asset_zip_imports SET status='expired', completed_at=NOW() WHERE id=?", [row.id]);
  return true;
}

async function listImports(userId, limit = 20) {
  await cleanupExpiredImports();
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT id, import_token, archive_filename, archive_slug, scope, church_id, category, folder,
            status, total_entries, imported_count, skipped_count, failed_count, created_at, completed_at
     FROM om_asset_zip_imports WHERE created_by=? ORDER BY id DESC LIMIT ?`,
    [userId || null, Math.min(100, Math.max(1, Number(limit) || 20))],
  );
  return rows;
}

module.exports = {
  ZIP_TEMP_ROOT,
  ZIP_UPLOAD_ROOT,
  MAX_ENTRIES,
  MAX_ZIP_BYTES,
  MAX_ZIP_CHUNK_BYTES,
  MAX_ZIP_CHUNK_COUNT,
  createChunkUpload,
  saveChunkUploadPart,
  completeChunkUpload,
  inferArchiveDefaults,
  buildSmartFilename,
  mediaTypeForExtension,
  hasVideoContainerSignature,
  probeVideoBuffer,
  inspectArchive,
  createAnalysis,
  commitImport,
  cancelImport,
  listImports,
};
