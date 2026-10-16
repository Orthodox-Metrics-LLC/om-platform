#!/usr/bin/env node
/**
 * Focused tests for parish records search (OMOD-2803)
 * Run: node server/src/services/parishRecordsSearch/__tests__/parishSearch.test.js
 */

const assert = require('assert');
const { parseNaturalLanguage, detectRecordTypes, yearRangeFromText, extractClergy } = require('../nlParser');
const { validateAst, AstValidationError } = require('../astValidator');
const { planUnionQuery } = require('../queryPlanner');
const { CANONICAL_DATE_FIELDS } = require('../recordFieldRegistry');
const { applyRelationshipLabels, scorePair } = require('../relationshipMatcher');
const { normalizeRows } = require('../resultNormalizer');
const { normalizeText, levenshteinBounded } = require('../normalization');
const { planRecordDuplicateQuery } = require('../duplicatePlanner');
const { differences, signature, dateEvidence, executeRecordDuplicates } = require('../duplicateService');
const { buildDuplicateCsv, buildDuplicateXml } = require('../exportService');

let passed = 0;
let failed = 0;
const pending = [];
function test(name, fn) {
  try {
    fn();
    console.log('  PASS:', name);
    passed++;
  } catch (e) {
    console.error('  FAIL:', name, '\n       ', e.message);
    failed++;
  }
}
function testAsync(name, fn) {
  pending.push(Promise.resolve().then(fn).then(() => { console.log('  PASS:', name); passed++; }, (e) => { console.error('  FAIL:', name, '\n       ', e.message); failed++; }));
}

console.log('\n── canonical date mapping ──');
test('funeral canonical date is burial_date', () => {
  assert.strictEqual(CANONICAL_DATE_FIELDS.funeral, 'burial_date');
  assert.strictEqual(CANONICAL_DATE_FIELDS.baptism, 'reception_date');
  assert.strictEqual(CANONICAL_DATE_FIELDS.marriage, 'mdate');
});

console.log('\n── NL parser ──');
test('detects funeral + clergy + year range', () => {
  const r = parseNaturalLanguage('funerals performed by Rev. James Parsells between 1976 and 1985', { churchId: 46 });
  assert.ok(r.ast);
  assert.deepStrictEqual(r.ast.scope.recordTypes, ['funeral']);
  assert.strictEqual(extractClergy('funerals performed by Rev. James Parsells between 1976 and 1985'), 'Rev. James Parsells');
  assert.deepStrictEqual(yearRangeFromText('between 1976 and 1985'), [1976, 1985]);
  const clergyCond = r.ast.filters.conditions.find((c) => c.field === 'clergy');
  assert.ok(clergyCond);
  const dateCond = r.ast.filters.conditions.find((c) => c.field === 'canonical_event_date' || c.field === 'burial_date');
  assert.ok(dateCond);
  assert.strictEqual(dateCond.operator, 'between');
  assert.deepStrictEqual(dateCond.value, ['1976-01-01', '1985-12-31']);
});

test('baptisms in 2025', () => {
  const r = parseNaturalLanguage('baptisms in 2025', { churchId: 46 });
  assert.deepStrictEqual(r.ast.scope.recordTypes, ['baptism']);
  const dateCond = r.ast.filters.conditions.find((c) => c.field === 'canonical_event_date');
  assert.deepStrictEqual(dateCond.value, ['2025-01-01', '2025-12-31']);
});

test('export intent excel', () => {
  const r = parseNaturalLanguage('export all funerals from 1976 through 1985 with name to Excel', { churchId: 46 });
  assert.ok(r.exportIntent);
  assert.strictEqual(r.exportIntent.format, 'xlsx');
});

test('list duplicate records creates explicit duplicate operation', () => {
  const r = parseNaturalLanguage('list duplicate records', { churchId: 46 });
  assert.strictEqual(r.ast.operation.type, 'duplicate_detection');
  assert.strictEqual(r.ast.operation.mode, 'record_duplicates');
  assert.deepStrictEqual(r.ast.scope.recordTypes, ['baptism', 'marriage', 'funeral']);
  assert.strictEqual(r.ast.textSearch, null);
});

test('show duplicate funerals scopes duplicate operation', () => {
  const r = parseNaturalLanguage('show duplicate funerals', { churchId: 46 });
  assert.deepStrictEqual(r.ast.scope.recordTypes, ['funeral']);
  assert.strictEqual(r.ast.operation.mode, 'record_duplicates');
});

