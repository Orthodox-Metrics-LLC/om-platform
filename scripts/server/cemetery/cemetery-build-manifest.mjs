#!/usr/bin/env node
/**
 * Build church cemetery import manifest from authoritative Excel or legacy seed JSON.
 *
 * Excel source (authoritative for church 46):
 *   tmp/ssppoc_all_grave_mappings_with_locations.xlsx
 *
 * Usage:
 *   node server/scripts/cemetery-build-manifest.mjs --source xlsx --file tmp/ssppoc_all_grave_mappings_single_sheet.xlsx
 *   node server/scripts/cemetery-build-manifest.mjs [--church-id 46] [--seed cemetery-seed-data.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseCemeteryXlsx } from './cemetery-xlsx-parser.mjs';
import { mergeSyntheticPlots } from './cemetery-synthetic-plots.mjs';
import { applyOperatorOverrides, excludeRegions } from './cemetery-operator-overrides.mjs';

const require = createRequire(import.meta.url);
const SERVER_ROOT = resolve(__dirname, '../../../server');
const REPO_ROOT = resolve(__dirname, '../../..');
const {
  buildPlotKey,
  parsePlotLabel,
  normalizeDisplayNumbers,
  toCanonicalSection,
  dedupeManifestRows,
  CANONICAL_SECTION_NAMES,
} = require(SERVER_ROOT + '/src/services/cemetery/plotKey.js');
const { computeLayoutCoords, findRowGaps } = require(SERVER_ROOT + '/src/services/cemetery/rowLayout.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { churchId: 46, out: null, seed: null, source: 'seed', file: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--church-id') opts.churchId = Number(args[++i]);
    else if (args[i] === '--out') opts.out = args[++i];
    else if (args[i] === '--seed') opts.seed = args[++i];
    else if (args[i] === '--source') opts.source = args[++i];
    else if (args[i] === '--file') opts.file = args[++i];
  }
  return opts;
}

const DEFAULT_SIDES = { '1': 'W', '2': 'E', '3': 'S', NS: 'M' };

function seedRowToManifestRow(p, section, rowCounter) {
  const canonical = toCanonicalSection(section);
  const parsed = parsePlotLabel(p.plot_number);
  const side = parsed.sideSuffix || DEFAULT_SIDES[canonical] || 'M';
  const display = normalizeDisplayNumbers(p.plot_number);
  const row = String(rowCounter.row);
  const position = String(rowCounter.pos);
  rowCounter.pos += 1;
  if (rowCounter.pos > 20) {
    rowCounter.row += 1;
    rowCounter.pos = 1;
  }

  const occupants = [];
  if (p.surname) occupants.push(p.surname);
  for (const g of p.given_names || []) {
    if (g && !occupants.includes(g)) occupants.push(g);
  }

  return {
    plot_key: buildPlotKey(canonical, side, row, position),
    section: canonical,
    section_name: CANONICAL_SECTION_NAMES[canonical] || canonical,
    side,
    row,
    position,
    plot_number: display,
    display_numbers: display,
    status: p.status || 'available',
    occupants,
    map_x: p.x ?? null,
    map_y: p.y ?? null,
    map_page: p.page || 'pg1',
    source_section: section,
    source_plot_number: p.plot_number,
  };
}

function attachMapCoords(plots) {
  return plots.map((p) => {
    const coords = computeLayoutCoords(p);
    return { ...p, ...coords };
  });
}

function buildFromXlsx(filePath, churchId) {
  const abs = resolve(REPO_ROOT, filePath);
  const { rows, stats, sheetName } = parseCemeteryXlsx(abs);
  const withoutNs = excludeRegions(rows);
  const merged = applyOperatorOverrides(mergeSyntheticPlots(withoutNs));
  const plots = attachMapCoords(merged);
  const rowGaps = findRowGaps(plots);

  return {
    schemaVersion: 2,
    churchId,
    pickupId: 'OMPKT-20260711-0001',
    generatedAt: new Date().toISOString(),
    source: abs,
    sourceType: 'xlsx',
    sourceSheet: sheetName,
    excelStats: stats,
    rowGaps,
    sections: Object.entries(CANONICAL_SECTION_NAMES).map(([code, name]) => ({ code, name })),
    plots,
  };
}

function buildFromSeed(opts) {
  const seedPath = opts.seed || join(__dirname, 'cemetery-seed-data.json');
  const data = JSON.parse(readFileSync(seedPath, 'utf8'));

  const rawRows = [];
  const counters = { '1': { row: 1, pos: 1 }, '2': { row: 1, pos: 1 }, '3': { row: 1, pos: 1 }, NS: { row: 1, pos: 1 } };

  for (const p of data.plots) {
    const sec = toCanonicalSection(p.section);
    if (!counters[sec]) counters[sec] = { row: 1, pos: 1 };
    rawRows.push(seedRowToManifestRow(p, p.section, counters[sec]));
  }

  const deduped = dedupeManifestRows(rawRows);

  return {
    schemaVersion: 1,
    churchId: opts.churchId,
    pickupId: 'OMPKT-20260710-0001',
    generatedAt: new Date().toISOString(),
    source: seedPath,
    sourceType: 'seed',
    warning:
      'Row/position are sequential placeholders until om-cemetery-church-46.docx manifest is ingested. Do not apply to production without operator approval.',
    sections: Object.entries(CANONICAL_SECTION_NAMES).map(([code, name]) => ({ code, name })),
    plots: deduped,
  };
}

function main() {
  const opts = parseArgs();
  const xlsxDefault = 'tmp/ssppoc_all_grave_mappings_with_locations.xlsx';

  let manifest;
  if (opts.source === 'xlsx') {
    const file = opts.file || xlsxDefault;
    manifest = buildFromXlsx(file, opts.churchId);
  } else {
    manifest = buildFromSeed(opts);
  }

  const outPath =
    opts.out || join(SERVER_ROOT, 'assets/cemetery-map', `church-${opts.churchId}`, 'import-manifest.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const bySection = {};
  const byStatus = {};
  for (const p of manifest.plots) {
    bySection[p.section] = (bySection[p.section] || 0) + 1;
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  }

  console.log(`Wrote manifest: ${outPath}`);
  console.log(`  source: ${manifest.sourceType} (${manifest.source})`);
  console.log(`  physical graves: ${manifest.plots.length}`);
  if (manifest.excelStats) {
    console.log(`  excel source rows: ${manifest.excelStats.sourceRows}`);
  }
  console.log(`  by section:`, bySection);
  console.log(`  by status:`, byStatus);
}

main();
