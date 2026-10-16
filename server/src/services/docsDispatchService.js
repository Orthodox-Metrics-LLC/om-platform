/**
 * OM Docs Dropbox → Agent dispatch lifecycle (OMPKT-20260703-0002).
 *
 * "Send to Agent" creates a DURABLE dispatch record (om_agent_dispatches) plus a
 * notification (om_agent_notifications). A dispatch is not "active" until the
 * assigned agent CLAIMS it with an exclusive lease. Unclaimed dispatches time
 * out; expired leases become reclaimable. Every transition writes an audit event
 * (into the existing docs_dropbox_audit_events, keyed by file_id, with the
 * dispatch_id carried in details) and emits an OMBrain governance event.
 *
 * Honest runtime note: this module implements the durable queue + notify/claim
 * contract. It never fakes agent completion — an unclaimed dispatch stays
 * "Waiting for agent claim" until a real agent calls the claim/return endpoints.
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { getAppPool } = require('../config/db');
const dropbox = require('./docsDropboxService');
const pickup = require('./docsPickupService');
const { emitBrainEvent } = require('./brainEventEmitter');
let storage;
try { storage = require('./docsStorageService'); } catch { storage = null; }

// ── config ──────────────────────────────────────────────────────────────────
const DEFAULT_CLAIM_TIMEOUT_MIN = parseInt(process.env.DOCS_DISPATCH_CLAIM_TIMEOUT_MIN || '120', 10);
const DEFAULT_LEASE_MIN = parseInt(process.env.DOCS_DISPATCH_LEASE_MIN || '30', 10);

const DISPATCH_STATUS = Object.freeze({
  REQUESTED: 'requested',
  NOTIFIED: 'notified',
  NOTIFIED_TIMEOUT: 'notified_timeout',
  FAILED_TO_CLAIM: 'failed_to_claim',
  CLAIMED: 'claimed',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  RETURNED: 'returned',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

// Dispatch statuses from which an agent may still take (or resume) a claim.
const CLAIMABLE_STATUSES = new Set([
  DISPATCH_STATUS.REQUESTED, DISPATCH_STATUS.NOTIFIED, DISPATCH_STATUS.NOTIFIED_TIMEOUT,
]);
// Terminal dispatch statuses — never reclaimable without a fresh dispatch.
const TERMINAL_STATUSES = new Set([
  DISPATCH_STATUS.RETURNED, DISPATCH_STATUS.FAILED, DISPATCH_STATUS.CANCELLED,
]);
// Active work statuses (an agent holds these).
const ACTIVE_STATUSES = new Set([DISPATCH_STATUS.CLAIMED, DISPATCH_STATUS.IN_PROGRESS, DISPATCH_STATUS.BLOCKED]);

// Dropbox file status mirror for each dispatch state.
const FILE_STATUS_FOR_DISPATCH = {
  [DISPATCH_STATUS.REQUESTED]: 'sent_to_agent',
  [DISPATCH_STATUS.NOTIFIED]: 'agent_notified',
  [DISPATCH_STATUS.NOTIFIED_TIMEOUT]: 'failed',
  [DISPATCH_STATUS.FAILED_TO_CLAIM]: 'failed',
  [DISPATCH_STATUS.CLAIMED]: 'claimed_by_agent',
  [DISPATCH_STATUS.IN_PROGRESS]: 'in_progress',
  [DISPATCH_STATUS.BLOCKED]: 'blocked',
  [DISPATCH_STATUS.RETURNED]: 'returned_in_pickup',
  [DISPATCH_STATUS.FAILED]: 'failed',
  [DISPATCH_STATUS.CANCELLED]: 'ready_for_agent',
};

// ── id + helpers ──────────────────────────────────────────────────────────────
function ymdCompact(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function generateDispatchId() {
  return `OMDSP-${ymdCompact()}-${crypto.randomBytes(4).toString('hex')}`;
}

function generateNotificationId() {
  return `OMNTF-${ymdCompact()}-${crypto.randomBytes(4).toString('hex')}`;
}

function newCorrelationId() {
  return `corr-${crypto.randomUUID()}`;
}

function toIso(dt) {
  if (!dt) return null;
  return dt instanceof Date ? dt.toISOString() : new Date(dt).toISOString();
}

function normalizeAgent(v) {
  return String(v || '').trim().toLowerCase();
}

class DispatchError extends Error {
  constructor(code, status = 400, details = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function dispatchRowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    dispatchId: row.dispatch_id,
    fileId: row.file_id,
    workPacketId: row.work_packet_id || null,
    omDailyItemId: row.om_daily_item_id || null,
    assignedAgent: row.assigned_agent || null,
    target: row.target || null,
    visibility: row.visibility || null,
    status: row.status,
    priority: row.priority || 'medium',
    sourcePath: row.source_path || null,
    correlationId: row.correlation_id || null,
    claimedByAgent: row.claimed_by_agent || null,
    claimTimeoutAt: toIso(row.claim_timeout_at),
    leaseExpiresAt: toIso(row.lease_expires_at),
    heartbeatAt: toIso(row.heartbeat_at),
    returnedPickupId: row.returned_pickup_id || null,
    errorMessage: row.error_message || null,
    createdBy: {
      id: row.created_by_id ?? null,
      email: row.created_by_email ?? null,
      name: row.created_by_name || null,
    },
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    notifiedAt: toIso(row.notified_at),
    claimedAt: toIso(row.claimed_at),
    startedAt: toIso(row.started_at),
    blockedAt: toIso(row.blocked_at),
    returnedAt: toIso(row.returned_at),
    completedAt: toIso(row.completed_at),
    failedAt: toIso(row.failed_at),
  };
}

async function getDispatchRow(pool, dispatchId) {
  const [rows] = await pool.query('SELECT * FROM om_agent_dispatches WHERE dispatch_id = ? LIMIT 1', [dispatchId]);
  return rows[0] || null;
}

async function getActiveDispatchForFile(fileId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT * FROM om_agent_dispatches
     WHERE file_id = ? AND status NOT IN ('returned','failed','cancelled')
     ORDER BY created_at DESC LIMIT 1`,
    [fileId],
  );
  return rows[0] ? dispatchRowToApi(rows[0]) : null;
}

async function getDispatch(dispatchId) {
  const pool = getAppPool();
  const row = await getDispatchRow(pool, dispatchId);
  return row ? dispatchRowToApi(row) : null;
}

async function listDispatchesForFile(fileId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT * FROM om_agent_dispatches WHERE file_id = ? ORDER BY created_at DESC',
    [fileId],
  );
  return rows.map(dispatchRowToApi);
}

async function getNotificationsForDispatch(dispatchId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    'SELECT * FROM om_agent_notifications WHERE dispatch_id = ? ORDER BY created_at DESC',
    [dispatchId],
  );
  return rows.map((r) => ({
    id: r.id,
    notificationId: r.notification_id,
    dispatchId: r.dispatch_id,
    agentId: r.agent_id,
    channel: r.channel,
    status: r.status,
    errorMessage: r.error_message || null,
    createdAt: toIso(r.created_at),
    sentAt: toIso(r.sent_at),
    acknowledgedAt: toIso(r.acknowledged_at),
  }));
}

// ── audit + brain events ──────────────────────────────────────────────────────
async function recordDispatchAudit(pool, fileId, eventType, actor, dispatchId, details = {}) {
  await pool.query(
    `INSERT INTO docs_dropbox_audit_events (file_id, event_type, actor_id, actor_email, actor_name, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      fileId,
      eventType,
      actor?.id ?? null,
      actor?.email ?? null,
      actor?.name ?? null,
      JSON.stringify({ dispatchId, ...details }),
    ],
  );
}

/**
 * Emit an OMBrain governance event for a dispatch transition with the full
 * required payload (event_id, work_packet_id, dispatch_id, agent_id, actor,
 * action, status_before/after, target, visibility, source_path, pickup_path,
 * correlation_id, timestamp, error).
 */
