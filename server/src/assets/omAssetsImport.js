/**
 * OM Assets Library — legacy source import helpers (PR3)
 *
 * Imports filesystem + registry assets into om_assets with file copy to
 * server/storage/om-assets/{public|site|church-{id}}/
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { getAppPool } = require('../config/db');
const { getImagesRoot } = require('../services/publicImagesFs');
const {
  scopeStorageDir,
  toRelativeStoragePath,
  mimeFromExt,
  STORAGE_ROOT,
  ALLOWED_EXTENSIONS,
} = require('./omAssetsConstants');
const { createAssetRecord } = require('./omAssetsService');

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|pdf|woff2?|ttf|otf|ico)$/i;

const FOLDER_CATEGORY = {
  logos: 'logo',
  logo: 'logo',
  fonts: 'font',
  backgrounds: 'background',
  icons: 'icon',
  ui: 'content',
  records: 'content',
  misc: 'content',
  gallery: 'content',
  banners: 'header',
  footer: 'content',
  home: 'content',
  'how-it-works': 'content',
  enroll: 'content',
  demo: 'content',
  incode: 'content',
  orthodox: 'icon',
};

const SITE_PATH_PREFIXES = [
  '/images/global/',
  '/images/admin/',
  '/images/theme-previews/',
  '/images/incode/',
];

function hashFileBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function slugName(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 200) || 'asset';
}

function categoryFromPath(relativePath, urlPath) {
  const parts = relativePath.split('/').filter(Boolean);
  const top = parts[0]?.toLowerCase();
  if (top === 'global') {
    if (parts[1] === 'profile') return 'icon';
    if (parts[1] === 'banner') return 'header';
    return 'content';
  }
  if (FOLDER_CATEGORY[top]) return FOLDER_CATEGORY[top];
  const base = path.basename(relativePath).toLowerCase();
  if (base.includes('logo')) return 'logo';
  if (base.includes('banner') || base.includes('header')) return 'header';
  if (base.includes('background') || base.includes('bg')) return 'background';
  if (base.includes('seal')) return 'seal';
  if (base.includes('cross')) return 'cross';
  if (base.includes('watermark')) return 'watermark';
  if (base.includes('signature')) return 'signature';
  if (urlPath.includes('branding')) return 'branding';
  return 'content';
}

function scopeFromUrlPath(urlPath) {
  const normalized = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  if (SITE_PATH_PREFIXES.some((p) => normalized.startsWith(p))) return 'site';
  if (normalized.startsWith('/images/global/')) return 'site';
  if (normalized.startsWith('/church-branding/')) return 'church';
  if (normalized.includes('/custom_images/')) return 'church';
  return 'public';
}

function churchIdFromUrlPath(urlPath) {
  const branding = urlPath.match(/\/church-branding\/(\d+)\//);
  if (branding) return Number(branding[1]);
  const custom = urlPath.match(/\/om_church_(\d+)\/custom_images\//);
  if (custom) return Number(custom[1]);
  return null;
}

async function readDimensions(absPath, ext) {
  if (!/\.(png|jpe?g|gif|webp)$/i.test(ext)) return { width: null, height: null };
  try {
    const meta = await sharp(absPath).metadata();
    return { width: meta.width || null, height: meta.height || null };
  } catch {
    return { width: null, height: null };
  }
}

async function legacyRowExists(pool, legacySource, legacyId) {
  const [rows] = await pool.query(
    'SELECT id FROM om_assets WHERE legacy_source = ? AND legacy_id = ? LIMIT 1',
    [legacySource, legacyId],
  );
  return rows[0]?.id || null;
}

async function urlPathAlreadyImported(pool, urlPath) {
  const normalized = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  const [rows] = await pool.query(
    `SELECT id FROM om_assets
     WHERE status = 'active'
       AND (
         (legacy_source = 'public_images' AND legacy_id = ?)
         OR JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.legacy_url')) = ?
       )
     LIMIT 1`,
    [normalized, normalized],
  );
  return rows[0]?.id || null;
}

async function importFile({
  absPath,
  legacySource,
  legacyId,
  urlPath,
  scope,
  churchId,
  category,
  folder,
  name,
  productTags,
  dryRun = false,
}) {
  if (!fs.existsSync(absPath)) {
    return { status: 'missing', legacyId };
  }
  if (!IMAGE_EXT.test(absPath)) {
    return { status: 'skipped_ext', legacyId };
  }

  const pool = getAppPool();
  const existingId = await legacyRowExists(pool, legacySource, legacyId);
  if (existingId) {
    return { status: 'exists', legacyId, id: existingId };
  }

  const normalizedUrl = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  const existingByUrl = await urlPathAlreadyImported(pool, normalizedUrl);
  if (existingByUrl) {
    return { status: 'exists', legacyId, id: existingByUrl };
  }

  const ext = path.extname(absPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.test(ext)) {
    return { status: 'skipped_ext', legacyId };
  }

  const buf = fs.readFileSync(absPath);
  const sha256 = hashFileBuffer(buf);
  const { width, height } = await readDimensions(absPath, ext);

  const resolvedScope = scope || scopeFromUrlPath(urlPath);
  const resolvedChurchId = resolvedScope === 'church' ? (churchId || churchIdFromUrlPath(urlPath)) : null;
  if (resolvedScope === 'church' && !resolvedChurchId) {
    return { status: 'skipped_no_church', legacyId };
  }

  const resolvedCategory = category || categoryFromPath(path.relative(getImagesRoot(), absPath).replace(/\\/g, '/'), urlPath);
  const assetName = name || slugName(absPath);

  if (dryRun) {
    return {
      status: 'dry_run',
      legacyId,
      scope: resolvedScope,
      churchId: resolvedChurchId,
      category: resolvedCategory,
      name: assetName,
    };
  }

  const destDir = scopeStorageDir(resolvedScope, resolvedChurchId);
  fs.mkdirSync(destDir, { recursive: true });
  const destName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const destAbs = path.join(destDir, destName);
  fs.copyFileSync(absPath, destAbs);

  const relativePath = toRelativeStoragePath(destAbs);
  const asset = await createAssetRecord({
    name: assetName,
    scope: resolvedScope,
    church_id: resolvedChurchId,
    category: resolvedCategory,
    folder,
    file_path: relativePath,
    file_type: mimeFromExt(ext),
    width,
    height,
    metadata_json: { legacy_url: urlPath },
    licensing_note: null,
    product_tags: productTags || ['om'],
    sha256,
    uploaded_by: null,
    legacy_source: legacySource,
    legacy_id: legacyId,
  });

  return { status: 'imported', legacyId, id: asset.id, scope: resolvedScope };
}

function walkImages(dir, baseDir = dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkImages(full, baseDir, acc);
    } else if (IMAGE_EXT.test(entry.name)) {
      const rel = path.relative(baseDir, full).split(path.sep).join('/');
      acc.push({ absPath: full, relativePath: rel });
    }
  }
  return acc;
}

async function importPublicImages({ dryRun = false } = {}) {
  const imagesRoot = getImagesRoot();
  const files = walkImages(imagesRoot);
  const stats = { imported: 0, exists: 0, skipped: 0, missing: 0, dry_run: 0 };

  for (const { absPath, relativePath } of files) {
    const urlPath = `/images/${relativePath}`;
    const result = await importFile({
      absPath,
      legacySource: 'public_images',
      legacyId: urlPath,
      urlPath,
      dryRun,
    });
    if (result.status === 'imported') stats.imported += 1;
    else if (result.status === 'exists') stats.exists += 1;
    else if (result.status === 'dry_run') stats.dry_run += 1;
    else stats.skipped += 1;
  }

  return { source: 'public_images', total: files.length, ...stats };
}

async function importImageRegistry({ dryRun = false } = {}) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT id, image_path, category, label FROM image_registry ORDER BY id',
  );
  const imagesRoot = getImagesRoot();
  const stats = { imported: 0, exists: 0, skipped: 0, dry_run: 0 };

  for (const row of rows) {
    const urlPath = row.image_path.startsWith('/') ? row.image_path : `/${row.image_path}`;
    const existingByUrl = await urlPathAlreadyImported(pool, urlPath);
    if (existingByUrl) {
      stats.exists += 1;
      continue;
    }
    const rel = urlPath.replace(/^\/images\/?/, '');
    const absPath = path.join(imagesRoot, rel);
    const category = FOLDER_CATEGORY[row.category?.toLowerCase?.()] || categoryFromPath(rel, urlPath);
    const result = await importFile({
      absPath,
      legacySource: 'image_registry',
      legacyId: String(row.id),
      urlPath,
      category,
      name: row.label || slugName(absPath),
      dryRun,
    });
    if (result.status === 'imported') stats.imported += 1;
    else if (result.status === 'exists') stats.exists += 1;
    else if (result.status === 'dry_run') stats.dry_run += 1;
    else stats.skipped += 1;
  }

  return { source: 'image_registry', total: rows.length, ...stats };
}

async function importChurchBranding({ dryRun = false } = {}) {
  const pool = getAppPool();
  const brandingRoot = path.join(STORAGE_ROOT, 'church-branding');
  const stats = { imported: 0, exists: 0, skipped: 0, dry_run: 0 };

  const [churches] = await pool.query(`
    SELECT id, logo_path, logo_dark_path, favicon_path, seal_image_path, signature_image_path
    FROM churches
  `);

  const fieldCategory = {
    logo_path: 'logo',
    logo_dark_path: 'logo',
    favicon_path: 'icon',
    seal_image_path: 'seal',
    signature_image_path: 'signature',
  };

  for (const church of churches) {
    for (const [field, category] of Object.entries(fieldCategory)) {
      const urlPath = church[field];
      if (!urlPath) continue;
      const rel = urlPath.replace(/^\/church-branding\//, '');
      const absPath = path.join(brandingRoot, rel);
      const result = await importFile({
        absPath,
        legacySource: 'church_branding',
        legacyId: `${church.id}:${field}`,
        urlPath,
        scope: 'church',
        churchId: church.id,
        category,
        name: `${field.replace(/_/g, ' ')} (church ${church.id})`,
        dryRun,
      });
      if (result.status === 'imported') stats.imported += 1;
      else if (result.status === 'exists') stats.exists += 1;
      else if (result.status === 'dry_run') stats.dry_run += 1;
      else stats.skipped += 1;
    }
  }

  const [landingRows] = await pool.query(`
    SELECT church_id, logo_path, background_image_path FROM church_records_landing
    WHERE logo_path IS NOT NULL OR background_image_path IS NOT NULL
  `);

  for (const row of landingRows) {
    for (const [field, category] of [['logo_path', 'logo'], ['background_image_path', 'background']]) {
      const urlPath = row[field];
      if (!urlPath) continue;
      const rel = urlPath.replace(/^\/church-branding\//, '');
      const absPath = path.join(brandingRoot, rel);
      const result = await importFile({
        absPath,
        legacySource: 'church_records_landing',
        legacyId: `${row.church_id}:${field}`,
        urlPath,
        scope: 'church',
        churchId: row.church_id,
        category,
        name: `records landing ${field.replace(/_/g, ' ')} (church ${row.church_id})`,
        dryRun,
      });
      if (result.status === 'imported') stats.imported += 1;
      else if (result.status === 'exists') stats.exists += 1;
      else if (result.status === 'dry_run') stats.dry_run += 1;
      else stats.skipped += 1;
    }
  }

  return { source: 'church_branding', total: churches.length, ...stats };
}

async function importChurchCustomLibrary({ dryRun = false } = {}) {
  const uploadsRoot = path.resolve(STORAGE_ROOT, '..', 'uploads');
  const stats = { imported: 0, exists: 0, skipped: 0, dry_run: 0 };
  let total = 0;

  if (!fs.existsSync(uploadsRoot)) {
    return { source: 'church_custom_library', total: 0, ...stats };
  }

  for (const entry of fs.readdirSync(uploadsRoot, { withFileTypes: true })) {
    const match = entry.name.match(/^om_church_(\d+)$/);
    if (!match || !entry.isDirectory()) continue;
    const churchId = Number(match[1]);
    const customDir = path.join(uploadsRoot, entry.name, 'custom_images');
    if (!fs.existsSync(customDir)) continue;

    for (const file of fs.readdirSync(customDir)) {
      if (!IMAGE_EXT.test(file)) continue;
      total += 1;
      const absPath = path.join(customDir, file);
      const urlPath = `/uploads/om_church_${churchId}/custom_images/${file}`;
      const result = await importFile({
        absPath,
        legacySource: 'church_custom_library',
        legacyId: urlPath,
        urlPath,
        scope: 'church',
        churchId,
        category: 'branding',
        dryRun,
      });
      if (result.status === 'imported') stats.imported += 1;
      else if (result.status === 'exists') stats.exists += 1;
      else if (result.status === 'dry_run') stats.dry_run += 1;
      else stats.skipped += 1;
    }
  }

  return { source: 'church_custom_library', total, ...stats };
}

async function importGlobalImages({ dryRun = false } = {}) {
  const imagesRoot = getImagesRoot();
  const stats = { imported: 0, exists: 0, skipped: 0, dry_run: 0 };
  let total = 0;

  for (const sub of ['global/profile', 'global/banner', 'profile', 'banner']) {
    const dir = path.join(imagesRoot, ...sub.split('/'));
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!IMAGE_EXT.test(file)) continue;
      total += 1;
      const absPath = path.join(dir, file);
      const urlPath = `/images/${sub}/${file}`;
      const isGlobal = sub.startsWith('global/');
      const result = await importFile({
        absPath,
        legacySource: 'global_images',
        legacyId: urlPath,
        urlPath,
        scope: isGlobal ? 'site' : 'public',
        category: sub.includes('banner') ? 'header' : 'icon',
        productTags: isGlobal ? ['om', 'omai'] : ['om'],
        dryRun,
      });
      if (result.status === 'imported') stats.imported += 1;
      else if (result.status === 'exists') stats.exists += 1;
      else if (result.status === 'dry_run') stats.dry_run += 1;
      else stats.skipped += 1;
    }
  }

  return { source: 'global_images', total, ...stats };
}

/**
 * The only media that belongs in `scope: 'site'` is the om-platform frontend's
 * own static assets — everything Vite serves verbatim from `public/`
 * (icons, illustrations, avatar presets, the brand logos under `logo/`,
 * `fonts/`, favicon, apple-touch-icon, …), not arbitrary uploads. This scans
 * the whole `public/` directory (not just `public/assets/`) and registers
 * each file as an om_assets row with scope='site', deduped by
 * legacy_source+legacy_id so re-running is safe (unchanged files are
 * skipped, matching every other importer here).
 */
