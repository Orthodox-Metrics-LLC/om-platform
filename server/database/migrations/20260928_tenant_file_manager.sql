-- Tenant file manager (om-platform Management → File manager / Overview → File).
-- Applied to record_template1 (provisioning source) and every existing tenant DB.
-- Users are referenced by orthodoxmetrics_db.users.id (no cross-db FK).

CREATE TABLE IF NOT EXISTS fm_folders (
  id INT(11) NOT NULL AUTO_INCREMENT,
  church_id INT(11) NULL,
  parent_id INT(11) NULL,
  name VARCHAR(255) NOT NULL,
  system_key VARCHAR(32) NULL,               -- 'records' | 'media' | 'documents' for the three roots
  tags LONGTEXT NULL,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_fm_folders_parent (parent_id),
  KEY idx_fm_folders_system (system_key),
  CONSTRAINT fk_fm_folders_parent FOREIGN KEY (parent_id) REFERENCES fm_folders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fm_files (
  id INT(11) NOT NULL AUTO_INCREMENT,
  church_id INT(11) NULL,
  folder_id INT(11) NULL,
  name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NULL,
  stored_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(128) NULL,
  ext VARCHAR(16) NULL,
  size_bytes BIGINT(20) NOT NULL DEFAULT 0,
  category ENUM('image','video','audio','document','other') NOT NULL DEFAULT 'other',
  tags LONGTEXT NULL,
  uploaded_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_fm_files_folder (folder_id),
  KEY idx_fm_files_category (category),
  KEY idx_fm_files_created (created_at),
  CONSTRAINT fk_fm_files_folder FOREIGN KEY (folder_id) REFERENCES fm_folders (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fm_shares (
  id INT(11) NOT NULL AUTO_INCREMENT,
  item_type ENUM('file','folder') NOT NULL,
  item_id INT(11) NOT NULL,
  user_id INT(11) NOT NULL,
  permission ENUM('view','edit') NOT NULL DEFAULT 'view',
  shared_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_fm_share (item_type, item_id, user_id),
  KEY idx_fm_shares_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fm_favorites (
  id INT(11) NOT NULL AUTO_INCREMENT,
  item_type ENUM('file','folder') NOT NULL,
  item_id INT(11) NOT NULL,
  user_id INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_fm_fav (item_type, item_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fm_activity (
  id INT(11) NOT NULL AUTO_INCREMENT,
  church_id INT(11) NULL,
  item_type ENUM('file','folder') NOT NULL,
  item_id INT(11) NOT NULL,
  item_name VARCHAR(255) NULL,
  category ENUM('image','video','audio','document','other') NULL,
  action ENUM('upload','create','rename','move','delete','share','unshare','download','favorite') NOT NULL,
  size_delta BIGINT(20) NOT NULL DEFAULT 0,
  user_id INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_fm_activity_created (created_at),
  KEY idx_fm_activity_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
