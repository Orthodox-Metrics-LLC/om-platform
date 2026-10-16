const crypto = require('crypto');
const { RECORD_TYPES } = require('./recordFieldRegistry');
const { planRecordDuplicateQuery, planRecordDetailsQuery, PRESETS } = require('./duplicatePlanner');
const { normalizeText, levenshteinBounded } = require('./normalization');
const { formatDateOnly } = require('./resultNormalizer');
const { formatParishDateDisplay } = require('./dateDisplay');
const { softDeleteSupported } = require('./schemaSupport');
const { recommendSurvivor } = require('./duplicateRemovalService');

function signature(churchId, type, ids) {
  return crypto.createHash('sha256').update(`${churchId}|${type}|${[...ids].sort((a, b) => a - b).join(',')}`).digest('hex');
}

function displayRecord(type, row, churchId) {
  const cfg = RECORD_TYPES[type];
  const primaryName = type === 'marriage'
    ? `${row.fname_groom || ''} ${row.lname_groom || ''} & ${row.fname_bride || ''} ${row.lname_bride || ''}`.trim()
    : `${row[cfg.personFields[0]] || ''} ${row[cfg.personFields[1]] || ''}`.trim();
  const values = {};
  for (const key of Object.keys(row)) {
    if (row[key] instanceof Date || (typeof row[key] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row[key]))) {
      values[key] = formatDateOnly(row[key]);
      values[`${key}_display`] = formatParishDateDisplay(row[key]);
    } else {
      values[key] = row[key];
    }
  }
  const eventIso = formatDateOnly(row[cfg.canonicalEventDate]);
  return {
    recordType: type,
    sourceRecordId: row.id,
    primaryName,
    canonicalEventDate: eventIso,
    canonicalEventDateDisplay: formatParishDateDisplay(row[cfg.canonicalEventDate]),
    clergy: row[cfg.clergyField] || null,
    location: cfg.locationField ? row[cfg.locationField] || null : null,
    status: cfg.statusField ? row[cfg.statusField] || null : null,
    deletedAt: row.deleted_at || null,
    churchId,
    values,
    openPath: `/portal/records?type=${type}&recordId=${row.id}&churchId=${churchId}`,
  };
}

function differences(records) {
  const keys = [...new Set(records.flatMap((r) => Object.keys(r.values)))].filter((k) => k !== 'id');
  const matched = []; const differed = [];
  for (const key of keys) {
    const vals = [...new Set(records.map((r) => normalizeText(r.values[key])))];
    (vals.length <= 1 ? matched : differed).push(key);
  }
  return { matched, differed };
}

async function resolveSourceColumn(pool, type, source) {
  if (!source) return null;
  const [columns] = await pool.query(`SHOW COLUMNS FROM \`${RECORD_TYPES[type].table}\``);
  const names = new Set(columns.map((c) => String(c.Field)));
  return ['ocr_job_id', 'ocr_batch_id', 'import_source', 'source_type', 'entry_source', 'source'].find((name) => names.has(name)) || null;
}

