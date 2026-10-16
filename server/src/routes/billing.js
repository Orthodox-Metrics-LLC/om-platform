/**
 * Public billing API — /api/billing
 */
const express = require('express');
const router = express.Router();
const stripeBilling = require('../services/stripeBillingService');

router.get('/config', (_req, res) => {
  res.json({ success: true, ...stripeBilling.publicConfig() });
});

// Public pricing-page checkout — turns selected plan keys into a Stripe Checkout URL.
router.post('/checkout', async (req, res) => {
  try {
    const plans = Array.isArray(req.body?.plans)
      ? req.body.plans.filter((p) => typeof p === 'string')
      : [];
    if (!plans.length) {
      return res.status(400).json({ success: false, error: 'plans required' });
    }
    const result = await stripeBilling.createPublicCheckoutSession(plans);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[billing] public checkout failed:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
module.exports.webhookHandler = stripeBilling.webhookHandler;
