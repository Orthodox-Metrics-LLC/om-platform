-- Tenant-scoped social media (images/videos posted by church-role users).
-- Platform roles (super_admin/admin) keep using orthodoxmetrics_db.social_media;
-- church users' uploads are recorded in their own om_church_## database.
-- Applied to record_template1 (provisioning source) and every existing tenant DB.
CREATE TABLE IF NOT EXISTS social_media (
  id INT(11) NOT NULL AUTO_INCREMENT,
  church_id INT(11) NULL,
  user_id INT(11) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NULL,
  file_path VARCHAR(500) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  file_type VARCHAR(100) NULL,
  file_size INT(11) NULL,
  mime_type VARCHAR(100) NULL,
  alt_text VARCHAR(255) NULL,
  description TEXT NULL,
  metadata LONGTEXT NULL,
  usage_type ENUM('blog_image','profile_image','cover_image','chat_file','emoji','other','post_video','gallery') NOT NULL DEFAULT 'other',
  is_public TINYINT(1) NOT NULL DEFAULT 1,
  download_count INT(11) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_social_media_user (user_id),
  KEY idx_social_media_usage (usage_type),
  KEY idx_social_media_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- (orthodoxmetrics_db) platform table gains the same usage types
-- ALTER TABLE orthodoxmetrics_db.social_media MODIFY usage_type ENUM('blog_image','profile_image','cover_image','chat_file','emoji','other','post_video','gallery') NOT NULL DEFAULT 'other';
