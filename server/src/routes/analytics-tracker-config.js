/**
 * Public analytics tracker bootstrap — no secrets, cache-friendly.
 * GET /api/analytics/tracker-config
 */

const express = require('express');
const {
  loadAnalyticsConfig,
  getPublicTrackerConfig,
} = require('../services/analyticsConfigService');

const router = express.Router();

router.get('/tracker-config', async (_req, res) => {
  try {
    const config = await loadAnalyticsConfig();
    const tracker = getPublicTrackerConfig(config);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      ...tracker,
      source: 'settings',
      stats_configured: config.stats_configured,
    });
  } catch (err) {
    console.error('[analytics] tracker-config error:', err);
    res.json({ provider: 'none', enabled: false, source: 'error' });
  }
});

module.exports = router;
