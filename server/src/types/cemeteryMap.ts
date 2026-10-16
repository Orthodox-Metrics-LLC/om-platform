/**
 * Cemetery map geometry — PDF-derived canonical data model.
 * Coordinates are normalized per page: x ∈ [0, NORM_WIDTH], y ∈ [0, page.normalizedHeight].
 */

export const CEMETERY_MAP_SCHEMA_VERSION = 1 as const;
export const CEMETERY_DIGITIZER_EXPORT_VERSION = 'cemetery-map-digitizer-v1' as const;
export const CEMETERY_MAP_NORM_WIDTH = 1000;

export type PlotStatus =
  | 'available'
  | 'reserved'
  | 'occupied'
  | 'unavailable'
  | 'unknown'
  | 'skipped';

export type CemeteryObjectType =
  | 'tree'
  | 'shrub'
  | 'bench'
  | 'gate'
  | 'fence'
  | 'water_hose'
  | 'shed'
  | 'dumpster'
  | 'sign'
  | 'cross'
  | 'road'
  | 'path'
  | 'landscape_bed'
  | 'section_label'
  | 'utility';

export type CemeteryLayerId =
  | 'plots'
  | 'landscaping'
  | 'infrastructure'
  | 'labels'
  | 'source';

export type RowSide = 'left' | 'right' | 'center' | 'upper' | 'lower';
export type RowOrientation = 'horizontal' | 'vertical';
export type NumberingDirection =
  | 'ascending-ltr'
  | 'descending-ltr'
  | 'ascending-ttb'
  | 'descending-ttb'
  | 'manual';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface CemeteryMapPage {
  pageNumber: number;
  pdfWidthPts: number;
  pdfHeightPts: number;
  normalizedWidth: number;
  normalizedHeight: number;
  imageFile: string;
  imageWidthPx: number;
  imageHeightPx: number;
}

export interface CemeteryPlotGeometry {
  id: string;
  plotNumber: string;
  sectionCode: string;
  status: PlotStatus;
  pageNumber: number;
  shape: 'rect' | 'polygon';
  /** Top-left x for rect shapes (normalized) */
  x?: number;
  /** Top-left y for rect shapes (normalized) */
  y?: number;
  w?: number;
  h?: number;
  /** Polygon vertices (normalized) */
  points?: NormalizedPoint[];
  /** Family/lot label from map or headstone (surname) — not confirmed occupants */
  familyName?: string;
  /** Visible names on marker (first/partial names) */
  markerNames?: string[];
  /** Verified burial/interment records only */
  occupantNames?: string[];
  /** Full visual transcription from source map */
  sourceLabelText?: string;
  /** OCR engine confidence 0–100 (last run on source crop) */
  ocrConfidence?: number | null;
  /** Base64 data URL of cropped source-map region for this plot */
  sourceCropData?: string | null;
  notes?: string;
  needsReview?: boolean;
  duplicateOf?: string | null;
  source?: 'pdf_digitizer' | 'import' | 'legacy';
  rowId?: string;
  rowNumber?: number;
  side?: RowSide;
  slotIndex?: number;
  rowCapacity?: number;
  rotation?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CemeteryMapObject {
  id: string;
  type: CemeteryObjectType;
  subtype?: string;
  label?: string;
  sectionCode?: string;
  notes?: string;
  pageNumber: number;
  x: number;
  y: number;
  w?: number;
  h?: number;
  points?: NormalizedPoint[];
  rotation?: number;
  zIndex?: number;
  layer?: CemeteryLayerId;
  needsReview?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CemeteryRowDefinition {
  rowId: string;
  pageNumber: number;
  sectionCode: string;
  rowNumber: number;
  side: RowSide;
  orientation: RowOrientation;
  maxSlots: number;
  actualPlotCount: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  defaultPlotWidth: number;
  defaultPlotHeight: number;
  spacing: number;
  numberingDirection: NumberingDirection;
  startingPlotNumber?: string;
  skippedSlotIndexes?: number[];
  generatedPlotIds: string[];
  notes?: string;
  needsReview?: boolean;
}

export interface CemeteryDigitizerExportV1 {
  version: typeof CEMETERY_DIGITIZER_EXPORT_VERSION;
  churchId: number;
  source: { type: 'pdf'; page?: number; label?: string };
  plots: CemeteryPlotGeometry[];
  objects: CemeteryMapObject[];
  rows: CemeteryRowDefinition[];
  document?: CemeteryMapDocument;
}

export interface CemeterySectionRegion {
  code: string;
  name: string;
  pageNumber: number;
  labelPoint?: NormalizedPoint;
  bounds?: { x: number; y: number; w: number; h: number };
}

export type RoadKind = 'road' | 'path' | 'driveway';

export interface CemeteryRoad {
  id: string;
  pageNumber: number;
  kind: RoadKind;
  points: NormalizedPoint[];
  width?: number;
  label?: string;
}

export interface CemeteryRoundabout {
  pageNumber: number;
  center: NormalizedPoint;
  outerRadius: number;
  islandRadius?: number;
}

export interface CemeteryEntrance {
  pageNumber: number;
  point: NormalizedPoint;
  label?: string;
}

export type RouteNodeKind = 'entrance' | 'roundabout' | 'junction' | 'gate' | 'waypoint';

export interface CemeteryRouteNode {
  id: string;
  pageNumber: number;
  point: NormalizedPoint;
  label?: string;
  kind: RouteNodeKind;
}

export interface CemeteryRouteEdge {
  id: string;
  from: string;
  to: string;
  pageNumber: number;
  bidirectional?: boolean;
}

export interface CemeteryMapDocument {
  schemaVersion: typeof CEMETERY_MAP_SCHEMA_VERSION;
  churchId: number;
  sourcePdf: string;
  generatedAt: string;
  updatedAt: string;
  pages: CemeteryMapPage[];
  sections: CemeterySectionRegion[];
  roads: CemeteryRoad[];
  roundabout?: CemeteryRoundabout;
  entrance?: CemeteryEntrance;
  routeNodes: CemeteryRouteNode[];
  routeEdges: CemeteryRouteEdge[];
  plots: CemeteryPlotGeometry[];
  objects?: CemeteryMapObject[];
  rows?: CemeteryRowDefinition[];
  metadata?: {
    digitizerNotes?: string;
    reviewFlagCount?: number;
    lastValidatedAt?: string;
  };
}

export function normalizedHeightFromPdf(pdfWidthPts: number, pdfHeightPts: number): number {
  if (!pdfWidthPts) return CEMETERY_MAP_NORM_WIDTH;
  return Math.round((CEMETERY_MAP_NORM_WIDTH * pdfHeightPts) / pdfWidthPts * 100) / 100;
}

export function createEmptyMapDocument(churchId: number, sourcePdf: string): CemeteryMapDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: CEMETERY_MAP_SCHEMA_VERSION,
    churchId,
    sourcePdf,
    generatedAt: now,
    updatedAt: now,
    pages: [],
    sections: [],
    roads: [],
    routeNodes: [],
    routeEdges: [],
    plots: [],
    metadata: {},
  };
}

