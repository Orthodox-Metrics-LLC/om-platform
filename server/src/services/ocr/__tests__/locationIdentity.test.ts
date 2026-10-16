#!/usr/bin/env npx tsx
/**
 * Unit tests for locationIdentity + burial location grouping.
 * Run: npx tsx server/src/services/ocr/__tests__/locationIdentity.test.ts
 */

import {
  locationNameMatches,
  normalizeLocationIdentityKey,
  normalizeLocationText,
  parseLocationParts,
} from '../locationIdentity';
import { groupBurialLocations, resolveLocationAgainstEntities } from '../locationDiscovery';

let passed = 0;
let failed = 0;

function assert(cond: any, message: string): void {
  if (cond) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}\n         expected: ${e}\n         actual:   ${a}`);
    failed++;
  }
}

console.log('\n=== normalize / abbrev ===');
assert(normalizeLocationText('Ss. Peter & Paul Cemetery').includes('saints peter and paul cemetery'), 'Ss → saints, & → and');
assert(normalizeLocationText('N.J').includes('nj') || normalizeLocationText('Flemington, N.J').includes('nj'), 'N.J → nj');
assert(normalizeLocationText('cemetary').includes('cemetery'), 'OCR cemetary → cemetery');

console.log('\n=== identity keys ===');
assertEq(
  normalizeLocationIdentityKey('Ss. Peter & Paul Cemetery, Hillsborough, NJ'),
  normalizeLocationIdentityKey('Ss. Peter & Paul Cemetery, Hillsborough NJ'),
  'comma vs space city/state same key',
);
assert(
  normalizeLocationIdentityKey('Prospect Hill Cemetery, Flemington, NJ') !==
    normalizeLocationIdentityKey('Hillside Cemetery, Plainfield, NJ'),
  'different cemeteries stay distinct',
);
assert(
  normalizeLocationIdentityKey("St. Vladimir's Cemetery, Jackson, NJ") !==
    normalizeLocationIdentityKey('Ss. Peter & Paul Cemetery, Hillsborough, NJ'),
  'St Vladimir vs Ss Peter Paul distinct',
);

console.log('\n=== grouping ===');
const rows = [
  ...Array(10).fill({ original: 'Ss. Peter & Paul Cemetery, Hillsborough, NJ' }),
  ...Array(2).fill({ original: 'Ss. Peter & Paul Cemetery' }),
  ...Array(3).fill({ original: 'Prospect Hill Cemetery, Flemington, N.J' }),
  ...Array(2).fill({ original: "St. Vladimir's Cemetery, Jackson, NJ" }),
  { original: "St. Vladimir's Cemetery Jackson, N.J" },
];
const groups = groupBurialLocations(rows);
assert(groups.length >= 3, `at least 3 groups (got ${groups.length})`);
const parish = groups.find((g) => g.suggested_canonical.includes('Peter'));
assert(!!parish, 'parish cemetery group exists');
assertEq(parish!.suggested_canonical, 'Ss. Peter & Paul Cemetery, Hillsborough, NJ', 'most frequent is canonical');
assert(parish!.variants.length >= 2, 'incomplete name merged as variant');
assert(parish!.total_records === 12, 'parish total 12');
assert(
  !groups.some((g) => g.variants.some((v) => v.value.includes('Prospect')) && g.variants.some((v) => v.value.includes('Hillside'))),
  'Prospect and Hillside never co-grouped',
);

console.log('\n=== resolve ===');
const entities = [
  {
    id: 1,
    entity_type: 'location',
    role: 'Cemetery',
    canonical_value: 'Ss. Peter & Paul Cemetery, Hillsborough, NJ',
    variants_json: [{ value: 'Ss. Peter & Paul Cemetery', total: 5 }],
    metadata_json: JSON.stringify({ location_type: 'Cemetery' }),
  },
  {
    id: 2,
    entity_type: 'location',
    role: 'Cemetery',
    canonical_value: 'Prospect Hill Cemetery, Flemington, NJ',
    variants_json: [],
    metadata_json: JSON.stringify({ location_type: 'Cemetery' }),
  },
];
const matched = resolveLocationAgainstEntities('Ss. Peter & Paul Cemetery', entities, {
  types: ['Cemetery', 'Other'],
});
assertEq(matched.status, 'matched', 'variant → matched');
assertEq(matched.canonical, 'Ss. Peter & Paul Cemetery, Hillsborough, NJ', 'canonical returned');
assertEq(matched.raw, 'Ss. Peter & Paul Cemetery', 'raw preserved');

const unmatched = resolveLocationAgainstEntities('Unknown Plot', entities, { types: ['Cemetery', 'Other'] });
assertEq(unmatched.status, 'unmatched', 'unknown → unmatched');

assert(locationNameMatches('Ss Peter and Paul Cemetery', 'Ss. Peter & Paul Cemetery, Hillsborough, NJ', []), 'name-core match');
assert(!locationNameMatches('Prospect Hill Cemetery', 'Hillside Cemetery, Plainfield, NJ', []), 'no false merge');

const parts = parseLocationParts('Bound Brook Cemetery, Bound Brook, NJ');
assertEq(parts.city, 'bound brook', 'city parsed');
assertEq(parts.state, 'nj', 'state parsed');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
