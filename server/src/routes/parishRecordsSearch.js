/**
 * Governed Parish Records Search API
 *
 * POST   /api/parish-records/search/parse
 * POST   /api/parish-records/search/execute
 * POST   /api/parish-records/search/count
 * POST   /api/parish-records/search/export
 * GET    /api/parish-records/search/exports/:jobId
 * GET    /api/parish-records/search/saved-searches
 * POST   /api/parish-records/search/saved-searches
 * GET    /api/parish-records/search/saved-searches/:id
 * PATCH  /api/parish-records/search/saved-searches/:id
 * DELETE /api/parish-records/search/saved-searches/:id
 * POST   /api/parish-records/search/saved-searches/:id/run
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { canExportData, canManageRecords, canDeleteDuplicateRecords, canRestoreDeletedRecords, canPermanentDeleteRecords, hasRole } = require('../utils/roles');
const {
  parseQuery, executeAst, countAst, AstValidationError, ChurchContextError,
} = require('../services/parishRecordsSearch/searchService');
const { resolveAuthorizedChurchId, getTenantConnection } = require('../services/parishRecordsSearch/churchContext');
const { exportSearch } = require('../services/parishRecordsSearch/exportService');
const {
  listSavedSearches, getSavedSearch, createSavedSearch,
  updateSavedSearch, deleteSavedSearch, touchRun,
} = require('../services/parishRecordsSearch/savedSearchRepo');
const { getAppPool } = require('../config/db-compat');
const { MAX_EXPORT_SYNC_ROWS } = require('../services/parishRecordsSearch/recordFieldRegistry');
const { saveReview } = require('../services/parishRecordsSearch/duplicateReviewRepo');
const {
  previewDuplicateRemoval, executeDuplicateRemoval, restoreDeletedRecords, permanentDeleteRecords,
  DuplicateRemovalError,
  resolveDuplicateGroup,
} = require('../services/parishRecordsSearch/duplicateRemovalService');
const { logParishSearchEvent } = require('../services/parishRecordsSearch/audit');
const { randomUUID } = require('crypto');

function sendError(res, err) {
  const status = err.status || (err instanceof AstValidationError ? 400 : 500);
  const code = err.code || 'search_error';
  if (status >= 500) console.error('[parish-records-search]', err);
  return res.status(status).json({
    success: false,
    error: code,
    message: err.message,
    details: err.details || undefined,
  });
}

function getUser(req) {
  return req.user || req.session?.user || {};
}

function isParishAdmin(user) {
  return hasRole(user, 'church_admin') || hasRole(user, 'admin');
}

function requireExportCapability(req, res) {
  const user = getUser(req);
  if (!canExportData(user)) {
    res.status(403).json({
      success: false,
      error: 'forbidden',
      message: 'Export requires deacon role or higher',
    });
    return null;
  }
  return user;
}

router.post('/parse', requireAuth, async (req, res) => {
  try {
    const { query, churchId, clarificationAnswers } = req.body || {};
    const result = await parseQuery(req, { query, churchId, clarificationAnswers });
    res.json({
      success: true,
      data: {
        ast: result.ast,
        interpretation: result.interpretation,
        clarifications: result.clarifications,
        confidence: result.confidence,
        exportIntent: result.exportIntent,
        rawQuery: result.rawQuery,
        churchId: result.churchId,
      },
    });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/execute', requireAuth, async (req, res) => {
  try {
    const ast = req.body?.ast || req.body;
    const result = await executeAst(req, ast);
    res.json({
      success: true,
      data: {
        executionId: result.executionId,
        mode: result.mode,
        rows: result.rows,
        groups: result.groups,
        totalAffectedRecords: result.totalAffectedRecords,
        preset: result.preset,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        durationMs: result.durationMs,
        ast: result.ast,
        unsupported: result.unsupported || null,
        activityWindow: result.activityWindow || null,
        workflowIntent: result.workflowIntent || result.ast?.workflowIntent || null,
      },
    });
  } catch (err) {
    return sendError(res, err);
  }
});

router.put('/duplicate-reviews/:signature', requireAuth, async (req, res) => {
  try {
    if (!canManageRecords(getUser(req))) return res.status(403).json({ success: false, error: 'forbidden', message: 'Duplicate review requires record-management permission' });
    const body = req.body || {};
    const { churchId, user } = await resolveAuthorizedChurchId(req, body.churchId);
    const signature = String(req.params.signature || '');
    if (!/^[a-f0-9]{64}$/.test(signature)) return res.status(400).json({ success: false, error: 'invalid_signature', message: 'Invalid duplicate group signature' });
    const result = await saveReview({ churchId, signature, recordType: body.recordType, recordIds: Array.isArray(body.recordIds) ? body.recordIds : [], classification: body.classification, status: body.reviewStatus, notes: body.notes, userId: user.id });
    res.json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

router.post('/duplicate-groups/:signature/preview-removal', requireAuth, async (req, res) => {
  try {
    if (!canDeleteDuplicateRecords(getUser(req))) {
      return res.status(403).json({ success: false, error: 'forbidden', message: 'Duplicate removal requires priest role or higher' });
    }
    const body = req.body || {};
    const { churchId, user } = await resolveAuthorizedChurchId(req, body.churchId);
    const pool = await getTenantConnection(churchId);
    await logParishSearchEvent('duplicate_deletion_initiated', {
      churchId, userId: user.id, executionId: randomUUID(),
      meta: { signature: req.params.signature, survivorId: body.survivorId, removeIds: body.removeIds, recordType: body.recordType },
    });
    const preview = await previewDuplicateRemoval(pool, {
      churchId,
      recordType: body.recordType,
      survivorId: body.survivorId,
      removeIds: body.removeIds,
      user,
    });
    res.json({ success: true, data: { ...preview, recommendedSurvivorId: preview.recommendedSurvivorId, recommendedLabel: 'Recommended record to keep' } });
  } catch (err) {
    if (err instanceof DuplicateRemovalError) return sendError(res, err);
    return sendError(res, err);
  }
});

router.post('/duplicate-groups/:signature/remove', requireAuth, async (req, res) => {
  try {
    if (!canDeleteDuplicateRecords(getUser(req))) {
      return res.status(403).json({ success: false, error: 'forbidden', message: 'Duplicate removal requires priest role or higher' });
    }
    const body = req.body || {};
    const { churchId, user } = await resolveAuthorizedChurchId(req, body.churchId);
    const signature = String(req.params.signature || '');
    const pool = await getTenantConnection(churchId);
    const result = await executeDuplicateRemoval(pool, {
      churchId,
      recordType: body.recordType,
      survivorId: body.survivorId,
      removeIds: body.removeIds,
      user,
      reason: body.reason,
      confirmationPhrase: body.confirmationPhrase,
      acknowledgeMissingData: Boolean(body.acknowledgeMissingData),
      requestId: body.requestId || randomUUID(),
      signature,
    });
    if (body.updateReview !== false) {
      try {
        await saveReview({
          churchId,
          signature,
          recordType: body.recordType,
          recordIds: [result.survivorId, ...result.removedIds],
          classification: body.classification || 'Exact duplicate',
          status: 'confirmed_duplicate',
          notes: body.notes || `Soft-deleted duplicates; survivor #${result.survivorId}`,
          userId: user.id,
        });
      } catch (_) { /* review attach best-effort */ }
    }
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof DuplicateRemovalError) return sendError(res, err);
    return sendError(res, err);
  }
});

