-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 2026-06-27_auto_pipeline.sql
-- Purpose:   Add auto-pipeline tracking column to ocr_jobs and ensure
--            ocr_settings table exists for per-church pipeline configuration.
--
-- Apply on:  orthodoxmetrics_db (platform DB)
-- Safe to re-run: yes (all statements are idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

USE orthodoxmetrics_db;

-- 1. Add auto_pipeline_status to ocr_jobs
--    Values: NULL (not started) | 'running' | 'complete' | 'partial' |
--            'held' | 'ocr_timeout' | 'error'
ALTER TABLE ocr_jobs
  ADD COLUMN IF NOT EXISTS auto_pipeline_status VARCHAR(32) NULL
    COMMENT 'Autonomous pipeline state: NULL=not started, complete, partial, held, error';

-- 2. Add index for efficient queue queries
--    (find jobs that are OCR-complete but not yet pipeline-processed)
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_auto_pipeline
  ON ocr_jobs (church_id, status, auto_pipeline_status, seeded_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Per-tenant ocr_settings table
-- This is created in each tenant DB (church_<id>_db), not the platform DB.
-- The application code calls getTenantPool(churchId) to reach it.
-- Run this block for each tenant DB that needs auto-pipeline settings.
-- ─────────────────────────────────────────────────────────────────────────────

-- Template — replace `church_1_db` with the actual tenant DB name:
--
-- USE church_1_db;
--
-- CREATE TABLE IF NOT EXISTS ocr_settings (
--   id           INT AUTO_INCREMENT PRIMARY KEY,
--   church_id    INT NOT NULL,
--   settings_json LONGTEXT NOT NULL DEFAULT '{}',
--   created_at   DATETIME NOT NULL DEFAULT NOW(),
--   updated_at   DATETIME NOT NULL DEFAULT NOW() ON UPDATE NOW(),
--   UNIQUE KEY uq_church (church_id)
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--
-- -- Seed default settings (auto-pipeline disabled by default)
-- INSERT IGNORE INTO ocr_settings (church_id, settings_json)
-- VALUES (1, JSON_OBJECT(
--   'autoPipeline', JSON_OBJECT(
--     'enabled',         false,
--     'minConfidence',   0.82,
--     'minPageScore',    0.70,
--     'requireTemplate', true,
--     'maxOcrWaitMs',    300000,
--     'pollIntervalMs',  3000
--   )
-- ));

-- ─────────────────────────────────────────────────────────────────────────────
-- Enable auto-pipeline for a specific church (run after confirming readiness)
-- ─────────────────────────────────────────────────────────────────────────────

-- USE church_1_db;
-- UPDATE ocr_settings
-- SET settings_json = JSON_SET(
--   COALESCE(settings_json, '{}'),
--   '$.autoPipeline.enabled', true
-- )
-- WHERE church_id = 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification queries
-- ─────────────────────────────────────────────────────────────────────────────

-- Confirm column exists:
-- SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
-- FROM information_schema.COLUMNS
-- WHERE TABLE_SCHEMA = 'orthodoxmetrics_db'
--   AND TABLE_NAME = 'ocr_jobs'
--   AND COLUMN_NAME = 'auto_pipeline_status';

-- Check pipeline status distribution:
-- SELECT auto_pipeline_status, COUNT(*) AS cnt
-- FROM ocr_jobs
-- GROUP BY auto_pipeline_status
-- ORDER BY cnt DESC;
