-- Migration: extend Page Builder item layout_type ENUM with live, data-bound
-- component kinds (file_upload, data_table) — additive only.
--
-- Unlike every existing layout_type, these two actually call the backend at
-- render time (POST files to a configurable upload endpoint, GET rows from a
-- configurable table endpoint) instead of rendering stored copy/media.

ALTER TABLE latest_news_items
  MODIFY COLUMN layout_type ENUM(
    'hero', 'split', 'card', 'banner', 'quote', 'image_grid', 'video',
    'animate', 'utilities', 'scrollbar', 'scroll_progress', 'lightbox',
    'form_wizard', 'carousel', 'timeline', 'tooltip', 'rating',
    'file_upload', 'data_table'
  ) NOT NULL DEFAULT 'card';
