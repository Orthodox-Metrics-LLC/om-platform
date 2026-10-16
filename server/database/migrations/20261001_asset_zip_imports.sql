-- Asset Manager ZIP image imports (platform database only).
-- Tracks analysis/preview and final import reports without storing archive bytes
-- in MariaDB. Temporary ZIP files are removed after completion or failure.

CREATE TABLE IF NOT EXISTS om_asset_zip_imports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  import_token CHAR(36) NOT NULL UNIQUE,
  archive_filename VARCHAR(255) NOT NULL,
  archive_slug VARCHAR(160) NOT NULL,
  scope ENUM('public','church','site','internal') NOT NULL,
  church_id INT NULL,
  category VARCHAR(64) NOT NULL,
  folder VARCHAR(500) NULL,
  naming_strategy ENUM('smart','sequential','preserve') NOT NULL DEFAULT 'smart',
  status ENUM('analyzed','importing','completed','partial','failed','expired') NOT NULL DEFAULT 'analyzed',
  total_entries INT NOT NULL DEFAULT 0,
  imported_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  manifest_json JSON NOT NULL,
  report_json JSON NULL,
  temp_path VARCHAR(1000) NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_asset_zip_import_status (status, created_at),
  INDEX idx_asset_zip_import_actor (created_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
