#!/usr/bin/env node
/**
 * Work Accountability — archived-completed inclusion + completion-timestamp
 * resolution tests.
 *
 * Proves the remaining monthly-analytics fixes:
 *   - Monthly Completion buckets correctly when completed_at is a JS **Date**
 *     object (MySQL datetime), not just an ISO string. This is the root cause the
 *     earlier string-only fixtures never caught: monthKey(Date) previously
 *     produced "Fri May" and every monthly bucket rendered 0.
 *   - An archived completed item from N months ago appears in the correct month.
 *   - Archived completed items are excluded from the ACTIVE queue.
 *   - Non-archived active items ARE in the active queue.
 *   - completed_at wins over archived_at (archived_at is never a completion date).
 *   - Completion EVENT timestamp fallback fills in when completed_at + PR-merge
 *     are both null.
 *   - A Done item with no resolvable completion timestamp is reported as
 *     data-quality drift and excluded from monthly completion.
 *   - Selected range → exactly N month buckets (6m→6, 3m→3).
 *
 * Run: node server/src/services/__tests__/workAccountabilityArchivedCompletions.test.js
 * Exits non-zero on any failure (CI-friendly).
 */

/* eslint-disable no-console */
const { resolveWorkAccountabilityRange } = require('../workAccountabilityRange');
const { buildActivityTrends } = require('../workAccountabilityReportingService');
const { completedInWindow } = require('../workAccountabilityAggregatorService');
const {
  buildItemsWhere,
  resolveCompletionTimestamp,
  completionDataQuality,
} = require('../workAccountabilityItemsRepository');

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
  if (!cond) { console.error(`  FAIL: ${message}`); failed++; } else { console.log(`  PASS: ${message}`); passed++; }
}

const NOW = new Date('2026-07-01T08:26:00.000Z');
const r6 = resolveWorkAccountabilityRange({ range: '6m', now: NOW });
const r3 = resolveWorkAccountabilityRange({ range: '3m', now: NOW });

/** A done thread whose completion timestamp may be a Date OR a string. */
function doneThread(id, completedAt, opts = {}) {
  return {
    id,
    commits: [],
    exceptions: [],
    timestamps: { last_activity_at: NOW.toISOString(), started_at: null },
    work_item: {
      id,
      code: `OMOD-${id}`,
      status: 'done',
      completed_at: completedAt,
      completed_at_source: opts.source || 'transition',
      github_pr_merged_at: opts.prMergedAt || null,
      completion_event_at: opts.completionEventAt || null,
      completion_event_type: opts.completionEventType || null,
      archived: !!opts.archivedAt,
      archived_at: opts.archivedAt || null,
    },
  };
}

// ── Root cause: Date-object completed_at buckets into the right month ─────────
console.log('\n── Date-object completed_at bucketing (root cause regression) ──');

const dateThreads = [
  // completed_at as real JS Date objects (what MySQL returns) across months.
  doneThread(1, new Date('2026-02-15T10:00:00Z')),
  doneThread(2, new Date('2026-04-20T10:00:00Z'), { archivedAt: new Date('2026-06-01T00:00:00Z') }),
  doneThread(3, new Date('2026-05-08T04:57:18Z'), { archivedAt: new Date('2026-06-01T00:00:00Z') }),
  doneThread(4, new Date('2026-07-01T04:00:00Z')),
];
const dDiag = { inferred_completions: 0, completions_without_ts: 0, completed_by_field: {} };
const dTrends = buildActivityTrends(dateThreads, r6, dDiag);
const dByPeriod = Object.fromEntries(dTrends.trends.map((b) => [b.period, b.completed]));
assertEq(dByPeriod['2026-02'], 1, 'Date-object Feb completion → 2026-02 (not dropped)');
assertEq(dByPeriod['2026-04'], 1, 'Date-object archived Apr completion → 2026-04');
assertEq(dByPeriod['2026-05'], 1, 'Date-object archived May completion → 2026-05');
assertEq(dByPeriod['2026-07'], 1, 'Date-object Jul completion → 2026-07');
assertEq(dTrends.trends.reduce((a, b) => a + b.completed, 0), 4, 'all 4 Date-object completions charted');

// ── Archived completed item from 5 months ago appears in monthly completion ──
console.log('\n── Archived completion from 5 months ago ─────────────────');
const fiveMonthsAgo = [doneThread(10, new Date('2026-02-10T12:00:00Z'), { archivedAt: new Date('2026-06-20T00:00:00Z') })];
const fmTrends = buildActivityTrends(fiveMonthsAgo, r6, null);
const fmByPeriod = Object.fromEntries(fmTrends.trends.map((b) => [b.period, b.completed]));
assertEq(fmByPeriod['2026-02'], 1, 'archived (5mo ago) completed item counted in 2026-02');
assertEq(completedInWindow(fiveMonthsAgo, r6.start, r6.end), 1, 'KPI counts the archived 5-mo-ago completion');

