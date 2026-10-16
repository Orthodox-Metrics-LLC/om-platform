/**
 * /api/om/chat — role- and church-scoped messaging for the om-platform chat page.
 * Reuses chat_conversations / chat_participants / chat_messages.
 *
 * Reachability
 *   super_admin  → anyone
 *   admin        → super_admins, other admins, and church-role users of the churches
 *                  the admin is responsible for (user_roles: role=admin + church_id)
 *   church roles → members of their own om_church_##, plus the admins responsible for
 *                  that church (falls back to every admin when none is assigned, so
 *                  support is always reachable)
 * Every participant of a conversation must be reachable from the creator, and a
 * participant may only read conversations they belong to.
 */
const express = require('express');
const { promisePool } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

const PLATFORM_ROLES = ['super_admin', 'admin'];
const getUserId = (req) => req.user?.id || req.session?.user?.id;
const isPlatform = (role) => PLATFORM_ROLES.includes(role);

const USER_SELECT = `
    SELECT u.id, u.email, u.first_name, u.last_name, u.display_name, u.role, u.church_id,
           u.avatar_url, u.phone, u.location, u.job_title, u.is_online, u.last_seen,
           COALESCE(c.church_name, c.name) AS church_name
    FROM orthodoxmetrics_db.users u
    LEFT JOIN orthodoxmetrics_db.churches c ON c.id = u.church_id`;

const ACTIVE = "u.is_active = 1 AND u.account_status = 'active' AND u.role <> 'brain_ingest'";

const displayName = (u) => u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;

const toParticipant = (u) => ({
    id: String(u.id),
    name: displayName(u),
    role: u.role,
    email: u.email,
    address: u.church_name || '',
    avatarUrl: u.avatar_url || '',
    phoneNumber: u.phone || '',
    lastActivity: u.last_seen || null,
    status: u.is_online ? 'online' : 'offline',
    churchId: u.church_id,
    churchName: u.church_name || null,
});

