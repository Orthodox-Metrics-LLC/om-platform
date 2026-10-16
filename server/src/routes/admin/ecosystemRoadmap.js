/**
 * /api/admin/ecosystem-roadmap — read-only proxy to the canonical Component
 * Maturity Roadmap hosted by OMStudio (OMSD-1590).
 *
 * Auth flow:
 *   OM logs in as an omsvc service identity against OMStudio's /api/auth/login,
 *   caches the resulting JWT in-memory (OMStudio TTL is 8h), and uses it as
 *   the bearer for /api/governance/component-roadmap. On a 401 we clear the
 *   cache and retry once. No human or session credential is ever forwarded.
 *
 * Response contract:
 *   This proxy ALWAYS returns HTTP 200 unless the OM-side auth gate (super_admin
 *   / admin) blocks the caller. When the upstream is misbehaving, unreachable,
 *   or hasn't yet published the endpoint, we return:
 *
 *     { available: false, upstream, error: <code>, detail }
 *
 * Required config — see services/omstudioClient.js.
 *
 * OM is intentionally NOT canonical — the page is read-only and we never
 * persist the response.
 */

const express = require('express');
const { requireRole } = require('../../middleware/auth');
const { fetchGovernance } = require('../../services/omstudioClient');

const router = express.Router();

router.get(
  '/ecosystem-roadmap',
  requireRole(['super_admin', 'admin']),
  async (_req, res) => {
    const result = await fetchGovernance('/governance/component-roadmap');
    if (!result.ok) {
      return res.status(200).json(result);
    }
    res.json({
      available: true,
      upstream: result.upstream,
      fetched_at: result.fetched_at,
      data: result.data,
    });
  },
);

module.exports = router;
