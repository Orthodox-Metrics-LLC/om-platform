-- Migration: 2026-07-11 — OM Docs Dropbox ↔ om_daily_items work item link
-- Applied to: orthodoxmetrics_db

ALTER TABLE docs_dropbox_files
  ADD COLUMN IF NOT EXISTS om_daily_item_id INT UNSIGNED NULL
    COMMENT 'Logical FK to omai_db.om_daily_items.id (app-level, no DB FK)' AFTER work_packet_id;

ALTER TABLE docs_dropbox_files
  ADD COLUMN IF NOT EXISTS intake_type ENUM('documentation_only', 'work_item', 'hybrid')
    NOT NULL DEFAULT 'documentation_only' AFTER source_type;

ALTER TABLE docs_dropbox_files
  ADD COLUMN IF NOT EXISTS work_item_mode ENUM('none', 'governed', 'relaxed')
    NOT NULL DEFAULT 'none' AFTER intake_type;

ALTER TABLE docs_dropbox_files
  ADD COLUMN IF NOT EXISTS om_daily_item_linked_at DATETIME NULL AFTER om_daily_item_id;

ALTER TABLE docs_dropbox_files
  ADD COLUMN IF NOT EXISTS om_daily_item_linked_by_email VARCHAR(255) NULL AFTER om_daily_item_linked_at;

ALTER TABLE docs_dropbox_files
  ADD INDEX IF NOT EXISTS idx_dropbox_om_daily_item (om_daily_item_id);

ALTER TABLE docs_dropbox_files
  ADD INDEX IF NOT EXISTS idx_dropbox_intake_type (intake_type);

ALTER TABLE om_agent_dispatches
  ADD COLUMN IF NOT EXISTS om_daily_item_id INT UNSIGNED NULL
    COMMENT 'Logical FK to omai_db.om_daily_items.id' AFTER work_packet_id;

ALTER TABLE om_agent_dispatches
  ADD INDEX IF NOT EXISTS idx_disp_om_daily_item (om_daily_item_id);

ALTER TABLE work_packets
  ADD COLUMN IF NOT EXISTS om_daily_item_id INT UNSIGNED NULL AFTER ref_id;

ALTER TABLE work_packets
  ADD COLUMN IF NOT EXISTS metadata_json JSON NULL AFTER created_by_email;
