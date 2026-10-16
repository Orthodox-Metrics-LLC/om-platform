/**
 * SSP POC benchmark — load curated images, match to om_church_46 records,
 * cross-reference OCR vs DB fields, and capture continual-learning artifacts.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  type AnalyzeFileResult,
  getAnalyzeFileDir,
  getAnalyzeOcrTextPath,
  loadAnalyzeSession,
} from './ocrAnalyzeService';
import {
  extractZoneMappedFields,
  getExtractedFieldsFromLayout,
  identifyLayoutFromImage,
  type LayoutIdentificationResult,
} from './ocrLayoutIdentificationService';
import {
  assertAllowedScanPath,
  collectImageFiles,
  scanDirectoryAndAnalyze,
} from './ocrAnalyzeAuditService';

const { getChurchDbConnection } = require('../utils/dbSwitcher') as {
  getChurchDbConnection: (dbName: string) => Promise<import('mysql2/promise').Pool>;
};
const { promisePool } = require('../config/db');

export const BENCHMARK_CHURCH_ID = 46;
export const SSP_POC_BENCHMARK_ROOT = path.resolve(__dirname, '../../docs/ssppoc-record-images');
export const BENCHMARK_LEARNING_DIR = path.resolve(__dirname, '../storage/ocr-benchmark-learning');

export type BenchmarkRecordType = 'baptism' | 'marriage' | 'funeral';

export interface BenchmarkFieldSpec {
  key: string;
  label: string;
  dbColumns: string[];
}

export interface BenchmarkFieldComparison {
  field: string;
  label: string;
  dbValue: string | null;
  ocrValue: string | null;
  status: 'match' | 'mismatch' | 'missing_db' | 'missing_ocr' | 'skipped';
  score: number;
}

export interface BenchmarkImageComparison {
  fileId: string;
  relativePath: string;
  basename: string;
  expectedRecordType: BenchmarkRecordType | 'unknown';
  suggestedRecordType: string;
  recordTypeMatch: boolean;
  matchMethod: string | null;
  matchConfidence: number;
  recordId: number | null;
  recordType: BenchmarkRecordType | null;
  fieldComparisons: BenchmarkFieldComparison[];
  fieldMatchPct: number;
  layoutId: string | null;
  layoutTitle: string | null;
  layoutType: string | null;
  zoneCount: number;
  templateMatchId: number | null;
  ocrConfidence: number;
  error?: string;
}

export interface BenchmarkCompareReport {
  churchId: number;
  sessionId: string | null;
  generatedAt: string;
  benchmarkRoot: string;
  dbAvailable: boolean;
  dbError?: string;
  dbRecordCounts: Record<BenchmarkRecordType, number>;
  summary: {
    totalImages: number;
    analyzed: number;
    matchedToDb: number;
    unmatched: number;
    recordTypeAccuracyPct: number;
    avgFieldMatchPct: number;
    fieldStats: Record<string, { match: number; mismatch: number; missing: number }>;
  };
  learningArtifactsCaptured: number;
  items: BenchmarkImageComparison[];
}

const FIELD_SPECS: Record<BenchmarkRecordType, BenchmarkFieldSpec[]> = {
  baptism: [
    { key: 'first_name', label: 'First name', dbColumns: ['first_name'] },
    { key: 'last_name', label: 'Last name', dbColumns: ['last_name'] },
    { key: 'birth_date', label: 'Birth date', dbColumns: ['birth_date'] },
    { key: 'reception_date', label: 'Baptism date', dbColumns: ['reception_date', 'baptism_date'] },
    { key: 'parents', label: 'Parents', dbColumns: ['parents'] },
    { key: 'sponsors', label: 'Sponsors', dbColumns: ['sponsors', 'godparents'] },
    { key: 'clergy', label: 'Officiant', dbColumns: ['clergy', 'priest', 'officiant'] },
  ],
  marriage: [
    { key: 'groom_first', label: 'Groom first', dbColumns: ['fname_groom', 'groom_first_name'] },
    { key: 'groom_last', label: 'Groom last', dbColumns: ['lname_groom', 'groom_last_name'] },
    { key: 'bride_first', label: 'Bride first', dbColumns: ['fname_bride', 'bride_first_name'] },
    { key: 'bride_last', label: 'Bride last', dbColumns: ['lname_bride', 'bride_last_name'] },
    { key: 'marriage_date', label: 'Marriage date', dbColumns: ['mdate', 'marriage_date'] },
    { key: 'parents_groom', label: 'Groom parents', dbColumns: ['parentsg', 'groom_parents'] },
    { key: 'parents_bride', label: 'Bride parents', dbColumns: ['parentsb', 'bride_parents'] },
    { key: 'witness', label: 'Witnesses', dbColumns: ['witness', 'witnesses'] },
    { key: 'clergy', label: 'Officiant', dbColumns: ['clergy', 'priest'] },
  ],
  funeral: [
    { key: 'first_name', label: 'First name', dbColumns: ['name', 'first_name'] },
    { key: 'last_name', label: 'Last name', dbColumns: ['lastname', 'last_name'] },
    { key: 'deceased_date', label: 'Death date', dbColumns: ['deceased_date', 'death_date'] },
    { key: 'burial_date', label: 'Burial date', dbColumns: ['burial_date', 'funeral_date'] },
    { key: 'age', label: 'Age', dbColumns: ['age'] },
    { key: 'clergy', label: 'Officiant', dbColumns: ['clergy', 'priest'] },
    { key: 'burial_location', label: 'Burial place', dbColumns: ['burial_location', 'place_of_burial'] },
  ],
};

const TABLE_BY_TYPE: Record<BenchmarkRecordType, string> = {
  baptism: 'baptism_records',
  marriage: 'marriage_records',
  funeral: 'funeral_records',
};

function expectedTypeFromRelative(rel: string): BenchmarkRecordType | 'unknown' {
  const p = rel.replace(/\\/g, '/').toLowerCase();
  if (p.startsWith('baptism')) return 'baptism';
  if (p.startsWith('marriages') || p.startsWith('marriage')) return 'marriage';
  if (p.startsWith('deaths') || p.startsWith('death') || p.startsWith('funeral')) return 'funeral';
  return 'unknown';
}

function basenameOf(rel: string): string {
  return path.basename(rel.replace(/\\/g, '/'));
}

function normalizeText(value: string | null | undefined): string {
  if (value == null) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(value: string | null | undefined): string {
  if (!value) return '';
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (us) {
    const y = us[3].length === 2 ? `19${us[3]}` : us[3];
    const m = us[1].padStart(2, '0');
    const d = us[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return normalizeText(s);
}

function pickDbValue(row: Record<string, unknown>, columns: string[]): string | null {
  for (const col of columns) {
    const v = row[col];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

function valueInOcrText(dbValue: string, ocrText: string, isDate = false): boolean {
  const normOcr = normalizeText(ocrText);
  if (!normOcr) return false;

  if (isDate) {
    const nd = normalizeDate(dbValue);
    if (!nd) return false;
    const [, y, m, d] = nd.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
    if (!y) return false;
    const patterns = [
      `${m}/${d}/${y}`,
      `${m}-${d}-${y}`,
      `${d}/${m}/${y}`,
      `${parseInt(m, 10)}/${parseInt(d, 10)}/${y.slice(2)}`,
      `${y}-${m}-${d}`,
    ];
    return patterns.some((p) => normOcr.includes(normalizeText(p)));
  }

  const normDb = normalizeText(dbValue);
  if (!normDb) return false;
  if (normOcr.includes(normDb)) return true;

  const tokens = normDb.split(' ').filter((t) => t.length > 2);
  if (tokens.length === 0) return false;
  const hitCount = tokens.filter((t) => normOcr.includes(t)).length;
  return hitCount / tokens.length >= 0.6;
}

function compareFieldValues(
  dbValue: string,
  extractedValue: string | null | undefined,
  isDate = false,
): { match: boolean; score: number } {
  if (!extractedValue?.trim()) return { match: false, score: 0 };

  if (isDate) {
    const nd = normalizeDate(dbValue);
    const ne = normalizeDate(extractedValue);
    if (nd && ne && nd === ne) return { match: true, score: 1 };
    return { match: false, score: 0 };
  }

  const normDb = normalizeText(dbValue);
  const normExt = normalizeText(extractedValue);
  if (!normDb || !normExt) return { match: false, score: 0 };
  if (normExt.includes(normDb) || normDb.includes(normExt)) return { match: true, score: 1 };

  const tokens = normDb.split(' ').filter((t) => t.length > 2);
  if (tokens.length === 0) return { match: false, score: 0 };
  const hitCount = tokens.filter((t) => normExt.includes(t)).length;
  const ratio = hitCount / tokens.length;
  return { match: ratio >= 0.6, score: ratio >= 0.6 ? 1 : 0 };
}

function compareFieldsForRecord(
  recordType: BenchmarkRecordType,
  dbRow: Record<string, unknown>,
  extractedFields: Record<string, string>,
  ocrTextFallback: string,
): BenchmarkFieldComparison[] {
  const specs = FIELD_SPECS[recordType];
  return specs.map((spec) => {
    const dbValue = pickDbValue(dbRow, spec.dbColumns);
    const isDate = spec.key.includes('date') || spec.key === 'age';
    if (!dbValue) {
      return {
        field: spec.key,
        label: spec.label,
        dbValue: null,
        ocrValue: null,
        status: 'missing_db',
        score: 0,
      };
    }

    const extracted = extractedFields[spec.key] || null;
    let comparison = compareFieldValues(dbValue, extracted, isDate && spec.key !== 'age');

    if (!comparison.match && ocrTextFallback) {
      const textHit = valueInOcrText(dbValue, ocrTextFallback, isDate && spec.key !== 'age');
      if (textHit) {
        comparison = { match: true, score: 0.7 };
      }
    }

    return {
      field: spec.key,
      label: spec.label,
      dbValue,
      ocrValue: extracted || (comparison.match ? dbValue : null),
      status: comparison.match ? 'match' : 'missing_ocr',
      score: comparison.score,
    };
  });
}

function scoreFieldComparisons(comparisons: BenchmarkFieldComparison[]): number {
  const scored = comparisons.filter((c) => c.status !== 'missing_db' && c.status !== 'skipped');
  if (!scored.length) return 0;
  const sum = scored.reduce((a, c) => a + c.score, 0);
  return Math.round((sum / scored.length) * 1000) / 10;
}

export interface DbRecordIndex {
  records: Record<BenchmarkRecordType, Array<Record<string, unknown>>>;
  byFilename: Map<string, { type: BenchmarkRecordType; record: Record<string, unknown> }>;
  counts: Record<BenchmarkRecordType, number>;
  available: boolean;
  error?: string;
}

export async function loadChurch46RecordIndex(churchId: number): Promise<DbRecordIndex> {
  const empty: DbRecordIndex = {
    records: { baptism: [], marriage: [], funeral: [] },
    byFilename: new Map(),
    counts: { baptism: 0, marriage: 0, funeral: 0 },
    available: false,
  };

  if (churchId !== BENCHMARK_CHURCH_ID) {
    return { ...empty, error: 'Benchmark DB cross-reference is only enabled for church 46' };
  }

  try {
    const pool = await getChurchDbConnection(`om_church_${churchId}`);
    const index = { ...empty, available: true, byFilename: new Map<string, { type: BenchmarkRecordType; record: Record<string, unknown> }>() };

    for (const type of Object.keys(TABLE_BY_TYPE) as BenchmarkRecordType[]) {
      const table = TABLE_BY_TYPE[type];
      const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
      const list = rows as Record<string, unknown>[];
      index.records[type] = list;
      index.counts[type] = list.length;

      for (const row of list) {
        const candidates = [
          row.source_scan_id,
          row.source_filename,
          row.notes,
          row.registryNumber,
        ].filter(Boolean).map(String);

        for (const c of candidates) {
          const base = basenameOf(c);
          if (base.length > 4) {
            index.byFilename.set(base.toLowerCase(), { type, record: row });
          }
          const lower = c.toLowerCase();
          if (lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png')) {
            index.byFilename.set(basenameOf(lower).toLowerCase(), { type, record: row });
          }
        }
      }
    }

    try {
      const [histRows] = await pool.query(
        `SELECT source_filename, record_type, created_record_id FROM ocr_finalize_history
         WHERE source_filename IS NOT NULL AND created_record_id IS NOT NULL`,
      );
      for (const h of histRows as Array<{ source_filename: string; record_type: string; created_record_id: number }>) {
        const rt = h.record_type as BenchmarkRecordType;
        if (!TABLE_BY_TYPE[rt]) continue;
        const rec = index.records[rt].find((r) => Number(r.id) === Number(h.created_record_id));
        if (rec) {
          index.byFilename.set(basenameOf(h.source_filename).toLowerCase(), { type: rt, record: rec });
        }
      }
    } catch {
      /* ocr_finalize_history may not exist on older tenants */
    }

    return index;
  } catch (e: any) {
    return { ...empty, error: e?.message || 'Database unavailable' };
  }
}

