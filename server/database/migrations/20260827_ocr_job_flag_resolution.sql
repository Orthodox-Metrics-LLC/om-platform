-- Migration: OCR image review — preset flag reasons + resolution workflow
-- Date: 2026-08-27
--
-- Backs the "Flag Image" reason picker and the resulting resolution step
-- (Replace / Fix / Discard / Keep & Continue) on the parish image review
-- page (PortalOcrImageReviewPage). Lives on ocr_jobs (platform DB,
-- orthodoxmetrics_db) since each row already represents one page image.

ALTER TABLE ocr_jobs
  ADD COLUMN IF NOT EXISTS flag_reasons JSON NULL
    COMMENT 'Array of preset reason keys: poor_quality, crop_orientation, duplicate, not_a_record, other'
    AFTER review_status,
  ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMP NULL COMMENT 'When a reviewer flagged this page' AFTER flag_reasons,
  ADD COLUMN IF NOT EXISTS flagged_by INT NULL COMMENT 'User id who flagged this page' AFTER flagged_at,
  ADD COLUMN IF NOT EXISTS flag_resolution ENUM('replace', 'fix', 'discard', 'keep') NULL
    COMMENT 'How the flag was resolved' AFTER flagged_by,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP NULL COMMENT 'When the flag was resolved' AFTER flag_resolution,
  ADD COLUMN IF NOT EXISTS resolved_by INT NULL COMMENT 'User id who resolved the flag' AFTER resolved_at,
  ADD COLUMN IF NOT EXISTS excluded_from_processing TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = discarded or superseded by a replacement; excluded from downstream processing but row kept for audit'
    AFTER resolved_by,
  ADD COLUMN IF NOT EXISTS replaced_by_job_id INT NULL
    COMMENT 'On a superseded job: the id of the new ocr_jobs row uploaded via Replace Image' AFTER excluded_from_processing,
  ADD COLUMN IF NOT EXISTS fix_applied_json JSON NULL
    COMMENT 'Audit of the transform applied via Fix Image, e.g. {"rotate":90,"crop":{"x":0,"y":0,"width":800,"height":600}}'
    AFTER replaced_by_job_id;

ALTER TABLE ocr_jobs
  ADD INDEX IF NOT EXISTS idx_ocr_jobs_flag_resolution (flag_resolution),
  ADD INDEX IF NOT EXISTS idx_ocr_jobs_excluded_from_processing (excluded_from_processing);
