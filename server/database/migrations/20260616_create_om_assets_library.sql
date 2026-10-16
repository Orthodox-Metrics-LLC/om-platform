-- OM Assets Library — canonical asset registry (PR1)
-- Scopes: public (any church), church (parish-only), site (platform admin only)

CREATE TABLE IF NOT EXISTS om_assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NULL,
  scope ENUM('public','church','site') NOT NULL DEFAULT 'public',
  church_id INT NULL COMMENT 'Required when scope=church',
  category ENUM(
    'layout','border','cross','seal','header','background',
    'icon','watermark','signature','font','divider','branding',
    'logo','content','template'
  ) NOT NULL,
  file_path VARCHAR(512) NULL,
  file_type VARCHAR(100) NULL,
  width INT NULL,
  height INT NULL,
  metadata_json JSON NULL,
  licensing_note TEXT NULL,
  product_tags JSON NULL COMMENT '["om","omai","omstudio","omworkshop"]',
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  sha256 CHAR(64) NULL,
  legacy_source VARCHAR(64) NULL,
  legacy_id VARCHAR(128) NULL,
  uploaded_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_scope (scope),
  INDEX idx_church (church_id),
  INDEX idx_category (category),
  INDEX idx_status (status),
  INDEX idx_scope_church (scope, church_id),
  CONSTRAINT fk_om_assets_church FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migrate certificate_studio_assets → om_assets (preserve IDs for designer layout references)
INSERT IGNORE INTO om_assets (
  id, name, scope, church_id, category, file_path, file_type, width, height,
  metadata_json, licensing_note, status, uploaded_by, created_at, updated_at,
  legacy_source, legacy_id
)
SELECT
  csa.id,
  csa.name,
  CASE WHEN csa.scope = 'parish' THEN 'church' ELSE 'public' END,
  csa.church_id,
  csa.category,
  csa.file_path,
  csa.file_type,
  csa.width,
  csa.height,
  csa.metadata_json,
  csa.licensing_note,
  csa.status,
  csa.uploaded_by,
  csa.created_at,
  csa.updated_at,
  'certificate_studio_assets',
  CAST(csa.id AS CHAR)
FROM certificate_studio_assets csa;
