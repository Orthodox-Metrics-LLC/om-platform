/**
 * user-sessions.js — Self-service session management for authenticated users.
 *
 * Mounted at /api/user/sessions in index.ts.
 *
 * Allows any authenticated user to:
 *   - View their own active/recent sessions
 *   - Identify their current session (via refresh_token cookie hash)
 *   - Revoke a single other session
 *   - Revoke all other sessions (preserving current)
 *
 * All operations are scoped to the authenticated user's own sessions only.
 * The current session is protected from accidental revocation via the
 * single-session DELETE endpoint.
 */

const express = require('express');
const crypto = require('crypto');
const { getAppPool } = require('../config/db-compat');
const { requireAuth } = require('../middleware/auth');
const ApiResponse = require('../utils/apiResponse');

const router = express.Router();

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');


const { deriveDeviceSessionKey, parseUA } = require('../middleware/sessionTracker');

/**
 * Soft-revoke a refresh_token row AND force the matching device offline:
 * terminate user_sessions + best-effort destroy express session rows.
 */
async function forceSignOutRefreshRow(pool, userId, row, actorUserId) {
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    [row.id, userId],
  );

  const ua = (row.user_agent || '').substring(0, 2000);
  const ip = row.ip_address || null;
  const { client, device_type } = parseUA(ua);
  let terminated = 0;

  if (ip && client) {
    const deviceKey = deriveDeviceSessionKey(userId, ip, client, device_type);
    const [term] = await pool.query(
      `UPDATE user_sessions
       SET terminated_at = NOW(), terminated_by = ?, is_active = 0
       WHERE user_id = ? AND session_token = ? AND terminated_at IS NULL`,
      [actorUserId || userId, userId, deviceKey],
    );
    terminated += term.affectedRows || 0;
  }

  if (terminated === 0 && ua) {
    const [termUa] = await pool.query(
      `UPDATE user_sessions
       SET terminated_at = NOW(), terminated_by = ?, is_active = 0
       WHERE user_id = ? AND user_agent = ? AND terminated_at IS NULL`,
      [actorUserId || userId, userId, ua],
    );
    terminated += termUa.affectedRows || 0;
  }

  try {
    await pool.query(
      `DELETE FROM sessions
       WHERE data LIKE ? OR data LIKE ?`,
      [`%"id":${Number(userId)}%`, `%"id": ${Number(userId)}%`],
    );
  } catch (err) {
    console.warn('[user-sessions] express session cleanup skipped:', err.message);
  }

  return { refresh_revoked: true, devices_terminated: terminated };
}


/**
 * GET /api/user/sessions
 * Returns the authenticated user's active sessions only.
 * Marks which session is the current one based on refresh_token cookie.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id || req.session?.user?.id;
    if (!userId) {
      return res.status(401).json(ApiResponse(false, null, { message: 'Authentication required', code: 'AUTH_REQUIRED' }));
    }

    // Identify current session by hashing refresh_token (cookie, body, or SPA header)
    const refreshToken =
      req.cookies?.refresh_token
      || req.headers['x-refresh-token']
      || req.body?.refresh_token;
    const currentTokenHash = refreshToken ? hashToken(String(refreshToken)) : null;

    // Active sessions only — revoked/expired rows are kept for audit but not listed here.
    const [rows] = await getAppPool().query(`
      SELECT
        id,
        token_hash,
        created_at,
        expires_at,
        revoked_at,
        ip_address,
        user_agent,
        'active' AS status
      FROM refresh_tokens
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId]);

    const reqUa = (req.get('User-Agent') || '').substring(0, 255);
    let sessions = rows.map((row) => ({
      id: row.id,
      is_current: currentTokenHash ? row.token_hash === currentTokenHash : false,
      status: row.status,
      ip_address: row.ip_address || null,
      user_agent: row.user_agent || null,
      created_at: row.created_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
    }));

    // OIDC login often stores refresh_token only in localStorage — mark best match as current
    if (!sessions.some((s) => s.is_current)) {
      const active = sessions.filter((s) => s.status === 'active');
      if (active.length === 1) {
        active[0].is_current = true;
      } else if (active.length > 0 && reqUa) {
        const uaMatch = active.find((s) => s.user_agent && s.user_agent === reqUa);
        if (uaMatch) uaMatch.is_current = true;
        else active[0].is_current = true;
      }
    }

    res.json(ApiResponse(true, { sessions }));
  } catch (error) {
    console.error('Error fetching user sessions:', error);
    res.status(500).json(ApiResponse(false, null, { message: 'Failed to fetch sessions', code: 'SERVER_ERROR' }));
  }
});

/**
 * DELETE /api/user/sessions/:sessionId
 * Revoke a single session belonging to the authenticated user.
 * Prevents revoking the current session (use logout for that).
 */