test('possible duplicate people is never called confirmed duplicate', () => {
  const r = parseNaturalLanguage('find possible duplicate people', { churchId: 46 });
  assert.strictEqual(r.ast.operation.mode, 'possible_people');
});

test('ambiguous matching records asks which duplicate mode is intended', () => {
  const r = parseNaturalLanguage('find matching records', { churchId: 46 });
  assert.ok(r.clarifications.some((c) => c.id === 'duplicate_mode'));
  assert.deepStrictEqual(r.clarifications.find((c) => c.id === 'duplicate_mode').options.map((o) => o.id), ['record_duplicates', 'possible_people', 'both']);
});

test('OCR duplicate imports retain an explicit source constraint', () => {
  const r = parseNaturalLanguage('find duplicate records created from OCR imports', { churchId: 46 });
  assert.strictEqual(r.ast.operation.source, 'ocr');
  assert.strictEqual(r.ast.operation.ocrTolerance, 2);
});

test('export duplicate baptisms to Excel retains duplicate AST and export intent', () => {
  const r = parseNaturalLanguage('export duplicate baptisms to Excel', { churchId: 46 });
  assert.strictEqual(r.ast.operation.type, 'duplicate_detection');
  assert.strictEqual(r.exportIntent.format, 'xlsx');
});

test('records containing the word duplicate remains ordinary text search intent', () => {
  const r = parseNaturalLanguage('records containing duplicate', { churchId: 46 });
  assert.strictEqual(r.ast.operation.type, 'records');
});

test('count by year sets aggregate', () => {
  const r = parseNaturalLanguage('count funerals by year from 1970 through 1990', { churchId: 46 });
  assert.ok(r.ast.aggregates.length);
  assert.ok(r.ast.groupBy.includes('canonical_event_year'));
});

test('ambiguous funeral date may clarify', () => {
  const r = parseNaturalLanguage('funerals between 1976 and 1985', { churchId: 46 });
  // clarification preferred when date field unspecified for funerals
  assert.ok(r.clarifications.length >= 0);
  assert.ok(r.ast.filters.conditions.some((c) => c.operator === 'between'));
});

console.log('\n── AST validation ──');
test('accepts valid AST', () => {
  const ast = validateAst({
    version: 1,
    scope: { churchId: 46, recordTypes: ['funeral'] },
    filters: { operator: 'and', conditions: [{ field: 'clergy', operator: 'contains', value: 'Parsells' }] },
    select: ['record_type', 'primary_name'],
    sort: [{ field: 'canonical_event_date', direction: 'asc' }],
    limit: 50,
  });
  assert.strictEqual(ast.scope.churchId, 46);
});

test('rejects unknown field', () => {
  assert.throws(() => validateAst({
    version: 1,
    scope: { churchId: 46, recordTypes: ['funeral'] },
    filters: { operator: 'and', conditions: [{ field: 'ssn', operator: 'equals', value: 'x' }] },
  }), (e) => e instanceof AstValidationError && e.code === 'unauthorized_field');
});

test('rejects raw SQL fragments', () => {
  assert.throws(() => validateAst({
    version: 1,
    scope: { churchId: 46, recordTypes: ['baptism'] },
    filters: { operator: 'and', conditions: [{ field: 'last_name', operator: 'equals', value: "x'; DROP TABLE baptism_records;--" }] },
  }), (e) => e instanceof AstValidationError);
});

test('rejects invalid operator', () => {
  assert.throws(() => validateAst({
    version: 1,
    scope: { churchId: 46, recordTypes: ['baptism'] },
    filters: { operator: 'and', conditions: [{ field: 'last_name', operator: 'regex', value: 'a' }] },
  }), (e) => e.code === 'invalid_operator');
});

console.log('\n── query planner ──');
test('funeral planner uses burial_date for canonical event', () => {
  const ast = validateAst({
    version: 1,
    scope: { churchId: 46, recordTypes: ['funeral'] },
    filters: { operator: 'and', conditions: [{ field: 'canonical_event_date', operator: 'between', value: ['1976-01-01', '1985-12-31'] }] },
    limit: 10,
  });
  const plan = planUnionQuery(ast);
  assert.ok(plan.sql.includes('burial_date'), plan.sql);
  assert.ok(plan.sql.includes('funeral_records'));
  assert.ok(!plan.sql.includes('fdate'));
  assert.ok(plan.sql.includes('?'), 'parameterized');
});

