/**
 * /api/om/social — profile feed for the om-platform user profile page.
 *
 * Reuses existing platform tables: users (counters), user_followers, blog_posts
 * (feed posts; title/slug derived), blog_comments, social_reactions, user_gallery,
 * friendships (via /api/social/friends). Media files are written to
 * server/storage/social/<scope>/ and recorded in orthodoxmetrics_db.social_media
 * for platform roles or om_church_##.social_media for church-role users.
 *
 * Role rules
 *   super_admin  follow anyone
 *   admin        follow any non-super_admin
 *   church roles follow admins and members of their own church
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { promisePool, getTenantPool } = require('../../config/db');
const { requireAuth, optionalAuth } = require('../../middleware/auth');
const { bannerUrlForMember } = require('../../services/churchProfileBanners');

const router = express.Router();

const PLATFORM_ROLES = ['super_admin', 'admin'];
const STORAGE_ROOT = path.resolve(__dirname, '../../../storage/social');
const PUBLIC_MEDIA_PREFIX = '/api/om/media';

const getUserId = (req) => req.user?.id || req.session?.user?.id;
const isPlatform = (role) => PLATFORM_ROLES.includes(role);

async function loadUser(id) {
    const [rows] = await promisePool.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.display_name, u.role, u.church_id,
                u.avatar_url, u.banner_url, u.bio, u.location, u.website, u.job_title,
                u.church_affiliation, u.profile_visibility, u.is_online, u.last_seen,
                u.followers_count, u.following_count, u.posts_count, u.created_at,
                COALESCE(c.church_name, c.name) AS church_name
         FROM orthodoxmetrics_db.users u
         LEFT JOIN orthodoxmetrics_db.churches c ON c.id = u.church_id
         WHERE u.id = ? AND u.is_active = 1 AND u.account_status = 'active'`,
        [id]
    );
    return rows[0] || null;
}

const displayName = (u) => u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;

const publicUser = (u) => ({
    id: u.id,
    name: displayName(u),
    role: u.role,
    avatar_url: u.avatar_url || null,
    church_id: u.church_id,
    church_name: u.church_name || null,
    location: u.location || null,
    job_title: u.job_title || null,
});

/** Can `actor` follow / interact with `target`? */
function canFollow(actor, target) {
    if (!actor || !target || actor.id === target.id) return false;
    if (actor.role === 'super_admin') return true;
    if (actor.role === 'admin') return target.role !== 'super_admin';
    if (target.role === 'admin') return true;
    return !!actor.church_id && actor.church_id === target.church_id;
}

async function refreshCounters(userId) {
    await promisePool.query(
        `UPDATE orthodoxmetrics_db.users u SET
            followers_count = (SELECT COUNT(*) FROM orthodoxmetrics_db.user_followers WHERE user_id = u.id),
            following_count = (SELECT COUNT(*) FROM orthodoxmetrics_db.user_followers WHERE follower_id = u.id),
            posts_count = (SELECT COUNT(*) FROM orthodoxmetrics_db.blog_posts WHERE user_id = u.id AND status = 'published')
         WHERE u.id = ?`,
        [userId]
    );
}

/** Fire-and-forget notification via the platform notification service. */
async function notify(userId, typeName, title, message, options = {}) {
    if (!userId || Number(userId) === Number(options.senderId)) return;
    try {
        const { notificationService } = require('../../api/notifications');
        await notificationService.createNotification(userId, typeName, title, message, options);
    } catch (e) {
        console.warn('[om/social] notification skipped:', e.message);
    }
}

/** Resolve @mentions ("@First Last" or "@display name") to reachable user ids. */
async function mentionedUserIds(text, excludeId) {
    const names = [...String(text || '').matchAll(/@([A-Za-z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})/g)].map((m) => m[1].trim());
    if (!names.length) return [];
    const [rows] = await promisePool.query(
        `SELECT id, display_name, CONCAT_WS(' ', first_name, last_name) AS full_name
         FROM orthodoxmetrics_db.users WHERE is_active = 1 AND account_status = 'active' AND id <> ?`,
        [excludeId]
    );
    const ids = new Set();
    for (const n of names) {
        const lower = n.toLowerCase();
        for (const u of rows) {
            const dn = (u.display_name || '').toLowerCase();
            const fn = (u.full_name || '').toLowerCase();
            if ((dn && lower.startsWith(dn)) || (fn && lower.startsWith(fn))) ids.add(u.id);
        }
    }
    return [...ids];
}