router.delete('/:sessionId', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id || req.session?.user?.id;
    if (!userId) {
      return res.status(401).json(ApiResponse(false, null, { message: 'Authentication required', code: 'AUTH_REQUIRED' }));
    }

    const sessionId = parseInt(req.params.sessionId, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json(ApiResponse(false, null, { message: 'Invalid session ID', code: 'VALIDATION_ERROR' }));
    }

    // Verify the session belongs to this user and check if it's the current session
    const refreshToken =
      req.cookies?.refresh_token
      || req.headers['x-refresh-token']
      || req.body?.refresh_token;
    const currentTokenHash = refreshToken ? hashToken(String(refreshToken)) : null;

    const [existing] = await getAppPool().query(
      'SELECT id, token_hash, revoked_at FROM refresh_tokens WHERE id = ? AND user_id = ?',
      [sessionId, userId],
    );

    if (existing.length === 0) {
      return res.status(404).json(ApiResponse(false, null, { message: 'Session not found', code: 'NOT_FOUND' }));
    }

    const session = existing[0];

    // Prevent revoking the current session
    if (currentTokenHash && session.token_hash === currentTokenHash) {
      return res.status(400).json(ApiResponse(false, null, {
        message: 'Cannot revoke your current session. Use logout instead.',
        code: 'CURRENT_SESSION',
      }));
    }

    if (session.revoked_at) {
      return res.status(400).json(ApiResponse(false, null, { message: 'Session already revoked', code: 'ALREADY_REVOKED' }));
    }

    // Soft-revoke refresh token AND force device sign-out (terminate + session destroy)
    const [fullRows] = await getAppPool().query(
      'SELECT id, token_hash, ip_address, user_agent, revoked_at FROM refresh_tokens WHERE id = ? AND user_id = ?',
      [sessionId, userId],
    );
    const result = await forceSignOutRefreshRow(getAppPool(), userId, fullRows[0], userId);

    getAppPool().query(
      `INSERT INTO activity_log (user_id, action, details, ip_address, user_agent, created_at)
       VALUES (?, 'sign_out_session', ?, ?, ?, NOW())`,
      [
        userId,
        JSON.stringify({ revoked_session_id: sessionId, ...result }),
        req.ip || 'unknown',
        (req.get('User-Agent') || 'unknown').substring(0, 255),
      ],
    ).catch((err) => console.error('Failed to log sign_out_session activity:', err.message));

    res.json(ApiResponse(true, {
      message: 'Session signed out successfully',
      ...result,
    }));
  } catch (error) {
    console.error('Error revoking session:', error);
    res.status(500).json(ApiResponse(false, null, { message: 'Failed to revoke session', code: 'SERVER_ERROR' }));
  }
});

/**
 * POST /api/user/sessions/revoke-others
 * Revoke all sessions except the current one.
 */
router.post('/revoke-others', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id || req.session?.user?.id;
    if (!userId) {
      return res.status(401).json(ApiResponse(false, null, { message: 'Authentication required', code: 'AUTH_REQUIRED' }));
    }

    const refreshToken =
      req.cookies?.refresh_token
      || req.headers['x-refresh-token']
      || req.body?.refresh_token;
    const currentTokenHash = refreshToken ? hashToken(String(refreshToken)) : null;

    let result;
    if (currentTokenHash) {
      // Revoke all except current
      [result] = await getAppPool().query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND token_hash != ? AND revoked_at IS NULL',
        [userId, currentTokenHash],
      );
    } else {
      // No current token identified — revoke all (rare edge case)
      [result] = await getAppPool().query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
        [userId],
      );
    }

    // Terminate tracked devices for other sessions (keep current device key alive)
    const reqUa = (req.get('User-Agent') || '').substring(0, 2000);
    const reqIp = req.ip || null;
    let devicesTerminated = 0;
    try {
      const { client, device_type } = parseUA(reqUa);
      const currentKey = (reqIp && client)
        ? deriveDeviceSessionKey(userId, reqIp, client, device_type)
        : null;
      if (currentKey) {
        const [term] = await getAppPool().query(
          `UPDATE user_sessions
           SET terminated_at = NOW(), terminated_by = ?, is_active = 0
           WHERE user_id = ? AND session_token != ? AND terminated_at IS NULL`,
          [userId, userId, currentKey],
        );
        devicesTerminated = term.affectedRows || 0;
      } else {
        const [term] = await getAppPool().query(
          `UPDATE user_sessions
           SET terminated_at = NOW(), terminated_by = ?, is_active = 0
           WHERE user_id = ? AND terminated_at IS NULL`,
          [userId, userId],
        );
        devicesTerminated = term.affectedRows || 0;
      }
    } catch (err) {
      console.warn('[user-sessions] device terminate on revoke-others failed:', err.message);
    }

    getAppPool().query(
      `INSERT INTO activity_log (user_id, action, details, ip_address, user_agent, created_at)
       VALUES (?, 'sign_out_all_other_sessions', ?, ?, ?, NOW())`,
      [
        userId,
        JSON.stringify({ sessions_revoked: result.affectedRows, devices_terminated: devicesTerminated }),
        req.ip || 'unknown',
        (req.get('User-Agent') || 'unknown').substring(0, 255),
      ],
    ).catch((err) => console.error('Failed to log sign_out_all activity:', err.message));

    res.json(ApiResponse(true, {
      message: `Signed out ${result.affectedRows} other session(s)`,
      revoked_count: result.affectedRows,
      devices_terminated: devicesTerminated,
    }));
  } catch (error) {
    console.error('Error revoking other sessions:', error);
    res.status(500).json(ApiResponse(false, null, { message: 'Failed to revoke sessions', code: 'SERVER_ERROR' }));
  }
});

module.exports = router;
