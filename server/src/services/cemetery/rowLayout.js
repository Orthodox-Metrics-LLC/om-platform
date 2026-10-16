/**
 * Row-layout engine for church 46 cemetery map.
 * Groups by Region Code + Normalized Row, orders by Position in Row.
 * Gaps in position are preserved as empty slots along the row axis.
 *
 * Authoritative keys:
 *   physical  → normalized_row + position_in_row
 *   stable    → stable_location_id
 */

const { computePlotCoords, PLOT_W, PLOT_H } = require('./sectionLayout.js');
const { computePlotGeometry, computeContentBounds: geometryContentBounds } = require('./geometryEngine.js');

/** Region code → canonical section + default road side */
const REGION_META = {
  'L01-L14': { section: '1', side: 'W', label: 'West field L1–L14' },
  'R01-R14': { section: '1', side: 'E', label: 'East field R1–R14' },
  'L15-L27': { section: '2', side: 'W', label: 'West upper L15–L27' },
  'R02-R15': { section: '2', side: 'E', label: 'East upper R2–R15' },
  'L28-L36-CIRCLE': { section: '3', side: 'W', label: 'Circle west L28–L36' },
  'R16-R22-CIRCLE': { section: '3', side: 'E', label: 'Circle east R16–R22' },
  'NEW-MN': { section: 'NS', side: 'M', label: 'New Section M/N' },
};

/**
 * @param {string} regionCode
 * @returns {{ section: string, side: string, label: string } | null}
 */
function regionMeta(regionCode) {
  return REGION_META[String(regionCode || '').trim()] || null;
}

/**
 * @param {string} normalizedRow e.g. L14, R22, M-01
 * @param {string} regionCode
 * @returns {string|number|null}
 */
function numericRowFromNormalized(normalizedRow, regionCode) {
  const nr = String(normalizedRow || '').trim();
  if (regionCode === 'NEW-MN') {
    const m = nr.match(/^([MN])-(\d+)$/i);
    return m ? `${m[1].toUpperCase()}-${m[2]}` : nr;
  }
  const m = nr.match(/^[LR](\d+)$/i);
  return m ? Number(m[1]) : null;
}

/**
 * New Section M/N grid north of the white gate.
 * M rows stack west of center; N rows east. Position in row is the column slot.
 */
function newSectionGridCoords(normalizedRow, positionInRow) {
  const m = String(normalizedRow || '').match(/^([MN])-(\d+)$/i);
  const pos = Number(positionInRow) || 1;
  if (!m) {
    return { map_x: 58, map_y: 14, map_w: PLOT_W, map_h: PLOT_H, map_page: 'pg1' };
  }
  const band = m[1].toUpperCase();
  const rowIdx = Number(m[2]);
  const rowStep = 2.6;
  const colStep = 2.8;
  const baseY = 6 + (rowIdx - 1) * rowStep;
  const centerX = band === 'M' ? 44 : 72;
  const dir = band === 'M' ? -1 : 1;
  const x = centerX + dir * ((pos - 1) * colStep + PLOT_W / 2);
  return {
    map_x: Math.round(x * 100) / 100,
    map_y: Math.round(baseY * 100) / 100,
    map_w: PLOT_W,
    map_h: PLOT_H,
    map_page: 'pg1',
    side: band,
  };
}

/**
 * Compute map coordinates from authoritative placement fields.
 * @param {{
 *   region_code: string,
 *   normalized_row: string,
 *   position_in_row: string|number,
 *   section?: string,
 *   side?: string,
 *   row?: string|number,
 *   position?: string|number,
 * }} plot
 */
function computeLayoutCoords(plot) {
  const region = String(plot.region_code || '').trim();
  const meta = regionMeta(region);
  const normalizedRow = String(plot.normalized_row || plot.row || '').trim();
  const positionInRow = Number(plot.position_in_row ?? plot.position) || 1;

  if (region === 'NEW-MN') {
    const coords = computePlotGeometry(
      {
        ...plot,
        section: plot.section || 'NS',
        side: plot.side || meta?.side || 'M',
        row: normalizedRow,
        position: positionInRow,
        normalized_row: normalizedRow,
        position_in_row: positionInRow,
        region_code: region,
      },
      46,
    );
    return { ...coords, side: plot.side || meta?.side || 'M' };
  }

  const numericRow = numericRowFromNormalized(normalizedRow, region);
  const section = plot.section || meta?.section || '1';
  const side = plot.side || meta?.side || 'W';

  const coords = computePlotGeometry(
    {
      ...plot,
      section,
      side,
      row: numericRow ?? plot.row ?? '1',
      position: positionInRow,
      normalized_row: normalizedRow,
      position_in_row: positionInRow,
      region_code: region,
    },
    46,
  );

  return { ...coords, side };
}

/**
 * Group manifest plots into row buckets for layout validation.
 * @param {Array<Record<string, unknown>>} plots
 */
function groupByRow(plots) {
  const groups = new Map();
  for (const p of plots) {
    const key = `${p.region_code || ''}::${p.normalized_row || p.row}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  for (const [, rows] of groups) {
    rows.sort((a, b) => Number(a.position_in_row ?? a.position) - Number(b.position_in_row ?? b.position));
  }
  return groups;
}

/**
 * Detect position gaps within each row group.
 * @param {Array<Record<string, unknown>>} plots
 * @returns {Array<{ region_code: string, normalized_row: string, missing_positions: number[] }>}
 */
function findRowGaps(plots) {
  const gaps = [];
  for (const [, rowPlots] of groupByRow(plots)) {
    if (!rowPlots.length) continue;
    const positions = rowPlots.map((p) => Number(p.position_in_row ?? p.position)).sort((a, b) => a - b);
    const missing = [];
    for (let i = positions[0]; i < positions[positions.length - 1]; i++) {
      if (!positions.includes(i)) missing.push(i);
    }
    if (missing.length) {
      gaps.push({
        region_code: rowPlots[0].region_code,
        normalized_row: rowPlots[0].normalized_row,
        missing_positions: missing,
      });
    }
  }
  return gaps;
}

/**
 * Content bounding box for map viewport fitting (world coords).
 * @param {Array<{ map_x: number, map_y: number, map_w?: number, map_h?: number }>} plots
 */
function computeContentBounds(plots) {
  return geometryContentBounds(plots, 46);
}

module.exports = {
  REGION_META,
  regionMeta,
  numericRowFromNormalized,
  computeLayoutCoords,
  groupByRow,
  findRowGaps,
  computeContentBounds,
  newSectionGridCoords,
};
