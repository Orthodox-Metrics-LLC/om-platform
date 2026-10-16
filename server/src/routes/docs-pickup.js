/**
 * OM Docs Pickup — persistent document handoff (agents → human review).
 *
 * Routes:
 *   GET    /list?tab=waiting|picked_up|archived|all|deleted|expired
 *   GET    /download/:id
 *   GET    /preview/:id
 *   GET    /:id/audit
 *   POST   /upload
 *   POST   /:id/view
 *   POST   /:id/pickup
 *   POST   /:id/archive
 *   POST   /:id/restore
 *   POST   /:id/note
 *   POST   /bulk
 *   POST   /bulk/download
 *   DELETE /:id                   — soft-delete (file retained on disk)
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');
const ApiResponse = require('../utils/apiResponse');
const docsPickup = require('../services/docsPickupService');
const docsFiling = require('../services/docsPickupFilingService');

const router = express.Router();

function isSuperAdmin(req) {
  const role = (req.session?.user?.role || req.user?.role || '').toString().toLowerCase();
  return role === 'super_admin';
}

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

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      docsPickup.ensureStorageDirs();
      cb(null, docsPickup.getFilesDir());
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const original = docsPickup.sanitizeOriginalName(file.originalname);
    const check = docsPickup.validateExtension(original);
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
  limits: { fileSize: docsPickup.MAX_FILE_SIZE, files: 1 },
  fileFilter(_req, file, cb) {
    const original = docsPickup.sanitizeOriginalName(file.originalname);
    const check = docsPickup.validateExtension(original);
    if (!check.ok) {
      cb(new Error(check.reason));
      return;
    }
    cb(null, true);
  },
});

router.get('/list', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    const tab = String(req.query.tab || req.query.status || 'waiting').toLowerCase();
    if (!docsPickup.TAB_STATUS_MAP[tab] && tab !== 'all') {
      return res.status(400).json(ApiResponse.error('Invalid tab filter', 'VALIDATION_ERROR', 400));
    }
    try { await docsFiling.ensurePickupIds(); } catch { /* backfill best-effort */ }
    const files = await docsPickup.listFiles(tab);
    return res.json(ApiResponse.success({
      files,
      tab,
      storageRoot: docsPickup.getStorageRoot(),
      agentPathPrefix: docsPickup.AGENT_PATH_PREFIX,
    }));
  } catch (err) {
    console.error('[DocsPickup] list error:', err);
    return res.status(500).json(ApiResponse.error('Failed to list files', 'SERVER_ERROR', 500));
  }
});

// ── Parent/child grouping (Phase 2) ────────────────────────────────────────
// Admin-only (router is mounted behind requireAuthForRoutes + requireAdminForRoutes).
// All operations are non-destructive metadata changes on docs_pickup_files.

const GROUPING_ERROR_STATUS = {
  PARENT_NOT_FOUND: [404, 'Parent pickup not found'],
  CHILD_NOT_FOUND: [404, 'Child pickup not found'],
  NOT_FOUND: [404, 'Pickup not found'],
  PARENT_DELETED: [400, 'Parent pickup is deleted'],
  DELETED: [400, 'Pickup is deleted'],
  SELF_PARENT: [400, 'A pickup cannot be its own parent'],
  CYCLE: [400, 'Assignment would create a parent/child cycle'],
};