function fuzzyMatchByOcrContent(
  recordType: BenchmarkRecordType,
  ocrText: string,
  extractedFields: Record<string, string>,
  records: Array<Record<string, unknown>>,
): { record: Record<string, unknown>; confidence: number } | null {
  if (!records.length || (!ocrText.trim() && !Object.keys(extractedFields).length)) return null;

  let best: { record: Record<string, unknown>; score: number } | null = null;
  for (const row of records) {
    const comparisons = compareFieldsForRecord(recordType, row, extractedFields, ocrText);
    const score = scoreFieldComparisons(comparisons);
    if (!best || score > best.score) {
      best = { record: row, score };
    }
  }

  if (!best || best.score < 25) return null;
  return { record: best.record, confidence: best.score / 100 };
}

function matchImageToRecord(
  basename: string,
  expectedType: BenchmarkRecordType | 'unknown',
  ocrText: string,
  extractedFields: Record<string, string>,
  index: DbRecordIndex,
): { record: Record<string, unknown>; type: BenchmarkRecordType; method: string; confidence: number } | null {
  const hit = index.byFilename.get(basename.toLowerCase());
  if (hit) {
    return { record: hit.record, type: hit.type, method: 'filename_metadata', confidence: 0.95 };
  }

  const typesToTry: BenchmarkRecordType[] = expectedType !== 'unknown'
    ? [expectedType]
    : (['baptism', 'marriage', 'funeral'] as BenchmarkRecordType[]);

  for (const type of typesToTry) {
    const fuzzy = fuzzyMatchByOcrContent(type, ocrText, extractedFields, index.records[type]);
    if (fuzzy) {
      return {
        record: fuzzy.record,
        type,
        method: 'layout_zone_fields',
        confidence: fuzzy.confidence,
      };
    }
  }

  return null;
}

