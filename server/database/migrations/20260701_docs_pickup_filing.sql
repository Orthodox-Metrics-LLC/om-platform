-- Migration: 2026-07-01 — Governed internal documentation filing for OM Docs Pickup
-- Applied to: orthodoxmetrics_db
--
-- Additive only. Preserves the existing pickup lifecycle (status column from
-- 20260630_docs_pickup_lifecycle.sql). Adds:
--   * a stable, UI-visible pickup_id (OMDOC-PICKUP-YYYYMMDD-XXXXX) — backfilled by
--     the service (docsPickupFilingService.ensurePickupIds) since the suffix is
--     generated in application code.
--   * filing lifecycle columns (filing_state + proposed_* + filed_* + receipt).
--   * docs_pickup_filing_requests — one row per Brain-Approval filing request.
--   * docs_pickup_filing_status_history — append-only status trail per request.
--   * widened audit event_type to accept the new filing events.

-- ── docs_pickup_files: identity + filing metadata ───────────────────────────
ALTER TABLE docs_pickup_files
  ADD COLUMN IF NOT EXISTS pickup_id VARCHAR(40) NULL COMMENT 'Stable public id OMDOC-PICKUP-YYYYMMDD-XXXXX' AFTER id,
  ADD COLUMN IF NOT EXISTS title VARCHAR(255) NULL COMMENT 'Human title for filing' AFTER original_file_name,
  ADD COLUMN IF NOT EXISTS filing_state VARCHAR(32) NOT NULL DEFAULT 'none'
    COMMENT 'none|draft|ready_for_review|filing_requested|approval_pending|approved_waiting_to_file|rejected|filed|failed',
  ADD COLUMN IF NOT EXISTS proposed_visibility VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS proposed_category VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS proposed_target_docs_path VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS filing_receipt VARCHAR(16) NULL COMMENT 'Short receipt OM-XXXXX',
  ADD COLUMN IF NOT EXISTS filed_docs_path VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS filed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS filed_by_id INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS filed_by_email VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS filed_by_name VARCHAR(255) NULL;

-- Unique + lookup indexes (guarded — MariaDB has no ADD INDEX IF NOT EXISTS on
-- older builds, so create only when missing via information_schema check).
SET @has_uq_pickup := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'docs_pickup_files' AND index_name = 'uq_pickup_id'
);
SET @sql := IF(@has_uq_pickup = 0,
  'ALTER TABLE docs_pickup_files ADD UNIQUE KEY uq_pickup_id (pickup_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has_idx_state := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'docs_pickup_files' AND index_name = 'idx_filing_state'
);
SET @sql := IF(@has_idx_state = 0,
  'ALTER TABLE docs_pickup_files ADD INDEX idx_filing_state (filing_state)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has_idx_receipt := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'docs_pickup_files' AND index_name = 'idx_filing_receipt'
);
SET @sql := IF(@has_idx_receipt = 0,
  'ALTER TABLE docs_pickup_files ADD INDEX idx_filing_receipt (filing_receipt)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── filing requests (one per Brain-Approval filing request) ─────────────────
CREATE TABLE IF NOT EXISTS docs_pickup_filing_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  receipt VARCHAR(16) NOT NULL COMMENT 'OM-XXXXX short receipt',
  pickup_file_id VARCHAR(36) NOT NULL,
  pickup_id VARCHAR(40) NOT NULL,
  title VARCHAR(255) NULL,
  source_filename VARCHAR(255) NULL,
  proposed_target_path VARCHAR(500) NOT NULL,
  category VARCHAR(64) NOT NULL,
  visibility VARCHAR(32) NOT NULL DEFAULT 'internal',
  requesting_actor VARCHAR(255) NULL,
  request_source ENUM('ombrain_cli', 'ombrain_chat', 'omdocs_pickup_ui') NOT NULL DEFAULT 'omdocs_pickup_ui',
  reason TEXT NULL,
  classification VARCHAR(64) NOT NULL DEFAULT 'requires_human_superadmin',
  domains JSON NULL,
  checksum CHAR(64) NULL,
  status ENUM('submitted', 'approved', 'rejected', 'filed', 'failed') NOT NULL DEFAULT 'submitted',
  approved_by VARCHAR(255) NULL,
  approved_at DATETIME NULL,
  rejected_by VARCHAR(255) NULL,
  rejected_at DATETIME NULL,
  decision_note TEXT NULL,
  filed_docs_path VARCHAR(500) NULL,
  filed_by VARCHAR(255) NULL,
  filed_at DATETIME NULL,
  filing_error TEXT NULL,
  omstudio_ref VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_receipt (receipt),
  INDEX idx_pickup_file (pickup_file_id),
  INDEX idx_pickup_id (pickup_id),
  INDEX idx_status (status),
  CONSTRAINT fk_filing_req_pickup
    FOREIGN KEY (pickup_file_id) REFERENCES docs_pickup_files (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Brain-Approval filing requests for docs/internal placement';

-- ── append-only status history for filing requests ──────────────────────────
CREATE TABLE IF NOT EXISTS docs_pickup_filing_status_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  receipt VARCHAR(16) NOT NULL,
  from_state VARCHAR(32) NULL,
  to_state VARCHAR(32) NOT NULL,
  actor VARCHAR(255) NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'system',
  note TEXT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_hist_receipt (receipt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Append-only status trail for docs pickup filing requests';

-- ── widen audit event_type to accept the new filing lifecycle events ────────
-- (was an ENUM limited to lifecycle actions; VARCHAR keeps existing rows valid
--  and admits pickup_created, metadata_edited, filing_requested, approval_submitted,
--  approved, rejected, waiting_to_file, filed, failed).
ALTER TABLE docs_pickup_audit_events
  MODIFY COLUMN event_type VARCHAR(48) NOT NULL;
