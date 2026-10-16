/**
 * Operator-confirmed plots missing from the authoritative workbook.
 * Merged after xlsx parse; geometry comes from rows.json via computeLayoutCoords.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SERVER_ROOT = resolve(__dirname, '../../../server');
const REPO_ROOT = resolve(__dirname, '../../..');
const __dirname = dirname(fileURLToPath(import.meta.url));
const { computeLayoutCoords } = require(SERVER_ROOT + '/src/services/cemetery/rowLayout.js');

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Build a synthetic left-field (L01–L14) plot record.
 * @param {{ row:number, pos:number, number:string, kind:'na'|'cross', status?:string,
 *           displayNumbers?:string, familyCrest?:string, occupants?:string[],
 *           reference:string, note:string }} spec
 */
function leftFieldPlot(spec) {
  const key = `SSPPOC-L${pad2(spec.row)}-P${pad2(spec.pos)}`;
  return {
    plot_key: key,
    stable_location_id: key,
    section: '1',
    section_name: 'Section 1',
    side: 'W',
    row: String(spec.row),
    position: String(spec.pos),
    normalized_row: `L${spec.row}`,
    position_in_row: String(spec.pos),
    region_code: 'L01-L14',
    cemetery_area: 'Main Cemetery',
    landmark_zone: 'West field — rows L1–L14',
    location_description: `West field — rows L1–L14; row L${spec.row}; position ${spec.pos}; grave ${spec.displayNumbers || spec.number}; ${spec.note}`,
    placement_basis: `Operator reference image ${spec.reference} + calibrated rows.json slot P${pad2(spec.pos)}`,
    placement_confidence: 'High — geometry calibrated',
    plot_number: spec.number,
    display_numbers: spec.displayNumbers || spec.number,
    status: spec.status || (spec.kind === 'na' ? 'unavailable' : 'occupied'),
    plot_kind: spec.kind,
    family_crest: spec.familyCrest || '',
    occupants: spec.occupants || [],
    map_side: 'Left',
    source_page: 'Page 3 / L1-L14',
    source_row_area: `L${spec.row}`,
    source_grave_number: spec.number,
    source_row_order: 1,
    row_number: spec.row,
    review_note: spec.note,
    synthetic: true,
  };
}

/**
 * Build a synthetic right-field (R01–R14, east of the central road) plot record.
 * Mirror of leftFieldPlot for the east side. Geometry comes from rows.json (R1…).
 * @param {{ row:number, pos:number, number:string, kind:'grave'|'na'|'cross',
 *           status?:string, displayNumbers?:string, familyCrest?:string,
 *           occupants?:string[], reference:string, note:string }} spec
 */
function rightFieldPlot(spec) {
  const key = `SSPPOC-R${pad2(spec.row)}-P${pad2(spec.pos)}`;
  return {
    plot_key: key,
    stable_location_id: key,
    section: '1',
    section_name: 'Section 1',
    side: 'E',
    row: String(spec.row),
    position: String(spec.pos),
    normalized_row: `R${spec.row}`,
    position_in_row: String(spec.pos),
    region_code: 'R01-R14',
    cemetery_area: 'Main Cemetery',
    landmark_zone: 'East field — rows R1–R14',
    location_description: `East field — rows R1–R14; row R${spec.row}; position ${spec.pos}; grave ${spec.displayNumbers || spec.number}; ${spec.note}`,
    placement_basis: `Operator road-side reading + calibrated rows.json slot P${pad2(spec.pos)} (mirror of L14 across road)`,
    placement_confidence:
      spec.kind === 'na' ? 'High — geometry calibrated' : 'Medium — number-only slot; occupant unknown',
    plot_number: spec.number,
    display_numbers: spec.displayNumbers || spec.number,
    status: spec.status || (spec.kind === 'na' ? 'unavailable' : 'occupied'),
    plot_kind: spec.kind,
    family_crest: spec.familyCrest || '',
    occupants: spec.occupants || [],
    map_side: 'Right',
    source_page: 'Right-side R1 (operator road-side reading)',
    source_row_area: `R${spec.row}`,
    source_grave_number: spec.number,
    source_row_order: 1,
    row_number: spec.row,
    review_note: spec.note,
    synthetic: true,
  };
}

/**
 * N/A numbered slots (no headstone / unoccupied) confirmed from the left-side
 * reference row images. Rendered as RED boxes with their grave number.
 * @type {Array<{row:number,pos:number,number:string,reference:string}>}
 */
