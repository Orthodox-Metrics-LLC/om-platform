/**
 * Analytics configuration — DB-backed with env fallback.
 * Values live in settings_registry / settings_overrides under analytics.* keys.
 */

const { promisePool } = require('../config/db');
const { getEffectiveSetting, invalidateSettingCache } = require('../utils/settingsHelper');

const ANALYTICS_KEYS = [
  'analytics.provider',
  'analytics.tracker.enabled',
  'analytics.plausible.site_id',
  'analytics.plausible.api_key',
  'analytics.plausible.api_url',
  'analytics.plausible.script_url',
  'analytics.umami.api_url',
  'analytics.umami.api_token',
  'analytics.umami.website_id',
  'analytics.umami.script_url',
  'analytics.ga4.measurement_id',
];

const ENV_FALLBACK = {
  'analytics.provider': 'ANALYTICS_PROVIDER',
  'analytics.tracker.enabled': 'ANALYTICS_TRACKER_ENABLED',
  'analytics.plausible.site_id': 'PLAUSIBLE_SITE_ID',
  'analytics.plausible.api_key': 'PLAUSIBLE_API_KEY',
  'analytics.plausible.api_url': 'PLAUSIBLE_API_URL',
  'analytics.plausible.script_url': 'PLAUSIBLE_SCRIPT_URL',
  'analytics.umami.api_url': 'UMAMI_API_URL',
  'analytics.umami.api_token': 'UMAMI_API_TOKEN',
  'analytics.umami.website_id': 'UMAMI_WEBSITE_ID',
  'analytics.umami.script_url': 'UMAMI_SCRIPT_URL',
  'analytics.ga4.measurement_id': 'GA4_MEASUREMENT_ID',
};

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function maskSecret(value) {
  if (!value) return null;
  const str = String(value);
  if (str.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(12, str.length - 4))}${str.slice(-4)}`;
}

async function readRawSetting(key) {
  const dbValue = await getEffectiveSetting(key);
  if (dbValue !== undefined && dbValue !== null && dbValue !== '') return dbValue;
  const envKey = ENV_FALLBACK[key];
  if (envKey && process.env[envKey]) return process.env[envKey];
  return undefined;
}

const PLAUSIBLE_SCRIPT_URL = 'https://plausible.io/js/pa-y2c-FjvSp43RRzM_-T0Jn.js';

async function loadAnalyticsConfig({ includeSecrets = false } = {}) {
  const entries = await Promise.all(
    ANALYTICS_KEYS.map(async (key) => [key, await readRawSetting(key)]),
  );
  const raw = Object.fromEntries(entries);

  const provider = String(raw['analytics.provider'] || 'none').toLowerCase();
  const normalizedProvider = ['plausible', 'umami', 'ga4'].includes(provider)
    ? provider
    : 'none';

  const plausibleApiKey = raw['analytics.plausible.api_key'] || '';
  const umamiApiToken = raw['analytics.umami.api_token'] || '';

  const config = {
    provider: normalizedProvider,
    tracker_enabled: parseBool(raw['analytics.tracker.enabled'], normalizedProvider !== 'none'),
    plausible: {
      site_id: raw['analytics.plausible.site_id'] || 'orthodoxmetrics.com',
      api_url: raw['analytics.plausible.api_url'] || 'https://plausible.io/api/v1',
      script_url: raw['analytics.plausible.script_url'] || PLAUSIBLE_SCRIPT_URL,
      api_key_set: Boolean(plausibleApiKey),
      api_key_masked: maskSecret(plausibleApiKey),
      ...(includeSecrets ? { api_key: plausibleApiKey } : {}),
    },
    umami: {
      api_url: raw['analytics.umami.api_url'] || '',
      website_id: raw['analytics.umami.website_id'] || '',
      script_url: raw['analytics.umami.script_url'] || '',
      api_token_set: Boolean(umamiApiToken),
      api_token_masked: maskSecret(umamiApiToken),
      ...(includeSecrets ? { api_token: umamiApiToken } : {}),
    },
    ga4: {
      measurement_id: raw['analytics.ga4.measurement_id'] || '',
    },
  };

  config.tracker_configured = isTrackerConfigured(config);
  config.stats_configured = isStatsConfigured(config);
  config.configured = config.stats_configured;

  return config;
}

function isTrackerConfigured(config) {
  if (!config.tracker_enabled || config.provider === 'none') return false;
  if (config.provider === 'plausible') {
    return Boolean(config.plausible.site_id);
  }
  if (config.provider === 'umami') {
    return Boolean(config.umami.website_id && config.umami.script_url);
  }
  if (config.provider === 'ga4') {
    return Boolean(config.ga4.measurement_id);
  }
  return false;
}

function isStatsConfigured(config) {
  if (config.provider === 'plausible') {
    return Boolean(config.plausible.site_id && config.plausible.api_key_set);
  }
  if (config.provider === 'umami') {
    return Boolean(
      config.umami.api_url &&
        config.umami.website_id &&
        config.umami.api_token_set,
    );
  }
  return false;
}

function getPublicTrackerConfig(config) {
  if (!isTrackerConfigured(config)) {
    return { provider: 'none', enabled: false };
  }

  if (config.provider === 'plausible') {
    return {
      provider: 'plausible',
      enabled: true,
      plausible: {
        domain: config.plausible.site_id,
        scriptUrl: config.plausible.script_url,
      },
    };
  }

  if (config.provider === 'umami') {
    return {
      provider: 'umami',
      enabled: true,
      umami: {
        websiteId: config.umami.website_id,
        scriptUrl: config.umami.script_url,
      },
    };
  }

  if (config.provider === 'ga4') {
    return {
      provider: 'ga4',
      enabled: true,
      ga4: {
        measurementId: config.ga4.measurement_id,
      },
    };
  }

  return { provider: 'none', enabled: false };
}

async function upsertGlobalOverride(key, value, userId) {
  // Same NULL scope_id unique-index pitfall as websiteConfigService — update by id.
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
    [
      key,
      oldValue,
      normalizedValue,
      userId || null,
      'Website Stats configuration update',
    ],
  );

  invalidateSettingCache(key, null);
}

async function saveAnalyticsConfig(payload, userId) {
  const current = await loadAnalyticsConfig({ includeSecrets: true });
  const provider = String(payload.provider || current.provider || 'plausible').toLowerCase();

  await upsertGlobalOverride('analytics.provider', provider, userId);
  await upsertGlobalOverride(
    'analytics.tracker.enabled',
    parseBool(payload.tracker_enabled, true) ? 'true' : 'false',
    userId,
  );

  const plausible = payload.plausible || {};
  if (plausible.site_id !== undefined) {
    await upsertGlobalOverride('analytics.plausible.site_id', plausible.site_id, userId);
  }
  if (plausible.api_url !== undefined) {
    await upsertGlobalOverride('analytics.plausible.api_url', plausible.api_url, userId);
  }
  if (plausible.script_url !== undefined) {
    await upsertGlobalOverride('analytics.plausible.script_url', plausible.script_url, userId);
  }
  if (plausible.api_key !== undefined && plausible.api_key !== '' && plausible.api_key !== '__UNCHANGED__') {
    await upsertGlobalOverride('analytics.plausible.api_key', plausible.api_key, userId);
  }

  const umami = payload.umami || {};
  if (umami.api_url !== undefined) await upsertGlobalOverride('analytics.umami.api_url', umami.api_url, userId);
  if (umami.website_id !== undefined) await upsertGlobalOverride('analytics.umami.website_id', umami.website_id, userId);
  if (umami.script_url !== undefined) await upsertGlobalOverride('analytics.umami.script_url', umami.script_url, userId);
  if (umami.api_token !== undefined && umami.api_token !== '' && umami.api_token !== '__UNCHANGED__') {
    await upsertGlobalOverride('analytics.umami.api_token', umami.api_token, userId);
  }

  const ga4 = payload.ga4 || {};
  if (ga4.measurement_id !== undefined) {
    await upsertGlobalOverride('analytics.ga4.measurement_id', ga4.measurement_id, userId);
  }

  return loadAnalyticsConfig();
}

async function testAnalyticsConnection(config = null) {
  const resolved = config || (await loadAnalyticsConfig({ includeSecrets: true }));

  if (resolved.provider === 'plausible') {
    const apiKey = resolved.plausible?.api_key;
    if (!resolved.plausible?.site_id || !apiKey) {
      return { ok: false, message: 'Plausible site ID and API key are required.' };
    }
    const base = (resolved.plausible.api_url || 'https://plausible.io/api/v1').replace(/\/$/, '');
    const site = encodeURIComponent(resolved.plausible.site_id);
    const url = `${base}/stats/aggregate?site_id=${site}&period=7d&metrics=visitors`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return { ok: false, message: `Plausible API returned ${res.status}` };
    }
    return { ok: true, message: 'Plausible API connection successful.' };
  }

  if (resolved.provider === 'umami') {
    const apiToken = resolved.umami?.api_token;
    if (!resolved.umami?.api_url || !apiToken || !resolved.umami?.website_id) {
      return { ok: false, message: 'Umami API URL, token, and website ID are required.' };
    }
    const base = resolved.umami.api_url.replace(/\/$/, '');
    const websiteId = encodeURIComponent(resolved.umami.website_id);
    const endAt = Date.now();
    const startAt = endAt - 7 * 24 * 60 * 60 * 1000;
    const url = `${base}/websites/${websiteId}/stats?startAt=${startAt}&endAt=${endAt}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) {
      return { ok: false, message: `Umami API returned ${res.status}` };
    }
    return { ok: true, message: 'Umami API connection successful.' };
  }

  return { ok: false, message: 'GA4 is not supported for server-side stats. Choose Plausible or Umami.' };
}

module.exports = {
  loadAnalyticsConfig,
  saveAnalyticsConfig,
  getPublicTrackerConfig,
  isTrackerConfigured,
  isStatsConfigured,
  testAnalyticsConnection,
};