async function resolveLayoutAndFields(
  churchId: number,
  sessionId: string,
  file: AnalyzeFileResult,
  ocrText: string,
): Promise<{ layout: LayoutIdentificationResult | null; extractedFields: Record<string, string> }> {
  if (file.layoutStructure) {
    const extracted = getExtractedFieldsFromLayout(file.layoutStructure);
    if (Object.keys(extracted).length) {
      return { layout: file.layoutStructure, extractedFields: extracted };
    }
  }

  const optimized = path.join(getAnalyzeFileDir(churchId, sessionId, file.id), 'optimized.jpg');
  if (fs.existsSync(optimized)) {
    try {
      const layout = await identifyLayoutFromImage(optimized, {
        churchId,
        recordTypeHint: file.suggestedRecordType,
        source: 'benchmark',
        ocrText,
        identificationContext: { originalFilename: file.originalFilename },
      });
      const extracted = getExtractedFieldsFromLayout(layout);
      if (!Object.keys(extracted).length && file.suggestedRecordType !== 'custom') {
        const rt = file.suggestedRecordType as 'baptism' | 'marriage' | 'funeral';
        if (['baptism', 'marriage', 'funeral'].includes(rt)) {
          Object.assign(
            extracted,
            extractZoneMappedFields(rt, ocrText, layout.detectedLayoutType),
          );
        }
      }
      return { layout, extractedFields: extracted };
    } catch {
      /* fall through */
    }
  }

  const rt = file.suggestedRecordType;
  if (['baptism', 'marriage', 'funeral'].includes(rt)) {
    return {
      layout: null,
      extractedFields: extractZoneMappedFields(
        rt as 'baptism' | 'marriage' | 'funeral',
        ocrText,
        file.detectedLayoutType,
      ),
    };
  }

  return { layout: null, extractedFields: {} };
}

