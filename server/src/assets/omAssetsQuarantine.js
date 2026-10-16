/**
 * OM Assets Library — orphan-file quarantine
 *
 * Content is only supposed to enter the system through its proper channel:
 * File Manager upload for church tenants, or Media Assets Upload/Import ZIP
 * for platform scopes. A file sitting directly in a storage path with no
 * corresponding DB row means something bypassed both — it gets quarantined:
 * copied into server/storage/om-assets/internal/, registered as an om_assets
 * row (scope='internal', source_type='quarantine', category='flagged'), then
 * removed from its original location. Quarantined assets are view/delete
 * only (enforced in omAssetsService.changeAssetScope/copyAssetToScope).
 *
 * Exempt (not scanned as orphans — these already have their own importers):
 *   - the \\192.168.1.79\screenshots SMB share (importScreenshotsShare)
 *   - the om-platform frontend's public/ directory (importFrontendPublicAssets)
 * Neither lives under the paths scanned here, so no special-casing is needed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getAppPool } = require('../config/db');
const { OM_ASSETS_ROOT, STORAGE_ROOT, mimeFromExt } = require('./omAssetsConstants');
const { createAssetRecord } = require('./omAssetsService');

const FILE_MANAGER_STORAGE_ROOT = path.resolve(__dirname, '../../storage/files');

function hashFileBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function walkAllFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAllFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

async function alreadyQuarantined(pool, legacySource, legacyId) {
  const [rows] = await pool.query(
    'SELECT id FROM om_assets WHERE legacy_source = ? AND legacy_id = ? LIMIT 1',
    [legacySource, legacyId],
  );
  return rows[0]?.id || null;
}

async function quarantineFile(absPath, { legacySource, legacyId, name }) {
  const pool = getAppPool();
  const existingId = await alreadyQuarantined(pool, legacySource, legacyId);
  if (existingId) return { status: 'already_quarantined', id: existingId };

  if (!fs.existsSync(absPath)) return { status: 'missing' };

  const destDir = path.join(OM_ASSETS_ROOT, 'internal');
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(absPath);
  const destName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const destAbs = path.join(destDir, destName);
  fs.copyFileSync(absPath, destAbs);

  const buf = fs.readFileSync(destAbs);
  const sha256 = hashFileBuffer(buf);
  const stat = fs.statSync(destAbs);
  const relativePath = path.relative(STORAGE_ROOT, destAbs).split(path.sep).join('/');

  const asset = await createAssetRecord({
    name: name || path.basename(absPath),
    scope: 'internal',
    category: 'flagged',
    folder: 'quarantine',
    file_path: relativePath,
    file_type: mimeFromExt(ext),
    file_size: stat.size,
    metadata_json: { orphan_original_path: absPath },
    product_tags: ['quarantine'],
    sha256,
    source_type: 'quarantine',
    uploaded_by: null,
    legacy_source: legacySource,
    legacy_id: legacyId,
  });

  // Now safely stored under om-assets/internal — remove the stray original.
  fs.unlinkSync(absPath);

  return { status: 'quarantined', id: asset.id };
}

/** Scans Asset Manager's own storage tree for files with no matching om_assets row. */
async function scanAssetManagerStorage({ dryRun = false } = {}) {
  const pool = getAppPool();
  const [rows] = await pool.query('SELECT file_path FROM om_assets WHERE file_path IS NOT NULL');
  const known = new Set(rows.map((r) => path.resolve(STORAGE_ROOT, r.file_path)));

  const files = walkAllFiles(OM_ASSETS_ROOT);
  const stats = { scanned: files.length, quarantined: 0, already: 0, skipped: 0 };

  for (const absPath of files) {
    if (known.has(path.resolve(absPath))) continue;
    // Transient ZIP-import scratch space, not user content.
    if (absPath.includes(`${path.sep}import-temp${path.sep}`)) continue;

    if (dryRun) {
      stats.quarantined += 1;
      continue;
    }
    const result = await quarantineFile(absPath, {
      legacySource: 'orphan_scan_asset_manager',
      legacyId: absPath,
    });
    if (result.status === 'quarantined') stats.quarantined += 1;
    else if (result.status === 'already_quarantined') stats.already += 1;
    else stats.skipped += 1;
  }

  return stats;
}

/** Scans each church's File Manager storage for files with no matching fm_files row. */
async function scanFileManagerStorage({ dryRun = false } = {}) {
  const pool = getAppPool();
  const [churches] = await pool.query(
    'SELECT id FROM orthodoxmetrics_db.churches WHERE database_name IS NOT NULL AND is_active = 1',
  );
  const stats = { scanned: 0, quarantined: 0, already: 0, skipped: 0, churches_checked: 0 };

  // Lazy require — avoids a hard dependency on the file-manager pool helper
  // for callers that only need the Asset Manager half of the scan.
  const { getTenantPool } = require('../config/db');

  for (const { id: churchId } of churches) {
    const churchDir = path.join(FILE_MANAGER_STORAGE_ROOT, `church_${churchId}`);
    if (!fs.existsSync(churchDir)) continue;

    let known;
    try {
      const tenantPool = getTenantPool(churchId);
      const [rows] = await tenantPool.query('SELECT storage_path FROM fm_files WHERE storage_path IS NOT NULL');
      known = new Set(rows.map((r) => path.resolve(r.storage_path)));
    } catch (err) {
      console.error(`[om-assets-quarantine] Could not reach tenant DB for church ${churchId}:`, err.message);
      continue; // skip rather than risk false positives from an unreachable tenant DB
    }

    stats.churches_checked += 1;
    const files = walkAllFiles(churchDir);
    stats.scanned += files.length;

    for (const absPath of files) {
      if (known.has(path.resolve(absPath))) continue;

      if (dryRun) {
        stats.quarantined += 1;
        continue;
      }
      const result = await quarantineFile(absPath, {
        legacySource: 'orphan_scan_file_manager',
        legacyId: absPath,
        name: `church ${churchId}: ${path.basename(absPath)}`,
      });
      if (result.status === 'quarantined') stats.quarantined += 1;
      else if (result.status === 'already_quarantined') stats.already += 1;
      else stats.skipped += 1;
    }
  }

  return stats;
}

async function runQuarantineScan({ dryRun = false } = {}) {
  const assetManager = await scanAssetManagerStorage({ dryRun });
  const fileManager = await scanFileManagerStorage({ dryRun });
  return { assetManager, fileManager };
}

module.exports = {
  runQuarantineScan,
  scanAssetManagerStorage,
  scanFileManagerStorage,
  quarantineFile,
};
