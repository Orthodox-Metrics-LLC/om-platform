/**
 * OM Docs Dropbox ↔ om_daily_items bridge.
 *
 * Creates governed (backlog) or relaxed (in_progress) work items from dropbox
 * rows, links OMPKT + dispatch, and records audit on both OM and OMAI sides.
 */

const { getAppPool, getOmaiPool } = require('../config/db');
const dropbox = require('./docsDropboxService');
const { linkWorkPacket } = require('./workPacketService');
const intakeValidation = require('./docsWorkItemIntakeValidation');

let storage;
try { storage = require('./docsStorageService'); } catch { storage = null; }

const ALLOWED_REPO_TARGETS = Object.freeze([
  'orthodoxmetrics', 'omai', 'omstudio', 'omai-ops', 'shared', 'unknown',
]);

const DROPBOX_AGENT_MAP = Object.freeze({
  Cursor: { assigned_agent: 'Cursor', agent_tool: 'cursor' },
  OMBrain: { assigned_agent: 'OMBrain', agent_tool: 'claude_cli' },
  OMAI: { assigned_agent: 'OMAI', agent_tool: 'omai' },
  OMStudio: { assigned_agent: 'OMStudio', agent_tool: 'cursor' },
  OMWorkshop: { assigned_agent: 'OMWorkshop', agent_tool: 'cursor' },
});

const TARGET_SYSTEM_MAP = Object.freeze({
  OrthodoxMetrics: 'orthodoxmetrics',
  OMAI: 'omai',
  OMStudio: 'omstudio',
  OMWorkshop: null,
  Shared: 'orthodoxmetrics',
});

const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const VALID_TASK_TYPES = new Set(['task', 'feature', 'bugfix', 'chore', 'docs', 'enhancement', 'refactor', 'migration', 'spike']);

class BridgeError extends Error {
  constructor(code, status = 400, details = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isWorkItemsFeatureEnabled() {
  return process.env.DOCS_DROPBOX_WORK_ITEMS_ENABLED === 'true';
}

function isRelaxedFeatureEnabled() {
  return process.env.DOCS_DROPBOX_WORK_ITEMS_RELAXED === 'true';
}

function canUseWorkItems(actor) {
  const role = actor?.role;
  if (role === 'super_admin') return true;
  if (isWorkItemsFeatureEnabled() && (role === 'admin')) return true;
  return false;
}

function canUseRelaxedWorkItems(actor) {
  if (!canUseWorkItems(actor)) return false;
  const role = actor?.role;
  if (role === 'super_admin') return true;
  if (isRelaxedFeatureEnabled() && role === 'admin') return true;
  return false;
}

function mapTargetSystemToRepoTarget(targetSystem) {
  const key = String(targetSystem || 'OrthodoxMetrics').trim();
  const mapped = TARGET_SYSTEM_MAP[key];
  if (mapped === null) {
    const err = new BridgeError('INVALID_REPO_TARGET', 400, {
      targetSystem: key,
      message: 'OMWorkshop is not a supported repo_target until omworkshop is added to OMAI ALLOWED_REPO_TARGETS',
    });
    throw err;
  }
  return mapped || 'orthodoxmetrics';
}

function mapAssignedAgentToTools(assignedAgent) {
  const key = String(assignedAgent || '').trim();
  if (!key) return { assigned_agent: null, agent_tool: null };
  const mapped = DROPBOX_AGENT_MAP[key];
  if (mapped) return { ...mapped };
  return { assigned_agent: key, agent_tool: null };
}

function workItemCode(itemId) {
  return itemId ? `OMD-${itemId}` : null;
}

function hubUrl(itemId) {
  if (!itemId) return null;
  return `/omai/cp/ops/omai-development/work-items?search=%23${itemId}`;
}

function itemToSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: workItemCode(row.id),
    status: row.status,
    approvalMode: row.approval_mode || 'normal',
    repoTarget: row.repo_target || null,
    assignedAgent: row.assigned_agent || null,
    agentTool: row.agent_tool || null,
    title: row.title,
  };
}