function sendGroupingError(res, err, fallbackMsg) {
  const mapped = GROUPING_ERROR_STATUS[err.message];
  if (mapped) {
    return res.status(mapped[0]).json(ApiResponse.error(mapped[1], mapped[0] === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', mapped[0]));
  }
  console.error(`[DocsPickup] grouping error: ${fallbackMsg}:`, err);
  return res.status(500).json(ApiResponse.error(fallbackMsg, 'SERVER_ERROR', 500));
}

// List all groups (with member counts).
router.get('/groups', async (_req, res) => {
  try {
    const groups = await docsPickup.listGroups();
    return res.json(ApiResponse.success({ groups }));
  } catch (err) {
    return sendGroupingError(res, err, 'Failed to list groups');
  }
});

// Create a group around a parent pickup (optionally assigning children).
router.post('/groups', async (req, res) => {
  try {
    const parentRef = req.body?.parentId || req.body?.parentPickupId;
    if (!parentRef || typeof parentRef !== 'string') {
      return res.status(400).json(ApiResponse.error('parentId (or parentPickupId) is required', 'VALIDATION_ERROR', 400));
    }
    const childRefs = Array.isArray(req.body?.childIds) ? req.body.childIds
      : (Array.isArray(req.body?.childPickupIds) ? req.body.childPickupIds : []);
    if (childRefs.length > 500) {
      return res.status(400).json(ApiResponse.error('Too many children (max 500)', 'VALIDATION_ERROR', 400));
    }
    const result = await docsPickup.createGroup({
      parentRef,
      title: typeof req.body?.title === 'string' ? req.body.title.slice(0, 255) : null,
      featureTag: typeof req.body?.featureTag === 'string' ? req.body.featureTag.slice(0, 64) : null,
      workPacketId: typeof req.body?.workPacketId === 'string' ? req.body.workPacketId.slice(0, 64) : null,
      note: typeof req.body?.note === 'string' ? req.body.note.slice(0, 2000) : null,
      childRefs,
    }, getUserMeta(req));
    return res.status(201).json(ApiResponse.success(result, 'Group created'));
  } catch (err) {
    return sendGroupingError(res, err, 'Failed to create group');
  }
});

// Assign :id as a child of a parent pickup.
router.post('/:id/parent', async (req, res) => {
  try {
    const { id } = req.params;
    const parentRef = req.body?.parentId || req.body?.parentPickupId;
    if (!parentRef || typeof parentRef !== 'string') {
      return res.status(400).json(ApiResponse.error('parentId (or parentPickupId) is required', 'VALIDATION_ERROR', 400));
    }
    const result = await docsPickup.assignParent(id, parentRef, getUserMeta(req), {
      title: typeof req.body?.title === 'string' ? req.body.title.slice(0, 255) : null,
      featureTag: typeof req.body?.featureTag === 'string' ? req.body.featureTag.slice(0, 64) : null,
      workPacketId: typeof req.body?.workPacketId === 'string' ? req.body.workPacketId.slice(0, 64) : null,
    });
    return res.json(ApiResponse.success(result, 'Parent assigned'));
  } catch (err) {
    return sendGroupingError(res, err, 'Failed to assign parent');
  }
});

// Ungroup :id (remove parent/group; detaches children if :id is a parent).
router.delete('/:id/parent', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await docsPickup.ungroupPickup(id, getUserMeta(req));
    return res.json(ApiResponse.success(result, 'Ungrouped'));
  } catch (err) {
    return sendGroupingError(res, err, 'Failed to ungroup');
  }
});

// ── Governed internal-documentation filing ─────────────────────────────────

// Canonical category → docs/internal path map (for the UI dropdown).
router.get('/filing/categories', (_req, res) => {
  const categories = Object.entries(docsFiling.CATEGORY_MAP).map(([key, v]) => ({
    key, label: v.label, dir: v.dir,
  }));
  return res.json(ApiResponse.success({ categories, docsInternalRoot: docsFiling.DOCS_INTERNAL_ROOT }));
});

// List filing requests (optionally by status) — admin.
router.get('/filing/requests', async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const requests = await docsFiling.listFilingRequests({ status, limit });
    return res.json(ApiResponse.success({ requests }));
  } catch (err) {
    console.error('[DocsPickup] filing list error:', err);
    return res.status(500).json(ApiResponse.error('Failed to list filing requests', 'SERVER_ERROR', 500));
  }
});

// Approved documents waiting to be filed.
router.get('/filing/waiting-to-file', async (_req, res) => {
  try {
    const requests = await docsFiling.listWaitingToFile();
    return res.json(ApiResponse.success({ requests }));
  } catch (err) {
    console.error('[DocsPickup] waiting-to-file error:', err);
    return res.status(500).json(ApiResponse.error('Failed to list waiting-to-file', 'SERVER_ERROR', 500));
  }
});

router.get('/filing/requests/:receipt', async (req, res) => {
  try {
    const detail = await docsFiling.getFilingRequest(req.params.receipt);
    if (!detail) return res.status(404).json(ApiResponse.error('Filing request not found', 'NOT_FOUND', 404));
    return res.json(ApiResponse.success({ request: detail }));
  } catch (err) {
    console.error('[DocsPickup] filing detail error:', err);
    return res.status(500).json(ApiResponse.error('Failed to load filing request', 'SERVER_ERROR', 500));
  }
});