const FRONTEND_PUBLIC_ASSETS_ROOT = '/var/www/om-platform/front-end/public';

async function importFrontendPublicAssets({ dryRun = false } = {}) {
  const files = walkImages(FRONTEND_PUBLIC_ASSETS_ROOT);
  const stats = { imported: 0, exists: 0, skipped: 0, missing: 0, dry_run: 0 };

  for (const { absPath, relativePath } of files) {
    const urlPath = `/${relativePath}`;
    const result = await importFile({
      absPath,
      legacySource: 'frontend_public_assets',
      legacyId: urlPath,
      urlPath,
      scope: 'site',
      category: categoryFromPath(relativePath, urlPath),
      name: slugName(absPath),
      productTags: ['om', 'site'],
      dryRun,
    });
    if (result.status === 'imported') stats.imported += 1;
    else if (result.status === 'exists') stats.exists += 1;
    else if (result.status === 'dry_run') stats.dry_run += 1;
    else stats.skipped += 1;
  }

  return { source: 'frontend_public_assets', total: files.length, ...stats };
}

/**
 * Screenshots dropped on the `\\192.168.1.79\screenshots` SMB share (mounted
 * at /mnt/storage/screenshots via /etc/fstab) belong in `scope: 'site'`,
 * folder='screenshots'. Copied into server/storage/om-assets/site/ like every
 * other importer here — deduped by legacy_source+legacy_id, so re-running
 * (via the scheduled sync) only picks up files that weren't already imported.
 */
