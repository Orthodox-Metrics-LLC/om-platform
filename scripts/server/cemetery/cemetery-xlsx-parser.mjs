/**
 * Parse SSPPOC authoritative cemetery Excel into manifest plot rows.
 *
 * Authoritative source: tmp/ssppoc_all_grave_mappings_with_locations.xlsx
 * Sheet: "All Grave Mappings"
 *
 * Placement fields (do NOT infer from grave numbers):
 *   Cemetery Area, Region Code, Section, Relative Side, Landmark Zone
 *   Normalized Row, Row Number, Source Row Order, Position in Row
 *   Stable Location ID, Location Description, Placement Basis, Placement Confidence
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SERVER_ROOT = resolve(__dirname, '../../../server');
const REPO_ROOT = resolve(__dirname, '../../..');
const __dirname = dirname(fileURLToPath(import.meta.url));

const { normalizeDisplayNumbers, CANONICAL_SECTION_NAMES } = require(SERVER_ROOT + '/src/services/cemetery/plotKey.js');
const { regionMeta, numericRowFromNormalized } = require(SERVER_ROOT + '/src/services/cemetery/rowLayout.js');
const { detectPlotKind } = require(SERVER_ROOT + '/src/services/cemetery/displayNames.js');

function loadXlsx() {
  try {
    return require('xlsx');
  } catch {
    return require(join(REPO_ROOT, 'front-end/node_modules/xlsx'));
  }
}

const COL = {
  mapSide: 0,
  sourcePage: 1,
  rowArea: 2,
  position: 3,
  graveNumber: 4,
  familyLabel: 5,
  markerNames: 6,
  mapStatus: 9,
  reviewNote: 10,
  cemeteryArea: 13,
  regionCode: 14,
  section: 15,
  relativeSide: 16,
  landmarkZone: 17,
  normalizedRow: 18,
  rowNumber: 19,
  sourceRowOrder: 20,
  positionInRow: 21,
  stableLocationId: 22,
  locationDescription: 23,
  placementBasis: 24,
  placementConfidence: 25,
};

/** @param {string} relativeSide */
function mapSideFromRelative(relativeSide, regionCode) {
  const rs = String(relativeSide || '').trim().toLowerCase();
  if (regionCode === 'NEW-MN') {
    if (rs.includes('north')) return 'N';
    if (rs.includes('center')) return 'M';
    return 'M';
  }
  if (rs.includes('west')) return 'W';
  if (rs.includes('east')) return 'E';
  const meta = regionMeta(regionCode);
  return meta?.side || 'W';
}

/** @param {string} status @param {string} review */
export function mapStatus(status, review) {
  const s = String(status || '').trim().toLowerCase();
  const r = String(review || '').trim().toLowerCase();
  if (s.includes('n/a') || s.includes('unusable')) return 'unavailable';
  if (r.includes('cross marker') || r.includes('orthodox cross')) return 'occupied';
  if (s.includes('available')) return 'available';
  if (s.includes('occupied')) return 'occupied';
  return 'available';
}

