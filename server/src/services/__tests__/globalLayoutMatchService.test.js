#!/usr/bin/env npx tsx
/**
 * Tests for global layout match merge + catalog-first behavior.
 * Run: npx tsx server/src/services/__tests__/globalLayoutMatchService.test.js
 */

const {
  mergeLayoutClassificationJson,
  HIGH_CONFIDENCE_LAYOUT,
  HIGH_CONFIDENCE_CATALOG,
  CANDIDATE_MATCH_THRESHOLD,
} = require('../globalLayoutMatchService');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

console.log('\n[mergeLayoutClassificationJson]');

const ingestLayout = {
  pipelineVersion: 'layout_first_v1',
  identifiedAt: '2026-06-24T10:00:00.000Z',
  source: 'upload',
  detectedLayoutType: 'tabular',
  layoutConfidence: 0.81,
  globalCatalogLayoutId: 'baptism-bilingual-ledger',
  matchedCatalogLayoutId: 'baptism-bilingual-ledger',
  matchedCatalogLayoutTitle: 'Bilingual printed ledger (book spread)',
  layoutMatchScope: 'global',
  layoutMatchSource: 'global_extractor',
  zones: [{ id: 'header', type: 'header' }],
  fieldRegionMap: { child_name: { zoneId: 'col_2' } },
  columnBands: [[0, 0.15], [0.15, 0.35]],
  headerYThreshold: 0.12,
};

const workerPatch = {
  detectedLayoutType: 'tabular',
  layoutConfidence: 0.88,
  layoutSignals: { columnCount: 6 },
  suggestedRecordType: 'baptism',
  zones: [{ id: 'overwritten', type: 'body_column' }],
  matchedCatalogLayoutId: 'wrong-id',
};

const merged = mergeLayoutClassificationJson(ingestLayout, workerPatch);
assert(merged.zones[0].id === 'header', 'preserves ingest zones');
assert(merged.globalCatalogLayoutId === 'baptism-bilingual-ledger', 'preserves globalCatalogLayoutId');
assert(merged.matchedCatalogLayoutId === 'baptism-bilingual-ledger', 'preserves catalog id');
assert(merged.layoutConfidence === 0.88, 'takes higher layout confidence');
assert(merged.workerEnrichedAt, 'sets workerEnrichedAt');
assert(merged.layoutMatchScope === 'global', 'preserves layoutMatchScope');

console.log('\n[constants]');
assert(HIGH_CONFIDENCE_LAYOUT === 0.72, 'HIGH_CONFIDENCE_LAYOUT threshold');
assert(HIGH_CONFIDENCE_CATALOG === 0.62, 'HIGH_CONFIDENCE_CATALOG threshold');
assert(CANDIDATE_MATCH_THRESHOLD === 5, 'CANDIDATE_MATCH_THRESHOLD');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
