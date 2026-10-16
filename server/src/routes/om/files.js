/**
 * /api/om/files — per-church file manager for the om-platform
 * (Management → File manager, Overview → File, Asset Manager → Church Files).
 *
 * Data lives in each tenant DB (om_church_##.fm_*), files on disk under
 * server/storage/files/church_<id>/. Quota = churches.plan_max_storage_gb (default 25).
 *
 * Roles
 *   super_admin            any church (?church_id=)
 *   admin                  churches they are responsible for (user_roles role=admin)
 *   church_admin/priest/deacon (+legacy manager)  full control of their own church
 *   other church roles     read + download; write only inside folders shared 'edit'
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { promisePool, getTenantPool } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

const STORAGE_ROOT = path.resolve(__dirname, '../../../storage/files');
const DEFAULT_QUOTA_GB = 25;
const PLATFORM_ROLES = ['super_admin', 'admin'];
const CHURCH_WRITE_ROLES = ['church_admin', 'manager', 'priest', 'deacon'];
const SYSTEM_ROOTS = [
    { key: 'records', name: 'Records' },
    { key: 'media', name: 'Media' },
    { key: 'documents', name: 'Documents' },
];

const getUserId = (req) => req.user?.id || req.session?.user?.id;
const displayName = (u) => u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;

function categoryOf(mime = '', ext = '') {
    if (/^image\//.test(mime)) return 'image';
    if (/^video\//.test(mime)) return 'video';
    if (/^audio\//.test(mime)) return 'audio';
    if (/pdf|msword|officedocument|text\/|rtf|csv|spreadsheet|presentation/.test(mime) || /^(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|odt|ods)$/.test(ext)) return 'document';
    return 'other';
}

// ---------------------------------------------------------------------------
// context: who is the actor, which church, what may they do
// ---------------------------------------------------------------------------
async function loadActor(id) {
    const [rows] = await promisePool.query(
        `SELECT id, email, first_name, last_name, display_name, role, church_id, avatar_url
         FROM orthodoxmetrics_db.users WHERE id = ? AND is_active = 1 AND account_status = 'active'`,
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

async function loadChurch(churchId) {
    const [rows] = await promisePool.query(
        `SELECT id, COALESCE(church_name, name) AS name, database_name, jurisdiction, plan_max_storage_gb, is_active
         FROM orthodoxmetrics_db.churches WHERE id = ?`,
        [churchId]
    );
    return rows[0] || null;
}

/** Resolve {actor, church, pool, canWrite, isPlatform} or throw {status,message}. */
async function resolveContext(req, requestedChurchId) {
    const actor = await loadActor(getUserId(req));
    if (!actor) throw Object.assign(new Error('Account is not active'), { status: 403 });

    const isPlatform = PLATFORM_ROLES.includes(actor.role);
    let churchId = isPlatform ? Number(requestedChurchId || actor.church_id) : actor.church_id;
    if (!churchId) throw Object.assign(new Error(isPlatform ? 'church_id is required' : 'Your account is not assigned to a church'), { status: 400 });

    if (actor.role === 'admin') {
        const allowed = await adminChurchIds(actor.id);
        if (!allowed.includes(churchId)) throw Object.assign(new Error('You are not responsible for this church'), { status: 403 });
    } else if (!isPlatform && actor.church_id !== churchId) {
        throw Object.assign(new Error('Not your church'), { status: 403 });
    }

    const church = await loadChurch(churchId);
    if (!church || !church.database_name) throw Object.assign(new Error('Church storage is not provisioned'), { status: 404 });

    const pool = getTenantPool(churchId);
    await ensureRoots(pool, churchId, actor.id);

    return {
        actor,
        church,
        pool,
        isPlatform,
        canWrite: isPlatform || CHURCH_WRITE_ROLES.includes(actor.role),
        quotaBytes: Number(church.plan_max_storage_gb || DEFAULT_QUOTA_GB) * 1024 * 1024 * 1024,
        dir: path.join(STORAGE_ROOT, `church_${churchId}`),
    };
}

async function ensureRoots(pool, churchId, userId) {
    const [rows] = await pool.query('SELECT system_key FROM fm_folders WHERE system_key IS NOT NULL AND deleted_at IS NULL');
    const have = new Set(rows.map((r) => r.system_key));
    for (const root of SYSTEM_ROOTS) {
        if (!have.has(root.key)) {
            await pool.query('INSERT INTO fm_folders (church_id, parent_id, name, system_key, created_by) VALUES (?, NULL, ?, ?, ?)', [churchId, root.name, root.key, userId]);
        }
    }
}

