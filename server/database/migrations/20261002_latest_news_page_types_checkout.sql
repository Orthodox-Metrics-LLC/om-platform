-- Migration: extend Page Builder page_type ENUM with checkout, payment, pricing
--
-- Additive only: existing enum values/rows are untouched. Lets the Page
-- Builder publish overrides for /product/checkout, /payment, and /pricing,
-- the same way it already does for coming_soon/maintenance/error_* pages.

ALTER TABLE latest_news_campaigns
  MODIFY COLUMN page_type ENUM(
    'latest_news', 'coming_soon', 'maintenance', 'error_404', 'error_403', 'error_500',
    'checkout', 'payment', 'pricing'
  ) NOT NULL DEFAULT 'latest_news';
