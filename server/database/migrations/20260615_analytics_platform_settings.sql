-- Analytics platform settings — Website Stats + public tracker configuration
USE orthodoxmetrics_db;

INSERT IGNORE INTO settings_registry (`key`, `type`, `default_value`, `enum_values_json`, `description`, `category`, `is_sensitive`) VALUES
('analytics.provider', 'enum', 'plausible', '["none","plausible","umami","ga4"]', 'Analytics provider for OM public site tracking and Website Stats API', 'analytics', 0),
('analytics.tracker.enabled', 'bool', 'true', NULL, 'Load the public-site analytics tracker script on orthodoxmetrics.com', 'analytics', 0),
('analytics.plausible.site_id', 'string', 'orthodoxmetrics.com', NULL, 'Plausible site domain (also used as the tracker data-domain)', 'analytics', 0),
('analytics.plausible.api_key', 'string', NULL, NULL, 'Plausible Stats API token for Website Stats dashboard', 'analytics', 1),
('analytics.plausible.api_url', 'string', 'https://plausible.io/api/v1', NULL, 'Plausible Stats API base URL', 'analytics', 0),
('analytics.plausible.script_url', 'string', 'https://plausible.io/js/script.js', NULL, 'Plausible tracker script URL', 'analytics', 0),
('analytics.umami.api_url', 'string', NULL, NULL, 'Umami API base URL', 'analytics', 1),
('analytics.umami.api_token', 'string', NULL, NULL, 'Umami API token for Website Stats dashboard', 'analytics', 1),
('analytics.umami.website_id', 'string', NULL, NULL, 'Umami website UUID', 'analytics', 0),
('analytics.umami.script_url', 'string', NULL, NULL, 'Umami tracker script URL', 'analytics', 0),
('analytics.ga4.measurement_id', 'string', NULL, NULL, 'Google Analytics 4 measurement ID (G-XXXXXXX)', 'analytics', 0);

INSERT IGNORE INTO settings_overrides (`key`, scope, scope_id, value, updated_by) VALUES
('analytics.provider', 'global', NULL, 'plausible', NULL),
('analytics.tracker.enabled', 'global', NULL, 'true', NULL),
('analytics.plausible.site_id', 'global', NULL, 'orthodoxmetrics.com', NULL),
('analytics.plausible.api_url', 'global', NULL, 'https://plausible.io/api/v1', NULL),
('analytics.plausible.script_url', 'global', NULL, 'https://plausible.io/js/script.js', NULL);
