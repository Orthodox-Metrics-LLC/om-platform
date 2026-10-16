#!/usr/bin/env npx tsx
/**
 * Unit tests for websiteStatsSegments.js
 * Run: npx tsx server/src/services/__tests__/websiteStatsSegments.test.ts
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const segments: any = require('../websiteStatsSegments');

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('websiteStatsSegments');

test('classifies public marketing paths', () => {
  assert(segments.isPublicPath('/'), true);
  assert(segments.isPublicPath('/about'), true);
  assert(segments.isPublicPath('/auth/login'), true);
  assert(segments.isPublicPath('/help/user-guide'), true);
  assert(segments.isPublicPath('/blog/post-1'), true);
  assert(segments.isPublicPath('/portal/records'), false);
});

test('classifies OM application paths', () => {
  assert(segments.isAppPath('/portal'), true);
  assert(segments.isAppPath('/portal/certificates'), true);
  assert(segments.isAppPath('/admin/assets'), true);
  assert(segments.isAppPath('/om-daily/board'), true);
  assert(segments.isAppPath('/devel/ocr-studio'), true);
  assert(segments.isAppPath('/account/profile'), true);
  assert(segments.isAppPath('/about'), false);
});

test('excludes OMAI bridge from segments', () => {
  assert(segments.isExcludedPath('/admin/omai'), true);
  assert(segments.matchesSegment('/admin/omai', 'app'), false);
  assert(segments.matchesSegment('/admin/omai', 'all'), false);
});

test('applySegmentToStats filters top pages and derives totals', () => {
  const base = {
    provider: 'plausible',
    period: '7d',
    totals: {
      visitors: 1000,
      pageviews: 2500,
      bounce_rate: 40,
      visit_duration: 90,
    },
    top_pages: [
      { page: '/', visitors: 400, pageviews: 500 },
      { page: '/portal/records', visitors: 120, pageviews: 300 },
      { page: '/admin/omai', visitors: 50, pageviews: 50 },
      { page: '/about', visitors: 80, pageviews: 100 },
    ],
    top_referrers: [{ source: 'Google', visitors: 200 }],
  };

  const publicStats = segments.applySegmentToStats(base, 'public');
  assert(publicStats.segment === 'public', 'segment should be public');
  assert(publicStats.top_pages.length === 2, 'public should include / and /about');
  assert(publicStats.totals.pageviews === 600, 'public pageviews sum');
  assert(publicStats.top_referrers.length === 0, 'referrers hidden for segments');
  assert(publicStats.totals_derived === true, 'derived flag set');

  const appStats = segments.applySegmentToStats(base, 'app');
  assert(appStats.top_pages.length === 1, 'app should only include /portal/records');
  assert(appStats.totals.pageviews === 300, 'app pageviews sum');
});

test('normalizeSegment defaults to all', () => {
  assert(segments.normalizeSegment(undefined) === 'all', 'default all');
  assert(segments.normalizeSegment('PUBLIC') === 'public', 'case insensitive');
  assert(segments.normalizeSegment('bogus') === 'all', 'invalid -> all');
});

console.log('All websiteStatsSegments tests passed.');
