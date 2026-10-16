/**
 * Migration: latest_news_media.om_asset_id (Page Builder <-> Asset Manager link)
 *
 * Run: node server/database/migrations/20260930_latest_news_media_asset_ref.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const sqlPath = path.join(__dirname, '20260930_latest_news_media_asset_ref.sql');
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
    console.log(`Running ${statements.length} statement(s) from 20260930_latest_news_media_asset_ref.sql\n`);
    for (let i = 0; i < statements.length; i += 1) {
      const stmt = statements[i];
      try {
        await conn.query(stmt);
        console.log(`[${i + 1}/${statements.length}] ok`);
      } catch (err) {
        if (['ER_TABLE_EXISTS_ERROR', 'ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME'].includes(err.code)) {
          console.log(`[${i + 1}/${statements.length}] skipped (${err.code})`);
          continue;
        }
        throw err;
      }
    }
    console.log('\nDone.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