async function usedBytes(pool) {
    const [[r]] = await pool.query('SELECT COALESCE(SUM(size_bytes),0) AS used FROM fm_files WHERE deleted_at IS NULL');
    return Number(r.used) || 0;
}

async function logActivity(pool, ctx, { itemType, itemId, itemName, category, action, sizeDelta = 0 }) {
    await pool.query(
        'INSERT INTO fm_activity (church_id, item_type, item_id, item_name, category, action, size_delta, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [ctx.church.id, itemType, itemId, itemName, category || null, action, sizeDelta, ctx.actor.id]
    );
}

async function notify(userIds, typeName, title, message, options) {
    try {
        const { notificationService } = require('../../api/notifications');
        for (const uid of new Set(userIds.filter(Boolean))) {
            if (Number(uid) === Number(options.senderId)) continue;
            notificationService.createNotification(uid, typeName, title, message, options).catch(() => {});
        }
    } catch (e) { /* best effort */ }
}

// ---------------------------------------------------------------------------
// shaping to the Minimal IFile / IFolderManager types
// ---------------------------------------------------------------------------
async function usersByIds(ids) {
    if (!ids.length) return new Map();
    const [rows] = await promisePool.query(
        'SELECT id, email, first_name, last_name, display_name, avatar_url FROM orthodoxmetrics_db.users WHERE id IN (?)',
        [ids]
    );
    return new Map(rows.map((u) => [u.id, u]));
}

async function sharesFor(pool, itemType, ids) {
    if (!ids.length) return new Map();
    const [rows] = await pool.query('SELECT item_id, user_id, permission FROM fm_shares WHERE item_type = ? AND item_id IN (?)', [itemType, ids]);
    const users = await usersByIds([...new Set(rows.map((r) => r.user_id))]);
    const map = new Map();
    for (const r of rows) {
        const u = users.get(r.user_id);
        if (!u) continue;
        if (!map.has(r.item_id)) map.set(r.item_id, []);
        map.get(r.item_id).push({ id: String(u.id), name: displayName(u), email: u.email, avatarUrl: u.avatar_url || '', permission: r.permission });
    }
    return map;
}

async function favoritesFor(pool, userId, itemType, ids) {
    if (!ids.length) return new Set();
    const [rows] = await pool.query('SELECT item_id FROM fm_favorites WHERE user_id = ? AND item_type = ? AND item_id IN (?)', [userId, itemType, ids]);
    return new Set(rows.map((r) => r.item_id));
}

const parseTags = (t) => { try { const v = typeof t === 'string' ? JSON.parse(t) : t; return Array.isArray(v) ? v : []; } catch { return []; } };

async function shapeFolders(pool, ctx, rows) {
    const ids = rows.map((r) => r.id);
    const [shares, favs, counts] = await Promise.all([
        sharesFor(pool, 'folder', ids),
        favoritesFor(pool, ctx.actor.id, 'folder', ids),
        // recursive totals: every file under the folder, at any depth
        ids.length ? pool.query(
            `WITH RECURSIVE tree AS (
                SELECT id, id AS root_id FROM fm_folders WHERE id IN (?)
                UNION ALL
                SELECT f.id, t.root_id FROM fm_folders f JOIN tree t ON f.parent_id = t.id WHERE f.deleted_at IS NULL
             )
             SELECT t.root_id AS folder_id, COUNT(fl.id) c, COALESCE(SUM(fl.size_bytes),0) s
             FROM tree t LEFT JOIN fm_files fl ON fl.folder_id = t.id AND fl.deleted_at IS NULL
             GROUP BY t.root_id`, [ids]).then(([r]) => new Map(r.map((x) => [x.folder_id, x]))) : new Map(),
    ]);
    return rows.map((f) => ({
        id: `folder-${f.id}`,
        rawId: f.id,
        kind: 'folder',
        systemKey: f.system_key || null,
        parentId: f.parent_id,
        url: '',
        name: f.name,
        size: Number(counts.get(f.id)?.s || 0),
        type: 'folder',
        tags: parseTags(f.tags),
        totalFiles: Number(counts.get(f.id)?.c || 0),
        isFavorited: favs.has(f.id),
        createdAt: f.created_at,
        modifiedAt: f.updated_at,
        shared: shares.get(f.id) || [],
        createdBy: f.created_by,
    }));
}

