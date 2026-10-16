-- OCR worker concurrency — 2026-08-18
-- Safe to re-run: INSERT IGNORE.

INSERT IGNORE INTO settings_registry (`key`, `type`, category, default_value, description)
VALUES
  ('ocr.worker.concurrency', 'number', 'ocr', '2', 'How many claimed OCR jobs to process in parallel (1-4). Env OCR_WORKER_CONCURRENCY overrides.');
