-- Global Settings Approval Gating (OMOD — OMBrain settings governance)
--
-- Any global-scope settings mutation proposed by OMBrain (or any actor) is
-- captured here as a pending approval. It is NEVER applied to
-- settings_overrides until a human super_admin passes a FRESH auth challenge
-- and approves. OMBrain is only ever a facilitator / proposal source.
--
-- Three tables:
--   settings_change_requests  — the approval record (state machine + report fields)
--   settings_auth_challenges  — single-use, expiring human-auth challenges
--   settings_approval_audit   — append-only audit event log

-- ─── Approval record ───
CREATE TABLE IF NOT EXISTS settings_change_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  approval_ref VARCHAR(32) NOT NULL,                 -- human ref e.g. OMBA-0042
  proposal_source ENUM('ombrain','omstudio','om_admin','system') NOT NULL DEFAULT 'ombrain',
  requested_by VARCHAR(255) NULL,                     -- who/what proposed (e.g. 'ombrain', user email)
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  setting_key VARCHAR(190) NOT NULL,
  scope_type ENUM('global','church') NOT NULL DEFAULT 'global',
  scope_id BIGINT NULL,                              -- church id when scope_type='church'; NULL for global
  old_value LONGTEXT NULL,
  proposed_value LONGTEXT NULL,
  proposed_value_hash CHAR(64) NULL,                 -- sha256(proposed_value) — approval bound to this exact value
  affected_apps JSON NULL,                           -- ["om","omai","omstudio",...]
  risk_level ENUM('low','moderate','high','critical') NOT NULL DEFAULT 'moderate',
  classification VARCHAR(64) NOT NULL DEFAULT 'requires_human_superadmin',
  auth_required TINYINT(1) NOT NULL DEFAULT 1,
  auth_method VARCHAR(64) NULL,                      -- e.g. 'session_reauth', 'totp', 'webauthn', 'signed_token'
  auth_challenge_id VARCHAR(64) NULL,               -- last challenge consumed to authenticate
  auth_verified_at DATETIME NULL,
  auth_verified_by VARCHAR(255) NULL,               -- human identity that passed the challenge
  approval_state ENUM('submitted','authenticated','approved','rejected','expired','applied','failed')
    NOT NULL DEFAULT 'submitted',
  approved_by VARCHAR(255) NULL,                     -- HUMAN approver (never OMBrain)
  approved_at DATETIME NULL,
  applied_at DATETIME NULL,
  rejected_by VARCHAR(255) NULL,
  rejected_at DATETIME NULL,
  rejection_reason TEXT NULL,
  apply_error TEXT NULL,                             -- populated if apply fails
  audit_event_ids JSON NULL,                         -- list of settings_approval_audit ids
  omstudio_ref VARCHAR(128) NULL,                    -- ref returned by OMStudio Brain Approvals mirror
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_scr_ref (approval_ref),
  INDEX idx_scr_state (approval_state),
  INDEX idx_scr_key (setting_key),
  INDEX idx_scr_scope (scope_type, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Human auth challenges (single-use, expiring) ───
CREATE TABLE IF NOT EXISTS settings_auth_challenges (
  id VARCHAR(64) PRIMARY KEY,                         -- challenge id (uuid/hex)
  approval_id BIGINT NOT NULL,
  method VARCHAR(64) NOT NULL,                        -- pluggable challenge method
  actor VARCHAR(255) NULL,                            -- claimed human identity (verified on consume)
  proposed_value_hash CHAR(64) NULL,                 -- bound to the value at issue time
  nonce VARCHAR(128) NULL,                            -- opaque server-side material
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,                          -- set on first successful verify (replay guard)
  verified TINYINT(1) NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  INDEX idx_sac_approval (approval_id),
  INDEX idx_sac_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Append-only audit log ───
CREATE TABLE IF NOT EXISTS settings_approval_audit (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  approval_id BIGINT NULL,
  approval_ref VARCHAR(32) NULL,
  event_type VARCHAR(48) NOT NULL,                   -- proposal_created, auth_challenge_issued, auth_succeeded,
                                                     -- auth_failed, approval_granted, approval_rejected,
                                                     -- setting_applied, application_failed, approval_expired
  actor VARCHAR(255) NULL,
  source VARCHAR(48) NULL,                            -- ombrain | omstudio | om_admin | system
  detail JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_saa_approval (approval_id),
  INDEX idx_saa_event (event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Seed the global theme-policy key used by the OMBrain example flow ───
-- "ombrain set global theme policy to auto sunrise/sunset" -> ui.theme.policy = auto_solar
INSERT INTO settings_registry (`key`, `type`, default_value, enum_values_json, description, category, is_sensitive)
VALUES ('ui.theme.policy', 'enum', 'manual',
        '["manual","auto_time","auto_solar"]',
        'Global theme switching policy: manual, auto by clock time, or auto by solar sunrise/sunset',
        'ui', 0)
ON DUPLICATE KEY UPDATE
  enum_values_json = VALUES(enum_values_json),
  description = VALUES(description);