async function recordDropboxAudit(pool, fileId, eventType, actor, details = {}) {
  await pool.query(
    `INSERT INTO docs_dropbox_audit_events (file_id, event_type, actor_id, actor_email, actor_name, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      fileId,
      eventType,
      actor?.id ?? null,
      actor?.email ?? null,
      actor?.name ?? null,
      JSON.stringify(details),
    ],
  );
}

async function recordOmaiDropboxEvent(itemId, eventType, payload, actor) {
  try {
    const pool = getOmaiPool();
    await pool.query(
      `INSERT INTO om_daily_item_events (item_id, event_type, from_status, to_status, actor, message, metadata)
       VALUES (?, ?, NULL, NULL, ?, ?, ?)`,
      [
        itemId,
        eventType,
        actor?.email || actor?.name || 'dropbox-bridge',
        eventType,
        JSON.stringify({ actor_type: 'operator', ...payload }),
      ],
    );
  } catch (err) {
    console.warn('[docsWorkItemBridge] OMAI event insert failed:', err.message);
  }
}

async function scanDropboxSecrets(file, { superAdminOverride = false } = {}) {
  const parts = [];
  if (file.prompt_text) parts.push(file.prompt_text);
  if (file.short_prompt) parts.push(file.short_prompt);
  try {
    const content = await dropbox.getContent(file.id);
    if (content?.content) parts.push(content.content);
  } catch { /* non-editable or missing */ }
  const combined = parts.join('\n');
  const warnings = dropbox.scanSecrets(combined);
  if (warnings.length && !superAdminOverride) {
    const err = new BridgeError('SECRET_SCAN_BLOCKED', 422, { warnings });
    err.warnings = warnings;
    throw err;
  }
  return warnings;
}

function buildDropboxMetadata(file, opts = {}) {
  const meta = {
    dropbox: {
      file_id: file.id,
      work_packet_id: file.work_packet_id || null,
      dispatch_id: opts.dispatchId || file.current_dispatch_id || null,
      agent_path: file.edited_agent_path || file.agent_path || null,
      intake_type: opts.intakeType || file.intake_type || 'documentation_only',
      work_item_mode: opts.workItemMode || file.work_item_mode || 'none',
    },
  };
  if (opts.sharedIntake) meta.shared_intake = true;
  return meta;
}

function firstNonEmptyLine(text) {
  if (!text) return '';
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
}

function buildWorkItemPayloadFromDropbox(file, opts = {}) {
  const repoTarget = opts.repoTarget
    || mapTargetSystemToRepoTarget(opts.targetSystem || file.target_system);
  const rawAgent = opts.assignedAgent ?? file.assigned_agent;
  const agentFields = mapAssignedAgentToTools(
    rawAgent && String(rawAgent).trim() ? String(rawAgent).trim() : '',
  );
  const title = (opts.title || file.title || dropbox.inferTitleFromPrompt(file.prompt_text || '')).slice(0, 255);
  const description = opts.description || opts.instruction || file.prompt_text || file.short_prompt || null;
  const instruction = opts.instruction || description;
  const objective = opts.objective
    || firstNonEmptyLine(instruction || description)
    || null;
  return {
    title,
    description,
    instruction,
    objective: objective ? String(objective).slice(0, 1000) : null,
    requestedOutcome: opts.requestedOutcome || null,
    executionMode: opts.executionMode || 'single_step',
    acceptanceCriteria: opts.acceptanceCriteria || null,
    sharedRepoJustification: opts.sharedRepoJustification || null,
    repoTarget,
    category: opts.category || 'docs',
    priority: VALID_PRIORITIES.has(opts.priority) ? opts.priority : 'medium',
    taskType: VALID_TASK_TYPES.has(opts.taskType) ? opts.taskType : 'docs',
    horizon: opts.horizon || '7',
    assignedAgent: agentFields.assigned_agent,
    agentTool: opts.agentTool || agentFields.agent_tool,
    metadata: buildDropboxMetadata(file, opts),
    sharedIntake: (opts.targetSystem || file.target_system) === 'Shared',
    source: opts.source || 'operator_direct',
  };
}

function validateIntakeOrThrow(mode, payload) {
  const result = intakeValidation.validateIntakePayload(mode, payload);
  if (!result.valid) {
    throw new BridgeError('VALIDATION_ERROR', 422, {
      message: 'Work item intake validation failed',
      errors: result.errors,
    });
  }
}

async function findItemByWorkPacket(workPacketId) {
  if (!workPacketId) return null;
  const appPool = getAppPool();
  const [wpRows] = await appPool.query(
    'SELECT om_daily_item_id FROM work_packets WHERE work_packet_id = ? LIMIT 1',
    [workPacketId],
  );
  if (wpRows[0]?.om_daily_item_id) {
    const omaiPool = getOmaiPool();
    const [items] = await omaiPool.query('SELECT * FROM om_daily_items WHERE id = ?', [wpRows[0].om_daily_item_id]);
    return items[0] || null;
  }
  try {
    const omaiPool = getOmaiPool();
    const [rows] = await omaiPool.query(
      `SELECT * FROM om_daily_items
       WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.dropbox.work_packet_id')) = ?
       ORDER BY id DESC LIMIT 1`,
      [workPacketId],
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function resolveExistingLink(fileRow) {
  if (fileRow.om_daily_item_id) {
    const omaiPool = getOmaiPool();
    const [items] = await omaiPool.query('SELECT * FROM om_daily_items WHERE id = ?', [fileRow.om_daily_item_id]);
    if (items[0]) return items[0];
  }
  return findItemByWorkPacket(fileRow.work_packet_id);
}

async function linkWorkItemToDropbox(fileId, itemId, actor, opts = {}) {
  const appPool = getAppPool();
  const file = await dropbox.getFileById(fileId);
  if (!file) throw new BridgeError('NOT_FOUND', 404);

  const intakeType = opts.intakeType || file.intake_type || 'hybrid';
  const workItemMode = opts.workItemMode || file.work_item_mode || 'governed';

  await appPool.query(
    `UPDATE docs_dropbox_files SET
      om_daily_item_id = ?,
      om_daily_item_linked_at = NOW(),
      om_daily_item_linked_by_email = ?,
      intake_type = ?,
      work_item_mode = ?,
      updated_at = NOW()
     WHERE id = ?`,
    [itemId, actor?.email ?? null, intakeType, workItemMode, fileId],
  );

  if (file.work_packet_id) {
    await appPool.query(
      `UPDATE work_packets SET om_daily_item_id = ?,
        metadata_json = JSON_SET(COALESCE(metadata_json, '{}'),
          '$.om_daily_item_id', ?,
          '$.om_daily_item_code', ?,
          '$.intake_type', ?,
          '$.work_item_mode', ?,
          '$.dropbox_file_id', ?)
       WHERE work_packet_id = ?`,
      [
        itemId, itemId, workItemCode(itemId), intakeType, workItemMode, fileId, file.work_packet_id,
      ],
    );
    await linkWorkPacket(appPool, file.work_packet_id, { origin: 'dropbox', refId: fileId });
    if (storage?.ensureWorkPacketFolder) {
      try {
        storage.ensureWorkPacketFolder(file.work_packet_id, {
          title: file.title,
          om_daily_item_id: itemId,
          om_daily_item_code: workItemCode(itemId),
          intake_type: intakeType,
          work_item_mode: workItemMode,
          dropbox_file_id: fileId,
        });
      } catch { /* non-fatal */ }
    }
  }

  if (opts.dispatchId) {
    await syncDispatchWorkItem(opts.dispatchId, itemId);
  }

  await recordDropboxAudit(appPool, fileId, opts.auditEvent || 'work_item_linked', actor, {
    omDailyItemId: itemId,
    code: workItemCode(itemId),
    idempotent: Boolean(opts.idempotent),
  });

  return dropbox.rowToApi(await dropbox.getFileById(fileId));
}

async function syncDispatchWorkItem(dispatchId, itemId) {
  const pool = getAppPool();
  await pool.query(
    'UPDATE om_agent_dispatches SET om_daily_item_id = ?, updated_at = NOW() WHERE dispatch_id = ?',
    [itemId, dispatchId],
  );
}

async function insertGovernedItem(payload, actor) {
  validateIntakeOrThrow('governed', payload);
  const omaiPool = getOmaiPool();
  const metadata = JSON.stringify(payload.metadata);
  const [result] = await omaiPool.query(
    `INSERT INTO om_daily_items
      (title, task_type, description, objective, requested_outcome, execution_mode,
       acceptance_criteria, shared_repo_justification, horizon, status, priority, category, source,
       agent_tool, assigned_agent, repo_target, approval_mode, intake_status, submitted_at,
       metadata, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'backlog', ?, ?, 'operator_direct', ?, ?, ?, 'normal',
       'backlog_eligible', NOW(), ?, ?)`,
    [
      payload.title,
      payload.taskType,
      payload.description,
      payload.objective,
      payload.requestedOutcome,
      payload.executionMode,
      payload.acceptanceCriteria,
      payload.sharedRepoJustification,
      payload.horizon,
      payload.priority,
      payload.category,
      payload.agentTool,
      payload.assignedAgent,
      payload.repoTarget,
      metadata,
      actor?.id ?? null,
    ],
  );
  const [rows] = await omaiPool.query('SELECT * FROM om_daily_items WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function insertRelaxedItem(payload, actor) {
  validateIntakeOrThrow('relaxed', payload);
  const omaiPool = getOmaiPool();
  const metadata = JSON.stringify(payload.metadata);
  const instruction = payload.instruction || payload.description;
  const objective = payload.objective || firstNonEmptyLine(instruction)?.slice(0, 1000) || null;
  const [result] = await omaiPool.query(
    `INSERT INTO om_daily_items
      (title, task_type, description, objective, horizon, status, priority, category, source,
       agent_tool, approval_mode, repo_target, assigned_agent, metadata, work_started_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, 'relaxed', ?, ?, ?, NOW(), ?)`,
    [
      payload.title,
      payload.taskType,
      instruction,
      objective,
      payload.horizon,
      payload.priority,
      payload.category,
      payload.source || 'operator_direct',
      payload.agentTool || 'cursor',
      payload.repoTarget,
      payload.assignedAgent,
      metadata,
      actor?.id ?? null,
    ],
  );
  const [rows] = await omaiPool.query('SELECT * FROM om_daily_items WHERE id = ?', [result.insertId]);
  const item = rows[0];
  await recordOmaiDropboxEvent(item.id, 'relaxed_created', { repo_target: payload.repoTarget }, actor);
  await recordOmaiDropboxEvent(item.id, 'relaxed_started', { repo_target: payload.repoTarget }, actor);
  return item;
}

async function createWorkItemInternal(fileId, actor, opts = {}, mode = 'governed') {
  if (!canUseWorkItems(actor)) throw new BridgeError('FORBIDDEN', 403);
  if (mode === 'relaxed' && !canUseRelaxedWorkItems(actor)) {
    throw new BridgeError('FORBIDDEN', 403, { message: 'Relaxed work item creation requires admin+ with relaxed flag' });
  }

  const appPool = getAppPool();
  const file = await dropbox.getFileById(fileId);
  if (!file || file.deleted_at) throw new BridgeError('NOT_FOUND', 404);

  const existing = await resolveExistingLink(file);
  if (existing) {
    if (file.om_daily_item_id !== existing.id) {
      await linkWorkItemToDropbox(fileId, existing.id, actor, {
        intakeType: opts.intakeType,
        workItemMode: mode === 'relaxed' ? 'relaxed' : 'governed',
        auditEvent: 'work_item_already_linked',
        idempotent: true,
      });
    }
    await recordDropboxAudit(appPool, fileId, 'work_item_already_linked', actor, {
      omDailyItemId: existing.id,
      code: workItemCode(existing.id),
    });
    return {
      file: dropbox.rowToApi(await dropbox.getFileById(fileId)),
      workItem: itemToSnapshot(existing),
      idempotent: true,
    };
  }

  await scanDropboxSecrets(file, { superAdminOverride: opts.superAdminOverride });

  const payload = buildWorkItemPayloadFromDropbox(file, opts);
  if (!ALLOWED_REPO_TARGETS.includes(payload.repoTarget)) {
    throw new BridgeError('INVALID_REPO_TARGET', 400, { repoTarget: payload.repoTarget });
  }
  validateIntakeOrThrow(mode, payload);
  if (payload.sharedIntake) payload.metadata.shared_intake = true;

  let item;
  try {
    item = mode === 'relaxed'
      ? await insertRelaxedItem(payload, actor)
      : await insertGovernedItem(payload, actor);
  } catch (err) {
    await recordDropboxAudit(appPool, fileId, 'work_item_link_failed', actor, {
      error: err instanceof BridgeError ? err.code : err.message,
      mode,
    });
    if (err instanceof BridgeError) throw err;
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ER_ACCESS_DENIED_ERROR') {
      throw new BridgeError('OMAI_UNAVAILABLE', 503, { error: err.message });
    }
    throw new BridgeError('OMAI_UNAVAILABLE', 503, { error: err.message });
  }

  await recordOmaiDropboxEvent(item.id, 'dropbox_linked', {
    file_id: file.id,
    work_packet_id: file.work_packet_id,
    mode,
  }, actor);

  const linkedFile = await linkWorkItemToDropbox(fileId, item.id, actor, {
    intakeType: opts.intakeType || (mode === 'relaxed' ? 'work_item' : 'hybrid'),
    workItemMode: mode === 'relaxed' ? 'relaxed' : 'governed',
    auditEvent: mode === 'relaxed' ? 'relaxed_work_item_created' : 'work_item_linked',
    dispatchId: opts.dispatchId || null,
  });

  return {
    file: linkedFile,
    workItem: itemToSnapshot(item),
    idempotent: false,
  };
}

async function createGovernedWorkItem(fileId, actor, opts = {}) {
  await recordDropboxAudit(getAppPool(), fileId, 'work_item_create_requested', actor, { mode: 'governed' });
  return createWorkItemInternal(fileId, actor, opts, 'governed');
}

async function createRelaxedWorkItem(fileId, actor, opts = {}) {
  await recordDropboxAudit(getAppPool(), fileId, 'work_item_create_requested', actor, { mode: 'relaxed' });
  return createWorkItemInternal(fileId, actor, opts, 'relaxed');
}

async function getLinkedWorkItemSnapshot(itemId) {
  if (!itemId) {
    return { linked: false, omDailyItemId: null, code: null, status: null, approvalMode: null, repoTarget: null, assignedAgent: null, agentTool: null, hubUrl: null };
  }
  try {
    const omaiPool = getOmaiPool();
    const [rows] = await omaiPool.query('SELECT * FROM om_daily_items WHERE id = ?', [itemId]);
    const row = rows[0];
    if (!row) {
      return { linked: true, omDailyItemId: itemId, code: workItemCode(itemId), status: null, approvalMode: null, repoTarget: null, assignedAgent: null, agentTool: null, hubUrl: hubUrl(itemId), notFound: true };
    }
    return {
      linked: true,
      omDailyItemId: row.id,
      code: workItemCode(row.id),
      title: row.title || null,
      status: row.status,
      approvalMode: row.approval_mode || 'normal',
      repoTarget: row.repo_target || null,
      assignedAgent: row.assigned_agent || null,
      agentTool: row.agent_tool || null,
      category: row.category || null,
      priority: row.priority || null,
      objective: row.objective || null,
      instruction: row.description || null,
      acceptanceCriteria: row.acceptance_criteria || null,
      hubUrl: hubUrl(row.id),
    };
  } catch (err) {
    throw new BridgeError('OMAI_UNAVAILABLE', 503, { error: err.message });
  }
}

async function unlinkWorkItem(fileId, actor) {
  if (actor?.role !== 'super_admin') throw new BridgeError('FORBIDDEN', 403);
  const appPool = getAppPool();
  const file = await dropbox.getFileById(fileId);
  if (!file) throw new BridgeError('NOT_FOUND', 404);
  const prev = file.om_daily_item_id;
  await appPool.query(
    `UPDATE docs_dropbox_files SET
      om_daily_item_id = NULL,
      om_daily_item_linked_at = NULL,
      om_daily_item_linked_by_email = NULL,
      work_item_mode = 'none',
      updated_at = NOW()
     WHERE id = ?`,
    [fileId],
  );
  await recordDropboxAudit(appPool, fileId, 'work_item_unlinked', actor, { previousOmDailyItemId: prev });
  return dropbox.rowToApi(await dropbox.getFileById(fileId));
}

function getFeatureFlagsForActor(actor) {
  return {
    workItemsEnabled: canUseWorkItems(actor),
    relaxedWorkItemsEnabled: canUseRelaxedWorkItems(actor),
    workItemsFeatureFlag: isWorkItemsFeatureEnabled(),
    relaxedFeatureFlag: isRelaxedFeatureEnabled(),
  };
}

module.exports = {
  BridgeError,
  ALLOWED_REPO_TARGETS,
  DROPBOX_AGENT_MAP,
  TARGET_SYSTEM_MAP,
  mapTargetSystemToRepoTarget,
  mapAssignedAgentToTools,
  buildWorkItemPayloadFromDropbox,
  validateIntakeOrThrow,
  scanDropboxSecrets,
  createGovernedWorkItem,
  createRelaxedWorkItem,
  linkWorkItemToDropbox,
  getLinkedWorkItemSnapshot,
  syncDispatchWorkItem,
  recordOmaiDropboxEvent,
  unlinkWorkItem,
  canUseWorkItems,
  canUseRelaxedWorkItems,
  getFeatureFlagsForActor,
  workItemCode,
  hubUrl,
};
