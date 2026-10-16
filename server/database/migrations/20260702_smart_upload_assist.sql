-- Smart Upload Assist — OM Asset Library
-- Adds provenance / smart-classification columns to om_assets and expands the
-- category taxonomy. Idempotent: safe to re-run; preserves existing records.

-- ─── Expand category taxonomy ───
-- Keep every legacy value; append the Smart Upload Assist taxonomy.
ALTER TABLE om_assets
  MODIFY COLUMN category ENUM(
    'layout','border','cross','seal','header','background','icon','watermark',
    'signature','font','divider','branding','logo','content','template',
    'diagram','infrastructure','ui_reference','screenshot','church_photo',
    'clergy','certificate','map','document_scan','marketing','social_media','misc'
  ) NOT NULL;

ALTER TABLE asset_collections
  MODIFY COLUMN category VARCHAR(64) NULL;

-- ─── Provenance / smart-classification columns ───
ALTER TABLE om_assets
  ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255) NULL AFTER name,
  ADD COLUMN IF NOT EXISTS stored_filename VARCHAR(255) NULL AFTER original_filename,
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(255) NULL AFTER stored_filename,
  ADD COLUMN IF NOT EXISTS content_hash CHAR(64) NULL AFTER checksum_sha256,
  ADD COLUMN IF NOT EXISTS smart_rename_applied TINYINT(1) NOT NULL DEFAULT 0 AFTER content_hash,
  ADD COLUMN IF NOT EXISTS smart_metadata_applied TINYINT(1) NOT NULL DEFAULT 0 AFTER smart_rename_applied,
  ADD COLUMN IF NOT EXISTS classification_source ENUM('manual','smart','edited') NOT NULL DEFAULT 'manual' AFTER smart_metadata_applied,
  ADD COLUMN IF NOT EXISTS category_confidence DECIMAL(4,3) NULL AFTER classification_source;

CREATE INDEX IF NOT EXISTS idx_om_assets_content_hash ON om_assets (content_hash);
CREATE INDEX IF NOT EXISTS idx_om_assets_stored_filename ON om_assets (stored_filename(191));
CREATE INDEX IF NOT EXISTS idx_om_assets_classification_source ON om_assets (classification_source);

-- ─── Backfill provenance from existing data (non-destructive) ───
UPDATE om_assets
SET original_filename = SUBSTRING_INDEX(file_path, '/', -1)
WHERE original_filename IS NULL AND file_path IS NOT NULL AND file_path != '';

UPDATE om_assets
SET stored_filename = SUBSTRING_INDEX(file_path, '/', -1)
WHERE stored_filename IS NULL AND file_path IS NOT NULL AND file_path != '';

UPDATE om_assets
SET display_name = COALESCE(NULLIF(title, ''), name)
WHERE display_name IS NULL;

UPDATE om_assets
SET content_hash = COALESCE(checksum_sha256, sha256)
WHERE content_hash IS NULL AND COALESCE(checksum_sha256, sha256) IS NOT NULL;

-- ─── Seed collections referenced by Smart Upload Assist heuristics ───
INSERT IGNORE INTO asset_collections (name, slug, description, scope, visibility, category, folder, source_type, owner_system, metadata_json)
VALUES
  ('Hardware', 'hardware', 'Infrastructure, hardware, and lab reference imagery (staff only)', 'internal', 'internal_only', 'infrastructure', 'infrastructure', 'upload', 'om', JSON_OBJECT('seed', true)),
  ('Mini Server Wall Panel', 'mini-server-wall-panel', 'Mini server wall-panel network lab diagrams and wiring references', 'internal', 'internal_only', 'diagram', 'infrastructure/mini-server-wall-panel', 'upload', 'om', JSON_OBJECT('seed', true));
