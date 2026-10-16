-- Page Builder: let latest_news_media reference an Asset Manager asset
-- directly (om_assets.id) instead of only a bare file_url, so media picked
-- from /dashboard/asset-manager stays traceable to its source asset.
-- Additive, no FK to om_assets (cross-concern table owned by a different
-- route module) — nullable reference only.

ALTER TABLE latest_news_media
  ADD COLUMN IF NOT EXISTS om_asset_id INT NULL AFTER file_url;

ALTER TABLE latest_news_media
  ADD INDEX IF NOT EXISTS idx_lnm_om_asset (om_asset_id);
