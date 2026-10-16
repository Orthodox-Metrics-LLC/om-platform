/**
 * Sync global work_sessions (orthodoxmetrics_db) with OM Daily item sessions.
 * Called from OMAI start-work / stop-work and from OM work-sessions routes.
 */

const { getAppPool } = require('../config/db');
const { normalizeRepoTarget } = require('./workSessionConstants');

async function findActiveGlobalSession(userId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT id, om_daily_session_id, daily_item_id, repo_target, started_at
     FROM work_sessions WHERE user_id = ? AND status = 'active' LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Start or attach a global session when OM Daily start-work runs.
 */
async function syncGlobalSessionStart({
  userId,
  repoTarget,
  dailyItemId,
  omDailySessionId,
  workFocus = null,
  summaryNote = null,
  sourceSystem = 'omai',
}) {
  if (!userId) return { synced: false, reason: 'no_user' };

  const pool = getAppPool();
  const repo = normalizeRepoTarget(repoTarget) || 'unknown';
  const focus = workFocus || (dailyItemId ? `OMD-${dailyItemId}` : null);

  const existing = await findActiveGlobalSession(userId);

  if (existing) {
    if (existing.om_daily_session_id === omDailySessionId) {
      return { synced: true, action: 'already_linked', session_id: existing.id };
    }

    await pool.query(
      `UPDATE work_sessions
       SET repo_target = ?, daily_item_id = ?, work_focus = ?,
           om_daily_session_id = ?, summary_note = COALESCE(?, summary_note),
           updated_at = NOW()
       WHERE id = ?`,
      [repo, dailyItemId || null, focus, omDailySessionId || null, summaryNote, existing.id]
    );
    return { synced: true, action: 'updated', session_id: existing.id };
  }

  const startContext = {
    linked_from: 'om_daily_start_work',
    daily_item_id: dailyItemId,
    om_daily_session_id: omDailySessionId,
  };

  const [result] = await pool.query(
    `INSERT INTO work_sessions
      (user_id, source_system, repo_target, daily_item_id, work_focus, om_daily_session_id,
       started_at, status, start_context, summary_note)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), 'active', ?, ?)`,
    [
      userId,
      sourceSystem,
      repo,
      dailyItemId || null,
      focus,
      omDailySessionId || null,
      JSON.stringify(startContext),
      summaryNote,
    ]
  );

  const sessionId = result.insertId;
  await pool.query(
    `INSERT INTO work_session_events (work_session_id, event_type, event_timestamp, metadata_json)
     VALUES (?, 'started', NOW(), ?)`,
    [sessionId, JSON.stringify({ source: 'om_daily_sync', repo_target: repo })]
  );

  return { synced: true, action: 'created', session_id: sessionId };
}

/**
 * End global session when OM Daily stop-work completes.
 */
async function syncGlobalSessionEnd({
  userId,
  omDailySessionId,
  summaryNote = null,
}) {
  if (!userId) return { synced: false, reason: 'no_user' };

  const pool = getAppPool();
  let session = null;

  if (omDailySessionId) {
    const [rows] = await pool.query(
      `SELECT id FROM work_sessions
       WHERE user_id = ? AND status = 'active' AND om_daily_session_id = ? LIMIT 1`,
      [userId, omDailySessionId]
    );
    session = rows[0] || null;
  }

  if (!session) {
    const active = await findActiveGlobalSession(userId);
    if (active?.daily_item_id) session = active;
  }

  if (!session) {
    return { synced: false, reason: 'no_matching_active_session' };
  }

  await pool.query(
    `UPDATE work_sessions
     SET status = 'completed', ended_at = NOW(),
         duration_seconds = TIMESTAMPDIFF(SECOND, started_at, NOW()),
         summary_note = COALESCE(?, summary_note),
         end_context = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      summaryNote,
      JSON.stringify({ linked_from: 'om_daily_stop_work', om_daily_session_id: omDailySessionId }),
      session.id,
    ]
  );

  await pool.query(
    `INSERT INTO work_session_events (work_session_id, event_type, event_timestamp, metadata_json)
     VALUES (?, 'ended', NOW(), ?)`,
    [session.id, JSON.stringify({ source: 'om_daily_sync' })]
  );

  return { synced: true, session_id: session.id };
}

module.exports = {
  syncGlobalSessionStart,
  syncGlobalSessionEnd,
  findActiveGlobalSession,
};
