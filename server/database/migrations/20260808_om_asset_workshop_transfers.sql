-- OM Asset Manager → Workshop transfer receipts
-- Apply against orthodoxmetrics_db.

CREATE TABLE IF NOT EXISTS om_asset_workshop_transfers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_id BIGINT UNSIGNED NOT NULL,
  actor_user_id INT NULL,
  destination_type ENUM('inbox', 'workspace') NOT NULL DEFAULT 'inbox',
  workshop_site_id VARCHAR(96) NULL,
  workshop_revision_id VARCHAR(96) NULL,
  workshop_import_id BIGINT UNSIGNED NULL,
  source_sha256 CHAR(64) NULL,
  status ENUM('sent', 'failed', 'partial') NOT NULL DEFAULT 'sent',
  error_message VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_om_asset_ws_xfer_asset (asset_id),
  KEY idx_om_asset_ws_xfer_actor (actor_user_id),
  KEY idx_om_asset_ws_xfer_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
