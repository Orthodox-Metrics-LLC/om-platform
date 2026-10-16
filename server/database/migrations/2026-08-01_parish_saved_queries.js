#!/usr/bin/env node
/**
 * Create parish_saved_queries in the app database (OMOD-2803).
 * Stores validated query AST JSON only — never generated SQL.
 */
const { getAppPool } = require('../../src/config/db-compat');

async function up() {
  const pool = getAppPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parish_saved_queries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      church_id INT NOT NULL,
      owner_user_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      description TEXT NULL,
      query_ast JSON NOT NULL,
      query_version INT NOT NULL DEFAULT 1,
      visibility ENUM('private','parish','parish_admin') NOT NULL DEFAULT 'private',
      export_config JSON NULL,
      pinned TINYINT(1) NOT NULL DEFAULT 0,
      run_count INT NOT NULL DEFAULT 0,
      last_run_at DATETIME NULL,
      last_result_count INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_psq_church_owner (church_id, owner_user_id),
      KEY idx_psq_church_vis (church_id, visibility),
      KEY idx_psq_pinned (church_id, pinned)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('parish_saved_queries ready');
  process.exit(0);
}

up().catch((e) => { console.error(e); process.exit(1); });