async function shapeFiles(pool, ctx, rows) {
    const ids = rows.map((r) => r.id);
    const [shares, favs] = await Promise.all([sharesFor(pool, 'file', ids), favoritesFor(pool, ctx.actor.id, 'file', ids)]);
    return rows.map((f) => ({
        id: `file-${f.id}`,
        rawId: f.id,
        kind: 'file',
        folderId: f.folder_id,
        url: `/api/om/files/download/${ctx.church.id}/${f.id}`,
        name: f.name,
        size: Number(f.size_bytes),
        type: f.ext || (f.mime_type || '').split('/')[1] || 'file',
        mimeType: f.mime_type,
        category: f.category,
        tags: parseTags(f.tags),
        isFavorited: favs.has(f.id),
        createdAt: f.created_at,
        modifiedAt: f.updated_at,
        shared: shares.get(f.id) || [],
        uploadedBy: f.uploaded_by,
    }));
}

const parseItemId = (s) => {
    const m = /^(file|folder)-(\d+)$/.exec(String(s));
    return m ? { type: m[1], id: Number(m[2]) } : null;
};

async function assertWrite(ctx, itemType, itemId) {
    if (ctx.canWrite) return;
    // read-only church roles may write inside folders shared with them as 'edit'
    const folderId = itemType === 'folder' ? itemId : (await ctx.pool.query('SELECT folder_id FROM fm_files WHERE id = ?', [itemId]))[0][0]?.folder_id;
    if (folderId) {
        const [[s]] = await ctx.pool.query("SELECT COUNT(*) c FROM fm_shares WHERE item_type='folder' AND item_id = ? AND user_id = ? AND permission = 'edit'", [folderId, ctx.actor.id]);
        if (s.c > 0) return;
    }
    throw Object.assign(new Error('You do not have permission to modify files here'), { status: 403 });
}

const handle = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        console.error('[om/files]', err);
        res.status(500).json({ success: false, message: 'File manager error' });
    }
};

// ---------------------------------------------------------------------------
// context + listing
// ---------------------------------------------------------------------------
router.get('/context', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.query.church_id);
    const used = await usedBytes(ctx.pool);
    const [roots] = await ctx.pool.query('SELECT * FROM fm_folders WHERE system_key IS NOT NULL AND deleted_at IS NULL ORDER BY FIELD(system_key, "records","media","documents")');
    res.json({
        success: true,
        church: { id: ctx.church.id, name: ctx.church.name, jurisdiction: ctx.church.jurisdiction },
        quota_bytes: ctx.quotaBytes,
        used_bytes: used,
        can_write: ctx.canWrite,
        is_platform: ctx.isPlatform,
        roots: await shapeFolders(ctx.pool, ctx, roots),
    });
}));

// GET /items?church_id&folder_id&q&types=jpg,pdf&favorites=1&shared=1
router.get('/items', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.query.church_id);
    const { pool } = ctx;
    const folderId = req.query.folder_id ? Number(req.query.folder_id) : null;
    const q = String(req.query.q || '').trim();
    const types = String(req.query.types || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    const favoritesOnly = req.query.favorites === '1';
    const sharedOnly = req.query.shared === '1';

    let folderWhere = 'deleted_at IS NULL';
    let fileWhere = 'deleted_at IS NULL';
    const fp = [];
    const filep = [];
    if (q) {
        folderWhere += ' AND name LIKE ?'; fp.push(`%${q}%`);
        fileWhere += ' AND name LIKE ?'; filep.push(`%${q}%`);
    } else if (!favoritesOnly && !sharedOnly) {
        if (folderId) { folderWhere += ' AND parent_id = ?'; fp.push(folderId); fileWhere += ' AND folder_id = ?'; filep.push(folderId); }
        else { folderWhere += ' AND parent_id IS NULL'; fileWhere += ' AND folder_id IS NULL'; }
    }
    if (types.length) {
        const cats = types.filter((t) => ['image', 'video', 'audio', 'document', 'other'].includes(t));
        const exts = types.filter((t) => !cats.includes(t));
        const parts = [];
        if (cats.length) { parts.push('category IN (?)'); filep.push(cats); }
        if (exts.length) { parts.push('ext IN (?)'); filep.push(exts); }
        fileWhere += ` AND (${parts.join(' OR ')})`;
        folderWhere += ' AND 1=0';
    }
    if (favoritesOnly) {
        folderWhere += " AND id IN (SELECT item_id FROM fm_favorites WHERE user_id = ? AND item_type='folder')"; fp.push(ctx.actor.id);
        fileWhere += " AND id IN (SELECT item_id FROM fm_favorites WHERE user_id = ? AND item_type='file')"; filep.push(ctx.actor.id);
    }
    if (sharedOnly) {
        folderWhere += " AND id IN (SELECT item_id FROM fm_shares WHERE user_id = ? AND item_type='folder')"; fp.push(ctx.actor.id);
        fileWhere += " AND id IN (SELECT item_id FROM fm_shares WHERE user_id = ? AND item_type='file')"; filep.push(ctx.actor.id);
    }

    const [folders] = await pool.query(`SELECT * FROM fm_folders WHERE ${folderWhere} ORDER BY system_key IS NULL, name LIMIT 500`, fp);
    const [files] = await pool.query(`SELECT * FROM fm_files WHERE ${fileWhere} ORDER BY updated_at DESC LIMIT 1000`, filep);

    let breadcrumbs = [];
    if (folderId) {
        let cur = folderId;
        while (cur) {
            const [[f]] = await pool.query('SELECT id, name, parent_id, system_key FROM fm_folders WHERE id = ?', [cur]);
            if (!f) break;
            breadcrumbs.unshift({ id: f.id, name: f.name, systemKey: f.system_key });
            cur = f.parent_id;
        }
    }

    res.json({
        success: true,
        folder_id: folderId,
        breadcrumbs,
        folders: await shapeFolders(pool, ctx, folders),
        files: await shapeFiles(pool, ctx, files),
    });
}));

