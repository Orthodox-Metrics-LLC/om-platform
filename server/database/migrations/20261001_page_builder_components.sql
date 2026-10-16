-- Page Builder component/effect configuration.
--
-- Additive platform-schema change for orthodoxmetrics_db only. Existing campaign
-- items retain their current layout_type and receive empty JSON configuration.
-- New component types map directly to the required Minimal UI capabilities:
-- animation, utilities, scrollbar, scroll progress, lightbox, form wizard,
-- carousel, timeline, tooltip, and rating.

ALTER TABLE latest_news_items
  MODIFY COLUMN layout_type ENUM(
    'hero', 'split', 'card', 'banner', 'quote', 'image_grid', 'video',
    'animate', 'utilities', 'scrollbar', 'scroll_progress', 'lightbox',
    'form_wizard', 'carousel', 'timeline', 'tooltip', 'rating'
  ) NOT NULL DEFAULT 'card',
  ADD COLUMN IF NOT EXISTS component_config JSON NULL AFTER layout_type,
  ADD COLUMN IF NOT EXISTS effects_config JSON NULL AFTER component_config;