router.post('/duplicate-groups/:signature/resolve', requireAuth, async (req, res) => {
  try {
    if (!canDeleteDuplicateRecords(getUser(req))) return res.status(403).json({ success: false, error: 'forbidden', message: 'Duplicate resolution requires priest role or higher' });
    const body = req.body || {};
    const { churchId, user } = await resolveAuthorizedChurchId(req, body.churchId);
    const pool = await getTenantConnection(churchId);
    const result = await resolveDuplicateGroup(pool, {
      churchId, signature: String(req.params.signature || ''), recordType: body.recordType,
      keepRecordId: body.keepRecordId, removeRecordIds: body.removeRecordIds, user,
      reviewNotes: body.reviewNotes, reason: body.reason, requestId: body.requestId || randomUUID(),
    });
    await logParishSearchEvent('duplicate_group_resolved', { churchId, userId: user.id, executionId: body.requestId, meta: result }).catch((error) => console.error('[duplicate-resolution-audit]', error));
    res.json({ success: true, data: { ...result, message: `Duplicate group resolved. ${result.recordType} #${result.keepRecordId} was kept and ${result.removedRecordIds.length} duplicate(s) were removed.` } });
  } catch (err) { return sendError(res, err); }
});

router.post('/duplicate-groups/:signature/not-duplicates', requireAuth, async (req, res) => {
  try {
    if (!canManageRecords(getUser(req))) return res.status(403).json({ success: false, error: 'forbidden', message: 'Duplicate review requires record-management permission' });
    const body = req.body || {};
    const { churchId, user } = await resolveAuthorizedChurchId(req, body.churchId);
    const signature = String(req.params.signature || '');
    if (!/^[a-f0-9]{64}$/.test(signature)) return res.status(400).json({ success: false, error: 'invalid_signature', message: 'Invalid duplicate group signature' });
    const rawIds = [...new Set(body.recordIds || [])];
    const { signature: buildSignature } = require('../services/parishRecordsSearch/duplicateService');
    const ids = body.recordType === 'cross_record' ? rawIds.map(String).filter((id) => /^(baptism|marriage|funeral):\d+$/.test(id)) : rawIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    const expectedSignature = body.recordType === 'cross_record'
      ? require('crypto').createHash('sha256').update(`${churchId}|person|${[...ids].sort().join(',')}`).digest('hex')
      : buildSignature(churchId, body.recordType, ids);
    if (expectedSignature !== signature) return res.status(409).json({ success: false, error: 'records_outside_duplicate_group', message: 'The supplied records do not belong to this duplicate group' });
    const result = await saveReview({ churchId, signature, recordType: body.recordType, recordIds: ids, classification: body.classification || 'Reviewed candidate', status: 'not_a_duplicate', notes: body.reviewNotes, userId: user.id });
    res.json({ success: true, data: { ...result, resolutionDecision: 'not_duplicates' } });
  } catch (err) { return sendError(res, err); }
});