// ---------------------------------------------------------------------------
// folders
// ---------------------------------------------------------------------------
router.post('/folders', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.body?.church_id);
    const name = String(req.body?.name || '').trim();
    const parentId = req.body?.parent_id ? Number(req.body.parent_id) : null;
    if (!name) throw Object.assign(new Error('Folder name is required'), { status: 400 });
    if (parentId) await assertWrite(ctx, 'folder', parentId); else if (!ctx.canWrite) throw Object.assign(new Error('Only church administrators and clergy can create top-level folders'), { status: 403 });
    const [r] = await ctx.pool.query('INSERT INTO fm_folders (church_id, parent_id, name, created_by) VALUES (?, ?, ?, ?)', [ctx.church.id, parentId, name, ctx.actor.id]);
    await logActivity(ctx.pool, ctx, { itemType: 'folder', itemId: r.insertId, itemName: name, action: 'create' });
    const [[row]] = await ctx.pool.query('SELECT * FROM fm_folders WHERE id = ?', [r.insertId]);
    res.json({ success: true, folder: (await shapeFolders(ctx.pool, ctx, [row]))[0] });
}));

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------
const upload = multer({
    storage: multer.diskStorage({
        destination: async (req, file, cb) => {
            try {
                const ctx = await resolveContext(req, req.query.church_id);
                req.fmCtx = ctx;
                fs.mkdirSync(ctx.dir, { recursive: true });
                cb(null, ctx.dir);
            } catch (e) { cb(e); }
        },
        filename: (req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}`),
    }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

router.post('/upload', requireAuth, (req, res) => {
    upload.array('files', 20)(req, res, async (err) => {
        try {
            if (err) throw Object.assign(new Error(err.message), { status: err.status || 400 });
            const ctx = req.fmCtx || (await resolveContext(req, req.query.church_id));
            const folderId = req.query.folder_id ? Number(req.query.folder_id) : null;
            if (folderId) await assertWrite(ctx, 'folder', folderId); else if (!ctx.canWrite) throw Object.assign(new Error('Choose a folder you can edit'), { status: 403 });

            const incoming = (req.files || []).reduce((n, f) => n + f.size, 0);
            const used = await usedBytes(ctx.pool);
            if (used + incoming > ctx.quotaBytes) {
                for (const f of req.files || []) fs.unlink(f.path, () => {});
                throw Object.assign(new Error(`Storage quota exceeded (${(ctx.quotaBytes / 1024 ** 3).toFixed(0)} GB plan)`), { status: 413 });
            }

            const created = [];
            for (const f of req.files || []) {
                const ext = path.extname(f.originalname).slice(1).toLowerCase();
                const category = categoryOf(f.mimetype, ext);
                const [r] = await ctx.pool.query(
                    `INSERT INTO fm_files (church_id, folder_id, name, original_name, stored_name, storage_path, mime_type, ext, size_bytes, category, uploaded_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [ctx.church.id, folderId, f.originalname, f.originalname, f.filename, f.path, f.mimetype, ext || null, f.size, category, ctx.actor.id]
                );
                await logActivity(ctx.pool, ctx, { itemType: 'file', itemId: r.insertId, itemName: f.originalname, category, action: 'upload', sizeDelta: f.size });
                created.push(r.insertId);
            }
            const [rows] = created.length ? await ctx.pool.query('SELECT * FROM fm_files WHERE id IN (?)', [created]) : [[]];
            const shaped = await shapeFiles(ctx.pool, ctx, rows);

            // Notify: folder collaborators + church admins/clergy (excluding uploader)
            if (created.length) {
                const recipients = new Set();
                if (folderId) {
                    const [sh] = await ctx.pool.query("SELECT user_id FROM fm_shares WHERE item_type='folder' AND item_id = ?", [folderId]);
                    sh.forEach((s) => recipients.add(s.user_id));
                }
                const [staff] = await promisePool.query(
                    "SELECT id FROM orthodoxmetrics_db.users WHERE church_id = ? AND is_active = 1 AND account_status = 'active' AND role IN ('church_admin','manager','priest','deacon')",
                    [ctx.church.id]
                );
                staff.forEach((s) => recipients.add(s.id));
                const folderName = folderId ? (await ctx.pool.query('SELECT name FROM fm_folders WHERE id = ?', [folderId]))[0][0]?.name : 'File manager';
                for (const file of shaped) {
                    notify([...recipients], 'file_added', 'File added',
                        `${displayName(ctx.actor)} added ${file.name} to ${folderName}`,
                        { senderId: ctx.actor.id, actionUrl: `/dashboard/file-manager${folderId ? `?folder=${folderId}` : ''}`,
                          data: { file_id: file.rawId, file_name: file.name, file_size: file.size, folder_id: folderId, folder_name: folderName, download_url: file.url } });
                }
            }
            res.json({ success: true, files: shaped, used_bytes: used + incoming, quota_bytes: ctx.quotaBytes });
        } catch (e) {
            if (e.status) return res.status(e.status).json({ success: false, message: e.message });
            console.error('[om/files] upload', e);
            res.status(500).json({ success: false, message: 'Upload failed' });
        }
    });
});

