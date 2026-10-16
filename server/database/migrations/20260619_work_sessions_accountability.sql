-- Work Session Accountability — repo attribution, monthly reports, repo breakdown section
-- Platform DB: orthodoxmetrics_db

USE orthodoxmetrics_db;

ALTER TABLE work_sessions
  ADD COLUMN IF NOT EXISTS repo_target VARCHAR(32) NULL
    COMMENT 'omai|orthodoxmetrics|omstudio|omai-ops|shared|unknown'
    AFTER source_system,
  ADD COLUMN IF NOT EXISTS daily_item_id INT UNSIGNED NULL
    COMMENT 'om_daily_items.id in omai_db'
    AFTER repo_target,
  ADD COLUMN IF NOT EXISTS work_focus VARCHAR(255) NULL
    COMMENT 'Short label when no daily item linked'
    AFTER daily_item_id,
  ADD COLUMN IF NOT EXISTS om_daily_session_id INT UNSIGNED NULL
    COMMENT 'Mirror om_daily_work_sessions.id in omai_db'
    AFTER work_focus;

ALTER TABLE work_sessions
  ADD INDEX IF NOT EXISTS idx_ws_repo_started (repo_target, started_at),
  ADD INDEX IF NOT EXISTS idx_ws_daily_item (daily_item_id),
  ADD INDEX IF NOT EXISTS idx_ws_om_daily_session (om_daily_session_id);

ALTER TABLE weekly_report_configs
  ADD COLUMN IF NOT EXISTS monthly_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER is_enabled,
  ADD COLUMN IF NOT EXISTS monthly_schedule_day TINYINT NOT NULL DEFAULT 1
    COMMENT 'Day of month (1-28) to send monthly report'
    AFTER schedule_hour;

ALTER TABLE weekly_report_runs
  ADD COLUMN IF NOT EXISTS report_cadence ENUM('weekly','monthly','adhoc') NOT NULL DEFAULT 'weekly'
    AFTER period_end;

INSERT IGNORE INTO report_action_registry (action_key, display_name, description, handler_module, sort_order, default_enabled) VALUES
('repos_breakdown', 'Repo Breakdown', 'Time and completed work by GitHub repo with daily accountability grid', 'reposBreakdownSection', 2, 1);
