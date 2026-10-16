/**
 * Phase 2 — Zone-aware OCR and field extraction.
 * Crops layout zones from persisted layout_classification_json, runs targeted OCR,
 * and maps zone text into fieldRegionMap (tabular columns + form label patterns).
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  extractZoneMappedFields,
  type LayoutZone,
} from './ocrLayoutIdentificationService';

export interface ZoneOcrEntry {
  zoneId: string;
  zoneType: LayoutZone['type'];
  label?: string;
  text: string;
  confidence: number;
  psm: string;
  bboxNorm: LayoutZone['bboxNorm'];
  source: 'zone_tesseract' | 'full_page_fallback';
  fieldKeys?: string[];
}

export interface ZoneAwareExtractionResult {
  zoneOcr: Record<string, ZoneOcrEntry>;
  fieldRegionMap: Record<string, { zoneId: string; extractedValue?: string }>;
  zoneFields: Record<string, string>;
  enrichedOcrText: string;
  usedZoneOcr: boolean;
  fallbackReason?: string;
}

export interface ZoneAwareExtractionOptions {
  fullPageText?: string;
  language?: string;
  minLayoutConfidence?: number;
  minZoneConfidence?: number;
}

const MIN_LAYOUT_CONFIDENCE_DEFAULT = 0.35;
const MIN_ZONE_CONFIDENCE_DEFAULT = 0.2;

/** Tesseract PSM per zone type — tuned for church record layouts. */
export function psmForZoneType(zoneType: LayoutZone['type']): string {
  switch (zoneType) {
    case 'header':
      return '6'; // uniform block (column titles)
    case 'body_column':
      return '4'; // single column of text
    case 'handwriting_band':
      return '11'; // sparse text / handwriting
    case 'margin':
      return '6';
    case 'record_region':
      return '6';
    default:
      return '6';
  }
}

export function normBboxToPixels(
  bboxNorm: LayoutZone['bboxNorm'],
  imgW: number,
  imgH: number,
): { left: number; top: number; width: number; height: number } {
  const x0 = Math.max(0, Math.min(1, bboxNorm.x0));
  const y0 = Math.max(0, Math.min(1, bboxNorm.y0));
  const x1 = Math.max(x0 + 0.01, Math.min(1, bboxNorm.x1));
  const y1 = Math.max(y0 + 0.01, Math.min(1, bboxNorm.y1));

  let left = Math.floor(x0 * imgW);
  let top = Math.floor(y0 * imgH);
  let width = Math.ceil((x1 - x0) * imgW);
  let height = Math.ceil((y1 - y0) * imgH);

  left = Math.max(0, Math.min(left, imgW - 1));
  top = Math.max(0, Math.min(top, imgH - 1));
  width = Math.max(1, Math.min(width, imgW - left));
  height = Math.max(1, Math.min(height, imgH - top));

  return { left, top, width, height };
}

function cleanZoneText(text: string): string {
  return text
    .replace(/\f/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
  }
  return { first: parts[0] || '', last: '' };
}

/**
 * Map zone OCR text to sacramental fields using zone fieldKeys (tabular) or label regex (form).
 */
