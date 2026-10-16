#!/usr/bin/env node
/**
 * Work Accountability — calendar-month bucketing + completion-timestamp tests.
 *
 * Proves the "Last 6 months" fix:
 *   - 6m/3m/12m resolve to CALENDAR-month-aligned windows (exactly N month
 *     buckets ending with the current month), NOT a rolling 183-day span that
 *     bled into 7–8 partial-month buckets.
 *   - Completed work items are bucketed by their ACTUAL completion timestamp
 *     (completed_at → github_pr_merged_at), so earlier-month archived
 *     completions land in the correct month instead of the recent-activity month.
 *   - Completions with completion ts outside the window are excluded.
 *   - Inferred (completed_at_source = 'inferred_from_updated_at') completions are
 *     counted as inferred.
 *   - completedInWindow / KPI totals reconcile with the chart buckets.
 *
 * Run: node server/src/services/__tests__/workAccountabilityBucketing.test.js
 * Exits non-zero on any failure (CI-friendly).
 */

/* eslint-disable no-console */
const {
  resolveWorkAccountabilityRange,
} = require('../workAccountabilityRange');
const {
  buildActivityTrends,
} = require('../workAccountabilityReportingService');
const {
  workItemCompletion,
  completedInWindow,
  isWithinWindow,
} = require('../workAccountabilityAggregatorService');

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

