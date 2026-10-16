/**
 * Latest News Campaign Builder — admin + legacy compatibility
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getAppPool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  computeEffectiveStatus,
  isPubliclyVisible,
  validateCampaignFields,
  validateItemFields,
  slugify,
  excerptFromBody,
  suggestCtaLabel,
  LAYOUT_TYPES,
  ITEM_STATUSES,
  FILE_TYPES,
  PAGE_TYPES,
} = require('../services/latestNewsSchedulingService');
const { logLatestNewsAudit } = require('../services/latestNewsAuditService');

const router = express.Router();
const requirePublisher = requireRole(['super_admin', 'admin']);

const UPLOAD_DIR = path.join(__dirname, '../../../uploads/latest-news');
const UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const ALLOWED_VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);
const ALLOWED_DOC_EXT = new Set(['.pdf']);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const all = new Set([...ALLOWED_IMAGE_EXT, ...ALLOWED_VIDEO_EXT, ...ALLOWED_DOC_EXT]);
      const safe = all.has(ext) ? ext : '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safe}`);
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const ok = ALLOWED_IMAGE_EXT.has(ext) || ALLOWED_VIDEO_EXT.has(ext) || ALLOWED_DOC_EXT.has(ext);
    if (!ok) return cb(new Error('Allowed: JPG, PNG, GIF, WebP, MP4, WebM, MOV, PDF'));
    cb(null, true);
  },
});

function detectFileType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ALLOWED_VIDEO_EXT.has(ext)) return 'video';
  if (ALLOWED_DOC_EXT.has(ext)) return 'document';
  return 'image';
}

function serializeMedia(row) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    item_id: row.item_id,
    file_url: row.file_url,
    om_asset_id: row.om_asset_id || null,
    file_type: row.file_type,
    alt_text: row.alt_text,
    caption: row.caption,
    credit: row.credit,
    sort_order: row.sort_order,
    is_primary: !!row.is_primary,
    created_at: row.created_at,
  };
}

function parseJson(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function serializeItem(row) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    title: row.title,
    subtitle: row.subtitle,
    body: row.body,
    excerpt: row.excerpt,
    cta_label: row.cta_label,
    cta_url: row.cta_url,
    sort_order: row.sort_order,
    status: row.status,
    layout_type: row.layout_type,
    component_config: parseJson(row.component_config, {}),
    effects_config: parseJson(row.effects_config, {}),
    active: !!row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    media: row.media || [],
  };
}

function serializeCampaign(row, { includeAdmin = false, now = new Date() } = {}) {
  const effectiveStatus = computeEffectiveStatus(row, now);
  const base = {
    id: row.id,
    title: row.title,
    slug: row.slug,
    page_type: row.page_type || 'latest_news',
    published_version_id: row.published_version_id || null,
    summary: row.summary,
    visibility_start_at: row.visibility_start_at,
    visibility_end_at: row.visibility_end_at,
    timezone: row.timezone,
    publish_mode: row.publish_mode,
    rotation_enabled: !!row.rotation_enabled,
    rotation_interval_seconds: row.rotation_interval_seconds,
    display_priority: row.display_priority,
    show_on_homepage: !!row.show_on_homepage,
    show_in_parish_portal: !!row.show_in_parish_portal,
    items: (row.items || []).map(serializeItem),
    media: (row.campaign_media || []).map(serializeMedia),
  };

  if (includeAdmin) {
    return {
      ...base,
      status: row.status,
      effective_status: effectiveStatus,
      created_by: row.created_by,
      updated_by: row.updated_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  return { ...base, effective_status: effectiveStatus };
}

async function nextSortOrder(pool, table, whereSql = '', params = []) {
  const [rows] = await pool.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM ${table} ${whereSql}`,
    params
  );
  return rows[0]?.next_order ?? 0;
}

async function ensureUniqueSlug(pool, slug, excludeId = null) {
  let candidate = slug;
  let n = 0;
  for (;;) {
    const params = excludeId ? [candidate, excludeId] : [candidate];
    const sql = excludeId
      ? 'SELECT id FROM latest_news_campaigns WHERE slug = ? AND id != ? LIMIT 1'
      : 'SELECT id FROM latest_news_campaigns WHERE slug = ? LIMIT 1';
    const [rows] = await pool.query(sql, params);
    if (!rows.length) return candidate;
    n += 1;
    candidate = `${slug}-${n}`;
  }
}

async function loadCampaignById(pool, id, { includeAdmin = false, now = new Date() } = {}) {
  const [campaignRows] = await pool.query('SELECT * FROM latest_news_campaigns WHERE id = ?', [id]);
  if (!campaignRows.length) return null;
  const campaign = campaignRows[0];

  const [itemRows] = await pool.query(
    'SELECT * FROM latest_news_items WHERE campaign_id = ? ORDER BY sort_order ASC, id ASC',
    [id]
  );
  const [mediaRows] = await pool.query(
    'SELECT * FROM latest_news_media WHERE campaign_id = ? ORDER BY sort_order ASC, id ASC',
    [id]
  );

  const mediaByItem = new Map();
  const campaignMedia = [];
  for (const m of mediaRows) {
    if (m.item_id) {
      if (!mediaByItem.has(m.item_id)) mediaByItem.set(m.item_id, []);
      mediaByItem.get(m.item_id).push(m);
    } else {
      campaignMedia.push(m);
    }
  }

  campaign.items = itemRows.map((item) => ({
    ...item,
    media: mediaByItem.get(item.id) || [],
  }));
  campaign.campaign_media = campaignMedia;

  return serializeCampaign(campaign, { includeAdmin, now });
}

async function loadActiveCampaigns(pool, now = new Date(), pageType = 'latest_news') {
  const [campaignRows] = await pool.query(
    `SELECT * FROM latest_news_campaigns
     WHERE status IN ('live', 'scheduled') AND page_type = ?
     ORDER BY display_priority DESC, id DESC`,
    [PAGE_TYPES.includes(pageType) ? pageType : 'latest_news']
  );

  const visible = campaignRows.filter((c) => isPubliclyVisible(c, now));
  const results = [];
  for (const row of visible) {
    let full = await loadCampaignById(pool, row.id, { now });
    if (!full) continue;

    // Public output is the explicitly-published immutable snapshot. Editors may
    // continue changing the working campaign without leaking draft edits.
    if (row.published_version_id) {
      const [versions] = await pool.query(
        `SELECT snapshot FROM latest_news_page_versions
         WHERE id = ? AND campaign_id = ? AND status = 'published' LIMIT 1`,
        [row.published_version_id, row.id]
      );
      const snapshot = parseJson(versions[0]?.snapshot, null);
      if (snapshot) {
        full = {
          ...snapshot,
          id: row.id,
          slug: row.slug,
          page_type: row.page_type,
          published_version_id: row.published_version_id,
          effective_status: computeEffectiveStatus(row, now),
        };
      }
    }

    const activeItems = (full.items || []).filter((i) => i.active && i.status === 'active');
    if (!activeItems.length) continue;
    results.push({ ...full, items: activeItems });
  }
  return results;
}

function pickCampaignFields(body, existing = {}) {
  const fields = {};
  const keys = [
    'title', 'slug', 'summary', 'status', 'page_type', 'visibility_start_at', 'visibility_end_at',
    'timezone', 'publish_mode', 'rotation_enabled', 'rotation_interval_seconds',
    'display_priority', 'show_on_homepage', 'show_in_parish_portal',
  ];
  for (const key of keys) {
    if (body[key] !== undefined) fields[key] = body[key];
    else if (existing[key] !== undefined) fields[key] = existing[key];
  }
  return fields;
}

function pickItemFields(body, existing = {}) {
  const fields = {};
  const keys = [
    'title', 'subtitle', 'body', 'excerpt', 'cta_label', 'cta_url',
    'sort_order', 'status', 'layout_type', 'component_config', 'effects_config', 'active',
  ];
  for (const key of keys) {
    if (body[key] !== undefined) fields[key] = body[key];
    else if (existing[key] !== undefined) fields[key] = existing[key];
  }
  return fields;
}

// ── Content helpers ─────────────────────────────────────────────────

router.post('/helpers/content', requireAuth, requirePublisher, (req, res) => {
  const { title, body, notes, url } = req.body || {};
  const titleStr = String(title || '').trim();
  const bodyStr = String(body || notes || '').trim();
  res.json({
    success: true,
    slug: slugify(titleStr),
    summary: excerptFromBody(bodyStr, 160),
    excerpt: excerptFromBody(bodyStr, 200),
    cta_label: suggestCtaLabel(bodyStr, url),
    suggested_layout: bodyStr.length > 400 ? 'split' : (bodyStr.includes('![') ? 'image_grid' : 'card'),
  });
});

// ── Campaigns CRUD ──────────────────────────────────────────────────

router.get('/campaigns', requireAuth, requirePublisher, async (req, res) => {
  try {
    const pool = getAppPool();
    const now = new Date();
    const pageType = PAGE_TYPES.includes(req.query.page_type) ? req.query.page_type : null;
    const [rows] = await pool.query(
      pageType
        ? 'SELECT * FROM latest_news_campaigns WHERE page_type = ? ORDER BY display_priority DESC, updated_at DESC'
        : 'SELECT * FROM latest_news_campaigns ORDER BY display_priority DESC, updated_at DESC',
      pageType ? [pageType] : []
    );
    const campaigns = [];
    for (const row of rows) {
      campaigns.push(await loadCampaignById(pool, row.id, { includeAdmin: true, now }));
    }
    res.json({ success: true, campaigns });
  } catch (err) {
    console.error('[latest-news] GET /campaigns:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load campaigns' });
  }
});

router.post('/campaigns', requireAuth, requirePublisher, async (req, res) => {
  try {
    const fields = pickCampaignFields(req.body, {
      title: '',
      summary: null,
      status: 'draft',
      timezone: 'America/New_York',
      publish_mode: 'manual',
      rotation_enabled: 1,
      rotation_interval_seconds: 8,
      display_priority: 0,
      show_on_homepage: 0,
      show_in_parish_portal: 0,
    });
    fields.title = String(fields.title || '').trim();
    const validationError = validateCampaignFields(fields);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const pool = getAppPool();
    const rawSlug = fields.slug ? String(fields.slug).trim() : slugify(fields.title);
    const slug = await ensureUniqueSlug(pool, slugify(rawSlug));

    const [result] = await pool.query(
      `INSERT INTO latest_news_campaigns (
        title, slug, status, page_type, summary, visibility_start_at, visibility_end_at,
        timezone, publish_mode, rotation_enabled, rotation_interval_seconds,
        display_priority, show_on_homepage, show_in_parish_portal,
        created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fields.title,
        slug,
        ['draft', 'scheduled', 'live', 'expired', 'archived'].includes(fields.status) ? fields.status : 'draft',
        PAGE_TYPES.includes(fields.page_type) ? fields.page_type : 'latest_news',
        fields.summary || null,
        fields.visibility_start_at || null,
        fields.visibility_end_at || null,
        String(fields.timezone || 'America/New_York').slice(0, 64),
        ['manual', 'scheduled'].includes(fields.publish_mode) ? fields.publish_mode : 'manual',
        fields.rotation_enabled === false || fields.rotation_enabled === 0 ? 0 : 1,
        Math.max(3, Number(fields.rotation_interval_seconds) || 8),
        Number(fields.display_priority) || 0,
        fields.show_on_homepage === true || fields.show_on_homepage === 1 ? 1 : 0,
        fields.show_in_parish_portal === true || fields.show_in_parish_portal === 1 ? 1 : 0,
        req.user?.id || null,
        req.user?.id || null,
      ]
    );

    const campaign = await loadCampaignById(pool, result.insertId, { includeAdmin: true });
    await logLatestNewsAudit('create_campaign', { campaignId: result.insertId, userId: req.user?.id, changes: { title: fields.title, slug } });

    if (Array.isArray(req.body.items) && req.body.items.length) {
      for (let i = 0; i < req.body.items.length; i += 1) {
        const itemBody = req.body.items[i];
        await pool.query(
          `INSERT INTO latest_news_items (
            campaign_id, title, subtitle, body, excerpt, cta_label, cta_url,
            sort_order, status, layout_type, component_config, effects_config, active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            result.insertId,
            String(itemBody.title || fields.title).trim(),
            itemBody.subtitle || null,
            itemBody.body || null,
            itemBody.excerpt || excerptFromBody(itemBody.body, 200) || null,
            itemBody.cta_label || null,
            itemBody.cta_url || null,
            i,
            ITEM_STATUSES.includes(itemBody.status) ? itemBody.status : 'active',
            LAYOUT_TYPES.includes(itemBody.layout_type) ? itemBody.layout_type : 'card',
            JSON.stringify(itemBody.component_config || {}),
            JSON.stringify(itemBody.effects_config || {}),
            itemBody.active === false || itemBody.active === 0 ? 0 : 1,
          ]
        );
      }
    }

    res.status(201).json({ success: true, campaign: await loadCampaignById(pool, result.insertId, { includeAdmin: true }) });
  } catch (err) {
    console.error('[latest-news] POST /campaigns:', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to create campaign' });
  }
});

router.get('/campaigns/:id', requireAuth, requirePublisher, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const pool = getAppPool();
    const campaign = await loadCampaignById(pool, id, { includeAdmin: true });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.json({ success: true, campaign });
  } catch (err) {
    console.error('[latest-news] GET /campaigns/:id:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load campaign' });
  }
});

router.put('/campaigns/:id', requireAuth, requirePublisher, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const pool = getAppPool();
    const [existing] = await pool.query('SELECT * FROM latest_news_campaigns WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const row = existing[0];
    const fields = pickCampaignFields(req.body, row);
    fields.title = String(fields.title || '').trim();
    const validationError = validateCampaignFields(fields);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    let slug = row.slug;
    if (req.body.slug != null) {
      slug = await ensureUniqueSlug(pool, slugify(String(req.body.slug).trim(), id), id);
    }

    await pool.query(
      `UPDATE latest_news_campaigns SET
        title = ?, slug = ?, status = ?, page_type = ?, summary = ?,
        visibility_start_at = ?, visibility_end_at = ?, timezone = ?,
        publish_mode = ?, rotation_enabled = ?, rotation_interval_seconds = ?,
        display_priority = ?, show_on_homepage = ?, show_in_parish_portal = ?,
        updated_by = ?
       WHERE id = ?`,
      [
        fields.title,
        slug,
        ['draft', 'scheduled', 'live', 'expired', 'archived'].includes(fields.status) ? fields.status : row.status,
        PAGE_TYPES.includes(fields.page_type) ? fields.page_type : (row.page_type || 'latest_news'),
        fields.summary || null,
        fields.visibility_start_at || null,
        fields.visibility_end_at || null,
        String(fields.timezone || row.timezone || 'America/New_York').slice(0, 64),
        ['manual', 'scheduled'].includes(fields.publish_mode) ? fields.publish_mode : row.publish_mode,
        fields.rotation_enabled === false || fields.rotation_enabled === 0 ? 0 : 1,
        Math.max(3, Number(fields.rotation_interval_seconds) || row.rotation_interval_seconds || 8),
        Number.isFinite(Number(fields.display_priority)) ? Number(fields.display_priority) : row.display_priority,
        fields.show_on_homepage === true || fields.show_on_homepage === 1 ? 1 : 0,
        fields.show_in_parish_portal === true || fields.show_in_parish_portal === 1 ? 1 : 0,
        req.user?.id || null,
        id,
      ]
    );

    await logLatestNewsAudit('update_campaign', { campaignId: id, userId: req.user?.id, changes: { title: fields.title, status: fields.status } });
    res.json({ success: true, campaign: await loadCampaignById(pool, id, { includeAdmin: true }) });
  } catch (err) {
    console.error('[latest-news] PUT /campaigns/:id:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update campaign' });
  }
});

router.delete('/campaigns/:id', requireAuth, requirePublisher, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const pool = getAppPool();
    const [existing] = await pool.query('SELECT id FROM latest_news_campaigns WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Campaign not found' });

    await pool.query(
      `UPDATE latest_news_campaigns SET status = 'archived', updated_by = ? WHERE id = ?`,
      [req.user?.id || null, id]
    );
    await logLatestNewsAudit('archive_campaign', { campaignId: id, userId: req.user?.id });
    res.json({ success: true, archived: true });
  } catch (err) {
    console.error('[latest-news] DELETE /campaigns/:id:', err.message);
    res.status(500).json({ success: false, message: 'Failed to archive campaign' });
  }
});

// ── Items ───────────────────────────────────────────────────────────

router.post('/campaigns/:id/items', requireAuth, requirePublisher, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    if (!campaignId) return res.status(400).json({ success: false, message: 'Invalid campaign id' });
    const pool = getAppPool();
    const [campaign] = await pool.query('SELECT id FROM latest_news_campaigns WHERE id = ?', [campaignId]);
    if (!campaign.length) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const fields = pickItemFields(req.body, { title: '', status: 'active', layout_type: 'card', active: 1 });
    fields.title = String(fields.title || '').trim();
    const validationError = validateItemFields(fields);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const sortOrder = Number.isFinite(Number(fields.sort_order))
      ? Number(fields.sort_order)
      : await nextSortOrder(pool, 'latest_news_items', 'WHERE campaign_id = ?', [campaignId]);

    const [result] = await pool.query(
      `INSERT INTO latest_news_items (
        campaign_id, title, subtitle, body, excerpt, cta_label, cta_url,
        sort_order, status, layout_type, component_config, effects_config, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        campaignId,
        fields.title,
        fields.subtitle || null,
        fields.body || null,
        fields.excerpt || excerptFromBody(fields.body, 200) || null,
        fields.cta_label || null,
        fields.cta_url || null,
        sortOrder,
        ITEM_STATUSES.includes(fields.status) ? fields.status : 'active',
        LAYOUT_TYPES.includes(fields.layout_type) ? fields.layout_type : 'card',
        JSON.stringify(fields.component_config || {}),
        JSON.stringify(fields.effects_config || {}),
        fields.active === false || fields.active === 0 ? 0 : 1,
      ]
    );

    await logLatestNewsAudit('create_item', { campaignId, itemId: result.insertId, userId: req.user?.id });
    const [rows] = await pool.query('SELECT * FROM latest_news_items WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, item: serializeItem({ ...rows[0], media: [] }) });
  } catch (err) {
    console.error('[latest-news] POST items:', err.message);
    res.status(500).json({ success: false, message: 'Failed to create item' });
  }
});

router.put('/campaigns/:id/items/reorder', requireAuth, requirePublisher, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const order = req.body.order;
    if (!campaignId || !Array.isArray(order)) {
      return res.status(400).json({ success: false, message: 'order array required' });
    }
    const pool = getAppPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < order.length; i += 1) {
        const itemId = parseInt(order[i], 10);
        if (!itemId) continue;
        await conn.query(
          'UPDATE latest_news_items SET sort_order = ? WHERE id = ? AND campaign_id = ?',
          [i, itemId, campaignId]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    await logLatestNewsAudit('reorder_items', { campaignId, userId: req.user?.id, changes: { order } });
    res.json({ success: true });
  } catch (err) {
    console.error('[latest-news] PUT reorder:', err.message);
    res.status(500).json({ success: false, message: 'Failed to reorder items' });
  }
});

router.put('/items/:id', requireAuth, requirePublisher, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const pool = getAppPool();
    const [existing] = await pool.query('SELECT * FROM latest_news_items WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Item not found' });

    const row = existing[0];
    const fields = pickItemFields(req.body, row);
    fields.title = String(fields.title || '').trim();
    const validationError = validateItemFields(fields);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    await pool.query(
      `UPDATE latest_news_items SET
        title = ?, subtitle = ?, body = ?, excerpt = ?,
        cta_label = ?, cta_url = ?, sort_order = ?,
        status = ?, layout_type = ?, component_config = ?, effects_config = ?, active = ?
       WHERE id = ?`,
      [
        fields.title,
        fields.subtitle || null,
        fields.body || null,
        fields.excerpt || null,
        fields.cta_label || null,
        fields.cta_url || null,
        Number.isFinite(Number(fields.sort_order)) ? Number(fields.sort_order) : row.sort_order,
        ITEM_STATUSES.includes(fields.status) ? fields.status : row.status,
        LAYOUT_TYPES.includes(fields.layout_type) ? fields.layout_type : row.layout_type,
        JSON.stringify(parseJson(fields.component_config, {})),
        JSON.stringify(parseJson(fields.effects_config, {})),
        fields.active === false || fields.active === 0 ? 0 : 1,
        id,
      ]
    );

    const [mediaRows] = await pool.query('SELECT * FROM latest_news_media WHERE item_id = ? ORDER BY sort_order', [id]);
    const [rows] = await pool.query('SELECT * FROM latest_news_items WHERE id = ?', [id]);
    await logLatestNewsAudit('update_item', { campaignId: row.campaign_id, itemId: id, userId: req.user?.id });
    res.json({ success: true, item: serializeItem({ ...rows[0], media: mediaRows }) });
  } catch (err) {
    console.error('[latest-news] PUT /items/:id:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update item' });
  }
});

router.delete('/items/:id', requireAuth, requirePublisher, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const pool = getAppPool();
    const [existing] = await pool.query('SELECT campaign_id FROM latest_news_items WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Item not found' });
    await pool.query('DELETE FROM latest_news_items WHERE id = ?', [id]);
    await logLatestNewsAudit('delete_item', { campaignId: existing[0].campaign_id, itemId: id, userId: req.user?.id });
    res.json({ success: true });
  } catch (err) {
    console.error('[latest-news] DELETE /items/:id:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete item' });
  }
});

// ── Media ─────────────────────────────────────────────────────────

router.post('/media/upload', requireAuth, requirePublisher, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file provided' });
    }

    try {
      const campaignId = parseInt(req.body.campaign_id, 10);
      if (!campaignId) {
        return res.status(400).json({ success: false, message: 'campaign_id is required' });
      }
      const itemId = req.body.item_id ? parseInt(req.body.item_id, 10) : null;
      const pool = getAppPool();
      const [campaign] = await pool.query('SELECT id FROM latest_news_campaigns WHERE id = ?', [campaignId]);
      if (!campaign.length) {
        return res.status(404).json({ success: false, message: 'Campaign not found' });
      }

      const url = `/uploads/latest-news/${req.file.filename}`;
      const fileType = FILE_TYPES.includes(req.body.file_type)
        ? req.body.file_type
        : detectFileType(req.file.filename);
      const sortOrder = await nextSortOrder(
        pool,
        'latest_news_media',
        'WHERE campaign_id = ?' + (itemId ? ' AND item_id = ?' : ' AND item_id IS NULL'),
        itemId ? [campaignId, itemId] : [campaignId]
      );
      const isPrimary = req.body.is_primary === '1' || req.body.is_primary === true || req.body.is_primary === 'true' ? 1 : 0;

      if (isPrimary) {
        const where = itemId
          ? 'campaign_id = ? AND item_id = ?'
          : 'campaign_id = ? AND item_id IS NULL';
        const params = itemId ? [campaignId, itemId] : [campaignId];
        await pool.query(`UPDATE latest_news_media SET is_primary = 0 WHERE ${where}`, params);
      }

      const [result] = await pool.query(
        `INSERT INTO latest_news_media (
          campaign_id, item_id, file_url, file_type, alt_text, caption, credit, sort_order, is_primary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          campaignId,
          itemId,
          url,
          fileType,
          req.body.alt_text || null,
          req.body.caption || null,
          req.body.credit || null,
          sortOrder,
          isPrimary,
        ]
      );

      const [rows] = await pool.query('SELECT * FROM latest_news_media WHERE id = ?', [result.insertId]);
      await logLatestNewsAudit('upload_media', { campaignId, itemId, userId: req.user?.id, changes: { url } });
      res.status(201).json({ success: true, media: serializeMedia(rows[0]), url });
    } catch (e) {
      console.error('[latest-news] media upload:', e.message);
      res.status(500).json({ success: false, message: 'Failed to save media record' });
    }
  });
});

// Attach an existing Asset Manager asset (src/sections/asset-manager) as
// campaign/item media, instead of uploading a new file. The frontend
// resolves the asset's public URL via the Assets API and passes it here —
// this endpoint only records the reference, it doesn't re-fetch the asset.
router.post('/media/from-asset', requireAuth, requirePublisher, async (req, res) => {
  try {
    const campaignId = parseInt(req.body.campaign_id, 10);
    const omAssetId = parseInt(req.body.om_asset_id, 10);
    const fileUrl = String(req.body.file_url || '').trim();
    if (!campaignId || !omAssetId || !fileUrl) {
      return res.status(400).json({ success: false, message: 'campaign_id, om_asset_id, and file_url are required' });
    }
    const pool = getAppPool();
    const [campaign] = await pool.query('SELECT id FROM latest_news_campaigns WHERE id = ?', [campaignId]);
    if (!campaign.length) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const itemId = req.body.item_id ? parseInt(req.body.item_id, 10) : null;
    const fileType = FILE_TYPES.includes(req.body.file_type) ? req.body.file_type : detectFileType(fileUrl);
    const sortOrder = await nextSortOrder(
      pool,
      'latest_news_media',
      'WHERE campaign_id = ?' + (itemId ? ' AND item_id = ?' : ' AND item_id IS NULL'),
      itemId ? [campaignId, itemId] : [campaignId]
    );
    const isPrimary = req.body.is_primary === true || req.body.is_primary === 1 ? 1 : 0;

    if (isPrimary) {
      const where = itemId ? 'campaign_id = ? AND item_id = ?' : 'campaign_id = ? AND item_id IS NULL';
      const params = itemId ? [campaignId, itemId] : [campaignId];
      await pool.query(`UPDATE latest_news_media SET is_primary = 0 WHERE ${where}`, params);
    }

    const [result] = await pool.query(
      `INSERT INTO latest_news_media (
        campaign_id, item_id, file_url, om_asset_id, file_type, alt_text, caption, credit, sort_order, is_primary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        campaignId,
        itemId,
        fileUrl,
        omAssetId,
        fileType,
        req.body.alt_text || null,
        req.body.caption || null,
        req.body.credit || null,
        sortOrder,
        isPrimary,
      ]
    );

    const [rows] = await pool.query('SELECT * FROM latest_news_media WHERE id = ?', [result.insertId]);
    await logLatestNewsAudit('attach_asset_media', { campaignId, itemId, userId: req.user?.id, changes: { omAssetId } });
    res.status(201).json({ success: true, media: serializeMedia(rows[0]) });
  } catch (e) {
    console.error('[latest-news] media from-asset:', e.message);
    res.status(500).json({ success: false, message: 'Failed to attach asset' });
  }
});

router.put('/media/:id', requireAuth, requirePublisher, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const pool = getAppPool();
    const [existing] = await pool.query('SELECT * FROM latest_news_media WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Media not found' });
    const row = existing[0];

    const altText = req.body.alt_text !== undefined ? req.body.alt_text : row.alt_text;
    const caption = req.body.caption !== undefined ? req.body.caption : row.caption;
    const credit = req.body.credit !== undefined ? req.body.credit : row.credit;
    const sortOrder = req.body.sort_order !== undefined ? Number(req.body.sort_order) : row.sort_order;
    const itemId = req.body.item_id !== undefined ? (req.body.item_id ? parseInt(req.body.item_id, 10) : null) : row.item_id;
    const isPrimary = req.body.is_primary === true || req.body.is_primary === 1 ? 1 : (req.body.is_primary === false || req.body.is_primary === 0 ? 0 : row.is_primary);

    if (isPrimary) {
      const where = itemId
        ? 'campaign_id = ? AND item_id = ? AND id != ?'
        : 'campaign_id = ? AND item_id IS NULL AND id != ?';
      const params = itemId ? [row.campaign_id, itemId, id] : [row.campaign_id, id];
      await pool.query(`UPDATE latest_news_media SET is_primary = 0 WHERE ${where}`, params);
    }

    await pool.query(
      `UPDATE latest_news_media SET alt_text = ?, caption = ?, credit = ?, sort_order = ?, item_id = ?, is_primary = ? WHERE id = ?`,
      [altText, caption, credit, sortOrder, itemId, isPrimary, id]
    );

    const [rows] = await pool.query('SELECT * FROM latest_news_media WHERE id = ?', [id]);
    res.json({ success: true, media: serializeMedia(rows[0]) });
  } catch (err) {
    console.error('[latest-news] PUT media:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update media' });
  }
});

router.delete('/media/:id', requireAuth, requirePublisher, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const pool = getAppPool();
    const [existing] = await pool.query('SELECT * FROM latest_news_media WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Media not found' });
    await pool.query('DELETE FROM latest_news_media WHERE id = ?', [id]);
    await logLatestNewsAudit('delete_media', {
      campaignId: existing[0].campaign_id,
      itemId: existing[0].item_id,
      userId: req.user?.id,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[latest-news] DELETE media:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete media' });
  }
});

// ── Versions (save draft / publish history) ─────────────────────────
// Page Builder "Save draft" / "Publish now" — each action snapshots the
// full campaign + items + media as JSON so editors can review history and
// roll back. Publishing sets campaigns.published_version_id + status='live'
// without disturbing any newer in-progress draft.

router.get('/campaigns/:id/versions', requireAuth, requirePublisher, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    if (!campaignId) return res.status(400).json({ success: false, message: 'Invalid campaign id' });
    const pool = getAppPool();
    const [rows] = await pool.query(
      `SELECT id, campaign_id, label, status, created_by, created_at, published_at
       FROM latest_news_page_versions WHERE campaign_id = ? ORDER BY created_at DESC, id DESC`,
      [campaignId]
    );
    res.json({ success: true, versions: rows });
  } catch (err) {
    console.error('[latest-news] GET versions:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load versions' });
  }
});

router.get('/campaigns/:id/versions/:versionId', requireAuth, requirePublisher, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const versionId = parseInt(req.params.versionId, 10);
    if (!campaignId || !versionId) return res.status(400).json({ success: false, message: 'Invalid id' });
    const pool = getAppPool();
    const [rows] = await pool.query(
      'SELECT * FROM latest_news_page_versions WHERE id = ? AND campaign_id = ?',
      [versionId, campaignId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Version not found' });
    res.json({ success: true, version: rows[0] });
  } catch (err) {
    console.error('[latest-news] GET version:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load version' });
  }
});

router.post('/campaigns/:id/versions', requireAuth, requirePublisher, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    if (!campaignId) return res.status(400).json({ success: false, message: 'Invalid campaign id' });
    const pool = getAppPool();
    const snapshot = await loadCampaignById(pool, campaignId, { includeAdmin: true });
    if (!snapshot) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const label = req.body?.label ? String(req.body.label).slice(0, 255) : null;
    const [result] = await pool.query(
      `INSERT INTO latest_news_page_versions (campaign_id, label, snapshot, status, created_by)
       VALUES (?, ?, ?, 'draft', ?)`,
      [campaignId, label, JSON.stringify(snapshot), req.user?.id || null]
    );
    await logLatestNewsAudit('save_version', { campaignId, userId: req.user?.id, changes: { versionId: result.insertId } });
    const [rows] = await pool.query('SELECT * FROM latest_news_page_versions WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, version: rows[0] });
  } catch (err) {
    console.error('[latest-news] POST version:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save version' });
  }
});

router.post('/campaigns/:id/versions/:versionId/publish', requireAuth, requirePublisher, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const versionId = parseInt(req.params.versionId, 10);
    if (!campaignId || !versionId) return res.status(400).json({ success: false, message: 'Invalid id' });
    const pool = getAppPool();
    const [versionRows] = await pool.query(
      'SELECT id FROM latest_news_page_versions WHERE id = ? AND campaign_id = ?',
      [versionId, campaignId]
    );
    if (!versionRows.length) return res.status(404).json({ success: false, message: 'Version not found' });

    await pool.query(
      `UPDATE latest_news_page_versions SET status = 'published', published_at = NOW() WHERE id = ?`,
      [versionId]
    );
    await pool.query(
      `UPDATE latest_news_campaigns SET published_version_id = ?, status = 'live', updated_by = ? WHERE id = ?`,
      [versionId, req.user?.id || null, campaignId]
    );
    await logLatestNewsAudit('publish_version', { campaignId, userId: req.user?.id, changes: { versionId } });
    res.json({ success: true, campaign: await loadCampaignById(pool, campaignId, { includeAdmin: true }) });
  } catch (err) {
    console.error('[latest-news] POST publish:', err.message);
    res.status(500).json({ success: false, message: 'Failed to publish version' });
  }
});

// ── Legacy public GET (backward compat) ─────────────────────────────

function serializeBlock(row) {
  return {
    id: row.id,
    block_type: row.block_type,
    content: row.content,
    sort_order: row.sort_order,
    is_published: !!row.is_published,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

router.get('/', async (_req, res) => {
  try {
    const pool = getAppPool();
    const now = new Date();
    const campaigns = await loadActiveCampaigns(pool, now);

    const items = [];
    for (const campaign of campaigns) {
      for (const item of campaign.items || []) {
        const primary = item.media?.find((m) => m.is_primary) || item.media?.[0]
          || campaign.media?.find((m) => m.is_primary) || campaign.media?.[0];
        items.push({
          id: item.id,
          title: item.title,
          slug: campaign.slug,
          summary: item.excerpt || campaign.summary,
          body: item.body,
          image_url: primary?.file_url || null,
          image_alt: primary?.alt_text || null,
          cta_label: item.cta_label,
          cta_url: item.cta_url,
          display_type: item.layout_type === 'hero' ? 'hero' : (item.layout_type === 'card' ? 'card' : 'accordion'),
          sort_order: item.sort_order,
          rotation_enabled: campaign.rotation_enabled,
          rotation_seconds: campaign.rotation_interval_seconds,
          featured: campaign.display_priority > 0,
          media: [...(item.media || []), ...(campaign.media || [])],
        });
      }
    }

    const [blockRows] = await pool.query(
      `SELECT id, block_type, content, sort_order, is_published, created_at, updated_at
       FROM latest_news_blocks
       WHERE is_published = 1 AND block_type != 'image'
       ORDER BY sort_order ASC, id ASC`
    );

    const rotationEnabled = campaigns.some((c) => c.rotation_enabled && (c.items?.length || 0) > 1);
    const rotationSeconds = campaigns.length
      ? Math.max(3, ...campaigns.map((c) => c.rotation_interval_seconds || 8))
      : 8;

    res.json({
      success: true,
      campaigns,
      items,
      blocks: blockRows.map(serializeBlock),
      rotation: { enabled: rotationEnabled, seconds: rotationSeconds },
    });
  } catch (err) {
    console.error('[latest-news] GET /:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load latest news' });
  }
});

// Legacy upload alias
router.post('/upload', requireAuth, requirePublisher, (req, res) => {
  req.url = '/media/upload';
  router.handle(req, res);
});

module.exports = router;
module.exports.loadActiveCampaigns = loadActiveCampaigns;
