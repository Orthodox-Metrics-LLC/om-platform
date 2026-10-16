#!/usr/bin/env node
/**
 * Import 2026 OCA certificate PNG templates into Certificate Studio.
 *
 * Copies server/certificates/2026/*.png → storage/om-assets/public/certificates/2026/
 * Updates global default templates (baptism, marriage, reception) with portrait
 * layouts using the 2026 artwork and coordinate-maps field positions.
 *
 * Run: node server/database/migrations/20260626_certificate_studio_2026_templates.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { getAppPool } = require('../../src/config/db');
const {
  buildBaptismLayout2026,
  buildMarriageLayout2026,
  buildReceptionLayout2026,
  PAGE_W,
  PAGE_H,
} = require('../../src/certificates/studio/layout-builder');
const { toRelativeStoragePath } = require('../../src/assets/omAssetsConstants');

const SOURCE_DIR = path.join(__dirname, '../../certificates/2026');
const DEST_DIR = path.join(__dirname, '../../storage/om-assets/public/certificates/2026');

const TEMPLATE_ASSETS = [
  { file: 'adult-baptism.png', name: '2026 OCA — Adult Baptism', slug: '2026-adult-baptism', legacyId: '2026-adult-baptism' },
  { file: 'marriage.png', name: '2026 OCA — Marriage', slug: '2026-marriage', legacyId: '2026-marriage' },
  { file: 'reception.png', name: '2026 OCA — Reception', slug: '2026-reception', legacyId: '2026-reception' },
  { file: 'chrismation.png', name: '2026 OCA — Chrismation', slug: '2026-chrismation', legacyId: '2026-chrismation' },
  { file: 'recognition.png', name: '2026 OCA — Recognition', slug: '2026-recognition', legacyId: '2026-recognition' },
  { file: 'baptism-adult.png', name: '2026 OCA — Baptism Adult (alt)', slug: '2026-baptism-adult', legacyId: '2026-baptism-adult' },
];

const TEMPLATE_UPDATES = [
  {
    templateId: 1,
    certType: 'baptism',
    name: 'OM 2026 — Baptism (Default)',
    description: 'Global default baptism certificate — 2026 OCA parish template',
    assetLegacyId: '2026-adult-baptism',
    buildLayout: buildBaptismLayout2026,
  },
  {
    templateId: 2,
    certType: 'marriage',
    name: 'OM 2026 — Marriage (Default)',
    description: 'Global default marriage certificate — 2026 OCA parish template',
    assetLegacyId: '2026-marriage',
    buildLayout: buildMarriageLayout2026,
  },
  {
    templateId: 3,
    certType: 'reception',
    name: 'OM 2026 — Reception (Default)',
    description: 'Global default reception certificate — 2026 OCA parish template',
    assetLegacyId: '2026-reception',
    buildLayout: buildReceptionLayout2026,
  },
];

function hashFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function ensureAsset(pool, spec) {
  const src = path.join(SOURCE_DIR, spec.file);
  if (!fs.existsSync(src)) {
    console.warn(`  skip missing source: ${spec.file}`);
    return null;
  }

  fs.mkdirSync(DEST_DIR, { recursive: true });
  const dest = path.join(DEST_DIR, spec.file);
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
    console.log(`  copied ${spec.file}`);
  }

  const relPath = toRelativeStoragePath(dest);
  const sha = hashFile(dest);

  const [existing] = await pool.query(
    `SELECT id FROM om_assets WHERE legacy_source = ? AND legacy_id = ? LIMIT 1`,
    ['certificates_2026', spec.legacyId],
  );
  if (existing.length) {
    await pool.query(
      `UPDATE om_assets SET file_path = ?, width = 1275, height = 1651, sha256 = ?, status = 'active', updated_at = NOW()
       WHERE id = ?`,
      [relPath, sha, existing[0].id],
    );
    return existing[0].id;
  }

  const [result] = await pool.query(
    `INSERT INTO om_assets
       (name, slug, scope, category, file_path, file_type, width, height, sha256,
        legacy_source, legacy_id, licensing_note, status, product_tags)
     VALUES (?, ?, 'public', 'template', ?, 'image/png', 1275, 1651, ?, 'certificates_2026', ?, 'OCA 2026 parish certificate artwork', 'active', ?)`,
    [spec.name, spec.slug, relPath, sha, spec.legacyId, JSON.stringify(['om'])],
  );
  return result.insertId;
}

async function publishTemplateVersion(pool, update, assetId) {
  const layout = update.buildLayout(assetId);

  const [verRows] = await pool.query(
    `SELECT COALESCE(MAX(version_number), 0) AS mv FROM certificate_studio_template_versions WHERE template_id = ?`,
    [update.templateId],
  );
  const nextVersion = verRows[0].mv + 1;

  const [ins] = await pool.query(
    `INSERT INTO certificate_studio_template_versions
       (template_id, version_number, layout_json, asset_manifest_json, font_manifest_json, published_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [
      update.templateId,
      nextVersion,
      JSON.stringify(layout),
      JSON.stringify([assetId]),
      JSON.stringify(['Times-Roman', 'Times-Bold', 'Times-Italic']),
    ],
  );

  await pool.query(
    `UPDATE certificate_studio_templates
     SET name = ?, description = ?, status = 'active', is_default = TRUE,
         canvas_size = 'letter', orientation = 'portrait',
         custom_width = ?, custom_height = ?,
         current_version_id = ?, updated_at = NOW()
     WHERE id = ?`,
    [update.name, update.description, PAGE_W, PAGE_H, ins.insertId, update.templateId],
  );

  return { versionId: ins.insertId, versionNumber: nextVersion };
}

async function main() {
  console.log('Certificate Studio — 2026 template import\n');

  const pool = getAppPool();
  const assetIds = {};

  console.log('1. Registering om_assets from certificates/2026/');
  for (const spec of TEMPLATE_ASSETS) {
    const id = await ensureAsset(pool, spec);
    if (id) {
      assetIds[spec.legacyId] = id;
      console.log(`   ${spec.legacyId} → asset id ${id}`);
    }
  }

  console.log('\n2. Updating global default templates');
  const results = [];
  for (const update of TEMPLATE_UPDATES) {
    const assetId = assetIds[update.assetLegacyId];
    if (!assetId) {
      console.error(`   missing asset for template ${update.templateId}`);
      continue;
    }
    const pub = await publishTemplateVersion(pool, update, assetId);
    results.push({ templateId: update.templateId, ...pub, name: update.name });
    console.log(`   template ${update.templateId} → v${pub.versionNumber} (version_id ${pub.versionId})`);
  }

  console.log('\nDone.');
  console.log(JSON.stringify({ assetIds, templates: results }, null, 2));
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
