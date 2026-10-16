/**
 * Migration: reversible soft-delete columns on sacramental record tables.
 *
 * Adds to baptism_records / marriage_records / funeral_records across all
 * om_church_## databases:
 *   - deleted_at DATETIME NULL
 *   - deleted_by INT NULL
 *   - deletion_reason VARCHAR(500) NULL
 *   - created_at DATETIME NULL (only if missing; no artificial backfill)
 *   - updated_at DATETIME NULL (only if missing; no artificial backfill)
 *
 * Idempotent. Does not rewrite historical rows with fake timestamps.
 *
 * Run: node server/database/migrations/2026-08-02_parish_record_soft_delete.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const RECORD_TABLES = ['baptism_records', 'marriage_records', 'funeral_records'];

async function tableExists(conn, dbName, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1`,
    [dbName, table],
  );
  return rows.length > 0;
}

async function migrateDb(conn, dbName) {
  const result = { db: dbName, tables: {} };
  for (const table of RECORD_TABLES) {
    try {
      if (!(await tableExists(conn, dbName, table))) {
        result.tables[table] = 'skipped (no table)';
        continue;
      }
      await conn.query(
        `ALTER TABLE \`${dbName}\`.\`${table}\`
           ADD COLUMN IF NOT EXISTS \`deleted_at\` DATETIME NULL,
           ADD COLUMN IF NOT EXISTS \`deleted_by\` INT NULL,
           ADD COLUMN IF NOT EXISTS \`deletion_reason\` VARCHAR(500) NULL,
           ADD COLUMN IF NOT EXISTS \`created_at\` DATETIME NULL,
           ADD COLUMN IF NOT EXISTS \`updated_at\` DATETIME NULL`,
      );
      await conn.query(
        `ALTER TABLE \`${dbName}\`.\`${table}\`
           ADD INDEX IF NOT EXISTS \`idx_${table}_deleted_at\` (\`deleted_at\`)`,
      ).catch(() => {});
      result.tables[table] = 'ok';
    } catch (err) {
      result.tables[table] = `ERROR: ${err.message}`;
    }
  }
  return result;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });
  try {
    const [churches] = await conn.query(
      `SELECT id, database_name FROM orthodoxmetrics_db.churches
       WHERE database_name IS NOT NULL AND database_name <> ''`,
    );
    const results = [];
    for (const church of churches) {
      results.push(await migrateDb(conn, church.database_name));
    }
    console.log(JSON.stringify({ migrated: results.length, results }, null, 2));
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { migrateDb, RECORD_TABLES };
