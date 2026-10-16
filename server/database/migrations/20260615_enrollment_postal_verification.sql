-- Enrollment postal verification for parish identity when submitter email is not
-- linked to the parish name or website domain.

ALTER TABLE onboarding_requests
  MODIFY COLUMN status ENUM(
    'postal_verification_pending',
    'submitted',
    'reviewing',
    'payment_pending',
    'payment_received',
    'provisioning',
    'admin_account_created',
    'awaiting_first_login',
    'record_tables_review',
    'active',
    'rejected',
    'cancelled'
  ) NOT NULL DEFAULT 'submitted';

ALTER TABLE onboarding_requests
  ADD COLUMN IF NOT EXISTS email_trust_status ENUM('trusted', 'postal_verification_required') NOT NULL DEFAULT 'trusted' AFTER submitted_by_phone,
  ADD COLUMN IF NOT EXISTS email_trust_reason VARCHAR(120) NULL AFTER email_trust_status,
  ADD COLUMN IF NOT EXISTS postal_verification_code_hash VARCHAR(128) NULL AFTER email_trust_reason,
  ADD COLUMN IF NOT EXISTS postal_verification_generated_at TIMESTAMP NULL AFTER postal_verification_code_hash,
  ADD COLUMN IF NOT EXISTS postal_verification_expires_at TIMESTAMP NULL AFTER postal_verification_generated_at,
  ADD COLUMN IF NOT EXISTS postal_verification_verified_at TIMESTAMP NULL AFTER postal_verification_expires_at,
  ADD COLUMN IF NOT EXISTS postal_verification_attempts INT NOT NULL DEFAULT 0 AFTER postal_verification_verified_at,
  ADD COLUMN IF NOT EXISTS postal_mailing_address_json JSON NULL AFTER postal_verification_attempts;