const NA_SLOTS = [
  { row: 1, pos: 4, number: '939', reference: '1-3G.png' },
  { row: 1, pos: 2, number: '941', reference: '1-3G.png' },
  { row: 1, pos: 1, number: '942', reference: '1-3G.png' },
  { row: 2, pos: 3, number: '934', reference: '2-3G.png' },
  { row: 2, pos: 2, number: '935', reference: '2-3G.png' },
  { row: 2, pos: 1, number: '936', reference: '2-3G.png' },
  { row: 3, pos: 3, number: '928', reference: '3-3G.png' },
  { row: 3, pos: 2, number: '929', reference: '3-3G.png' },
  { row: 3, pos: 1, number: '930', reference: '3-3G.png' },
  { row: 4, pos: 3, number: '922', reference: '4-4G.png' },
  { row: 4, pos: 2, number: '923', reference: '4-4G.png' },
  { row: 10, pos: 6, number: '883', reference: '10-4G.png' },
  { row: 10, pos: 4, number: '885', reference: '10-4G.png' },
];

/**
 * Right side Row 1 (R1) — east of the central road, directly across from L14.
 * Operator road-side reading (closest→farthest from road): 57, 56, 55, 54, 53, 52.
 * Graves 57–53 are occupied blue slots (number-only — no occupant names exist in
 * the workbook; do NOT fabricate). Grave 52 is an N/A red slot (still numbered).
 * Absent from the authoritative workbook; injected here pending operator names.
 * @type {Array<{pos:number,number:string,kind:'grave'|'na'}>}
 */
const RIGHT_R1_SLOTS = [
  { pos: 1, number: '57', kind: 'grave' },
  { pos: 2, number: '56', kind: 'grave' },
  { pos: 3, number: '55', kind: 'grave' },
  { pos: 4, number: '54', kind: 'grave' },
  { pos: 5, number: '53', kind: 'grave' },
  { pos: 6, number: '52', kind: 'na' },
];

/** @type {Array<Record<string, unknown>>} */
export const SYNTHETIC_PLOTS = [
  ...RIGHT_R1_SLOTS.map((s) =>
    rightFieldPlot({
      row: 1,
      pos: s.pos,
      number: s.number,
      kind: s.kind,
      reference: 'R1 (operator road-side reading)',
      note:
        s.kind === 'na'
          ? 'N/A numbered slot — no headstone / unoccupied (operator: 52 across from L14, farthest from road)'
          : 'East-field R1 grave — number-only (occupant/crest absent from workbook; confirm with operator)',
    }),
  ),
  leftFieldPlot({
    row: 14, pos: 2, number: '863', kind: 'cross', status: 'occupied',
    occupants: ['Kozma Trushko'],
    reference: '14-6G.png',
    note: 'Orthodox cross marker — Kozma Trushko (operator-confirmed; absent from workbook transcription)',
  }),
  leftFieldPlot({
    row: 2, pos: 6, number: '931', displayNumbers: '931/932', kind: 'cross', status: 'occupied',
    familyCrest: 'Chromoho', occupants: ['Chromoho'],
    reference: '2-3G.png',
    note: 'Orthodox cross marker — Chromoho 931/932 (from reference image; occupant names ambiguous — confirm with operator)',
  }),
  leftFieldPlot({
    row: 5, pos: 4, number: '915', kind: 'cross', status: 'occupied',
    occupants: ['Charles Bradley'],
    reference: '5-7G.png',
    note: 'Orthodox cross marker — Charles Bradley (shared 915; from reference image)',
  }),
  ...NA_SLOTS.map((s) =>
    leftFieldPlot({
      ...s,
      kind: 'na',
      note: 'N/A numbered slot — no headstone / unoccupied (from reference image)',
    }),
  ),
];

/**
 * @param {Array<Record<string, unknown>>} plots
 * @returns {Array<Record<string, unknown>>}
 */
export function mergeSyntheticPlots(plots) {
  const byKey = new Map(plots.map((p) => [p.plot_key || p.stable_location_id, p]));
  const merged = [...plots];

  for (const synthetic of SYNTHETIC_PLOTS) {
    const key = synthetic.plot_key;
    if (byKey.has(key)) continue;
    const coords = computeLayoutCoords(synthetic);
    merged.push({ ...synthetic, ...coords, geometrySource: coords.geometrySource || 'explicit' });
    byKey.set(key, synthetic);
  }

  return merged;
}