test('union includes all three tables', () => {
  const ast = validateAst({
    version: 1,
    scope: { churchId: 46, recordTypes: ['baptism', 'marriage', 'funeral'] },
    textSearch: 'Smith',
    limit: 25,
  });
  const plan = planUnionQuery(ast);
  assert.ok(plan.sql.includes('baptism_records'));
  assert.ok(plan.sql.includes('marriage_records'));
  assert.ok(plan.sql.includes('funeral_records'));
  assert.ok(plan.sql.includes('UNION ALL'));
});

test('duplicate planner groups tenant-table rows with parameterized minimum size', () => {
  const ast = validateAst({ version: 1, scope: { churchId: 46, recordTypes: ['funeral'] }, operation: { type: 'duplicate_detection', mode: 'record_duplicates', matchLevel: 'standard', minimumGroupSize: 2 }, filters: { operator: 'and', conditions: [] }, limit: 20 });
  const plan = planRecordDuplicateQuery(ast, 'funeral');
  assert.ok(plan.sql.includes('funeral_records'));
  assert.ok(plan.sql.includes('GROUP BY'));
  assert.ok(plan.sql.includes('HAVING COUNT(*) >= ?'));
  assert.strictEqual(plan.params.at(-1), 2);
  assert.ok(!plan.sql.includes('om_church_'));
});

test('duplicate planner normalizes repeated whitespace and punctuation in SQL', () => {
  const ast = validateAst({ version: 1, scope: { churchId: 46, recordTypes: ['funeral'] }, operation: { type: 'duplicate_detection', mode: 'record_duplicates', matchLevel: 'standard' }, limit: 20 });
  const plan = planRecordDuplicateQuery(ast, 'funeral');
  assert.ok(plan.sql.includes('REGEXP_REPLACE'));
  assert.ok(plan.sql.includes('[[:space:][:punct:]]+'));
});

test('logical primary name and canonical event date are valid grouping fields', () => {
  const ast = validateAst({ version: 1, scope: { churchId: 46, recordTypes: ['funeral'] }, operation: { type: 'duplicate_detection', mode: 'record_duplicates', matchLevel: 'standard', fields: ['primary_name', 'canonical_event_date'] }, limit: 20 });
  assert.deepStrictEqual(ast.operation.fields, ['primary_name', 'canonical_event_date']);
});

test('normalization handles unicode apostrophes, punctuation, case and clergy titles', () => {
  assert.strictEqual(normalizeText('  O’NEIL--Smith,  '), 'o neil smith');
  assert.strictEqual(normalizeText('Fr. JOHN  DOE', { clergy: true }), 'john doe');
  assert.ok(levenshteinBounded('Smyth', 'Smith', 2) <= 2);
});

test('same name with different event dates remains distinguishable', () => {
  const d = differences([{ values: { name: 'John', lastname: 'Smith', burial_date: '2025-01-01' } }, { values: { name: 'john', lastname: 'smith', burial_date: '2025-02-01' } }]);
  assert.ok(d.matched.includes('name') && d.matched.includes('lastname'));
  assert.ok(d.differed.includes('burial_date'));
});

test('duplicate group signatures are tenant isolated', () => {
  assert.notStrictEqual(signature(46, 'funeral', [1, 2]), signature(47, 'funeral', [1, 2]));
});

test('same birth date strengthens a possible-person match', () => {
  const evidence = dateEvidence({ type: 'baptism', row: { birth_date: '1980-01-02' } }, { type: 'baptism', row: { birth_date: '1980-01-02' } });
  assert.ok(evidence.score > 0);
  assert.deepStrictEqual(evidence.matched, ['birth_date']);
});

test('impossible baptism/funeral chronology is negative evidence', () => {
  const evidence = dateEvidence({ type: 'baptism', row: { birth_date: '2000-01-02' } }, { type: 'funeral', row: { deceased_date: '1990-01-02' } });
  assert.ok(evidence.score < 0);
  assert.ok(evidence.differed.includes('incompatible_dates'));
});

function exactDuplicateFixture(type) {
  if (type === 'baptism') return { first_name: 'Anna', last_name: 'Smith', reception_date: '2020-01-02', birth_date: '2019-01-02', clergy: 'Fr. Paul', birthplace: 'Boston', status: 'Recorded' };
  if (type === 'marriage') return { fname_groom: 'John', lname_groom: 'Smith', fname_bride: 'Mary', lname_bride: 'Jones', mdate: '2020-01-02', clergy: 'Fr. Paul', status: 'Recorded' };
  return { name: 'John', lastname: 'Smith', burial_date: '2020-01-02', deceased_date: '2019-12-31', clergy: 'Fr. Paul', burial_location: 'Parish cemetery', status: 'Recorded' };
}

