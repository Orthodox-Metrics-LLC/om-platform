'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { acceptDomainEvent } = require('../services/notificationWorkflow');
const smsChannel = require('../services/notificationChannels/smsChannel');
const { sendOperatorSmsTest } = require('../services/notificationChannels/sms/operatorTest');

const router = Router();

function tokensMatch(presented, expected) {
  const a = Buffer.from(String(presented));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireWorkflowToken(req, res, next) {
  const expected = process.env.NOTIFICATION_WORKFLOW_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'workflow_not_configured' });
  }
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !tokensMatch(match[1], expected)) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  return next();
}

router.get('/notification-transport/health', requireWorkflowToken, (req, res) => {
  res.json(smsChannel.health());
});

router.post('/notification-transport/sms-test', requireWorkflowToken, async (req, res, next) => {
  try {
    const result = await sendOperatorSmsTest();
    if (!result.ok && result.error === 'sms_transport_unconfigured') return res.status(503).json(result);
    if (!result.ok) return res.status(400).json(result);
    return res.status(202).json(result);
  } catch (err) {
    return next(err);
  }
});

router.post('/domain-events', requireWorkflowToken, async (req, res, next) => {
  try {
    const result = await acceptDomainEvent(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    return res.status(202).json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