// ---------------------------------------------------------------------------
// item mutations
// ---------------------------------------------------------------------------
router.patch('/items/:itemId', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.body?.church_id || req.query.church_id);
    const it = parseItemId(req.params.itemId);
    if (!it) throw Object.assign(new Error('Invalid item'), { status: 400 });
    await assertWrite(ctx, it.type, it.id);
    const table = it.type === 'folder' ? 'fm_folders' : 'fm_files';
    const sets = []; const vals = [];
    if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (!name) throw Object.assign(new Error('Name is required'), { status: 400 });
        if (it.type === 'folder') {
            const [[f]] = await ctx.pool.query('SELECT system_key FROM fm_folders WHERE id = ?', [it.id]);
            if (f?.system_key) throw Object.assign(new Error('System folders cannot be renamed'), { status: 400 });
        }
        sets.push('name = ?'); vals.push(name);
    }
    if (req.body?.tags !== undefined) { sets.push('tags = ?'); vals.push(JSON.stringify(Array.isArray(req.body.tags) ? req.body.tags : [])); }
    if (req.body?.folder_id !== undefined && it.type === 'file') { sets.push('folder_id = ?'); vals.push(req.body.folder_id ? Number(req.body.folder_id) : null); }
    if (req.body?.parent_id !== undefined && it.type === 'folder') { sets.push('parent_id = ?'); vals.push(req.body.parent_id ? Number(req.body.parent_id) : null); }
    if (!sets.length) throw Object.assign(new Error('Nothing to update'), { status: 400 });
    vals.push(it.id);
    await ctx.pool.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, vals);
    const [[row]] = await ctx.pool.query(`SELECT * FROM ${table} WHERE id = ?`, [it.id]);
    await logActivity(ctx.pool, ctx, { itemType: it.type, itemId: it.id, itemName: row.name, category: row.category, action: req.body?.name !== undefined ? 'rename' : 'move' });
    res.json({ success: true, item: it.type === 'folder' ? (await shapeFolders(ctx.pool, ctx, [row]))[0] : (await shapeFiles(ctx.pool, ctx, [row]))[0] });
}));

async function softDeleteFolder(pool, folderId) {
    await pool.query('UPDATE fm_files SET deleted_at = NOW() WHERE folder_id = ? AND deleted_at IS NULL', [folderId]);
    const [children] = await pool.query('SELECT id FROM fm_folders WHERE parent_id = ? AND deleted_at IS NULL', [folderId]);
    for (const c of children) await softDeleteFolder(pool, c.id);
    await pool.query('UPDATE fm_folders SET deleted_at = NOW() WHERE id = ?', [folderId]);
}

