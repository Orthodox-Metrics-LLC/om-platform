-- Migration: 2026-07-01 — Work Packet correlation + Dropbox pasted-prompt support
-- Applied to: orthodoxmetrics_db
--
-- Additive only. Introduces a shared Work Packet ID registry (OMPKT-YYYYMMDD-####)
-- so that BOTH uploaded files and pasted prompts in the Docs Dropbox, and the
-- Docs Pickup results they correlate to, can share one stable id. Existing
-- Dropbox/Pickup ids (uuid, OMDOC-PICKUP-...) are preserved and untouched.

-- ── shared Work Packet registry ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_packets (
  work_packet_id VARCHAR(32) NOT NULL COMMENT 'OMPKT-YYYYMMDD-#### (UI-visible, stable)',
  packet_date DATE NOT NULL,
  seq INT UNSIGNED NOT NULL COMMENT 'Daily sequence, 1-based',
  source_type VARCHAR(32) NULL COMMENT 'uploaded_file | pasted_prompt | pickup | other',
  origin VARCHAR(32) NULL COMMENT 'dropbox | pickup',
  ref_id VARCHAR(64) NULL COMMENT 'Owning row id (dropbox file id, pickup id, ...)',
  created_by_email VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (work_packet_id),
  UNIQUE KEY uq_date_seq (packet_date, seq),
  INDEX idx_packet_date (packet_date),
  INDEX idx_ref (origin, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Shared Work Packet ID registry correlating Dropbox items and Pickup results';

-- ── docs_dropbox_files: work packet + pasted prompt columns ─────────────────
ALTER TABLE docs_dropbox_files
  ADD COLUMN IF NOT EXISTS work_packet_id VARCHAR(32) NULL COMMENT 'OMPKT-YYYYMMDD-####' AFTER id,
  ADD COLUMN IF NOT EXISTS source_type ENUM('uploaded_file', 'pasted_prompt') NOT NULL DEFAULT 'uploaded_file' AFTER work_packet_id,
  ADD COLUMN IF NOT EXISTS target_system VARCHAR(64) NULL AFTER doc_type,
  ADD COLUMN IF NOT EXISTS assigned_agent VARCHAR(32) NULL AFTER target_system,
  ADD COLUMN IF NOT EXISTS prompt_text MEDIUMTEXT NULL COMMENT 'Raw pasted prompt (pasted_prompt only)' AFTER description;

-- Widen status ENUM to admit the pasted-prompt lifecycle (dropped -> ready_for_agent -> picked_up -> cancelled).
ALTER TABLE docs_dropbox_files
  MODIFY COLUMN status ENUM(
    'uploaded', 'reviewed', 'edited', 'ready_for_public_docs', 'ready_for_internal_docs',
    'promoted', 'rejected', 'archived',
    'dropped', 'ready_for_agent', 'picked_up', 'cancelled'
  ) NOT NULL DEFAULT 'uploaded';

-- Work packet lookup index (guarded — MariaDB lacks ADD INDEX IF NOT EXISTS on older builds).
SET @has_idx_wp := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'docs_dropbox_files' AND index_name = 'idx_work_packet_id'
);
SET @sql := IF(@has_idx_wp = 0,
  'ALTER TABLE docs_dropbox_files ADD INDEX idx_work_packet_id (work_packet_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Widen audit event_type ENUM -> VARCHAR to admit pasted-prompt lifecycle events.
ALTER TABLE docs_dropbox_audit_events
  MODIFY COLUMN event_type VARCHAR(48) NOT NULL;

-- ── docs_pickup_files: carry the same Work Packet id for correlation ────────
ALTER TABLE docs_pickup_files
  ADD COLUMN IF NOT EXISTS work_packet_id VARCHAR(32) NULL COMMENT 'OMPKT-YYYYMMDD-#### (correlates to a Dropbox item)' AFTER pickup_id;

SET @has_idx_pk_wp := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'docs_pickup_files' AND index_name = 'idx_pickup_work_packet'
);
SET @sql := IF(@has_idx_pk_wp = 0,
  'ALTER TABLE docs_pickup_files ADD INDEX idx_pickup_work_packet (work_packet_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
