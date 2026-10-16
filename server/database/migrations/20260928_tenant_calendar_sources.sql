-- Tenant calendar sources (om-platform Applications → Calendar) + extend calendar_events
-- so Minimal's calendar can persist end time / all-day / color.
CREATE TABLE IF NOT EXISTS calendar_sources (
  id INT(11) NOT NULL AUTO_INCREMENT,
  church_id INT(11) NULL,
  name VARCHAR(120) NOT NULL,
  kind ENUM('website','ics','orthocal') NOT NULL,
  url VARCHAR(1000) NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#00A76F',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT(11) NOT NULL DEFAULT 0,
  config LONGTEXT NULL,
  last_synced_at DATETIME NULL,
  last_error TEXT NULL,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS calendar_events (
  id INT(11) NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  time VARCHAR(8) NULL,
  location VARCHAR(255) NULL,
  type ENUM('event','supply','announcement') NOT NULL DEFAULT 'event',
  details TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_calendar_events_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS end_date DATE NULL AFTER time,
  ADD COLUMN IF NOT EXISTS end_time VARCHAR(8) NULL AFTER end_date,
  ADD COLUMN IF NOT EXISTS all_day TINYINT(1) NOT NULL DEFAULT 1 AFTER end_time,
  ADD COLUMN IF NOT EXISTS color VARCHAR(20) NULL AFTER all_day,
  ADD COLUMN IF NOT EXISTS created_by INT(11) NULL AFTER color,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