// Resolve a pickup item by pickup_id (OMDOC-PICKUP-...) or internal id.
router.get('/pickup/:pickupId', async (req, res) => {
  try {
    const id = req.params.pickupId;
    // Compat: OMDOC-* resolves via OM Documents
    if (/^OMDOC-\d{8}-[A-Z0-9]{6}$/.test(id)) {
      const documentService = require('../services/om-documents/documentService');
      const doc = await documentService.getByDocumentId(id);
      if (!doc) return res.status(404).json(ApiResponse.error('Document not found', 'NOT_FOUND', 404));
      return res.json(ApiResponse.success({
        file: {
          id: doc.id,
          pickupId: doc.documentId,
          documentId: doc.documentId,
          title: doc.title,
          status: doc.lifecycle,
          agentPath: doc.relativePath,
          physicalPath: doc.physicalPath,
          filingState: doc.filingState,
          filingReceipt: doc.filingReceipt,
          source: 'om_documents',
        },
      }));
    }
    const row = await docsFiling.resolvePickup(id);
    if (!row) return res.status(404).json(ApiResponse.error('Pickup item not found', 'NOT_FOUND', 404));
    return res.json(ApiResponse.success({ file: docsPickup.rowToApi(row) }));
  } catch (err) {
    console.error('[DocsPickup] resolve error:', err);
    return res.status(500).json(ApiResponse.error('Resolve failed', 'SERVER_ERROR', 500));
  }
});

// Request Brain Approval for internal filing (never files immediately).
router.post('/:id/request-filing', async (req, res) => {
  try {
    const { id } = req.params;
    const actor = getUserMeta(req);
    const allowedSources = new Set(['ombrain_cli', 'ombrain_chat', 'omdocs_pickup_ui']);
    const requestSource = allowedSources.has(req.body?.requestSource) ? req.body.requestSource : 'omdocs_pickup_ui';
    const result = await docsFiling.createFilingRequest({
      idOrPickupId: id,
      category: req.body?.category,
      visibility: req.body?.visibility || 'internal',
      targetPath: req.body?.targetPath,
      title: req.body?.title,
      requestingActor: req.body?.requestingActor || actor.email || actor.name,
      requestSource,
      actor,
    });
    if (!result.ok) {
      return res.status(400).json(ApiResponse.error(result.error, 'VALIDATION_ERROR', 400));
    }
    return res.status(201).json(ApiResponse.success(result, 'Brain approval requested'));
  } catch (err) {
    console.error('[DocsPickup] request-filing error:', err);
    return res.status(500).json(ApiResponse.error('Failed to request filing', 'SERVER_ERROR', 500));
  }
});

router.post('/filing/:receipt/approve', async (req, res) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json(ApiResponse.error('Only a super_admin can approve internal-doc filing', 'FORBIDDEN', 403));
  }
  try {
    const result = await docsFiling.approveFilingRequest(req.params.receipt, getUserMeta(req), req.body?.note);
    if (!result.ok) return res.status(400).json(ApiResponse.error(result.error, 'VALIDATION_ERROR', 400));
    return res.json(ApiResponse.success(result, 'Filing request approved'));
  } catch (err) {
    console.error('[DocsPickup] approve error:', err);
    return res.status(500).json(ApiResponse.error('Approve failed', 'SERVER_ERROR', 500));
  }
});

router.post('/filing/:receipt/reject', async (req, res) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json(ApiResponse.error('Only a super_admin can reject internal-doc filing', 'FORBIDDEN', 403));
  }
  try {
    const result = await docsFiling.rejectFilingRequest(req.params.receipt, getUserMeta(req), req.body?.note);
    if (!result.ok) return res.status(400).json(ApiResponse.error(result.error, 'VALIDATION_ERROR', 400));
    return res.json(ApiResponse.success(result, 'Filing request rejected'));
  } catch (err) {
    console.error('[DocsPickup] reject error:', err);
    return res.status(500).json(ApiResponse.error('Reject failed', 'SERVER_ERROR', 500));
  }
});

router.post('/filing/:receipt/file', async (req, res) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json(ApiResponse.error('Only a super_admin can file documents', 'FORBIDDEN', 403));
  }
  try {
    const result = await docsFiling.fileApprovedRequest(req.params.receipt, getUserMeta(req), {
      overrideTargetPath: req.body?.targetPath,
    });
    if (!result.ok) return res.status(400).json(ApiResponse.error(result.error, 'VALIDATION_ERROR', 400));
    return res.json(ApiResponse.success(result, 'Document filed'));
  } catch (err) {
    console.error('[DocsPickup] file error:', err);
    return res.status(500).json(ApiResponse.error('Filing failed', 'SERVER_ERROR', 500));
  }
});

