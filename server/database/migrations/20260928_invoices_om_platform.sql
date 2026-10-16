-- Invoices for the om-platform (Minimal UI) invoice system. Additive on existing tables.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS bill_from_json LONGTEXT NULL AFTER church_id,
  ADD COLUMN IF NOT EXISTS bill_to_json LONGTEXT NULL AFTER bill_from_json,
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total_amount,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(200) NULL AFTER pdf_path,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(200) NULL AFTER stripe_checkout_session_id,
  ADD COLUMN IF NOT EXISTS paid_method VARCHAR(40) NULL AFTER stripe_payment_intent_id,
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP NULL AFTER paid_at;
ALTER TABLE invoices ADD INDEX IF NOT EXISTS idx_invoices_church_status (church_id, status);
ALTER TABLE invoices ADD UNIQUE INDEX IF NOT EXISTS uq_invoices_number (invoice_number);
