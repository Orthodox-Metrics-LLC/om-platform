/**
 * OM Assets Library Phase 1 — internal scope, collections, visibility, audit
 * Run: node server/database/migrations/20260630_om_assets_phase1_internal_collections.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function addColumnIfMissing(conn, table, column, ddl) {
  if (await columnExists(conn, table, column)) {
    console.log(`  skip ${table}.${column} (exists)`);
    return;
  }
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log(`  added ${table}.${column}`);
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '192.168.1.241',
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'orthodoxapps',
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME || 'orthodoxmetrics_db',
    multipleStatements: true,
  });

  console.log('Connected. Running OM Assets Phase 1 migration…');

  const sqlPath = path.join(__dirname, '20260630_om_assets_phase1_internal_collections.sql');
  const raw = fs.readFileSync(sqlPath, 'utf8');

  const statements = raw
    .split(/;\s*\n/)
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  // Run table / enum DDL first (skip ADD COLUMN IF NOT EXISTS — handled below)
  for (const stmt of statements) {
    const preview = stmt.slice(0, 80).replace(/\s+/g, ' ');
    try {
      if (stmt.includes('ADD COLUMN IF NOT EXISTS') || stmt.includes('CREATE INDEX IF NOT EXISTS idx_om_assets_')) {
        continue;
      }
      if (stmt.startsWith('UPDATE om_assets')) {
        continue;
      }
      if (stmt.startsWith('INSERT IGNORE INTO asset_collections')) {
        continue;
      }
      await connection.query(stmt);
      console.log('OK:', preview);
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_TABLE_EXISTS_ERR' || err.code === 'ER_DUP_KEYNAME') {
        console.log('skip (exists):', preview);
      } else {
        console.error('FAIL:', preview, err.message);
        throw err;
      }
    }
  }

  // Manual column adds for MariaDB without IF NOT EXISTS
  console.log('Adding om_assets columns if missing…');
  const assetCols = [
    ['visibility', "visibility ENUM('public','authenticated','internal_only') NOT NULL DEFAULT 'public' AFTER scope"],
    ['collection_id', 'collection_id INT NULL AFTER visibility'],
    ['folder', 'folder VARCHAR(512) NULL AFTER collection_id'],
    ['source_type', "source_type ENUM('upload','import','legacy','generated','screenshot','promote_copy') NOT NULL DEFAULT 'upload' AFTER folder"],
    ['owner_system', "owner_system ENUM('om','omai','omstudio','omworkshop','ombrain','certificate_studio','public_website') NOT NULL DEFAULT 'om' AFTER source_type"],
    ['title', 'title VARCHAR(255) NULL AFTER name'],
    ['description', 'description TEXT NULL AFTER title'],
    ['alt_text', 'alt_text VARCHAR(512) NULL AFTER description'],
    ['caption', 'caption TEXT NULL AFTER alt_text'],
    ['credit', 'credit VARCHAR(255) NULL AFTER caption'],
    ['mime_type', 'mime_type VARCHAR(128) NULL AFTER file_type'],
    ['checksum_sha256', 'checksum_sha256 CHAR(64) NULL AFTER sha256'],
    ['storage_path', "storage_path VARCHAR(512) NULL COMMENT 'Logical /assets/{scope}/ path' AFTER file_path"],
    ['public_url', 'public_url VARCHAR(512) NULL AFTER storage_path'],
    ['internal_url', 'internal_url VARCHAR(512) NULL AFTER public_url'],
    ['created_by', 'created_by INT NULL AFTER uploaded_by'],
  ];
  for (const [col, ddl] of assetCols) {
    await addColumnIfMissing(connection, 'om_assets', col, ddl);
  }

  for (const idx of [
    'CREATE INDEX IF NOT EXISTS idx_om_assets_visibility ON om_assets (visibility)',
    'CREATE INDEX IF NOT EXISTS idx_om_assets_collection ON om_assets (collection_id)',
    'CREATE INDEX IF NOT EXISTS idx_om_assets_folder ON om_assets (folder(191))',
  ]) {
    try {
      await connection.query(idx);
      console.log('OK index:', idx.slice(0, 60));
    } catch (err) {
      console.log('index skip:', err.message);
    }
  }

  // Scope enum extension
  try {
    await connection.query(
      "ALTER TABLE om_assets MODIFY COLUMN scope ENUM('public','church','site','internal') NOT NULL DEFAULT 'public'",
    );
    console.log('OK: extended om_assets.scope enum');
  } catch (err) {
    console.log('scope enum:', err.message);
  }

  // Backfills
  const backfills = [
    "UPDATE om_assets SET visibility = 'authenticated' WHERE scope = 'church' AND visibility = 'public'",
    "UPDATE om_assets SET visibility = 'internal_only' WHERE scope = 'site' AND visibility = 'public'",
    "UPDATE om_assets SET folder = JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.directory')) WHERE folder IS NULL AND JSON_EXTRACT(metadata_json, '$.directory') IS NOT NULL",
    'UPDATE om_assets SET checksum_sha256 = sha256 WHERE checksum_sha256 IS NULL AND sha256 IS NOT NULL',
    'UPDATE om_assets SET mime_type = file_type WHERE mime_type IS NULL AND file_type IS NOT NULL',
    'UPDATE om_assets SET created_by = uploaded_by WHERE created_by IS NULL AND uploaded_by IS NOT NULL',
  ];
  for (const q of backfills) {
    const [r] = await connection.query(q);
    console.log('backfill affected:', r.affectedRows);
  }

  // Seed collections
  await connection.query(`
    INSERT IGNORE INTO asset_collections (name, slug, description, scope, visibility, category, folder, source_type, owner_system, metadata_json)
    VALUES
      ('Orthodox Metrics Logos', 'om-logos', 'Official OM brand logos and wordmarks', 'site', 'authenticated', 'logo', 'branding/logos', 'upload', 'om', JSON_OBJECT('seed', true)),
      ('Public Website Graphics', 'public-website-graphics', 'Marketing and public-site imagery', 'public', 'public', 'content', 'website', 'upload', 'public_website', JSON_OBJECT('seed', true)),
      ('OM Internal Screenshots', 'om-internal-screenshots', 'Staff reference screenshots — not for public distribution', 'internal', 'internal_only', 'content', 'screenshots', 'screenshot', 'om', JSON_OBJECT('seed', true)),
      ('OM Workshop References', 'om-workshop-references', 'OM Workshop design references for staff', 'internal', 'internal_only', 'content', 'workshop', 'import', 'omworkshop', JSON_OBJECT('seed', true)),
      ('OMBrain Visual Assets', 'ombrain-visual-assets', 'OMBrain diagrams and visual references', 'internal', 'internal_only', 'content', 'ombrain', 'generated', 'ombrain', JSON_OBJECT('seed', true)),
      ('Certificate Studio Templates', 'certificate-studio-templates', 'Certificate layout templates and artwork', 'site', 'authenticated', 'template', 'certificates', 'legacy', 'certificate_studio', JSON_OBJECT('seed', true))
  `);
  console.log('Seed collections applied.');

  await connection.end();
  console.log('Migration complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
