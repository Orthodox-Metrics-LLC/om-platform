/**
 * /api/om/menus — Menu editor for the om-platform (Minimal UI).
 *
 * Model
 *   orthodoxmetrics_db.om_menu_items     — master catalog ("master menu template"): every menu entry that may
 *                                        appear in a role menu, tagged with the audiences allowed to include it.
 *   orthodoxmetrics_db.om_menu_templates — named nav templates per audience ('admin' | 'church' | 'limited');
 *                                        nav_json is the fully-rendered Minimal navData array (icons/labels as
 *                                        serializable strings). One active template per audience.
 *
 * Audience mapping
 *   admin            → platform 'admin' role
 *   church           → priest, deacon, church_admin, manager
 *   limited          → editor, moderator, user, viewer, guest, readonly_user (lower-access roles)
 *   super_admin      → always the built-in full dashboard menu (no template)
 *
 * GET /mine returns { audience, nav } for the caller; nav:null → frontend falls back to the built-in menu.
 * Hiding menu items is not authorization — routes/APIs still enforce roles separately.
 */
const express = require('express');
const { promisePool } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

const ADMIN_ROLES = ['super_admin', 'admin'];
const CHURCH_AUDIENCE_ROLES = ['priest', 'deacon', 'church_admin', 'manager'];
const AUDIENCES = ['admin', 'church', 'limited'];

const audienceForRole = (role) => {
  if (role === 'admin') return 'admin';
  if (CHURCH_AUDIENCE_ROLES.includes(role)) return 'church';
  if (role === 'super_admin') return null;
  return 'limited';
};

