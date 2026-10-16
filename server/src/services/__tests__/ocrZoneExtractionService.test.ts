#!/usr/bin/env npx tsx
/**
 * Unit tests for zone-aware OCR field mapping (no Tesseract).
 * Run: npx tsx server/src/services/__tests__/ocrZoneExtractionService.test.ts
 */

import {
  buildFieldRegionMapFromZones,
  buildZoneEnrichedOcrText,
  extractFieldsFromZoneOcr,
  normBboxToPixels,
  psmForZoneType,
} from '../ocrZoneExtractionService';
import type { LayoutZone } from '../ocrLayoutIdentificationService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

console.log('\n[psmForZoneType]');
assert(psmForZoneType('header') === '6', 'header PSM');
assert(psmForZoneType('body_column') === '4', 'body_column PSM');
assert(psmForZoneType('handwriting_band') === '11', 'handwriting_band PSM');

console.log('\n[normBboxToPixels]');
const px = normBboxToPixels({ x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.8 }, 1000, 2000);
assert(px.left === 100 && px.top === 400, 'origin pixels');
assert(px.width === 400 && px.height >= 1200 && px.height <= 1201, 'size pixels');

console.log('\n[extractFieldsFromZoneOcr tabular]');
const tabularLayout = {
  detectedLayoutType: 'tabular',
  suggestedRecordType: 'baptism',
  zones: [
    { id: 'col_2', type: 'body_column', fieldKeys: ['child_name'], bboxNorm: { x0: 0.3, y0: 0.1, x1: 0.5, y1: 0.9 } },
  ] as LayoutZone[],
};
const tabularZoneOcr = {
  col_2: {
    zoneId: 'col_2',
    zoneType: 'body_column' as const,
    text: 'John Michael Smith',
    confidence: 0.88,
    psm: '4',
    bboxNorm: { x0: 0.3, y0: 0.1, x1: 0.5, y1: 0.9 },
    source: 'zone_tesseract' as const,
  },
};
const tabularFields = extractFieldsFromZoneOcr(tabularLayout, tabularZoneOcr);
assert(tabularFields.child_name === 'John Michael Smith', 'tabular column maps child_name');
assert(tabularFields.first_name === 'John Michael', 'tabular splits first name');
assert(tabularFields.last_name === 'Smith', 'tabular splits last name');

console.log('\n[buildFieldRegionMapFromZones]');
const map = buildFieldRegionMapFromZones({}, tabularLayout.zones, tabularFields);
assert(map.child_name?.zoneId === 'col_2', 'field maps to column zone');
assert(map.child_name?.extractedValue === 'John Michael Smith', 'field value preserved');

console.log('\n[buildZoneEnrichedOcrText]');
const enriched = buildZoneEnrichedOcrText(tabularZoneOcr, tabularLayout.zones);
assert(enriched.includes('John Michael Smith'), 'enriched text contains zone content');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
