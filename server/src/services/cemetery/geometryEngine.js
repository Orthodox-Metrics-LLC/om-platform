/**
 * Explicit cemetery geometry engine — maps workbook placement to SVG world coordinates.
 *
 * Authoritative geometry config: server/assets/cemetery-map/church-{id}/geometry/
 *   world.json — viewBox, roads, traffic circle, cameras
 *   rows.json  — per Normalized Row explicit layout
 *
 * Falls back to legacy sectionLayout.js for rows not yet calibrated.
 */
const fs = require('fs');
const path = require('path');
const { computePlotCoords: legacyPlotCoords, PLOT_W, PLOT_H } = require('./sectionLayout.js');

const GEOMETRY_CACHE = new Map();

function geometryDir(churchId) {
  return path.resolve(__dirname, '../../../assets/cemetery-map', `church-${churchId}`, 'geometry');
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * @param {number} churchId
 * @returns {{ world: object|null, rows: object|null, rowByKey: Map<string, object> }}
 */
function loadGeometry(churchId = 46) {
  const key = String(churchId);
  if (GEOMETRY_CACHE.has(key)) return GEOMETRY_CACHE.get(key);

  const dir = geometryDir(churchId);
  const world = loadJson(path.join(dir, 'world.json'));
  const rowsDoc = loadJson(path.join(dir, 'rows.json'));
  const rowByKey = new Map();
  for (const row of rowsDoc?.rows || []) {
    rowByKey.set(String(row.normalizedRow).trim(), row);
  }

  const bundle = { world, rows: rowsDoc, rowByKey };
  GEOMETRY_CACHE.set(key, bundle);
  return bundle;
}

function clearGeometryCache() {
  GEOMETRY_CACHE.clear();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function degToRad(d) {
  return (d * Math.PI) / 180;
}

/**
 * Compute plot center from explicit row config + position in row.
 * @param {object} rowCfg
 * @param {number} positionInRow
 * @returns {{ x: number, y: number }}
 */
function cumulativeSlotOffset(rowCfg, slotIndex) {
  const spacingX = rowCfg.plotSpacingX ?? 3.3;
  if (!Array.isArray(rowCfg.slotSteps) || !rowCfg.slotSteps.length) {
    return slotIndex * spacingX;
  }
  let along = 0;
  for (let i = 0; i < slotIndex; i++) {
    along += rowCfg.slotSteps[i] ?? spacingX;
  }
  return along;
}

/**
 * Resolve a row's anchor point. Straight rows use explicit anchorX/anchorY.
 * Circle rows (Section 3) use a `curvature` config to hug the traffic circle:
 * the circle-side plot is placed on a ring around the circle center at the
 * row's latitude (anchorY), and the row then extends horizontally west/east.
 * This keeps straight-row behavior unchanged (curvature null/undefined).
 * @param {object} rowCfg
 * @returns {{ anchorX: number, anchorY: number }}
 */
function resolveAnchor(rowCfg) {
  const c = rowCfg.curvature;
  if (c && typeof c === 'object' && c.mode === 'circle-hug') {
    const cx = Number.isFinite(c.centerX) ? c.centerX : 42;
    const cy = Number.isFinite(c.centerY) ? c.centerY : 62;
    const ring = Number.isFinite(c.ringRadius) ? c.ringRadius : 19.5;
    const anchorY = Number.isFinite(c.anchorY) ? c.anchorY : rowCfg.anchorY;
    const dy = anchorY - cy;
    const inside = ring * ring - dy * dy;
    const half = inside > 0 ? Math.sqrt(inside) : 0;
    const grow = String(rowCfg.growDirection || 'east').toLowerCase();
    const sign = grow === 'west' ? -1 : 1;
    return { anchorX: cx + sign * half, anchorY };
  }
  return { anchorX: rowCfg.anchorX, anchorY: rowCfg.anchorY };
}

function positionFromRowConfig(rowCfg, positionInRow) {
  const override = rowCfg.positionOverrides?.[String(positionInRow)];
  if (override?.x != null && override?.y != null) {
    return {
      x: override.x,
      y: override.y,
      map_w: override.map_w,
      map_h: override.map_h,
    };
  }

  const pos = Number(positionInRow) || 1;

  /** NEW-MN: workbook rows are horizontal bands; positions run column-major (3 slots down, then next column). */
  if (rowCfg.gridMode === 'column-major') {
    const slotsPerCol = Number(rowCfg.slotsPerColumn) || 3;
    const colOffset = Number(rowCfg.columnOffset) || 0;
    const colIndex = colOffset + Math.floor((pos - 1) / slotsPerCol);
    const slotIndex = (pos - 1) % slotsPerCol;
    const spacingX = rowCfg.plotSpacingX ?? 4.6;
    const spacingY = rowCfg.plotSpacingY ?? 0.85;
    const anchor = resolveAnchor(rowCfg);
    return {
      x: round2(anchor.anchorX + colIndex * spacingX),
      y: round2(anchor.anchorY + slotIndex * spacingY),
    };
  }
  const start = Number(rowCfg.startPosition) || 1;
  const end = Number(rowCfg.endPosition) || pos;
  const slotIndex = rowCfg.reversePositionOrder ? end - pos : pos - start;

  const spacingY = rowCfg.plotSpacingY ?? 0;
  const grow = String(rowCfg.growDirection || 'east').toLowerCase();
  const angle = degToRad(rowCfg.orientationDegrees || 0);
  let along = override?.offsetX != null ? Number(override.offsetX) : cumulativeSlotOffset(rowCfg, slotIndex);
  const across = 0;

  let dx = 0;
  let dy = 0;
  if (grow === 'west') {
    dx = -along;
  } else if (grow === 'east') {
    dx = along;
  } else if (grow === 'north') {
    dy = -along;
  } else if (grow === 'south') {
    dy = along;
  } else {
    dx = along;
  }

  if (angle !== 0) {
    const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const ry = dx * Math.sin(angle) + dy * Math.cos(angle);
    dx = rx;
    dy = ry;
  }

  dx += across;
  const anchor = resolveAnchor(rowCfg);
  const result = {
    x: round2(anchor.anchorX + dx),
    y: round2(anchor.anchorY + dy),
  };
  if (override?.map_w != null) result.map_w = override.map_w;
  if (override?.map_h != null) result.map_h = override.map_h;
  return result;
}

/**
 * @param {string} normalizedRow
 * @param {number} churchId
 * @returns {object|null}
 */
function getRowConfig(normalizedRow, churchId = 46) {
  const { rowByKey } = loadGeometry(churchId);
  return rowByKey.get(String(normalizedRow || '').trim()) || null;
}

/**
 * Map a manifest/DB plot to world coordinates using explicit geometry when available.
 * @param {object} plot
 * @param {number} [churchId=46]
 */
function computePlotGeometry(plot, churchId = 46) {
  const normalizedRow = String(plot.normalized_row || plot.row || '').trim();
  const positionInRow = Number(plot.position_in_row ?? plot.position) || 1;
  const rowCfg = getRowConfig(normalizedRow, churchId);

  const { world } = loadGeometry(churchId);
  const plotW = world?.plotDefaults?.width ?? PLOT_W;
  const plotH = world?.plotDefaults?.height ?? PLOT_H;

  if (rowCfg) {
    const center = positionFromRowConfig(rowCfg, positionInRow);
    const section = plot.section || '3';
    const mapPage = section === '1' ? 'pg3' : section === '2' ? 'pg2' : section === 'NS' ? 'pg1' : 'pg1';
    return {
      map_x: center.x,
      map_y: center.y,
      map_w: center.map_w ?? plotW,
      map_h: center.map_h ?? plotH,
      map_page: mapPage,
      geometrySource: 'explicit',
      normalized_row: normalizedRow,
    };
  }

  const legacy = legacyPlotCoords(plot);
  return { ...legacy, geometrySource: 'legacy' };
}

/**
 * Content bounds for viewport fitting.
 * @param {Array<{ map_x: number, map_y: number, map_w?: number, map_h?: number }>} plots
 * @param {number} [churchId=46]
 */
function computeContentBounds(plots, churchId = 46) {
  const { world } = loadGeometry(churchId);
  const plotW = world?.plotDefaults?.width ?? PLOT_W;
  const plotH = world?.plotDefaults?.height ?? PLOT_H;

  if (!plots?.length) {
    const cam = world?.cameras?.full;
    if (cam) {
      return { minX: cam.x, minY: cam.y, maxX: cam.x + cam.w, maxY: cam.y + cam.h, width: cam.w, height: cam.h };
    }
    return { minX: 0, minY: 0, maxX: 100, maxY: 170, width: 100, height: 170 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of plots) {
    const w = p.map_w ?? plotW;
    const h = p.map_h ?? plotH;
    const x = Number(p.map_x) || 0;
    const y = Number(p.map_y) || 0;
    minX = Math.min(minX, x - w / 2);
    minY = Math.min(minY, y - h / 2);
    maxX = Math.max(maxX, x + w / 2);
    maxY = Math.max(maxY, y + h / 2);
  }
  const pad = 6;
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/**
 * Render bundle for frontend map layers.
 * @param {number} churchId
 */
function getRenderGeometry(churchId = 46) {
  const { world, rows } = loadGeometry(churchId);
  if (!world) {
    return { schemaVersion: 0, error: 'Geometry not found' };
  }
  return {
    schemaVersion: world.schemaVersion || 1,
    churchId,
    viewBox: world.viewBox,
    plotDefaults: world.plotDefaults,
    trafficCircle: world.trafficCircle,
    roads: world.roads,
    landmarks: world.landmarks,
    cameras: world.cameras,
    calibrationSlice: rows?.calibrationSlice || null,
    explicitRows: (rows?.rows || []).map((r) => r.normalizedRow),
  };
}

module.exports = {
  loadGeometry,
  clearGeometryCache,
  getRowConfig,
  cumulativeSlotOffset,
  positionFromRowConfig,
  computePlotGeometry,
  computeContentBounds,
  getRenderGeometry,
  geometryDir,
};
