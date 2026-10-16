-- Notification types for invoices issued to a church (om-platform).
INSERT IGNORE INTO notification_types (name, description, category, default_enabled) VALUES
  ('invoice_received','A new invoice was issued to your parish','billing',1),
  ('invoice_paid','An invoice was paid','billing',1),
  ('invoice_overdue','An invoice is past its due date','billing',1);
