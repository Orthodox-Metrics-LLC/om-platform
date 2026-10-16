-- OM Assets Library Phase 1 — internal scope, visibility, collections, audit
-- Scopes: public, church, site, internal
-- Visibility: public, authenticated, internal_only

-- ─── Collections ───
CREATE TABLE IF NOT EXISTS asset_collections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description TEXT NULL,
  scope ENUM('public','church','site','internal') NOT NULL DEFAULT 'public',
  visibility ENUM('public','authenticated','internal_only') NOT NULL DEFAULT 'authenticated',
  category VARCHAR(64) NULL,
  folder VARCHAR(512) NULL,
  source_type ENUM('upload','import','legacy','generated','screenshot','promote_copy') NOT NULL DEFAULT 'upload',
  owner_system ENUM('om','omai','omstudio','omworkshop','ombrain','certificate_studio','public_website') NOT NULL DEFAULT 'om',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  metadata_json JSON NULL,
  UNIQUE KEY uq_asset_collections_slug (slug),
  INDEX idx_ac_scope (scope),
  INDEX idx_ac_visibility (visibility),
  INDEX idx_ac_owner (owner_system)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Audit events ───
CREATE TABLE IF NOT EXISTS om_asset_audit_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  asset_id INT NULL,
  collection_id INT NULL,
  actor_user_id INT NULL,
  actor_email VARCHAR(255) NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_oaa_asset (asset_id),
  INDEX idx_oaa_collection (collection_id),
  INDEX idx_oaa_event (event_type),
  INDEX idx_oaa_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Extend om_assets scope enum ───
ALTER TABLE om_assets
  MODIFY COLUMN scope ENUM('public','church','site','internal') NOT NULL DEFAULT 'public';

-- ─── New metadata columns on om_assets ───
ALTER TABLE om_assets
  ADD COLUMN IF NOT EXISTS visibility ENUM('public','authenticated','internal_only') NOT NULL DEFAULT 'public' AFTER scope,
  ADD COLUMN IF NOT EXISTS collection_id INT NULL AFTER visibility,
  ADD COLUMN IF NOT EXISTS folder VARCHAR(512) NULL AFTER collection_id,
  ADD COLUMN IF NOT EXISTS source_type ENUM('upload','import','legacy','generated','screenshot','promote_copy') NOT NULL DEFAULT 'upload' AFTER folder,
  ADD COLUMN IF NOT EXISTS owner_system ENUM('om','omai','omstudio','omworkshop','ombrain','certificate_studio','public_website') NOT NULL DEFAULT 'om' AFTER source_type,
  ADD COLUMN IF NOT EXISTS title VARCHAR(255) NULL AFTER name,
  ADD COLUMN IF NOT EXISTS description TEXT NULL AFTER title,
  ADD COLUMN IF NOT EXISTS alt_text VARCHAR(512) NULL AFTER description,
  ADD COLUMN IF NOT EXISTS caption TEXT NULL AFTER alt_text,
  ADD COLUMN IF NOT EXISTS credit VARCHAR(255) NULL AFTER caption,
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(128) NULL AFTER file_type,
  ADD COLUMN IF NOT EXISTS checksum_sha256 CHAR(64) NULL AFTER sha256,
  ADD COLUMN IF NOT EXISTS storage_path VARCHAR(512) NULL COMMENT 'Logical /assets/{scope}/ path' AFTER file_path,
  ADD COLUMN IF NOT EXISTS public_url VARCHAR(512) NULL AFTER storage_path,
  ADD COLUMN IF NOT EXISTS internal_url VARCHAR(512) NULL AFTER public_url,
  ADD COLUMN IF NOT EXISTS created_by INT NULL AFTER uploaded_by;

CREATE INDEX IF NOT EXISTS idx_om_assets_visibility ON om_assets (visibility);
CREATE INDEX IF NOT EXISTS idx_om_assets_collection ON om_assets (collection_id);
CREATE INDEX IF NOT EXISTS idx_om_assets_folder ON om_assets (folder(191));

-- FK (idempotent via information_schema check in JS runner if needed)
-- ALTER TABLE om_assets ADD CONSTRAINT fk_om_assets_collection FOREIGN KEY (collection_id) REFERENCES asset_collections(id) ON DELETE SET NULL;

-- ─── Backfill visibility from scope ───
UPDATE om_assets SET visibility = 'public' WHERE scope = 'public' AND visibility IS NULL;
UPDATE om_assets SET visibility = 'authenticated' WHERE scope = 'church' AND (visibility = 'public' OR visibility IS NULL);
UPDATE om_assets SET visibility = 'internal_only' WHERE scope = 'site' AND visibility = 'public';
UPDATE om_assets SET visibility = 'internal_only' WHERE scope = 'internal';

-- Backfill folder from metadata_json.directory
UPDATE om_assets
SET folder = JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.directory'))
WHERE folder IS NULL
  AND JSON_EXTRACT(metadata_json, '$.directory') IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.directory')) != '';

-- Sync checksum_sha256 from sha256
UPDATE om_assets SET checksum_sha256 = sha256 WHERE checksum_sha256 IS NULL AND sha256 IS NOT NULL;

-- Sync mime_type from file_type
UPDATE om_assets SET mime_type = file_type WHERE mime_type IS NULL AND file_type IS NOT NULL;

-- Sync created_by from uploaded_by
UPDATE om_assets SET created_by = uploaded_by WHERE created_by IS NULL AND uploaded_by IS NOT NULL;

-- Logical storage_path backfill
UPDATE om_assets
SET storage_path = CONCAT(
  'assets/',
  scope,
  '/',
  SUBSTRING_INDEX(file_path, '/', -1)
)
WHERE storage_path IS NULL AND file_path IS NOT NULL AND file_path != '';

-- ─── Seed collections ───
INSERT IGNORE INTO asset_collections (name, slug, description, scope, visibility, category, folder, source_type, owner_system, metadata_json)
VALUES
  ('Orthodox Metrics Logos', 'om-logos', 'Official OM brand logos and wordmarks', 'site', 'authenticated', 'logo', 'branding/logos', 'upload', 'om', JSON_OBJECT('seed', true)),
  ('Public Website Graphics', 'public-website-graphics', 'Marketing and public-site imagery', 'public', 'public', 'content', 'website', 'upload', 'public_website', JSON_OBJECT('seed', true)),
  ('OM Internal Screenshots', 'om-internal-screenshots', 'Staff reference screenshots — not for public distribution', 'internal', 'internal_only', 'content', 'screenshots', 'screenshot', 'om', JSON_OBJECT('seed', true)),
  ('OM Workshop References', 'om-workshop-references', 'OM Workshop design references for staff', 'internal', 'internal_only', 'content', 'workshop', 'import', 'omworkshop', JSON_OBJECT('seed', true)),
  ('OMBrain Visual Assets', 'ombrain-visual-assets', 'OMBrain diagrams and visual references', 'internal', 'internal_only', 'content', 'ombrain', 'generated', 'ombrain', JSON_OBJECT('seed', true)),
  ('Certificate Studio Templates', 'certificate-studio-templates', 'Certificate layout templates and artwork', 'site', 'authenticated', 'template', 'certificates', 'legacy', 'certificate_studio', JSON_OBJECT('seed', true));
