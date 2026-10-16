-- Migration: Persist parish upload batch metadata (name, P1->P2 review readiness gate)
-- Date: 2026-08-28
-- Lives in orthodoxmetrics_db (platform DB) alongside ocr_jobs.

CREATE TABLE IF NOT EXISTS ocr_upload_batches (
  batch_id VARCHAR(64) NOT NULL,
  church_id INT NOT NULL,
  name VARCHAR(255) NULL COMMENT 'User-assigned human-readable batch name (e.g. "October Funeral Records")',
  ready_for_image_review TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Explicit P1->P2 gate: user has confirmed the batch is ready for Image Review',
  ready_by_user_id INT NULL COMMENT 'User who marked the batch ready for Image Review',
  ready_by_name VARCHAR(255) NULL COMMENT 'Display name/email of who marked it ready, for audit history',
  ready_at TIMESTAMP NULL COMMENT 'When the batch was marked ready for Image Review',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (batch_id),
  INDEX idx_church (church_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