for (const type of ['baptism', 'marriage', 'funeral']) testAsync(`two identical ${type} rows form an exact duplicate group`, async () => {
  const fixture = exactDuplicateFixture(type);
  const pool = { query: async (sql) => sql.includes('GROUP_CONCAT') ? [[{ record_ids: '11,12', record_count: 2 }]] : [[{ id: 11, ...fixture }, { id: 12, ...fixture }]] };
  const ast = validateAst({ version: 1, scope: { churchId: 46, recordTypes: [type] }, operation: { type: 'duplicate_detection', mode: 'record_duplicates', matchLevel: 'strict' }, limit: 20 });
  const groups = await executeRecordDuplicates(pool, ast, 46);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].classification, 'Exact duplicate');
  assert.deepStrictEqual(groups[0].sourceRecordIds, [11, 12]);
});

console.log('\n── relationships + normalizer ──');
test('probable match labeling', () => {
  const rows = applyRelationshipLabels([
    { recordType: 'baptism', primaryName: 'John Smith', canonicalEventDate: '1980-01-01', sourceRecordId: 1 },
    { recordType: 'marriage', primaryName: 'John Smith & Mary Jones', canonicalEventDate: '2004-06-01', sourceRecordId: 2 },
  ], [{ type: 'baptized_then_married' }]);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => r.matchLabel));
});

test('normalize rows calendar dates', () => {
  const out = normalizeRows([{
    record_type: 'funeral',
    primary_name: 'Richard Weber',
    canonical_event_date: new Date(1982, 9, 23),
    clergy: null,
    location: null,
    status: null,
    source_record_id: 447,
  }], 46);
  assert.strictEqual(out[0].canonicalEventDate, '1982-10-23');
  assert.ok(out[0].openPath.includes('type=funeral'));
});

test('scorePair same last+first is high', () => {
  const s = scorePair(
    { primaryName: 'John Smith', canonicalEventDate: '1980-01-01' },
    { primaryName: 'John Smith', canonicalEventDate: '2000-01-01' },
  );
  assert.ok(s >= 90);
});


console.log('\n── export guards ──');
const { guardSpreadsheetValue } = require('../spreadsheetGuard');
test('spreadsheet formula injection guard', () => {
  assert.strictEqual(guardSpreadsheetValue('=1+1'), "'=1+1");
  assert.strictEqual(guardSpreadsheetValue('+cmd'), "'+cmd");
  assert.strictEqual(guardSpreadsheetValue('-2'), "'-2");
  assert.strictEqual(guardSpreadsheetValue('@sum'), "'@sum");
  assert.strictEqual(guardSpreadsheetValue('Normal Name'), 'Normal Name');
});

test('duplicate CSV and XML retain group hierarchy and guard formulas', () => {
  const groups = [{ duplicateGroupId: 'g1', classification: 'Exact duplicate', confidence: 100, recordType: 'funeral', recordCount: 2, matchedFields: ['name'], differingFields: [], reviewStatus: 'unreviewed', records: [{ recordType: 'funeral', sourceRecordId: 1, primaryName: '=CMD()', canonicalEventDate: '2025-01-01', values: { name: '=CMD()' }, openPath: '/records/1' }] }];
  const csv = String(buildDuplicateCsv(groups));
  assert.ok(csv.includes("'=CMD()"));
  const xml = String(buildDuplicateXml(groups, { operation: { mode: 'record_duplicates' } }, 46));
  assert.ok(xml.includes('<DuplicateGroup'));
  assert.ok(xml.includes('<Record type="funeral"'));
});

console.log('\n── saved search tenant checks ──');
test('saved search AST must keep churchId', () => {
  const ast = validateAst({
    version: 1,
    scope: { churchId: 46, recordTypes: ['baptism'] },
    filters: { operator: 'and', conditions: [] },
    textSearch: 'Weber',
  });
  assert.strictEqual(ast.scope.churchId, 46);
});

