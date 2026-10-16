-- Service-request notices and per-channel delivery state.
-- The notification workflow also creates these tables if they are missing.

CREATE TABLE IF NOT EXISTS service_request_notices (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  work_item_type VARCHAR(64) NOT NULL,
  work_item_ref VARCHAR(191) NOT NULL,
  responsibility VARCHAR(64) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  action_path VARCHAR(500) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  reminder_count INT NOT NULL DEFAULT 0,
  escalated_at DATETIME NULL,
  next_action_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_request_event (event_id),
  KEY idx_service_request_open_due (status, next_action_at),
  KEY idx_service_request_ref (work_item_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id BIGINT NOT NULL AUTO_INCREMENT,
  notice_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  channel VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  next_attempt_at DATETIME NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_delivery_notice_user_channel (notice_id, user_id, channel),
  KEY idx_delivery_due (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO notification_types (name, description, category, is_active, default_enabled)
VALUES ('service_request_action', 'Service-request work item needs a responsible user', 'admin', 1, 1)
ON DUPLICATE KEY UPDATE is_active = 1;