router.delete('/items/:itemId', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.query.church_id);
    const it = parseItemId(req.params.itemId);
    if (!it) throw Object.assign(new Error('Invalid item'), { status: 400 });
    await assertWrite(ctx, it.type, it.id);
    if (it.type === 'folder') {
        const [[f]] = await ctx.pool.query('SELECT name, system_key FROM fm_folders WHERE id = ?', [it.id]);
        if (!f) throw Object.assign(new Error('Not found'), { status: 404 });
        if (f.system_key) throw Object.assign(new Error('System folders cannot be deleted'), { status: 400 });
        await softDeleteFolder(ctx.pool, it.id);
        await logActivity(ctx.pool, ctx, { itemType: 'folder', itemId: it.id, itemName: f.name, action: 'delete' });
    } else {
        const [[f]] = await ctx.pool.query('SELECT name, size_bytes, category FROM fm_files WHERE id = ? AND deleted_at IS NULL', [it.id]);
        if (!f) throw Object.assign(new Error('Not found'), { status: 404 });
        await ctx.pool.query('UPDATE fm_files SET deleted_at = NOW() WHERE id = ?', [it.id]);
        await logActivity(ctx.pool, ctx, { itemType: 'file', itemId: it.id, itemName: f.name, category: f.category, action: 'delete', sizeDelta: -Number(f.size_bytes) });
    }
    res.json({ success: true });
}));

router.post('/items/:itemId/favorite', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.body?.church_id || req.query.church_id);
    const it = parseItemId(req.params.itemId);
    if (!it) throw Object.assign(new Error('Invalid item'), { status: 400 });
    const [[ex]] = await ctx.pool.query('SELECT id FROM fm_favorites WHERE item_type = ? AND item_id = ? AND user_id = ?', [it.type, it.id, ctx.actor.id]);
    if (ex) await ctx.pool.query('DELETE FROM fm_favorites WHERE id = ?', [ex.id]);
    else await ctx.pool.query('INSERT INTO fm_favorites (item_type, item_id, user_id) VALUES (?, ?, ?)', [it.type, it.id, ctx.actor.id]);
    res.json({ success: true, favorited: !ex });
}));

// share targets: members of the church + platform admins responsible for it
router.get('/share-targets', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.query.church_id);
    const [rows] = await promisePool.query(
        `SELECT DISTINCT u.id, u.email, u.first_name, u.last_name, u.display_name, u.role, u.avatar_url
         FROM orthodoxmetrics_db.users u
         LEFT JOIN orthodoxmetrics_db.user_roles ur ON ur.user_id = u.id AND ur.church_id = ?
         WHERE u.is_active = 1 AND u.account_status = 'active' AND u.id <> ?
           AND (u.church_id = ? OR u.role = 'super_admin' OR (u.role = 'admin' AND ur.id IS NOT NULL))
         ORDER BY u.display_name, u.first_name LIMIT 300`,
        [ctx.church.id, ctx.actor.id, ctx.church.id]
    );
    res.json({ success: true, users: rows.map((u) => ({ id: String(u.id), name: displayName(u), email: u.email, role: u.role, avatarUrl: u.avatar_url || '' })) });
}));

router.put('/items/:itemId/shares', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.body?.church_id || req.query.church_id);
    const it = parseItemId(req.params.itemId);
    if (!it) throw Object.assign(new Error('Invalid item'), { status: 400 });
    await assertWrite(ctx, it.type, it.id);
    const list = Array.isArray(req.body?.users) ? req.body.users : [];
    const [before] = await ctx.pool.query('SELECT user_id FROM fm_shares WHERE item_type = ? AND item_id = ?', [it.type, it.id]);
    await ctx.pool.query('DELETE FROM fm_shares WHERE item_type = ? AND item_id = ?', [it.type, it.id]);
    if (list.length) {
        await ctx.pool.query('INSERT INTO fm_shares (item_type, item_id, user_id, permission, shared_by) VALUES ?',
            [list.map((u) => [it.type, it.id, Number(u.user_id), u.permission === 'edit' ? 'edit' : 'view', ctx.actor.id])]);
    }
    const table = it.type === 'folder' ? 'fm_folders' : 'fm_files';
    const [[row]] = await ctx.pool.query(`SELECT * FROM ${table} WHERE id = ?`, [it.id]);
    await logActivity(ctx.pool, ctx, { itemType: it.type, itemId: it.id, itemName: row.name, category: row.category, action: 'share' });
    const newIds = list.map((u) => Number(u.user_id)).filter((id) => !before.some((b) => b.user_id === id));
    notify(newIds, 'file_shared', `${it.type === 'folder' ? 'Folder' : 'File'} shared with you`,
        `${displayName(ctx.actor)} shared ${row.name} with you`,
        { senderId: ctx.actor.id, actionUrl: it.type === 'folder' ? `/dashboard/file-manager?folder=${it.id}` : `/dashboard/file-manager?folder=${row.folder_id || ''}`,
          data: { item_type: it.type, item_id: it.id, file_name: row.name, file_size: row.size_bytes || null, download_url: it.type === 'file' ? `/api/om/files/download/${ctx.church.id}/${it.id}` : null } });
    res.json({ success: true, item: it.type === 'folder' ? (await shapeFolders(ctx.pool, ctx, [row]))[0] : (await shapeFiles(ctx.pool, ctx, [row]))[0] });
}));

