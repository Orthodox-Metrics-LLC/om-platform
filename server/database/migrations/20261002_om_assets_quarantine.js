/**
 * Migration: add 'quarantine' source_type and 'flagged' category to om_assets
 *
 * Run: node server/database/migrations/20261002_om_assets_quarantine.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const sqlPath = path.join(__dirname, '20261002_om_assets_quarantine.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.replace(/^\s*--[^\n]*\n?/gm, '').trim())
    .filter((s) => s.length > 0);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME || 'orthodoxmetrics_db',
    multipleStatements: false,
  });

  try {
    console.log(`Running ${statements.length} statement(s) from 20261002_om_assets_quarantine.sql\n`);
    for (let i = 0; i < statements.length; i += 1) {
      const stmt = statements[i];
      const preview = stmt.slice(0, 80).replace(/\s+/g, ' ');
      console.log(`[${i + 1}/${statements.length}] ${preview}…`);
      await conn.query(stmt);
    }

    const [[sourceTypeRow]] = await conn.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'om_assets' AND COLUMN_NAME = 'source_type'`
    );
    const [[categoryRow]] = await conn.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'om_assets' AND COLUMN_NAME = 'category'`
    );
    console.log(`\nDone. source_type column: ${sourceTypeRow.COLUMN_TYPE}`);
    console.log(`Done. category column: ${categoryRow.COLUMN_TYPE}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
