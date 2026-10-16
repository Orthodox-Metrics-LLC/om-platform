/**
 * Migration: extend Page Builder page_type ENUM with checkout/payment/pricing
 *
 * Run: node server/database/migrations/20261002_latest_news_page_types_checkout.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const sqlPath = path.join(__dirname, '20261002_latest_news_page_types_checkout.sql');
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
    console.log(`Running ${statements.length} statement(s) from 20261002_latest_news_page_types_checkout.sql\n`);
    for (let i = 0; i < statements.length; i += 1) {
      const stmt = statements[i];
      const preview = stmt.slice(0, 80).replace(/\s+/g, ' ');
      console.log(`[${i + 1}/${statements.length}] ${preview}…`);
      await conn.query(stmt);
    }

    const [[row]] = await conn.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'latest_news_campaigns' AND COLUMN_NAME = 'page_type'`
    );
    console.log(`\nDone. page_type column: ${row.COLUMN_TYPE}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
