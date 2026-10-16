'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const documentService = require('../services/om-documents/documentService');
const storage = require('../services/om-documents/DocumentStorageService');
const filing = require('../services/om-documents/documentFilingService');
const { WORKING_HORIZONS } = require('../services/om-documents/plansPaths');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 20 },
});

function actorFromReq(req) {
  const u = req.user || req.session?.user || {};
  return {
    id: u.id || u.userId || null,
    email: u.email || null,
    name: u.name || u.displayName || u.username || null,
  };
}

function isSuperAdmin(req) {
  const role = String(
    req.session?.user?.role || req.user?.role || req.user?.user_role || '',
  ).toLowerCase();
  return role === 'super_admin';
}

function sendError(res, err) {
  const code = err.code || err.message;
  const map = {
    NOT_FOUND: 404,
    PATH_TRAVERSAL: 400,
    INVALID_EXTENSION: 400,
    INVALID_LIFECYCLE: 400,
    INVALID_PRODUCER: 400,
    INVALID_HORIZON: 400,
    INVALID_DOCUMENT_ID: 400,
    INVALID_CATEGORY: 400,
    INVALID_TARGET: 400,
    MUST_BE_INTERNAL: 400,
    CATEGORY_PATH_MISMATCH: 400,
    SECRET_SCAN_BLOCKED: 422,
    NOT_APPROVED: 409,
    CHECKSUM_MISMATCH: 409,
    INVALID_STATUS: 409,
    NOT_MARKDOWN: 400,
    NOT_EDITABLE: 400,
    PACKAGE_MISSING: 404,
    PACKAGE_EXISTS: 409,
    TARGET_EXISTS: 409,
    CONTENT_REQUIRED: 400,
  };
  const status = map[code] || 500;
  const body = { error: code, message: err.message };
  if (err.secrets) body.secrets = err.secrets;
  if (status === 500) console.error('[om-documents]', err);
  return res.status(status).json(body);
}

