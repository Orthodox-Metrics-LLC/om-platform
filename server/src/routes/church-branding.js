'use strict';

/**
 * /api/church-branding/header/:churchId
 *
 * Lightweight church-metadata endpoint used by the front-end's
 * ChurchContext to render the church header (name, logo, theme color,
 * calendar type) on every page that loads church-scoped data.
 *
 * The front-end has been calling this path since long before this
 * router existed — the only mount under "/church-branding" was a
 * static-file server for uploaded logos, with no "/api" prefix. So
 * every page that initialised ChurchContext logged a "Failed to fetch
 * church data" 404 in the console. Harmless (ChurchContext fell back
 * to "System Admin" defaults), but noisy.
 *
 * Schema-shape mapping:
 *   churches.id              -> church_id
 *   churches.church_name     -> church_name
 *   churches.name            -> church_name_display (operators have set
 *                               either column over the years)
 *   churches.logo_path       -> logo_url
 *   churches.primary_color   -> primary_theme_color
 *   churches.database_name   -> database_name
 *   churches.calendar_type   -> calendar_type
 *
 * Read-only. requireAuth so we don't hand church metadata out to
 * anonymous callers (matches the rest of /api/churches/*).
 */

const express = require('express');
const router = express.Router();
const { getAppPool } = require('../config/db-compat');
const { getTenantPool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const banners = require('../services/churchProfileBanners');

router.get('/header/:churchId', requireAuth, async (req, res) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    if (!Number.isFinite(churchId) || churchId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid church id' });
    }

    const [rows] = await getAppPool().query(
      `SELECT id           AS church_id,
              church_name  AS church_name,
              name         AS church_name_display,
              logo_path    AS logo_url,
              primary_color AS primary_theme_color,
              database_name,
              calendar_type
         FROM churches
        WHERE id = ?
        LIMIT 1`,
      [churchId],
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Church not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[church-branding] /header error:', err && err.message ? err.message : err);
    res.status(500).json({ success: false, error: 'Failed to load church metadata' });
  }
});

/**
 * Appearance (om-platform sidebar card + Account → Appearance).
 *   GET /api/church-branding/appearance[?church_id=]  → church image, display name, city/state
 *   PUT /api/church-branding/appearance               → church_admin/manager/priest/deacon of the
 *                                                        church, or super_admin/admin (?church_id)
 * Stores into existing columns: churches.name (display), logo_path (image URL), city, state_province.
 */
const APPEARANCE_WRITE_ROLES = new Set(['church_admin', 'manager', 'priest', 'deacon']);
const PLATFORM = new Set(['super_admin', 'admin']);

async function appearanceContext(req) {
  const uid = req.user?.id || req.session?.user?.id;
  const [[u]] = await getAppPool().query('SELECT id, role, church_id FROM users WHERE id = ? AND is_active = 1', [uid]);
  if (!u) return { error: { status: 403, message: 'Account is not active' } };
  const platform = PLATFORM.has(u.role);
  const churchId = platform ? Number(req.query.church_id || req.body?.church_id || u.church_id) : u.church_id;
  if (!churchId) return { error: { status: 400, message: platform ? 'church_id is required' : 'Your account is not assigned to a church' } };
  if (!platform && u.church_id !== churchId) return { error: { status: 403, message: 'Not your church' } };
  return { user: u, churchId, canWrite: platform || APPEARANCE_WRITE_ROLES.has(u.role) };
}

function shapeAppearance(row, canWrite) {
  return {
    church_id: row.id,
    name: row.church_name || row.name,
    display_name: row.name || row.church_name,
    short_name: row.short_name,
    city: row.city,
    state: row.state_province,
    image_url: row.logo_path || null,
    // Small square icon — shown in the parish switcher chip and Parish
    // Settings, distinct from the portrait "sidebar card" image above.
    icon_url: row.favicon_path || null,
    primary_color: row.primary_color || null,
    can_write: !!canWrite,
  };
}