function emitDispatchBrainEvent({ eventType, action, dispatch, statusBefore, statusAfter, actor, agentId, pickupPath, error }) {
  try {
    const eventId = crypto.randomUUID();
    emitBrainEvent({
      source: 'om',
      event_type: eventType,
      severity: error ? 'warning' : 'info',
      summary: `${action} · ${dispatch.workPacketId || dispatch.dispatchId} · ${statusBefore || '—'} → ${statusAfter}`,
      actor_type: agentId ? 'agent' : (actor?.id ? 'user' : 'system'),
      actor_id: agentId || (actor?.id != null ? String(actor.id) : null),
      object_type: 'docs_dispatch',
      object_id: dispatch.dispatchId,
      request_id: dispatch.correlationId || null,
      correlation: dispatch.correlationId || null,
      data: {
        event_id: eventId,
        work_packet_id: dispatch.workPacketId || null,
        om_daily_item_id: dispatch.omDailyItemId || null,
        dispatch_id: dispatch.dispatchId,
        agent_id: agentId || dispatch.assignedAgent || null,
        actor: actor?.email || actor?.name || 'system',
        action,
        status_before: statusBefore || null,
        status_after: statusAfter,
        target: dispatch.target || null,
        visibility: dispatch.visibility || null,
        source_path: dispatch.sourcePath || null,
        pickup_path: pickupPath || null,
        correlation_id: dispatch.correlationId || null,
        timestamp: new Date().toISOString(),
        error: error || null,
      },
    });
  } catch (e) {
    console.error('[docsDispatch] brain event emit failed:', e.message);
  }
  // Mirror to the work-packet append-only event history (best-effort).
  try {
    if (storage && dispatch.workPacketId) {
      storage.appendPacketEvent(dispatch.workPacketId, action, {
        dispatch_id: dispatch.dispatchId,
        status_before: statusBefore || null,
        status_after: statusAfter,
        agent_id: agentId || dispatch.assignedAgent || null,
        actor: actor?.email || actor?.name || 'system',
        pickup_path: pickupPath || null,
        error: error || null,
      });
    }
  } catch { /* non-fatal */ }
}