async function loadUser(id) {
    const [rows] = await promisePool.query(`${USER_SELECT} WHERE u.id = ? AND ${ACTIVE}`, [id]);
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

async function adminsForChurch(churchId) {
    const [rows] = await promisePool.query(
        `SELECT ur.user_id FROM orthodoxmetrics_db.user_roles ur
         JOIN orthodoxmetrics_db.roles r ON r.id = ur.role_id
         JOIN orthodoxmetrics_db.users u ON u.id = ur.user_id
         WHERE r.name = 'admin' AND ur.church_id = ? AND u.role = 'admin' AND ${ACTIVE}`,
        [churchId]
    );
    return rows.map((r) => r.user_id);
}

/** Users the actor may message, optionally filtered by a search string. */
async function reachableUsers(actor, q = '') {
    const like = `%${q}%`;
    const search = q ? ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.display_name LIKE ? OR u.email LIKE ?)` : '';
    const sp = q ? [like, like, like, like] : [];
    let where;
    let params = [];

    if (actor.role === 'super_admin') {
        where = `u.id <> ?`;
        params = [actor.id];
    } else if (actor.role === 'admin') {
        const churches = await adminChurchIds(actor.id);
        where = churches.length
            ? `u.id <> ? AND (u.role IN ('super_admin','admin') OR u.church_id IN (?))`
            : `u.id <> ? AND u.role IN ('super_admin','admin')`;
        params = churches.length ? [actor.id, churches] : [actor.id];
    } else {
        if (!actor.church_id) return [];
        const admins = await adminsForChurch(actor.church_id);
        where = admins.length
            ? `u.id <> ? AND ((u.church_id = ? AND NOT u.role IN ('super_admin','admin')) OR u.id IN (?))`
            : `u.id <> ? AND ((u.church_id = ? AND NOT u.role IN ('super_admin','admin')) OR u.role = 'admin')`;
        params = admins.length ? [actor.id, actor.church_id, admins] : [actor.id, actor.church_id];
    }

    const [rows] = await promisePool.query(
        `${USER_SELECT} WHERE ${ACTIVE} AND ${where}${search} ORDER BY u.is_online DESC, u.display_name, u.first_name LIMIT 200`,
        [...params, ...sp]
    );
    return rows;
}

async function canReach(actor, targetId) {
    if (Number(targetId) === Number(actor.id)) return false;
    const list = await reachableUsers(actor);
    return list.some((u) => Number(u.id) === Number(targetId));
}

async function isParticipant(conversationId, userId) {
    const [[r]] = await promisePool.query(
        'SELECT COUNT(*) c FROM orthodoxmetrics_db.chat_participants WHERE conversation_id = ? AND user_id = ?',
        [conversationId, userId]
    );
    return r.c > 0;
}

async function participantsOf(conversationId) {
    const [rows] = await promisePool.query(
        `${USER_SELECT} JOIN orthodoxmetrics_db.chat_participants cp ON cp.user_id = u.id
         WHERE cp.conversation_id = ? AND u.is_active = 1`,
        [conversationId]
    );
    return rows.map(toParticipant);
}

function shapeMessage(m) {
    let attachments = [];
    try {
        const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata || {};
        attachments = Array.isArray(meta.attachments) ? meta.attachments : [];
    } catch (e) { attachments = []; }
    return {
        id: String(m.id),
        body: m.is_deleted ? '' : m.content || '',
        senderId: String(m.sender_id),
        contentType: m.message_type === 'image' ? 'image' : 'text',
        createdAt: m.created_at,
        attachments,
    };
}

async function messagesOf(conversationId, limit = 200) {
    const [rows] = await promisePool.query(
        `SELECT id, sender_id, message_type, content, metadata, is_deleted, created_at
         FROM orthodoxmetrics_db.chat_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`,
        [conversationId, limit]
    );
    return rows.map(shapeMessage);
}

async function shapeConversation(convRow, viewerId, withMessages) {
    const participants = await participantsOf(convRow.id);
    const [[unread]] = await promisePool.query(
        `SELECT COUNT(*) c FROM orthodoxmetrics_db.chat_messages m
         JOIN orthodoxmetrics_db.chat_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
         WHERE m.conversation_id = ? AND m.sender_id <> ? AND m.created_at > COALESCE(p.last_read_at, '1970-01-01')`,
        [viewerId, convRow.id, viewerId]
    );
    let messages;
    if (withMessages) {
        messages = await messagesOf(convRow.id);
    } else {
        const [rows] = await promisePool.query(
            `SELECT id, sender_id, message_type, content, metadata, is_deleted, created_at
             FROM orthodoxmetrics_db.chat_messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
            [convRow.id]
        );
        messages = rows.map(shapeMessage);
    }
    return {
        id: String(convRow.id),
        type: convRow.type === 'group' ? 'GROUP' : 'ONE_TO_ONE',
        name: convRow.name || null,
        churchId: convRow.church_id,
        lastActivity: convRow.last_activity,
        unreadCount: Number(unread.c) || 0,
        participants,
        messages,
    };
}

// =============================================================================

// GET /api/om/chat/contacts?q=
router.get('/contacts', requireAuth, async (req, res) => {
    try {
        const actor = await loadUser(getUserId(req));
        if (!actor) return res.status(403).json({ success: false, message: 'Account is not active' });
        const users = await reachableUsers(actor, String(req.query.q || '').trim());
        res.json({ success: true, contacts: users.map(toParticipant) });
    } catch (err) {
        console.error('[om/chat] contacts error:', err);
        res.status(500).json({ success: false, message: 'Failed to load contacts' });
    }
});

// GET /api/om/chat/conversations
router.get('/conversations', requireAuth, async (req, res) => {
    try {
        const userId = getUserId(req);
        const [rows] = await promisePool.query(
            `SELECT c.* FROM orthodoxmetrics_db.chat_conversations c
             JOIN orthodoxmetrics_db.chat_participants p ON p.conversation_id = c.id
             WHERE p.user_id = ? AND c.is_active = 1
             ORDER BY c.last_activity DESC, c.id DESC LIMIT 100`,
            [userId]
        );
        const conversations = [];
        for (const row of rows) conversations.push(await shapeConversation(row, userId, false));
        res.json({ success: true, conversations });
    } catch (err) {
        console.error('[om/chat] conversations error:', err);
        res.status(500).json({ success: false, message: 'Failed to load conversations' });
    }
});