router.post('/bulk', async (req, res) => {
  try {
    const action = String(req.body?.action || '').toLowerCase();
    const ids = req.body?.ids;
    const note = req.body?.note;

    if (!docsPickup.BULK_ACTIONS.has(action)) {
      return res.status(400).json(ApiResponse.error(
        'Invalid action. Allowed: view, pick_up, archive, restore, delete, note',
        'VALIDATION_ERROR',
        400,
      ));
    }

    const actor = getUserMeta(req);
    const result = await docsPickup.bulkAction(ids, action, actor, { note });
    return res.json(ApiResponse.success(result, 'Bulk action completed'));
  } catch (err) {
    if (err.message === 'IDS_REQUIRED') {
      return res.status(400).json(ApiResponse.error('ids array is required', 'VALIDATION_ERROR', 400));
    }
    if (err.message === 'IDS_LIMIT') {
      return res.status(400).json(ApiResponse.error('Too many ids (max 200)', 'VALIDATION_ERROR', 400));
    }
    if (err.message === 'NOTE_REQUIRED') {
      return res.status(400).json(ApiResponse.error('note is required for note action', 'VALIDATION_ERROR', 400));
    }
    console.error('[DocsPickup] bulk error:', err);
    return res.status(500).json(ApiResponse.error('Bulk action failed', 'SERVER_ERROR', 500));
  }
});

router.post('/bulk/download', async (req, res) => {
  try {
    const ids = req.body?.ids;
    const actor = getUserMeta(req);
    const { files, skipped } = await docsPickup.resolveBulkDownloadFiles(ids);

    res.setHeader('X-Docs-Pickup-Downloaded', String(files.length));
    res.setHeader('X-Docs-Pickup-Skipped', String(skipped.length));
    res.setHeader('Access-Control-Expose-Headers', 'X-Docs-Pickup-Downloaded, X-Docs-Pickup-Skipped');

    if (files.length === 1) {
      const { row, filePath } = files[0];
      await docsPickup.recordDownload(row.id, actor);
      return res.download(filePath, row.original_file_name);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="docs-pickup-${stamp}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('[DocsPickup] bulk download zip error:', err);
      if (!res.headersSent) {
        res.status(500).json(ApiResponse.error('Zip creation failed', 'SERVER_ERROR', 500));
      }
    });
    archive.pipe(res);

    const usedNames = new Map();
    for (const { row, filePath } of files) {
      let entryName = row.original_file_name || row.file_name;
      const count = usedNames.get(entryName) || 0;
      if (count > 0) {
        const ext = path.extname(entryName);
        const base = path.basename(entryName, ext);
        entryName = `${base}-${count + 1}${ext}`;
      }
      usedNames.set(row.original_file_name || row.file_name, count + 1);
      archive.file(filePath, { name: entryName });
      await docsPickup.recordDownload(row.id, actor);
    }

    await archive.finalize();

    if (skipped.length > 0) {
      console.log(`[DocsPickup] bulk download skipped ${skipped.length} files`);
    }
  } catch (err) {
    if (err.message === 'IDS_REQUIRED' || err.message === 'NO_DOWNLOADABLE') {
      return res.status(400).json(ApiResponse.error(
        err.message === 'IDS_REQUIRED' ? 'ids array is required' : 'No downloadable files',
        'VALIDATION_ERROR',
        400,
      ));
    }
    if (err.message === 'IDS_LIMIT') {
      return res.status(400).json(ApiResponse.error('Too many ids (max 100)', 'VALIDATION_ERROR', 400));
    }
    console.error('[DocsPickup] bulk download error:', err);
    return res.status(500).json(ApiResponse.error('Bulk download failed', 'SERVER_ERROR', 500));
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

    const originalName = docsPickup.sanitizeOriginalName(req.file.originalname);
    const check = docsPickup.validateExtension(originalName);
    if (!check.ok) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json(ApiResponse.error(check.reason, 'VALIDATION_ERROR', 400));
    }

    const id = path.basename(req.file.filename, check.ext);
    const storageRelative = `files/${req.file.filename}`;
    const saver = getUserMeta(req);
    const description = typeof req.body?.description === 'string'
      ? req.body.description.slice(0, 500)
      : null;

    const { getAppPool } = require('../config/db');
    const pool = getAppPool();
    const sha256 = docsPickup.sha256File(req.file.path);

    await docsPickup.insertFileRecord(pool, {
      id,
      fileName: req.file.filename,
      originalFileName: originalName,
      storagePath: storageRelative,
      agentPath: `${docsPickup.AGENT_PATH_PREFIX}/${storageRelative}`,
      description,
      status: 'waiting',
      savedBy: saver,
      savedAt: new Date().toISOString(),
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype || docsPickup.guessMime(check.ext),
      sha256,
      source: 'api_upload',
    }, saver);

    const row = await docsPickup.getFileById(id);
    console.log(`[DocsPickup] upload id=${id} user=${saver.id} file=${originalName}`);
    return res.status(201).json(ApiResponse.success({ file: docsPickup.rowToApi(row) }, 'File saved for pickup'));
  } catch (err) {
    console.error('[DocsPickup] upload error:', err);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    const message = err.message || 'Upload failed';
    return res.status(500).json(ApiResponse.error(message, 'UPLOAD_ERROR', 500));
  }
});

