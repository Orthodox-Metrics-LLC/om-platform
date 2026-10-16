/**
 * Migration: Latest News Campaign Builder schema
 *
 * Run: node server/database/migrations/20260630_latest_news_campaigns.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const sqlPath = path.join(__dirname, '20260630_latest_news_campaigns.sql');
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
    console.log(`Running ${statements.length} statement(s) from 20260630_latest_news_campaigns.sql\n`);
    for (let i = 0; i < statements.length; i += 1) {
      const stmt = statements[i];
      const preview = stmt.slice(0, 80).replace(/\s+/g, ' ');
      console.log(`[${i + 1}/${statements.length}] ${preview}…`);
      try {
        await conn.query(stmt);
      } catch (err) {
        if (err.code === 'ER_TABLE_EXISTS_ERROR' || err.code === 'ER_DUP_FIELDNAME') {
          console.log(`  skipped (${err.code})`);
          continue;
        }
        throw err;
      }
    }

    const [[campaigns]] = await conn.query('SELECT COUNT(*) AS n FROM latest_news_campaigns');
    const [[items]] = await conn.query('SELECT COUNT(*) AS n FROM latest_news_items');
    const [[media]] = await conn.query('SELECT COUNT(*) AS n FROM latest_news_media');
    console.log(`\nDone. campaigns=${campaigns.n}, items=${items.n}, media=${media.n}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
