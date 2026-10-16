-- OM Website settings — liturgical auto-theme, default theme, related public/app toggles
-- Consumed by GET /api/website/config and managed via GET/PUT /api/admin/website-config
USE orthodoxmetrics_db;

INSERT IGNORE INTO settings_registry (`key`, `type`, `default_value`, `enum_values_json`, `description`, `category`, `is_sensitive`) VALUES
('website.liturgical_auto_theme.enabled', 'bool', 'false', NULL,
 'When true, authenticated OM SPA syncs activeTheme from today''s liturgical color. When false, liturgical color sync is skipped.',
 'website', 0),
('website.default_theme', 'enum', 'PURPLE_THEME',
 '["PURPLE_THEME","GREEN_THEME","GOLD_THEME","RED_THEME","BLUE_THEME","WHITE_THEME","LENT_THEME"]',
 'Default MUI activeTheme when liturgical auto-theme is disabled (or before first sync). PURPLE_THEME is Lenten liturgical purple.',
 'website', 0),
('website.liturgical_calendar_widget.enabled', 'bool', 'true', NULL,
 'Show the liturgical calendar widget surfaces in the OM app when available.',
 'website', 0),
('website.seasonal_accents.enabled', 'bool', 'true', NULL,
 'Allow public/marketing seasonal accent styling tied to liturgical seasons.',
 'website', 0);

-- Operator preference: liturgical auto-theme OFF, purple default
INSERT IGNORE INTO settings_overrides (`key`, scope, scope_id, value, updated_by) VALUES
('website.liturgical_auto_theme.enabled', 'global', NULL, 'false', NULL),
('website.default_theme', 'global', NULL, 'PURPLE_THEME', NULL),
('website.liturgical_calendar_widget.enabled', 'global', NULL, 'true', NULL),
('website.seasonal_accents.enabled', 'global', NULL, 'true', NULL);
