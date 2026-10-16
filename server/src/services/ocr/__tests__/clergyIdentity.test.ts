#!/usr/bin/env npx tsx
/**
 * Unit tests for clergyIdentity + clergyDiscovery grouping/resolve.
 * Run: npx tsx server/src/services/ocr/__tests__/clergyIdentity.test.ts
 */

import {
  aliasClergyFieldsForRules,
  clergyNameMatchesEntity,
  isClergyUiField,
  mergeVariantCounts,
  normalizeClergyIdentityKey,
  normalizeClergyText,
  parseClergyVariants,
  stripClergyTitles,
} from '../clergyIdentity';
import {
  aggregateOriginals,
  groupClergyByIdentity,
  resolveClergyAgainstEntities,
  variantsForStorage,
  type ClergyOccurrenceRow,
} from '../clergyDiscovery';

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

console.log('\n=== normalizeClergyText / titles ===');
assertEq(normalizeClergyText('  Fr.  James  Parsells '), 'fr james parsells', 'collapse punctuation/whitespace');
assertEq(normalizeClergyText('V. Rev. James Parsells'), 'v rev james parsells', 'v. rev. punctuation');
assertEq(stripClergyTitles(normalizeClergyText('Father James Parsells')), { title: 'fr', nameTokens: ['james', 'parsells'] }, 'Father → fr');
assertEq(stripClergyTitles(normalizeClergyText('Rev. John Smith')), { title: 'rev', nameTokens: ['john', 'smith'] }, 'Rev → rev');
assertEq(stripClergyTitles(normalizeClergyText('V. Rev. James Parsells')), { title: 'vrev', nameTokens: ['james', 'parsells'] }, 'V. Rev → vrev');

console.log('\n=== identity keys (title-insensitive) ===');
assertEq(
  normalizeClergyIdentityKey('Fr. James Parsells'),
  normalizeClergyIdentityKey('Father James Parsells'),
  'Fr vs Father same key',
);
assertEq(
  normalizeClergyIdentityKey('Rev. James Parsells'),
  normalizeClergyIdentityKey('Reverend James Parsells'),
  'Rev vs Reverend same key',
);
assertEq(
  normalizeClergyIdentityKey('Fr James'),
  normalizeClergyIdentityKey('Fr. James'),
  'punctuation-insensitive',
);
assert(
  normalizeClergyIdentityKey('Fr. James Parsells') !== normalizeClergyIdentityKey('Fr. John Parsells'),
  'different first names differ',
);

console.log('\n=== variants parse / merge ===');
assertEq(parseClergyVariants(['Fr. James', 'J. Parsells']).map((v) => v.value), ['Fr. James', 'J. Parsells'], 'legacy string[]');
assertEq(
  parseClergyVariants([{ value: 'Fr. James', total: 3, baptism: 2, marriage: 1 }])[0],
  { value: 'Fr. James', total: 3, baptism: 2, marriage: 1, funeral: undefined },
  'rich variant object',
);
const merged = mergeVariantCounts(
  [{ value: 'Fr. James', total: 2, baptism: 2 }],
  [{ value: 'fr. james', total: 3, marriage: 3 }],
);
assertEq(merged[0].total, 5, 'merge sums totals case-insensitively');
assertEq(variantsForStorage([{ value: 'A', total: 1 }, { value: 'B', total: 2 }], 'A').map((v) => v.value), ['B'], 'storage excludes canonical');

console.log('\n=== grouping discovery ===');
const rows: ClergyOccurrenceRow[] = [
  { original: 'Fr. James Parsells', source: 'baptism', event_date: '2010-01-15' },
  { original: 'Fr. James Parsells', source: 'baptism', event_date: '2011-03-01' },
  { original: 'Father James Parsells', source: 'marriage', event_date: '2012-06-01' },
  { original: 'Rev. John Smith', source: 'funeral', event_date: '2005-01-01' },
  { original: 'Rev. John Smith', source: 'funeral', event_date: '2008-12-31' },
];
const groups = groupClergyByIdentity(aggregateOriginals(rows));
assertEq(groups.length, 2, 'two identity groups');
const james = groups.find((g) => g.identity_key.includes('james'));
assert(!!james, 'james group exists');
assertEq(james!.suggested_canonical, 'Fr. James Parsells', 'most frequent original is canonical');
assertEq(james!.suggested_active_from, '2010-01-15', 'min date');
assertEq(james!.suggested_active_to, '2012-06-01', 'max date — not auto Current');
assertEq(james!.variants.length, 2, 'two spelling variants in group');

console.log('\n=== resolve ===');
const entities = [
  {
    id: 1,
    entity_type: 'clergy',
    canonical_value: 'V. Rev. James Parsells',
    variants_json: JSON.stringify([{ value: 'Fr. James Parsells', total: 10 }, { value: 'Father James', total: 2 }]),
  },
  {
    id: 2,
    entity_type: 'clergy',
    canonical_value: 'Rev. John Smith',
    variants_json: ['Fr. John Smith'],
  },
];
const matched = resolveClergyAgainstEntities('Father James Parsells', entities);
assertEq(matched.status, 'matched', 'identity match → matched');
assertEq(matched.canonical, 'V. Rev. James Parsells', 'canonical returned');
assertEq(matched.raw, 'Father James Parsells', 'raw preserved');

const exact = resolveClergyAgainstEntities('Rev. John Smith', entities);
assertEq(exact.status, 'matched', 'exact canonical match');

const unmatched = resolveClergyAgainstEntities('Fr. Nobody', entities);
assertEq(unmatched.status, 'unmatched', 'unknown → unmatched');

const ambigEntities = [
  ...entities,
  {
    id: 3,
    entity_type: 'clergy',
    canonical_value: 'Fr. James Other',
    variants_json: [{ value: 'Father James Parsells', total: 1 }],
  },
];
// Same identity key may match two different entities if variants overlap poorly —
// use two entities that both match the same search via identity
const ambig = resolveClergyAgainstEntities('Fr. James Parsells', [
  { id: 10, entity_type: 'clergy', canonical_value: 'V. Rev. James Parsells', variants_json: [] },
  { id: 11, entity_type: 'clergy', canonical_value: 'Father James Parsells', variants_json: [] },
]);
assertEq(ambig.status, 'ambiguous', 'two entities same identity → ambiguous');

assert(clergyNameMatchesEntity('Fr James', 'Father James', []), 'identity match helper');
assert(!clergyNameMatchesEntity('Fr James', 'Father John', []), 'non-match');

console.log('\n=== field aliasing ===');
assertEq(aliasClergyFieldsForRules({ performed_by: 'Fr. X' }).clergy, 'Fr. X', 'performed_by → clergy');
assertEq(aliasClergyFieldsForRules({ officiant: 'Fr. Y' }).clergy, 'Fr. Y', 'officiant → clergy');
assert(isClergyUiField('performed_by'), 'performed_by is clergy UI field');
assert(isClergyUiField('officiant'), 'officiant is clergy UI field');
assert(!isClergyUiField('child_name'), 'child_name is not clergy UI field');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