router.post('/records/restore', requireAuth, async (req, res) => {
  try {
    if (!canRestoreDeletedRecords(getUser(req))) {
      return res.status(403).json({ success: false, error: 'forbidden', message: 'Restore requires priest role or higher' });
    }
    const body = req.body || {};
    const { churchId, user } = await resolveAuthorizedChurchId(req, body.churchId);
    const pool = await getTenantConnection(churchId);
    const result = await restoreDeletedRecords(pool, {
      churchId,
      recordType: body.recordType,
      recordIds: body.recordIds,
      user,
      reason: body.reason,
      requestId: randomUUID(),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof DuplicateRemovalError) return sendError(res, err);
    return sendError(res, err);
  }
});

router.post('/records/permanent-delete', requireAuth, async (req, res) => {
  try {
    if (!canPermanentDeleteRecords(getUser(req))) {
      return res.status(403).json({ success: false, error: 'forbidden', message: 'Permanent deletion requires church_admin or higher' });
    }
    const body = req.body || {};
    const { churchId, user } = await resolveAuthorizedChurchId(req, body.churchId);
    const pool = await getTenantConnection(churchId);
    const result = await permanentDeleteRecords(pool, {
      churchId,
      recordType: body.recordType,
      recordIds: body.recordIds,
      user,
      confirmationPhrase: body.confirmationPhrase,
      secondConfirmationPhrase: body.secondConfirmationPhrase,
      reason: body.reason,
      requestId: randomUUID(),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof DuplicateRemovalError) return sendError(res, err);
    return sendError(res, err);
  }
});

router.post('/count', requireAuth, async (req, res) => {
  try {
    const ast = req.body?.ast || req.body;
    const result = await countAst(req, ast);
    res.json({ success: true, data: result });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/export', requireAuth, async (req, res) => {
  try {
    if (!requireExportCapability(req, res)) return;
    const { ast, format = 'xlsx', includeQuerySummary = true, async: forceAsync } = req.body || {};
    if (!ast) {
      return res.status(400).json({ success: false, error: 'ast_required', message: 'ast is required' });
    }

    if (forceAsync) {
      const { churchId, user } = await resolveAuthorizedChurchId(req, ast?.scope?.churchId);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const filterJson = JSON.stringify({ source: 'parish_search', ast, format, includeQuerySummary });
      const [result] = await getAppPool().query(
        `INSERT INTO export_jobs (church_id, user_id, export_type, record_type, filter_json, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [churchId, user.id, format === 'excel' ? 'xlsx' : format, 'parish_search', filterJson, expiresAt],
      );
      return res.status(202).json({
        success: true,
        async: true,
        jobId: result.insertId,
        message: `Export queued (sync limit ${MAX_EXPORT_SYNC_ROWS} rows)`,
      });
    }

    try {
      const out = await exportSearch(req, { ast, format, includeQuerySummary });
      res.setHeader('Content-Type', out.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
      res.setHeader('X-Parish-Export-Count', String(out.count));
      res.setHeader('X-Parish-Execution-Id', out.executionId);
      return res.send(out.buffer);
    } catch (err) {
      if (err.code === 'export_too_large') {
        const { churchId, user } = await resolveAuthorizedChurchId(req, ast?.scope?.churchId);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const filterJson = JSON.stringify({ source: 'parish_search', ast, format, includeQuerySummary });
        const [result] = await getAppPool().query(
          `INSERT INTO export_jobs (church_id, user_id, export_type, record_type, filter_json, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [churchId, user.id, format === 'excel' ? 'xlsx' : format, 'parish_search', filterJson, expiresAt],
        );
        return res.status(202).json({
          success: true,
          async: true,
          jobId: result.insertId,
          message: err.message,
        });
      }
      throw err;
    }
  } catch (err) {
    return sendError(res, err);
  }
});

router.get('/exports/:jobId', requireAuth, async (req, res) => {
  try {
    if (!requireExportCapability(req, res)) return;
    const user = getUser(req);
    const jobId = Number(req.params.jobId);
    const [rows] = await getAppPool().query(
      `SELECT id, church_id, user_id, export_type, status, record_type, record_count,
              file_size_bytes, created_at, completed_at, expires_at, error_message, filter_json
       FROM export_jobs WHERE id = ? LIMIT 1`,
      [jobId],
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'not_found', message: 'Export job not found' });
    }
    const job = rows[0];
    if (Number(job.user_id) !== Number(user.id) && !isParishAdmin(user)) {
      return res.status(403).json({ success: false, error: 'forbidden', message: 'Not your export job' });
    }
    await resolveAuthorizedChurchId(req, job.church_id);
    let filter = job.filter_json;
    if (typeof filter === 'string') {
      try { filter = JSON.parse(filter); } catch { filter = null; }
    }
    res.json({
      success: true,
      data: {
        id: job.id,
        status: job.status,
        exportType: job.export_type,
        recordCount: job.record_count,
        createdAt: job.created_at,
        completedAt: job.completed_at,
        errorMessage: job.error_message,
        source: filter?.source || null,
      },
    });
  } catch (err) {
    return sendError(res, err);
  }
});

router.get('/saved-searches', requireAuth, async (req, res) => {
  try {
    const requested = req.query.churchId != null ? Number(req.query.churchId) : null;
    const { churchId, user } = await resolveAuthorizedChurchId(req, requested);
    const items = await listSavedSearches({
      churchId,
      userId: user.id,
      isAdmin: isParishAdmin(user),
    });
    res.json({ success: true, data: items });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/saved-searches', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const { churchId, user } = await resolveAuthorizedChurchId(req, body.churchId ?? body.queryAst?.scope?.churchId);
    if (body.visibility && body.visibility !== 'private' && !canExportData(user)) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Sharing saved searches requires deacon role or higher',
      });
    }
    const created = await createSavedSearch({
      churchId,
      userId: user.id,
      name: body.name || 'Untitled search',
      description: body.description,
      queryAst: body.queryAst || body.ast,
      visibility: body.visibility || 'private',
      exportConfig: body.exportConfig,
      pinned: !!body.pinned,
    });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    return sendError(res, err);
  }
});

