-- OM Assets Library PR3 — legacy import support index
-- Idempotent imports keyed by legacy_source + legacy_id

-- MariaDB 10.5+ supports IF NOT EXISTS on indexes in some versions; use procedure-safe pattern
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'om_assets'
    AND index_name = 'uq_om_assets_legacy'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE UNIQUE INDEX uq_om_assets_legacy ON om_assets (legacy_source, legacy_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