router.get('/download/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const row = await docsPickup.getFileById(id);
    if (!row || row.status === 'deleted') {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }

    const filePath = docsPickup.getAbsoluteFilePath(row);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json(ApiResponse.error('File not found on disk', 'NOT_FOUND', 404));
    }

    const actor = getUserMeta(req);
    await docsPickup.recordDownload(id, actor);

    return res.download(filePath, row.original_file_name);
  } catch (err) {
    console.error('[DocsPickup] download error:', err);
    return res.status(500).json(ApiResponse.error('Download failed', 'SERVER_ERROR', 500));
  }
});

router.get('/preview/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const preview = await docsPickup.buildPreview(id);
    // `peek` = passive hover preview: do not mark the file as viewed.
    const peek = req.query.peek === '1' || req.query.peek === 'true';
    if (!peek) {
      const actor = getUserMeta(req);
      try {
        await docsPickup.markViewed(id, actor);
      } catch {
        // non-fatal for preview
      }
    }

    return res.json(ApiResponse.success(preview));
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }
    if (err.message === 'PREVIEW_UNSUPPORTED') {
      return res.status(400).json(ApiResponse.error('Preview not available for this file type', 'VALIDATION_ERROR', 400));
    }
    console.error('[DocsPickup] preview error:', err);
    return res.status(500).json(ApiResponse.error('Preview failed', 'SERVER_ERROR', 500));
  }
});

router.get('/:id/audit', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await docsPickup.getFileById(id);
    if (!row) {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }
    const events = await docsPickup.getAuditEvents(id);
    return res.json(ApiResponse.success({ fileId: id, events }));
  } catch (err) {
    console.error('[DocsPickup] audit error:', err);
    return res.status(500).json(ApiResponse.error('Failed to load audit', 'SERVER_ERROR', 500));
  }
});

router.post('/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const file = await docsPickup.markViewed(id, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Marked as viewed'));
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }
    console.error('[DocsPickup] view error:', err);
    return res.status(500).json(ApiResponse.error('Failed to mark viewed', 'SERVER_ERROR', 500));
  }
});

router.post('/:id/pickup', async (req, res) => {
  try {
    const { id } = req.params;
    const file = await docsPickup.markPickedUp(id, getUserMeta(req));
    console.log(`[DocsPickup] picked up id=${id}`);
    return res.json(ApiResponse.success({ file }, 'Marked as picked up'));
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }
    console.error('[DocsPickup] pickup error:', err);
    return res.status(500).json(ApiResponse.error('Pickup failed', 'SERVER_ERROR', 500));
  }
});

router.post('/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;
    const file = await docsPickup.archiveFile(id, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Archived'));
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }
    console.error('[DocsPickup] archive error:', err);
    return res.status(500).json(ApiResponse.error('Archive failed', 'SERVER_ERROR', 500));
  }
});

router.post('/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    const file = await docsPickup.restoreFile(id, getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Restored'));
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }
    if (err.message === 'INVALID_STATUS') {
      return res.status(400).json(ApiResponse.error('File is not archived or deleted', 'VALIDATION_ERROR', 400));
    }
    console.error('[DocsPickup] restore error:', err);
    return res.status(500).json(ApiResponse.error('Restore failed', 'SERVER_ERROR', 500));
  }
});

router.post('/:id/note', async (req, res) => {
  try {
    const { id } = req.params;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) {
      return res.status(400).json(ApiResponse.error('Note is required', 'VALIDATION_ERROR', 400));
    }
    const file = await docsPickup.addNote(id, note.slice(0, 2000), getUserMeta(req));
    return res.json(ApiResponse.success({ file }, 'Note added'));
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }
    console.error('[DocsPickup] note error:', err);
    return res.status(500).json(ApiResponse.error('Failed to add note', 'SERVER_ERROR', 500));
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await docsPickup.softDeleteFile(id, getUserMeta(req));
    console.log(`[DocsPickup] soft-delete id=${id}`);
    return res.json(ApiResponse.success({ id }, 'File soft-deleted (retained on disk)'));
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json(ApiResponse.error('File not found', 'NOT_FOUND', 404));
    }
    console.error('[DocsPickup] delete error:', err);
    return res.status(500).json(ApiResponse.error('Delete failed', 'SERVER_ERROR', 500));
  }
});

module.exports = router;
