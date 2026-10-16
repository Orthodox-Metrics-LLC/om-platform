/**
 * Layout-first OCR structure identification — runs before zone-aware text extraction.
 * Combines CV/heuristic layout classification, catalog template matching, and zone mapping.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { classifyLayout } from '../utils/ocrClassifier';
import {
  classifyRecordTypeEnhanced,
  matchCorpusCatalogLayout,
  type RecordIdentificationContext,
} from '../utils/ocrRecordIdentification';

const { getAllLayouts } = require('./ocrLayoutCatalogService') as {
  getAllLayouts: () => Array<{
    id: string;
    record_type: string;
    title: string;
    extraction_mode: string;
  }>;
};

export type LayoutType = 'tabular' | 'form' | 'narrative' | 'multi_form';

export interface LayoutZone {
  id: string;
  type: 'header' | 'body_column' | 'margin' | 'handwriting_band' | 'record_region';
  label?: string;
  bboxNorm: { x0: number; y0: number; x1: number; y1: number };
  fieldKeys?: string[];
}

export interface LayoutIdentificationResult {
  pipelineVersion: string;
  identifiedAt: string;
  source: 'upload' | 'analyze' | 'benchmark' | 'worker';
  detectedLayoutType: LayoutType;
  layoutConfidence: number;
  layoutSignals: Record<string, number>;
  suggestedRecordType: 'baptism' | 'marriage' | 'funeral' | 'custom' | 'unknown';
  recordTypeConfidence: number;
  matchedCatalogLayoutId: string | null;
  matchedCatalogLayoutTitle: string | null;
  catalogMatchConfidence: number;
  /** Primary global catalog layout id — same as matchedCatalogLayoutId when matched globally */
  globalCatalogLayoutId: string | null;
  /** Whether geometry came from global catalog, parish override, or heuristic fallback */
  layoutMatchScope: 'global' | 'parish' | 'heuristic';
  layoutMatchSource: 'global_catalog' | 'global_extractor' | 'parish_extractor' | 'heuristic';
  templateMatchId: number | null;
  templateMatchScore: number;
  zones: LayoutZone[];
  fieldRegionMap: Record<string, { zoneId: string; extractedValue?: string }>;
  columnBands?: Array<[number, number]>;
  headerYThreshold?: number;
  ocrTextLength?: number;
  userOverridden?: boolean;
}

export interface LayoutIdentificationOptions {
  churchId?: number;
  recordTypeHint?: string;
  language?: string;
  source?: LayoutIdentificationResult['source'];
  identificationContext?: RecordIdentificationContext;
  /** Skip tesseract when caller already has OCR output */
  ocrText?: string;
  ocrWords?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  imageWidth?: number;
  imageHeight?: number;
  /** Worker re-runs should not double-count global match stats */
  skipGlobalPersistence?: boolean;
}

const PIPELINE_VERSION = 'layout_first_v1';

