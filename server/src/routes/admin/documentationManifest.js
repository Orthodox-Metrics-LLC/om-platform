/**
 * /api/admin/documentation-manifest — read-only proxy to OMStudio documentation authority.
 * Mirrors ecosystemRoadmap.js empty-state contract (always HTTP 200 for admin callers).
 */

const express = require('express');
const { requireRole } = require('../../middleware/auth');
const { fetchDocumentationManifestProxy } = require('../../services/documentationManifestService');

const router = express.Router();

router.get(
  '/documentation-manifest',
  requireRole(['super_admin', 'admin']),
  async (_req, res) => {
    const result = await fetchDocumentationManifestProxy();
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
