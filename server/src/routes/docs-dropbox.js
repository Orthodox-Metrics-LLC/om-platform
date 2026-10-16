/**
 * OM Docs Dropbox — inbound document staging, review, edit, and promotion.
 *
 * Routes:
 *   GET    /list?tab=...           — list with workflow tabs
 *   POST   /upload                 — multipart upload
 *   GET    /download/:id           — download working or original file
 *   GET    /preview/:id            — preview content
 *   GET    /:id/content            — raw editable content
 *   PUT    /:id/content            — save edit + revision
 *   GET    /:id/revisions          — revision history
 *   PATCH  /:id/classify           — classification metadata
 *   POST   /:id/frontmatter        — merge frontmatter into markdown
 *   POST   /:id/mark-ready         — mark ready for public/internal docs
 *   POST   /:id/review             — mark reviewed
 *   POST   /:id/promote            — promote to om-docs tree
 *   POST   /:id/archive            — archive
 *   POST   /:id/reject             — reject
 *   GET    /:id/audit              — audit events
 *   POST   /slug-from-title        — slug helper
 *   DELETE /:id                    — soft-delete
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ApiResponse = require('../utils/apiResponse');
const dropbox = require('../services/docsDropboxService');
const dispatchService = require('../services/docsDispatchService');
const workItemBridge = require('../services/docsWorkItemBridgeService');

const router = express.Router();

function getUserMeta(req) {
  const user = req.session?.user || req.user || {};
  return {
    id: user.id ?? null,
    email: user.email ?? null,
    name: user.name || user.username || user.email || 'unknown',
    role: user.role ?? null,
  };
}

function isValidId(id) {
  return id && typeof id === 'string' && !id.includes('..') && !id.includes('/');
}

// Reject malformed :id params (path traversal / slashes) before any handler runs.
router.param('id', (req, res, next, id) => {
  if (!isValidId(id)) {
    return res.status(400).json(ApiResponse.error('Invalid file id', 'VALIDATION_ERROR', 400));
  }
  next();
});

function mapBridgeError(err, res, fallbackMessage) {
  if (err instanceof workItemBridge.BridgeError) {
    return mapServiceError(err, res, fallbackMessage);
  }
  return mapServiceError(err, res, fallbackMessage);
}

function isAdminOrSuper(req) {
  const role = getUserMeta(req).role;
  return role === 'admin' || role === 'super_admin';
}

function isSuperAdmin(req) {
  return getUserMeta(req).role === 'super_admin';
}

/** Map request body → bridge intake opts (governed + relaxed). */
function workItemIntakeFromBody(body = {}) {
  return {
    title: body.title,
    description: body.description,
    instruction: body.instruction || body.description,
    objective: body.objective,
    requestedOutcome: body.requestedOutcome,
    acceptanceCriteria: body.acceptanceCriteria,
    executionMode: body.executionMode,
    sharedRepoJustification: body.sharedRepoJustification,
    repoTarget: body.repoTarget,
    category: body.category,
    priority: body.priority,
    assignedAgent: body.assignedAgent,
    agentTool: body.agentTool,
    taskType: body.taskType,
    horizon: body.horizon,
    targetSystem: body.target,
    source: body.source,
  };
}

