#!/usr/bin/env node
/**
 * Work Accountability — Monthly Activity (commits / threads / exceptions)
 * bucketing tests.
 *
 * Proves the commit-bucketing regression fix:
 *   - Commits bucket by EACH commit's own author timestamp, NOT the thread's
 *     single last_activity_at. Root cause of the "July spike": a long-lived
 *     branch (main) accumulated ~1,900 commits spanning Feb–Jul but had one
 *     recent last_activity_at, so `row.commits += t.commits.length` dumped every
 *     commit into the current month's bucket.
 *   - Works when commit.timestamp is a JS **Date** object (defensive) as well as
 *     an ISO string.
 *   - Out-of-window commits are dropped (same in-window key set as completions).
 *   - Threads still bucket by last_activity_at; exceptions ride the thread bucket.
 *   - A thread with commits but NO last_activity_at still contributes its commits
 *     to the right months (commits no longer depend on the thread having `at`).
 *
 * Run: node server/src/services/__tests__/workAccountabilityActivityBucketing.test.js
 * Exits non-zero on any failure (CI-friendly).
 */

/* eslint-disable no-console */
const { resolveWorkAccountabilityRange } = require('../workAccountabilityRange');
const { buildActivityTrends } = require('../workAccountabilityReportingService');

let passed = 0;
let failed = 0;

function assertEq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`  FAIL: ${message}\n         expected: ${e}\n         actual:   ${a}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

const NOW = new Date('2026-07-01T08:26:00.000Z');
const r6 = resolveWorkAccountabilityRange({ range: '6m', now: NOW });

function commit(ts) {
  return { sha: String(ts).slice(0, 10), timestamp: ts };
}

// A "main" thread: last activity is TODAY (July) but commits span Feb–Jul.
// Pre-fix, all 6 commits collapsed into 2026-07. Post-fix they spread out.
const mainThread = {
  id: 'orthodoxmetrics::main',
  timestamps: { last_activity_at: '2026-07-01T04:00:00Z', started_at: '2026-02-10T00:00:00Z' },
  exceptions: [{ type: 'x' }],
  work_item: null,
  commits: [
    commit('2026-02-15T10:00:00Z'),
    commit('2026-03-20T10:00:00Z'),
    // Date OBJECT (what a caller could hand us) — must still bucket by its month.
    commit(new Date('2026-04-05T10:00:00Z')),
    commit('2026-05-08T04:57:18Z'),
    commit('2026-06-25T10:00:00Z'),
    commit('2026-07-01T02:00:00Z'),
  ],
};

// A thread with commits but NO activity timestamp at all — commits must still
// bucket (they no longer depend on the thread having last_activity_at/started_at).
const noTsThread = {
  id: 'omai::feature-branch',
  timestamps: { last_activity_at: null, started_at: null },
  exceptions: [],
  work_item: null,
  commits: [commit('2026-04-18T09:00:00Z'), commit('2026-06-02T09:00:00Z')],
};

// An out-of-window commit (before the 6m window) must be dropped.
const outOfWindowThread = {
  id: 'orthodoxmetrics::old',
  timestamps: { last_activity_at: '2026-06-10T00:00:00Z', started_at: null },
  exceptions: [],
  work_item: null,
  commits: [commit('2025-11-01T10:00:00Z'), commit('2026-06-11T10:00:00Z')],
};

console.log('\n── Commits bucket per-commit timestamp (July-spike regression) ──');
const trends = buildActivityTrends([mainThread, noTsThread, outOfWindowThread], r6, null);
const byMonth = Object.fromEntries(trends.trends.map((b) => [b.period, b]));

assertEq(byMonth['2026-02'].commits, 1, 'Feb commit lands in 2026-02 (not July)');
assertEq(byMonth['2026-03'].commits, 1, 'Mar commit lands in 2026-03');
assertEq(byMonth['2026-04'].commits, 2, 'Apr commits (incl. Date object + no-ts thread) land in 2026-04');
assertEq(byMonth['2026-05'].commits, 1, 'May commit lands in 2026-05');
assertEq(byMonth['2026-06'].commits, 3, 'Jun commits (main + no-ts + out-of-window in-range) land in 2026-06');
assertEq(byMonth['2026-07'].commits, 1, 'Only the genuine July commit lands in 2026-07 (NOT all 6+)');

const totalCommits = trends.trends.reduce((a, b) => a + b.commits, 0);
assertEq(totalCommits, 9, 'exactly 9 in-window commits charted (out-of-window 2025-11 commit dropped)');

console.log('\n── Threads / exceptions still bucket by last_activity_at ──');
// mainThread(July) + outOfWindowThread(June) have timestamps; noTsThread does not.
assertEq(byMonth['2026-07'].threads, 1, 'main thread counted in its July activity bucket');
assertEq(byMonth['2026-06'].threads, 1, 'out-of-window-commit thread counted in its June activity bucket');
assertEq(byMonth['2026-07'].exceptions, 1, 'exception rides the thread last-activity bucket');
assertEq(
  trends.trends.reduce((a, b) => a + b.threads, 0), 2,
  'only the 2 threads with a last_activity_at contribute to the threads series',
);

console.log('\n──────────────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
