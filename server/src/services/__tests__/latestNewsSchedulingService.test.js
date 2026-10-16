#!/usr/bin/env node
/**
 * Unit tests for latestNewsSchedulingService.js
 *
 * Run: node server/src/services/__tests__/latestNewsSchedulingService.test.js
 */

const {
  computeEffectiveStatus,
  isPubliclyVisible,
  isValidCtaUrl,
  validateCampaignFields,
  validateItemFields,
} = require('../latestNewsSchedulingService');

let passed = 0;
let failed = 0;

function assert(cond, message) {
  if (cond) {
    console.log(`  PASS: ${message}`);
    passed += 1;
  } else {
    console.error(`  FAIL: ${message}`);
    failed += 1;
  }
}

function assertEq(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

const NOW = new Date('2026-06-15T12:00:00.000Z');

console.log('\n── computeEffectiveStatus ────────────────────────────────');

assertEq(
  computeEffectiveStatus({ status: 'draft' }, NOW),
  'draft',
  'draft stays draft'
);

assertEq(
  computeEffectiveStatus({ status: 'archived' }, NOW),
  'archived',
  'archived stays archived'
);

assertEq(
  computeEffectiveStatus({
    status: 'scheduled',
    visibility_start_at: '2026-06-20T00:00:00.000Z',
  }, NOW),
  'scheduled',
  'future start → scheduled'
);

assertEq(
  computeEffectiveStatus({
    status: 'scheduled',
    visibility_start_at: '2026-06-01T00:00:00.000Z',
  }, NOW),
  'live',
  'past start + scheduled status → live'
);

assertEq(
  computeEffectiveStatus({
    status: 'live',
    visibility_end_at: '2026-06-10T00:00:00.000Z',
  }, NOW),
  'expired',
  'past end → expired'
);

assertEq(
  computeEffectiveStatus({
    status: 'live',
    visibility_start_at: '2026-06-01T00:00:00.000Z',
    visibility_end_at: '2026-07-01T00:00:00.000Z',
  }, NOW),
  'live',
  'within window → live'
);

console.log('\n── isPubliclyVisible ───────────────────────────────────');

assert(
  isPubliclyVisible({ status: 'live' }, NOW),
  'live item is public'
);

assert(
  !isPubliclyVisible({ status: 'draft' }, NOW),
  'draft is not public'
);

assert(
  !isPubliclyVisible({
    status: 'scheduled',
    visibility_start_at: '2026-06-20T00:00:00.000Z',
  }, NOW),
  'future scheduled is not public'
);

assert(
  !isPubliclyVisible({
    status: 'live',
    visibility_end_at: '2026-06-10T00:00:00.000Z',
  }, NOW),
  'expired is not public'
);

console.log('\n── isValidCtaUrl ───────────────────────────────────────');

assert(isValidCtaUrl('/about'), 'relative path ok');
assert(isValidCtaUrl('https://orthodoxmetrics.com'), 'https ok');
assert(isValidCtaUrl(''), 'empty ok');
assert(!isValidCtaUrl('javascript:alert(1)'), 'javascript rejected');
assert(!isValidCtaUrl('not a url'), 'garbage rejected');

console.log('\n── validateItemFields ──────────────────────────────────');

assertEq(
  validateCampaignFields({ title: '' }),
  'title is required',
  'campaign title required'
);

assertEq(
  validateCampaignFields({
    title: 'Hi',
    visibility_start_at: '2026-07-01T00:00:00.000Z',
    visibility_end_at: '2026-06-01T00:00:00.000Z',
  }),
  'visibility_end_at must be after visibility_start_at',
  'campaign date range validation'
);

assertEq(
  validateItemFields({ title: 'Hi', cta_url: 'https://x.com', cta_label: 'Go' }),
  null,
  'valid CTA pair'
);

console.log(`\n${'─'.repeat(56)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
