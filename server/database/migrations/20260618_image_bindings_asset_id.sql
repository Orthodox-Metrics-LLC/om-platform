-- PR7 — Link gallery page bindings to om_assets rows

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'image_bindings'
    AND column_name = 'asset_id'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE image_bindings ADD COLUMN asset_id INT NULL COMMENT ''FK to om_assets.id when path is registered'' AFTER image_path',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'image_bindings'
    AND index_name = 'idx_image_bindings_asset_id'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_image_bindings_asset_id ON image_bindings (asset_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE image_bindings ib
INNER JOIN om_assets a ON a.status = 'active'
  AND (
    (a.legacy_source = 'public_images' AND a.legacy_id COLLATE utf8mb4_unicode_ci = ib.image_path COLLATE utf8mb4_unicode_ci)
    OR JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.legacy_url')) COLLATE utf8mb4_unicode_ci = ib.image_path COLLATE utf8mb4_unicode_ci
    OR (a.legacy_source = 'global_images' AND a.legacy_id COLLATE utf8mb4_unicode_ci = ib.image_path COLLATE utf8mb4_unicode_ci)
    OR (a.legacy_source = 'church_custom_library' AND a.legacy_id COLLATE utf8mb4_unicode_ci = ib.image_path COLLATE utf8mb4_unicode_ci)
    OR (a.legacy_source = 'church_branding' AND JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.legacy_url')) COLLATE utf8mb4_unicode_ci = ib.image_path COLLATE utf8mb4_unicode_ci)
  )
SET ib.asset_id = a.id
WHERE ib.asset_id IS NULL;