function assertTrue(cond, message) {
  if (!cond) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

// Fixed "now": 2026-07-01 (matches the task scenario).
const NOW = new Date('2026-07-01T08:26:00.000Z');

function doneThread(id, completedAt, opts = {}) {
  return {
    id,
    commits: opts.commits || [],
    exceptions: opts.exceptions || [],
    timestamps: {
      // last activity is deliberately "recent" for archived items — proves the
      // completion is bucketed by completion_at, not last_activity_at.
      last_activity_at: opts.lastActivity || NOW.toISOString(),
      started_at: null,
    },
    work_item: {
      id,
      code: `OMOD-${id}`,
      status: 'done',
      completed_at: completedAt,
      completed_at_source: opts.source || 'transition',
      github_pr_merged_at: opts.prMergedAt || null,
    },
  };
}

// ── resolveWorkAccountabilityRange: calendar-month alignment ─────────────────
console.log('\n── Calendar-month window resolution (now = 2026-07-01) ──');

const r6 = resolveWorkAccountabilityRange({ range: '6m', now: NOW });
assertEq(r6.mode, 'calendar', '6m → calendar mode');
assertEq(r6.bucket, 'month', '6m → month bucket');
assertEq(r6.from, '2026-02-01', '6m start = first day of (current month - 5) = 2026-02-01');
assertEq(r6.to, '2026-07-01', '6m end = today');
assertEq(r6.months, 6, '6m → months=6');

const r3 = resolveWorkAccountabilityRange({ range: '3m', now: NOW });
assertEq(r3.from, '2026-05-01', '3m start = 2026-05-01');
assertEq(r3.bucket, 'month', '3m → month bucket');

const r12 = resolveWorkAccountabilityRange({ range: '12m', now: NOW });
assertEq(r12.from, '2025-08-01', '12m start = 2025-08-01');

// ── Bucket keys: EXACTLY N months, ending current month ──────────────────────
console.log('\n── Bucket key generation ────────────────────────────────');

const trends6 = buildActivityTrends([], r6, null);
assertEq(
  trends6.bucketKeys,
  ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'],
  '6m → exactly 6 month buckets (2026-02 … 2026-07), no 2025-12 / extra months',
);
assertEq(trends6.bucketKeys.length, 6, '6m → exactly 6 buckets (not 7, not 8)');
assertEq(buildActivityTrends([], r3, null).bucketKeys, ['2026-05', '2026-06', '2026-07'], '3m → exactly 3 buckets');
assertEq(buildActivityTrends([], r12, null).bucketKeys.length, 12, '12m → exactly 12 buckets');

// ── Completions bucketed by completion timestamp across all 6 months ─────────
console.log('\n── Archived completions bucket into correct month ───────');

const threads = [
  doneThread(1, '2026-02-15T10:00:00Z'), // archived, activity is "now"
  doneThread(2, '2026-03-10T10:00:00Z'),
  doneThread(3, '2026-04-20T10:00:00Z'),
  doneThread(4, '2026-05-05T10:00:00Z'),
  doneThread(5, '2026-06-25T10:00:00Z'),
  doneThread(6, '2026-07-01T04:00:00Z'), // earlier today (completion ts is always <= now)
  // Out-of-window completion (Dec 2025) — must be excluded from buckets.
  doneThread(7, '2025-12-20T10:00:00Z'),
  // Inferred completion (completed_at folded from updated_at).
  doneThread(8, '2026-06-15T10:00:00Z', { source: 'inferred_from_updated_at' }),
  // No completed_at, but a real PR-merge completion event in-window.
  doneThread(9, null, { prMergedAt: '2026-05-18T10:00:00Z' }),
];

const diag = { inferred_completions: 0, completions_without_ts: 0, completed_by_field: {} };
const t = buildActivityTrends(threads, r6, diag);
const byPeriod = Object.fromEntries(t.trends.map((b) => [b.period, b.completed]));

assertEq(t.trends.length, 6, 'trend rows == 6 buckets');
assertEq(byPeriod['2026-02'], 1, 'Feb completion counted in 2026-02');
assertEq(byPeriod['2026-03'], 1, 'Mar completion counted in 2026-03');
assertEq(byPeriod['2026-04'], 1, 'Apr completion counted in 2026-04');
assertEq(byPeriod['2026-05'], 2, 'May: 1 completed_at + 1 github_pr_merged_at fallback = 2');
assertEq(byPeriod['2026-06'], 2, 'Jun: 1 normal + 1 inferred = 2');
assertEq(byPeriod['2026-07'], 1, 'Jul completion counted in 2026-07');

const totalCompleted = t.trends.reduce((a, b) => a + b.completed, 0);
assertEq(totalCompleted, 8, 'total charted completions = 8 (Dec 2025 excluded)');
assertEq(diag.inferred_completions, 1, 'exactly 1 inferred completion flagged');
assertEq(diag.completed_by_field.completed_at, 7, '7 completions via completed_at');
assertEq(diag.completed_by_field.github_pr_merged_at, 1, '1 completion via github_pr_merged_at');

// ── completedInWindow reconciles with chart total ────────────────────────────
console.log('\n── KPI completedInWindow reconciles with chart ──────────');

const inWin = completedInWindow(threads, r6.start, r6.end);
assertEq(inWin, totalCompleted, 'completedInWindow == sum of charted completions (KPI matches chart)');

// ── workItemCompletion priority + isWithinWindow ─────────────────────────────
console.log('\n── Completion timestamp priority ────────────────────────');

assertEq(
  workItemCompletion({ completed_at: '2026-03-01 00:00:00', completed_at_source: 'explicit', github_pr_merged_at: '2026-01-01 00:00:00' }),
  { ts: '2026-03-01 00:00:00', inferred: false, field: 'completed_at' },
  'completed_at wins over github_pr_merged_at',
);
assertEq(
  workItemCompletion({ completed_at: null, github_pr_merged_at: '2026-05-18 10:00:00' }),
  { ts: '2026-05-18 10:00:00', inferred: false, field: 'github_pr_merged_at' },
  'falls back to github_pr_merged_at when completed_at is null',
);
assertEq(
  workItemCompletion({ completed_at: '2026-06-15 10:00:00', completed_at_source: 'inferred_from_updated_at' }),
  { ts: '2026-06-15 10:00:00', inferred: true, field: 'completed_at' },
  'inferred_from_updated_at flags inferred=true (never silently trusted)',
);
assertEq(workItemCompletion({}), { ts: null, inferred: false, field: null }, 'no completion ts → null');

assertTrue(isWithinWindow('2026-04-01 00:00:00', r6.start, r6.end), '2026-04 is within 6m window');
assertTrue(!isWithinWindow('2025-12-20 00:00:00', r6.start, r6.end), '2025-12 is outside 6m window');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