// GET /api/om/chat/conversations/:id
router.get('/conversations/:id', requireAuth, async (req, res) => {
    try {
        const userId = getUserId(req);
        const id = parseInt(req.params.id);
        if (!(await isParticipant(id, userId))) return res.status(404).json({ success: false, message: 'Conversation not found' });
        const [[row]] = await promisePool.query('SELECT * FROM orthodoxmetrics_db.chat_conversations WHERE id = ? AND is_active = 1', [id]);
        if (!row) return res.status(404).json({ success: false, message: 'Conversation not found' });
        res.json({ success: true, conversation: await shapeConversation(row, userId, true) });
    } catch (err) {
        console.error('[om/chat] conversation error:', err);
        res.status(500).json({ success: false, message: 'Failed to load conversation' });
    }
});

// POST /api/om/chat/conversations  { participant_ids: number[], message?: string, name?: string }
router.post('/conversations', requireAuth, async (req, res) => {
    try {
        const actor = await loadUser(getUserId(req));
        if (!actor) return res.status(403).json({ success: false, message: 'Account is not active' });
        const ids = [...new Set((req.body?.participant_ids || []).map(Number).filter((n) => Number.isInteger(n) && n !== actor.id))];
        if (!ids.length) return res.status(400).json({ success: false, message: 'Select at least one recipient' });

        const reachable = await reachableUsers(actor);
        const blocked = ids.filter((id) => !reachable.some((u) => u.id === id));
        if (blocked.length) {
            return res.status(403).json({ success: false, message: 'You can only message members of your parish and your support administrators' });
        }

        let conversationId;
        if (ids.length === 1) {
            const [existing] = await promisePool.query(
                `SELECT c.id FROM orthodoxmetrics_db.chat_conversations c
                 JOIN orthodoxmetrics_db.chat_participants p1 ON p1.conversation_id = c.id AND p1.user_id = ?
                 JOIN orthodoxmetrics_db.chat_participants p2 ON p2.conversation_id = c.id AND p2.user_id = ?
                 WHERE c.type = 'direct' AND c.is_active = 1 LIMIT 1`,
                [actor.id, ids[0]]
            );
            conversationId = existing[0]?.id;
        }

        if (!conversationId) {
            const members = [actor, ...reachable.filter((u) => ids.includes(u.id))];
            const churchIds = new Set(members.map((m) => m.church_id).filter(Boolean));
            const churchId = churchIds.size === 1 ? [...churchIds][0] : null;
            const type = ids.length === 1 ? 'direct' : 'group';
            const [r] = await promisePool.query(
                `INSERT INTO orthodoxmetrics_db.chat_conversations (church_id, type, name, created_by, is_active, last_activity)
                 VALUES (?, ?, ?, ?, 1, NOW())`,
                [churchId, type, type === 'group' ? req.body?.name || null : null, actor.id]
            );
            conversationId = r.insertId;
            // last_read_at is NOT NULL DEFAULT now(); recipients start at the epoch so the
            // opening message counts as unread for them.
            await promisePool.query(
                'INSERT INTO orthodoxmetrics_db.chat_participants (church_id, conversation_id, user_id, role, last_read_at) VALUES ?',
                [members.map((m) => [churchId, conversationId, m.id, m.id === actor.id ? 'admin' : 'member',
                    m.id === actor.id ? new Date() : new Date('1970-01-02T00:00:00Z')])]
            );
        }

        const text = String(req.body?.message || '').trim();
        if (text) await insertMessage(conversationId, actor.id, text, req.body?.attachments);

        const [[row]] = await promisePool.query('SELECT * FROM orthodoxmetrics_db.chat_conversations WHERE id = ?', [conversationId]);
        res.json({ success: true, conversation: await shapeConversation(row, actor.id, true) });
    } catch (err) {
        console.error('[om/chat] create conversation error:', err);
        res.status(500).json({ success: false, message: 'Failed to start conversation' });
    }
});