router.get('/saved-searches/:id', requireAuth, async (req, res) => {
  try {
    const { churchId, user } = await resolveAuthorizedChurchId(req, req.query.churchId);
    const item = await getSavedSearch(Number(req.params.id), {
      churchId, userId: user.id, isAdmin: isParishAdmin(user),
    });
    if (!item) return res.status(404).json({ success: false, error: 'not_found', message: 'Saved search not found' });
    res.json({ success: true, data: item });
  } catch (err) {
    return sendError(res, err);
  }
});

router.patch('/saved-searches/:id', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const { churchId, user } = await resolveAuthorizedChurchId(req, body.churchId);
    if (body.visibility && body.visibility !== 'private' && !canExportData(user)) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Sharing saved searches requires deacon role or higher',
      });
    }
    const updated = await updateSavedSearch(Number(req.params.id), {
      churchId,
      userId: user.id,
      isAdmin: isParishAdmin(user),
      patch: body,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    return sendError(res, err);
  }
});

router.delete('/saved-searches/:id', requireAuth, async (req, res) => {
  try {
    const { churchId, user } = await resolveAuthorizedChurchId(req, req.query.churchId ?? req.body?.churchId);
    const result = await deleteSavedSearch(Number(req.params.id), {
      churchId, userId: user.id, isAdmin: isParishAdmin(user),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    return sendError(res, err);
  }
});

router.post('/saved-searches/:id/run', requireAuth, async (req, res) => {
  try {
    const { churchId, user } = await resolveAuthorizedChurchId(req, req.body?.churchId);
    const saved = await getSavedSearch(Number(req.params.id), {
      churchId, userId: user.id, isAdmin: isParishAdmin(user),
    });
    if (!saved) return res.status(404).json({ success: false, error: 'not_found', message: 'Saved search not found' });
    const ast = {
      ...saved.queryAst,
      scope: { ...saved.queryAst.scope, churchId },
      limit: req.body?.limit ?? saved.queryAst.limit ?? 50,
      offset: req.body?.offset ?? 0,
    };
    const result = await executeAst(req, ast);
    await touchRun(saved.id, { churchId, resultCount: result.total });
    res.json({
      success: true,
      data: {
        savedSearchId: saved.id,
        name: saved.name,
        executionId: result.executionId,
        mode: result.mode,
        rows: result.rows,
        groups: result.groups,
        totalAffectedRecords: result.totalAffectedRecords,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        durationMs: result.durationMs,
        ast: result.ast,
      },
    });
  } catch (err) {
    return sendError(res, err);
  }
});

module.exports = router;
