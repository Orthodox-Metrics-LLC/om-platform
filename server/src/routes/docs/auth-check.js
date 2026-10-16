/**
 * Docs Auth Check — nginx auth_request gate for /docs/internal/
 *
 * GET /api/docs/auth/check
 *   204 — authenticated OM session or JWT
 *   401 — not authenticated
 */

const express = require('express');
const { getAppPool } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

async function logDocsAccess(req) {
  const user = req.session?.user || req.user;
  if (!user?.email) return;

  try {
    const pool = getAppPool();
    const path = req.get('X-Original-URI') || req.get('X-Docs-Path') || req.originalUrl;
    await pool.query(
      `INSERT INTO system_logs (timestamp, level, source, message, meta, user_email, service)
       VALUES (NOW(), 'info', 'docs-auth', ?, ?, ?, 'om-docs')`,
      [
        `Internal docs access: ${path}`,
        JSON.stringify({ path, method: req.method, ip: req.ip }),
        user.email,
      ]
    );
  } catch (err) {
    console.error('[docs-auth] audit log failed:', err.message);
  }
}

router.get('/check', requireAuth, async (req, res) => {
  await logDocsAccess(req);
  res.status(204).send();
});

module.exports = router;
