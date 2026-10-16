/**
 * OM Header Image Settings — /api/admin/header-image-settings
 *
 * Platform-wide (not per-church) setting controlling which image renders at
 * the top-left of the OM sidebar/menu (layouts/full/shared/logo/Logo.tsx).
 * Up to 3 slots can be uploaded; one is "active" at a time.
 *
 * Storage: the uploaded image files themselves live in the existing OM
 * Assets Library (scope=site, category=logo, visibility=authenticated) —
 * uploaded via the existing POST /api/assets endpoint, not duplicated here.
 * This route only tracks which asset id occupies each of the 3 slots and
 * which slot is active, via the generic system_settings key-value table.
 *
 * Read is open to any authenticated user (the sidebar renders for everyone);
 * writes (assigning a slot, changing the active slot) require super_admin.
 */

const express = require('express');
const router = express.Router();
const { getAppPool } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');

const SETTING_KEY = 'om_header_image_config';
const SLOT_COUNT = 3;

function defaultConfig() {
  return { slots: [null, null, null], activeSlot: null };
}

async function readConfig() {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT value_multilang FROM system_settings WHERE key_name = ?',
    [SETTING_KEY],
  );
  if (!rows.length) return defaultConfig();
  try {
    const parsed = JSON.parse(rows[0].value_multilang);
    const slots = Array.isArray(parsed.slots) && parsed.slots.length === SLOT_COUNT
      ? parsed.slots
      : defaultConfig().slots;
    const activeSlot = Number.isInteger(parsed.activeSlot) ? parsed.activeSlot : null;
    return { slots, activeSlot };
  } catch {
    return defaultConfig();
  }
}

async function writeConfig(config) {
  const pool = getAppPool();
  const jsonValue = JSON.stringify(config);
  await pool.query(
    `INSERT INTO system_settings (key_name, value_multilang, data_type, category, is_public)
     VALUES (?, ?, 'json', 'branding', 1)
     ON DUPLICATE KEY UPDATE value_multilang = ?, updated_at = NOW()`,
    [SETTING_KEY, jsonValue, jsonValue],
  );
}

/** GET / — current slot assignments + active slot. Any authenticated user. */
router.get('/', requireAuth, async (req, res) => {
  try {
    const config = await readConfig();
    res.json({ success: true, ...config });
  } catch (err) {
    console.error('[header-image-settings] GET /:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load header image settings' });
  }
});

router.use(requireAuth, requireRole(['super_admin']));

/** PUT /slot — assign (or clear) an asset id for a slot (1-3). */
router.put('/slot', async (req, res) => {
  try {
    const slot = Number(req.body.slot);
    const assetId = req.body.assetId === null || req.body.assetId === undefined
      ? null
      : Number(req.body.assetId);
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) {
      return res.status(400).json({ success: false, error: `slot must be 1-${SLOT_COUNT}` });
    }
    if (assetId !== null && (!Number.isInteger(assetId) || assetId <= 0)) {
      return res.status(400).json({ success: false, error: 'assetId must be a positive integer or null' });
    }
    const config = await readConfig();
    config.slots[slot - 1] = assetId;
    if (assetId === null && config.activeSlot === slot) config.activeSlot = null;
    await writeConfig(config);
    res.json({ success: true, ...config });
  } catch (err) {
    console.error('[header-image-settings] PUT /slot:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update header image slot' });
  }
});

/** PUT /active — set which slot (1-3, or null) is currently displayed. */
router.put('/active', async (req, res) => {
  try {
    const slot = req.body.slot === null || req.body.slot === undefined ? null : Number(req.body.slot);
    if (slot !== null && (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT)) {
      return res.status(400).json({ success: false, error: `slot must be 1-${SLOT_COUNT} or null` });
    }
    const config = await readConfig();
    if (slot !== null && !config.slots[slot - 1]) {
      return res.status(400).json({ success: false, error: 'That slot has no image uploaded yet' });
    }
    config.activeSlot = slot;
    await writeConfig(config);
    res.json({ success: true, ...config });
  } catch (err) {
    console.error('[header-image-settings] PUT /active:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update active header image' });
  }
});

module.exports = router;
