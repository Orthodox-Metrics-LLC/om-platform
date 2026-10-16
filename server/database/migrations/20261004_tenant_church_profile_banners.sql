-- Profile banners a parish publishes for its members.
-- Applied to record_template1 (provisioning source) and every om_church_##.
-- Priest, deacon, and church admin upload up to 12. Any member of that
-- tenant picks one as users.banner_url (orthodoxmetrics_db).
CREATE TABLE IF NOT EXISTS church_profile_banners (
  id INT(11) NOT NULL AUTO_INCREMENT,
  church_id INT(11) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  sort_order INT(11) NOT NULL DEFAULT 0,
  uploaded_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_church_profile_banner_url (church_id, file_url),
  KEY idx_church_profile_banners_order (church_id, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
