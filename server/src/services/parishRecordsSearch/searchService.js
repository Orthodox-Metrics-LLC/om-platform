/**
 * Orchestrates parse → validate → plan → execute for parish records search.
 */

const { randomUUID } = require('crypto');
const { parseNaturalLanguage } = require('./nlParser');
const { validateAst, AstValidationError } = require('./astValidator');
const { planUnionQueryAsync } = require('./queryPlanner');
const { normalizeRows, normalizeAggregateRows } = require('./resultNormalizer');
const { applyRelationshipLabels } = require('./relationshipMatcher');
const { resolveAuthorizedChurchId, getTenantConnection, ChurchContextError } = require('./churchContext');
const { logParishSearchEvent } = require('./audit');
const { executeDuplicateDetection } = require('./duplicateService');
const { executeActivitySearch } = require('./activityService');
const { executeDataQualitySearch } = require('./dataQualityService');

async function parseQuery(req, { query, churchId, clarificationAnswers } = {}) {
  const { churchId: authorizedChurchId, user } = await resolveAuthorizedChurchId(req, churchId);
  const parsed = parseNaturalLanguage(query, { churchId: authorizedChurchId });

  // Apply clarification answers (e.g. funeral date field)
  if (parsed.ast && clarificationAnswers?.funeral_date_field) {
    const field = clarificationAnswers.funeral_date_field;
    if (parsed.ast.filters?.conditions) {
      parsed.ast.filters.conditions = parsed.ast.filters.conditions.map((c) => {
        if (c.field === 'canonical_event_date' || c.field === 'burial_date' || c.field === 'deceased_date') {
          return { ...c, field };
        }
        return c;
      });
    }
    parsed.clarifications = (parsed.clarifications || []).filter((c) => c.id !== 'funeral_date_field');
    parsed.confidence = Math.max(parsed.confidence, 0.85);
  }
  if (parsed.ast && clarificationAnswers?.duplicate_mode) {
    parsed.ast.operation.mode = clarificationAnswers.duplicate_mode;
    parsed.clarifications = parsed.clarifications.filter((c) => c.id !== 'duplicate_mode');
    parsed.confidence = Math.max(parsed.confidence, 0.85);
  }
  if (parsed.ast && clarificationAnswers?.activity_event_types) {
    const map = {
      created: ['created'],
      modified: ['modified'],
      imported: ['imported'],
      verified: ['verified'],
      any_activity: ['any_activity'],
      created_or_imported: ['created', 'imported'],
    };
    const key = clarificationAnswers.activity_event_types;
    parsed.ast.activity = {
      ...(parsed.ast.activity || {}),
      eventTypes: map[key] || ['created', 'imported'],
    };
    parsed.clarifications = (parsed.clarifications || []).filter((c) => c.id !== 'activity_event_types');
    parsed.confidence = Math.max(parsed.confidence, 0.85);
  }

  if (parsed.ast) {
    parsed.ast.scope.churchId = authorizedChurchId;
    try {
      parsed.ast = validateAst(parsed.ast);
    } catch (err) {
      if (err instanceof AstValidationError) throw err;
      throw err;
    }
  }

  return {
    ...parsed,
    churchId: authorizedChurchId,
    userId: user?.id || null,
  };
}

