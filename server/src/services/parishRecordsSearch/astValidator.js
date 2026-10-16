/**
 * Validate parish search query AST against allowlists.
 * Rejects raw SQL fragments, unknown fields/operators, and excessive complexity.
 */

const {
  OPERATORS, LOGICAL_OPS, RECORD_TYPES, DEFAULT_SELECT,
  MAX_PAGE_SIZE, MAX_CONDITION_DEPTH, MAX_CONDITIONS, listRecordTypes,
} = require('./recordFieldRegistry');

const SQL_INJECTION_RE = /;|--|\/\*|\*\/|\bunion\b|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\balter\b|\bexec\b|\bxp_/i;

class AstValidationError extends Error {
  constructor(message, code = 'invalid_ast', details = null) {
    super(message);
    this.name = 'AstValidationError';
    this.code = code;
    this.details = details;
    this.status = 400;
  }
}

function assertNoSqlFragment(value, path) {
  if (value == null) return;
  const check = (v) => {
    if (typeof v !== 'string') return;
    if (SQL_INJECTION_RE.test(v) && /[;']|--|\/\*|\bunion\b.*\bselect\b/i.test(v)) {
      throw new AstValidationError(`Raw SQL rejected at ${path}`, 'raw_sql_rejected', { path, value: v.slice(0, 80) });
    }
    // Always reject obvious statement terminators / comments in filter values
    if (/;|--|\/\*|\*\//.test(v)) {
      throw new AstValidationError(`Unsafe characters rejected at ${path}`, 'raw_sql_rejected', { path });
    }
  };
  if (Array.isArray(value)) value.forEach((v, i) => check(v));
  else check(value);
}

function countConditions(node) {
  if (!node) return 0;
  if (node.conditions) {
    return node.conditions.reduce((n, c) => n + countConditions(c), 0);
  }
  return 1;
}

function validateConditionNode(node, recordTypes, depth, path) {
  if (!node || typeof node !== 'object') {
    throw new AstValidationError(`Invalid condition at ${path}`, 'invalid_condition');
  }
  if (depth > MAX_CONDITION_DEPTH) {
    throw new AstValidationError('Query too complex: condition nesting exceeded', 'query_too_complex');
  }
  if (node.operator && Array.isArray(node.conditions)) {
    const op = String(node.operator).toLowerCase();
    if (!LOGICAL_OPS.includes(op)) {
      throw new AstValidationError(`Invalid logical operator: ${node.operator}`, 'invalid_operator');
    }
    node.conditions.forEach((c, i) => validateConditionNode(c, recordTypes, depth + 1, `${path}.conditions[${i}]`));
    return;
  }
  const field = node.field;
  const operator = node.operator;
  if (!field || !operator) {
    throw new AstValidationError(`Condition missing field/operator at ${path}`, 'invalid_condition');
  }
  if (!OPERATORS.includes(operator)) {
    throw new AstValidationError(`Unsupported operator: ${operator}`, 'invalid_operator');
  }
  // Field must exist on at least one selected record type (or be logical)
  const ok = recordTypes.some((t) => RECORD_TYPES[t]?.fields?.[field]);
  if (!ok && !['record_type', 'source_record_id'].includes(field)) {
    throw new AstValidationError(`Unauthorized or unknown field: ${field}`, 'unauthorized_field', { field });
  }
  assertNoSqlFragment(node.value, `${path}.value`);
  if (operator === 'between') {
    if (!Array.isArray(node.value) || node.value.length !== 2) {
      throw new AstValidationError(`between requires [from, to] at ${path}`, 'invalid_condition');
    }
  }
  if (['in', 'not_in'].includes(operator) && !Array.isArray(node.value)) {
    throw new AstValidationError(`${operator} requires an array at ${path}`, 'invalid_condition');
  }
}

function validateAst(raw, { forExport = false } = {}) {
  if (!raw || typeof raw !== 'object') {
    throw new AstValidationError('AST payload required');
  }
  if (raw.version !== 1 && raw.version !== '1') {
    throw new AstValidationError('Unsupported query AST version', 'invalid_saved_query_version');
  }
  const scope = raw.scope || {};
  const churchId = Number(scope.churchId);
  if (!Number.isFinite(churchId) || churchId <= 0) {
    throw new AstValidationError('scope.churchId is required', 'tenant_context_mismatch');
  }
  let recordTypes = Array.isArray(scope.recordTypes) && scope.recordTypes.length
    ? scope.recordTypes.map(String)
    : listRecordTypes();
  for (const t of recordTypes) {
    if (!RECORD_TYPES[t]) {
      throw new AstValidationError(`Unsupported record type: ${t}`, 'unsupported_query');
    }
  }
  recordTypes = [...new Set(recordTypes)];

  let operation = raw.operation || { type: 'records' };
  if (!['records', 'duplicate_detection', 'record_activity', 'data_quality'].includes(operation.type)) {
    throw new AstValidationError(`Unsupported search operation: ${operation.type}`, 'unsupported_query');
  }
  if (operation.type === 'duplicate_detection') {
    if (!['record_duplicates', 'possible_people', 'both'].includes(operation.mode)) {
      throw new AstValidationError('Duplicate detection mode must be record_duplicates, possible_people, or both', 'invalid_duplicate_operation');
    }
    const matchLevel = String(operation.matchLevel || 'standard').toLowerCase();
    if (!['strict', 'standard', 'loose'].includes(matchLevel)) throw new AstValidationError('Invalid duplicate match level', 'invalid_duplicate_operation');
    const minimumGroupSize = Number(operation.minimumGroupSize || 2);
    if (!Number.isInteger(minimumGroupSize) || minimumGroupSize < 2 || minimumGroupSize > 100) throw new AstValidationError('minimumGroupSize must be 2-100', 'invalid_duplicate_operation');
    if (operation.fields != null && !Array.isArray(operation.fields)) throw new AstValidationError('operation.fields must be an array', 'invalid_duplicate_operation');
    const allowedDuplicateFields = new Set(['primary_name','canonical_event_date','first_name','last_name','reception_date','birth_date','reception_year','fname_groom','lname_groom','fname_bride','lname_bride','mdate','couple_names','marriage_year','name','lastname','burial_date','deceased_date','burial_year']);
    for (const field of operation.fields || []) if (!allowedDuplicateFields.has(field)) throw new AstValidationError(`Unsupported duplicate field: ${field}`, 'unauthorized_field');
    const source = operation.source == null ? null : String(operation.source).toLowerCase();
    if (source && source !== 'ocr') throw new AstValidationError('Unsupported duplicate source filter', 'invalid_duplicate_operation');
    operation = { type: 'duplicate_detection', mode: operation.mode, matchLevel, fields: operation.fields || [], minimumGroupSize, ocrTolerance: Math.max(0, Math.min(2, Number(operation.ocrTolerance ?? 1))), candidateLimit: Math.max(100, Math.min(2000, Number(operation.candidateLimit || 1000))), source };
  }
  if (operation.type === 'record_activity') {
    operation = { type: 'record_activity' };
  }
  if (operation.type === 'data_quality') {
    operation = { type: 'data_quality' };
  }

  let activity = null;
  if (raw.activity != null || operation.type === 'record_activity') {
    const a = raw.activity || {};
    const allowedEvents = new Set(['created', 'modified', 'imported', 'verified', 'deleted', 'restored', 'any_activity']);
    let eventTypes = Array.isArray(a.eventTypes) && a.eventTypes.length ? a.eventTypes.map(String) : ['created', 'imported'];
    for (const et of eventTypes) {
      if (!allowedEvents.has(et)) throw new AstValidationError(`Unsupported activity event type: ${et}`, 'invalid_activity');
    }
    const rw = a.relativeWindow || { amount: 24, unit: 'hours' };
    const amount = Number(rw.amount ?? 24);
    const unit = String(rw.unit || 'hours').toLowerCase();
    const preset = rw.preset ? String(rw.preset).toLowerCase() : null;
    if (preset && !['today', 'since_yesterday'].includes(preset)) {
      throw new AstValidationError('Unsupported relative window preset', 'invalid_activity');
    }
    if (!preset && (!Number.isFinite(amount) || amount <= 0 || amount > 366)) {
      throw new AstValidationError('relativeWindow.amount must be 1-366', 'invalid_activity');
    }
    if (!['hours', 'hour', 'days', 'day', 'weeks', 'week', 'months', 'month', 'years', 'year', 'minutes', 'minute', 'today', 'since_yesterday'].includes(unit) && !preset) {
      throw new AstValidationError('Unsupported relativeWindow.unit', 'invalid_activity');
    }
    // Keep relative — never bake absolute timestamps into saved AST
    activity = {
      eventTypes,
      relativeWindow: preset ? { preset } : { amount, unit: unit.replace(/s$/, '') === 'day' ? 'days' : unit.replace(/s$/, '') === 'hour' ? 'hours' : unit.replace(/s$/, '') === 'minute' ? 'minutes' : unit },
    };
    if (operation.type === 'records') operation = { type: 'record_activity' };
  }

  let rules = [];
  if (operation.type === 'data_quality' || Array.isArray(raw.rules)) {
    const allowedRules = new Set([
      'inconsistent_raw_date_format', 'invalid_date', 'ambiguous_date', 'missing_required_date',
      'event_date_in_future', 'birth_after_reception', 'death_after_burial', 'implausible_year',
      'raw_value_differs_from_normalized_value',
    ]);
    rules = (raw.rules || []).map((r) => {
      const rule = typeof r === 'string' ? r : r?.rule;
      if (!rule || !allowedRules.has(rule)) throw new AstValidationError(`Unsupported data-quality rule: ${rule}`, 'unsupported_query');
      return { rule };
    });
    if (operation.type === 'data_quality' && !rules.length) {
      throw new AstValidationError('data_quality requires at least one rule', 'invalid_ast');
    }
    if (rules.length && operation.type === 'records') operation = { type: 'data_quality' };
  }

  if (raw.filters) validateConditionNode(raw.filters, recordTypes, 1, 'filters');
  const condCount = countConditions(raw.filters);
  if (condCount > MAX_CONDITIONS) {
    throw new AstValidationError('Query too complex: too many conditions', 'query_too_complex');
  }
  if (raw.textSearch != null) assertNoSqlFragment(raw.textSearch, 'textSearch');

  const select = Array.isArray(raw.select) && raw.select.length ? raw.select : [...DEFAULT_SELECT];
  for (const col of select) {
    assertNoSqlFragment(col, 'select');
  }

  const sort = Array.isArray(raw.sort) ? raw.sort : [];
  for (const s of sort) {
    if (!s?.field) throw new AstValidationError('sort.field required');
    const dir = String(s.direction || 'asc').toLowerCase();
    if (!['asc', 'desc'].includes(dir)) {
      throw new AstValidationError(`Invalid sort direction: ${s.direction}`);
    }
    s.direction = dir;
  }

  const limitCap = forExport ? 5000 : (['duplicate_detection', 'record_activity', 'data_quality'].includes(operation.type) ? 100 : MAX_PAGE_SIZE);
  let limit = Number(raw.limit ?? 50);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > limitCap) {
    throw new AstValidationError(`limit exceeds maximum of ${limitCap}`, 'query_too_broad');
  }
  let offset = Number(raw.offset ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const aggregates = Array.isArray(raw.aggregates) ? raw.aggregates : [];
  for (const a of aggregates) {
    if (!['count'].includes(String(a.fn || a.function || '').toLowerCase())) {
      throw new AstValidationError(`Unsupported aggregate: ${a.fn || a.function}`, 'unsupported_query');
    }
  }
  const groupBy = Array.isArray(raw.groupBy) ? raw.groupBy : [];
  for (const g of groupBy) {
    if (!['canonical_event_date', 'year', 'record_type', 'clergy'].includes(g) && !g.startsWith('year(')) {
      // allow year logical
      if (g !== 'canonical_event_year') {
        throw new AstValidationError(`Unsupported groupBy: ${g}`, 'unsupported_query');
      }
    }
  }

  const relationships = Array.isArray(raw.relationships) ? raw.relationships : [];
  for (const r of relationships) {
    if (!['same_person', 'family', 'baptized_then_married'].includes(r.type)) {
      throw new AstValidationError(`Unsupported relationship: ${r.type}`, 'unsupported_query');
    }
  }

  const mode = operation.type === 'duplicate_detection'
    ? 'duplicate_detection'
    : operation.type === 'record_activity'
      ? 'record_activity'
      : operation.type === 'data_quality'
        ? 'data_quality'
        : (raw.mode || (relationships.length ? 'related' : 'union'));

  return {
    version: 1,
    scope: { churchId, recordTypes },
    operation,
    activity,
    rules,
    workflowIntent: raw.workflowIntent || null,
    filters: raw.filters || { operator: 'and', conditions: [] },
    textSearch: raw.textSearch ?? null,
    relationships,
    select,
    groupBy,
    aggregates,
    sort,
    limit,
    offset,
    mode,
    export: raw.export || null,
    includeDeleted: raw.includeDeleted === 'only' ? 'only' : raw.includeDeleted === true,
  };
}

module.exports = { validateAst, AstValidationError, assertNoSqlFragment };
