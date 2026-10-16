/**
 * Latest News — public active campaigns only
 * GET /api/public/latest-news/active
 */
const express = require('express');
const { getAppPool } = require('../config/db');
const { loadActiveCampaigns } = require('./latest-news');

const router = express.Router();

router.get('/active', async (req, res) => {
  try {
    const pool = getAppPool();
    const campaigns = await loadActiveCampaigns(pool, new Date(), req.query.page_type || 'latest_news');
    res.json({ success: true, campaigns });
  } catch (err) {
    console.error('[latest-news-public] GET /active:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load active campaigns' });
  }
});

module.exports = router;
