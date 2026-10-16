#!/usr/bin/env node
/**
 * Calibrate L01–L14 explicit row geometry from operator reference images.
 * Reference: tmp/cemetery-rows/left-side/{row}-{count}G.png
 *
 * Road = east anchor; growDirection west; reversePositionOrder maps high
 * position_in_row to the road (plot numbers decrease toward the road).
 *
 * Usage:
 *   node server/scripts/cemetery-calibrate-left-rows.mjs
 *   node server/scripts/cemetery-calibrate-left-rows.mjs --dry-run
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, '../../../server');
const REPO_ROOT = join(__dirname, '../../..');

/** Per-row slot steps (westward distance from slot i to i+1; index 0 = road side). */
const LEFT_ROW_SLOTS = {
  L1: {
    endPosition: 6,
    referenceImage: '1-3G.png',
    slotSteps: [3.2, 1.1, 3.4, 2.1, 3.5, 2.6],
    notes: '937 road; bush; 938; 939 N/A; 940; 941/942 empty west',
  },
  L2: {
    endPosition: 6,
    referenceImage: '2-3G.png',
    slotSteps: [1.8, 3.8, 3.8, 2.4, 2.4, 2.4],
    notes: '931/932 cross road; twin 933; 934–936 empty west',
  },
  L3: {
    endPosition: 6,
    referenceImage: '3-3G.png',
    slotSteps: [3.3, 3.3, 3.3, 2.4, 2.4, 2.4],
    notes: '925–927 occupied; 928–930 empty west',
  },
  L4: {
    endPosition: 6,
    referenceImage: '4-4G.png',
    slotSteps: [3.3, 3.3, 3.3, 2.2, 1.6, 3.4],
    notes: '919–921 graves; gap 922; tree 923; 924 west',
  },
  L5: {
    endPosition: 7,
    referenceImage: '5-7G.png',
    slotSteps: [2.4, 4.0, 3.6, 1.8, 3.8, 3.6, 3.4],
    notes: '913×2, shared 915, 914–917 complex',
  },
  L6: {
    endPosition: 5,
    referenceImage: '6-5G.png',
    slotSteps: [3.3, 3.3, 3.3, 3.3, 3.8],
    notes: '907–911 Rosocha/Fedchin/Cimpko; west tree gap',
  },
  L7: {
    endPosition: 6,
    referenceImage: '7-6G.png',
    notes: '906–901 uniform',
  },
  L8: {
    endPosition: 5,
    referenceImage: '8-5G.png',
    notes: '900–895/896 uniform',
  },
  L9: {
    endPosition: 7,
    referenceImage: '9-7G.png',
    notes: '894–889 uniform',
  },
  L10: {
    endPosition: 6,
    referenceImage: '10-4G.png',
    slotSteps: [1.5, 3.4, 1.5, 4.2, 3.4, 3.4],
    notes: 'trees 883/885; graves 884,886,887,888',
  },
  L11: {
    endPosition: 7,
    referenceImage: '11-7G.png',
    notes: '882–877 uniform',
  },
  L12: {
    endPosition: 7,
    referenceImage: '12-7G.png',
    notes: '876–871 uniform',
  },
  L13: {
    endPosition: 6,
    referenceImage: '13-6G.png',
    notes: '870–865 uniform',
  },
  L14: {
    endPosition: 6,
    referenceImage: '14-6G.png',
    slotSteps: [3.3, 3.3, 3.3, 1.8, 3.3, 3.3],
    notes: '859 road; cross 863; 864 west',
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  return { churchId: 46, dryRun: args.includes('--dry-run') };
}

function applyCalibration(rowsDoc) {
  let updated = 0;
  for (const row of rowsDoc.rows) {
    const cal = LEFT_ROW_SLOTS[row.normalizedRow];
    if (!cal) continue;
    row.reversePositionOrder = true;
    row.growDirection = 'west';
    row.endPosition = cal.endPosition;
    if (cal.slotSteps) row.slotSteps = cal.slotSteps;
    else delete row.slotSteps;
    row.referenceImage = cal.referenceImage;
    row.calibrationNotes = cal.notes;
    updated++;
  }
  rowsDoc.calibratedAt = new Date().toISOString();
  rowsDoc.calibrationSource = 'tmp/cemetery-rows/left-side/';
  return updated;
}

function main() {
  const opts = parseArgs();
  const path = join(
    __dirname,
    '../cemetery-map',
    `church-${opts.churchId}`,
    'geometry',
    'rows.json',
  );
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const count = applyCalibration(doc);
  console.log(`Calibrated ${count} left-side rows in ${path}`);
  if (!opts.dryRun) {
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
    console.log('Wrote rows.json');
  }
}

main();
