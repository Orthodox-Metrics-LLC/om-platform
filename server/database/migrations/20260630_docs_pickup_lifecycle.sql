-- Migration: 2026-06-30 — OM Docs Pickup persistent lifecycle + audit
-- Applied to: orthodoxmetrics_db

CREATE TABLE IF NOT EXISTS docs_pickup_files (
  id VARCHAR(36) NOT NULL,
  file_name VARCHAR(255) NOT NULL COMMENT 'Stored filename on disk (under files/)',
  original_file_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL COMMENT 'Relative path from docs-pickup root',
  agent_path VARCHAR(500) NOT NULL,
  description TEXT NULL,
  status ENUM(
    'waiting', 'viewed', 'downloaded', 'picked_up', 'archived', 'expired', 'deleted'
  ) NOT NULL DEFAULT 'waiting',
  saved_by_id INT UNSIGNED NULL,
  saved_by_email VARCHAR(255) NULL,
  saved_by_name VARCHAR(255) NULL,
  saved_at DATETIME NOT NULL,
  viewed_at DATETIME NULL,
  viewed_by_id INT UNSIGNED NULL,
  viewed_by_email VARCHAR(255) NULL,
  viewed_by_name VARCHAR(255) NULL,
  downloaded_at DATETIME NULL,
  downloaded_by_id INT UNSIGNED NULL,
  downloaded_by_email VARCHAR(255) NULL,
  downloaded_by_name VARCHAR(255) NULL,
  download_count INT UNSIGNED NOT NULL DEFAULT 0,
  picked_up_at DATETIME NULL,
  picked_up_by_id INT UNSIGNED NULL,
  picked_up_by_email VARCHAR(255) NULL,
  picked_up_by_name VARCHAR(255) NULL,
  archived_at DATETIME NULL,
  archived_by_id INT UNSIGNED NULL,
  archived_by_email VARCHAR(255) NULL,
  archived_by_name VARCHAR(255) NULL,
  deleted_at DATETIME NULL,
  deleted_by_id INT UNSIGNED NULL,
  deleted_by_email VARCHAR(255) NULL,
  deleted_by_name VARCHAR(255) NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  mime_type VARCHAR(127) NULL,
  sha256 CHAR(64) NULL,
  notes TEXT NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_path (storage_path),
  INDEX idx_status (status),
  INDEX idx_saved_at (saved_at),
  INDEX idx_picked_up_at (picked_up_at),
  INDEX idx_archived_at (archived_at),
  INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OM Docs Pickup — agent-to-human document handoff queue';

CREATE TABLE IF NOT EXISTS docs_pickup_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_id VARCHAR(36) NOT NULL,
  event_type ENUM(
    'file_registered', 'viewed', 'downloaded', 'picked_up',
    'archived', 'restored', 'deleted', 'note_added'
  ) NOT NULL,
  actor_id INT UNSIGNED NULL,
  actor_email VARCHAR(255) NULL,
  actor_name VARCHAR(255) NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_file_id (file_id),
  INDEX idx_event_type (event_type),
  INDEX idx_created_at (created_at),
  CONSTRAINT fk_docs_pickup_audit_file
    FOREIGN KEY (file_id) REFERENCES docs_pickup_files (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit trail for docs pickup lifecycle actions';
