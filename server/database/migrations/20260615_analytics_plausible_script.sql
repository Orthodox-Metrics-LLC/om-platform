-- Point analytics settings at the site-specific Plausible script embedded in index.html
USE orthodoxmetrics_db;

UPDATE settings_registry
SET default_value = 'https://plausible.io/js/pa-y2c-FjvSp43RRzM_-T0Jn.js'
WHERE `key` = 'analytics.plausible.script_url';

UPDATE settings_overrides
SET value = 'https://plausible.io/js/pa-y2c-FjvSp43RRzM_-T0Jn.js'
WHERE `key` = 'analytics.plausible.script_url' AND scope = 'global';