router.get('/appearance', requireAuth, async (req, res) => {
  try {
    const ctx = await appearanceContext(req);
    if (ctx.error) return res.status(ctx.error.status).json({ success: false, message: ctx.error.message });
    const [[row]] = await getAppPool().query('SELECT id, name, church_name, short_name, city, state_province, logo_path, favicon_path, primary_color FROM churches WHERE id = ?', [ctx.churchId]);
    if (!row) return res.status(404).json({ success: false, message: 'Church not found' });
    res.json({ success: true, appearance: shapeAppearance(row, ctx.canWrite) });
  } catch (err) {
    console.error('[church-branding] GET /appearance:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load appearance' });
  }
});

router.put('/appearance', requireAuth, async (req, res) => {
  try {
    const ctx = await appearanceContext(req);
    if (ctx.error) return res.status(ctx.error.status).json({ success: false, message: ctx.error.message });
    if (!ctx.canWrite) return res.status(403).json({ success: false, message: 'Only church administrators and clergy can change the parish appearance' });
    const sets = []; const vals = [];
    const b = req.body || {};
    if (b.display_name !== undefined) { const v = String(b.display_name).trim(); if (!v) return res.status(400).json({ success: false, message: 'Church name is required' }); sets.push('name = ?'); vals.push(v); }
    if (b.city !== undefined) { sets.push('city = ?'); vals.push(String(b.city).trim() || null); }
    if (b.state !== undefined) { sets.push('state_province = ?'); vals.push(String(b.state).trim() || null); }
    if (b.image_url !== undefined) {
      const v = b.image_url ? String(b.image_url) : null;
      if (v && !/^\/api\/om\/media\/(platform|church_\d+)\/[\w-]+$/.test(v) && !/^https?:\/\//.test(v)) return res.status(400).json({ success: false, message: 'Invalid image URL' });
      sets.push('logo_path = ?'); vals.push(v);
    }
    if (b.icon_url !== undefined) {
      const v = b.icon_url ? String(b.icon_url) : null;
      if (v && !/^\/api\/om\/media\/(platform|church_\d+)\/[\w-]+$/.test(v) && !/^https?:\/\//.test(v)) return res.status(400).json({ success: false, message: 'Invalid icon URL' });
      sets.push('favicon_path = ?'); vals.push(v);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
    vals.push(ctx.churchId);
    await getAppPool().query(`UPDATE churches SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, vals);
    const [[row]] = await getAppPool().query('SELECT id, name, church_name, short_name, city, state_province, logo_path, favicon_path, primary_color FROM churches WHERE id = ?', [ctx.churchId]);
    res.json({ success: true, appearance: shapeAppearance(row, true) });
  } catch (err) {
    console.error('[church-branding] PUT /appearance:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save appearance' });
  }
});

/**
 * GET /api/church-branding/workspaces — parishes the signed-in user can act in
 * (their own church, or every church a platform admin oversees) with plan badge.
 * Backs the om-platform header "parish switcher".
 */
router.get('/workspaces', requireAuth, async (req, res) => {
  try {
    const uid = req.user?.id || req.session?.user?.id;
    const [[u]] = await getAppPool().query('SELECT id, role, church_id FROM users WHERE id = ? AND is_active = 1', [uid]);
    if (!u) return res.status(403).json({ success: false, message: 'Account is not active' });
    let where = "c.database_name IS NOT NULL AND c.database_name <> ''";
    const params = [];
    if (u.role === 'super_admin') { /* all */ }
    else if (u.role === 'admin') {
      const [rows] = await getAppPool().query(
        "SELECT ur.church_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.name = 'admin' AND ur.church_id IS NOT NULL", [u.id]);
      const ids = rows.map((r) => r.church_id);
      if (!ids.length) return res.json({ success: true, role: u.role, workspaces: [] });
      where += ' AND c.id IN (?)'; params.push(ids);
    } else {
      if (!u.church_id) return res.json({ success: true, role: u.role, workspaces: [] });
      where = 'c.id = ?'; params.push(u.church_id);
    }
    const [rows] = await getAppPool().query(
      `SELECT c.id, c.name, c.church_name, c.city, c.state_province, c.jurisdiction, c.logo_path, c.favicon_path, c.plan_max_storage_gb,
              s.status AS sub_status, bp.name_multilang AS plan_name, bp.plan_code
         FROM churches c
         LEFT JOIN subscriptions s ON s.church_id = c.id AND s.status IN ('active','trialing','trial','past_due')
         LEFT JOIN billing_plans bp ON bp.id = s.plan_id
        WHERE ${where}
        GROUP BY c.id
        ORDER BY COALESCE(c.name, c.church_name)`, params);
    const planLabel = (r) => {
      if (!r.plan_name) return 'Free';
      try { const j = JSON.parse(r.plan_name); return j.en || Object.values(j)[0] || r.plan_code || 'Plan'; } catch { return r.plan_name || r.plan_code || 'Plan'; }
    };
    res.json({
      success: true,
      role: u.role,
      home_church_id: u.church_id,
      workspaces: rows.map((r) => ({
        id: r.id, name: r.name || r.church_name, city: r.city, state: r.state_province, jurisdiction: r.jurisdiction,
        image_url: r.logo_path || null, icon_url: r.favicon_path || null, plan: planLabel(r), plan_status: r.sub_status || null,
      })),
    });
  } catch (err) {
    console.error('[church-branding] GET /workspaces:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load parishes' });
  }
});

/**
 * Profile banners members of this parish can choose on /dashboard/user.
 *   GET    /api/church-branding/profile-banners[?church_id=]
 *   POST   /api/church-branding/profile-banners   { file_url, church_id? }
 *   DELETE /api/church-branding/profile-banners/:id[?church_id=]
 * Read: any member of the church. Write: church_admin / manager / priest / deacon
 * (and platform roles acting on ?church_id=), same as parish appearance. Max 12.
 */
function bannerPayload(list, canWrite) {
  return { success: true, banners: list, can_write: !!canWrite, max: banners.MAX_BANNERS };
}

router.get('/profile-banners', requireAuth, async (req, res) => {
  try {
    const ctx = await appearanceContext(req);
    if (ctx.error) return res.status(ctx.error.status).json({ success: false, message: ctx.error.message });
    const list = await banners.listBanners(getTenantPool(ctx.churchId), ctx.churchId);
    res.json(bannerPayload(list, ctx.canWrite));
  } catch (err) {
    console.error('[church-branding] GET /profile-banners:', err.message);
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Failed to load profile banners' });
  }
});

router.post('/profile-banners', requireAuth, async (req, res) => {
  try {
    const ctx = await appearanceContext(req);
    if (ctx.error) return res.status(ctx.error.status).json({ success: false, message: ctx.error.message });
    if (!ctx.canWrite) return res.status(403).json({ success: false, message: 'Only church administrators and clergy can add profile banners' });
    const list = await banners.addBanner(
      getTenantPool(ctx.churchId),
      ctx.churchId,
      ctx.user.id,
      req.body?.file_url,
      { allowPlatform: PLATFORM.has(ctx.user.role) }
    );
    res.json(bannerPayload(list, true));
  } catch (err) {
    console.error('[church-branding] POST /profile-banners:', err.message);
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Failed to add profile banner' });
  }
});

router.delete('/profile-banners/:id', requireAuth, async (req, res) => {
  try {
    const ctx = await appearanceContext(req);
    if (ctx.error) return res.status(ctx.error.status).json({ success: false, message: ctx.error.message });
    if (!ctx.canWrite) return res.status(403).json({ success: false, message: 'Only church administrators and clergy can remove profile banners' });
    const bannerId = Number(req.params.id);
    if (!Number.isInteger(bannerId) || bannerId <= 0) return res.status(400).json({ success: false, message: 'Invalid banner id' });
    const list = await banners.removeBanner(getTenantPool(ctx.churchId), ctx.churchId, bannerId);
    res.json(bannerPayload(list, true));
  } catch (err) {
    console.error('[church-branding] DELETE /profile-banners:', err.message);
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Failed to remove profile banner' });
  }
});

module.exports = router;
