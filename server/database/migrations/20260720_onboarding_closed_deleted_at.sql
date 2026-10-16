-- ============================================================================
-- Onboarding admin list: closed_at (reject/cancel timestamp) + deleted_at (soft delete)
-- 2026-07-20 | orthodoxmetrics_db
--
-- Timestamp policy for 30-day auto-clear of cancelled/rejected enrollments:
--   Primary: closed_at — set when status becomes 'rejected' or 'cancelled'
--   Legacy fallback in queries: COALESCE(closed_at, updated_at)
-- Admin Delete sets deleted_at immediately (hidden from /admin/onboarding permanently).
-- Nightly cron hard-purges rows past the 30-day closed window (and soft-deleted rows).
-- Rollback:
--   ALTER TABLE onboarding_requests DROP COLUMN closed_at, DROP COLUMN deleted_at;
-- ============================================================================

ALTER TABLE onboarding_requests
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL
    COMMENT 'Set when status becomes rejected or cancelled — used for 30-day auto-clear'
    AFTER updated_at,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL
    COMMENT 'Soft-delete; row hidden from admin onboarding list immediately'
    AFTER closed_at;

-- Backfill closed_at for existing terminal rows from updated_at (best available stamp)
UPDATE onboarding_requests
SET closed_at = updated_at
WHERE status IN ('rejected', 'cancelled')
  AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_onboarding_closed
  ON onboarding_requests (status, closed_at);

CREATE INDEX IF NOT EXISTS idx_onboarding_deleted
  ON onboarding_requests (deleted_at);
