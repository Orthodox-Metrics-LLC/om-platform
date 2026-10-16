-- Latest News Campaign Builder — campaigns, items, media
-- Migrates flat latest_news_items into campaign + item + media rows.

-- ── Campaigns ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS latest_news_campaigns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  status ENUM('draft', 'scheduled', 'live', 'expired', 'archived') NOT NULL DEFAULT 'draft',
  summary VARCHAR(500) NULL,
  visibility_start_at DATETIME NULL,
  visibility_end_at DATETIME NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
  publish_mode ENUM('manual', 'scheduled') NOT NULL DEFAULT 'manual',
  rotation_enabled TINYINT(1) NOT NULL DEFAULT 1,
  rotation_interval_seconds INT NOT NULL DEFAULT 8,
  display_priority INT NOT NULL DEFAULT 0,
  show_on_homepage TINYINT(1) NOT NULL DEFAULT 0,
  show_in_parish_portal TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_lnc_slug (slug),
  INDEX idx_lnc_status_priority (status, display_priority DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Preserve legacy flat items before schema change
CREATE TABLE IF NOT EXISTS latest_news_items_legacy LIKE latest_news_items;

INSERT IGNORE INTO latest_news_items_legacy
SELECT * FROM latest_news_items;

-- Drop flat items table (recreated below with campaign_id)
DROP TABLE IF EXISTS latest_news_items;

-- ── Items (per campaign) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS latest_news_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  subtitle VARCHAR(255) NULL,
  body TEXT NULL,
  excerpt VARCHAR(500) NULL,
  cta_label VARCHAR(100) NULL,
  cta_url VARCHAR(2048) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status ENUM('draft', 'active', 'disabled') NOT NULL DEFAULT 'active',
  layout_type ENUM('hero', 'split', 'card', 'banner', 'quote', 'image_grid', 'video') NOT NULL DEFAULT 'card',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_lni_campaign_sort (campaign_id, sort_order, id),
  CONSTRAINT fk_lni_campaign FOREIGN KEY (campaign_id) REFERENCES latest_news_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Media ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS latest_news_media (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  item_id INT NULL,
  file_url VARCHAR(2048) NOT NULL,
  file_type ENUM('image', 'video', 'document') NOT NULL DEFAULT 'image',
  alt_text VARCHAR(255) NULL,
  caption VARCHAR(500) NULL,
  credit VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lnm_campaign (campaign_id),
  INDEX idx_lnm_item (item_id),
  CONSTRAINT fk_lnm_campaign FOREIGN KEY (campaign_id) REFERENCES latest_news_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_lnm_item FOREIGN KEY (item_id) REFERENCES latest_news_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extend audit log for campaigns
ALTER TABLE latest_news_audit
  ADD COLUMN IF NOT EXISTS campaign_id INT NULL AFTER id,
  ADD INDEX IF NOT EXISTS idx_latest_news_audit_campaign (campaign_id);

-- ── Migrate legacy flat items → campaign + item + media ─────────────
INSERT INTO latest_news_campaigns (
  title, slug, status, summary,
  visibility_start_at, visibility_end_at, timezone, publish_mode,
  rotation_enabled, rotation_interval_seconds, display_priority,
  show_on_homepage, show_in_parish_portal,
  created_by, updated_by, created_at, updated_at
)
SELECT
  l.title,
  l.slug,
  l.status,
  l.summary,
  l.publish_start_at,
  l.publish_end_at,
  l.timezone,
  CASE WHEN l.publish_start_at IS NOT NULL OR l.publish_end_at IS NOT NULL THEN 'scheduled' ELSE 'manual' END,
  l.rotation_enabled,
  GREATEST(3, COALESCE(l.rotation_seconds, 8)),
  CASE WHEN l.featured = 1 THEN 10 ELSE 0 END,
  0,
  0,
  l.created_by,
  l.updated_by,
  l.created_at,
  l.updated_at
FROM latest_news_items_legacy l
WHERE NOT EXISTS (
  SELECT 1 FROM latest_news_campaigns c WHERE c.slug = l.slug
);

INSERT INTO latest_news_items (
  campaign_id, title, subtitle, body, excerpt,
  cta_label, cta_url, sort_order, status, layout_type, active,
  created_at, updated_at
)
SELECT
  c.id,
  l.title,
  NULL,
  l.body,
  l.summary,
  l.cta_label,
  l.cta_url,
  l.sort_order,
  CASE WHEN l.status IN ('live', 'scheduled') THEN 'active' ELSE 'draft' END,
  CASE l.display_type
    WHEN 'hero' THEN 'hero'
    WHEN 'card' THEN 'card'
    ELSE 'card'
  END,
  1,
  l.created_at,
  l.updated_at
FROM latest_news_items_legacy l
INNER JOIN latest_news_campaigns c ON c.slug = l.slug
WHERE NOT EXISTS (
  SELECT 1 FROM latest_news_items i
  WHERE i.campaign_id = c.id AND i.title = l.title
);

INSERT INTO latest_news_media (
  campaign_id, item_id, file_url, file_type, alt_text, sort_order, is_primary, created_at
)
SELECT
  c.id,
  i.id,
  l.image_url,
  'image',
  COALESCE(NULLIF(TRIM(l.image_alt), ''), 'Announcement image'),
  0,
  1,
  l.created_at
FROM latest_news_items_legacy l
INNER JOIN latest_news_campaigns c ON c.slug = l.slug
INNER JOIN latest_news_items i ON i.campaign_id = c.id AND i.title = l.title
WHERE l.image_url IS NOT NULL AND TRIM(l.image_url) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM latest_news_media m WHERE m.campaign_id = c.id AND m.file_url = l.image_url
  );
