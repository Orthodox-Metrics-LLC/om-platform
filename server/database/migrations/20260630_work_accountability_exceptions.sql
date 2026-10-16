-- Work Accountability Command Center — exception review / snooze state
-- Platform DB: orthodoxmetrics_db

USE orthodoxmetrics_db;

CREATE TABLE IF NOT EXISTS work_accountability_exception_reviews (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  exception_id VARCHAR(128) NOT NULL COMMENT 'Stable hash from aggregator',
  exception_type VARCHAR(64) NOT NULL,
  status ENUM('open', 'reviewed', 'snoozed') NOT NULL DEFAULT 'open',
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  snooze_until DATETIME NULL,
  note TEXT NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wa_exception_id (exception_id),
  KEY idx_wa_exception_status (status),
  KEY idx_wa_exception_type (exception_type),
  KEY idx_wa_exception_snooze (snooze_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