async function readOcrTextForFile(
  churchId: number,
  sessionId: string,
  file: AnalyzeFileResult,
): Promise<string> {
  const textPath = getAnalyzeOcrTextPath(churchId, sessionId, file.id);
  if (textPath) {
    return fs.readFileSync(textPath, 'utf8');
  }
  const optimized = path.join(getAnalyzeFileDir(churchId, sessionId, file.id), 'optimized.jpg');
  if (!fs.existsSync(optimized)) {
    return file.ocrTextPreview || '';
  }
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('eng+ell+rus', 1, { logger: () => {} });
  try {
    const { data } = await worker.recognize(optimized);
    const text = String(data.text || '');
    if (text) {
      fs.writeFileSync(path.join(getAnalyzeFileDir(churchId, sessionId, file.id), 'ocr.txt'), text);
    }
    return text;
  } finally {
    await worker.terminate();
  }
}

export function getBenchmarkRootForChurch(churchId: number): string | null {
  if (churchId !== BENCHMARK_CHURCH_ID) return null;
  if (!fs.existsSync(SSP_POC_BENCHMARK_ROOT)) return null;
  return SSP_POC_BENCHMARK_ROOT;
}

export async function loadBenchmarkDataset(
  churchId: number,
  options: { sessionId?: string | null; maxFiles?: number } = {},
): Promise<{ sessionId: string; report: Awaited<ReturnType<typeof scanDirectoryAndAnalyze>> }> {
  const root = getBenchmarkRootForChurch(churchId);
  if (!root) {
    throw new Error(`Benchmark corpus not available for church ${churchId}`);
  }
  assertAllowedScanPath(churchId, root);
  const collected = collectImageFiles(root, true);
  const maxFiles = options.maxFiles ?? 250;
  if (collected.length > maxFiles) {
    throw new Error(`Benchmark set has ${collected.length} images (max ${maxFiles})`);
  }

  const report = await scanDirectoryAndAnalyze(churchId, root, {
    recursive: true,
    maxFiles,
    sessionId: options.sessionId,
  });

  return { sessionId: report.sessionId || '', report };
}

