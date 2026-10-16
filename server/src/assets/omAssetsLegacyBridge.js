/**
 * OM Assets Library — bridge for legacy gallery / branding / global-images consumers (PR4)
 */

const {
  importFile,
  scopeFromUrlPath,
  categoryFromPath,
} = require('./omAssetsImport');
const { getAssetByLegacyUrl, serializeAsset } = require('./omAssetsService');
const { getAppPool } = require('../config/db');

function normalizeImagePath(urlPath) {
  if (!urlPath || typeof urlPath !== 'string') return null;
  const withoutQuery = urlPath.split('?')[0].split('#')[0];
  return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
}

function omAssetFileUrl(assetId) {
  return `/api/assets/${assetId}/file`;
}

async function registerOmAssetFromLegacyFile({
  absPath,
  urlPath,
  legacySource,
  legacyId,
  scope,
  churchId,
  category,
  name,
  productTags,
  uploadedBy,
}) {
  const normalized = normalizeImagePath(urlPath);
  if (!normalized || !absPath) return null;

  const result = await importFile({
    absPath,
    legacySource,
    legacyId: legacyId || normalized,
    urlPath: normalized,
    scope: scope || scopeFromUrlPath(normalized),
    churchId,
    category,
    name,
    productTags,
    dryRun: false,
  });

  if (result.status === 'imported' || result.status === 'exists') {
    return result.id;
  }
  return null;
}

async function resolvePathToOmAsset(urlPath) {
  const normalized = normalizeImagePath(urlPath);
  if (!normalized) return null;
  return getAssetByLegacyUrl(normalized);
}

async function resolvePathsToOmAssets(pathMap) {
  const entries = Object.entries(pathMap || {});
  if (!entries.length) return { assets: {}, urls: {}, ids: {} };

  const normalizedPaths = [...new Set(entries.map(([, p]) => normalizeImagePath(p)).filter(Boolean))];
  const pool = getAppPool();
  const placeholders = normalizedPaths.map(() => '?').join(',');

  const [rows] = normalizedPaths.length
    ? await pool.query(
      `SELECT a.*, c.name AS church_name
       FROM om_assets a
       LEFT JOIN churches c ON c.id = a.church_id
       WHERE a.status = 'active'
         AND (
           (a.legacy_source = 'public_images' AND a.legacy_id IN (${placeholders}))
           OR JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.legacy_url')) IN (${placeholders})
           OR (a.legacy_source = 'global_images' AND a.legacy_id IN (${placeholders}))
           OR (a.legacy_source = 'church_branding' AND JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.legacy_url')) IN (${placeholders}))
           OR (a.legacy_source = 'church_custom_library' AND a.legacy_id IN (${placeholders}))
         )`,
      [...normalizedPaths, ...normalizedPaths, ...normalizedPaths, ...normalizedPaths, ...normalizedPaths],
    )
    : [[]];

  const byLegacyId = new Map();
  const byLegacyUrl = new Map();
  for (const row of rows) {
    const asset = serializeAsset(row);
    if (row.legacy_id) byLegacyId.set(row.legacy_id, asset);
    const legacyUrl = asset.metadata_json?.legacy_url;
    if (legacyUrl) byLegacyUrl.set(legacyUrl, asset);
  }

  const assets = {};
  const urls = {};
  const ids = {};

  for (const [key, rawPath] of entries) {
    const normalized = normalizeImagePath(rawPath);
    if (!normalized) continue;
    const asset = byLegacyId.get(normalized) || byLegacyUrl.get(normalized);
    if (!asset) continue;
    assets[key] = asset;
    urls[key] = omAssetFileUrl(asset.id);
    ids[key] = asset.id;
  }

  return { assets, urls, ids };
}

function categoryFromGalleryTarget(relativePath, targetDir) {
  const rel = relativePath || targetDir || '';
  return categoryFromPath(rel.replace(/^\/+/, ''), `/images/${rel}`);
}

module.exports = {
  normalizeImagePath,
  omAssetFileUrl,
  registerOmAssetFromLegacyFile,
  resolvePathToOmAsset,
  resolvePathsToOmAssets,
  categoryFromGalleryTarget,
};
