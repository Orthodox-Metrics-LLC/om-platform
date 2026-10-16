-- Church News (MyOM → Parish Portal → Church News).
-- Applied to record_template1 (provisioning source) and every existing tenant
-- DB (om_church_##). One page per church — enforced by UNIQUE KEY on
-- church_id, not just app logic. Editable only by priest/deacon (+ platform
-- roles) -- viewable by any authenticated user of that church.
-- Media references this tenant's own fm_files (see 20260928_tenant_file_manager.sql).

CREATE TABLE IF NOT EXISTS church_news_page (
  id INT(11) NOT NULL AUTO_INCREMENT,
  church_id INT(11) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'Church News',
  body LONGTEXT NULL,
  status ENUM('draft','published') NOT NULL DEFAULT 'draft',
  published_at DATETIME NULL,
  created_by INT(11) NOT NULL,
  updated_by INT(11) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_church_news_page_church (church_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS church_news_media (
  id INT(11) NOT NULL AUTO_INCREMENT,
  page_id INT(11) NOT NULL,
  fm_file_id INT(11) NOT NULL,
  caption VARCHAR(500) NULL,
  sort_order INT(11) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_church_news_media_page (page_id, sort_order),
  CONSTRAINT fk_church_news_media_page FOREIGN KEY (page_id) REFERENCES church_news_page (id) ON DELETE CASCADE,
  CONSTRAINT fk_church_news_media_file FOREIGN KEY (fm_file_id) REFERENCES fm_files (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
