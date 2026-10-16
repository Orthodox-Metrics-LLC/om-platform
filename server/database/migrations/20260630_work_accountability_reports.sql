-- Work Accountability Analytics & Reporting — persisted report runs
-- Platform DB: orthodoxmetrics_db

USE orthodoxmetrics_db;

CREATE TABLE IF NOT EXISTS work_accountability_reports (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  period_key VARCHAR(32) NOT NULL COMMENT '30d|60d|90d|6m|1y|custom:from:to',
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  generated_by INT UNSIGNED NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  format ENUM('json', 'md', 'csv', 'email') NOT NULL DEFAULT 'json',
  status ENUM('pending', 'completed', 'failed', 'queued') NOT NULL DEFAULT 'completed',
  emailed_to VARCHAR(255) NULL,
  storage_path VARCHAR(512) NULL,
  error_message TEXT NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wa_reports_period (period_key),
  KEY idx_wa_reports_dates (from_date, to_date),
  KEY idx_wa_reports_generated (generated_at),
  KEY idx_wa_reports_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
