-- Parish-owned certificate templates live in the tenant DB (OM/global templates stay in orthodoxmetrics_db with church_id NULL).
CREATE TABLE IF NOT EXISTS certificate_studio_templates (
  id INT(11) NOT NULL AUTO_INCREMENT,
  church_id INT(11) NOT NULL,
  certificate_type ENUM('baptism','marriage','reception') NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  canvas_size ENUM('letter','a4','custom') NOT NULL DEFAULT 'letter',
  orientation ENUM('landscape','portrait') NOT NULL DEFAULT 'portrait',
  custom_width DECIMAL(8,2) NULL,
  custom_height DECIMAL(8,2) NULL,
  current_version_id INT(11) NULL,
  source_global_template_id INT(11) NULL,
  created_by INT(11) NULL,
  updated_by INT(11) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cst_type_status (certificate_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS certificate_studio_template_versions (
  id INT(11) NOT NULL AUTO_INCREMENT,
  template_id INT(11) NOT NULL,
  version_number INT(11) NOT NULL DEFAULT 1,
  layout_json LONGTEXT NOT NULL,
  asset_manifest_json LONGTEXT NULL,
  font_manifest_json LONGTEXT NULL,
  field_bindings_json LONGTEXT NULL,
  created_by INT(11) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_cstv_template (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- orthodoxmetrics_db: history may reference a parish (tenant) template
-- ALTER TABLE certificate_studio_generation_history MODIFY template_id INT(11) NULL, MODIFY template_version_id INT(11) NULL,
--   ADD COLUMN IF NOT EXISTS template_scope ENUM('global','church') NOT NULL DEFAULT 'global' AFTER template_id,
--   ADD COLUMN IF NOT EXISTS church_template_id INT(11) NULL AFTER template_scope;
