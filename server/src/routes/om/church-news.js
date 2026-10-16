/**
 * /api/om/church-news — single publishable "Church News" page per tenant
 * (MyOM → Parish Portal → Church News on om-platform).
 *
 * Data lives in each tenant DB (om_church_##.church_news_page /
 * church_news_media); media references that tenant's own fm_files (see
 * routes/om/files.js). One page per church — enforced by a UNIQUE KEY on
 * church_id (see database/migrations/20260930_tenant_church_news.sql).
 *
 * Roles
 *   super_admin/admin                 any church (?church_id=), for support
 *   church_admin/priest/deacon        full control of their own church's page
 *   other church roles                read only (any authenticated user
 *                                      under that church's tenant DB)
 */
const express = require('express');
const { promisePool, getTenantPool } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

const PLATFORM_ROLES = ['super_admin', 'admin'];
const CHURCH_WRITE_ROLES = ['church_admin', 'priest', 'deacon'];

const getUserId = (req) => req.user?.id || req.session?.user?.id;

async function loadActor(id) {
  const [rows] = await promisePool.query(
    `SELECT id, email, role, church_id FROM orthodoxmetrics_db.users WHERE id = ? AND is_active = 1 AND account_status = 'active'`,
    [id]
  );
  return rows[0] || null;
}

async function adminChurchIds(adminId) {
  const [rows] = await promisePool.query(
    `SELECT ur.church_id FROM orthodoxmetrics_db.user_roles ur
     JOIN orthodoxmetrics_db.roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND r.name = 'admin' AND ur.church_id IS NOT NULL`,
    [adminId]
  );
  return rows.map((r) => r.church_id);
}

/** Resolve {actor, churchId, pool, canWrite} or throw {status, message}. */
async function resolveContext(req, requestedChurchId) {
  const actor = await loadActor(getUserId(req));
  if (!actor) throw Object.assign(new Error('Account is not active'), { status: 403 });

  const isPlatform = PLATFORM_ROLES.includes(actor.role);
  const churchId = isPlatform ? Number(requestedChurchId || actor.church_id) : actor.church_id;
  if (!churchId) throw Object.assign(new Error(isPlatform ? 'church_id is required' : 'Your account is not assigned to a church'), { status: 400 });

  if (actor.role === 'admin') {
    const allowed = await adminChurchIds(actor.id);
    if (!allowed.includes(churchId)) throw Object.assign(new Error('You are not responsible for this church'), { status: 403 });
  } else if (!isPlatform && actor.church_id !== churchId) {
    throw Object.assign(new Error('Not your church'), { status: 403 });
  }

  return {
    actor,
    churchId,
    pool: getTenantPool(churchId),
    canWrite: isPlatform || CHURCH_WRITE_ROLES.includes(actor.role),
  };
}

function serializePage(row, media) {
  if (!row) return null;
  return {
    id: row.id,
    church_id: row.church_id,
    title: row.title,
    body: row.body,
    status: row.status,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    media: (media || []).map((m) => ({
      id: m.id,
      fm_file_id: m.fm_file_id,
      caption: m.caption,
      sort_order: m.sort_order,
      file_url: m.storage_path,
      file_name: m.name,
      mime_type: m.mime_type,
    })),
  };
}

async function loadPage(pool, churchId) {
  const [rows] = await pool.query('SELECT * FROM church_news_page WHERE church_id = ?', [churchId]);
  if (!rows.length) return null;
  const [media] = await pool.query(
    `SELECT cnm.id, cnm.fm_file_id, cnm.caption, cnm.sort_order, f.storage_path, f.name, f.mime_type
     FROM church_news_media cnm JOIN fm_files f ON f.id = cnm.fm_file_id
     WHERE cnm.page_id = ? ORDER BY cnm.sort_order ASC, cnm.id ASC`,
    [rows[0].id]
  );
  return serializePage(rows[0], media);
}

// ── Read: any authenticated user of the church (or platform via ?church_id=) ─

router.get('/', requireAuth, async (req, res) => {
  try {
    const ctx = await resolveContext(req, req.query.church_id);
    const page = await loadPage(ctx.pool, ctx.churchId);
    res.json({ success: true, page, can_write: ctx.canWrite });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || 'Failed to load church news' });
  }
});

// ── Write: church_admin/priest/deacon (or platform) ───────────────────────

router.put('/', requireAuth, async (req, res) => {
  try {
    const ctx = await resolveContext(req, req.body?.church_id);
    if (!ctx.canWrite) return res.status(403).json({ success: false, message: 'Only priest, deacon, or church admin may edit Church News' });

    const title = String(req.body?.title || 'Church News').trim().slice(0, 255);
    const body = req.body?.body != null ? String(req.body.body) : null;
    const publish = req.body?.publish === true;

    const [existing] = await ctx.pool.query('SELECT id FROM church_news_page WHERE church_id = ?', [ctx.churchId]);
    if (existing.length) {
      await ctx.pool.query(
        `UPDATE church_news_page SET title = ?, body = ?, status = ?, published_at = ${publish ? 'NOW()' : 'published_at'}, updated_by = ?
         WHERE church_id = ?`,
        [title, body, publish ? 'published' : 'draft', ctx.actor.id, ctx.churchId]
      );
    } else {
      await ctx.pool.query(
        `INSERT INTO church_news_page (church_id, title, body, status, published_at, created_by)
         VALUES (?, ?, ?, ?, ${publish ? 'NOW()' : 'NULL'}, ?)`,
        [ctx.churchId, title, body, publish ? 'published' : 'draft', ctx.actor.id]
      );
    }

    res.json({ success: true, page: await loadPage(ctx.pool, ctx.churchId) });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || 'Failed to save church news' });
  }
});

router.post('/media', requireAuth, async (req, res) => {
  try {
    const ctx = await resolveContext(req, req.body?.church_id);
    if (!ctx.canWrite) return res.status(403).json({ success: false, message: 'Only priest, deacon, or church admin may edit Church News' });

    const fmFileId = parseInt(req.body?.fm_file_id, 10);
    if (!fmFileId) return res.status(400).json({ success: false, message: 'fm_file_id is required' });

    const [pageRows] = await ctx.pool.query('SELECT id FROM church_news_page WHERE church_id = ?', [ctx.churchId]);
    if (!pageRows.length) return res.status(400).json({ success: false, message: 'Save the page before attaching media' });
    const pageId = pageRows[0].id;

    const [[{ n: sortOrder }]] = await ctx.pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM church_news_media WHERE page_id = ?',
      [pageId]
    );
    await ctx.pool.query(
      'INSERT INTO church_news_media (page_id, fm_file_id, caption, sort_order) VALUES (?, ?, ?, ?)',
      [pageId, fmFileId, req.body?.caption || null, sortOrder]
    );

    res.status(201).json({ success: true, page: await loadPage(ctx.pool, ctx.churchId) });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || 'Failed to attach media' });
  }
});

router.delete('/media/:id', requireAuth, async (req, res) => {
  try {
    const ctx = await resolveContext(req, req.query.church_id);
    if (!ctx.canWrite) return res.status(403).json({ success: false, message: 'Only priest, deacon, or church admin may edit Church News' });

    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    await ctx.pool.query(
      `DELETE cnm FROM church_news_media cnm JOIN church_news_page p ON p.id = cnm.page_id
       WHERE cnm.id = ? AND p.church_id = ?`,
      [id, ctx.churchId]
    );
    res.json({ success: true, page: await loadPage(ctx.pool, ctx.churchId) });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || 'Failed to remove media' });
  }
});

module.exports = router;
