-- Migration: add 'quarantine' source_type and 'flagged' category to om_assets
--
-- Additive only: existing enum values/rows are untouched. Supports the new
-- orphan-file quarantine flow — files found on disk with no corresponding
-- om_assets row get registered with source_type='quarantine',
-- category='flagged', scope='internal' (view/delete only, no scope change).

ALTER TABLE om_assets
  MODIFY COLUMN source_type ENUM(
    'upload', 'import', 'legacy', 'generated', 'screenshot', 'promote_copy', 'quarantine'
  ) NOT NULL DEFAULT 'upload';

ALTER TABLE om_assets
  MODIFY COLUMN category ENUM(
    'layout', 'border', 'cross', 'seal', 'header', 'background',
    'icon', 'watermark', 'signature', 'font', 'divider', 'branding',
    'logo', 'content', 'template',
    'diagram', 'infrastructure', 'ui_reference', 'screenshot', 'church_photo',
    'clergy', 'certificate', 'map', 'document_scan', 'marketing', 'social_media', 'misc',
    'document', 'flagged'
  ) NOT NULL;