export async function buildBenchmarkCompareReport(
  churchId: number,
  sessionId: string,
  options: { captureLearning?: boolean } = {},
): Promise<BenchmarkCompareReport> {
  const manifest = loadAnalyzeSession(churchId, sessionId);
  if (!manifest) {
    throw new Error('Analyze session not found');
  }

  const dbIndex = await loadChurch46RecordIndex(churchId);
  const items: BenchmarkImageComparison[] = [];
  const fieldStats: Record<string, { match: number; mismatch: number; missing: number }> = {};
  let matched = 0;
  let typeCorrect = 0;
  let fieldPctSum = 0;
  let fieldPctCount = 0;

  for (const file of manifest.files) {
    const rel = file.originalFilename.replace(/\\/g, '/');
    const base = basenameOf(rel);
    const expectedType = expectedTypeFromRelative(rel);
    const suggested = file.suggestedRecordType === 'custom' ? 'unknown' : file.suggestedRecordType;
    const recordTypeMatch = expectedType !== 'unknown' && suggested === expectedType;

    if (recordTypeMatch) typeCorrect += 1;

    try {
      const ocrText = await readOcrTextForFile(churchId, sessionId, file);
      const { layout, extractedFields } = await resolveLayoutAndFields(churchId, sessionId, file, ocrText);
      const match = dbIndex.available
        ? matchImageToRecord(base, expectedType, ocrText, extractedFields, dbIndex)
        : null;

      let fieldComparisons: BenchmarkFieldComparison[] = [];
      let fieldMatchPct = 0;

      if (match) {
        matched += 1;
        fieldComparisons = compareFieldsForRecord(match.type, match.record, extractedFields, ocrText);
        fieldMatchPct = scoreFieldComparisons(fieldComparisons);
        fieldPctSum += fieldMatchPct;
        fieldPctCount += 1;

        for (const fc of fieldComparisons) {
          if (!fieldStats[fc.field]) {
            fieldStats[fc.field] = { match: 0, mismatch: 0, missing: 0 };
          }
          if (fc.status === 'match') fieldStats[fc.field].match += 1;
          else if (fc.status === 'missing_ocr') fieldStats[fc.field].mismatch += 1;
          else fieldStats[fc.field].missing += 1;
        }
      }

      items.push({
        fileId: file.id,
        relativePath: rel,
        basename: base,
        expectedRecordType: expectedType,
        suggestedRecordType: suggested,
        recordTypeMatch,
        matchMethod: match?.method ?? null,
        matchConfidence: match?.confidence ?? 0,
        recordId: match ? Number(match.record.id) : null,
        recordType: match?.type ?? null,
        fieldComparisons,
        fieldMatchPct,
        layoutId: layout?.matchedCatalogLayoutId ?? file.matchedCatalogLayoutId,
        layoutTitle: layout?.matchedCatalogLayoutTitle ?? file.matchedCatalogLayoutTitle,
        layoutType: layout?.detectedLayoutType ?? file.detectedLayoutType,
        zoneCount: layout?.zones?.length ?? file.zoneCount ?? 0,
        templateMatchId: layout?.templateMatchId ?? file.templateMatchId ?? null,
        ocrConfidence: file.ocrConfidence,
      });
    } catch (e: any) {
      items.push({
        fileId: file.id,
        relativePath: rel,
        basename: base,
        expectedRecordType: expectedType,
        suggestedRecordType: suggested,
        recordTypeMatch,
        matchMethod: null,
        matchConfidence: 0,
        recordId: null,
        recordType: null,
        fieldComparisons: [],
        fieldMatchPct: 0,
        layoutId: file.matchedCatalogLayoutId,
        layoutTitle: file.matchedCatalogLayoutTitle,
        layoutType: file.detectedLayoutType,
        zoneCount: file.zoneCount ?? 0,
        templateMatchId: file.templateMatchId ?? null,
        ocrConfidence: file.ocrConfidence,
        error: e?.message || 'Compare failed',
      });
    }
  }

  const analyzed = manifest.files.length;
  let learningArtifactsCaptured = 0;
  if (options.captureLearning !== false && dbIndex.available) {
    learningArtifactsCaptured = await captureBenchmarkLearningArtifacts(churchId, sessionId, items, manifest.files);
  }

  return {
    churchId,
    sessionId,
    generatedAt: new Date().toISOString(),
    benchmarkRoot: getBenchmarkRootForChurch(churchId) || SSP_POC_BENCHMARK_ROOT,
    dbAvailable: dbIndex.available,
    dbError: dbIndex.error,
    dbRecordCounts: dbIndex.counts,
    summary: {
      totalImages: analyzed,
      analyzed,
      matchedToDb: matched,
      unmatched: analyzed - matched,
      recordTypeAccuracyPct: analyzed > 0 ? Math.round((typeCorrect / analyzed) * 1000) / 10 : 0,
      avgFieldMatchPct: fieldPctCount > 0 ? Math.round((fieldPctSum / fieldPctCount) * 10) / 10 : 0,
      fieldStats,
    },
    learningArtifactsCaptured,
    items: items.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  };
}

