-- Add 'document' category to om_assets.category (OMOD-2927 — Documents Manager).
-- Distinct from 'document_scan' (OCR'd historical record scans): standalone
-- document files (interactive HTML guides, Office docs, archives, etc).
-- Idempotent: MODIFY COLUMN is safe to re-run.

ALTER TABLE om_assets
  MODIFY COLUMN category ENUM(
    'layout','border','cross','seal','header','background',
    'icon','watermark','signature','font','divider','branding',
    'logo','content','template',
    'diagram','infrastructure','ui_reference','screenshot','church_photo',
    'clergy','certificate','map','document_scan','marketing','social_media','misc',
    'document'
  ) NOT NULL;
