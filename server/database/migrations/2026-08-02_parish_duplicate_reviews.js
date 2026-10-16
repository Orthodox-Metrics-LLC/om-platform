#!/usr/bin/env node
/** OMOD-2804: non-destructive, app-database duplicate review decisions. */
const { getAppPool } = require('../../src/config/db-compat');
async function up() {
  await getAppPool().query(`CREATE TABLE IF NOT EXISTS parish_duplicate_reviews (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    church_id INT NOT NULL,
    duplicate_group_signature CHAR(64) NOT NULL,
    record_type VARCHAR(32) NOT NULL,
    record_ids_json JSON NOT NULL,
    classification VARCHAR(64) NOT NULL,
    review_status ENUM('unreviewed','confirmed_duplicate','not_a_duplicate','needs_investigation','resolved_externally') NOT NULL DEFAULT 'unreviewed',
    reviewed_by INT NULL, reviewed_at DATETIME NULL, notes TEXT NULL,
    canonical_record_id BIGINT NULL, resolution_decision VARCHAR(32) NULL, resolved_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pdr_church_signature (church_id, duplicate_group_signature),
    KEY idx_pdr_church_status (church_id, review_status),
    KEY idx_pdr_church_type (church_id, record_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  console.log('parish_duplicate_reviews ready');
}
async function down() {
  await getAppPool().query('DROP TABLE IF EXISTS parish_duplicate_reviews');
  console.log('parish_duplicate_reviews removed (review metadata only)');
}
module.exports = { up, down };
if (require.main === module) up().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
