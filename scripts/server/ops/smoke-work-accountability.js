#!/usr/bin/env node
/**
 * Smoke test for /api/work-accountability routes and reporting service.
 */
const path = require('path');
const SERVER_ROOT = require('path').resolve(__dirname, '../../../server');


process.chdir(SERVER_ROOT);

const aggregator = require(SERVER_ROOT + '/src/services/workAccountabilityAggregatorService');
const reporting = require(SERVER_ROOT + '/src/services/workAccountabilityReportingService');

const PERIODS = ['30d', '60d', '90d', '6m', '1y'];

async function main() {
  console.log('[smoke] aggregateAccountability...');
  const agg = await aggregator.aggregateAccountability({ hours: 24, backfill: false });
  console.log('[smoke] KPIs:', JSON.stringify(agg.kpis));
  console.log('[smoke] threads:', agg.threads.length, 'exceptions:', agg.exceptions.length);

  const timeline = aggregator.buildTimeline(agg);
  console.log('[smoke] timeline days:', timeline.length);

  console.log('[smoke] buildDailyReport (delegated to reporting service)...');
  const daily = await reporting.buildDailyReport({ hours: 24, backfill: false });
  console.log('[smoke] daily report lines:', daily.markdown.split('\n').length);

  for (const period of PERIODS) {
    console.log(`[smoke] summary period=${period}...`);
    const report = await reporting.buildSummaryReport({ period, backfill: false });
    console.log(`[smoke]   threads=${report.executive_summary.threads} governance=${report.executive_summary.governance_score}`);
    const md = reporting.generateMarkdown(report);
    console.log(`[smoke]   markdown lines=${md.split('\n').length}`);
    const csv = reporting.generateCombinedCsv(report);
    console.log(`[smoke]   csv bytes=${csv.length}`);
  }

  const router = require(SERVER_ROOT + '/src/routes/work-accountability');
  console.log('[smoke] router loaded:', typeof router === 'function' || typeof router?.handle === 'function');
  console.log('[smoke] OK');
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err);
  process.exit(1);
});