async function insertMessage(conversationId, senderId, text, attachments) {
    const clean = (Array.isArray(attachments) ? attachments : [])
        .filter((a) => a && typeof a.path === 'string' && a.path.startsWith('/api/om/media/'))
        .map((a) => ({ name: a.name || 'file', size: Number(a.size) || 0, type: a.type || '', path: a.path, preview: a.path, createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() }));
    const type = !text && clean.length && clean.every((a) => a.type.startsWith('image/')) ? 'image' : 'text';
    const [r] = await promisePool.query(
        `INSERT INTO orthodoxmetrics_db.chat_messages (conversation_id, sender_id, message_type, content, metadata, delivered_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [conversationId, senderId, type, text, JSON.stringify({ attachments: clean })]
    );
    await promisePool.query(
        'UPDATE orthodoxmetrics_db.chat_conversations SET last_message_id = ?, last_activity = NOW() WHERE id = ?',
        [r.insertId, conversationId]
    );
    await promisePool.query(
        'UPDATE orthodoxmetrics_db.chat_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
        [conversationId, senderId]
    );
    const [[m]] = await promisePool.query(
        'SELECT id, sender_id, message_type, content, metadata, is_deleted, created_at FROM orthodoxmetrics_db.chat_messages WHERE id = ?',
        [r.insertId]
    );
    // Notify the other participants (drawer + badge); chat itself polls.
    try {
        const { notificationService } = require('../../api/notifications');
        const [sender] = await promisePool.query(`${USER_SELECT} WHERE u.id = ?`, [senderId]);
        const [others] = await promisePool.query(
            'SELECT user_id FROM orthodoxmetrics_db.chat_participants WHERE conversation_id = ? AND user_id <> ?',
            [conversationId, senderId]
        );
        const from = sender[0] ? displayName(sender[0]) : 'Someone';
        for (const o of others) {
            notificationService.createNotification(o.user_id, 'chat_message', 'New message',
                `${from}: ${text ? text.slice(0, 120) : 'sent an attachment'}`,
                { senderId, actionUrl: `/dashboard/chat?id=${conversationId}`, data: { conversation_id: conversationId, message_id: r.insertId } }
            ).catch(() => {});
        }
    } catch (e) { /* notifications are best-effort */ }
    return shapeMessage(m);
}

// POST /api/om/chat/conversations/:id/messages  { body, attachments? }
router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
    try {
        const userId = getUserId(req);
        const id = parseInt(req.params.id);
        if (!(await isParticipant(id, userId))) return res.status(404).json({ success: false, message: 'Conversation not found' });
        const text = String(req.body?.body || '').trim();
        if (!text && !(Array.isArray(req.body?.attachments) && req.body.attachments.length)) {
            return res.status(400).json({ success: false, message: 'Message is empty' });
        }
        res.json({ success: true, message: await insertMessage(id, userId, text, req.body?.attachments) });
    } catch (err) {
        console.error('[om/chat] send error:', err);
        res.status(500).json({ success: false, message: 'Failed to send message' });
    }
});

// PUT /api/om/chat/conversations/:id/read
router.put('/conversations/:id/read', requireAuth, async (req, res) => {
    try {
        await promisePool.query(
            'UPDATE orthodoxmetrics_db.chat_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
            [parseInt(req.params.id), getUserId(req)]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to mark as read' });
    }
});

// GET /api/om/chat/unread — badge count
router.get('/unread', requireAuth, async (req, res) => {
    try {
        const userId = getUserId(req);
        const [[r]] = await promisePool.query(
            `SELECT COUNT(*) c FROM orthodoxmetrics_db.chat_messages m
             JOIN orthodoxmetrics_db.chat_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
             WHERE m.sender_id <> ? AND m.created_at > COALESCE(p.last_read_at, '1970-01-01')`,
            [userId, userId]
        );
        res.json({ success: true, unread: Number(r.c) || 0 });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

module.exports = router;
