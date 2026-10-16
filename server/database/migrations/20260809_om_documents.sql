-- Migration: 2026-08-09 — OM Documents (plans-backed document exchange)
-- Applied to: orthodoxmetrics_db
-- Replaces Dropbox/Pickup as the operator-facing document model.
-- Legacy docs_dropbox_* / docs_pickup_* tables are retained read-only during migration.

CREATE TABLE IF NOT EXISTS om_documents (
  id VARCHAR(36) NOT NULL COMMENT 'Internal UUID primary key',
  document_id VARCHAR(32) NOT NULL COMMENT 'Operator-facing OMDOC-YYYYMMDD-XXXXXX',
  title VARCHAR(500) NOT NULL,
  description TEXT NULL,
  source ENUM('HUMAN','OMDEV','WORKSHOP','OPS','SYSTEM') NOT NULL DEFAULT 'HUMAN',
  producer ENUM('manual','omdev','om-workshop','omai-ops01') NOT NULL DEFAULT 'manual',
  lifecycle ENUM(
    'inbox','working','review','approved','published','archived','quarantined'
  ) NOT NULL DEFAULT 'inbox',
  physical_path VARCHAR(1000) NOT NULL COMMENT 'Absolute path under plans root',
  relative_path VARCHAR(1000) NOT NULL COMMENT 'Path relative to plans root',
  primary_file VARCHAR(255) NOT NULL,
  horizon VARCHAR(64) NULL COMMENT 'Working horizon folder when lifecycle=working',
  mime_type VARCHAR(127) NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sha256 CHAR(64) NULL,
  parent_document_id VARCHAR(32) NULL COMMENT 'Related OMDOC-* parent',
  related_dispatch_id VARCHAR(36) NULL,
  work_packet_id VARCHAR(32) NULL,
  created_by_id INT UNSIGNED NULL,
  created_by_email VARCHAR(255) NULL,
  created_by_name VARCHAR(255) NULL,
  updated_by_id INT UNSIGNED NULL,
  updated_by_email VARCHAR(255) NULL,
  updated_by_name VARCHAR(255) NULL,
  viewed_at DATETIME NULL,
  viewed_by_id INT UNSIGNED NULL,
  viewed_by_email VARCHAR(255) NULL,
  viewed_by_name VARCHAR(255) NULL,
  downloaded_at DATETIME NULL,
  downloaded_by_id INT UNSIGNED NULL,
  downloaded_by_email VARCHAR(255) NULL,
  downloaded_by_name VARCHAR(255) NULL,
  edited_at DATETIME NULL,
  edited_by_id INT UNSIGNED NULL,
  edited_by_email VARCHAR(255) NULL,
  edited_by_name VARCHAR(255) NULL,
  deleted_at DATETIME NULL,
  deleted_by_id INT UNSIGNED NULL,
  deleted_by_email VARCHAR(255) NULL,
  deleted_by_name VARCHAR(255) NULL,
  quarantine_reason TEXT NULL,
  legacy_json JSON NULL COMMENT 'Legacy dropbox/pickup ids and metadata',
  metadata_json JSON NULL,
  filing_state ENUM(
    'none','filing_requested','approval_pending','approved_waiting_to_file',
    'rejected','filed','failed'
  ) NOT NULL DEFAULT 'none',
  filing_receipt VARCHAR(16) NULL,
  proposed_category VARCHAR(64) NULL,
  proposed_target_docs_path VARCHAR(500) NULL,
  filed_docs_path VARCHAR(500) NULL,
  filed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_om_documents_document_id (document_id),
  UNIQUE KEY uq_om_documents_relative_path (relative_path),
  INDEX idx_om_documents_lifecycle (lifecycle),
  INDEX idx_om_documents_source (source),
  INDEX idx_om_documents_producer (producer),
  INDEX idx_om_documents_parent (parent_document_id),
  INDEX idx_om_documents_updated (updated_at),
  INDEX idx_om_documents_filing (filing_state),
  INDEX idx_om_documents_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OM Documents — plans-backed document exchange metadata';

CREATE TABLE IF NOT EXISTS om_document_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id VARCHAR(32) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_id INT UNSIGNED NULL,
  actor_email VARCHAR(255) NULL,
  actor_name VARCHAR(255) NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_om_doc_audit_document (document_id),
  INDEX idx_om_doc_audit_type (event_type),
  INDEX idx_om_doc_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit trail for OM Documents (viewed/downloaded/edited/moved/filing/etc)';

CREATE TABLE IF NOT EXISTS om_document_filing_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  receipt VARCHAR(16) NOT NULL,
  document_id VARCHAR(32) NOT NULL,
  title VARCHAR(500) NOT NULL,
  source_filename VARCHAR(255) NULL,
  proposed_target_path VARCHAR(500) NOT NULL,
  category VARCHAR(64) NOT NULL,
  visibility VARCHAR(32) NOT NULL DEFAULT 'internal',
  requesting_actor_email VARCHAR(255) NULL,
  requesting_actor_name VARCHAR(255) NULL,
  request_source VARCHAR(64) NOT NULL DEFAULT 'om_documents_ui',
  reason TEXT NULL,
  status ENUM(
    'filing_requested','approval_pending','approved_waiting_to_file',
    'rejected','filed','failed'
  ) NOT NULL DEFAULT 'filing_requested',
  omstudio_ref VARCHAR(128) NULL,
  checksum CHAR(64) NULL,
  decision_note TEXT NULL,
  decided_by_email VARCHAR(255) NULL,
  decided_by_name VARCHAR(255) NULL,
  decided_at DATETIME NULL,
  filed_docs_path VARCHAR(500) NULL,
  filed_at DATETIME NULL,
  filed_by_email VARCHAR(255) NULL,
  filed_by_name VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_om_doc_filing_receipt (receipt),
  INDEX idx_om_doc_filing_document (document_id),
  INDEX idx_om_doc_filing_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Governed OM Docs filing requests for OM Documents';

-- Note: legacy docs_pickup_filing_requests retained unchanged.
-- New filing uses om_document_filing_requests. Dual-key linking is via
-- om_documents.legacy_json and om_document_filing_requests.document_id.