const SCREENSHOTS_SHARE_ROOT = '/mnt/storage/screenshots';

async function importScreenshotsShare({ dryRun = false } = {}) {
  const files = walkImages(SCREENSHOTS_SHARE_ROOT);
  const stats = { imported: 0, exists: 0, skipped: 0, missing: 0, dry_run: 0 };

  for (const { absPath, relativePath } of files) {
    const urlPath = `/screenshots/${relativePath}`;
    const dir = path.dirname(relativePath).replace(/\\/g, '/');
    const folder = dir === '.' ? 'screenshots' : `screenshots/${dir}`;
    const result = await importFile({
      absPath,
      legacySource: 'screenshots_share',
      legacyId: urlPath,
      urlPath,
      scope: 'site',
      category: 'screenshot',
      folder,
      name: slugName(absPath),
      productTags: ['om', 'site', 'screenshot'],
      dryRun,
    });
    if (result.status === 'imported') stats.imported += 1;
    else if (result.status === 'exists') stats.exists += 1;
    else if (result.status === 'dry_run') stats.dry_run += 1;
    else stats.skipped += 1;
  }

  return { source: 'screenshots_share', total: files.length, ...stats };
}

async function runLegacyImport({ sources, dryRun = false } = {}) {
  const allSources = sources?.length
    ? sources
    : [
      'public_images',
      'image_registry',
      'global_images',
      'church_branding',
      'church_custom_library',
      'frontend_public_assets',
    ];

  const runners = {
    public_images: importPublicImages,
    image_registry: importImageRegistry,
    global_images: importGlobalImages,
    church_branding: importChurchBranding,
    church_custom_library: importChurchCustomLibrary,
    frontend_public_assets: importFrontendPublicAssets,
    // Not in the default list above — invoked on its own schedule via
    // `migrate-legacy-assets-to-om-assets.js --source=screenshots_share`
    // (see the om-screenshots-sync systemd timer), not as part of a
    // general legacy-source migration pass.
    screenshots_share: importScreenshotsShare,
  };

  const results = [];
  for (const key of allSources) {
    const fn = runners[key];
    if (!fn) throw new Error(`Unknown import source: ${key}`);
    results.push(await fn({ dryRun }));
  }

  return results;
}

module.exports = {
  importFile,
  importPublicImages,
  importImageRegistry,
  importChurchBranding,
  importChurchCustomLibrary,
  importGlobalImages,
  importFrontendPublicAssets,
  importScreenshotsShare,
  SCREENSHOTS_SHARE_ROOT,
  runLegacyImport,
  scopeFromUrlPath,
  categoryFromPath,
  churchIdFromUrlPath,
};
