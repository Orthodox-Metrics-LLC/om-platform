#!/usr/bin/env node
/**
 * Regression check: Work Accountability Reports-tab vs Exceptions-Inbox reconciliation.
 *
 * Bug fixed (baseline commit b618d106e): workAccountabilityReportingService.parseReportPeriod
 * silently ignored `options.hours`, so /reports/summary always fell back to a 30-day preset
 * window regardless of what window the caller asked for. Since the Command Center's
 * Exceptions Inbox / Overview tabs are driven by the FilterBar's rolling-hours window
 * (default 24h), the Reports tab's executive_summary.governance_score /
 * exceptions_critical / exceptions_open never matched the Exceptions Inbox counts for the
 * "same" window — they weren't actually querying the same window at all.
 *
 * This script asserts that for a given rolling window (24h, 7d), the report's
 * executive_summary exception counts are IDENTICAL to a direct aggregateAccountability
 * query for that same window (the literal source of truth behind /overview and
 * /exceptions). It also smoke-checks that the legacy day-based presets (30d/60d/90d/6m/1y)
 * still build without error, so the fix doesn't regress existing reports.
 */
const path = require('path');
const SERVER_ROOT = require('path').resolve(__dirname, '../../../server');


process.chdir(SERVER_ROOT);

const aggregator = require(SERVER_ROOT + '/src/services/workAccountabilityAggregatorService');
const reporting = require(SERVER_ROOT + '/src/services/workAccountabilityReportingService');

let failures = 0;

function assertEqual(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: report=${actual} live=${expected}`);
  if (!ok) failures += 1;
  return ok;
}

async function checkRollingWindow(periodPreset, hours) {
  console.log(`\n[reconcile] period=${periodPreset} (hours=${hours})`);

  const live = await aggregator.aggregateAccountability({ hours, backfill: false });
  const liveOpen = live.exceptions.filter((e) => e.review_status === 'open').length;
  const liveCritical = live.exceptions.filter(
    (e) => e.severity === 'critical' && e.review_status === 'open',
  ).length;

  const report = await reporting.buildSummaryReport({ period: periodPreset, backfill: false });
  const es = report.executive_summary;

  console.log(`  window: report=${report.period.from}->${report.period.to} live=${live.window.from}->${live.window.to}`);

  // This is the deterministic check: it fails on the original bug (report.from defaulted
  // to a 30-day-ago date regardless of the requested `hours`) even against an empty/local
  // DB where the exception counts happen to both be zero.
  assertEqual('window.from', report.period.from, live.window.from);
  assertEqual('window.to', report.period.to, live.window.to);
  assertEqual('exceptions_open', es.exceptions_open, liveOpen);
  assertEqual('exceptions_critical', es.exceptions_critical, liveCritical);
  assertEqual('kpis.exceptions_open (live)', live.kpis.exceptions_open, liveOpen);
  assertEqual('kpis.exceptions_critical (live)', live.kpis.exceptions_critical, liveCritical);

  // governance_score is derived from the same (threads, exceptions) pair the report
  // already reconciles above — recompute independently here as a cross-check rather than
  // re-importing the private governanceScore() helper.
  const openExc = live.exceptions.filter((e) => e.review_status === 'open');
  const critical = openExc.filter((e) => e.severity === 'critical').length;
  const high = openExc.filter((e) => e.severity === 'high').length;
  const governed = live.threads.filter((t) => t.session || t.work_item).length;
  const governedPct = live.threads.length ? governed / live.threads.length : 0;
  let expectedScore = live.threads.length
    ? Math.max(0, Math.min(100, Math.round(governedPct * 70) - critical * 15 - high * 5 - openExc.length * 2))
    : null;
  assertEqual('governance_score', es.governance_score, expectedScore);
}

async function checkLegacyPresetsStillWork() {
  console.log('\n[reconcile] legacy day-based presets still build (no regression)...');
  for (const period of ['30d', '60d', '90d', '6m', '1y']) {
    const report = await reporting.buildSummaryReport({ period, backfill: false });
    const ok = report?.executive_summary && report.period.key === period && report.period.days > 0;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] period=${period} -> days=${report?.period?.days} key=${report?.period?.key}`);
    if (!ok) failures += 1;
  }
}

async function main() {
  await checkRollingWindow('24h', 24);
  await checkRollingWindow('7d', 168);
  await checkLegacyPresetsStillWork();

  console.log(`\n[reconcile] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[reconcile] FAILED:', err);
  process.exit(1);
});