/** @param {string} markerNames @param {string} familyLabel */
export function parseOccupants(markerNames, familyLabel) {
  const fromMarkers = String(markerNames || '')
    .split(/[;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromMarkers.length) return fromMarkers;
  const fam = String(familyLabel || '').trim();
  if (fam && !/^\d/.test(fam)) return [fam];
  return [];
}

/**
 * @param {string} filePath absolute or relative path to .xlsx
 * @returns {{ rows: object[], stats: object }}
 */
export function parseCemeteryXlsx(filePath) {
  const XLSX = loadXlsx();
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames.find((n) => n.includes('Grave')) || wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  const headerIdx = raw.findIndex((r) => r[COL.stableLocationId] === 'Stable Location ID');
  if (headerIdx < 0) {
    throw new Error('Stable Location ID header row not found — use ssppoc_all_grave_mappings_with_locations.xlsx');
  }

  const dataRows = raw.slice(headerIdx + 1).filter((r) => r[COL.stableLocationId] || r[COL.graveNumber]);
  const ambiguous = [];
  const stableIds = new Set();
  const rowPosKeys = new Set();

  const parsed = [];
  for (const r of dataRows) {
    const stableId = String(r[COL.stableLocationId] || '').trim();
    const regionCode = String(r[COL.regionCode] || '').trim();
    const normalizedRow = String(r[COL.normalizedRow] || '').trim();
    const positionInRow = String(r[COL.positionInRow] || r[COL.position] || '1').trim();
    const graveNumber = String(r[COL.graveNumber] || '').trim();

    if (!stableId) {
      ambiguous.push({ reason: 'missing_stable_location_id', grave: graveNumber });
      continue;
    }
    if (stableIds.has(stableId)) {
      ambiguous.push({ reason: 'duplicate_stable_location_id', stableId });
      continue;
    }
    stableIds.add(stableId);

    const rowPosKey = `${normalizedRow}|${positionInRow}`;
    if (rowPosKeys.has(rowPosKey)) {
      ambiguous.push({ reason: 'duplicate_normalized_row_position', key: rowPosKey, stableId });
    }
    rowPosKeys.add(rowPosKey);

    const meta = regionMeta(regionCode);
    if (!meta) {
      ambiguous.push({ reason: 'unknown_region_code', regionCode, stableId });
    }

    const section = meta?.section || '1';
    const side = mapSideFromRelative(r[COL.relativeSide], regionCode);
    const numericRow = numericRowFromNormalized(normalizedRow, regionCode);
    const rowForDb = numericRow != null ? String(numericRow) : normalizedRow;
    const display = graveNumber ? normalizeDisplayNumbers(graveNumber) : '';
    const familyCrest = String(r[COL.familyLabel] || '').trim();
    const reviewNote = String(r[COL.reviewNote] || '').trim();
    const plotKind = detectPlotKind(reviewNote, r[COL.mapStatus]);

    parsed.push({
      plot_key: stableId,
      stable_location_id: stableId,
      section,
      section_name: CANONICAL_SECTION_NAMES[section] || section,
      side,
      row: rowForDb,
      position: positionInRow,
      normalized_row: normalizedRow,
      position_in_row: positionInRow,
      region_code: regionCode,
      cemetery_area: String(r[COL.cemeteryArea] || '').trim(),
      landmark_zone: String(r[COL.landmarkZone] || '').trim(),
      location_description: String(r[COL.locationDescription] || '').trim(),
      placement_basis: String(r[COL.placementBasis] || '').trim(),
      placement_confidence: String(r[COL.placementConfidence] || '').trim(),
      plot_number: display || graveNumber || stableId,
      display_numbers: display,
      status: mapStatus(r[COL.mapStatus], reviewNote),
      plot_kind: plotKind,
      family_crest: familyCrest && !/^\d/.test(familyCrest) ? familyCrest : '',
      occupants: parseOccupants(r[COL.markerNames], r[COL.familyLabel]),
      map_side: r[COL.mapSide],
      source_page: r[COL.sourcePage],
      source_row_area: r[COL.rowArea],
      source_grave_number: graveNumber,
      source_row_order: r[COL.sourceRowOrder],
      row_number: r[COL.rowNumber],
      review_note: reviewNote,
    });
  }

  const stats = {
    sections: {},
    regions: {},
    status: {},
    sourceRows: dataRows.length,
    physical: parsed.length,
    ambiguous: ambiguous.length,
    ambiguousDetails: ambiguous,
  };
  for (const p of parsed) {
    stats.sections[p.section] = (stats.sections[p.section] || 0) + 1;
    stats.regions[p.region_code] = (stats.regions[p.region_code] || 0) + 1;
    stats.status[p.status] = (stats.status[p.status] || 0) + 1;
  }

  return { rows: parsed, stats, sheetName, sourceFile: filePath };
}
