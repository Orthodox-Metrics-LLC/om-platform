-- OM Assets Library — file size for sorting + sha256 index for duplicate detection

ALTER TABLE om_assets
  ADD COLUMN IF NOT EXISTS file_size BIGINT NULL COMMENT 'Bytes on disk' AFTER height;

CREATE INDEX IF NOT EXISTS idx_om_assets_sha256 ON om_assets (sha256);
