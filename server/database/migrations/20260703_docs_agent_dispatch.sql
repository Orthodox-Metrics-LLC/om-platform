-- Migration: 2026-07-03 — OM Docs Dropbox → Agent dispatch workflow (OMPKT-20260703-0002)
-- Applied to: orthodoxmetrics_db
--
-- Additive only. Introduces durable agent-dispatch records so "Send to Agent"
-- becomes a real workflow (notify → claim → work → return) rather than a status
-- flag. Existing Dropbox/Pickup data and routes are preserved and untouched.
--
--   om_agent_dispatches     — one durable dispatch per Send-to-Agent action
--   om_agent_notifications  — notification attempts per dispatch/agent/channel
--
-- docs_dropbox_files gains dispatch linkage columns and the new lifecycle
-- statuses. Audit lives in the existing docs_dropbox_audit_events (keyed by
-- file_id, with dispatch_id carried in the details JSON) so the detail drawer
-- history surfaces every transition without forking the audit source.

-- ── durable dispatch records ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS om_agent_dispatches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dispatch_id VARCHAR(40) NOT NULL COMMENT 'OMDSP-YYYYMMDD-xxxxxxxx (stable, UI-visible)',
  file_id VARCHAR(36) NOT NULL COMMENT 'docs_dropbox_files.id — the work packet source',
  work_packet_id VARCHAR(32) NULL COMMENT 'OMPKT-YYYYMMDD-####',
  assigned_agent VARCHAR(32) NULL,
  target VARCHAR(64) NULL COMMENT 'target system (OrthodoxMetrics, OMAI, ...)',
  visibility VARCHAR(16) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'requested'
    COMMENT 'requested|notified|notified_timeout|failed_to_claim|claimed|in_progress|blocked|returned|failed|cancelled',
  priority VARCHAR(16) NOT NULL DEFAULT 'medium',
  source_path VARCHAR(500) NULL COMMENT 'agent_path of the source document',
  correlation_id VARCHAR(64) NULL,
  lease_token VARCHAR(64) NULL COMMENT 'opaque token issued at claim; rotates on reclaim',
  claimed_by_agent VARCHAR(64) NULL COMMENT 'agent identity that holds the lease',
  claim_timeout_at DATETIME NULL COMMENT 'unclaimed deadline; past → notified_timeout/failed_to_claim',
  lease_expires_at DATETIME NULL COMMENT 'active lease deadline; past → reclaimable',
  heartbeat_at DATETIME NULL,
  returned_pickup_id VARCHAR(40) NULL COMMENT 'docs_pickup_files.id created on return',
  error_message TEXT NULL,
  created_by_id INT UNSIGNED NULL,
  created_by_email VARCHAR(255) NULL,
  created_by_name VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  notified_at DATETIME NULL,
  claimed_at DATETIME NULL,
  started_at DATETIME NULL,
  blocked_at DATETIME NULL,
  returned_at DATETIME NULL,
  completed_at DATETIME NULL,
  failed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dispatch_id (dispatch_id),
  INDEX idx_disp_file (file_id),
  INDEX idx_disp_agent_status (assigned_agent, status),
  INDEX idx_disp_work_packet (work_packet_id),
  INDEX idx_disp_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Durable Dropbox→Agent dispatch records (notify/claim/lease lifecycle)';

-- ── notification attempts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS om_agent_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  notification_id VARCHAR(40) NOT NULL,
  dispatch_id VARCHAR(40) NOT NULL,
  agent_id VARCHAR(64) NULL,
  channel VARCHAR(24) NOT NULL DEFAULT 'db_queue'
    COMMENT 'db_queue|websocket|sse|ombrain|file_drop|other',
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    COMMENT 'pending|sent|acknowledged|failed',
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  acknowledged_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notification_id (notification_id),
  INDEX idx_notif_dispatch (dispatch_id),
  INDEX idx_notif_agent (agent_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-dispatch agent notification attempts';

-- ── docs_dropbox_files: dispatch linkage + widened status enum ───────────────
ALTER TABLE docs_dropbox_files
  ADD COLUMN IF NOT EXISTS current_dispatch_id VARCHAR(40) NULL COMMENT 'active om_agent_dispatches.dispatch_id' AFTER assigned_agent,
  ADD COLUMN IF NOT EXISTS returned_pickup_id VARCHAR(40) NULL COMMENT 'docs_pickup_files.id when returned' AFTER current_dispatch_id,
  ADD COLUMN IF NOT EXISTS last_status_change_at DATETIME NULL AFTER updated_at;

-- Widen status ENUM to admit the full dispatch lifecycle. Existing values kept.
ALTER TABLE docs_dropbox_files
  MODIFY COLUMN status ENUM(
    'uploaded', 'reviewed', 'edited', 'ready_for_public_docs', 'ready_for_internal_docs',
    'promoted', 'rejected', 'archived',
    'dropped', 'ready_for_agent', 'picked_up', 'cancelled',
    'sent_to_agent', 'agent_notified', 'claimed_by_agent', 'in_progress',
    'blocked', 'returned_in_pickup', 'failed'
  ) NOT NULL DEFAULT 'uploaded';

-- Widen audit event_type to admit longer dispatch event names (guarded).
ALTER TABLE docs_dropbox_audit_events
  MODIFY COLUMN event_type VARCHAR(64) NOT NULL;

SET @has_idx_cur := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'docs_dropbox_files' AND index_name = 'idx_current_dispatch'
);
SET @sql := IF(@has_idx_cur = 0,
  'ALTER TABLE docs_dropbox_files ADD INDEX idx_current_dispatch (current_dispatch_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── docs_pickup_files: back-link to the originating dispatch/work packet ─────
ALTER TABLE docs_pickup_files
  ADD COLUMN IF NOT EXISTS dispatch_id VARCHAR(40) NULL COMMENT 'om_agent_dispatches.dispatch_id that produced this pickup' AFTER work_packet_id,
  ADD COLUMN IF NOT EXISTS source_file_id VARCHAR(36) NULL COMMENT 'docs_dropbox_files.id source' AFTER dispatch_id;

SET @has_idx_pk_disp := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'docs_pickup_files' AND index_name = 'idx_pickup_dispatch'
);
SET @sql := IF(@has_idx_pk_disp = 0,
  'ALTER TABLE docs_pickup_files ADD INDEX idx_pickup_dispatch (dispatch_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
