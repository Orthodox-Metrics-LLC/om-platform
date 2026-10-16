-- Migration: 2026-07-10 — Short prompt summary for non-previewable dropbox files
-- Applied to: orthodoxmetrics_db

ALTER TABLE docs_dropbox_files
  ADD COLUMN IF NOT EXISTS short_prompt MEDIUMTEXT NULL
    COMMENT 'Operator summary for files without inline preview (docx, pdf, etc.)'
    AFTER prompt_text;
