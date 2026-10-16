/**
 * GET /api/admin/omstudio-dashboard
 * Read-only snapshot for the OM production OMStudio dashboard.
 * Same omsvc login as the other OMStudio proxies. Never returns secret values.
 */

const express = require('express');
const { requireRole } = require('../../middleware/auth');
const { fetchGovernance } = require('../../services/omstudioClient');
const { shapeStudioDashboard } = require('../../services/omstudioDashboard');

const router = express.Router();

router.get(
  '/omstudio-dashboard',
  requireRole(['super_admin']),
  async (_req, res) => {
    const [approvals, secrets, connections, health] = await Promise.all([
      fetchGovernance('/governance/brain/ui/approvals'),
      fetchGovernance('/system/secrets'),
      fetchGovernance('/platform-connections'),
      fetchGovernance('/platform-connections/health'),
    ]);

    if (!approvals.ok) {
      return res.status(200).json({
        available: false,
        error: approvals.error,
        detail: approvals.detail,
        upstream: approvals.upstream,
      });
    }

    const dashboard = shapeStudioDashboard({
      approvals: approvals.data?.approvals || [],
      secrets: secrets.ok ? (secrets.data?.secrets || []) : [],
      connections: connections.ok ? connections.data : null,
      health: health.ok ? health.data : null,
    });

    res.json({
      available: true,
      fetched_at: approvals.fetched_at,
      partial: {
        secrets: secrets.ok ? null : (secrets.error || 'unavailable'),
        connections: connections.ok ? null : (connections.error || 'unavailable'),
        health: health.ok ? null : (health.error || 'unavailable'),
      },
      ...dashboard,
    });
  },
);

module.exports = router;
