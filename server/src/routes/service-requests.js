'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { acknowledgeServiceRequest } = require('../services/notificationWorkflow');

const router = Router();

router.post('/service-requests/:ref/acknowledge', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await acknowledgeServiceRequest({
      work_item_type: body.work_item_type || 'brain_approval',
      work_item_ref: req.params.ref,
      user_id: req.user && req.user.id,
      actor: req.user && req.user.email,
    });
    if (!result.ok && result.error === 'not_found') return res.status(404).json(result);
    if (!result.ok && result.error === 'not_assignee') return res.status(403).json(result);
    if (!result.ok && result.error === 'closed') return res.status(409).json(result);
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
