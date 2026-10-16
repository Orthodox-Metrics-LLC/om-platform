/**
 * Enhanced parish record identification for the analyze upload flow.
 * Combines keyword classifier, global reference corpus signatures, and
 * optional folder-path context (batch imports).
 */

import { classifyRecordType } from './ocrClassifier';

const globalCorpus = require('../services/globalLayoutCorpusService') as {
  loadManifest: () => {
    layouts: Array<{
      catalog_layout_id: string;
      record_type: 'baptism' | 'marriage' | 'funeral';
      extraction_mode: string;
      signature_phrases?: string[];
    }>;
  };
};

export type RecordTypeHint = 'baptism' | 'marriage' | 'funeral' | 'unknown';

export interface RecordIdentificationContext {
  relativePath?: string;
  originalFilename?: string;
}

export interface EnhancedClassificationResult {
  suggested_type: RecordTypeHint;
  confidence: number;
  keyword_hits: Record<string, string[]>;
  corpus_hits: Record<string, string[]>;
  path_hint: { type: RecordTypeHint | null; confidence: number; source: string };
  signals: { keyword: number; corpus: number; path: number };
}

function emptyHits(): Record<string, string[]> {
  return { baptism: [], marriage: [], funeral: [] };
}

/** Infer record type from batch folder structure (Baptism/, Marriages/, Deaths/, etc.). */
export function inferRecordTypeFromPath(relativePath: string): {
  suggested_type: 'baptism' | 'marriage' | 'funeral' | null;
  confidence: number;
  source: string;
} {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);

  for (const seg of segments) {
    if (seg === 'baptism' || seg === 'baptisms' || /^baptism/.test(seg)) {
      return { suggested_type: 'baptism', confidence: 0.78, source: `folder:${seg}` };
    }
    if (seg === 'marriage' || seg === 'marriages' || /^marriag/.test(seg)) {
      return { suggested_type: 'marriage', confidence: 0.78, source: `folder:${seg}` };
    }
    if (
      seg === 'death' || seg === 'deaths' || seg === 'funeral' || seg === 'funerals'
      || /^death/.test(seg) || /^funeral/.test(seg)
    ) {
      return { suggested_type: 'funeral', confidence: 0.78, source: `folder:${seg}` };
    }
  }

  return { suggested_type: null, confidence: 0, source: '' };
}

function scoreCorpusSignatures(ocrText: string): {
  scores: Record<'baptism' | 'marriage' | 'funeral', number>;
  hits: Record<string, string[]>;
  layoutScores: Array<{ layoutId: string; recordType: string; score: number }>;
} {
  const textUpper = String(ocrText || '').toUpperCase().replace(/\s+/g, ' ');
  const scores = { baptism: 0, marriage: 0, funeral: 0 };
  const hits = emptyHits();
  const layoutScores: Array<{ layoutId: string; recordType: string; score: number }> = [];

  if (!textUpper.trim()) {
    return { scores, hits, layoutScores };
  }

  for (const layout of globalCorpus.loadManifest().layouts || []) {
    let layoutScore = 0;
    for (const phrase of layout.signature_phrases || []) {
      const needle = String(phrase).toUpperCase().trim();
      if (!needle) continue;
      if (textUpper.includes(needle)) {
        layoutScore += 1;
        scores[layout.record_type] += 1;
        hits[layout.record_type].push(needle);
      }
    }
    if (layoutScore > 0) {
      layoutScores.push({
        layoutId: layout.catalog_layout_id,
        recordType: layout.record_type,
        score: layoutScore,
      });
    }
  }

  layoutScores.sort((a, b) => b.score - a.score);
  return { scores, hits, layoutScores };
}

function normalizeScores(scores: Record<string, number>): Record<string, number> {
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total <= 0) return { baptism: 0, marriage: 0, funeral: 0 };
  return {
    baptism: scores.baptism / total,
    marriage: scores.marriage / total,
    funeral: scores.funeral / total,
  };
}

/**
 * Merge keyword, corpus, and optional path signals into a single classification.
 */
