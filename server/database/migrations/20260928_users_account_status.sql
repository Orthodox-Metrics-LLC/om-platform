-- Explicit account lifecycle for the om-platform user management pages.
--   pending  -> created, awaiting super_admin approval (cannot sign in)
--   active   -> approved; church roles must carry a church_id at approval time
--   banned   -> disabled by an administrator (cannot sign in)
--   rejected -> application declined (cannot sign in)
-- super_admin accounts are always active. Backfill preserves today's behaviour:
-- locked -> banned, active -> active, inactive -> pending.
ALTER TABLE users
  ADD COLUMN account_status ENUM('pending','active','banned','rejected')
    NOT NULL DEFAULT 'pending' AFTER is_locked,
  ADD COLUMN approved_at DATETIME NULL AFTER account_status,
  ADD COLUMN approved_by INT(11) NULL AFTER approved_at,
  ADD INDEX idx_users_account_status (account_status);

UPDATE users SET account_status = 'banned'  WHERE is_locked = 1;
UPDATE users SET account_status = 'active'  WHERE is_locked = 0 AND is_active = 1;
UPDATE users SET account_status = 'pending' WHERE is_locked = 0 AND is_active = 0;
UPDATE users SET account_status = 'active', is_locked = 0 WHERE role = 'super_admin';
