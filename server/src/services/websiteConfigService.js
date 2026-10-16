/**
 * OM Website configuration — DB-backed settings_registry keys under website.*
 * Used by public GET /api/website/config and admin GET/PUT /api/admin/website-config.
 */

const { promisePool } = require('../config/db');
const { getEffectiveSetting, invalidateSettingCache } = require('../utils/settingsHelper');

const WEBSITE_KEYS = [
  'website.liturgical_auto_theme.enabled',
  'website.default_theme',
  'website.liturgical_calendar_widget.enabled',
  'website.seasonal_accents.enabled',
];

const THEME_VALUES = [
  'PURPLE_THEME',
  'GREEN_THEME',
  'GOLD_THEME',
  'RED_THEME',
  'BLUE_THEME',
  'WHITE_THEME',
  'LENT_THEME',
];

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function normalizeTheme(value) {
  const theme = String(value || 'PURPLE_THEME').trim();
  return THEME_VALUES.includes(theme) ? theme : 'PURPLE_THEME';
}

async function loadWebsiteConfig() {
  const entries = await Promise.all(
    WEBSITE_KEYS.map(async (key) => [key, await getEffectiveSetting(key)]),
  );
  const raw = Object.fromEntries(entries);

  return {
    liturgical_auto_theme_enabled: parseBool(raw['website.liturgical_auto_theme.enabled'], false),
    default_theme: normalizeTheme(raw['website.default_theme']),
    liturgical_calendar_widget_enabled: parseBool(
      raw['website.liturgical_calendar_widget.enabled'],
      true,
    ),
    seasonal_accents_enabled: parseBool(raw['website.seasonal_accents.enabled'], true),
  };
}

function getPublicWebsiteConfig(config) {
  return {
    liturgical_auto_theme_enabled: !!config.liturgical_auto_theme_enabled,
    default_theme: normalizeTheme(config.default_theme),
    liturgical_calendar_widget_enabled: !!config.liturgical_calendar_widget_enabled,
    seasonal_accents_enabled: !!config.seasonal_accents_enabled,
  };
}

async function upsertGlobalOverride(key, value, userId, reason) {
  // IMPORTANT: MySQL/MariaDB UNIQUE(key, scope, scope_id) treats each NULL
  // scope_id as distinct, so INSERT ... ON DUPLICATE KEY UPDATE never matches
  // for global rows and silently inserts duplicates. Update/delete by id instead.
  const [existing] = await promisePool.query(
    `SELECT id, value FROM settings_overrides
     WHERE \`key\` = ? AND scope = 'global' AND scope_id IS NULL
     ORDER BY updated_at DESC, id DESC`,
    [key],
  );

  const oldValue = existing[0]?.value ?? null;
  const normalizedValue = value === undefined || value === null ? null : String(value);
  const keepId = existing[0]?.id;

  if (keepId) {
    await promisePool.query(
      `UPDATE settings_overrides
       SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [normalizedValue, userId || null, keepId],
    );
    if (existing.length > 1) {
      await promisePool.query(
        `DELETE FROM settings_overrides
         WHERE \`key\` = ? AND scope = 'global' AND scope_id IS NULL AND id != ?`,
        [key, keepId],
      );
    }
  } else {
    await promisePool.query(
      `INSERT INTO settings_overrides (\`key\`, scope, scope_id, value, updated_by)
       VALUES (?, 'global', NULL, ?, ?)`,
      [key, normalizedValue, userId || null],
    );
  }

  await promisePool.query(
    `INSERT INTO settings_audit (\`key\`, scope, scope_id, old_value, new_value, changed_by, reason)
     VALUES (?, 'global', NULL, ?, ?, ?, ?)`,
    [key, oldValue, normalizedValue, userId || null, reason || 'OM Website configuration update'],
  );

  invalidateSettingCache(key, null);
}

async function saveWebsiteConfig(body, userId) {
  const updates = [];

  if (body.liturgical_auto_theme_enabled !== undefined) {
    updates.push([
      'website.liturgical_auto_theme.enabled',
      body.liturgical_auto_theme_enabled ? 'true' : 'false',
    ]);
  }
  if (body.default_theme !== undefined) {
    updates.push(['website.default_theme', normalizeTheme(body.default_theme)]);
  }
  if (body.liturgical_calendar_widget_enabled !== undefined) {
    updates.push([
      'website.liturgical_calendar_widget.enabled',
      body.liturgical_calendar_widget_enabled ? 'true' : 'false',
    ]);
  }
  if (body.seasonal_accents_enabled !== undefined) {
    updates.push([
      'website.seasonal_accents.enabled',
      body.seasonal_accents_enabled ? 'true' : 'false',
    ]);
  }

  if (!updates.length) {
    throw new Error('No website settings provided to update');
  }

  for (const [key, value] of updates) {
    // Ensure key exists in registry
    const [reg] = await promisePool.query(
      `SELECT \`key\` FROM settings_registry WHERE \`key\` = ? LIMIT 1`,
      [key],
    );
    if (!reg.length) {
      throw new Error(`Unknown setting key: ${key}`);
    }
    await upsertGlobalOverride(key, value, userId, 'OM Website configuration update');
  }

  return loadWebsiteConfig();
}

async function getWebsiteSettingsAdminView() {
  const [registryRows] = await promisePool.query(
    `SELECT r.\`key\`, r.\`type\`, r.category, r.description, r.default_value, r.enum_values_json
     FROM settings_registry r
     WHERE r.category = 'website'
     ORDER BY r.\`key\``,
  );

  const config = await loadWebsiteConfig();
  const keyToField = {
    'website.liturgical_auto_theme.enabled': 'liturgical_auto_theme_enabled',
    'website.default_theme': 'default_theme',
    'website.liturgical_calendar_widget.enabled': 'liturgical_calendar_widget_enabled',
    'website.seasonal_accents.enabled': 'seasonal_accents_enabled',
  };

  const settings = registryRows.map((row) => {
    const field = keyToField[row.key];
    let effective = config[field];
    if (typeof effective === 'boolean') effective = effective ? 'true' : 'false';
    return {
      key: row.key,
      type: row.type,
      category: row.category,
      description: row.description,
      default_value: row.default_value,
      enum_values_json: row.enum_values_json,
      effective_value: effective != null ? String(effective) : row.default_value,
      field,
    };
  });

  return { config, settings, theme_options: THEME_VALUES };
}

module.exports = {
  WEBSITE_KEYS,
  THEME_VALUES,
  loadWebsiteConfig,
  getPublicWebsiteConfig,
  saveWebsiteConfig,
  getWebsiteSettingsAdminView,
};