interface LearningArtifact {
  churchId: number;
  sessionId: string;
  capturedAt: string;
  fileId: string;
  relativePath: string;
  recordType: BenchmarkRecordType | null;
  layoutId: string | null;
  layoutTitle: string | null;
  layoutType: string | null;
  zoneCount: number;
  templateMatchId: number | null;
  matchMethod: string | null;
  fieldOutcomes: BenchmarkFieldComparison[];
  suggestedPatterns: Array<{ field: string; pattern: string; source: 'confirmed' | 'mismatch' }>;
}

async function captureBenchmarkLearningArtifacts(
  churchId: number,
  sessionId: string,
  items: BenchmarkImageComparison[],
  files: AnalyzeFileResult[],
): Promise<number> {
  const outDir = path.join(BENCHMARK_LEARNING_DIR, `church_${churchId}`, sessionId);
  fs.mkdirSync(outDir, { recursive: true });

  const fileMap = new Map(files.map((f) => [f.id, f]));
  let count = 0;

  for (const item of items) {
    if (!item.recordType || !item.fieldComparisons.length) continue;
    const file = fileMap.get(item.fileId);
    if (!file) continue;

    const suggestedPatterns: LearningArtifact['suggestedPatterns'] = [];
    for (const fc of item.fieldComparisons) {
      if (fc.status === 'match' && fc.dbValue) {
        suggestedPatterns.push({
          field: fc.field,
          pattern: fc.dbValue.slice(0, 80),
          source: 'confirmed',
        });
      } else if (fc.status === 'missing_ocr' && fc.dbValue) {
        suggestedPatterns.push({
          field: fc.field,
          pattern: `(missing in OCR) expected: ${fc.dbValue.slice(0, 60)}`,
          source: 'mismatch',
        });
      }
    }

    const artifact: LearningArtifact = {
      churchId,
      sessionId,
      capturedAt: new Date().toISOString(),
      fileId: item.fileId,
      relativePath: item.relativePath,
      recordType: item.recordType,
      layoutId: item.layoutId,
      layoutTitle: item.layoutTitle,
      layoutType: item.layoutType,
      zoneCount: item.zoneCount,
      templateMatchId: item.templateMatchId,
      matchMethod: item.matchMethod,
      fieldOutcomes: item.fieldComparisons,
      suggestedPatterns,
    };

    const fname = `${item.fileId}_${crypto.randomBytes(3).toString('hex')}.json`;
    fs.writeFileSync(path.join(outDir, fname), JSON.stringify(artifact, null, 2));
    count += 1;
  }

  const summaryPath = path.join(outDir, '_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    churchId,
    sessionId,
    capturedAt: new Date().toISOString(),
    artifactCount: count,
    note: 'Feed confirmed layout/field patterns into ocr_extractors.learned_params via parish OCR settings.',
  }, null, 2));

  await upsertLayoutLearningFromBenchmark(churchId, items, files);
  const { upsertGlobalLayoutLearningFromBenchmark } = require('./globalLayoutMatchService');
  await upsertGlobalLayoutLearningFromBenchmark(items);
  return count;
}

