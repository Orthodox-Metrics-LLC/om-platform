/** Transactional duplicate-resolution metadata and audit support. Idempotent. */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrateTenant(conn, dbName) {
  await conn.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.duplicate_resolution_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    church_id INT NOT NULL, duplicate_group_signature CHAR(64) NOT NULL,
    record_type VARCHAR(32) NOT NULL, removed_record_id BIGINT NOT NULL,
    canonical_record_id BIGINT NOT NULL, acting_user_id INT NULL,
    resolved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    review_notes TEXT NULL, deletion_reason VARCHAR(500) NOT NULL,
    previous_record_status VARCHAR(100) NULL, request_id CHAR(36) NOT NULL,
    KEY idx_dra_group (duplicate_group_signature), KEY idx_dra_removed (record_type, removed_record_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function main() {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  try {
    await conn.query(`ALTER TABLE orthodoxmetrics_db.parish_duplicate_reviews
      ADD COLUMN IF NOT EXISTS canonical_record_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS resolution_decision VARCHAR(32) NULL,
      ADD COLUMN IF NOT EXISTS resolved_at DATETIME NULL`);
    const [churches] = await conn.query(`SELECT database_name FROM orthodoxmetrics_db.churches WHERE database_name IS NOT NULL AND database_name <> ''`);
    for (const { database_name: db } of churches) await migrateTenant(conn, db);
    console.log(JSON.stringify({ migratedTenants: churches.length }));
  } finally { await conn.end(); }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });
module.exports = { migrateTenant };
