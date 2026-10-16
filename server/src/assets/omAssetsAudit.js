/**
 * OM Assets Library — audit event logging
 */

const { getAppPool } = require('../config/db');

const EVENT_TYPES = new Set([
  'upload',
  'edit',
  'delete',
  'purge',
  'collection_create',
  'collection_update',
  'collection_delete',
  'collection_assign',
  'collection_remove',
  'scope_change',
  'visibility_change',
  'copy',
  'promote',
  'smart_rename',
  'smart_upload',
  'zip_analyze',
  'zip_import',
  'workshop_send',
]);

async function logAssetAuditEvent({
  event_type,
  asset_id = null,
  collection_id = null,
  actor_user_id = null,
  actor_email = null,
  payload = null,
}) {
  if (!EVENT_TYPES.has(event_type)) {
    console.warn('[om-assets-audit] unknown event_type:', event_type);
  }
  try {
    const pool = getAppPool();
    await pool.query(
      `INSERT INTO om_asset_audit_events
       (event_type, asset_id, collection_id, actor_user_id, actor_email, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        event_type,
        asset_id,
        collection_id,
        actor_user_id,
        actor_email,
        payload ? JSON.stringify(payload) : null,
      ],
    );
  } catch (err) {
    console.error('[om-assets-audit] failed to log:', event_type, err.message);
  }
}

function auditFromRequest(req, event_type, extra = {}) {
  const base = {
    event_type,
    actor_user_id: req.user?.id || req.session?.user?.id || null,
    actor_email: req.user?.email || req.session?.user?.email || null,
    ...extra,
  };
  return logAssetAuditEvent(base);
}

module.exports = {
  EVENT_TYPES,
  logAssetAuditEvent,
  auditFromRequest,
};