const FIELD_LABEL_PATTERNS: Record<string, Record<string, RegExp[]>> = {
  baptism: {
    first_name: [/child(?:'?s)?\s*name[:\s]+(.+)/i, /name\s+of\s+child[:\s]+(.+)/i],
    last_name: [/child(?:'?s)?\s*name[:\s]+(.+)/i],
    birth_date: [/date\s+of\s+birth[:\s]+(.+)/i, /born[:\s]+(.+)/i],
    reception_date: [/date\s+of\s+baptism[:\s]+(.+)/i, /bapti[sz](?:ed|m)[:\s]+(.+)/i, /reception[:\s]+(.+)/i],
    parents: [/parents[:\s]+(.+)/i, /father[:\s]+(.+)/i],
    sponsors: [/god\s*parent[s]?[:\s]+(.+)/i, /sponsor[s]?[:\s]+(.+)/i],
    clergy: [/performed\s+by[:\s]+(.+)/i, /priest[:\s]+(.+)/i, /officiant[:\s]+(.+)/i],
  },
  marriage: {
    groom_first: [/groom[:\s]+(.+)/i, /bridegroom[:\s]+(.+)/i],
    groom_last: [/groom[:\s]+(.+)/i],
    bride_first: [/bride[:\s]+(.+)/i],
    bride_last: [/bride[:\s]+(.+)/i],
    marriage_date: [/date\s+of\s+marriage[:\s]+(.+)/i, /married[:\s]+(.+)/i],
    parents_groom: [/groom(?:'s)?\s*parents?[:\s]+(.+)/i],
    parents_bride: [/bride(?:'s)?\s*parents?[:\s]+(.+)/i],
    witness: [/witness(?:es)?[:\s]+(.+)/i],
    clergy: [/officiant[:\s]+(.+)/i, /priest[:\s]+(.+)/i],
  },
  funeral: {
    first_name: [/deceased[:\s]+(.+)/i, /name\s+of\s+deceased[:\s]+(.+)/i],
    last_name: [/deceased[:\s]+(.+)/i],
    deceased_date: [/date\s+of\s+death[:\s]+(.+)/i, /died[:\s]+(.+)/i],
    burial_date: [/date\s+of\s+burial[:\s]+(.+)/i, /buried[:\s]+(.+)/i],
    age: [/age[:\s]+(\d+)/i],
    clergy: [/officiant[:\s]+(.+)/i, /priest[:\s]+(.+)/i],
    burial_location: [/place\s+of\s+burial[:\s]+(.+)/i, /cemetery[:\s]+(.+)/i],
  },
};

const TABULAR_COLUMN_FIELDS: Record<string, string[]> = {
  baptism: ['record_number', 'birth_date', 'reception_date', 'child_name', 'parents', 'sponsors', 'clergy'],
  marriage: ['record_number', 'marriage_date', 'groom_name', 'bride_name', 'witness', 'clergy'],
  funeral: ['record_number', 'deceased_date', 'burial_date', 'deceased_name', 'age', 'clergy'],
};

function tesseractWordsToVisionPages(
  words: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>,
  imgW: number,
  imgH: number,
): any[] {
  const visionWords = words
    .filter((w) => w.text?.trim())
    .map((w) => ({
      text: w.text,
      boundingBox: {
        vertices: [
          { x: w.bbox.x0, y: w.bbox.y0 },
          { x: w.bbox.x1, y: w.bbox.y0 },
          { x: w.bbox.x1, y: w.bbox.y1 },
          { x: w.bbox.x0, y: w.bbox.y1 },
        ],
      },
    }));
  return [{
    width: imgW,
    height: imgH,
    blocks: [{ paragraphs: [{ words: visionWords }] }],
  }];
}

async function runLightweightOcr(imagePath: string): Promise<{
  text: string;
  confidence: number;
  words: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  width: number;
  height: number;
}> {
  const meta = await sharp(imagePath).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;

  const os = require('os');
  const prepPath = path.join(os.tmpdir(), `om-layout-${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`);

  try {
    await sharp(imagePath)
      .rotate()
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.0 })
      .jpeg({ quality: 90 })
      .toFile(prepPath);

    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng+ell+rus', 1, { logger: () => {} });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(prepPath);
      const words = (data.words || [])
        .filter((w: any) => w.text?.trim())
        .map((w: any) => ({
          text: String(w.text),
          bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
        }));
      let confSum = 0;
      let confN = 0;
      for (const w of data.words || []) {
        if (w.confidence > 0) {
          confSum += w.confidence;
          confN += 1;
        }
      }
      const confidence = confN > 0 ? confSum / confN / 100 : (data.confidence || 0) / 100;
      return {
        text: String(data.text || '').trim(),
        confidence: Math.max(0, Math.min(1, confidence)),
        words,
        width,
        height,
      };
    } finally {
      await worker.terminate();
    }
  } finally {
    try {
      if (fs.existsSync(prepPath)) fs.unlinkSync(prepPath);
    } catch {
      /* ignore */
    }
  }
}

function parseColumnBands(raw: unknown): Array<[number, number]> | null {
  if (!raw) return null;
  let bands = raw;
  if (typeof bands === 'string') {
    try { bands = JSON.parse(bands); } catch { return null; }
  }
  if (!Array.isArray(bands)) return null;
  return bands.map((b: any) => {
    if (Array.isArray(b)) return [b[0], b[1]] as [number, number];
    return [b.start ?? b.x0 ?? 0, b.end ?? b.x1 ?? 1] as [number, number];
  });
}

async function matchLayoutTemplateGlobalFirst(
  churchId: number | undefined,
  recordType: string,
  ocrText: string,
  language: string,
): Promise<{
  templateId: number | null;
  score: number;
  columnBands: Array<[number, number]> | null;
  headerY: number | null;
  catalogLayoutId: string | null;
  layoutMatchScope: 'global' | 'parish' | 'heuristic';
}> {
  if (!recordType || recordType === 'custom' || recordType === 'unknown') {
    return {
      templateId: null, score: 0, columnBands: null, headerY: null,
      catalogLayoutId: null, layoutMatchScope: 'heuristic',
    };
  }

  try {
    const { matchLayoutTemplates } = require('./globalLayoutMatchService');
    const match = await matchLayoutTemplates(churchId, recordType, ocrText, language);
    return {
      templateId: match.templateId,
      score: match.score,
      columnBands: match.columnBands,
      headerY: match.headerY,
      catalogLayoutId: match.catalogLayoutId || match.globalCatalogLayoutId,
      layoutMatchScope: match.layoutMatchScope || 'heuristic',
    };
  } catch (err: any) {
    console.warn(`[LayoutID] Global layout match failed: ${err?.message}`);
    return {
      templateId: null, score: 0, columnBands: null, headerY: null,
      catalogLayoutId: null, layoutMatchScope: 'heuristic',
    };
  }
}

function resolveLayoutMatchSource(
  scope: 'global' | 'parish' | 'heuristic',
  hasTemplate: boolean,
  hasCatalog: boolean,
): LayoutIdentificationResult['layoutMatchSource'] {
  if (scope === 'parish' && hasTemplate) return 'parish_extractor';
  if (scope === 'global' && hasTemplate) return 'global_extractor';
  if (hasCatalog) return 'global_catalog';
  return 'heuristic';
}

function buildZones(
  layoutType: LayoutType,
  recordType: string,
  columnBands: Array<[number, number]> | null,
  headerY: number | null,
): LayoutZone[] {
  const zones: LayoutZone[] = [];
  const headerCut = headerY ?? 0.12;

  zones.push({
    id: 'header',
    type: 'header',
    label: 'Header / column titles',
    bboxNorm: { x0: 0, y0: 0, x1: 1, y1: headerCut },
  });

  if (layoutType === 'tabular' && columnBands?.length) {
    const fieldKeys = TABULAR_COLUMN_FIELDS[recordType] || [];
    columnBands.forEach(([x0, x1], idx) => {
      zones.push({
        id: `col_${idx}`,
        type: 'body_column',
        label: fieldKeys[idx] || `Column ${idx + 1}`,
        bboxNorm: { x0, y0: headerCut, x1, y1: 0.95 },
        fieldKeys: fieldKeys[idx] ? [fieldKeys[idx]] : undefined,
      });
    });
  } else if (layoutType === 'form' || layoutType === 'multi_form') {
    zones.push({
      id: 'form_body',
      type: 'handwriting_band',
      label: 'Form fields',
      bboxNorm: { x0: 0.05, y0: headerCut, x1: 0.95, y1: 0.92 },
    });
    zones.push({
      id: 'margin_left',
      type: 'margin',
      bboxNorm: { x0: 0, y0: 0, x1: 0.05, y1: 1 },
    });
    zones.push({
      id: 'margin_right',
      type: 'margin',
      bboxNorm: { x0: 0.95, y0: 0, x1: 1, y1: 1 },
    });
  } else {
    zones.push({
      id: 'narrative_body',
      type: 'handwriting_band',
      label: 'Narrative entry',
      bboxNorm: { x0: 0.04, y0: headerCut, x1: 0.96, y1: 0.94 },
    });
  }

  return zones;
}

function pickLabelValue(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim().replace(/\s{2,}/g, ' ').slice(0, 200);
  }
  return null;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
  }
  return { first: parts[0] || '', last: '' };
}

export function extractZoneMappedFields(
  recordType: 'baptism' | 'marriage' | 'funeral',
  ocrText: string,
  layoutType: LayoutType,
): Record<string, string> {
  const patterns = FIELD_LABEL_PATTERNS[recordType];
  if (!patterns || !ocrText?.trim()) return {};

  const fields: Record<string, string> = {};

  for (const [key, regexes] of Object.entries(patterns)) {
    const val = pickLabelValue(ocrText, regexes);
    if (val) fields[key] = val;
  }

  if (layoutType === 'tabular') {
    if (recordType === 'baptism' && fields.first_name && !fields.last_name) {
      const split = splitName(fields.first_name);
      fields.first_name = split.first;
      fields.last_name = split.last;
    }
    if (recordType === 'funeral' && fields.first_name && !fields.last_name) {
      const split = splitName(fields.first_name);
      fields.first_name = split.first;
      fields.last_name = split.last;
    }
    if (recordType === 'marriage') {
      if (fields.groom_first && !fields.groom_last) {
        const split = splitName(fields.groom_first);
        fields.groom_first = split.first;
        fields.groom_last = split.last;
      }
      if (fields.bride_first && !fields.bride_last) {
        const split = splitName(fields.bride_first);
        fields.bride_first = split.first;
        fields.bride_last = split.last;
      }
    }
  }

  return fields;
}

function buildFieldRegionMap(
  zones: LayoutZone[],
  recordType: string,
  ocrText: string,
  layoutType: LayoutType,
): Record<string, { zoneId: string; extractedValue?: string }> {
  const extracted = ['baptism', 'marriage', 'funeral'].includes(recordType)
    ? extractZoneMappedFields(recordType as 'baptism' | 'marriage' | 'funeral', ocrText, layoutType)
    : {};

  const map: Record<string, { zoneId: string; extractedValue?: string }> = {};

  for (const zone of zones) {
    if (!zone.fieldKeys?.length) continue;
    for (const fk of zone.fieldKeys) {
      map[fk] = { zoneId: zone.id, extractedValue: extracted[fk] };
    }
  }

  for (const [field, value] of Object.entries(extracted)) {
    if (map[field]) {
      map[field].extractedValue = value;
      continue;
    }
    const zoneId = layoutType === 'form' || layoutType === 'multi_form'
      ? 'form_body'
      : layoutType === 'narrative'
        ? 'narrative_body'
        : 'header';
    map[field] = { zoneId, extractedValue: value };
  }

  return map;
}

function resolveRecordType(
  classResult: ReturnType<typeof classifyRecordTypeEnhanced>,
  hint?: string,
): 'baptism' | 'marriage' | 'funeral' | 'custom' | 'unknown' {
  if (hint && hint !== 'custom' && ['baptism', 'marriage', 'funeral'].includes(hint)) {
    return hint as 'baptism' | 'marriage' | 'funeral';
  }
  if (classResult.suggested_type !== 'unknown') return classResult.suggested_type;
  return 'custom';
}

function matchCatalogFallback(
  recordType: string,
  layoutType: LayoutType,
  ocrText: string,
): { layoutId: string | null; title: string | null; confidence: number } {
  if (recordType === 'custom' || recordType === 'unknown') {
    return { layoutId: null, title: null, confidence: 0 };
  }
  const modes: Record<string, string[]> = {
    tabular: ['tabular'],
    narrative: ['narrative_block'],
    form: ['form', 'multi_form'],
    multi_form: ['multi_form', 'form'],
  };
  const allowed = modes[layoutType] || ['form'];
  const layouts = getAllLayouts().filter(
    (l) => l.record_type === recordType && allowed.includes(l.extraction_mode),
  );
  if (!layouts.length) return { layoutId: null, title: null, confidence: 0 };

  const textLower = ocrText.toLowerCase();
  let best: { layoutId: string; title: string; score: number } | null = null;
  for (const layout of layouts) {
    let score = 0.55;
    for (const token of layout.title.toLowerCase().split(/\W+/).filter((t) => t.length > 3)) {
      if (textLower.includes(token)) score += 0.04;
    }
    if (!best || score > best.score) {
      best = { layoutId: layout.id, title: layout.title, score: Math.min(score, 0.95) };
    }
  }
  return best
    ? { layoutId: best.layoutId, title: best.title, confidence: Math.round(best.score * 1000) / 1000 }
    : { layoutId: null, title: null, confidence: 0 };
}

/**
 * Primary layout identification entry — structure first, then field region mapping.
 */
export async function identifyLayoutFromImage(
  imagePath: string,
  options: LayoutIdentificationOptions = {},
): Promise<LayoutIdentificationResult> {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  let ocrText = options.ocrText || '';
  let words = options.ocrWords || [];
  let width = options.imageWidth || 0;
  let height = options.imageHeight || 0;

  if (!ocrText || !words.length) {
    const ocr = await runLightweightOcr(imagePath);
    ocrText = ocr.text;
    words = ocr.words;
    width = ocr.width;
    height = ocr.height;
  }

  const idContext = options.identificationContext || {};
  const classResult = classifyRecordTypeEnhanced(ocrText, idContext);
  const recordType = resolveRecordType(classResult, options.recordTypeHint);

  let layoutType: LayoutType = 'form';
  let layoutConfidence = 0.4;
  let layoutSignals: Record<string, number> = {};

  if (words.length > 0 && width > 0 && height > 0) {
    const visionPages = tesseractWordsToVisionPages(words, width, height);
    const layoutResult = classifyLayout(visionPages, ocrText);
    layoutType = layoutResult.detectedLayoutType as LayoutType;
    layoutConfidence = layoutResult.layoutConfidence;
    layoutSignals = layoutResult.classificationSignals as Record<string, number>;
  }

  const rtForCatalog = recordType === 'custom' ? 'unknown' : recordType;
  const catalogLayoutType: 'tabular' | 'form' | 'narrative' =
    layoutType === 'multi_form' ? 'form' : layoutType;
  const catalog = matchCorpusCatalogLayout(
    rtForCatalog as 'baptism' | 'marriage' | 'funeral' | 'unknown',
    catalogLayoutType,
    ocrText,
  );
  const catalogFallback = catalog.layoutId
    ? catalog
    : matchCatalogFallback(recordType, layoutType, ocrText);

  const template = await matchLayoutTemplateGlobalFirst(
    options.churchId,
    recordType,
    ocrText,
    options.language || 'en',
  );

  const matchedCatalogLayoutId = template.catalogLayoutId
    || catalog.layoutId
    || catalogFallback.layoutId;
  const matchedCatalogLayoutTitle = catalog.title || catalogFallback.title
    || (matchedCatalogLayoutId
      ? getAllLayouts().find((l) => l.id === matchedCatalogLayoutId)?.title || null
      : null);
  const catalogMatchConfidence = Math.max(
    catalog.confidence || 0,
    catalogFallback.confidence || 0,
    template.score > 0 ? Math.min(0.5 + template.score * 0.1, 0.98) : 0,
  );

  const columnBands = template.columnBands;
  const headerY = template.headerY ?? 0.12;
  const zones = buildZones(layoutType, recordType, columnBands, headerY);
  const fieldRegionMap = buildFieldRegionMap(zones, recordType, ocrText, layoutType);

  const layoutMatchScope = template.layoutMatchScope;
  const layoutMatchSource = resolveLayoutMatchSource(
    layoutMatchScope,
    !!template.templateId,
    !!matchedCatalogLayoutId,
  );

  const result: LayoutIdentificationResult = {
    pipelineVersion: PIPELINE_VERSION,
    identifiedAt: new Date().toISOString(),
    source: options.source || 'upload',
    detectedLayoutType: layoutType,
    layoutConfidence,
    layoutSignals,
    suggestedRecordType: recordType,
    recordTypeConfidence: classResult.confidence,
    matchedCatalogLayoutId,
    matchedCatalogLayoutTitle,
    catalogMatchConfidence,
    globalCatalogLayoutId: matchedCatalogLayoutId,
    layoutMatchScope,
    layoutMatchSource,
    templateMatchId: template.templateId,
    templateMatchScore: template.score,
    zones,
    fieldRegionMap,
    columnBands: columnBands || undefined,
    headerYThreshold: headerY,
    ocrTextLength: ocrText.length,
    userOverridden: false,
  };

  try {
    if (!options.skipGlobalPersistence) {
      const { afterLayoutIdentification } = require('./globalLayoutMatchService');
      await afterLayoutIdentification(result, options.churchId);
    }
  } catch (persistErr: any) {
    console.warn(`[LayoutID] Global layout persistence skipped: ${persistErr?.message}`);
  }

  return result;
}

/** Merge layout identification into layout_classification_json shape used by ocr_jobs. */
export function layoutResultToClassificationJson(
  layout: LayoutIdentificationResult,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    pipelineVersion: layout.pipelineVersion,
    identifiedAt: layout.identifiedAt,
    detectedLayoutType: layout.detectedLayoutType,
    layoutConfidence: layout.layoutConfidence,
    layoutSignals: layout.layoutSignals,
    matchedCatalogLayoutId: layout.matchedCatalogLayoutId,
    matchedCatalogLayoutTitle: layout.matchedCatalogLayoutTitle,
    catalogMatchConfidence: layout.catalogMatchConfidence,
    globalCatalogLayoutId: layout.globalCatalogLayoutId ?? layout.matchedCatalogLayoutId,
    layoutMatchScope: layout.layoutMatchScope,
    layoutMatchSource: layout.layoutMatchSource,
    templateMatchId: layout.templateMatchId,
    templateMatchScore: layout.templateMatchScore,
    suggestedRecordType: layout.suggestedRecordType,
    recordTypeConfidence: layout.recordTypeConfidence,
    zones: layout.zones,
    fieldRegionMap: layout.fieldRegionMap,
    columnBands: layout.columnBands,
    headerYThreshold: layout.headerYThreshold,
    userOverridden: layout.userOverridden ?? false,
    ...extra,
  };
}

export function getExtractedFieldsFromLayout(
  layout: LayoutIdentificationResult | Record<string, unknown> | null,
): Record<string, string> {
  if (!layout) return {};
  const map = (layout as LayoutIdentificationResult).fieldRegionMap
    || (layout as any).fieldRegionMap;
  if (!map || typeof map !== 'object') return {};

  const out: Record<string, string> = {};
  for (const [field, entry] of Object.entries(map)) {
    const val = (entry as { extractedValue?: string })?.extractedValue;
    if (val?.trim()) out[field] = val.trim();
  }
  return out;
}