// =============================================================================
// PROFILE
// =============================================================================

// GET /api/om/social/me — resolves to the caller's own profile
router.get('/me', requireAuth, async (req, res) => {
    req.params.id = String(getUserId(req));
    return profileHandler(req, res);
});

async function profileHandler(req, res) {
    try {
        const id = parseInt(req.params.id);
        const viewerId = getUserId(req);
        if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Invalid user id' });
        const user = await loadUser(id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        let isFollowing = false;
        let isFriend = false;
        let viewer = null;
        if (viewerId) {
            viewer = viewerId === id ? user : await loadUser(viewerId);
            const [[f]] = await promisePool.query(
                'SELECT COUNT(*) c FROM orthodoxmetrics_db.user_followers WHERE user_id = ? AND follower_id = ?',
                [id, viewerId]
            );
            isFollowing = f.c > 0;
            const [[fr]] = await promisePool.query(
                `SELECT COUNT(*) c FROM orthodoxmetrics_db.friendships
                 WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
                [id, viewerId, viewerId, id]
            );
            isFriend = fr.c > 0;
        }

        res.json({
            success: true,
            profile: {
                ...publicUser(user),
                email: user.email,
                banner_url: user.banner_url || null,
                bio: user.bio || null,
                website: user.website || null,
                church_affiliation: user.church_affiliation || null,
                profile_visibility: user.profile_visibility,
                followers_count: user.followers_count || 0,
                following_count: user.following_count || 0,
                posts_count: user.posts_count || 0,
                member_since: user.created_at,
                is_self: viewerId === id,
                is_following: isFollowing,
                is_friend: isFriend,
                can_follow: viewer ? canFollow(viewer, user) : false,
            },
        });
    } catch (err) {
        console.error('[om/social] profile error:', err);
        res.status(500).json({ success: false, message: 'Failed to load profile' });
    }
}

router.get('/users/:id', optionalAuth, profileHandler);

// PUT /api/om/social/me/cover  { banner_id: number | null }
// Members may only apply a banner published for their own om_church_##.
router.put('/me/cover', requireAuth, async (req, res) => {
    try {
        const body = req.body || {};
        if (!Object.prototype.hasOwnProperty.call(body, 'banner_id')) {
            return res.status(400).json({ success: false, message: 'Choose a parish banner' });
        }
        const user = await loadUser(getUserId(req));
        if (!user) return res.status(403).json({ success: false, message: 'Account is not active' });
        if (body.banner_id === null) {
            await promisePool.query('UPDATE orthodoxmetrics_db.users SET banner_url = NULL WHERE id = ?', [user.id]);
            return res.json({ success: true, banner_url: null });
        }
        if (!user.church_id) {
            return res.status(400).json({ success: false, message: 'Your account is not assigned to a church' });
        }
        const bannerId = Number(body.banner_id);
        if (!Number.isInteger(bannerId) || bannerId <= 0) {
            return res.status(400).json({ success: false, message: 'Choose a parish banner' });
        }
        const bannerUrl = await bannerUrlForMember(user.church_id, bannerId);
        if (!bannerUrl) return res.status(404).json({ success: false, message: 'That banner is not available for your parish' });
        await promisePool.query('UPDATE orthodoxmetrics_db.users SET banner_url = ? WHERE id = ?', [bannerUrl, user.id]);
        res.json({ success: true, banner_url: bannerUrl });
    } catch (err) {
        console.error('[om/social] cover error:', err);
        res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Failed to update cover' });
    }
});

// =============================================================================
// FOLLOWERS
// =============================================================================

router.post('/users/:id/follow', requireAuth, async (req, res) => {
    try {
        const targetId = parseInt(req.params.id);
        const [actor, target] = await Promise.all([loadUser(getUserId(req)), loadUser(targetId)]);
        if (!target) return res.status(404).json({ success: false, message: 'User not found' });
        if (!canFollow(actor, target)) {
            return res.status(403).json({ success: false, message: 'You cannot follow this account' });
        }
        await promisePool.query(
            'INSERT IGNORE INTO orthodoxmetrics_db.user_followers (user_id, follower_id) VALUES (?, ?)',
            [targetId, actor.id]
        );
        await Promise.all([refreshCounters(targetId), refreshCounters(actor.id)]);
        notify(targetId, 'new_follower', 'New follower', `${displayName(actor)} started following you`, {
            senderId: actor.id,
            actionUrl: `/dashboard/user/profile?user=${actor.id}`,
            data: { user_id: actor.id },
        });
        res.json({ success: true, following: true });
    } catch (err) {
        console.error('[om/social] follow error:', err);
        res.status(500).json({ success: false, message: 'Failed to follow' });
    }
});

router.delete('/users/:id/follow', requireAuth, async (req, res) => {
    try {
        const targetId = parseInt(req.params.id);
        const actorId = getUserId(req);
        await promisePool.query(
            'DELETE FROM orthodoxmetrics_db.user_followers WHERE user_id = ? AND follower_id = ?',
            [targetId, actorId]
        );
        await Promise.all([refreshCounters(targetId), refreshCounters(actorId)]);
        res.json({ success: true, following: false });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to unfollow' });
    }
});

async function listFollowLike(req, res, direction) {
    try {
        const id = parseInt(req.params.id);
        const viewerId = getUserId(req);
        const joinCol = direction === 'followers' ? 'f.follower_id' : 'f.user_id';
        const whereCol = direction === 'followers' ? 'f.user_id' : 'f.follower_id';
        const [rows] = await promisePool.query(
            `SELECT u.id, u.first_name, u.last_name, u.display_name, u.email, u.role, u.avatar_url,
                    u.church_id, u.location, u.job_title, COALESCE(c.church_name, c.name) AS church_name,
                    f.created_at AS since,
                    EXISTS(SELECT 1 FROM orthodoxmetrics_db.user_followers vf WHERE vf.user_id = u.id AND vf.follower_id = ?) AS viewer_follows
             FROM orthodoxmetrics_db.user_followers f
             JOIN orthodoxmetrics_db.users u ON u.id = ${joinCol}
             LEFT JOIN orthodoxmetrics_db.churches c ON c.id = u.church_id
             WHERE ${whereCol} = ? AND u.is_active = 1
             ORDER BY f.created_at DESC LIMIT 200`,
            [viewerId || 0, id]
        );
        res.json({
            success: true,
            [direction]: rows.map((u) => ({ ...publicUser(u), since: u.since, viewer_follows: !!u.viewer_follows })),
        });
    } catch (err) {
        console.error(`[om/social] ${direction} error:`, err);
        res.status(500).json({ success: false, message: `Failed to load ${direction}` });
    }
}

router.get('/users/:id/followers', optionalAuth, (req, res) => listFollowLike(req, res, 'followers'));
router.get('/users/:id/following', optionalAuth, (req, res) => listFollowLike(req, res, 'following'));

// GET /api/om/social/users/:id/friends — accepted friendships with role/church
router.get('/users/:id/friends', optionalAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const [rows] = await promisePool.query(
            `SELECT u.id, u.first_name, u.last_name, u.display_name, u.email, u.role, u.avatar_url,
                    u.church_id, u.location, u.job_title, COALESCE(c.church_name, c.name) AS church_name,
                    fr.requested_at AS since
             FROM orthodoxmetrics_db.friendships fr
             JOIN orthodoxmetrics_db.users u
               ON u.id = CASE WHEN fr.requester_id = ? THEN fr.addressee_id ELSE fr.requester_id END
             LEFT JOIN orthodoxmetrics_db.churches c ON c.id = u.church_id
             WHERE fr.status = 'accepted' AND (fr.requester_id = ? OR fr.addressee_id = ?) AND u.is_active = 1
             ORDER BY u.display_name, u.first_name`,
            [id, id, id]
        );
        res.json({ success: true, friends: rows.map((u) => ({ ...publicUser(u), since: u.since })) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to load friends' });
    }
});

// =============================================================================
// MEDIA (tenant-aware)
// =============================================================================

function scopeFor(user) {
    return isPlatform(user.role) || !user.church_id ? 'platform' : `church_${user.church_id}`;
}

const upload = multer({
    storage: multer.diskStorage({
        destination: async (req, file, cb) => {
            try {
                const user = await loadUser(getUserId(req));
                if (!user) return cb(new Error('User not found'));
                req.omUser = user;
                const dir = path.join(STORAGE_ROOT, scopeFor(user));
                fs.mkdirSync(dir, { recursive: true });
                cb(null, dir);
            } catch (e) {
                cb(e);
            }
        },
        // No extension on disk / in the URL: the edge proxy routes *.png|jpg|… to static
        // hosting, so media must be reachable through an extension-less /api path.
        filename: (req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}`),
    }),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/.test(file.mimetype);
        cb(ok ? null : new Error('Only JPEG/PNG/GIF/WebP images or MP4/WebM/MOV videos are allowed'), ok);
    },
});

