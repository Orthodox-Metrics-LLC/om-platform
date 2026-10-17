const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getAppPool } = require('../config/db-compat');
const { runResource } = require('../services/omViewerEngine');
const { createCemeteryHandlers } = require('../services/portalCemeteryRecords');

const router = express.Router();
const handlers = createCemeteryHandlers({ pool: getAppPool(), runResource });

router.use(requireAuth);
router.post('/', express.json({ limit: '2mb' }), handlers.handle);

module.exports = router;
