/**
 * Parish search audit helpers — metadata only, never full result contents.
 */

const { getAppPool } = require('../../config/db-compat');

async function ensureParishSearchAuditTable() {
  const pool = getAppPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parish_search_audit (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(64) NOT NULL,
      church_id INT NOT NULL,
      user_id INT NULL,
      execution_id VARCHAR(64) NULL,
      meta_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_psa_church_created (church_id, created_at),
      KEY idx_psa_event (event_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function logParishSearchEvent(eventType, { churchId, userId, executionId, meta } = {}) {
  try {
    await ensureParishSearchAuditTable();
    const pool = getAppPool();
    await pool.query(
      `INSERT INTO parish_search_audit (event_type, church_id, user_id, execution_id, meta_json)
       VALUES (?, ?, ?, ?, ?)`,
      [
        eventType,
        churchId || 0,
        userId || null,
        executionId || null,
        meta ? JSON.stringify(meta) : null,
      ],
    );
  } catch (err) {
    console.warn('[parish-search-audit] failed:', err.message);
  }
}

module.exports = { logParishSearchEvent, ensureParishSearchAuditTable };
