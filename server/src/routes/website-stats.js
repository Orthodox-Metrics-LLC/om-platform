/**
 * /api/admin/website-stats — stats proxy + UI-managed analytics configuration.
 */

const express = require('express');
const { requireRole } = require('../middleware/auth');
const {
  loadAnalyticsConfig,
  saveAnalyticsConfig,
  testAnalyticsConnection,
} = require('../services/analyticsConfigService');
const {
  normalizeSegment,
  getPlausibleFilter,
  applySegmentToStats,
} = require('../services/websiteStatsSegments');

const router = express.Router();
const BREAKDOWN_LIMIT = 100;

const PLAUSIBLE_PERIODS = {
  '24h': 'day',
  '7d': '7d',
  '30d': '30d',
  '12mo': '12mo',
};

const UMAMI_PERIOD_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '12mo': 365 * 24 * 60 * 60 * 1000,
};

function appendFilter(url, filter) {
  if (!filter) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}filters=${encodeURIComponent(filter)}`;
}

async function fetchPlausible(period, segment, config) {
  const base = (config.plausible.api_url || 'https://plausible.io/api/v1').replace(/\/$/, '');
  const site = encodeURIComponent(config.plausible.site_id);
  const key = config.plausible.api_key;
  const headers = { Authorization: `Bearer ${key}` };
  const filter = getPlausibleFilter(segment);

  const aggUrl = appendFilter(
    `${base}/stats/aggregate?site_id=${site}&period=${period}&metrics=visitors,pageviews,bounce_rate,visit_duration`,
    filter,
  );
  const topPagesUrl = appendFilter(
    `${base}/stats/breakdown?site_id=${site}&period=${period}&property=event:page&metrics=visitors,pageviews&limit=${BREAKDOWN_LIMIT}`,
    filter,
  );
  const topRefsUrl = `${base}/stats/breakdown?site_id=${site}&period=${period}&property=visit:source&limit=10`;

  const requests = [fetch(aggUrl, { headers }), fetch(topPagesUrl, { headers })];
  if (segment === 'all') requests.push(fetch(topRefsUrl, { headers }));

  const [aggRes, pagesRes, refsRes] = await Promise.all(requests);

  if (!aggRes.ok) throw new Error(`plausible aggregate ${aggRes.status}`);
  if (!pagesRes.ok) throw new Error(`plausible top-pages ${pagesRes.status}`);
  if (segment === 'all' && refsRes && !refsRes.ok) {
    throw new Error(`plausible top-refs ${refsRes.status}`);
  }

  const agg = await aggRes.json();
  const pages = await pagesRes.json();
  const refs = segment === 'all' && refsRes ? await refsRes.json() : { results: [] };

  const data = {
    provider: 'plausible',
    period,
    totals: {
      visitors: agg?.results?.visitors?.value ?? 0,
      pageviews: agg?.results?.pageviews?.value ?? 0,
      bounce_rate: agg?.results?.bounce_rate?.value ?? 0,
      visit_duration: agg?.results?.visit_duration?.value ?? 0,
    },
    top_pages: (pages?.results || []).map((r) => ({
      page: r.page,
      visitors: r.visitors ?? 0,
      pageviews: r.pageviews ?? r.visitors ?? 0,
    })),
    top_referrers: (refs?.results || []).map((r) => ({
      source: r.source || '(direct)',
      visitors: r.visitors,
    })),
  };

  if (segment === 'all') {
    return applySegmentToStats(data, segment);
  }

  return {
    ...applySegmentToStats(data, segment),
    totals: {
      visitors: data.totals.visitors,
      pageviews: data.totals.pageviews,
      bounce_rate: null,
      visit_duration: null,
    },
    totals_derived: false,
    totals_note:
      'Segment totals are filtered at the analytics provider. Bounce rate and visit duration are only available for All traffic.',
  };
}

async function fetchUmami(period, segment, config) {
  const base = config.umami.api_url.replace(/\/$/, '');
  const websiteId = encodeURIComponent(config.umami.website_id);
  const token = config.umami.api_token;
  const headers = { Authorization: `Bearer ${token}` };

  const endAt = Date.now();
  const startAt = endAt - (UMAMI_PERIOD_MS[period] || UMAMI_PERIOD_MS['7d']);
  const range = `startAt=${startAt}&endAt=${endAt}`;

  const statsUrl = `${base}/websites/${websiteId}/stats?${range}`;
  const topPagesUrl = `${base}/websites/${websiteId}/metrics?${range}&type=url&limit=${BREAKDOWN_LIMIT}`;
  const topRefsUrl = `${base}/websites/${websiteId}/metrics?${range}&type=referrer&limit=10`;

  const requests = [fetch(statsUrl, { headers }), fetch(topPagesUrl, { headers })];
  if (segment === 'all') requests.push(fetch(topRefsUrl, { headers }));

  const [statsRes, pagesRes, refsRes] = await Promise.all(requests);

  if (!statsRes.ok) throw new Error(`umami stats ${statsRes.status}`);
  if (!pagesRes.ok) throw new Error(`umami top-pages ${pagesRes.status}`);
  if (segment === 'all' && refsRes && !refsRes.ok) {
    throw new Error(`umami top-refs ${refsRes.status}`);
  }

  const stats = await statsRes.json();
  const pages = await pagesRes.json();
  const refs = segment === 'all' && refsRes ? await refsRes.json() : [];

  const data = {
    provider: 'umami',
    period,
    totals: {
      visitors: stats?.visitors?.value ?? 0,
      pageviews: stats?.pageviews?.value ?? 0,
      bounce_rate: stats?.bounces?.value ?? 0,
      visit_duration: stats?.totaltime?.value ?? 0,
    },
    top_pages: (Array.isArray(pages) ? pages : []).map((r) => ({
      page: r.x,
      visitors: r.y ?? 0,
      pageviews: r.y ?? 0,
    })),
    top_referrers: (Array.isArray(refs) ? refs : []).map((r) => ({
      source: r.x || '(direct)',
      visitors: r.y,
    })),
  };

  return applySegmentToStats(data, segment);
}

router.get(
  '/website-stats/config',
  requireRole(['super_admin', 'admin']),
  async (_req, res) => {
    try {
      const config = await loadAnalyticsConfig();
      res.json({ success: true, config });
    } catch (err) {
      console.error('[website-stats] config read error:', err);
      res.status(500).json({ success: false, error: 'Failed to load analytics configuration' });
    }
  },
);

router.put(
  '/website-stats/config',
  requireRole(['super_admin', 'admin']),
  async (req, res) => {
    try {
      const config = await saveAnalyticsConfig(req.body || {}, req.user?.id);
      res.json({ success: true, config });
    } catch (err) {
      console.error('[website-stats] config save error:', err);
      res.status(500).json({ success: false, error: 'Failed to save analytics configuration' });
    }
  },
);

router.post(
  '/website-stats/config/test',
  requireRole(['super_admin', 'admin']),
  async (req, res) => {
    try {
      if (req.body && Object.keys(req.body).length > 0) {
        const current = await loadAnalyticsConfig({ includeSecrets: true });
        const merged = {
          ...current,
          ...req.body,
          plausible: { ...current.plausible, ...(req.body.plausible || {}) },
          umami: { ...current.umami, ...(req.body.umami || {}) },
          ga4: { ...current.ga4, ...(req.body.ga4 || {}) },
        };
        if (req.body.plausible?.api_key === '__UNCHANGED__') {
          merged.plausible.api_key = current.plausible.api_key;
        }
        if (req.body.umami?.api_token === '__UNCHANGED__') {
          merged.umami.api_token = current.umami.api_token;
        }
        const result = await testAnalyticsConnection(merged);
        return res.json(result);
      }
      const result = await testAnalyticsConnection();
      return res.json(result);
    } catch (err) {
      console.error('[website-stats] config test error:', err);
      res.status(500).json({ ok: false, message: 'Connection test failed' });
    }
  },
);

router.get(
  '/website-stats',
  requireRole(['super_admin', 'admin']),
  async (req, res) => {
    const period = String(req.query.period || '7d');
    const segment = normalizeSegment(req.query.segment);

    try {
      const runtimeConfig = await loadAnalyticsConfig();
      const provider = runtimeConfig.provider;

      if (!runtimeConfig.stats_configured) {
        return res.status(503).json({
          configured: false,
          provider,
          segment,
          tracker_configured: runtimeConfig.tracker_configured,
          message: runtimeConfig.tracker_configured
            ? 'Public tracking is active. Add your provider API credentials below to load Website Stats.'
            : 'Analytics is not fully configured yet. Use the settings panel below to choose a provider and credentials.',
          config_available: true,
        });
      }

      const secretsConfig = await loadAnalyticsConfig({ includeSecrets: true });
      const period_for_provider =
        provider === 'plausible' ? PLAUSIBLE_PERIODS[period] || '7d' : period;
      const data =
        provider === 'plausible'
          ? await fetchPlausible(period_for_provider, segment, secretsConfig)
          : await fetchUmami(period, segment, secretsConfig);
      res.json({ configured: true, ...data });
    } catch (err) {
      console.error('[website-stats] provider error:', err);
      res.status(502).json({
        configured: true,
        provider: (await loadAnalyticsConfig()).provider,
        segment,
        error: 'analytics provider request failed',
        detail: String(err?.message || err).replace(/Bearer\s+\S+/g, 'Bearer <redacted>'),
      });
    }
  },
);

module.exports = router;