router.get('/', async (req, res) => {
  try {
    const result = await documentService.listDocuments({
      lifecycle: req.query.lifecycle || req.query.tab || null,
      source: req.query.source || null,
      q: req.query.q || req.query.search || null,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/meta/horizons', (_req, res) => {
  res.json({ success: true, horizons: [...WORKING_HORIZONS] });
});

router.get('/meta/filing-categories', (_req, res) => {
  res.json({ success: true, categories: filing.listCategories() });
});

router.get('/filing/waiting-to-file', async (_req, res) => {
  try {
    const rows = await filing.listWaitingToFile();
    res.json({ success: true, items: rows });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/reconcile', async (req, res) => {
  try {
    const report = await documentService.reconcile(
      { includeAllLifecycles: req.body?.includeAllLifecycles !== false },
      actorFromReq(req),
    );
    res.json({ success: true, report });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'attachments', maxCount: 19 },
]), async (req, res) => {
  try {
    const title = req.body.title || req.files?.file?.[0]?.originalname || 'Untitled';
    const primary = req.files?.file?.[0];
    let content;
    let primaryFileName = 'document.md';
    if (primary) {
      const check = storage.validateExtension(primary.originalname);
      if (!check.ok) {
        return res.status(400).json({ error: 'INVALID_EXTENSION', message: check.reason });
      }
      content = primary.buffer;
      primaryFileName = primary.originalname;
    } else if (req.body.content != null) {
      content = req.body.content;
      primaryFileName = req.body.primaryFileName || 'document.md';
    } else {
      return res.status(400).json({ error: 'CONTENT_REQUIRED', message: 'file or content required' });
    }
    const attachments = (req.files?.attachments || []).map((f) => ({
      name: f.originalname,
      buffer: f.buffer,
    }));
    const doc = await documentService.createDocument({
      title,
      description: req.body.description || null,
      producer: req.body.producer || 'manual',
      source: req.body.source || null,
      content,
      primaryFileName,
      attachments,
      parentDocumentId: req.body.parentDocumentId || null,
      relatedDispatchId: req.body.relatedDispatchId || null,
      actor: actorFromReq(req),
    });
    res.status(201).json({ success: true, document: doc });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/paste', async (req, res) => {
  try {
    const title = req.body.title || 'Untitled';
    const content = req.body.content ?? req.body.text ?? '';
    if (!String(content).trim()) {
      return res.status(400).json({ error: 'CONTENT_REQUIRED', message: 'content required' });
    }
    const doc = await documentService.createDocument({
      title,
      description: req.body.description || null,
      producer: 'manual',
      source: 'HUMAN',
      content: String(content),
      primaryFileName: 'document.md',
      actor: actorFromReq(req),
    });
    res.status(201).json({ success: true, document: doc });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await documentService.getByDocumentId(req.params.id);
    if (!doc || doc.deletedAt) return res.status(404).json({ error: 'NOT_FOUND' });
    const audit = await documentService.listAudit(doc.documentId, 50);
    res.json({ success: true, document: doc, audit });
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const doc = await documentService.updateDocument(req.params.id, req.body || {}, actorFromReq(req));
    res.json({ success: true, document: doc });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/move', async (req, res) => {
  try {
    const { lifecycle, horizon, producer } = req.body || {};
    if (!lifecycle) return res.status(400).json({ error: 'LIFECYCLE_REQUIRED' });
    const doc = await documentService.moveDocument(
      req.params.id,
      { lifecycle, horizon, producer },
      actorFromReq(req),
    );
    res.json({ success: true, document: doc });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/archive', async (req, res) => {
  try {
    const doc = await documentService.archiveDocument(req.params.id, actorFromReq(req));
    res.json({ success: true, document: doc });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/quarantine', async (req, res) => {
  try {
    const doc = await documentService.quarantineDocument(
      req.params.id,
      req.body?.reason || 'manual',
      actorFromReq(req),
    );
    res.json({ success: true, document: doc });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:id/file', async (req, res) => {
  try {
    const result = await documentService.readContent(
      req.params.id,
      { markViewed: true },
      actorFromReq(req),
    );
    res.json({
      success: true,
      document: result.document,
      content: result.text,
      primaryFile: result.primaryFile,
      sizeBytes: result.sizeBytes,
      secretWarnings: result.secretWarnings,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/:id/file', async (req, res) => {
  try {
    const doc = await documentService.writeContent(
      req.params.id,
      req.body?.content ?? '',
      actorFromReq(req),
    );
    res.json({ success: true, document: doc });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const file = await documentService.markDownloaded(req.params.id, actorFromReq(req));
    const doc = await documentService.getByDocumentId(req.params.id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(doc.primaryFile || 'document')}"`,
    );
    res.send(file.buffer);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/attachments', upload.array('attachments', 19), async (req, res) => {
  try {
    const doc = await documentService.getByDocumentId(req.params.id);
    if (!doc || doc.deletedAt) return res.status(404).json({ error: 'NOT_FOUND' });
    const added = [];
    for (const f of req.files || []) {
      added.push(storage.addAttachment(doc.relativePath, f.originalname, f.buffer));
    }
    res.json({ success: true, attachments: added });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/dispatch', async (req, res) => {
  try {
    // Lightweight stub that records intent; PR-C wires full docsDispatchService.
    const doc = await documentService.getByDocumentId(req.params.id);
    if (!doc || doc.deletedAt) return res.status(404).json({ error: 'NOT_FOUND' });
    let dispatchResult = null;
    try {
      const docsDispatchService = require('../services/docsDispatchService');
      if (typeof docsDispatchService.sendDocumentToAgent === 'function') {
        dispatchResult = await docsDispatchService.sendDocumentToAgent(doc, {
          ...req.body,
          actor: actorFromReq(req),
        });
      } else if (typeof docsDispatchService.sendToAgent === 'function') {
        // Compatibility: attempt legacy signature with plans path in metadata
        dispatchResult = {
          deferred: true,
          message: 'Use PR-C sendDocumentToAgent; legacy sendToAgent retained for dropbox ids',
          documentId: doc.documentId,
          plansPath: doc.physicalPath,
        };
      }
    } catch (e) {
      dispatchResult = {
        deferred: true,
        documentId: doc.documentId,
        plansPath: doc.physicalPath,
        note: e.message,
      };
    }
    await documentService.recordAudit(doc.documentId, 'dispatch_requested', actorFromReq(req), {
      plansPath: doc.physicalPath,
      result: dispatchResult,
    });
    res.json({ success: true, document: doc, dispatch: dispatchResult });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/filing/request', async (req, res) => {
  try {
    const result = await filing.createFilingRequest(req.params.id, {
      category: req.body?.category,
      targetPath: req.body?.targetPath || req.body?.proposed_target_docs_path,
      reason: req.body?.reason,
      requestSource: req.body?.requestSource || 'om_documents_ui',
      actor: actorFromReq(req),
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/filing/approve', async (req, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
    const doc = await documentService.getByDocumentId(req.params.id);
    if (!doc?.filingReceipt) return res.status(404).json({ error: 'NO_FILING_REQUEST' });
    const result = await filing.decideFiling(doc.filingReceipt, 'approve', {
      note: req.body?.note,
      actor: actorFromReq(req),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/filing/reject', async (req, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
    const doc = await documentService.getByDocumentId(req.params.id);
    if (!doc?.filingReceipt) return res.status(404).json({ error: 'NO_FILING_REQUEST' });
    const result = await filing.decideFiling(doc.filingReceipt, 'reject', {
      note: req.body?.note,
      actor: actorFromReq(req),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/filing/file', async (req, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
    const doc = await documentService.getByDocumentId(req.params.id);
    if (!doc?.filingReceipt) return res.status(404).json({ error: 'NO_FILING_REQUEST' });
    const result = await filing.fileApprovedRequest(doc.filingReceipt, actorFromReq(req));
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/filing/:receipt/approve', async (req, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
    const result = await filing.decideFiling(req.params.receipt, 'approve', {
      note: req.body?.note,
      actor: actorFromReq(req),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/filing/:receipt/reject', async (req, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
    const result = await filing.decideFiling(req.params.receipt, 'reject', {
      note: req.body?.note,
      actor: actorFromReq(req),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/filing/:receipt/file', async (req, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
    const result = await filing.fileApprovedRequest(req.params.receipt, actorFromReq(req));
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
