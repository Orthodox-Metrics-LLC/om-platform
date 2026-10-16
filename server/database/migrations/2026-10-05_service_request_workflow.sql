-- Operational service-request lifecycle, assignment policy, and delivery history.
-- The notification workflow also creates these objects when it starts.

ALTER TABLE service_request_notices
  ADD COLUMN IF NOT EXISTS notified_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_by INT NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_actor VARCHAR(191) NULL;

UPDATE service_request_notices SET status = 'CLOSED' WHERE status = 'closed';
UPDATE service_request_notices SET status = 'NOTIFIED' WHERE status = 'open';

CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
  id BIGINT NOT NULL AUTO_INCREMENT,
  delivery_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  error VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_delivery_attempt (delivery_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS service_request_assignment_policies (
  id BIGINT NOT NULL AUTO_INCREMENT,
  work_item_type VARCHAR(64) NOT NULL,
  match_responsibility VARCHAR(64) NOT NULL DEFAULT '',
  assignee_kind VARCHAR(16) NOT NULL,
  assignee_value VARCHAR(191) NOT NULL,
  active TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_assignment_policy (work_item_type, match_responsibility, assignee_kind, assignee_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS service_request_notification_policies (
  work_item_type VARCHAR(64) NOT NULL,
  reminder_interval_minutes INT NOT NULL,
  max_reminders INT NOT NULL,
  retry_interval_minutes INT NOT NULL,
  max_attempts INT NOT NULL,
  escalate_once TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (work_item_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO service_request_assignment_policies
  (work_item_type, match_responsibility, assignee_kind, assignee_value, active)
VALUES
  ('brain_approval', '', 'role', 'super_admin', 1),
  ('incident', '', 'role', 'super_admin', 1),
  ('operational_work', '', 'role', 'super_admin', 1),
  ('deployment_failure', '', 'role', 'super_admin', 1),
  ('backup_failure', '', 'role', 'super_admin', 1),
  ('ocr_exception', '', 'role', 'super_admin', 1)
ON DUPLICATE KEY UPDATE active = active;

INSERT INTO service_request_notification_policies
  (work_item_type, reminder_interval_minutes, max_reminders, retry_interval_minutes, max_attempts, escalate_once)
VALUES
  ('*', 240, 3, 15, 5, 1),
  ('brain_approval', 240, 3, 15, 5, 1),
  ('incident', 240, 3, 15, 5, 1),
  ('operational_work', 240, 3, 15, 5, 1),
  ('deployment_failure', 240, 3, 15, 5, 1),
  ('backup_failure', 240, 3, 15, 5, 1),
  ('ocr_exception', 240, 3, 15, 5, 1)
ON DUPLICATE KEY UPDATE work_item_type = work_item_type;

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(64) NULL;

ALTER TABLE notification_delivery_attempts
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(64) NULL;