// ── Active queue excludes archived completed; includes active non-archived ───
console.log('\n── Active queue archived exclusion ───────────────────────');
const isActiveQueue = (t) => !!t.work_item && !['done', 'cancelled'].includes(t.work_item.status);
const archivedDone = doneThread(20, new Date('2026-02-10T12:00:00Z'), { archivedAt: new Date('2026-06-20T00:00:00Z') });
const activeItem = {
  id: 21, commits: [], exceptions: [], timestamps: { last_activity_at: NOW.toISOString() },
  work_item: { id: 21, code: 'OMOD-21', status: 'in_progress', completed_at: null, archived: false, archived_at: null },
};
assertTrue(!isActiveQueue(archivedDone), 'archived completed item NOT in active queue');
assertTrue(isActiveQueue(activeItem), 'active non-archived item IS in active queue');

// ── completed_at beats archived_at (archived_at never a completion date) ──────
console.log('\n── completed_at beats archived_at ────────────────────────');
assertEq(
  resolveCompletionTimestamp({
    status: 'done',
    completed_at: '2026-04-20 10:00:00',
    archived_at: '2026-06-01 00:00:00',
  }),
  { ts: '2026-04-20 10:00:00', inferred: false, field: 'completed_at' },
  'completed_at wins; archived_at ignored for completion',
);

// ── Completion EVENT fallback when completed_at + PR-merge null ───────────────
console.log('\n── Completion event fallback ─────────────────────────────');
assertEq(
  resolveCompletionTimestamp({
    status: 'done', completed_at: null, github_pr_merged_at: null,
    completion_event_at: '2026-05-18 10:00:00', completion_event_type: 'work_completed',
  }),
  { ts: '2026-05-18 10:00:00', inferred: false, field: 'completion_event:work_completed' },
  'falls back to completion event timestamp when completed_at + PR-merge null',
);
const evThread = doneThread(30, null, { completionEventAt: new Date('2026-03-12T09:00:00Z'), completionEventType: 'agent_completed' });
const evTrends = buildActivityTrends([evThread], r6, { inferred_completions: 0, completions_without_ts: 0, completed_by_field: {} });
assertEq(
  Object.fromEntries(evTrends.trends.map((b) => [b.period, b.completed]))['2026-03'], 1,
  'event-fallback completion buckets into 2026-03',
);

// ── Missing completion timestamp → data-quality drift, excluded from chart ───
console.log('\n── Missing completion timestamp = data-quality drift ─────');
const driftItems = [
  { id: 40, status: 'done', completed_at: null, github_pr_merged_at: null, completion_event_at: null, archived_at: '2026-05-01 00:00:00' },
  { id: 41, status: 'done', completed_at: '2026-05-05 10:00:00', archived_at: '2026-06-01 00:00:00' },
];
const dq = completionDataQuality(driftItems);
assertEq(dq.done_without_completion_ts_count, 1, 'exactly 1 done item flagged with no completion ts');
assertEq(dq.archived_completed_missing_ts_count, 1, 'archived+completed missing ts flagged');
const driftThread = doneThread(40, null, { archivedAt: '2026-05-01 00:00:00' });
const driftDiag = { inferred_completions: 0, completions_without_ts: 0, completed_by_field: {} };
buildActivityTrends([driftThread], r6, driftDiag);
assertEq(driftDiag.completions_without_ts, 1, 'no-timestamp completion excluded from chart + counted as drift');

// ── Selected range → exactly N month buckets ─────────────────────────────────
console.log('\n── Range → N buckets ─────────────────────────────────────');
assertEq(buildActivityTrends([], r6, null).bucketKeys.length, 6, '6m → exactly 6 buckets');
assertEq(buildActivityTrends([], r3, null).bucketKeys.length, 3, '3m → exactly 3 buckets');

// ── Shared WHERE builder: archived inclusion semantics ───────────────────────
console.log('\n── Shared items WHERE builder ────────────────────────────');
const wHist = buildItemsWhere({ sqlFrom: '2026-02-01 00:00:00', includeArchivedCompleted: true });
assertTrue(/archived_at IS NULL OR status = 'done' OR completed_at IS NOT NULL/.test(wHist.where),
  'historical WHERE keeps non-archived + archived-completed rows');
const wActive = buildItemsWhere({ sqlFrom: '2026-02-01 00:00:00', includeArchivedCompleted: false });
assertTrue(/archived_at IS NULL/.test(wActive.where) && !/status = 'done' OR completed_at/.test(wActive.where),
  'active WHERE excludes every archived row');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