async function setFileStatus(pool, fileId, status, extra = {}) {
  await pool.query(
    `UPDATE docs_dropbox_files
     SET status = ?, current_dispatch_id = ?, returned_pickup_id = COALESCE(?, returned_pickup_id),
         last_status_change_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [status, extra.currentDispatchId ?? null, extra.returnedPickupId ?? null, fileId],
  );
}

// ── send to agent ─────────────────────────────────────────────────────────────
/**
 * Create a durable dispatch for a Dropbox item and notify the assigned agent.
 * Requires a valid target (target_system) and an assigned agent. Idempotent-ish:
 * if an active dispatch already exists for the file, it is returned unchanged.
 */
async function sendToAgent(fileId, actor, opts = {}) {
  const pool = getAppPool();
  const file = await dropbox.getFileById(fileId);
  if (!file || file.deleted_at) throw new DispatchError('NOT_FOUND', 404);

  const assignedAgent = opts.assignedAgent || file.assigned_agent;
  const target = opts.target || file.target_system;
  if (!assignedAgent) throw new DispatchError('MISSING_AGENT', 400);
  if (!target) throw new DispatchError('MISSING_TARGET', 400);
  if (!dropbox.ASSIGNED_AGENTS.has(assignedAgent)) throw new DispatchError('INVALID_AGENT', 400);

  let omDailyItemId = file.om_daily_item_id || opts.omDailyItemId || null;
  let workItemResult = null;

  if (opts.createWorkItem && !omDailyItemId) {
    const bridge = require('./docsWorkItemBridgeService');
    const mode = opts.workItemMode === 'relaxed' ? 'relaxed' : 'governed';
    const createFn = mode === 'relaxed' ? bridge.createRelaxedWorkItem : bridge.createGovernedWorkItem;
    workItemResult = await createFn(fileId, actor, {
      assignedAgent,
      targetSystem: target,
      repoTarget: opts.repoTarget,
      priority: opts.priority,
      workItemMode: mode,
      intakeType: 'hybrid',
      superAdminOverride: opts.superAdminOverride,
    });
    omDailyItemId = workItemResult.workItem?.id || workItemResult.file?.omDailyItemId || null;
    file = await dropbox.getFileById(fileId);
  }

  const sendable = new Set(['dropped', 'ready_for_agent', 'edited', 'uploaded', 'reviewed', 'failed']);
  if (!sendable.has(file.status)) throw new DispatchError('INVALID_STATUS', 400, { status: file.status });

  const existing = await getActiveDispatchForFile(fileId);
  if (existing) {
    return {
      dispatch: existing,
      file: dropbox.rowToApi(await dropbox.getFileById(fileId)),
      idempotent: true,
      workItem: workItemResult?.workItem || null,
    };
  }

  const dispatchId = generateDispatchId();
  const correlationId = newCorrelationId();
  const priority = ['low', 'medium', 'high', 'critical'].includes(opts.priority) ? opts.priority : 'medium';
  const claimTimeoutMin = Number.isFinite(opts.claimTimeoutMin) ? opts.claimTimeoutMin : DEFAULT_CLAIM_TIMEOUT_MIN;

  if (assignedAgent !== file.assigned_agent || target !== file.target_system) {
    await pool.query('UPDATE docs_dropbox_files SET assigned_agent = ?, target_system = ? WHERE id = ?', [assignedAgent, target, fileId]);
  }

  await pool.query(
    `INSERT INTO om_agent_dispatches
      (dispatch_id, file_id, work_packet_id, om_daily_item_id, assigned_agent, target, visibility, status, priority,
       source_path, correlation_id, claim_timeout_at,
       created_by_id, created_by_email, created_by_name, notified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'notified', ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?, ?, ?, NOW())`,
    [
      dispatchId, fileId, file.work_packet_id || null, omDailyItemId, assignedAgent, target,
      file.target_visibility || null, priority,
      file.edited_agent_path || file.agent_path || null, correlationId, claimTimeoutMin,
      actor?.id ?? null, actor?.email ?? null, actor?.name ?? null,
    ],
  );

  const notificationId = generateNotificationId();
  await pool.query(
    `INSERT INTO om_agent_notifications (notification_id, dispatch_id, agent_id, channel, status, sent_at)
     VALUES (?, ?, ?, 'db_queue', 'sent', NOW())`,
    [notificationId, dispatchId, assignedAgent],
  );

  await setFileStatus(pool, fileId, 'agent_notified', { currentDispatchId: dispatchId });

  const dispatch = await getDispatch(dispatchId);
  await recordDispatchAudit(pool, fileId, 'dispatch_requested', actor, dispatchId, { assignedAgent, target, priority });
  await recordDispatchAudit(pool, fileId, 'agent_notified', actor, dispatchId, { notificationId, channel: 'db_queue' });

  emitDispatchBrainEvent({
    eventType: 'docs.dispatch.requested', action: 'dispatch_requested', dispatch,
    statusBefore: file.status, statusAfter: 'requested', actor,
  });
  emitDispatchBrainEvent({
    eventType: 'docs.agent.notified', action: 'agent_notified', dispatch,
    statusBefore: 'requested', statusAfter: 'notified', actor, agentId: assignedAgent,
  });

  if (omDailyItemId) {
    try {
      const bridge = require('./docsWorkItemBridgeService');
      await bridge.recordOmaiDropboxEvent(omDailyItemId, 'dropbox_dispatch_sent', {
        dispatch_id: dispatchId,
        work_packet_id: file.work_packet_id,
        file_id: fileId,
      }, actor);
    } catch { /* non-fatal */ }
  }

  return {
    dispatch,
    file: dropbox.rowToApi(await dropbox.getFileById(fileId)),
    idempotent: false,
    workItem: workItemResult?.workItem || (omDailyItemId ? { id: omDailyItemId, code: `OMD-${omDailyItemId}` } : null),
  };
}

// ── agent queue ───────────────────────────────────────────────────────────────
async function getAgentQueue(agentId) {
  const pool = getAppPool();
  await expireStaleDispatches();
  const [rows] = await pool.query(
    `SELECT * FROM om_agent_dispatches
     WHERE LOWER(assigned_agent) = ?
       AND status IN ('requested','notified','notified_timeout')
     ORDER BY FIELD(priority,'critical','high','medium','low'), created_at ASC`,
    [normalizeAgent(agentId)],
  );
  return rows.map(dispatchRowToApi);
}

// ── claim (exclusive lease) ────────────────────────────────────────────────────
async function claimDispatch(dispatchId, agentIdentity, opts = {}) {
  const pool = getAppPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM om_agent_dispatches WHERE dispatch_id = ? FOR UPDATE', [dispatchId]);
    const row = rows[0];
    if (!row) { await conn.rollback(); throw new DispatchError('NOT_FOUND', 404); }

    const agentId = agentIdentity.agentId || agentIdentity.name || agentIdentity.email;
    const elevated = Boolean(agentIdentity.elevated);
    if (!elevated && normalizeAgent(row.assigned_agent) !== normalizeAgent(agentId)) {
      await conn.rollback();
      throw new DispatchError('FORBIDDEN_AGENT', 403, { assignedAgent: row.assigned_agent });
    }

    if (TERMINAL_STATUSES.has(row.status)) {
      await conn.rollback();
      throw new DispatchError('NOT_RECLAIMABLE', 409, { status: row.status });
    }

    const now = Date.now();
    const leaseValid = row.lease_expires_at && new Date(row.lease_expires_at).getTime() > now;

    // Idempotent: same agent already holds a valid claim/lease.
    if (ACTIVE_STATUSES.has(row.status) && normalizeAgent(row.claimed_by_agent) === normalizeAgent(agentId) && leaseValid) {
      await conn.commit();
      return { dispatch: await getDispatch(dispatchId), idempotent: true };
    }

    // Held by someone else with a live lease → locked.
    if (ACTIVE_STATUSES.has(row.status) && leaseValid) {
      await conn.rollback();
      throw new DispatchError('LOCKED', 409, { claimedByAgent: row.claimed_by_agent, leaseExpiresAt: toIso(row.lease_expires_at) });
    }

    // Claimable (fresh, timed-out) OR active but lease expired (reclaim).
    if (!CLAIMABLE_STATUSES.has(row.status) && !(ACTIVE_STATUSES.has(row.status) && !leaseValid)) {
      await conn.rollback();
      throw new DispatchError('INVALID_TRANSITION', 409, { status: row.status });
    }

    const leaseMin = Number.isFinite(opts.leaseMin) ? opts.leaseMin : DEFAULT_LEASE_MIN;
    const leaseToken = crypto.randomBytes(16).toString('hex');
    const reclaim = ACTIVE_STATUSES.has(row.status);
    await conn.query(
      `UPDATE om_agent_dispatches
       SET status = 'claimed', claimed_by_agent = ?, lease_token = ?, claimed_at = NOW(),
           lease_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE), heartbeat_at = NOW(),
           claim_timeout_at = NULL, updated_at = NOW()
       WHERE dispatch_id = ?`,
      [agentId, leaseToken, leaseMin, dispatchId],
    );
    await conn.commit();

    await setFileStatus(pool, row.file_id, 'claimed_by_agent', { currentDispatchId: dispatchId });
    const dispatch = await getDispatch(dispatchId);
    await recordDispatchAudit(pool, row.file_id, 'agent_claimed', { name: agentId, email: agentIdentity.email, id: agentIdentity.id }, dispatchId, { reclaim, leaseMin });
    emitDispatchBrainEvent({
      eventType: 'docs.agent.claimed', action: reclaim ? 'agent_reclaimed' : 'agent_claimed', dispatch,
      statusBefore: row.status, statusAfter: 'claimed', actor: agentIdentity, agentId,
    });
    return { dispatch, idempotent: false, leaseToken };
  } catch (err) {
    try { await conn.rollback(); } catch { /* already resolved */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function assertAgentHolds(row, agentIdentity) {
  const agentId = agentIdentity.agentId || agentIdentity.name || agentIdentity.email;
  if (!agentIdentity.elevated && normalizeAgent(row.claimed_by_agent) !== normalizeAgent(agentId)) {
    throw new DispatchError('NOT_LEASE_HOLDER', 403, { claimedByAgent: row.claimed_by_agent });
  }
  return agentId;
}

async function startDispatch(dispatchId, agentIdentity) {
  const pool = getAppPool();
  const row = await getDispatchRow(pool, dispatchId);
  if (!row) throw new DispatchError('NOT_FOUND', 404);
  const agentId = await assertAgentHolds(row, agentIdentity);
  if (row.status === DISPATCH_STATUS.IN_PROGRESS) return { dispatch: await getDispatch(dispatchId), idempotent: true };
  if (![DISPATCH_STATUS.CLAIMED, DISPATCH_STATUS.BLOCKED].includes(row.status)) {
    throw new DispatchError('INVALID_TRANSITION', 409, { status: row.status });
  }
  await pool.query(
    `UPDATE om_agent_dispatches SET status='in_progress', started_at=COALESCE(started_at, NOW()), heartbeat_at=NOW(), updated_at=NOW() WHERE dispatch_id=?`,
    [dispatchId],
  );
  await setFileStatus(pool, row.file_id, 'in_progress', { currentDispatchId: dispatchId });
  const dispatch = await getDispatch(dispatchId);
  await recordDispatchAudit(pool, row.file_id, 'agent_started', { name: agentId, email: agentIdentity.email, id: agentIdentity.id }, dispatchId);
  emitDispatchBrainEvent({ eventType: 'docs.agent.started', action: 'agent_started', dispatch, statusBefore: row.status, statusAfter: 'in_progress', actor: agentIdentity, agentId });
  return { dispatch, idempotent: false };
}

async function heartbeat(dispatchId, agentIdentity, opts = {}) {
  const pool = getAppPool();
  const row = await getDispatchRow(pool, dispatchId);
  if (!row) throw new DispatchError('NOT_FOUND', 404);
  const agentId = await assertAgentHolds(row, agentIdentity);
  if (!ACTIVE_STATUSES.has(row.status)) throw new DispatchError('INVALID_TRANSITION', 409, { status: row.status });
  const leaseMin = Number.isFinite(opts.leaseMin) ? opts.leaseMin : DEFAULT_LEASE_MIN;
  await pool.query(
    `UPDATE om_agent_dispatches SET heartbeat_at=NOW(), lease_expires_at=DATE_ADD(NOW(), INTERVAL ? MINUTE), updated_at=NOW() WHERE dispatch_id=?`,
    [leaseMin, dispatchId],
  );
  await recordDispatchAudit(pool, row.file_id, 'agent_heartbeat', { name: agentId, email: agentIdentity.email, id: agentIdentity.id }, dispatchId);
  return { dispatch: await getDispatch(dispatchId) };
}

async function blockDispatch(dispatchId, agentIdentity, reason) {
  const pool = getAppPool();
  const row = await getDispatchRow(pool, dispatchId);
  if (!row) throw new DispatchError('NOT_FOUND', 404);
  const agentId = await assertAgentHolds(row, agentIdentity);
  if (!ACTIVE_STATUSES.has(row.status)) throw new DispatchError('INVALID_TRANSITION', 409, { status: row.status });
  await pool.query(
    `UPDATE om_agent_dispatches SET status='blocked', blocked_at=NOW(), error_message=?, updated_at=NOW() WHERE dispatch_id=?`,
    [reason ? String(reason).slice(0, 2000) : null, dispatchId],
  );
  await setFileStatus(pool, row.file_id, 'blocked', { currentDispatchId: dispatchId });
  const dispatch = await getDispatch(dispatchId);
  await recordDispatchAudit(pool, row.file_id, 'agent_blocked', { name: agentId, email: agentIdentity.email, id: agentIdentity.id }, dispatchId, { reason: reason || null });
  emitDispatchBrainEvent({ eventType: 'docs.agent.blocked', action: 'agent_blocked', dispatch, statusBefore: row.status, statusAfter: 'blocked', actor: agentIdentity, agentId, error: reason || 'blocked' });
  return { dispatch };
}

async function failDispatch(dispatchId, agentIdentity, error) {
  const pool = getAppPool();
  const row = await getDispatchRow(pool, dispatchId);
  if (!row) throw new DispatchError('NOT_FOUND', 404);
  const agentId = await assertAgentHolds(row, agentIdentity);
  if (TERMINAL_STATUSES.has(row.status)) throw new DispatchError('INVALID_TRANSITION', 409, { status: row.status });
  await pool.query(
    `UPDATE om_agent_dispatches SET status='failed', failed_at=NOW(), error_message=?, updated_at=NOW() WHERE dispatch_id=?`,
    [error ? String(error).slice(0, 2000) : null, dispatchId],
  );
  await setFileStatus(pool, row.file_id, 'failed', { currentDispatchId: dispatchId });
  const dispatch = await getDispatch(dispatchId);
  await recordDispatchAudit(pool, row.file_id, 'agent_failed', { name: agentId, email: agentIdentity.email, id: agentIdentity.id }, dispatchId, { error: error || null });
  emitDispatchBrainEvent({ eventType: 'docs.agent.failed', action: 'agent_failed', dispatch, statusBefore: row.status, statusAfter: 'failed', actor: agentIdentity, agentId, error: error || 'failed' });
  return { dispatch };
}

/**
 * Return an agent's result into OM Docs Pickup, linked to the Dropbox source.
 * Accepts either result `content` (written as a new file) or falls back to a
 * copy of the source working file.
 */
async function returnDispatch(dispatchId, agentIdentity, opts = {}) {
  const pool = getAppPool();
  const row = await getDispatchRow(pool, dispatchId);
  if (!row) throw new DispatchError('NOT_FOUND', 404);
  const agentId = await assertAgentHolds(row, agentIdentity);
  if (!ACTIVE_STATUSES.has(row.status)) throw new DispatchError('INVALID_TRANSITION', 409, { status: row.status });

  const file = await dropbox.getFileById(row.file_id);
  if (!file) throw new DispatchError('NOT_FOUND', 404);

  pickup.ensureStorageDirs();
  const pickupId = crypto.randomUUID();
  const baseName = opts.fileName
    ? pickup.sanitizeOriginalName(opts.fileName)
    : `${row.work_packet_id || 'result'}-${(file.title || 'result').toString().slice(0, 60)}.md`;
  const safeBase = pickup.sanitizeOriginalName(baseName);
  const ext = path.extname(safeBase).toLowerCase() || '.md';
  const storedName = `${pickupId}${ext}`;
  const destRelative = `files/${storedName}`;
  const destPath = path.join(pickup.getFilesDir(), storedName);

  if (typeof opts.content === 'string' && opts.content.length) {
    fs.writeFileSync(destPath, opts.content, 'utf-8');
  } else {
    const src = dropbox.getWorkingFilePath(file);
    if (!src || !fs.existsSync(src)) throw new DispatchError('NO_RESULT_CONTENT', 400);
    fs.copyFileSync(src, destPath);
  }

  const stat = fs.statSync(destPath);
  const savedBy = { id: agentIdentity.id ?? null, email: agentIdentity.email ?? null, name: agentId };
  await pickup.insertFileRecord(pool, {
    id: pickupId,
    fileName: storedName,
    originalFileName: safeBase,
    storagePath: destRelative,
    agentPath: `${pickup.AGENT_PATH_PREFIX}/${destRelative}`,
    description: opts.notes || `Agent result for ${row.work_packet_id || file.id}`,
    status: 'waiting',
    savedBy,
    sizeBytes: stat.size,
    mimeType: pickup.guessMime(ext),
    sha256: pickup.sha256File(destPath),
    metadataJson: {
      returnedFromDispatch: dispatchId,
      workPacketId: row.work_packet_id || null,
      sourceFileId: file.id,
      title: opts.title || file.title || null,
    },
    source: 'agent_return',
  }, savedBy);

  await pool.query(
    'UPDATE docs_pickup_files SET work_packet_id = ?, dispatch_id = ?, source_file_id = ?, title = ? WHERE id = ?',
    [row.work_packet_id || null, dispatchId, file.id, opts.title || file.title || null, pickupId],
  );
  await pool.query(
    `UPDATE om_agent_dispatches SET status='returned', returned_at=NOW(), completed_at=NOW(), returned_pickup_id=?, updated_at=NOW() WHERE dispatch_id=?`,
    [pickupId, dispatchId],
  );
  await setFileStatus(pool, row.file_id, 'returned_in_pickup', { currentDispatchId: dispatchId, returnedPickupId: pickupId });

  const dispatch = await getDispatch(dispatchId);
  const pickupPath = `${pickup.AGENT_PATH_PREFIX}/${destRelative}`;
  await recordDispatchAudit(pool, row.file_id, 'agent_returned', savedBy, dispatchId, { pickupId, pickupPath });
  await recordDispatchAudit(pool, row.file_id, 'pickup_item_created', savedBy, dispatchId, { pickupId });
  emitDispatchBrainEvent({ eventType: 'docs.agent.returned', action: 'agent_returned', dispatch, statusBefore: row.status, statusAfter: 'returned', actor: agentIdentity, agentId, pickupPath });
  return { dispatch, pickupId, pickupPath };
}

// ── operator actions ──────────────────────────────────────────────────────────
async function reassignAgent(dispatchId, actor, newAgent) {
  const pool = getAppPool();
  const row = await getDispatchRow(pool, dispatchId);
  if (!row) throw new DispatchError('NOT_FOUND', 404);
  if (!dropbox.ASSIGNED_AGENTS.has(newAgent)) throw new DispatchError('INVALID_AGENT', 400);
  if (ACTIVE_STATUSES.has(row.status) && row.lease_expires_at && new Date(row.lease_expires_at).getTime() > Date.now()) {
    throw new DispatchError('ALREADY_CLAIMED', 409, { claimedByAgent: row.claimed_by_agent });
  }
  await pool.query(
    `UPDATE om_agent_dispatches
     SET assigned_agent=?, status='notified', claimed_by_agent=NULL, lease_token=NULL, lease_expires_at=NULL,
         claim_timeout_at=DATE_ADD(NOW(), INTERVAL ? MINUTE), notified_at=NOW(), updated_at=NOW()
     WHERE dispatch_id=?`,
    [newAgent, DEFAULT_CLAIM_TIMEOUT_MIN, dispatchId],
  );
  const notificationId = generateNotificationId();
  await pool.query(
    `INSERT INTO om_agent_notifications (notification_id, dispatch_id, agent_id, channel, status, sent_at) VALUES (?, ?, ?, 'db_queue', 'sent', NOW())`,
    [notificationId, dispatchId, newAgent],
  );
  await pool.query('UPDATE docs_dropbox_files SET assigned_agent=? WHERE id=?', [newAgent, row.file_id]);
  await setFileStatus(pool, row.file_id, 'agent_notified', { currentDispatchId: dispatchId });
  const dispatch = await getDispatch(dispatchId);
  await recordDispatchAudit(pool, row.file_id, 'agent_reassigned', actor, dispatchId, { newAgent });
  emitDispatchBrainEvent({ eventType: 'docs.agent.notified', action: 'agent_reassigned', dispatch, statusBefore: row.status, statusAfter: 'notified', actor, agentId: newAgent });
  return { dispatch };
}

async function cancelDispatch(dispatchId, actor, reason) {
  const pool = getAppPool();
  const row = await getDispatchRow(pool, dispatchId);
  if (!row) throw new DispatchError('NOT_FOUND', 404);
  if (TERMINAL_STATUSES.has(row.status)) throw new DispatchError('INVALID_TRANSITION', 409, { status: row.status });
  if (ACTIVE_STATUSES.has(row.status) && row.lease_expires_at && new Date(row.lease_expires_at).getTime() > Date.now()) {
    throw new DispatchError('ALREADY_CLAIMED', 409, { claimedByAgent: row.claimed_by_agent });
  }
  await pool.query(
    `UPDATE om_agent_dispatches SET status='cancelled', error_message=?, updated_at=NOW() WHERE dispatch_id=?`,
    [reason ? String(reason).slice(0, 2000) : null, dispatchId],
  );
  await setFileStatus(pool, row.file_id, 'ready_for_agent', { currentDispatchId: null });
  await pool.query('UPDATE docs_dropbox_files SET current_dispatch_id=NULL WHERE id=?', [row.file_id]);
  const dispatch = await getDispatch(dispatchId);
  await recordDispatchAudit(pool, row.file_id, 'dispatch_cancelled', actor, dispatchId, { reason: reason || null });
  emitDispatchBrainEvent({ eventType: 'docs.dispatch.cancelled', action: 'dispatch_cancelled', dispatch, statusBefore: row.status, statusAfter: 'cancelled', actor });
  return { dispatch };
}

// ── lease/timeout sweep ─────────────────────────────────────────────────────────
async function expireStaleDispatches() {
  const pool = getAppPool();
  // Unclaimed past their claim deadline → notified_timeout, surface as failed on file.
  const [stale] = await pool.query(
    `SELECT * FROM om_agent_dispatches
     WHERE status IN ('requested','notified') AND claim_timeout_at IS NOT NULL AND claim_timeout_at < NOW()`,
  );
  for (const row of stale) {
    await pool.query(
      `UPDATE om_agent_dispatches SET status='notified_timeout', updated_at=NOW() WHERE dispatch_id=? AND status IN ('requested','notified')`,
      [row.dispatch_id],
    );
    await setFileStatus(pool, row.file_id, 'failed', { currentDispatchId: row.dispatch_id });
    const dispatch = dispatchRowToApi({ ...row, status: 'notified_timeout' });
    await recordDispatchAudit(pool, row.file_id, 'dispatch_notified_timeout', { name: 'system' }, row.dispatch_id, {});
    emitDispatchBrainEvent({ eventType: 'docs.agent.failed', action: 'notified_timeout', dispatch, statusBefore: row.status, statusAfter: 'notified_timeout', error: 'unclaimed_timeout' });
  }
  // Active dispatches whose lease expired → back to notified_timeout (reclaimable) after grace.
  const [expired] = await pool.query(
    `SELECT * FROM om_agent_dispatches
     WHERE status IN ('claimed','in_progress','blocked') AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW()`,
  );
  for (const row of expired) {
    await pool.query(
      `UPDATE om_agent_dispatches SET status='notified_timeout', claimed_by_agent=NULL, lease_token=NULL,
         claim_timeout_at=DATE_ADD(NOW(), INTERVAL ? MINUTE), updated_at=NOW()
       WHERE dispatch_id=? AND status IN ('claimed','in_progress','blocked')`,
      [DEFAULT_CLAIM_TIMEOUT_MIN, row.dispatch_id],
    );
    await setFileStatus(pool, row.file_id, 'agent_notified', { currentDispatchId: row.dispatch_id });
    await recordDispatchAudit(pool, row.file_id, 'lease_expired', { name: 'system' }, row.dispatch_id, { priorStatus: row.status });
  }
  return { timedOut: stale.length, leaseExpired: expired.length };
}

async function sendDocumentToAgent(doc, opts = {}) {
  const actor = opts.actor || {};
  const assignedAgent = opts.assignedAgent || 'cursor';
  const pool = getAppPool();
  const documentService = require('./om-documents/documentService');

  if (!doc || !doc.documentId) throw new DispatchError('NOT_FOUND', 404);

  const dispatchId = generateDispatchId();
  const correlationId = newCorrelationId();
  const priority = ['low', 'medium', 'high', 'critical'].includes(opts.priority) ? opts.priority : 'medium';
  const claimTimeoutMin = Number.isFinite(opts.claimTimeoutMin) ? opts.claimTimeoutMin : DEFAULT_CLAIM_TIMEOUT_MIN;
  const plansPath = doc.physicalPath || doc.relativePath;

  // Persist dispatch request on the document metadata (file_id is NOT NULL for legacy table).
  const meta = {
    ...(doc.metadata || {}),
    pendingDispatch: {
      dispatchId,
      assignedAgent,
      target: opts.target || 'om',
      plansPath,
      priority,
      correlationId,
      requestedAt: new Date().toISOString(),
      createdBy: { id: actor.id || null, email: actor.email || null, name: actor.name || null },
    },
  };
  await pool.query(
    'UPDATE om_documents SET metadata_json = ?, updated_at = NOW() WHERE document_id = ?',
    [JSON.stringify(meta), doc.documentId],
  );
  await documentService.recordAudit(doc.documentId, 'dispatch_requested', actor, {
    dispatchId,
    assignedAgent,
    plansPath,
    priority,
  });

  // Best-effort notification row without legacy file_id FK when unsupported.
  try {
    const notificationId = generateNotificationId();
    await pool.query(
      `INSERT INTO om_agent_notifications (notification_id, dispatch_id, agent_id, channel, status, sent_at)
       VALUES (?, ?, ?, 'db_queue', 'sent', NOW())`,
      [notificationId, dispatchId, assignedAgent],
    );
  } catch {
    /* notifications table may require existing dispatch row — ignore */
  }

  return {
    dispatchId,
    documentId: doc.documentId,
    plansPath,
    assignedAgent,
    priority,
    claimTimeoutMin,
    correlationId,
    status: 'notified',
  };
}

/**
 * Dual-write agent return: legacy pickup (compat) + new OM Documents package on plans.
 */
async function returnDispatchAsOmDocument(dispatchId, agentIdentity, opts = {}) {
  const legacy = await returnDispatch(dispatchId, agentIdentity, opts);
  try {
    const documentService = require('./om-documents/documentService');
    const row = await getDispatchRow(getAppPool(), dispatchId);
    const parentDocumentId = opts.parentDocumentId
      || row?.metadata?.documentId
      || null;
    const content = typeof opts.content === 'string' && opts.content.length
      ? opts.content
      : `# Agent result\n\nReturned from dispatch ${dispatchId}\n`;
    const created = await documentService.createDocument({
      title: opts.title || `Agent result ${dispatchId}`,
      description: opts.notes || null,
      producer: opts.producer || 'omdev',
      source: 'OMDEV',
      content,
      primaryFileName: 'document.md',
      parentDocumentId,
      relatedDispatchId: dispatchId,
      actor: {
        id: agentIdentity.id,
        email: agentIdentity.email,
        name: agentIdentity.name || agentIdentity.id,
      },
      metadata: {
        returnedFromDispatch: dispatchId,
        legacyPickupId: legacy.pickupId,
      },
      legacy: {
        pickup_id: legacy.pickupId,
        pickupPath: legacy.pickupPath,
      },
    });
    return { ...legacy, document: created };
  } catch (err) {
    console.warn('[docsDispatch] OM Document return dual-write failed:', err.message);
    return legacy;
  }
}


module.exports = {
  DISPATCH_STATUS,
  DispatchError,
  generateDispatchId,
  dispatchRowToApi,
  getDispatch,
  getActiveDispatchForFile,
  listDispatchesForFile,
  getNotificationsForDispatch,
  sendToAgent,
  sendDocumentToAgent,
  getAgentQueue,
  claimDispatch,
  startDispatch,
  heartbeat,
  blockDispatch,
  failDispatch,
  returnDispatch,
  returnDispatchAsOmDocument,
  reassignAgent,
  cancelDispatch,
  expireStaleDispatches,
};