function dateOnly(value) {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateEvidence(a, b) {
  const aBirth = dateOnly(a.type === 'baptism' ? a.row.birth_date : null);
  const bBirth = dateOnly(b.type === 'baptism' ? b.row.birth_date : null);
  if (aBirth && bBirth) return aBirth === bBirth ? { score: 18, matched: ['birth_date'], differed: [] } : { score: -35, matched: [], differed: ['birth_date'] };
  const baptism = a.type === 'baptism' ? a : b.type === 'baptism' ? b : null;
  const funeral = a.type === 'funeral' ? a : b.type === 'funeral' ? b : null;
  if (baptism && funeral) {
    const born = dateOnly(baptism.row.birth_date);
    const died = dateOnly(funeral.row.deceased_date || funeral.row.burial_date);
    if (born && died) return born <= died ? { score: 8, matched: ['compatible_dates'], differed: [] } : { score: -60, matched: [], differed: ['incompatible_dates'] };
  }
  return { score: 0, matched: [], differed: [] };
}

async function executeRecordDuplicates(pool, ast, churchId) {
  const groups = [];
  for (const type of ast.scope.recordTypes) {
    const sourceColumn = await resolveSourceColumn(pool, type, ast.operation.source);
    const excludeDeleted = await softDeleteSupported(pool, RECORD_TYPES[type].table);
    const plan = planRecordDuplicateQuery(ast, type, sourceColumn, { excludeDeleted });
    const [keys] = await pool.query(plan.sql, plan.params);
    for (const key of keys) {
      const ids = String(key.record_ids).split(',').map(Number).filter(Number.isFinite);
      const detailsPlan = planRecordDetailsQuery(type, ids);
      const [detailRows] = await pool.query(detailsPlan.sql, detailsPlan.params);
      const records = detailRows.map((r) => displayRecord(type, r, churchId));
      const diff = differences(records);
      const classification = plan.preset === 'strict' && !diff.differed.length ? 'Exact duplicate' : plan.preset === 'loose' ? 'Possible duplicate' : 'Strong duplicate candidate';
      const sig = signature(churchId, type, ids);
      groups.push({ duplicateGroupId: sig.slice(0, 12), signature: sig, recordType: type, classification, confidence: classification === 'Exact duplicate' ? 100 : classification === 'Strong duplicate candidate' ? 90 : 70, matchedFields: diff.matched, differingFields: diff.differed, recordCount: records.length, sourceRecordIds: ids, records, preset: plan.preset, groupingFields: plan.fields });
    }
  }
  return groups;
}

async function executePossiblePeople(pool, ast, churchId) {
  const candidates = [];
  const cap = Math.min(2000, Number(ast.operation.candidateLimit || 1000));
  for (const type of ast.scope.recordTypes) {
    const cfg = RECORD_TYPES[type];
    if (type === 'marriage') continue; // couple rows do not represent one canonical person
    const params = [];
    const { compileFilters, compileTextSearch } = require('./queryPlanner');
    const where = compileFilters(type, ast.filters, params);
    const textWhere = compileTextSearch(type, ast.textSearch, params);
    const sourceColumn = await resolveSourceColumn(pool, type, ast.operation.source);
    if (ast.operation.source && !sourceColumn) { const e = new Error(`OCR/import source metadata is not available for ${type} records`); e.status = 400; e.code = 'unsupported_query'; throw e; }
    const sourceSql = !sourceColumn ? '1=1' : /(?:_id|job_id)$/i.test(sourceColumn) ? `\`${sourceColumn}\` IS NOT NULL` : `LOWER(COALESCE(\`${sourceColumn}\`, '')) LIKE ?`;
    if (sourceColumn && !/(?:_id|job_id)$/i.test(sourceColumn)) params.push('%ocr%');
    const cols = ['id', ...cfg.personFields, cfg.canonicalEventDate, ...cfg.additionalDates];
    const [rows] = await pool.query(`SELECT ${cols.map((c) => `\`${c}\``).join(',')} FROM \`${cfg.table}\` WHERE (${where}) AND (${textWhere}) AND (${sourceSql}) AND \`${cfg.personFields[1]}\` IS NOT NULL ORDER BY \`${cfg.personFields[1]}\`, id LIMIT ?`, [...params, cap]);
    for (const row of rows) candidates.push({ type, row, first: normalizeText(row[cfg.personFields[0]]), last: normalizeText(row[cfg.personFields[1]]) });
  }
  const groups = [];
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i]; const b = candidates[j];
    if (a.row.id === b.row.id && a.type === b.type) continue;
    const transposed = a.first === b.last && a.last === b.first;
    const sameLast = a.last === b.last;
    if (!transposed && !sameLast && (a.last[0] !== b.last[0] || Math.abs(a.last.length - b.last.length) > 2)) continue;
    const lastDistance = levenshteinBounded(a.last, b.last, ast.operation.ocrTolerance || 2);
    const firstDistance = levenshteinBounded(a.first, b.first, ast.operation.ocrTolerance || 2);
    if (!transposed && (lastDistance > 2 || firstDistance > 2)) continue;
    const dates = dateEvidence(a, b);
    const confidence = Math.max(0, Math.min(99, (transposed ? 82 : Math.max(55, 92 - (lastDistance + firstDistance) * 12)) + dates.score));
    if (confidence < 45) continue;
    const records = [displayRecord(a.type, a.row, churchId), displayRecord(b.type, b.row, churchId)];
    const idsForSig = records.map((r) => `${r.recordType}:${r.sourceRecordId}`);
    const sig = crypto.createHash('sha256').update(`${churchId}|person|${idsForSig.sort().join(',')}`).digest('hex');
    groups.push({ duplicateGroupId: sig.slice(0, 12), signature: sig, recordType: a.type === b.type ? a.type : 'cross_record', classification: confidence >= 65 ? 'Possible person match' : 'Not enough evidence', confidence, matchedFields: [...(transposed ? ['transposed_name'] : ['similar_name']), ...dates.matched], differingFields: dates.differed, recordCount: 2, sourceRecordIds: idsForSig, records, preset: 'bounded_person_match', groupingFields: ['primary_name', 'compatible_dates'] });
  }
  return groups;
}

async function executeDuplicateDetection(pool, ast, churchId) {
  let groups;
  if (ast.operation.mode === 'both') groups = [...await executeRecordDuplicates(pool, ast, churchId), ...await executePossiblePeople(pool, ast, churchId)];
  else groups = ast.operation.mode === 'possible_people' ? await executePossiblePeople(pool, ast, churchId) : await executeRecordDuplicates(pool, ast, churchId);
  const { reviewsBySignatures } = require('./duplicateReviewRepo');
  const reviews = await reviewsBySignatures(churchId, groups.map((g) => g.signature));
  // Hide groups reviewed as "not duplicates" or resolved elsewhere. Groups confirmed as duplicates stay
  // visible while the records still coexist (the review alone does not remove anything) so they can be merged.
  groups = groups.filter((g) => !['not_a_duplicate', 'resolved_externally'].includes(reviews.get(g.signature)?.review_status)).map((g) => ({
    ...g,
    reviewStatus: reviews.get(g.signature)?.review_status || 'unreviewed',
    reviewNotes: reviews.get(g.signature)?.notes || null,
    recommendedSurvivorId: recommendSurvivor(g.records),
  }));
  const sort = ast.sort?.[0] || { field: 'confidence', direction: 'desc' };
  groups.sort((a, b) => ((sort.field === 'record_count' ? a.recordCount - b.recordCount : a.confidence - b.confidence) * (sort.direction === 'asc' ? 1 : -1)));
  const totalAffectedRecords = new Set(groups.flatMap((g) => g.records.map((r) => `${r.recordType}:${r.sourceRecordId}`))).size;
  const start = ast.offset || 0;
  return { groups: groups.slice(start, start + ast.limit), totalGroups: groups.length, totalAffectedRecords, preset: ast.operation.matchLevel || 'standard', presets: PRESETS };
}

module.exports = { executeDuplicateDetection, executeRecordDuplicates, executePossiblePeople, differences, signature, dateEvidence, resolveSourceColumn };
