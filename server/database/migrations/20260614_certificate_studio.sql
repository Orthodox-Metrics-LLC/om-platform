-- Certificate Studio — parish-facing custom certificate design system
-- Complements existing certificate_template_groups / certificate_templates (OCA PDF overlay flow)

CREATE TABLE IF NOT EXISTS certificate_studio_assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category ENUM(
    'layout','border','cross','seal','header','background',
    'icon','watermark','signature','font','divider','branding'
  ) NOT NULL,
  scope ENUM('global','diocesan','parish') NOT NULL DEFAULT 'global',
  church_id INT NULL,
  diocese_id INT NULL,
  file_path VARCHAR(512) NULL,
  file_type VARCHAR(50) NULL,
  width INT NULL,
  height INT NULL,
  metadata_json JSON NULL COMMENT 'font internal name, SVG attrs, etc.',
  licensing_note TEXT NULL,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  uploaded_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category),
  INDEX idx_scope (scope),
  INDEX idx_church (church_id),
  INDEX idx_status (status),
  CONSTRAINT fk_csa_church FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS certificate_studio_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  church_id INT NULL COMMENT 'NULL = global OM default template',
  certificate_type ENUM('baptism','marriage','reception') NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  canvas_size ENUM('letter','a4','custom') NOT NULL DEFAULT 'letter',
  orientation ENUM('landscape','portrait') NOT NULL DEFAULT 'landscape',
  custom_width DECIMAL(8,2) NULL COMMENT 'PDF points',
  custom_height DECIMAL(8,2) NULL COMMENT 'PDF points',
  current_version_id INT NULL,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_church (church_id),
  INDEX idx_type (certificate_type),
  INDEX idx_status (status),
  INDEX idx_church_type (church_id, certificate_type),
  CONSTRAINT fk_cst_church FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS certificate_studio_template_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  layout_json JSON NOT NULL,
  asset_manifest_json JSON NULL,
  font_manifest_json JSON NULL,
  field_bindings_json JSON NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL,
  UNIQUE KEY uq_template_version (template_id, version_number),
  INDEX idx_template (template_id),
  CONSTRAINT fk_cstv_template FOREIGN KEY (template_id)
    REFERENCES certificate_studio_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE certificate_studio_templates
  ADD CONSTRAINT fk_cst_current_version FOREIGN KEY (current_version_id)
    REFERENCES certificate_studio_template_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS certificate_studio_render_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  church_id INT NOT NULL,
  template_id INT NOT NULL,
  template_version_id INT NOT NULL,
  certificate_type ENUM('baptism','marriage','reception') NOT NULL,
  record_id INT NOT NULL,
  status ENUM('pending','rendering','completed','failed') NOT NULL DEFAULT 'pending',
  output_file_path VARCHAR(512) NULL,
  error_message TEXT NULL,
  preview_mode BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  INDEX idx_church (church_id),
  INDEX idx_status (status),
  CONSTRAINT fk_csrj_church FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE,
  CONSTRAINT fk_csrj_template FOREIGN KEY (template_id)
    REFERENCES certificate_studio_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_csrj_version FOREIGN KEY (template_version_id)
    REFERENCES certificate_studio_template_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS certificate_studio_generation_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  church_id INT NOT NULL,
  certificate_type ENUM('baptism','marriage','reception') NOT NULL,
  record_id INT NOT NULL,
  template_id INT NOT NULL,
  template_version_id INT NOT NULL,
  generated_pdf_path VARCHAR(512) NOT NULL,
  record_snapshot_json JSON NULL,
  generated_by INT NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_church (church_id),
  INDEX idx_record (certificate_type, record_id),
  INDEX idx_generated (generated_at),
  CONSTRAINT fk_csgh_church FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE,
  CONSTRAINT fk_csgh_template FOREIGN KEY (template_id)
    REFERENCES certificate_studio_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_csgh_version FOREIGN KEY (template_version_id)
    REFERENCES certificate_studio_template_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
