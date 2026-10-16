#!/usr/bin/env node
/**
 * Reconcile authoritative workbook vs manifest and/or tenant DB.
 *
 * Usage:
 *   node server/scripts/cemetery-reconcile-workbook.mjs
 *   node server/scripts/cemetery-reconcile-workbook.mjs --church-id 46 --db om_church_46
 *   node server/scripts/cemetery-reconcile-workbook.mjs --manifest path/to/import-manifest.json
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import mysql from 'mysql2/promise';
import { parseCemeteryXlsx } from './cemetery-xlsx-parser.mjs';

const require = createRequire(import.meta.url);
const SERVER_ROOT = resolve(__dirname, '../../../server');
const REPO_ROOT = resolve(__dirname, '../../..');
const { EXPECTED_PHYSICAL_TOTAL, EXPECTED_SECTION_TOTALS } = require(SERVER_ROOT + '/src/services/cemetery/plotKey.js');
const { findRowGaps } = require(SERVER_ROOT + '/src/services/cemetery/rowLayout.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    churchId: 46,
    xlsx: 'tmp/ssppoc_all_grave_mappings_with_locations.xlsx',
    manifest: null,
    db: null,
    writeReport: true,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--church-id') opts.churchId = Number(args[++i]);
    else if (args[i] === '--xlsx') opts.xlsx = args[++i];
    else if (args[i] === '--manifest') opts.manifest = args[++i];
    else if (args[i] === '--db') opts.db = args[++i];
    else if (args[i] === '--no-report') opts.writeReport = false;
  }
  return opts;
}

function manifestPath(churchId, override) {
  return override || join(SERVER_ROOT, 'assets/cemetery-map', `church-${churchId}`, 'import-manifest.json');
}

async function loadDbPlots(dbName) {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'orthodoxapps',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
  });
  const [rows] = await conn.query(
    `SELECT p.plot_key AS plotKey, p.plot_number AS plotNumber,
            p.display_numbers AS displayNumbers, p.status,
            s.code AS section, p.side, r.number AS rowNo, p.position
       FROM cemetery_plots p
       JOIN cemetery_sections s ON s.id = p.section_id
       LEFT JOIN cemetery_rows r ON r.id = p.row_id`,
  );
  await conn.end();
  return rows;
}

function reconcile(workbookPlots, renderedPlots, label) {
  const wbByStable = new Map(workbookPlots.map((p) => [p.stable_location_id || p.plot_key, p]));
  const renByKey = new Map(renderedPlots.map((p) => [p.plot_key || p.plotKey, p]));

  const missingInRendered = [];
  const extraInRendered = [];
  const graveMismatches = [];
  const occupiedMissingNames = [];

  for (const [sid, wb] of wbByStable) {
    const ren = renByKey.get(sid);
    if (!ren) {
      missingInRendered.push(sid);
      continue;
    }
    const wbGrave = wb.display_numbers || wb.plot_number;
    const renGrave = ren.display_numbers || ren.displayNumbers || ren.plot_number || ren.plotNumber;
    if (wbGrave && renGrave && wbGrave !== renGrave) {
      graveMismatches.push({ stableId: sid, workbook: wbGrave, rendered: renGrave });
    }
    if (wb.status === 'occupied' && !(wb.occupants?.length)) {
      occupiedMissingNames.push(sid);
    }
  }

  for (const key of renByKey.keys()) {
    if (!wbByStable.has(key)) extraInRendered.push(key);
  }

  const dupStable = [];
  const seenStable = new Set();
  for (const p of workbookPlots) {
    const sid = p.stable_location_id || p.plot_key;
    if (seenStable.has(sid)) dupStable.push(sid);
    seenStable.add(sid);
  }

  const dupRowPos = [];
  const seenRowPos = new Map();
  for (const p of workbookPlots) {
    const k = `${p.normalized_row}|${p.position_in_row}`;
    if (seenRowPos.has(k)) dupRowPos.push({ key: k, ids: [seenRowPos.get(k), p.stable_location_id] });
    seenRowPos.set(k, p.stable_location_id);
  }

  const rowGaps = findRowGaps(workbookPlots);

  return {
    label,
    workbookCount: workbookPlots.length,
    renderedCount: renderedPlots.length,
    expectedTotal: EXPECTED_PHYSICAL_TOTAL,
    missingInRendered,
    extraInRendered,
    duplicateStableIds: dupStable,
    duplicateRowPosition: dupRowPos,
    graveNumberMismatches: graveMismatches,
    occupiedMissingNames,
    rowGaps,
    sectionTotals: {
      workbook: countBy(workbookPlots, 'section'),
      rendered: countBy(renderedPlots, (p) => p.section || p.sectionCode),
      expected: EXPECTED_SECTION_TOTALS,
    },
    pass:
      workbookPlots.length === EXPECTED_PHYSICAL_TOTAL &&
      missingInRendered.length === 0 &&
      extraInRendered.length === 0 &&
      dupStable.length === 0 &&
      dupRowPos.length === 0 &&
      graveMismatches.length === 0,
  };
}

function countBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = typeof keyFn === 'function' ? keyFn(item) : item[keyFn];
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

async function main() {
  const opts = parseArgs();
  const xlsxPath = join(REPO_ROOT, opts.xlsx);
  const { rows: workbookPlots, stats } = parseCemeteryXlsx(xlsxPath);

  const manifestFile = manifestPath(opts.churchId, opts.manifest);
  const manifest = existsSync(manifestFile)
    ? JSON.parse(readFileSync(manifestFile, 'utf8'))
    : null;

  const report = {
    generatedAt: new Date().toISOString(),
    xlsx: xlsxPath,
    workbookStats: stats,
    reconciliations: [],
  };

  if (manifest?.plots) {
    report.reconciliations.push(reconcile(workbookPlots, manifest.plots, 'workbook-vs-manifest'));
  }

  if (opts.db || opts.churchId) {
    const dbName = opts.db || `om_church_${opts.churchId}`;
    try {
      const dbPlots = await loadDbPlots(dbName);
      report.reconciliations.push(
        reconcile(
          workbookPlots,
          dbPlots.map((p) => ({
            plot_key: p.plotKey,
            plot_number: p.plotNumber,
            display_numbers: p.displayNumbers,
            section: p.section,
            status: p.status,
          })),
          `workbook-vs-db-${dbName}`,
        ),
      );
    } catch (e) {
      report.dbError = e.message;
    }
  }

  const primary = report.reconciliations[0];
  console.log('=== Cemetery Workbook Reconciliation ===');
  console.log(`Workbook plots: ${workbookPlots.length} (expected ${EXPECTED_PHYSICAL_TOTAL})`);
  if (stats.ambiguous) console.log(`Ambiguous/skipped: ${stats.ambiguous}`);
  for (const r of report.reconciliations) {
    console.log(`\n--- ${r.label} ---`);
    console.log(`  rendered count: ${r.renderedCount}`);
    console.log(`  missing in rendered: ${r.missingInRendered.length}`);
    console.log(`  extra in rendered: ${r.extraInRendered.length}`);
    console.log(`  duplicate stable IDs: ${r.duplicateStableIds.length}`);
    console.log(`  duplicate row+position: ${r.duplicateRowPosition.length}`);
    console.log(`  grave mismatches: ${r.graveNumberMismatches.length}`);
    console.log(`  row gaps: ${r.rowGaps.length}`);
    console.log(`  section totals:`, r.sectionTotals);
    console.log(`  PASS: ${r.pass}`);
  }

  if (opts.writeReport) {
    const outDir = join(SERVER_ROOT, 'assets/cemetery-map', `church-${opts.churchId}`);
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'reconciliation-report.json');
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nReport written: ${outPath}`);
  }

  const allPass = report.reconciliations.every((r) => r.pass);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('RECONCILE ERROR', e.message);
  process.exit(1);
});
