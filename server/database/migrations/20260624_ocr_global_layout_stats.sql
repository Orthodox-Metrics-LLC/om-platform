-- Global OCR layout match statistics — platform-wide learning across all churches.
-- Geometry and catalog families are shared; per-church extractors remain overrides only.

CREATE TABLE IF NOT EXISTS ocr_global_layout_stats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  catalog_layout_id VARCHAR(128) NOT NULL,
  record_type ENUM('baptism', 'marriage', 'funeral') NOT NULL,
  match_count INT NOT NULL DEFAULT 0,
  high_confidence_count INT NOT NULL DEFAULT 0,
  last_matched_at DATETIME NULL,
  last_church_id INT NULL,
  candidate_status ENUM('none', 'candidate', 'approved') NOT NULL DEFAULT 'none',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_catalog_record (catalog_layout_id, record_type),
  KEY idx_record_type (record_type),
  KEY idx_candidate_status (candidate_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
