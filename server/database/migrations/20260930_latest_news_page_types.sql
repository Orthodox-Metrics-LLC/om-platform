-- Page Builder (superadmin/admin) — generalizes the Latest News Campaign
-- Builder to author additional public-site page types (coming_soon,
-- maintenance, error_404, error_403, error_500) from the same
-- campaign/item/media tables, plus draft/publish version history.
--
-- Additive only: existing rows default to page_type='latest_news' and keep
-- working exactly as before for the current /admin/latest-news → /latest-news
-- flow.

ALTER TABLE latest_news_campaigns
  ADD COLUMN IF NOT EXISTS page_type ENUM(
    'latest_news', 'coming_soon', 'maintenance', 'error_404', 'error_403', 'error_500'
  ) NOT NULL DEFAULT 'latest_news' AFTER slug,
  ADD COLUMN IF NOT EXISTS published_version_id INT NULL AFTER page_type;

ALTER TABLE latest_news_campaigns
  ADD INDEX IF NOT EXISTS idx_lnc_page_type_status (page_type, status, display_priority DESC, id DESC);

-- ── Version history (save draft / publish) ──────────────────────────
-- Each save-draft or publish action snapshots the full campaign + items +
-- media as JSON. Publishing a version sets campaigns.published_version_id
-- so the public read path can render exactly what was published, independent
-- of any in-progress draft editing.
CREATE TABLE IF NOT EXISTS latest_news_page_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  label VARCHAR(255) NULL,
  snapshot JSON NOT NULL,
  status ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME NULL,
  INDEX idx_lnpv_campaign (campaign_id, created_at DESC),
  CONSTRAINT fk_lnpv_campaign FOREIGN KEY (campaign_id) REFERENCES latest_news_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FK added without IF NOT EXISTS (not reliably supported for constraints);
-- the runner script skips ER_DUP_KEYNAME/ER_FK_DUP_NAME on re-run.
ALTER TABLE latest_news_campaigns
  ADD CONSTRAINT fk_lnc_published_version FOREIGN KEY (published_version_id)
    REFERENCES latest_news_page_versions(id) ON DELETE SET NULL;
