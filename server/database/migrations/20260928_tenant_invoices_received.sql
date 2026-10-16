-- Tenant mirror of invoices issued to this church (om-platform: File → Invoices for church roles).
CREATE TABLE IF NOT EXISTS invoices_received (
  id INT(11) NOT NULL AUTO_INCREMENT,
  invoice_id INT(11) NOT NULL,
  invoice_number VARCHAR(50) NOT NULL,
  church_id INT(11) NOT NULL,
  status ENUM('draft','pending','sent','paid','overdue','cancelled') NOT NULL DEFAULT 'sent',
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  issue_date DATE NULL,
  due_date DATE NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  viewed_at TIMESTAMP NULL,
  paid_at TIMESTAMP NULL,
  pdf_path VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoices_received_invoice (invoice_id),
  KEY idx_invoices_received_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