// ---------------------------------------------------------------------------
// schema (auto-provisioned, mirrors certificates.js pattern)
// ---------------------------------------------------------------------------
let ensured = false;
async function ensureSchema() {
  if (ensured) return;
  await promisePool.query(`CREATE TABLE IF NOT EXISTS om_menu_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_key VARCHAR(80) NOT NULL UNIQUE,
    section VARCHAR(80) NOT NULL,
    title VARCHAR(120) NOT NULL,
    path VARCHAR(255) NOT NULL,
    icon VARCHAR(80) DEFAULT NULL,
    caption VARCHAR(255) DEFAULT NULL,
    info_label VARCHAR(32) DEFAULT NULL,
    info_color VARCHAR(16) DEFAULT NULL,
    info_icon VARCHAR(80) DEFAULT NULL,
    children JSON DEFAULT NULL,
    audiences JSON NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await promisePool.query(`CREATE TABLE IF NOT EXISTS om_menu_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    audience ENUM('admin','church','limited') NOT NULL,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(255) DEFAULT NULL,
    nav_json JSON NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 0,
    created_by INT DEFAULT NULL,
    updated_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_audience (audience, is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  ensured = true;
}

// ---------------------------------------------------------------------------
// Master catalog — the resource the templates are populated from.
// Mirrors the built-in church/admin menus; icon strings map to the frontend ICONS map.
// ---------------------------------------------------------------------------
const MASTER_ITEMS = [
  // [key, section, title, path, icon, audiences, children, info]
  ['myom', 'MyOM', 'MyOM', '/dashboard/user', 'label', ['admin', 'church', 'limited'], null, { label: 'NEW', color: 'info', icon: 'solar:bell-bing-bold-duotone' }],
  ['portal-overview', 'Parish Portal', 'Portal Home', '/portal', 'dashboard', ['admin', 'church', 'limited'], [
    { title: 'Overview', path: '/portal' },
    { title: 'Records', path: '/portal/records', deepMatch: true },
    { title: 'Certificates', path: '/portal/records/certificates', deepMatch: true },
  ]],
  ['records-baptism', 'Parish Portal', 'Baptisms', '/portal/records/baptism', 'file', ['admin', 'church', 'limited']],
  ['records-marriage', 'Parish Portal', 'Marriages', '/portal/records/marriage', 'file', ['admin', 'church', 'limited']],
  ['records-funeral', 'Parish Portal', 'Funerals', '/portal/records/funeral', 'file', ['admin', 'church', 'limited']],
  ['certificates', 'Parish Portal', 'Certificates', '/portal/records/certificates', 'file', ['admin', 'church']],
  // 'sacramental-calendar' merged into the regular Calendar (click its heading
  // to toggle) — kept out of MASTER_ITEMS/DEFAULT_NAV; /portal/records/sacramental-calendar
  // still resolves via a redirect into /dashboard/calendar?mode=sacramental.
  ['ocr-upload', 'Parish Portal', 'Upload Records', '/portal/ocr', 'folder', ['admin', 'church']],
  ['analytics', 'Parish Portal', 'Analytics', '/dashboard/analytics', 'analytics', ['admin', 'church', 'limited']],
  ['file-overview', 'Parish Portal', 'File', '/dashboard/file', 'file', ['admin', 'church', 'limited']],
  ['invoices', 'Parish Portal', 'Invoices', '/dashboard/invoice', 'invoice', ['admin', 'church']],
  ['file-manager', 'Applications', 'File manager', '/portal/file-manager', 'folder', ['admin', 'church', 'limited']],
  ['mail', 'Applications', 'Mail', '/dashboard/mail', 'mail', ['admin', 'church', 'limited']],
  ['chat', 'Applications', 'Chat', '/dashboard/chat', 'chat', ['admin', 'church', 'limited']],
  ['calendar', 'Applications', 'Calendar', '/dashboard/calendar', 'calendar', ['admin', 'church', 'limited']],
  ['profile', 'Applications', 'My profile', '/dashboard/user', 'user', ['admin', 'church', 'limited']],
  ['social-feed', 'Applications', 'Social feed', '/dashboard/social', 'blog', ['admin', 'church', 'limited']],
  ['notifications', 'Applications', 'Notifications', '/dashboard/notifications', 'label', ['admin', 'church', 'limited']],
];

const DEFAULT_NAV = {
  church: [
    { subheader: 'MyOM', items: [{ title: 'MyOM', path: '/dashboard/user', icon: 'label', info: { label: 'NEW', color: 'info', icon: 'solar:bell-bing-bold-duotone' } }] },
    { subheader: 'Parish Portal', items: [
      { title: 'Portal Home', path: '/portal', icon: 'dashboard', children: [
        { title: 'Overview', path: '/portal' },
        { title: 'Analytics', path: '/dashboard/analytics' },
        { title: 'File', path: '/dashboard/file' },
      ] },
    ] },
    { subheader: 'Applications', items: [
      { title: 'Records', path: '/portal/records', icon: 'file', children: [
        { title: 'Upload Records', path: '/portal/ocr', deepMatch: true },
        { title: 'Certificates', path: '/portal/records/certificates', deepMatch: true },
        { title: 'Metrics', path: '/portal/records', deepMatch: true },
      ] },
      { title: 'Invoices', path: '/dashboard/invoice', icon: 'invoice', deepMatch: true },
      { title: 'File manager', path: '/portal/file-manager', icon: 'folder' },
      { title: 'Mail', path: '/dashboard/mail', icon: 'mail' },
      { title: 'Chat', path: '/dashboard/chat', icon: 'chat' },
      { title: 'Calendar', path: '/dashboard/calendar', icon: 'calendar' },
    ] },
  ],
  admin: [
    { subheader: 'MyOM', items: [{ title: 'MyOM', path: '/dashboard/user', icon: 'label', info: { label: 'NEW', color: 'info', icon: 'solar:bell-bing-bold-duotone' } }] },
    { subheader: 'Parish Portal', items: [
      { title: 'Portal Home', path: '/portal', icon: 'dashboard', deepMatch: true },
      { title: 'Upload Records', path: '/portal/ocr', icon: 'folder', deepMatch: true },
    ] },
    { subheader: 'Management', items: [
      { title: 'File manager', path: '/portal/file-manager', icon: 'folder' },
      { title: 'Asset Manager', path: '/dashboard/asset-manager', icon: 'file' },
      { title: 'Invoice', path: '/dashboard/invoice', icon: 'invoice', children: [
        { title: 'List', path: '/dashboard/invoice' },
        { title: 'Create', path: '/dashboard/invoice/new' },
      ] },
      { title: 'Mail', path: '/dashboard/mail', icon: 'mail' },
      { title: 'Chat', path: '/dashboard/chat', icon: 'chat' },
      { title: 'Calendar', path: '/dashboard/calendar', icon: 'calendar' },
    ] },
  ],
  limited: [
    { subheader: 'MyOM', items: [{ title: 'MyOM', path: '/dashboard/user', icon: 'label' }] },
    { subheader: 'Parish Portal', items: [
      { title: 'Portal Home', path: '/portal', icon: 'dashboard' },
      { title: 'Calendar', path: '/dashboard/calendar', icon: 'calendar' },
    ] },
  ],
};

async function seedIfEmpty() {
  const [[{ c }]] = await promisePool.query('SELECT COUNT(*) c FROM om_menu_items');
  if (!c) {
    for (let i = 0; i < MASTER_ITEMS.length; i++) {
      const [key, section, title, path, icon, aud, children, info] = MASTER_ITEMS[i];
      await promisePool.query(
        `INSERT INTO om_menu_items (item_key, section, title, path, icon, audiences, children, info_label, info_color, info_icon, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [key, section, title, path, icon || null, JSON.stringify(aud), children ? JSON.stringify(children) : null,
         info?.label || null, info?.color || null, info?.icon || null, i]);
    }
  }
  for (const aud of AUDIENCES) {
    const [[{ c }]] = await promisePool.query('SELECT COUNT(*) c FROM om_menu_templates WHERE audience=?', [aud]);
    if (!c) {
      await promisePool.query(
        `INSERT INTO om_menu_templates (audience, name, description, nav_json, is_active) VALUES (?,?,?,?,1)`,
        [aud, `${aud[0].toUpperCase() + aud.slice(1)} default`, 'Built-in default menu', JSON.stringify(DEFAULT_NAV[aud])]);
    }
  }
}

// ---------------------------------------------------------------------------
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const requireAdmin = (req) => {
  const role = req.user?.role || req.session?.user?.role;
  if (!ADMIN_ROLES.includes(role)) throw Object.assign(new Error('Platform admins only'), { status: 403 });
};

const parseJson = (v, fb = null) => { try { return v == null ? fb : (typeof v === 'string' ? JSON.parse(v) : v); } catch { return fb; } };

// Who am I → which menu (any authenticated user)
router.get('/mine', requireAuth, wrap(async (req, res) => {
  await ensureSchema();
  const role = req.user?.role || req.session?.user?.role || 'user';
  const audience = audienceForRole(role);
  if (!audience) return res.json({ audience: null, nav: null });
  const [rows] = await promisePool.query(
    'SELECT id, name, nav_json FROM om_menu_templates WHERE audience=? AND is_active=1 ORDER BY id DESC LIMIT 1', [audience]);
  res.json({ audience, nav: rows[0] ? parseJson(rows[0].nav_json) : null, template: rows[0] ? { id: rows[0].id, name: rows[0].name } : null });
}));

// Master catalog — every available item, grouped by section
router.get('/catalog', requireAuth, wrap(async (req, res) => {
  requireAdmin(req); await ensureSchema(); await seedIfEmpty();
  const [rows] = await promisePool.query('SELECT * FROM om_menu_items WHERE is_active=1 ORDER BY sort_order, id');
  res.json({ items: rows.map(r => ({ ...r, audiences: parseJson(r.audiences, []), children: parseJson(r.children) })) });
}));

// Templates
router.get('/templates', requireAuth, wrap(async (req, res) => {
  requireAdmin(req); await ensureSchema(); await seedIfEmpty();
  const [rows] = await promisePool.query(
    'SELECT id, audience, name, description, is_active, nav_json, updated_at FROM om_menu_templates ORDER BY audience, id');
  res.json({ templates: rows.map(r => ({ ...r, nav: parseJson(r.nav_json), nav_json: undefined })) });
}));

router.post('/templates', requireAuth, wrap(async (req, res) => {
  requireAdmin(req); await ensureSchema(); await seedIfEmpty();
  const { audience, name, description, nav } = req.body || {};
  if (!AUDIENCES.includes(audience)) throw Object.assign(new Error('Invalid audience'), { status: 400 });
  if (!Array.isArray(nav)) throw Object.assign(new Error('nav must be a navData array'), { status: 400 });
  const [r] = await promisePool.query(
    'INSERT INTO om_menu_templates (audience, name, description, nav_json, is_active, created_by, updated_by) VALUES (?,?,?,?,0,?,?)',
    [audience, name || `${audience} template`, description || null, JSON.stringify(nav), req.user?.id || null, req.user?.id || null]);
  res.json({ id: r.insertId });
}));

router.put('/templates/:id', requireAuth, wrap(async (req, res) => {
  requireAdmin(req); await ensureSchema();
  const { name, description, nav } = req.body || {};
  const fields = []; const vals = [];
  if (name !== undefined) { fields.push('name=?'); vals.push(name); }
  if (description !== undefined) { fields.push('description=?'); vals.push(description); }
  if (nav !== undefined) {
    if (!Array.isArray(nav)) throw Object.assign(new Error('nav must be a navData array'), { status: 400 });
    fields.push('nav_json=?'); vals.push(JSON.stringify(nav));
  }
  if (!fields.length) throw Object.assign(new Error('Nothing to update'), { status: 400 });
  fields.push('updated_by=?'); vals.push(req.user?.id || null);
  vals.push(req.params.id);
  const [r] = await promisePool.query(`UPDATE om_menu_templates SET ${fields.join(', ')} WHERE id=?`, vals);
  if (!r.affectedRows) throw Object.assign(new Error('Not found'), { status: 404 });
  res.json({ ok: true });
}));

router.post('/templates/:id/activate', requireAuth, wrap(async (req, res) => {
  requireAdmin(req); await ensureSchema();
  const [[t]] = await promisePool.query('SELECT id, audience FROM om_menu_templates WHERE id=?', [req.params.id]);
  if (!t) throw Object.assign(new Error('Not found'), { status: 404 });
  await promisePool.query('UPDATE om_menu_templates SET is_active=0 WHERE audience=?', [t.audience]);
  await promisePool.query('UPDATE om_menu_templates SET is_active=1, updated_by=? WHERE id=?', [req.user?.id || null, t.id]);
  res.json({ ok: true });
}));

router.delete('/templates/:id', requireAuth, wrap(async (req, res) => {
  requireAdmin(req); await ensureSchema();
  const [[t]] = await promisePool.query('SELECT id, is_active FROM om_menu_templates WHERE id=?', [req.params.id]);
  if (!t) throw Object.assign(new Error('Not found'), { status: 404 });
  if (t.is_active) throw Object.assign(new Error('Cannot delete the active template'), { status: 400 });
  await promisePool.query('DELETE FROM om_menu_templates WHERE id=?', [t.id]);
  res.json({ ok: true });
}));

router.ensureSchema = ensureSchema;
module.exports = router;
