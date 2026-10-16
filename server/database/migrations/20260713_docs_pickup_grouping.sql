-- Migration: 2026-07-13 — OM Docs Pickup parent/child grouping (Phase 1 data model)
-- Applied to: orthodoxmetrics_db
--
-- Additive only, guarded, and reversible. Preserves the existing pickup lifecycle
-- (20260630_docs_pickup_lifecycle.sql) and filing (20260701_docs_pickup_filing.sql).
-- NOTHING here is populated by this migration — every new column is NULL / defaulted
-- so existing rows and the flat /list output remain unchanged until the later
-- grouping phases (tree UI + group/ungroup endpoints) start writing to them.
--
-- Adds:
--   * docs_pickup_files.parent_id     — self-reference to docs_pickup_files.id (child -> parent).
--   * docs_pickup_files.group_id      — cluster membership (OMGRP-YYYYMMDD-XXXXX).
--   * docs_pickup_files.relation_type — standalone (default) | parent | child.
--   * docs_pickup_groups              — one row per parent/child cluster.
--   * reuses docs_pickup_audit_events for the grouped / ungrouped / parent_assigned
--     event types (event_type was widened to VARCHAR(48) in 20260701, so no ALTER
--     is needed here — the new event strings already fit).
--
-- Rollback (manual, additive-safe):
--   ALTER TABLE docs_pickup_files
--     DROP COLUMN relation_type, DROP COLUMN group_id, DROP COLUMN parent_id;
--   DROP TABLE IF EXISTS docs_pickup_groups;
--   (indexes/FK are dropped implicitly with their columns/table).

-- ── docs_pickup_files: grouping columns ─────────────────────────────────────
ALTER TABLE docs_pickup_files
  ADD COLUMN IF NOT EXISTS parent_id VARCHAR(36) NULL
    COMMENT 'Self-ref to docs_pickup_files.id — set on child rows only' AFTER pickup_id,
  ADD COLUMN IF NOT EXISTS group_id VARCHAR(40) NULL
    COMMENT 'Cluster membership OMGRP-YYYYMMDD-XXXXX (docs_pickup_groups.group_id)' AFTER parent_id,
  ADD COLUMN IF NOT EXISTS relation_type ENUM('standalone', 'parent', 'child')
    NOT NULL DEFAULT 'standalone'
    COMMENT 'Role of this pickup within a group' AFTER group_id;

-- Lookup indexes (guarded — MariaDB lacks ADD INDEX IF NOT EXISTS on older builds,
-- so create only when missing via information_schema).
SET @has_idx_parent := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'docs_pickup_files' AND index_name = 'idx_parent_id'
);
SET @sql := IF(@has_idx_parent = 0,
  'ALTER TABLE docs_pickup_files ADD INDEX idx_parent_id (parent_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has_idx_group := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'docs_pickup_files' AND index_name = 'idx_group_id'
);
SET @sql := IF(@has_idx_group = 0,
  'ALTER TABLE docs_pickup_files ADD INDEX idx_group_id (group_id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has_idx_relation := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'docs_pickup_files' AND index_name = 'idx_relation_type'
);
SET @sql := IF(@has_idx_relation = 0,
  'ALTER TABLE docs_pickup_files ADD INDEX idx_relation_type (relation_type)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Self-referential FK (child.parent_id -> parent.id). Guarded; ON DELETE SET NULL
-- so removing a parent demotes its children rather than cascading a delete.
SET @has_fk_parent := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE() AND table_name = 'docs_pickup_files'
    AND constraint_name = 'fk_docs_pickup_parent'
);
SET @sql := IF(@has_fk_parent = 0,
  'ALTER TABLE docs_pickup_files
     ADD CONSTRAINT fk_docs_pickup_parent
     FOREIGN KEY (parent_id) REFERENCES docs_pickup_files (id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── docs_pickup_groups: one row per parent/child cluster ────────────────────
CREATE TABLE IF NOT EXISTS docs_pickup_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id VARCHAR(40) NOT NULL COMMENT 'Stable public id OMGRP-YYYYMMDD-XXXXX',
  parent_pickup_file_id VARCHAR(36) NULL COMMENT 'docs_pickup_files.id of the group parent',
  title VARCHAR(255) NULL COMMENT 'Human title for the cluster',
  feature_tag VARCHAR(64) NULL COMMENT 'Feature family tag, e.g. church-46-header-footer',
  work_packet_id VARCHAR(64) NULL COMMENT 'Originating OMD/OMPKT work packet, if any',
  created_by VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_group_id (group_id),
  INDEX idx_group_parent (parent_pickup_file_id),
  INDEX idx_group_feature_tag (feature_tag),
  INDEX idx_group_work_packet (work_packet_id),
  CONSTRAINT fk_group_parent_pickup
    FOREIGN KEY (parent_pickup_file_id) REFERENCES docs_pickup_files (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='OM Docs Pickup parent/child grouping clusters';
