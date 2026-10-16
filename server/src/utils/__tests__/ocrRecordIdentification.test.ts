#!/usr/bin/env npx tsx
/**
 * Tests for enhanced record identification (path + corpus).
 * Run: npx tsx server/src/utils/__tests__/ocrRecordIdentification.test.ts
 */

import {
  classifyRecordTypeEnhanced,
  inferRecordTypeFromPath,
  matchCorpusCatalogLayout,
} from '../ocrRecordIdentification';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

function testPathHints(): void {
  console.log('\n[path hints]');
  assert(inferRecordTypeFromPath('Baptism/IMG_001.jpg').suggested_type === 'baptism', 'Baptism folder');
  assert(inferRecordTypeFromPath('Marriages/page1/foo.jpg').suggested_type === 'marriage', 'Marriages folder');
  assert(inferRecordTypeFromPath('Deaths/ledger.jpg').suggested_type === 'funeral', 'Deaths → funeral');
}

function testCorpusFuneral(): void {
  console.log('\n[corpus + keywords funeral]');
  const r = classifyRecordTypeEnhanced(
    'DEATHS DIED BURIED CAUSE OF DEATH WHO HEARD CONF WHO BURIED CEMETERY 88 YRS OLD',
    { relativePath: 'Deaths/IMG.jpg' },
  );
  assert(r.suggested_type === 'funeral', 'funeral ledger text');
  assert(r.confidence >= 0.5, `confidence >= 0.5 (${r.confidence})`);
  assert(r.corpus_hits.funeral.length > 0, 'corpus hits recorded');
}

function testPathFallbackWhenOcrWeak(): void {
  console.log('\n[weak OCR + path fallback]');
  const r = classifyRecordTypeEnhanced('x y z', { relativePath: 'Baptism/scan.jpg' });
  assert(r.suggested_type === 'baptism', 'path backs weak OCR');
}

function testCatalogMatch(): void {
  console.log('\n[corpus catalog layout]');
  const m = matchCorpusCatalogLayout(
    'funeral',
    'tabular',
    'DIED BURIED CAUSE OF DEATH WHO HEARD CONF WHO BURIED CEMETERY',
  );
  assert(!!m.layoutId, 'matched a funeral layout');
  assert(m.confidence > 0.5, `layout confidence > 0.5 (${m.confidence})`);
}

testPathHints();
testCorpusFuneral();
testPathFallbackWhenOcrWeak();
testCatalogMatch();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
