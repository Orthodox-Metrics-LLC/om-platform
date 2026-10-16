/**
 * Church 46 cemetery plot coordinates in the portal map world space (100×170).
 * Derived from section reference screenshots and authoritative Excel placement.
 *
 * World layout matches CemeteryMap.tsx: entrance south, memorial circle mid-map,
 * New Section north beyond the white gate.
 */

const ROAD_HALF = 3.2;
const GRAVE_GAP = 2.6;
const ROUNDABOUT = { x: 42, y: 62, r: 13 };
const ROUNDABOUT_CLEAR = { x: 42, y: 62, r: 16 };

const SPINE_PTS = [
  [42, 72],
  [45, 82],
  [47, 104],
  [49, 128],
  [50, 150],
  [52, 162],
];

const PLOT_W = 3.4;
const PLOT_H = 3.0;
const COL_STEP = 3.3;
const ROW_STEP = 2.8;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function spineCenterXAt(y) {
  if (y <= SPINE_PTS[0][1]) return SPINE_PTS[0][0];
  if (y >= SPINE_PTS[SPINE_PTS.length - 1][1]) return SPINE_PTS[SPINE_PTS.length - 1][0];
  for (let i = 1; i < SPINE_PTS.length; i++) {
    if (y <= SPINE_PTS[i][1]) {
      const [ax, ay] = SPINE_PTS[i - 1];
      const [bx, by] = SPINE_PTS[i];
      const t = (y - ay) / (by - ay);
      return ax + (bx - ax) * t;
    }
  }
  return SPINE_PTS[SPINE_PTS.length - 1][0];
}

function innerEdgeAt(y, side) {
  const dyc = Math.abs(y - ROUNDABOUT.y);
  if (dyc < ROUNDABOUT_CLEAR.r) {
    const halfChord = Math.sqrt(Math.max(0, ROUNDABOUT_CLEAR.r * ROUNDABOUT_CLEAR.r - dyc * dyc));
    return ROUNDABOUT.x + side * (halfChord + GRAVE_GAP);
  }
  const cx = spineCenterXAt(y);
  return cx + side * (ROAD_HALF + GRAVE_GAP);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** Section 1 — Page 3 west lawn (rows L1–L14). South entrance anchor: L1 at bottom. */
function section1Coords(row, pos) {
  const r = clamp(Number(row) || 1, 1, 14);
  const p = clamp(Number(pos) || 1, 1, 14);
  const y = round2(155 - (r - 1) * ROW_STEP);
  const inner = innerEdgeAt(y, -1);
  const x = round2(inner - (p - 1) * COL_STEP - PLOT_W / 2);
  return { map_x: x, map_y: y, map_w: PLOT_W, map_h: PLOT_H, map_page: 'pg3' };
}

/** Section 2 — east/west blocks (rows L15–L27 west, R2–R15 east). Stacks north from L14. */
function section2Coords(row, pos, side) {
  const r = clamp(Number(row) || 15, 15, 27);
  const p = clamp(Number(pos) || 1, 1, 12);
  const sd = String(side || 'W').toUpperCase() === 'E' ? 1 : -1;
  const l14Y = 155 - 13 * ROW_STEP;
  const y = sd < 0
    ? round2(l14Y - 3.2 - (r - 15) * 2.8)
    : round2(12 + (27 - r) * 2.0);
  const inner = innerEdgeAt(y, sd);
  const x = round2(inner + sd * ((p - 1) * COL_STEP + PLOT_W / 2));
  return { map_x: x, map_y: y, map_w: PLOT_W, map_h: PLOT_H, map_page: 'pg2' };
}

/** Section 3 — memorial lawn wrapping the circle (L28–L36 west, R16–R22 east). */
function section3Coords(row, pos, side) {
  const r = clamp(Number(row) || 16, 16, 36);
  const p = clamp(Number(pos) || 1, 1, 10);
  const sd = String(side || 'W').toUpperCase() === 'E' ? 1 : -1;
  const y = round2(58 + (r - 16) * 1.05);
  const inner = innerEdgeAt(y, sd);
  const x = round2(inner + sd * ((p - 1) * COL_STEP + PLOT_W / 2));
  return { map_x: x, map_y: y, map_w: PLOT_W, map_h: PLOT_H, map_page: 'pg1' };
}

/** New Section — arc north of the white gate (legacy fallback; prefer rowLayout grid). */
function newSectionCoords(row, pos, side) {
  const r = clamp(Number(row) || 1, 1, 90);
  const sd = String(side || 'M').toUpperCase();
  const cx = 58;
  const cy = 14;
  const rx = sd === 'N' ? 16 : 22;
  const ry = sd === 'N' ? 7.5 : 10;
  const angle = Math.PI * 0.12 + ((r - 1) / 89) * Math.PI * 0.76;
  const x = round2(cx + Math.cos(angle) * rx);
  const y = round2(cy + Math.sin(angle) * ry);
  return { map_x: x, map_y: y, map_w: PLOT_W, map_h: PLOT_H, map_page: 'pg1' };
}

/**
 * Compute map coordinates for a manifest plot row.
 * @param {{ section: string, side?: string, row?: string|number, position?: string|number }} plot
 */
function computePlotCoords(plot) {
  const section = String(plot.section || '').toUpperCase();
  const row = plot.row ?? '1';
  const pos = plot.position ?? '1';
  const side = plot.side ?? 'W';

  switch (section) {
    case '1':
      return section1Coords(row, pos);
    case '2':
      return section2Coords(row, pos, side);
    case '3':
      return section3Coords(row, pos, side);
    case 'NS':
      return newSectionCoords(row, pos, side);
    default:
      return section2Coords(row, pos, side);
  }
}

module.exports = {
  computePlotCoords,
  section1Coords,
  section2Coords,
  section3Coords,
  newSectionCoords,
  spineCenterXAt,
  innerEdgeAt,
  PLOT_W,
  PLOT_H,
};