async function executeAst(req, rawAst, { skipAudit = false } = {}) {
  const started = Date.now();
  const executionId = randomUUID();
  let ast;
  try {
    ast = validateAst(rawAst);
  } catch (err) {
    throw err;
  }
  const { churchId, user } = await resolveAuthorizedChurchId(req, ast.scope.churchId);
  ast.scope.churchId = churchId;

  const pool = await getTenantConnection(churchId);
  if (ast.operation?.type === 'duplicate_detection') {
    const duplicateResult = await executeDuplicateDetection(pool, ast, churchId);
    const durationMs = Date.now() - started;
    if (!skipAudit) await logParishSearchEvent('duplicate_search_executed', { churchId, userId: user?.id, executionId, meta: { mode: ast.operation.mode, recordTypes: ast.scope.recordTypes, matchLevel: ast.operation.matchLevel, groupCount: duplicateResult.totalGroups, affectedRecordCount: duplicateResult.totalAffectedRecords, durationMs } });
    return { executionId, mode: 'duplicate_detection', rows: [], groups: duplicateResult.groups, total: duplicateResult.totalGroups, totalAffectedRecords: duplicateResult.totalAffectedRecords, preset: duplicateResult.preset, limit: ast.limit, offset: ast.offset, durationMs, ast, workflowIntent: ast.workflowIntent || null };
  }
  if (ast.operation?.type === 'record_activity') {
    const activityResult = await executeActivitySearch(pool, ast, churchId);
    const durationMs = Date.now() - started;
    if (!skipAudit) await logParishSearchEvent('activity_search_executed', { churchId, userId: user?.id, executionId, meta: { eventTypes: ast.activity?.eventTypes, relativeWindow: ast.activity?.relativeWindow, total: activityResult.total, durationMs } });
    return {
      executionId,
      mode: 'record_activity',
      rows: activityResult.rows,
      groups: [],
      total: activityResult.total,
      limit: ast.limit,
      offset: ast.offset,
      durationMs,
      ast,
      activityWindow: activityResult.window,
      unsupported: activityResult.unsupported,
    };
  }
  if (ast.operation?.type === 'data_quality') {
    const dq = await executeDataQualitySearch(pool, ast, churchId);
    const durationMs = Date.now() - started;
    if (!skipAudit) await logParishSearchEvent('data_quality_search_executed', { churchId, userId: user?.id, executionId, meta: { rules: ast.rules, total: dq.total, durationMs, unsupported: Boolean(dq.unsupported) } });
    return {
      executionId,
      mode: 'data_quality',
      rows: dq.rows,
      groups: [],
      total: dq.total,
      limit: ast.limit,
      offset: ast.offset,
      durationMs,
      ast,
      unsupported: dq.unsupported,
    };
  }
  const plan = await planUnionQueryAsync(ast, pool);

  if (plan.mode === 'aggregate') {
    const [rows] = await pool.query(plan.sql, plan.params);
    const durationMs = Date.now() - started;
    if (!skipAudit) {
      await logParishSearchEvent('search_executed', {
        churchId,
        userId: user?.id,
        executionId,
        meta: {
          mode: 'aggregate',
          recordTypes: ast.scope.recordTypes,
          durationMs,
          resultCount: rows.length,
        },
      });
    }
    return {
      executionId,
      mode: 'aggregate',
      rows: normalizeAggregateRows(rows),
      total: rows.length,
      durationMs,
      ast,
    };
  }

  const [[countRow]] = await pool.query(plan.countSql, plan.countParams);
  const total = Number(countRow?.total || 0);
  const [rows] = await pool.query(plan.sql, plan.params);
  let normalized = normalizeRows(rows, churchId);

  if (ast.mode === 'related' || (ast.relationships && ast.relationships.length)) {
    normalized = applyRelationshipLabels(normalized, ast.relationships);
  }

  const durationMs = Date.now() - started;
  if (!skipAudit) {
    await logParishSearchEvent('search_executed', {
      churchId,
      userId: user?.id,
      executionId,
      meta: {
        mode: ast.mode || 'union',
        recordTypes: ast.scope.recordTypes,
        durationMs,
        resultCount: normalized.length,
        total,
        hasTextSearch: Boolean(ast.textSearch),
      },
    });
  }

  return {
    executionId,
    mode: ast.mode || 'union',
    rows: normalized,
    total,
    limit: ast.limit,
    offset: ast.offset,
    durationMs,
    ast,
  };
}

async function countAst(req, rawAst) {
  const ast = validateAst(rawAst);
  const { churchId } = await resolveAuthorizedChurchId(req, ast.scope.churchId);
  ast.scope.churchId = churchId;
  const pool = await getTenantConnection(churchId);
  if (ast.operation?.type === 'duplicate_detection') {
    const result = await executeDuplicateDetection(pool, { ...ast, limit: 100, offset: 0 }, churchId);
    return { total: result.totalGroups, totalAffectedRecords: result.totalAffectedRecords, churchId };
  }
  if (ast.operation?.type === 'record_activity') {
    const result = await executeActivitySearch(pool, ast, churchId);
    return { total: result.total, churchId, unsupported: result.unsupported };
  }
  if (ast.operation?.type === 'data_quality') {
    const result = await executeDataQualitySearch(pool, ast, churchId);
    return { total: result.total, churchId, unsupported: result.unsupported };
  }
  const plan = await planUnionQueryAsync({ ...ast, aggregates: [], groupBy: [] }, pool);
  const [[countRow]] = await pool.query(plan.countSql, plan.countParams);
  return { total: Number(countRow?.total || 0), churchId };
}

module.exports = {
  parseQuery,
  executeAst,
  countAst,
  AstValidationError,
  ChurchContextError,
};
