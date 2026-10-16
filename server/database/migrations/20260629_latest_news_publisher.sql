-- Latest News publisher — structured items with scheduling
-- Migrates existing image blocks from latest_news_blocks as live accordion items.

CREATE TABLE IF NOT EXISTS latest_news_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  summary VARCHAR(500) NULL,
  body TEXT NULL,
  image_url VARCHAR(2048) NULL,
  image_alt VARCHAR(255) NULL,
  cta_label VARCHAR(100) NULL,
  cta_url VARCHAR(2048) NULL,
  display_type ENUM('accordion', 'hero', 'card') NOT NULL DEFAULT 'accordion',
  sort_order INT NOT NULL DEFAULT 0,
  rotation_enabled TINYINT(1) NOT NULL DEFAULT 1,
  rotation_seconds INT NOT NULL DEFAULT 8,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('draft', 'scheduled', 'live', 'expired', 'archived') NOT NULL DEFAULT 'draft',
  publish_start_at DATETIME NULL,
  publish_end_at DATETIME NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_latest_news_slug (slug),
  INDEX idx_latest_news_status_sort (status, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS latest_news_audit (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NULL,
  action VARCHAR(64) NOT NULL,
  changed_by INT NULL,
  changes JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_latest_news_audit_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Preserve existing published image blocks as live accordion items (image URL in content column).
INSERT INTO latest_news_items (
  title,
  slug,
  summary,
  body,
  image_url,
  image_alt,
  display_type,
  sort_order,
  rotation_enabled,
  rotation_seconds,
  featured,
  status,
  created_by,
  created_at,
  updated_at
)
SELECT
  CONCAT('Announcement ', b.id),
  CONCAT('announcement-', b.id),
  NULL,
  NULL,
  b.content,
  'Announcement image',
  'accordion',
  b.sort_order,
  1,
  8,
  0,
  CASE WHEN b.is_published = 1 THEN 'live' ELSE 'draft' END,
  b.created_by,
  b.created_at,
  b.updated_at
FROM latest_news_blocks b
WHERE b.block_type = 'image'
  AND NOT EXISTS (
    SELECT 1 FROM latest_news_items i WHERE i.slug = CONCAT('announcement-', b.id)
  )
ORDER BY b.sort_order ASC, b.id ASC;