export function extractFieldsFromZoneOcr(
  layout: Record<string, unknown>,
  zoneOcr: Record<string, ZoneOcrEntry>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  const layoutType = String(layout.detectedLayoutType || 'form');
  const recordType = String(layout.suggestedRecordType || layout.recordType || 'custom');
  const zones = (layout.zones || []) as LayoutZone[];

  if (layoutType === 'tabular') {
    for (const zone of zones) {
      if (zone.type !== 'body_column' || !zone.fieldKeys?.length) continue;
      const entry = zoneOcr[zone.id];
      if (!entry?.text?.trim()) continue;
      const lines = entry.text.split('\n').map((l) => l.trim()).filter(Boolean);
      const value = lines.length > 1 ? lines.join(' ') : lines[0];
      if (!value) continue;
      for (const fk of zone.fieldKeys) {
        if (!fields[fk]) fields[fk] = value;
      }
    }

    if (recordType === 'baptism') {
      if (fields.child_name && !fields.first_name) {
        const split = splitName(fields.child_name);
        fields.first_name = split.first;
        fields.last_name = split.last;
      }
    }
    if (recordType === 'funeral') {
      if (fields.deceased_name && !fields.first_name) {
        const split = splitName(fields.deceased_name);
        fields.first_name = split.first;
        fields.last_name = split.last;
      }
    }
    if (recordType === 'marriage') {
      if (fields.groom_name && !fields.groom_first) {
        const split = splitName(fields.groom_name);
        fields.groom_first = split.first;
        fields.groom_last = split.last;
      }
      if (fields.bride_name && !fields.bride_first) {
        const split = splitName(fields.bride_name);
        fields.bride_first = split.first;
        fields.bride_last = split.last;
      }
    }
  }

  const formZones = zones.filter(
    (z) => z.type === 'handwriting_band' || z.type === 'record_region' || z.id === 'form_body',
  );
  for (const zone of formZones) {
    const entry = zoneOcr[zone.id];
    if (!entry?.text?.trim()) continue;
    if (!['baptism', 'marriage', 'funeral'].includes(recordType)) continue;
    const fromZone = extractZoneMappedFields(
      recordType as 'baptism' | 'marriage' | 'funeral',
      entry.text,
      layoutType as 'tabular' | 'form' | 'narrative' | 'multi_form',
    );
    for (const [k, v] of Object.entries(fromZone)) {
      if (v?.trim() && !fields[k]) fields[k] = v.trim();
    }
  }

  return fields;
}

export function buildFieldRegionMapFromZones(
  existingMap: Record<string, { zoneId: string; extractedValue?: string }> | undefined,
  zones: LayoutZone[],
  zoneFields: Record<string, string>,
): Record<string, { zoneId: string; extractedValue?: string }> {
  const map: Record<string, { zoneId: string; extractedValue?: string }> = {
    ...(existingMap || {}),
  };

  const zoneByField = new Map<string, string>();
  for (const zone of zones) {
    if (!zone.fieldKeys?.length) continue;
    for (const fk of zone.fieldKeys) {
      if (!zoneByField.has(fk)) zoneByField.set(fk, zone.id);
    }
  }

  for (const [field, value] of Object.entries(zoneFields)) {
    if (!value?.trim()) continue;
    const zoneId = zoneByField.get(field)
      || map[field]?.zoneId
      || (zones.find((z) => z.type === 'handwriting_band')?.id ?? 'form_body');
    map[field] = { zoneId, extractedValue: value.trim() };
  }

  return map;
}

export function buildZoneEnrichedOcrText(
  zoneOcr: Record<string, ZoneOcrEntry>,
  zones: LayoutZone[],
): string {
  const parts: string[] = [];
  const order = zones.length ? zones.map((z) => z.id) : Object.keys(zoneOcr);

  for (const zoneId of order) {
    const entry = zoneOcr[zoneId];
    if (!entry?.text?.trim()) continue;
    const label = entry.label || zoneId;
    parts.push(`[${label}]\n${entry.text.trim()}`);
  }

  for (const zoneId of Object.keys(zoneOcr)) {
    if (order.includes(zoneId)) continue;
    const entry = zoneOcr[zoneId];
    if (!entry?.text?.trim()) continue;
    parts.push(`[${entry.label || zoneId}]\n${entry.text.trim()}`);
  }

  return parts.join('\n\n');
}

async function ocrZoneCrop(
  imagePath: string,
  zone: LayoutZone,
  imgW: number,
  imgH: number,
): Promise<{ text: string; confidence: number }> {
  const crop = normBboxToPixels(zone.bboxNorm, imgW, imgH);
  const psm = psmForZoneType(zone.type);

  const prepPath = path.join(
    os.tmpdir(),
    `om-zone-${zone.id}-${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`,
  );

  try {
    await sharp(imagePath)
      .rotate()
      .extract(crop)
      .grayscale()
      .normalize()
      .sharpen({ sigma: zone.type === 'handwriting_band' ? 0.8 : 1.2 })
      .jpeg({ quality: 92 })
      .toFile(prepPath);

    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng+ell+rus', 1, { logger: () => {} });
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: psm,
        preserve_interword_spaces: '1',
      });
      const { data } = await worker.recognize(prepPath);
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
        text: cleanZoneText(String(data.text || '')),
        confidence: Math.max(0, Math.min(1, confidence)),
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

