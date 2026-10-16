/**
 * Migration: Church News tables — applied to record_template1 (the live
 * provisioning source per tenantProvisioning.js) and every existing tenant
 * DB (om_church_## — currently just om_church_46).
 *
 * church_template is deliberately NOT included: it's missing fm_files (and
 * likely other tables present in record_template1 — only 22 tables vs. 31),
 * so church_news_media's FK into fm_files would fail there. It is not
 * referenced by any active provisioning code. Revisit separately if/when
 * church_template is brought to parity with record_template1.
 *
 * Run: node server/database/migrations/20260930_tenant_church_news.js
 *      node server/database/migrations/20260930_tenant_church_news.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const sqlPath = path.join(__dirname, '20260930_tenant_church_news.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.replace(/^\s*--[^\n]*\n?/gm, '').trim())
    .filter((s) => s.length > 0);

  const baseConfig = {
    host: process.env.DB_HOST,
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    multipleStatements: false,
  };

  // Discover every tenant DB name from orthodoxmetrics_db.churches, plus the
  // provisioning template itself.
  const platformConn = await mysql.createConnection({ ...baseConfig, database: 'orthodoxmetrics_db' });
  let targetDbs;
  try {
    const [rows] = await platformConn.query(
      "SELECT DISTINCT database_name FROM churches WHERE database_name IS NOT NULL AND database_name <> ''"
    );
    targetDbs = ['record_template1', ...rows.map((r) => r.database_name)];
  } finally {
    await platformConn.end();
  }

  console.log(`Target DBs (${targetDbs.length}): ${targetDbs.join(', ')}`);
  if (DRY_RUN) {
    console.log('--dry-run: no statements executed.');
    return;
  }

  const results = [];
  for (const dbName of targetDbs) {
    const conn = await mysql.createConnection({ ...baseConfig, database: dbName });
    try {
      for (let i = 0; i < statements.length; i += 1) {
        const stmt = statements[i];
        try {
          await conn.query(stmt);
        } catch (err) {
          if (['ER_TABLE_EXISTS_ERROR', 'ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME'].includes(err.code)) {
            continue;
          }
          throw err;
        }
      }
      results.push({ dbName, ok: true });
      console.log(`[ok] ${dbName}`);
    } catch (err) {
      results.push({ dbName, ok: false, error: err.message });
      console.error(`[FAILED] ${dbName}: ${err.message}`);
    } finally {
      await conn.end();
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nDone. ${results.length - failed.length}/${results.length} succeeded.`);
  if (failed.length) {
    console.error('Failed DBs:', failed.map((f) => f.dbName).join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