async function upsertLayoutLearningFromBenchmark(
  churchId: number,
  items: BenchmarkImageComparison[],
  files: AnalyzeFileResult[],
): Promise<void> {
  const layoutGroups = new Map<string, { matches: number; mismatches: number; recordType: string; title: string | null }>();

  for (const item of items) {
    if (!item.layoutId || !item.recordType) continue;
    const g = layoutGroups.get(item.layoutId) || {
      matches: 0,
      mismatches: 0,
      recordType: item.recordType,
      title: item.layoutTitle,
    };
    if (item.fieldMatchPct >= 50) g.matches += 1;
    else g.mismatches += 1;
    layoutGroups.set(item.layoutId, g);
  }

  for (const [layoutId, stats] of layoutGroups) {
    if (stats.matches === 0) continue;
    try {
      const [rows] = await promisePool.query(
        `SELECT id, learned_params FROM ocr_extractors
         WHERE church_id = ? AND record_type = ?
           AND JSON_UNQUOTE(JSON_EXTRACT(learned_params, '$.catalog_layout_id')) = ?
         LIMIT 1`,
        [churchId, stats.recordType, layoutId],
      );
      const learnedPatch = {
        benchmark_last_run: new Date().toISOString(),
        benchmark_match_count: stats.matches,
        benchmark_mismatch_count: stats.mismatches,
        catalog_layout_id: layoutId,
        source: 'ssppoc_benchmark',
      };

      if ((rows as any[]).length) {
        const row = (rows as any[])[0];
        let learned: Record<string, unknown> = {};
        try {
          learned = typeof row.learned_params === 'string'
            ? JSON.parse(row.learned_params)
            : row.learned_params || {};
        } catch { learned = {}; }
        await promisePool.query(
          `UPDATE ocr_extractors SET learned_params = ?, updated_at = NOW() WHERE id = ?`,
          [JSON.stringify({ ...learned, ...learnedPatch }), row.id],
        );
      }
    } catch {
      /* ocr_extractors optional */
    }
  }
}

export function listBenchmarkLearningSessions(churchId: number): string[] {
  const dir = path.join(BENCHMARK_LEARNING_DIR, `church_${churchId}`);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory());
}
