-- Migration: 2026-06-30 — OM Docs Dropbox staging, classification, promotion, revisions
-- Applied to: orthodoxmetrics_db

CREATE TABLE IF NOT EXISTS docs_dropbox_files (
  id VARCHAR(36) NOT NULL,
  file_name VARCHAR(255) NOT NULL COMMENT 'Stored filename on disk',
  original_file_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL COMMENT 'Relative path from docs-dropbox root',
  edited_storage_path VARCHAR(500) NULL COMMENT 'Edited working copy if different from original',
  agent_path VARCHAR(500) NOT NULL,
  edited_agent_path VARCHAR(500) NULL,
  title VARCHAR(500) NULL,
  description TEXT NULL,
  doc_type ENUM(
    'guide', 'reference', 'runbook', 'policy', 'architecture', 'api', 'release_notes', 'other'
  ) NULL,
  target_visibility ENUM('public', 'internal') NULL,
  target_docs_location VARCHAR(255) NULL COMMENT 'Section folder under docs/ or docs/internal/',
  target_slug VARCHAR(255) NULL,
  target_path VARCHAR(500) NULL COMMENT 'Full relative path e.g. docs/internal/foo/bar.md',
  owner VARCHAR(255) NULL,
  tags JSON NULL,
  status ENUM(
    'uploaded', 'reviewed', 'edited', 'ready_for_public_docs', 'ready_for_internal_docs',
    'promoted', 'rejected', 'archived'
  ) NOT NULL DEFAULT 'uploaded',
  notes TEXT NULL,
  uploaded_by_id INT UNSIGNED NULL,
  uploaded_by_email VARCHAR(255) NULL,
  uploaded_by_name VARCHAR(255) NULL,
  uploaded_at DATETIME NOT NULL,
  edited_at DATETIME NULL,
  edited_by_id INT UNSIGNED NULL,
  edited_by_email VARCHAR(255) NULL,
  edited_by_name VARCHAR(255) NULL,
  reviewed_at DATETIME NULL,
  reviewed_by_id INT UNSIGNED NULL,
  reviewed_by_email VARCHAR(255) NULL,
  reviewed_by_name VARCHAR(255) NULL,
  ready_at DATETIME NULL,
  ready_by_id INT UNSIGNED NULL,
  ready_by_email VARCHAR(255) NULL,
  ready_by_name VARCHAR(255) NULL,
  promoted_at DATETIME NULL,
  promoted_by_id INT UNSIGNED NULL,
  promoted_by_email VARCHAR(255) NULL,
  promoted_by_name VARCHAR(255) NULL,
  promoted_path VARCHAR(500) NULL COMMENT 'Final path in om-docs repo',
  rejected_at DATETIME NULL,
  rejected_by_id INT UNSIGNED NULL,
  rejected_by_email VARCHAR(255) NULL,
  rejected_by_name VARCHAR(255) NULL,
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
  revision_count INT UNSIGNED NOT NULL DEFAULT 0,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_path (storage_path),
  INDEX idx_status (status),
  INDEX idx_target_visibility (target_visibility),
  INDEX idx_uploaded_at (uploaded_at),
  INDEX idx_edited_at (edited_at),
  INDEX idx_promoted_at (promoted_at),
  INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OM Docs Dropbox — inbound document staging for review and promotion';

CREATE TABLE IF NOT EXISTS docs_dropbox_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_id VARCHAR(36) NOT NULL,
  revision_number INT UNSIGNED NOT NULL,
  content MEDIUMTEXT NOT NULL,
  content_sha256 CHAR(64) NULL,
  backup_path VARCHAR(500) NULL COMMENT 'Relative .rev-NNN.md path on disk',
  edited_by_id INT UNSIGNED NULL,
  edited_by_email VARCHAR(255) NULL,
  edited_by_name VARCHAR(255) NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_file_revision (file_id, revision_number),
  INDEX idx_file_id (file_id),
  CONSTRAINT fk_docs_dropbox_revision_file
    FOREIGN KEY (file_id) REFERENCES docs_dropbox_files (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Revision history for docs dropbox markdown edits';

CREATE TABLE IF NOT EXISTS docs_dropbox_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_id VARCHAR(36) NOT NULL,
  event_type ENUM(
    'upload', 'preview', 'edit', 'metadata_update', 'frontmatter_update',
    'marked_ready_public', 'marked_ready_internal', 'promote', 'archive',
    'reject', 'delete', 'secret_block', 'super_admin_override', 'reviewed'
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
  CONSTRAINT fk_docs_dropbox_audit_file
    FOREIGN KEY (file_id) REFERENCES docs_dropbox_files (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit trail for docs dropbox lifecycle actions';