// ---------------------------------------------------------------------------
// download / inline
// ---------------------------------------------------------------------------
router.get('/download/:churchId/:fileId', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.params.churchId);
    const [[f]] = await ctx.pool.query('SELECT * FROM fm_files WHERE id = ? AND deleted_at IS NULL', [Number(req.params.fileId)]);
    if (!f || !fs.existsSync(f.storage_path)) return res.status(404).json({ success: false, message: 'File not found' });
    if (req.query.log !== '0') logActivity(ctx.pool, ctx, { itemType: 'file', itemId: f.id, itemName: f.name, category: f.category, action: 'download' }).catch(() => {});
    res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.sendFile(f.storage_path);
}));

// ---------------------------------------------------------------------------
// overview (church)
// ---------------------------------------------------------------------------
async function churchOverview(ctx, year) {
    const { pool } = ctx;
    const [byCat] = await pool.query('SELECT category, COUNT(*) c, COALESCE(SUM(size_bytes),0) s FROM fm_files WHERE deleted_at IS NULL GROUP BY category');
    const [byRoot] = await pool.query(
        `WITH RECURSIVE tree AS (
            SELECT id, system_key AS root_key FROM fm_folders WHERE system_key IS NOT NULL AND deleted_at IS NULL
            UNION ALL
            SELECT f.id, t.root_key FROM fm_folders f JOIN tree t ON f.parent_id = t.id WHERE f.deleted_at IS NULL
         )
         SELECT t.root_key, COUNT(fl.id) c, COALESCE(SUM(fl.size_bytes),0) s
         FROM tree t LEFT JOIN fm_files fl ON fl.folder_id = t.id AND fl.deleted_at IS NULL
         GROUP BY t.root_key`
    );
    const [activity] = await pool.query(
        `SELECT MONTH(created_at) m, category, COUNT(*) c FROM fm_activity
         WHERE action IN ('upload') AND YEAR(created_at) = ? GROUP BY MONTH(created_at), category`,
        [year]
    );
    const [years] = await pool.query('SELECT DISTINCT YEAR(created_at) y FROM fm_activity ORDER BY y DESC');
    const [recentRows] = await pool.query('SELECT * FROM fm_files WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 10');
    const [recentActivity] = await pool.query('SELECT * FROM fm_activity ORDER BY created_at DESC LIMIT 15');
    const users = await usersByIds([...new Set(recentActivity.map((a) => a.user_id))]);

    const cat = (k) => byCat.find((r) => r.category === k) || { c: 0, s: 0 };
    const root = (k) => byRoot.find((r) => r.root_key === k) || { c: 0, s: 0 };
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const series = ['image', 'video', 'audio', 'document', 'other'].map((c) => ({
        name: c, data: months.map((m) => Number(activity.find((a) => a.m === m && a.category === c)?.c || 0)),
    }));

    return {
        church: { id: ctx.church.id, name: ctx.church.name, jurisdiction: ctx.church.jurisdiction },
        quota_bytes: ctx.quotaBytes,
        used_bytes: await usedBytes(pool),
        categories: {
            images: { count: Number(cat('image').c), bytes: Number(cat('image').s) },
            media: { count: Number(cat('video').c) + Number(cat('audio').c), bytes: Number(cat('video').s) + Number(cat('audio').s) },
            documents: { count: Number(cat('document').c), bytes: Number(cat('document').s) },
            other: { count: Number(cat('other').c), bytes: Number(cat('other').s) },
        },
        roots: SYSTEM_ROOTS.map((r) => ({ key: r.key, name: r.name, count: Number(root(r.key).c), bytes: Number(root(r.key).s) })),
        activity: { year, years: years.map((y) => y.y).length ? years.map((y) => y.y) : [year], series },
        recent_files: await shapeFiles(pool, ctx, recentRows),
        recent_activity: recentActivity.map((a) => ({
            id: a.id, action: a.action, item_type: a.item_type, item_name: a.item_name, category: a.category,
            size_delta: Number(a.size_delta), created_at: a.created_at,
            user: users.get(a.user_id) ? { id: a.user_id, name: displayName(users.get(a.user_id)), avatar_url: users.get(a.user_id).avatar_url || null } : null,
        })),
    };
}

router.get('/overview', requireAuth, handle(async (req, res) => {
    const ctx = await resolveContext(req, req.query.church_id);
    const year = Number(req.query.year) || new Date().getFullYear();
    res.json({ success: true, ...(await churchOverview(ctx, year)) });
}));