function mapServiceError(err, res, fallbackMessage) {
  const code = err.message || '';
  if (code === 'NOT_FOUND') {
    return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
  }
  if (code === 'NOT_ON_DISK') {
    return res.status(404).json(ApiResponse.error('File not found on disk', 'NOT_FOUND', 404));
  }
  if (code === 'NOT_EDITABLE') {
    return res.status(400).json(ApiResponse.error('File type is not editable', 'VALIDATION_ERROR', 400));
  }
  if (code === 'PREVIEW_UNSUPPORTED') {
    return res.status(400).json(ApiResponse.error('Preview not available for this file type', 'VALIDATION_ERROR', 400));
  }
  if (code === 'INVALID_STATUS') {
    return res.status(400).json(ApiResponse.error('Invalid status for this action', 'VALIDATION_ERROR', 400));
  }
  if (code === 'EMPTY_PROMPT') {
    return res.status(400).json(ApiResponse.error('Prompt text is required', 'VALIDATION_ERROR', 400));
  }
  if (code === 'EMPTY_SUBMISSION') {
    return res.status(400).json(ApiResponse.error('Provide a prompt and/or at least one file', 'VALIDATION_ERROR', 400));
  }
  if (code === 'PROMPT_TOO_LARGE') {
    return res.status(413).json(ApiResponse.error('Prompt exceeds the maximum allowed length', 'VALIDATION_ERROR', 413));
  }
  if (code === 'SHORT_PROMPT_TOO_LARGE') {
    return res.status(413).json(ApiResponse.error('Short prompt exceeds the maximum allowed length', 'VALIDATION_ERROR', 413));
  }
  if (code === 'INVALID_AGENT') {
    return res.status(400).json(ApiResponse.error('Unknown assigned agent', 'VALIDATION_ERROR', 400));
  }
  if (code === 'ASSIGNED_AGENT_REQUIRED') {
    return res.status(400).json(ApiResponse.error('Assigned agent is required before marking ready for agent', 'ASSIGNED_AGENT_REQUIRED', 400));
  }
  if (code === 'INVALID_INTAKE_TYPE') {
    return res.status(400).json(ApiResponse.error('Invalid intake type', 'VALIDATION_ERROR', 400));
  }
  if (code === 'INTAKE_TYPE_IMMUTABLE') {
    return res.status(400).json(ApiResponse.error('Cannot change a work item back to documentation only', 'INTAKE_TYPE_IMMUTABLE', 400));
  }
  if (code === 'SECRET_SCAN_BLOCKED') {
    return res.status(422).json(ApiResponse.error(
      'Secret patterns detected — work item creation blocked',
      'SECRET_SCAN_BLOCKED',
      422,
      { warnings: err.warnings || err.details?.warnings || [] },
    ));
  }
  if (code === 'SECRETS_DETECTED') {
    return res.status(422).json(ApiResponse.error(
      'Secret patterns detected — promotion blocked',
      'SECRETS_DETECTED',
      422,
      { warnings: err.warnings || err.details?.warnings || [] },
    ));
  }
  if (code === 'VALIDATION_ERROR') {
    return res.status(422).json(ApiResponse.error(
      err.details?.message || 'Work item intake validation failed',
      'VALIDATION_ERROR',
      422,
      err.details || undefined,
    ));
  }
  if (code === 'INVALID_REPO_TARGET' || code === 'MISSING_AGENT') {
    return res.status(400).json(ApiResponse.error(err.details?.message || code, code, 400, err.details || undefined));
  }
  if (code === 'VALIDATION_ERROR') {
    return res.status(422).json(ApiResponse.error(
      err.details?.message || 'Work item intake validation failed',
      'VALIDATION_ERROR',
      422,
      err.details || undefined,
    ));
  }
  if (code === 'OMAI_UNAVAILABLE') {
    const detailMsg = err.details?.error;
    const message = detailMsg
      ? `OMAI database unavailable: ${detailMsg}`
      : 'OMAI database unavailable — check omai_db connectivity';
    return res.status(503).json(ApiResponse.error(message, 'OMAI_UNAVAILABLE', 503, err.details || undefined));
  }
  if (code === 'FORBIDDEN') {
    return res.status(403).json(ApiResponse.error('Not authorized for this action', 'FORBIDDEN', 403));
  }
  if (code === 'ALREADY_LINKED') {
    return res.status(409).json(ApiResponse.error('Work item already linked', 'ALREADY_LINKED', 409, err.details || undefined));
  }
  if (code === 'TARGET_EXISTS' || code === 'CONFIRM_OVERWRITE') {
    return res.status(409).json(ApiResponse.error(
      'Target file already exists — confirm overwrite',
      'TARGET_EXISTS',
      409,
      { targetPath: err.details?.targetPath },
    ));
  }
  if (code === 'VISIBILITY_MISMATCH' || code === 'CONFIRM_INTERNAL_AS_PUBLIC') {
    return res.status(400).json(ApiResponse.error(
      'Internal content cannot be promoted as public without confirmation',
      'VISIBILITY_MISMATCH',
      400,
    ));
  }
  if (code === 'INVALID_TARGET_PATH' || code === 'INVALID_PROMOTE_PATH') {
    return res.status(400).json(ApiResponse.error('Invalid target path', 'VALIDATION_ERROR', 400));
  }
  if (code === 'MISSING_TARGET' || code === 'TARGET_PATH_REQUIRED') {
    return res.status(400).json(ApiResponse.error('Target path and visibility are required', 'VALIDATION_ERROR', 400));
  }
  console.error(`[DocsDropbox] ${fallbackMessage}:`, err);
  return res.status(500).json(ApiResponse.error(fallbackMessage, 'SERVER_ERROR', 500));
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      dropbox.ensureStorageDirs();
      cb(null, dropbox.getStorageRoot());
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const original = dropbox.sanitizeOriginalName(file.originalname);
    const check = dropbox.validateExtension(original);
    if (!check.ok) {
      cb(new Error(check.reason));
      return;
    }
    const id = crypto.randomUUID();
    cb(null, `${id}${check.ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: dropbox.MAX_FILE_SIZE, files: 1 },
  fileFilter(_req, file, cb) {
    const original = dropbox.sanitizeOriginalName(file.originalname);
    const check = dropbox.validateExtension(original);
    if (!check.ok) {
      cb(new Error(check.reason));
      return;
    }
    cb(null, true);
  },
});

const submitStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      dropbox.ensureStorageDirs();
      cb(null, dropbox.getStorageRoot());
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const original = dropbox.sanitizeOriginalName(file.originalname);
    const check = dropbox.validateExtension(original);
    if (!check.ok) {
      cb(new Error(check.reason));
      return;
    }
    const id = crypto.randomUUID();
    cb(null, `${id}${check.ext}`);
  },
});

const submitUpload = multer({
  storage: submitStorage,
  limits: { fileSize: dropbox.MAX_FILE_SIZE, files: 20 },
  fileFilter(_req, file, cb) {
    const original = dropbox.sanitizeOriginalName(file.originalname);
    const check = dropbox.validateExtension(original);
    if (!check.ok) {
      cb(new Error(check.reason));
      return;
    }
    cb(null, true);
  },
});

router.get('/list', async (req, res) => {
  try {
    const tab = String(req.query.tab || 'uploaded').toLowerCase();
    if (!dropbox.TAB_STATUS_MAP[tab] && tab !== 'all') {
      return res.status(400).json(ApiResponse.error('Invalid tab filter', 'VALIDATION_ERROR', 400));
    }
    const files = await dropbox.listFiles(tab);
    const featureFlags = workItemBridge.getFeatureFlagsForActor(getUserMeta(req));
    return res.json(ApiResponse.success({
      files,
      tab,
      storageRoot: dropbox.getStorageRoot(),
      agentPathPrefix: dropbox.AGENT_PATH_PREFIX,
      omDocsRoot: dropbox.getOmDocsRoot(),
      docTypes: [...dropbox.DOC_TYPES],
      assignedAgents: [...dropbox.ASSIGNED_AGENTS],
      maxPromptChars: dropbox.MAX_PROMPT_CHARS,
      ...featureFlags,
    }));
  } catch (err) {
    console.error('[DocsDropbox] list error:', err);
    return res.status(500).json(ApiResponse.error('Failed to list files', 'SERVER_ERROR', 500));
  }
});

router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const message = err.message || 'Upload failed';
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json(ApiResponse.error(message, 'UPLOAD_ERROR', status));
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json(ApiResponse.error('No file uploaded', 'VALIDATION_ERROR', 400));
    }

    const uploader = getUserMeta(req);
    const promptText = typeof req.body?.promptText === 'string' ? req.body.promptText
      : (typeof req.body?.prompt_text === 'string' ? req.body.prompt_text : null);

    const file = await dropbox.registerMulterUpload(req.file, uploader, { promptText });
    console.log(`[DocsDropbox] upload id=${file.id} user=${uploader.id} file=${file.originalName}`);
    return res.status(201).json(ApiResponse.success({ file }, 'File uploaded'));
  } catch (err) {
    console.error('[DocsDropbox] upload error:', err);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    const message = err.message || 'Upload failed';
    const status = message.includes('exceeds') ? 413 : 500;
    return res.status(status).json(ApiResponse.error(message, 'UPLOAD_ERROR', status));
  }
});

router.post('/paste/preview', (req, res) => {
  try {
    const preview = dropbox.previewPastedPrompt(req.body || {});
    return res.json(ApiResponse.success(preview));
  } catch (err) {
    return mapServiceError(err, res, 'Preview failed');
  }
});

router.post('/paste', async (req, res) => {
  try {
    const file = await dropbox.createPastedPrompt(req.body || {}, getUserMeta(req));
    console.log(`[DocsDropbox] paste id=${file.id} wp=${file.workPacketId} agent=${file.assignedAgent}`);
    return res.status(201).json(ApiResponse.success({ file }, 'Prompt saved as dropbox item'));
  } catch (err) {
    return mapServiceError(err, res, 'Create pasted prompt failed');
  }
});

router.post('/submit', (req, res, next) => {
  submitUpload.array('files', 20)(req, res, (err) => {
    if (err) {
      const message = err.message || 'Submit failed';
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json(ApiResponse.error(message, 'UPLOAD_ERROR', status));
    }
    next();
  });
}, async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const body = req.body || {};
    const fields = {
      title: body.title,
      promptText: body.promptText ?? body.prompt_text ?? '',
      targetSystem: body.targetSystem ?? body.target_system,
      assignedAgent: body.assignedAgent ?? body.assigned_agent,
      documentVisibility: body.documentVisibility ?? body.document_visibility,
      intakeType: body.intakeType ?? body.intake_type,
      workItemMode: body.workItemMode ?? body.work_item_mode,
      createWorkItemOnSubmit: body.createWorkItemOnSubmit ?? body.create_work_item_on_submit,
      category: body.category,
      priority: body.priority,
      repoTarget: body.repoTarget ?? body.repo_target,
    };
    const file = await dropbox.createDropboxSubmission(fields, getUserMeta(req), files);
    console.log(`[DocsDropbox] submit id=${file.id} wp=${file.workPacketId} attachments=${(file.metadataJson && file.metadataJson.attachments) ? file.metadataJson.attachments.length : 0}`);
    return res.status(201).json(ApiResponse.success({ file }, 'Dropbox item submitted'));
  } catch (err) {
    const uploaded = Array.isArray(req.files) ? req.files : [];
    for (const f of uploaded) {
      if (f?.path) fs.unlink(f.path, () => {});
    }
    return mapServiceError(err, res, 'Submit failed');
  }
});

router.post('/:id/mark-ready-for-agent', async (req, res) => {
  try {
    const { id } = req.params;
    const file = await dropbox.markReadyForAgent(id, getUserMeta(req), {
      assignedAgent: req.body?.assignedAgent ?? req.body?.assigned_agent,
    });
    return res.json(ApiResponse.success({ file }, 'Marked ready for agent'));
  } catch (err) {
    return mapServiceError(err, res, 'Mark ready for agent failed');
  }
});

router.patch('/:id/intake-type', async (req, res) => {
  try {
    const { id } = req.params;
    const intakeType = req.body?.intakeType ?? req.body?.intake_type;
    if (intakeType == null || intakeType === '') {
      return res.status(400).json(ApiResponse.error('intakeType is required', 'VALIDATION_ERROR', 400));
    }
    const file = await dropbox.updateIntakeType(id, intakeType, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Intake type updated'));
  } catch (err) {
    return mapServiceError(err, res, 'Intake type update failed');
  }
});

// ── Agent dispatch (Send to Agent → durable dispatch) ───────────────────────
function mapDispatchError(err, res, fallbackMessage) {
  if (err instanceof dispatchService.DispatchError) {
    return res.status(err.status || 400).json(
      ApiResponse.error(err.code, err.code, err.status || 400, err.details || undefined),
    );
  }
  return mapServiceError(err, res, fallbackMessage);
}

router.post('/:id/send-to-agent', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await dispatchService.sendToAgent(id, getUserMeta(req), {
      assignedAgent: req.body?.assignedAgent,
      target: req.body?.target,
      priority: req.body?.priority,
      claimTimeoutMin: Number(req.body?.claimTimeoutMinutes) || undefined,
      createWorkItem: Boolean(req.body?.createWorkItem),
      workItemMode: req.body?.workItemMode || 'governed',
      repoTarget: req.body?.repoTarget,
      superAdminOverride: Boolean(req.body?.superAdminOverride) && isSuperAdmin(req),
    });
    return res.json(ApiResponse.success(result, result.idempotent ? 'Dispatch already active' : 'Sent to agent'));
  } catch (err) {
    if (err instanceof workItemBridge.BridgeError) {
      return mapBridgeError(err, res, 'Send to agent failed');
    }
    return mapDispatchError(err, res, 'Send to agent failed');
  }
});

router.post('/:id/create-work-item', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isAdminOrSuper(req)) {
      return res.status(403).json(ApiResponse.error('Not authorized', 'FORBIDDEN', 403));
    }
    const result = await workItemBridge.createGovernedWorkItem(id, getUserMeta(req), {
      ...workItemIntakeFromBody(req.body),
      superAdminOverride: Boolean(req.body?.superAdminOverride) && isSuperAdmin(req),
    });
    const status = result.idempotent ? 200 : 201;
    return res.status(status).json(ApiResponse.success({ ...result, idempotent: result.idempotent }));
  } catch (err) {
    return mapBridgeError(err, res, 'Create work item failed');
  }
});

router.post('/:id/create-relaxed-work-item', async (req, res) => {
  try {
    const { id } = req.params;
    if (!workItemBridge.canUseRelaxedWorkItems(getUserMeta(req))) {
      return res.status(403).json(ApiResponse.error('Not authorized for relaxed work items', 'FORBIDDEN', 403));
    }
    const result = await workItemBridge.createRelaxedWorkItem(id, getUserMeta(req), {
      ...workItemIntakeFromBody(req.body),
      source: req.body?.source || 'operator_direct',
      superAdminOverride: Boolean(req.body?.superAdminOverride) && isSuperAdmin(req),
    });
    const status = result.idempotent ? 200 : 201;
    return res.status(status).json(ApiResponse.success({ ...result, idempotent: result.idempotent }));
  } catch (err) {
    return mapBridgeError(err, res, 'Create relaxed work item failed');
  }
});

router.get('/:id/work-item', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await dropbox.getFileById(id);
    if (!row || row.deleted_at) {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }
    const snapshot = await workItemBridge.getLinkedWorkItemSnapshot(row.om_daily_item_id);
    return res.json(ApiResponse.success(snapshot));
  } catch (err) {
    return mapBridgeError(err, res, 'Failed to load work item');
  }
});

router.delete('/:id/work-item-link', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isSuperAdmin(req)) {
      return res.status(403).json(ApiResponse.error('Super admin only', 'FORBIDDEN', 403));
    }
    const file = await workItemBridge.unlinkWorkItem(id, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Work item link cleared'));
  } catch (err) {
    return mapBridgeError(err, res, 'Unlink failed');
  }
});

router.get('/:id/dispatch', async (req, res) => {
  try {
    const { id } = req.params;
    const active = await dispatchService.getActiveDispatchForFile(id);
    const dispatches = await dispatchService.listDispatchesForFile(id);
    const notifications = active ? await dispatchService.getNotificationsForDispatch(active.dispatchId) : [];
    return res.json(ApiResponse.success({ active, dispatches, notifications }));
  } catch (err) {
    return mapDispatchError(err, res, 'Failed to load dispatch');
  }
});

router.post('/:id/return-to-review', async (req, res) => {
  try {
    const { id } = req.params;
    const active = await dispatchService.getActiveDispatchForFile(id);
    if (active) {
      await dispatchService.cancelDispatch(active.dispatchId, getUserMeta(req), 'Returned to review by operator');
    }
    const file = await dropbox.markReviewed(id, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Returned to review'));
  } catch (err) {
    return mapDispatchError(err, res, 'Return to review failed');
  }
});

router.post('/:id/picked-up', async (req, res) => {
  try {
    const { id } = req.params;
    const file = await dropbox.markPickedUp(id, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Marked as picked up'));
  } catch (err) {
    return mapServiceError(err, res, 'Mark picked up failed');
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 1000) : null;
    const file = await dropbox.cancelFile(id, getUserMeta(req), reason);
    return res.json(ApiResponse.success({ file }, 'Cancelled'));
  } catch (err) {
    return mapServiceError(err, res, 'Cancel failed');
  }
});

router.post('/slug-from-title', (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title : '';
  const slug = dropbox.slugFromTitle(title);
  return res.json(ApiResponse.success({ slug, title: title.trim() }));
});

router.get('/download/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const row = await dropbox.getFileById(id);
    if (!row || row.deleted_at) {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }

    const filePath = dropbox.getWorkingFilePath(row);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json(ApiResponse.error('File not found on disk', 'NOT_FOUND', 404));
    }

    return res.download(filePath, row.original_file_name);
  } catch (err) {
    return mapServiceError(err, res, 'Download failed');
  }
});

router.get('/preview/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const preview = await dropbox.buildPreview(id);
    // `peek` = passive hover preview: do not record a preview audit event.
    const peek = req.query.peek === '1' || req.query.peek === 'true';
    if (!peek) {
      const actor = getUserMeta(req);
      const pool = require('../config/db').getAppPool();
      await pool.query(
        `INSERT INTO docs_dropbox_audit_events
          (file_id, event_type, actor_id, actor_email, actor_name)
         VALUES (?, 'preview', ?, ?, ?)`,
        [id, actor.id, actor.email, actor.name],
      );
    }

    return res.json(ApiResponse.success(preview));
  } catch (err) {
    return mapServiceError(err, res, 'Preview failed');
  }
});

router.get('/:id/content', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await dropbox.getContent(id);
    return res.json(ApiResponse.success(data));
  } catch (err) {
    return mapServiceError(err, res, 'Failed to load content');
  }
});

router.put('/:id/content', async (req, res) => {
  try {
    const { id } = req.params;
    const content = typeof req.body?.content === 'string' ? req.body.content : null;
    if (content === null) {
      return res.status(400).json(ApiResponse.error('Content is required', 'VALIDATION_ERROR', 400));
    }
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null;
    const file = await dropbox.saveContent(id, content, getUserMeta(req), note);
    return res.json(ApiResponse.success({ file }, 'Content saved'));
  } catch (err) {
    return mapServiceError(err, res, 'Save failed');
  }
});

router.put('/:id/markup', async (req, res) => {
  try {
    const { id } = req.params;
    const annotations = Array.isArray(req.body?.annotations) ? req.body.annotations : null;
    if (annotations === null) {
      return res.status(400).json(ApiResponse.error('annotations array is required', 'VALIDATION_ERROR', 400));
    }
    const file = await dropbox.saveMarkup(id, annotations, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Markup saved'));
  } catch (err) {
    return mapServiceError(err, res, 'Save markup failed');
  }
});

router.patch('/:id/short-prompt', async (req, res) => {
  try {
    const { id } = req.params;
    const shortPrompt = typeof req.body?.shortPrompt === 'string'
      ? req.body.shortPrompt
      : (typeof req.body?.short_prompt === 'string' ? req.body.short_prompt : null);
    if (shortPrompt === null) {
      return res.status(400).json(ApiResponse.error('shortPrompt is required', 'VALIDATION_ERROR', 400));
    }
    const file = await dropbox.saveShortPrompt(id, shortPrompt, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Short prompt saved'));
  } catch (err) {
    return mapServiceError(err, res, 'Save short prompt failed');
  }
});

router.get('/:id/revisions', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await dropbox.getFileById(id);
    if (!row) {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }
    const revisions = await dropbox.getRevisions(id);
    return res.json(ApiResponse.success({ fileId: id, revisions }));
  } catch (err) {
    return mapServiceError(err, res, 'Failed to load revisions');
  }
});

router.patch('/:id/classify', async (req, res) => {
  try {
    const { id } = req.params;
    const file = await dropbox.updateClassification(id, req.body || {}, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Classification updated'));
  } catch (err) {
    return mapServiceError(err, res, 'Classification update failed');
  }
});

router.post('/:id/frontmatter', async (req, res) => {
  try {
    const { id } = req.params;
    const file = await dropbox.insertFrontmatter(id, req.body || {}, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Frontmatter updated'));
  } catch (err) {
    return mapServiceError(err, res, 'Frontmatter update failed');
  }
});

router.post('/:id/mark-ready', async (req, res) => {
  try {
    const { id } = req.params;
    const visibility = String(req.body?.visibility || '').toLowerCase();
    if (!['public', 'internal'].includes(visibility)) {
      return res.status(400).json(ApiResponse.error('visibility must be public or internal', 'VALIDATION_ERROR', 400));
    }
    const file = await dropbox.markReady(id, getUserMeta(req), visibility);
    return res.json(ApiResponse.success({ file }, `Marked ready for ${visibility} docs`));
  } catch (err) {
    return mapServiceError(err, res, 'Mark ready failed');
  }
});

router.post('/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    const file = await dropbox.markReviewed(id, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Marked as reviewed'));
  } catch (err) {
    return mapServiceError(err, res, 'Review failed');
  }
});

router.post('/:id/promote', async (req, res) => {
  try {
    const { id } = req.params;
    const options = {
      confirmOverwrite: Boolean(req.body?.confirmOverwrite),
      confirmInternalAsPublic: Boolean(req.body?.confirmInternalAsPublic),
      superAdminOverride: Boolean(req.body?.superAdminOverride) && isSuperAdmin(req),
    };
    const file = await dropbox.promoteFile(id, getUserMeta(req), options);
    console.log(`[DocsDropbox] promote id=${id} path=${file.promotedPath}`);
    return res.json(ApiResponse.success({ file }, 'Promoted to om-docs'));
  } catch (err) {
    return mapServiceError(err, res, 'Promotion failed');
  }
});

router.post('/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;
    const file = await dropbox.archiveFile(id, getUserMeta(req));
    try {
      const { emitBrainEvent } = require('../services/brainEventEmitter');
      const actor = getUserMeta(req);
      emitBrainEvent({
        source: 'om',
        event_type: 'docs.dispatch.archived',
        severity: 'info',
        summary: `Dropbox item archived · ${file.workPacketId || id}`,
        actor_type: actor.id ? 'user' : 'system',
        actor_id: actor.id != null ? String(actor.id) : null,
        object_type: 'docs_work_packet',
        object_id: id,
        data: {
          work_packet_id: file.workPacketId || null,
          action: 'archived',
          status_after: 'archived',
          actor: actor.email || actor.name || 'system',
          timestamp: new Date().toISOString(),
        },
      });
    } catch { /* best-effort governance event */ }
    return res.json(ApiResponse.success({ file }, 'Archived'));
  } catch (err) {
    return mapServiceError(err, res, 'Archive failed');
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 1000) : null;
    const file = await dropbox.rejectFile(id, getUserMeta(req), reason);
    return res.json(ApiResponse.success({ file }, 'Rejected'));
  } catch (err) {
    return mapServiceError(err, res, 'Reject failed');
  }
});

router.get('/:id/audit', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await dropbox.getFileById(id);
    if (!row) {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }
    const events = await dropbox.getAuditEvents(id);
    return res.json(ApiResponse.success({ fileId: id, events }));
  } catch (err) {
    return mapServiceError(err, res, 'Failed to load audit');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dropbox.softDeleteFile(id, getUserMeta(req));
    console.log(`[DocsDropbox] delete id=${id}`);
    return res.json(ApiResponse.success({ id }, 'File deleted'));
  } catch (err) {
    return mapServiceError(err, res, 'Delete failed');
  }
});

module.exports = router;
