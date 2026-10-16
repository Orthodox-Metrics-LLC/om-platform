const { getAppPool } = require('../../config/db-compat');
const { logParishSearchEvent } = require('./audit');

const STATUSES = new Set(['unreviewed', 'confirmed_duplicate', 'not_a_duplicate', 'needs_investigation', 'resolved_externally']);

async function ensureDuplicateReviewTable() {
  await getAppPool().query(`CREATE TABLE IF NOT EXISTS parish_duplicate_reviews (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, church_id INT NOT NULL,
    duplicate_group_signature CHAR(64) NOT NULL, record_type VARCHAR(32) NOT NULL,
    record_ids_json JSON NOT NULL, classification VARCHAR(64) NOT NULL,
    review_status ENUM('unreviewed','confirmed_duplicate','not_a_duplicate','needs_investigation','resolved_externally') NOT NULL DEFAULT 'unreviewed',
    reviewed_by INT NULL, reviewed_at DATETIME NULL, notes TEXT NULL,
    canonical_record_id BIGINT NULL, resolution_decision VARCHAR(32) NULL, resolved_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pdr_church_signature (church_id, duplicate_group_signature),
    KEY idx_pdr_church_status (church_id, review_status), KEY idx_pdr_church_type (church_id, record_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await getAppPool().query(`ALTER TABLE parish_duplicate_reviews
    ADD COLUMN IF NOT EXISTS canonical_record_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS resolution_decision VARCHAR(32) NULL,
    ADD COLUMN IF NOT EXISTS resolved_at DATETIME NULL`);
}

async function reviewsBySignatures(churchId, signatures) {
  if (!signatures.length) return new Map();
  await ensureDuplicateReviewTable();
  const [rows] = await getAppPool().query(
    `SELECT duplicate_group_signature, review_status, notes, reviewed_by, reviewed_at
     FROM parish_duplicate_reviews WHERE church_id = ? AND duplicate_group_signature IN (${signatures.map(() => '?').join(',')})`,
    [churchId, ...signatures],
  );
  return new Map(rows.map((r) => [r.duplicate_group_signature, r]));
}

async function saveReview({ churchId, signature, recordType, recordIds, classification, status, notes, userId }) {
  if (!STATUSES.has(status)) { const e = new Error('Invalid duplicate review status'); e.status = 400; e.code = 'invalid_review_status'; throw e; }
  await ensureDuplicateReviewTable();
  await getAppPool().query(
    `INSERT INTO parish_duplicate_reviews
      (church_id, duplicate_group_signature, record_type, record_ids_json, classification, review_status, reviewed_by, reviewed_at, notes, resolution_decision, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
     ON DUPLICATE KEY UPDATE record_ids_json=VALUES(record_ids_json), classification=VALUES(classification),
       review_status=VALUES(review_status), reviewed_by=VALUES(reviewed_by), reviewed_at=NOW(), notes=VALUES(notes),
       resolution_decision=VALUES(resolution_decision), resolved_at=VALUES(resolved_at)`,
    [churchId, signature, recordType, JSON.stringify(recordIds), classification, status, userId, notes || null,
      status === 'not_a_duplicate' ? 'not_duplicates' : null, status === 'not_a_duplicate' ? new Date() : null],
  );
  await logParishSearchEvent('duplicate_group_status_changed', { churchId, userId, meta: { signature, recordType, status, recordCount: recordIds.length } });
  return { signature, reviewStatus: status, notes: notes || null, reviewedBy: userId };
}

module.exports = { reviewsBySignatures, saveReview, STATUSES, ensureDuplicateReviewTable };