function sliceFullPageTextForZone(
  fullPageText: string,
  zone: LayoutZone,
  allZones: LayoutZone[],
): string {
  if (!fullPageText?.trim()) return '';
  const lines = fullPageText.split('\n');
  const y0 = zone.bboxNorm.y0;
  const y1 = zone.bboxNorm.y1;
  const total = allZones.length || 1;
  const startLine = Math.floor(y0 * lines.length);
  const endLine = Math.max(startLine + 1, Math.ceil(y1 * lines.length));
  return cleanZoneText(lines.slice(startLine, endLine).join('\n'));
}

/**
 * Run zone-cropped OCR for each layout zone; fall back to full-page slice when zone OCR is weak.
 */
export async function runZoneAwareExtraction(
  imagePath: string,
  layout: Record<string, unknown>,
  options: ZoneAwareExtractionOptions = {},
): Promise<ZoneAwareExtractionResult | null> {
  if (!fs.existsSync(imagePath)) return null;

  const zones = (layout.zones || []) as LayoutZone[];
  if (!zones.length) {
    return null;
  }

  const layoutConfidence = Number(layout.layoutConfidence || 0);
  const minLayout = options.minLayoutConfidence ?? MIN_LAYOUT_CONFIDENCE_DEFAULT;
  if (layoutConfidence < minLayout) {
    return {
      zoneOcr: {},
      fieldRegionMap: (layout.fieldRegionMap as Record<string, { zoneId: string; extractedValue?: string }>) || {},
      zoneFields: {},
      enrichedOcrText: options.fullPageText || '',
      usedZoneOcr: false,
      fallbackReason: 'low_layout_confidence',
    };
  }

  const meta = await sharp(imagePath).metadata();
  const imgW = meta.width || 0;
  const imgH = meta.height || 0;
  if (imgW < 10 || imgH < 10) return null;

  const minZoneConf = options.minZoneConfidence ?? MIN_ZONE_CONFIDENCE_DEFAULT;
  const zoneOcr: Record<string, ZoneOcrEntry> = {};
  const ocrZones = zones.filter((z) => z.type !== 'margin');

  for (const zone of ocrZones) {
    try {
      let text = '';
      let confidence = 0;
      let source: ZoneOcrEntry['source'] = 'zone_tesseract';

      try {
        const result = await ocrZoneCrop(imagePath, zone, imgW, imgH);
        text = result.text;
        confidence = result.confidence;
      } catch (cropErr: any) {
        console.warn(`[ZoneOCR] Crop OCR failed for ${zone.id}: ${cropErr?.message}`);
      }

      if ((!text || confidence < minZoneConf) && options.fullPageText) {
        const fallbackText = sliceFullPageTextForZone(options.fullPageText, zone, zones);
        if (fallbackText.length > text.length) {
          text = fallbackText;
          confidence = Math.max(confidence, 0.45);
          source = 'full_page_fallback';
        }
      }

      zoneOcr[zone.id] = {
        zoneId: zone.id,
        zoneType: zone.type,
        label: zone.label,
        text,
        confidence,
        psm: psmForZoneType(zone.type),
        bboxNorm: zone.bboxNorm,
        source,
        fieldKeys: zone.fieldKeys,
      };
    } catch (zoneErr: any) {
      console.warn(`[ZoneOCR] Zone ${zone.id} skipped: ${zoneErr?.message}`);
    }
  }

  const zoneFields = extractFieldsFromZoneOcr(layout, zoneOcr);
  const fieldRegionMap = buildFieldRegionMapFromZones(
    layout.fieldRegionMap as Record<string, { zoneId: string; extractedValue?: string }> | undefined,
    zones,
    zoneFields,
  );
  const enrichedOcrText = buildZoneEnrichedOcrText(zoneOcr, zones)
    || options.fullPageText
    || '';

  const usedZoneOcr = Object.values(zoneOcr).some(
    (z) => z.source === 'zone_tesseract' && z.text.length > 0 && z.confidence >= minZoneConf,
  );

  return {
    zoneOcr,
    fieldRegionMap,
    zoneFields,
    enrichedOcrText,
    usedZoneOcr,
  };
}