async function recordMedia(user, file, usageType) {
    const scope = scopeFor(user);
    const fileUrl = `${PUBLIC_MEDIA_PREFIX}/${scope}/${file.filename}`;
    const row = [
        user.church_id || null, user.id, file.filename, file.originalname, file.path, fileUrl,
        path.extname(file.originalname).slice(1).toLowerCase(), file.size, file.mimetype, usageType,
    ];
    const sql = `INSERT INTO social_media
        (church_id, user_id, filename, original_filename, file_path, file_url, file_type, file_size, mime_type, usage_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const pool = scope === 'platform' ? promisePool : getTenantPool(user.church_id);
    const [r] = await pool.query(sql, row);
    return { id: r.insertId, scope, url: fileUrl, kind: file.mimetype.startsWith('video/') ? 'video' : 'image', mime_type: file.mimetype, size: file.size };
}

// POST /api/om/social/media  (multipart "files", up to 6)  ?usage=post|gallery|cover
router.post('/media', requireAuth, (req, res) => {
    upload.array('files', 6)(req, res, async (err) => {
        if (err) return res.status(400).json({ success: false, message: err.message });
        try {
            const user = req.omUser || (await loadUser(getUserId(req)));
            const usage = req.query.usage === 'gallery' ? 'gallery' : req.query.usage === 'cover' ? 'cover_image' : 'blog_image';
            const files = [];
            for (const f of req.files || []) {
                const kind = f.mimetype.startsWith('video/') ? 'post_video' : usage;
                const media = await recordMedia(user, f, kind);
                if (usage === 'gallery' && media.kind === 'image') {
                    await promisePool.query(
                        'INSERT INTO orthodoxmetrics_db.user_gallery (user_id, url, caption) VALUES (?, ?, ?)',
                        [user.id, media.url, req.body?.caption || null]
                    );
                }
                files.push(media);
            }
            res.json({ success: true, files });
        } catch (e) {
            console.error('[om/social] media error:', e);
            res.status(500).json({ success: false, message: 'Upload failed' });
        }
    });
});

// GET /api/om/social/users/:id/gallery
router.get('/users/:id/gallery', optionalAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const [rows] = await promisePool.query(
            'SELECT id, url, caption, created_at FROM orthodoxmetrics_db.user_gallery WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
            [id]
        );
        res.json({ success: true, gallery: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to load gallery' });
    }
});

router.delete('/gallery/:id', requireAuth, async (req, res) => {
    try {
        const [r] = await promisePool.query(
            'DELETE FROM orthodoxmetrics_db.user_gallery WHERE id = ? AND user_id = ?',
            [parseInt(req.params.id), getUserId(req)]
        );
        res.json({ success: true, deleted: r.affectedRows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to delete' });
    }
});

// =============================================================================
// POSTS (blog_posts as the profile feed)
// =============================================================================

const POST_SELECT = `
    SELECT bp.id, bp.user_id, bp.content, bp.featured_image_url, bp.metadata, bp.visibility, bp.church_id,
           bp.created_at, bp.published_at,
           u.first_name, u.last_name, u.display_name, u.email, u.role, u.avatar_url,
           (SELECT COUNT(*) FROM orthodoxmetrics_db.social_reactions sr WHERE sr.target_type = 'blog_post' AND sr.target_id = bp.id) AS like_count,
           (SELECT COUNT(*) FROM orthodoxmetrics_db.blog_comments bc WHERE bc.post_id = bp.id) AS comment_count,
           EXISTS(SELECT 1 FROM orthodoxmetrics_db.social_reactions sr2 WHERE sr2.target_type = 'blog_post' AND sr2.target_id = bp.id AND sr2.user_id = ?) AS viewer_liked
    FROM orthodoxmetrics_db.blog_posts bp
    JOIN orthodoxmetrics_db.users u ON u.id = bp.user_id`;

function shapePost(row) {
    let meta = {};
    try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {}; } catch (e) { meta = {}; }
    return {
        id: row.id,
        author: { id: row.user_id, name: displayName(row), role: row.role, avatar_url: row.avatar_url || null },
        message: row.content,
        media: Array.isArray(meta.media) ? meta.media : row.featured_image_url ? [{ url: row.featured_image_url, kind: 'image' }] : [],
        shared_from: meta.shared_from || null,
        visibility: row.visibility,
        church_id: row.church_id,
        created_at: row.published_at || row.created_at,
        like_count: Number(row.like_count) || 0,
        comment_count: Number(row.comment_count) || 0,
        viewer_liked: !!row.viewer_liked,
    };
}

async function canViewPost(viewer, row) {
    if (!viewer) return row.visibility === 'public';
    if (viewer.id === row.user_id || isPlatform(viewer.role)) return true;
    if (row.visibility === 'private') return false;
    if (row.visibility === 'friends_only') {
        const [[f]] = await promisePool.query(
            `SELECT COUNT(*) c FROM orthodoxmetrics_db.friendships WHERE status='accepted'
             AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))`,
            [viewer.id, row.user_id, row.user_id, viewer.id]
        );
        return f.c > 0;
    }
    return true;
}

// GET /api/om/social/users/:id/posts
router.get('/users/:id/posts', optionalAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const viewerId = getUserId(req);
        const viewer = viewerId ? await loadUser(viewerId) : null;
        const [rows] = await promisePool.query(
            `${POST_SELECT} WHERE bp.user_id = ? AND bp.status = 'published' ORDER BY bp.published_at DESC, bp.id DESC LIMIT 100`,
            [viewerId || 0, id]
        );
        const visible = [];
        for (const row of rows) if (await canViewPost(viewer, row)) visible.push(shapePost(row));
        res.json({ success: true, posts: visible });
    } catch (err) {
        console.error('[om/social] posts error:', err);
        res.status(500).json({ success: false, message: 'Failed to load posts' });
    }
});

// POST /api/om/social/posts  { message, media: [{url,kind}], visibility, shared_from }
router.post('/posts', requireAuth, async (req, res) => {
    try {
        const user = await loadUser(getUserId(req));
        const { message = '', media = [], visibility = 'public', shared_from = null } = req.body || {};
        const text = String(message).trim();
        if (!text && !(Array.isArray(media) && media.length) && !shared_from) {
            return res.status(400).json({ success: false, message: 'Write something or attach media' });
        }
        if (!['public', 'friends_only', 'private'].includes(visibility)) {
            return res.status(400).json({ success: false, message: 'Invalid visibility' });
        }
        let sharedMeta = null;
        if (shared_from) {
            const [[src]] = await promisePool.query(`${POST_SELECT} WHERE bp.id = ?`, [user.id, parseInt(shared_from)]);
            if (!src || !(await canViewPost(user, src))) return res.status(404).json({ success: false, message: 'Original post not found' });
            const shaped = shapePost(src);
            sharedMeta = { id: shaped.id, author: shaped.author, message: shaped.message, media: shaped.media, created_at: shaped.created_at };
        }
        const title = (text || (sharedMeta ? `Shared: ${sharedMeta.author.name}` : 'Post')).slice(0, 80);
        const slug = `p-${uuidv4()}`;
        const cleanMedia = (Array.isArray(media) ? media : [])
            .filter((m) => m && typeof m.url === 'string' && m.url.startsWith(PUBLIC_MEDIA_PREFIX))
            .map((m) => ({ url: m.url, kind: m.kind === 'video' ? 'video' : 'image' }));
        const featured = cleanMedia.find((m) => m.kind === 'image')?.url || null;
        const [r] = await promisePool.query(
            `INSERT INTO orthodoxmetrics_db.blog_posts
             (church_id, user_id, title, slug, content, excerpt, featured_image_url, status, visibility, metadata, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, NOW())`,
            [user.church_id || null, user.id, title, slug, text, text.slice(0, 200), featured, visibility,
             JSON.stringify({ media: cleanMedia, shared_from: sharedMeta, source: 'om-platform-profile' })]
        );
        await refreshCounters(user.id);
        const postUrl = `/dashboard/user/profile?user=${user.id}`;
        if (sharedMeta) {
            notify(sharedMeta.author.id, 'post_share', 'Post shared', `${displayName(user)} shared your post`, {
                senderId: user.id, actionUrl: postUrl, data: { post_id: r.insertId, original_post_id: sharedMeta.id },
            });
        }
        for (const uid of await mentionedUserIds(text, user.id)) {
            notify(uid, 'mention', 'You were mentioned', `${displayName(user)} mentioned you in a post`, {
                senderId: user.id, actionUrl: postUrl, data: { post_id: r.insertId, excerpt: text.slice(0, 140) },
            });
        }
        const [[row]] = await promisePool.query(`${POST_SELECT} WHERE bp.id = ?`, [user.id, r.insertId]);
        res.json({ success: true, post: shapePost(row) });
    } catch (err) {
        console.error('[om/social] create post error:', err);
        res.status(500).json({ success: false, message: 'Failed to create post' });
    }
});

router.delete('/posts/:id', requireAuth, async (req, res) => {
    try {
        const user = await loadUser(getUserId(req));
        const postId = parseInt(req.params.id);
        const [[post]] = await promisePool.query('SELECT user_id FROM orthodoxmetrics_db.blog_posts WHERE id = ?', [postId]);
        if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
        if (post.user_id !== user.id && !isPlatform(user.role)) return res.status(403).json({ success: false, message: 'Not allowed' });
        await promisePool.query('DELETE FROM orthodoxmetrics_db.blog_comments WHERE post_id = ?', [postId]);
        await promisePool.query("DELETE FROM orthodoxmetrics_db.social_reactions WHERE target_type = 'blog_post' AND target_id = ?", [postId]);
        await promisePool.query('DELETE FROM orthodoxmetrics_db.blog_posts WHERE id = ?', [postId]);
        await refreshCounters(post.user_id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to delete post' });
    }
});

// POST /api/om/social/posts/:id/like  — toggle
router.post('/posts/:id/like', requireAuth, async (req, res) => {
    try {
        const user = await loadUser(getUserId(req));
        const postId = parseInt(req.params.id);
        const [[row]] = await promisePool.query(`${POST_SELECT} WHERE bp.id = ?`, [user.id, postId]);
        if (!row || !(await canViewPost(user, row))) return res.status(404).json({ success: false, message: 'Post not found' });
        if (row.viewer_liked) {
            await promisePool.query("DELETE FROM orthodoxmetrics_db.social_reactions WHERE target_type='blog_post' AND target_id=? AND user_id=?", [postId, user.id]);
        } else {
            await promisePool.query(
                "INSERT INTO orthodoxmetrics_db.social_reactions (church_id, user_id, target_type, target_id, reaction_type) VALUES (?, ?, 'blog_post', ?, 'like')",
                [user.church_id || null, user.id, postId]
            );
            notify(row.user_id, 'post_like', 'New like', `${displayName(user)} liked your post`, {
                senderId: user.id, actionUrl: `/dashboard/user/profile?user=${row.user_id}`, data: { post_id: postId },
            });
        }
        const [[after]] = await promisePool.query(`${POST_SELECT} WHERE bp.id = ?`, [user.id, postId]);
        res.json({ success: true, liked: !!after.viewer_liked, like_count: Number(after.like_count) });
    } catch (err) {
        console.error('[om/social] like error:', err);
        res.status(500).json({ success: false, message: 'Failed to react' });
    }
});

// GET /api/om/social/posts/:id/likes — who liked (for the avatar group)
router.get('/posts/:id/likes', optionalAuth, async (req, res) => {
    try {
        const [rows] = await promisePool.query(
            `SELECT u.id, u.first_name, u.last_name, u.display_name, u.email, u.avatar_url
             FROM orthodoxmetrics_db.social_reactions sr JOIN orthodoxmetrics_db.users u ON u.id = sr.user_id
             WHERE sr.target_type = 'blog_post' AND sr.target_id = ? ORDER BY sr.created_at DESC LIMIT 20`,
            [parseInt(req.params.id)]
        );
        res.json({ success: true, likes: rows.map((u) => ({ id: u.id, name: displayName(u), avatar_url: u.avatar_url || null })) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to load likes' });
    }
});

// GET /api/om/social/posts/:id/comments
router.get('/posts/:id/comments', optionalAuth, async (req, res) => {
    try {
        const [rows] = await promisePool.query(
            `SELECT bc.id, bc.content, bc.created_at, u.id AS user_id, u.first_name, u.last_name, u.display_name, u.email, u.avatar_url
             FROM orthodoxmetrics_db.blog_comments bc JOIN orthodoxmetrics_db.users u ON u.id = bc.user_id
             WHERE bc.post_id = ? AND bc.is_approved = 1 ORDER BY bc.created_at ASC LIMIT 200`,
            [parseInt(req.params.id)]
        );
        res.json({
            success: true,
            comments: rows.map((c) => ({
                id: c.id, message: c.content, created_at: c.created_at,
                author: { id: c.user_id, name: displayName(c), avatar_url: c.avatar_url || null },
            })),
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to load comments' });
    }
});

// POST /api/om/social/posts/:id/comments { message }
router.post('/posts/:id/comments', requireAuth, async (req, res) => {
    try {
        const user = await loadUser(getUserId(req));
        const postId = parseInt(req.params.id);
        const text = String(req.body?.message || '').trim();
        if (!text) return res.status(400).json({ success: false, message: 'Comment is empty' });
        const [[row]] = await promisePool.query(`${POST_SELECT} WHERE bp.id = ?`, [user.id, postId]);
        if (!row || !(await canViewPost(user, row))) return res.status(404).json({ success: false, message: 'Post not found' });
        const [r] = await promisePool.query(
            'INSERT INTO orthodoxmetrics_db.blog_comments (church_id, post_id, user_id, content, is_approved) VALUES (?, ?, ?, ?, 1)',
            [user.church_id || null, postId, user.id, text]
        );
        const postUrl = `/dashboard/user/profile?user=${row.user_id}`;
        notify(row.user_id, 'post_comment', 'New comment', `${displayName(user)} replied to your post`, {
            senderId: user.id, actionUrl: postUrl, data: { post_id: postId, comment_id: r.insertId, excerpt: text.slice(0, 140) },
        });
        for (const uid of await mentionedUserIds(text, user.id)) {
            if (uid !== row.user_id) {
                notify(uid, 'mention', 'You were mentioned', `${displayName(user)} mentioned you in a comment`, {
                    senderId: user.id, actionUrl: postUrl, data: { post_id: postId, comment_id: r.insertId, excerpt: text.slice(0, 140) },
                });
            }
        }
        res.json({
            success: true,
            comment: { id: r.insertId, message: text, created_at: new Date().toISOString(), author: { id: user.id, name: displayName(user), avatar_url: user.avatar_url || null } },
        });
    } catch (err) {
        console.error('[om/social] comment error:', err);
        res.status(500).json({ success: false, message: 'Failed to comment' });
    }
});

// =============================================================================
// MEDIA FILE DELIVERY — GET /api/om/media/:scope/:name (mounted separately)
// =============================================================================
const mediaRouter = express.Router();
mediaRouter.get('/:scope/:name', async (req, res) => {
    try {
        const { scope, name } = req.params;
        if (!/^(platform|church_\d+)$/.test(scope) || !/^[\w-]+$/.test(name)) return res.status(404).end();
        const pool = scope === 'platform' ? promisePool : getTenantPool(Number(scope.slice(7)));
        const [[row]] = await pool.query('SELECT mime_type, file_path FROM social_media WHERE filename = ? LIMIT 1', [name]);
        if (!row) return res.status(404).end();
        const filePath = path.join(STORAGE_ROOT, scope, name);
        if (!fs.existsSync(filePath)) return res.status(404).end();
        res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        res.sendFile(filePath);
    } catch (err) {
        console.error('[om/media] error:', err);
        res.status(500).end();
    }
});

module.exports = { router, mediaRouter, STORAGE_ROOT };
