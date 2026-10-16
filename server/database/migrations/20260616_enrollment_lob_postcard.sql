-- Lob postcard tracking for enrollment postal verification

ALTER TABLE onboarding_requests
  ADD COLUMN IF NOT EXISTS postal_lob_postcard_id VARCHAR(64) NULL AFTER postal_mailing_address_json,
  ADD COLUMN IF NOT EXISTS postal_lob_status VARCHAR(64) NULL AFTER postal_lob_postcard_id,
  ADD COLUMN IF NOT EXISTS postal_lob_mailed_at TIMESTAMP NULL AFTER postal_lob_status,
  ADD COLUMN IF NOT EXISTS postal_lob_delivered_at TIMESTAMP NULL AFTER postal_lob_mailed_at,
  ADD COLUMN IF NOT EXISTS postal_lob_last_event VARCHAR(64) NULL AFTER postal_lob_delivered_at,
  ADD COLUMN IF NOT EXISTS postal_lob_last_event_at TIMESTAMP NULL AFTER postal_lob_last_event;