/** Backwards-compatible defaults for plots saved before family/marker/source fields existed. */
export function normalizePlot(plot: CemeteryPlotGeometry): CemeteryPlotGeometry {
  const valid: PlotStatus[] = ['available', 'reserved', 'occupied', 'unavailable', 'unknown', 'skipped'];
  const status = valid.includes(plot.status) ? plot.status : 'unknown';
  return {
    ...plot,
    status,
    familyName: plot.familyName ?? '',
    markerNames: plot.markerNames ?? [],
    occupantNames: plot.occupantNames ?? [],
    sourceLabelText: plot.sourceLabelText ?? '',
    ocrConfidence: plot.ocrConfidence ?? null,
    sourceCropData: plot.sourceCropData ?? null,
    rowNumber: plot.rowNumber ?? undefined,
    slotIndex: plot.slotIndex ?? undefined,
    rowCapacity: plot.rowCapacity ?? undefined,
    rotation: plot.rotation ?? 0,
    createdAt: plot.createdAt,
    updatedAt: plot.updatedAt,
  };
}

export function normalizeObject(obj: CemeteryMapObject): CemeteryMapObject {
  return {
    ...obj,
    label: obj.label ?? '',
    sectionCode: obj.sectionCode ?? '',
    notes: obj.notes ?? '',
    rotation: obj.rotation ?? 0,
    zIndex: obj.zIndex ?? 0,
    needsReview: obj.needsReview ?? false,
  };
}

export function normalizeRow(row: CemeteryRowDefinition): CemeteryRowDefinition {
  return {
    ...row,
    maxSlots: row.maxSlots ?? 7,
    skippedSlotIndexes: row.skippedSlotIndexes ?? [],
    generatedPlotIds: row.generatedPlotIds ?? [],
    startingPlotNumber: row.startingPlotNumber ?? '',
    notes: row.notes ?? '',
    needsReview: row.needsReview ?? false,
  };
}

export function normalizeMapDocument(doc: CemeteryMapDocument): CemeteryMapDocument {
  return {
    ...doc,
    rows: (doc.rows ?? []).map(normalizeRow),
    plots: (doc.plots ?? []).map(normalizePlot),
    objects: (doc.objects ?? []).map(normalizeObject),
  };
}