export function classifyRecordTypeEnhanced(
  ocrText: string,
  context: RecordIdentificationContext = {},
): EnhancedClassificationResult {
  const keyword = classifyRecordType(ocrText);
  const corpus = scoreCorpusSignatures(ocrText);
  const pathContext = context.relativePath || context.originalFilename || '';
  const pathHint = pathContext ? inferRecordTypeFromPath(pathContext) : {
    suggested_type: null,
    confidence: 0,
    source: '',
  };

  const keywordNorm = keyword.suggested_type === 'unknown'
    ? { baptism: 0, marriage: 0, funeral: 0 }
    : { baptism: 0, marriage: 0, funeral: 0, [keyword.suggested_type]: keyword.confidence };

  const corpusNorm = normalizeScores(corpus.scores);

  const combined = { baptism: 0, marriage: 0, funeral: 0 };
  const keywordWeight = 0.42;
  const corpusWeight = 0.38;
  const pathWeight = 0.20;

  for (const type of ['baptism', 'marriage', 'funeral'] as const) {
    combined[type] += (keywordNorm[type] || 0) * keywordWeight;
    combined[type] += (corpusNorm[type] || 0) * corpusWeight;
    if (pathHint.suggested_type === type) {
      combined[type] += pathHint.confidence * pathWeight;
    }
  }

  // When OCR is empty/weak, lean on path hint for batch folder imports.
  const ocrWeak = !ocrText?.trim() || keyword.suggested_type === 'unknown';
  if (ocrWeak && pathHint.suggested_type) {
    combined[pathHint.suggested_type] += 0.25;
  }

  let bestType: RecordTypeHint = 'unknown';
  let bestScore = 0;
  for (const [type, score] of Object.entries(combined)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type as RecordTypeHint;
    }
  }

  // Prefer explicit batch folder context when OCR signals are ambiguous.
  if (
    pathHint.suggested_type
    && bestType !== pathHint.suggested_type
    && pathHint.confidence >= 0.75
    && (combined[pathHint.suggested_type] || 0) >= bestScore * 0.82
  ) {
    bestType = pathHint.suggested_type;
    bestScore = combined[pathHint.suggested_type];
  }

  const threshold = ocrWeak && pathHint.suggested_type ? 0.22 : 0.28;
  if (bestScore < threshold) {
    return {
      suggested_type: 'unknown',
      confidence: 0,
      keyword_hits: keyword.keyword_hits,
      corpus_hits: corpus.hits,
      path_hint: {
        type: pathHint.suggested_type,
        confidence: pathHint.confidence,
        source: pathHint.source,
      },
      signals: {
        keyword: keyword.confidence,
        corpus: corpusNorm[bestType as keyof typeof corpusNorm] || 0,
        path: pathHint.confidence,
      },
    };
  }

  return {
    suggested_type: bestType,
    confidence: Math.round(Math.min(bestScore, 0.98) * 1000) / 1000,
    keyword_hits: keyword.keyword_hits,
    corpus_hits: corpus.hits,
    path_hint: {
      type: pathHint.suggested_type,
      confidence: pathHint.confidence,
      source: pathHint.source,
    },
    signals: {
      keyword: keyword.confidence,
      corpus: corpusNorm[bestType as keyof typeof corpusNorm] || 0,
      path: pathHint.confidence,
    },
  };
}

export function matchCorpusCatalogLayout(
  recordType: RecordTypeHint,
  layoutType: 'tabular' | 'form' | 'narrative',
  ocrText: string,
): { layoutId: string | null; title: string | null; confidence: number } {
  if (recordType === 'unknown') {
    return { layoutId: null, title: null, confidence: 0 };
  }

  const modeMap: Record<string, string[]> = {
    tabular: ['tabular'],
    narrative: ['narrative_block'],
    form: ['form', 'multi_form'],
  };
  const modes = modeMap[layoutType] || ['form', 'multi_form'];
  const textUpper = String(ocrText || '').toUpperCase();

  const layouts = (globalCorpus.loadManifest().layouts || []).filter(
    (l) => l.record_type === recordType && modes.includes(l.extraction_mode),
  );

  let best: { layoutId: string; score: number } | null = null;
  for (const layout of layouts) {
    let score = 0.5;
    for (const phrase of layout.signature_phrases || []) {
      const needle = String(phrase).toUpperCase().trim();
      if (needle && textUpper.includes(needle)) score += 0.08;
    }
    if (!best || score > best.score) {
      best = { layoutId: layout.catalog_layout_id, score: Math.min(score, 0.97) };
    }
  }

  if (!best) return { layoutId: null, title: null, confidence: 0 };

  const { getAllLayouts } = require('../services/ocrLayoutCatalogService') as {
    getAllLayouts: () => Array<{ id: string; title: string }>;
  };
  const catalog = getAllLayouts().find((l) => l.id === best!.layoutId);

  return {
    layoutId: best.layoutId,
    title: catalog?.title || best.layoutId,
    confidence: Math.round(best.score * 1000) / 1000,
  };
}