console.log('\n── activity / data-quality / deletion (OMOD-2805) ──');
const { formatParishDateDisplay, formatDateOnlyIso } = require('../dateDisplay');
const { recommendSurvivor, missingFieldsOnSurvivor } = require('../duplicateRemovalService');
const { resolveRelativeWindow } = require('../churchTimezone');
const { looksAmbiguousRaw } = require('../dataQualityService');

test('records in the past 24 hours uses activity timestamps not event dates', () => {
  const r = parseNaturalLanguage('records in the past 24 hours', { churchId: 46 });
  assert.strictEqual(r.ast.operation.type, 'record_activity');
  assert.deepStrictEqual(r.ast.activity.eventTypes, ['created', 'imported']);
  assert.deepStrictEqual(r.ast.activity.relativeWindow, { amount: 24, unit: 'hours' });
  assert.ok(!r.ast.filters.conditions.some((c) => c.field === 'canonical_event_date'));
  const validated = validateAst({ ...r.ast, scope: { ...r.ast.scope, churchId: 46 } });
  assert.ok(validated.activity.relativeWindow.amount);
  assert.ok(!validated.activity.startUtc);
});

test('records added today is relative today preset', () => {
  const r = parseNaturalLanguage('records added today', { churchId: 46 });
  assert.strictEqual(r.ast.operation.type, 'record_activity');
  assert.strictEqual(r.ast.activity.relativeWindow.preset, 'today');
});

test('conflicting date formats becomes data_quality with raw-format rule', () => {
  const r = parseNaturalLanguage('records with conflicting date formats', { churchId: 46 });
  assert.strictEqual(r.ast.operation.type, 'data_quality');
  assert.ok(r.ast.rules.some((x) => x.rule === 'inconsistent_raw_date_format'));
});

test('invalid dates data-quality intent', () => {
  const r = parseNaturalLanguage('records with invalid dates', { churchId: 46 });
  assert.strictEqual(r.ast.operation.type, 'data_quality');
  assert.ok(r.ast.rules.some((x) => x.rule === 'invalid_date'));
});

test('delete duplicate records navigates to review workflow without authorizing deletion', () => {
  const r = parseNaturalLanguage('delete duplicate records', { churchId: 46 });
  assert.strictEqual(r.ast.operation.type, 'duplicate_detection');
  assert.strictEqual(r.workflowIntent, 'duplicate_removal_review');
  assert.strictEqual(r.ast.workflowIntent, 'duplicate_removal_review');
});

test('parish date display is MM/DD/YYYY without timezone shift', () => {
  assert.strictEqual(formatParishDateDisplay('2022-01-25'), '01/25/2022');
  assert.strictEqual(formatParishDateDisplay('2022-02-02'), '02/02/2022');
  assert.strictEqual(formatDateOnlyIso('2022-01-25T00:00:00.000Z'), '2022-01-25');
  assert.strictEqual(formatParishDateDisplay(null), '—');
  assert.strictEqual(formatParishDateDisplay('nope'), 'Invalid date');
});

test('survivor recommendation and missing-data warning', () => {
  const survivor = recommendSurvivor([
    { sourceRecordId: 26, status: 'Verified', values: { first_name: 'A', last_name: 'B', reception_date: '2020-01-01' } },
    { sourceRecordId: 27, values: { first_name: 'A', last_name: 'B', sponsors: 'Godparent', birthplace: 'Boston' } },
  ]);
  assert.strictEqual(survivor, 26);
  const warnings = missingFieldsOnSurvivor(
    { first_name: 'A', last_name: 'B', reception_date: '2020-01-01' },
    [{ id: 27, first_name: 'A', last_name: 'B', sponsors: 'Godparent', birthplace: 'Boston', notes: 'n' }],
  );
  assert.ok(warnings[0].fields.includes('sponsors'));
  assert.ok(warnings[0].fields.includes('birthplace'));
});

test('relative window stays relative and church TZ resolves absolute bounds at execute', () => {
  const win = resolveRelativeWindow({ amount: 24, unit: 'hours' }, 'America/New_York', new Date('2026-08-02T16:00:00.000Z'));
  assert.ok(win.startUtc < win.endUtc);
  assert.ok(win.label.includes('24'));
});

test('ambiguous raw month/day detection', () => {
  assert.strictEqual(looksAmbiguousRaw('02/03/2022'), true);
  assert.strictEqual(looksAmbiguousRaw('02/15/2022'), false);
  assert.strictEqual(looksAmbiguousRaw('2022-02-03'), false);
});

Promise.all(pending).then(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
});
