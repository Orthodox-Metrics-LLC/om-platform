/**
 * Factory for 410 Gone routers when legacy APIs are retired.
 */
const express = require('express');

function createRetiredRouter(label, replacement, retiredAt = '2026-06-15') {
  const router = express.Router({ mergeParams: true });
  router.all('*', (req, res) => {
    console.warn(`[Retired] ${req.method} ${req.originalUrl} — ${label}`);
    res.status(410).json({
      error: 'gone',
      message: `${label} was retired. Use ${replacement} instead.`,
      replacement,
      retired_at: retiredAt,
    });
  });
  return router;
}

module.exports = { createRetiredRouter };