// ---------------------------------------------------------------------------
// admin: churches + cross-tenant overview
// ---------------------------------------------------------------------------
async function adminChurches(actor, jurisdiction) {
    let where = "c.database_name IS NOT NULL AND c.database_name <> ''";
    const params = [];
    if (actor.role === 'admin') {
        const ids = await adminChurchIds(actor.id);
        if (!ids.length) return [];
        where += ' AND c.id IN (?)'; params.push(ids);
    } else if (actor.role !== 'super_admin') return [];
    if (jurisdiction) { where += ' AND c.jurisdiction = ?'; params.push(jurisdiction); }
    const [rows] = await promisePool.query(
        `SELECT c.id, COALESCE(c.church_name, c.name) AS name, c.jurisdiction, c.database_name, c.plan_max_storage_gb, c.city, c.state_province
         FROM orthodoxmetrics_db.churches c WHERE ${where} ORDER BY name`, params);
    const out = [];
    for (const c of rows) {
        try {
            const pool = getTenantPool(c.id);
            const [[u]] = await pool.query('SELECT COALESCE(SUM(size_bytes),0) used, COUNT(*) files FROM fm_files WHERE deleted_at IS NULL');
            const [[la]] = await pool.query('SELECT MAX(created_at) last FROM fm_activity');
            out.push({ ...c, quota_bytes: Number(c.plan_max_storage_gb || DEFAULT_QUOTA_GB) * 1024 ** 3, used_bytes: Number(u.used), file_count: Number(u.files), last_activity: la.last });
        } catch (e) {
            out.push({ ...c, quota_bytes: Number(c.plan_max_storage_gb || DEFAULT_QUOTA_GB) * 1024 ** 3, used_bytes: 0, file_count: 0, last_activity: null, error: 'storage unavailable' });
        }
    }
    return out;
}

router.get('/admin/churches', requireAuth, handle(async (req, res) => {
    const actor = await loadActor(getUserId(req));
    if (!actor || !PLATFORM_ROLES.includes(actor.role)) return res.status(403).json({ success: false, message: 'Administrators only' });
    const churches = await adminChurches(actor, req.query.jurisdiction);
    const [j] = await promisePool.query("SELECT DISTINCT jurisdiction FROM orthodoxmetrics_db.churches WHERE jurisdiction IS NOT NULL AND jurisdiction <> '' ORDER BY jurisdiction");
    res.json({ success: true, churches, jurisdictions: j.map((r) => r.jurisdiction) });
}));

router.get('/admin/overview', requireAuth, handle(async (req, res) => {
    const actor = await loadActor(getUserId(req));
    if (!actor || !PLATFORM_ROLES.includes(actor.role)) return res.status(403).json({ success: false, message: 'Administrators only' });
    const year = Number(req.query.year) || new Date().getFullYear();
    const churches = await adminChurches(actor, req.query.jurisdiction);
    const totals = { quota_bytes: 0, used_bytes: 0, file_count: 0, categories: { images: { count: 0, bytes: 0 }, media: { count: 0, bytes: 0 }, documents: { count: 0, bytes: 0 }, other: { count: 0, bytes: 0 } }, roots: SYSTEM_ROOTS.map((r) => ({ key: r.key, name: r.name, count: 0, bytes: 0 })) };
    const series = ['image', 'video', 'audio', 'document', 'other'].map((c) => ({ name: c, data: Array(12).fill(0) }));
    const recent = [];
    for (const c of churches) {
        totals.quota_bytes += c.quota_bytes; totals.used_bytes += c.used_bytes; totals.file_count += c.file_count;
        try {
            const ctx = { church: c, pool: getTenantPool(c.id), actor, quotaBytes: c.quota_bytes };
            const ov = await churchOverview(ctx, year);
            for (const k of Object.keys(totals.categories)) { totals.categories[k].count += ov.categories[k].count; totals.categories[k].bytes += ov.categories[k].bytes; }
            ov.roots.forEach((r, i) => { totals.roots[i].count += r.count; totals.roots[i].bytes += r.bytes; });
            ov.activity.series.forEach((s, i) => s.data.forEach((v, m) => { series[i].data[m] += v; }));
            ov.recent_activity.forEach((a) => recent.push({ ...a, church: { id: c.id, name: c.name } }));
        } catch (e) { /* tenant unavailable */ }
    }
    recent.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ success: true, year, jurisdiction: req.query.jurisdiction || null, churches, totals, activity: { year, series }, recent_activity: recent.slice(0, 20) });
}));

module.exports = router;
