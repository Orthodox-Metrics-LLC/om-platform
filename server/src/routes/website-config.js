/**
 * Public + admin OM Website configuration.
 *
 * GET  /api/website/config          — public, no secrets (SPA consumption)
 * GET  /api/admin/website-config    — super_admin/admin read
 * PUT  /api/admin/website-config    — super_admin write (immediate global override)
 */

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  loadWebsiteConfig,
  getPublicWebsiteConfig,
  saveWebsiteConfig,
  getWebsiteSettingsAdminView,
} = require('../services/websiteConfigService');

const publicRouter = express.Router();
const adminRouter = express.Router();

publicRouter.get('/config', async (_req, res) => {
  try {
    const config = await loadWebsiteConfig();
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      ...getPublicWebsiteConfig(config),
      source: 'settings',
    });
  } catch (err) {
    console.error('[website-config] public read error:', err);
    res.json({
      liturgical_auto_theme_enabled: false,
      default_theme: 'PURPLE_THEME',
      liturgical_calendar_widget_enabled: true,
      seasonal_accents_enabled: true,
      source: 'error',
    });
  }
});

adminRouter.get(
  '/website-config',
  requireAuth,
  requireRole(['super_admin', 'admin']),
  async (_req, res) => {
    try {
      const view = await getWebsiteSettingsAdminView();
      res.json({ success: true, ...view });
    } catch (err) {
      console.error('[website-config] admin read error:', err);
      res.status(500).json({ success: false, error: 'Failed to load website configuration' });
    }
  },
);

adminRouter.put(
  '/website-config',
  requireAuth,
  requireRole(['super_admin']),
  async (req, res) => {
    try {
      const userId = req.session?.user?.id || req.user?.id || null;
      const config = await saveWebsiteConfig(req.body || {}, userId);
      res.json({
        success: true,
        config: getPublicWebsiteConfig(config),
        message: 'Website configuration updated',
      });
    } catch (err) {
      console.error('[website-config] admin save error:', err);
      res.status(400).json({ success: false, error: err.message || 'Failed to save website configuration' });
    }
  },
);

module.exports = { publicRouter, adminRouter };
