/**
 * Global layout catalog matching — primary reference for ALL church uploads.
 * Global extractors (church_id NULL) + ocr-layout-catalog.json define shared geometry;
 * parish extractors boost/override only when clearly better.
 */
const { promisePool } = require('../config/db');
const globalCorpus = require('./globalLayoutCorpusService');
const {
  findExtractorByCatalogId,
  normalizeColumnBands,
} = require('./catalogLayoutExtractorShared');
const { scoreTemplatesFromVision } = require('./layoutTemplateMatcher');

const HIGH_CONFIDENCE_LAYOUT = 0.72;
const HIGH_CONFIDENCE_CATALOG = 0.62;
const CANDIDATE_MATCH_THRESHOLD = 5;
const CHURCH_OVERRIDE_MARGIN = 1.0;

function parseLearnedParams(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }
  return raw;
}

function parseColumnBands(raw) {
  if (!raw) return null;
  let bands = raw;
  if (typeof bands === 'string') {
    try { bands = JSON.parse(bands); } catch { return null; }
  }
  if (!Array.isArray(bands)) return null;
  return normalizeColumnBands(bands);
}

async function ensureGlobalLayoutStatsTable() {
  try {
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS ocr_global_layout_stats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        catalog_layout_id VARCHAR(128) NOT NULL,
        record_type ENUM('baptism', 'marriage', 'funeral') NOT NULL,
        match_count INT NOT NULL DEFAULT 0,
        high_confidence_count INT NOT NULL DEFAULT 0,
        last_matched_at DATETIME NULL,
        last_church_id INT NULL,
        candidate_status ENUM('none', 'candidate', 'approved') NOT NULL DEFAULT 'none',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_catalog_record (catalog_layout_id, record_type),
        KEY idx_record_type (record_type),
        KEY idx_candidate_status (candidate_status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (err) {
    console.warn(`[GlobalLayoutMatch] stats table ensure warning: ${err.message}`);
  }
}

/**
 * Ensure platform-wide global extractors for all catalog layouts (any language).
 * Geometry applies cross-language; signature phrases may be EN-biased but matching is permissive.
 */
async function ensureGlobalLayouts(recordType = null) {
  return globalCorpus.ensureGlobalEnglishLayouts(recordType);
}

async function fetchTemplateRows(churchId, recordType) {
  if (!recordType || recordType === 'custom' || recordType === 'unknown') {
    return { globalRows: [], churchRows: [] };
  }

  const [globalRows] = await promisePool.query(
    `SELECT id, church_id, record_type, column_bands, header_y_threshold, learned_params, status
     FROM ocr_extractors
     WHERE church_id IS NULL AND record_type = ?
     ORDER BY is_default DESC, id ASC`,
    [recordType],
  );

  let churchRows = [];
  if (churchId) {
    const [rows] = await promisePool.query(
      `SELECT id, church_id, record_type, column_bands, header_y_threshold, learned_params, status
       FROM ocr_extractors
       WHERE church_id = ? AND record_type = ?
       ORDER BY is_default DESC, id ASC`,
      [churchId, recordType],
    );
    churchRows = rows;
  }

  return { globalRows, churchRows };
}

/**
 * Match layout templates: global catalog FIRST, parish override only when clearly better.
 */
async function matchLayoutTemplates(churchId, recordType, ocrText, language = 'en') {
  const empty = {
    templateId: null,
    score: 0,
    columnBands: null,
    headerY: null,
    catalogLayoutId: null,
    layoutMatchScope: 'heuristic',
    globalCatalogLayoutId: null,
  };

  if (!recordType || recordType === 'custom' || recordType === 'unknown') {
    return empty;
  }

  await ensureGlobalLayouts(recordType);

  const { globalRows, churchRows } = await fetchTemplateRows(churchId, recordType);
  const allRows = [...globalRows, ...churchRows];
  if (!allRows.length) return empty;

  const globalScored = scoreTemplatesFromVision(globalRows, null, ocrText, {
    churchId: null,
    language,
    skipLanguageFilter: true,
  });
  const churchScored = churchRows.length
    ? scoreTemplatesFromVision(churchRows, null, ocrText, { churchId, language })
    : { best: null, candidates: [] };

  const globalBest = globalScored.best;
  const churchBest = churchScored.best;

  let chosen = globalBest;
  let layoutMatchScope = 'global';

  if (churchBest && globalBest) {
    if (churchBest.score >= globalBest.score + CHURCH_OVERRIDE_MARGIN) {
      chosen = churchBest;
      layoutMatchScope = 'parish';
    }
  } else if (churchBest && !globalBest) {
    chosen = churchBest;
    layoutMatchScope = 'parish';
  }

  if (!chosen) {
    const fallbackRow = globalRows[0] || churchRows[0];
    if (fallbackRow) {
      const learned = parseLearnedParams(fallbackRow.learned_params);
      return {
        templateId: fallbackRow.id,
        score: 0,
        columnBands: parseColumnBands(fallbackRow.column_bands),
        headerY: fallbackRow.header_y_threshold ?? 0.12,
        catalogLayoutId: learned.catalog_layout_id || null,
        layoutMatchScope: fallbackRow.church_id ? 'parish' : 'global',
        globalCatalogLayoutId: learned.catalog_layout_id || null,
      };
    }
    return empty;
  }

  const learned = parseLearnedParams(chosen.row.learned_params);
  const catalogLayoutId = learned.catalog_layout_id || null;

  return {
    templateId: chosen.id,
    score: chosen.score,
    columnBands: parseColumnBands(chosen.row.column_bands),
    headerY: chosen.row.header_y_threshold ?? 0.12,
    catalogLayoutId,
    layoutMatchScope,
    globalCatalogLayoutId: layoutMatchScope === 'global' ? catalogLayoutId : catalogLayoutId,
  };
}

async function recordLayoutMatchStats({
  catalogLayoutId,
  recordType,
  churchId,
  layoutConfidence = 0,
  catalogMatchConfidence = 0,
}) {
  if (!catalogLayoutId || !recordType || recordType === 'custom' || recordType === 'unknown') {
    return;
  }

  await ensureGlobalLayoutStatsTable();
  const highConf = layoutConfidence >= HIGH_CONFIDENCE_LAYOUT
    && catalogMatchConfidence >= HIGH_CONFIDENCE_CATALOG;

  await promisePool.query(
    `INSERT INTO ocr_global_layout_stats
       (catalog_layout_id, record_type, match_count, high_confidence_count, last_matched_at, last_church_id)
     VALUES (?, ?, 1, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       match_count = match_count + 1,
       high_confidence_count = high_confidence_count + VALUES(high_confidence_count),
       last_matched_at = NOW(),
       last_church_id = VALUES(last_church_id),
       updated_at = NOW()`,
    [catalogLayoutId, recordType, highConf ? 1 : 0, churchId || null],
  );
}

async function persistHighConfidenceGlobalLayout({
  catalogLayoutId,
  recordType,
  layoutConfidence,
  catalogMatchConfidence,
  columnBands,
  headerYThreshold,
  signaturePhrases,
  layoutType,
}) {
  if (!catalogLayoutId || !recordType || recordType === 'custom' || recordType === 'unknown') {
    return null;
  }
  if (layoutConfidence < HIGH_CONFIDENCE_LAYOUT || catalogMatchConfidence < HIGH_CONFIDENCE_CATALOG) {
    return null;
  }

  await ensureGlobalLayouts(recordType);

  const extractorId = await findExtractorByCatalogId(promisePool, null, recordType, catalogLayoutId);
  if (!extractorId) return null;

  const [rows] = await promisePool.query(
    'SELECT learned_params, column_bands, header_y_threshold FROM ocr_extractors WHERE id = ? LIMIT 1',
    [extractorId],
  );
  if (!rows.length) return null;

  const row = rows[0];
  let learned = parseLearnedParams(row.learned_params);
  learned.last_high_confidence_match = new Date().toISOString();
  learned.high_confidence_match_count = (learned.high_confidence_match_count || 0) + 1;
  learned.detected_layout_type = layoutType || learned.detected_layout_type;
  if (Array.isArray(signaturePhrases) && signaturePhrases.length) {
    const existing = new Set(learned.signature_phrases || []);
    for (const p of signaturePhrases) existing.add(p);
    learned.signature_phrases = [...existing].slice(0, 40);
  }

  const bandsJson = columnBands ? JSON.stringify(normalizeColumnBands(columnBands)) : null;
  await promisePool.query(
    `UPDATE ocr_extractors SET
       learned_params = ?,
       column_bands = COALESCE(?, column_bands),
       header_y_threshold = COALESCE(?, header_y_threshold),
       updated_at = NOW()
     WHERE id = ? AND church_id IS NULL`,
    [
      JSON.stringify(learned),
      bandsJson,
      headerYThreshold ?? null,
      extractorId,
    ],
  );

  await promisePool.query(
    `UPDATE ocr_global_layout_stats SET candidate_status = 'approved', updated_at = NOW()
     WHERE catalog_layout_id = ? AND record_type = ? AND candidate_status = 'candidate'`,
    [catalogLayoutId, recordType],
  );

  return extractorId;
}

async function maybeCreateGlobalLayoutCandidate({
  recordType,
  layoutType,
  layoutConfidence,
  catalogLayoutId,
  columnBands,
  headerYThreshold,
}) {
  if (catalogLayoutId) return null;
  if (!recordType || recordType === 'custom' || recordType === 'unknown') return null;
  if (layoutConfidence < HIGH_CONFIDENCE_LAYOUT) return null;
  if (!['tabular', 'form', 'multi_form'].includes(layoutType)) return null;

  await ensureGlobalLayoutStatsTable();

  const candidateKey = `candidate-${recordType}-${layoutType}`;

  await promisePool.query(
    `INSERT INTO ocr_global_layout_stats
       (catalog_layout_id, record_type, match_count, high_confidence_count, last_matched_at, candidate_status)
     VALUES (?, ?, 1, 1, NOW(), 'candidate')
     ON DUPLICATE KEY UPDATE
       match_count = match_count + 1,
       high_confidence_count = high_confidence_count + 1,
       candidate_status = IF(match_count + 1 >= ?, 'candidate', candidate_status),
       last_matched_at = NOW(),
       updated_at = NOW()`,
    [candidateKey, recordType, CANDIDATE_MATCH_THRESHOLD],
  );

  const [statRows] = await promisePool.query(
    `SELECT match_count FROM ocr_global_layout_stats
     WHERE catalog_layout_id = ? AND record_type = ? LIMIT 1`,
    [candidateKey, recordType],
  );
  const matchCount = statRows[0]?.match_count || 0;
  if (matchCount >= CANDIDATE_MATCH_THRESHOLD) {
    console.log(
      `[GlobalLayoutMatch] Layout candidate ${candidateKey} reached ${matchCount} matches — pending superadmin/benchmark approval`,
    );
  }

  return candidateKey;
}

/**
 * After identification, record stats and optionally persist global learning.
 */
async function afterLayoutIdentification(layoutResult, churchId) {
  const catalogLayoutId = layoutResult.globalCatalogLayoutId
    || layoutResult.matchedCatalogLayoutId;
  const recordType = layoutResult.suggestedRecordType;

  if (catalogLayoutId && recordType && recordType !== 'custom' && recordType !== 'unknown') {
    await recordLayoutMatchStats({
      catalogLayoutId,
      recordType,
      churchId,
      layoutConfidence: layoutResult.layoutConfidence || 0,
      catalogMatchConfidence: layoutResult.catalogMatchConfidence || 0,
    });

    await persistHighConfidenceGlobalLayout({
      catalogLayoutId,
      recordType,
      layoutConfidence: layoutResult.layoutConfidence || 0,
      catalogMatchConfidence: layoutResult.catalogMatchConfidence || 0,
      columnBands: layoutResult.columnBands,
      headerYThreshold: layoutResult.headerYThreshold,
      layoutType: layoutResult.detectedLayoutType,
    });
  } else {
    await maybeCreateGlobalLayoutCandidate({
      recordType,
      layoutType: layoutResult.detectedLayoutType,
      layoutConfidence: layoutResult.layoutConfidence || 0,
      catalogLayoutId: null,
      columnBands: layoutResult.columnBands,
      headerYThreshold: layoutResult.headerYThreshold,
    });
  }
}

/**
 * Merge worker layout signals into ingest-time layout_classification_json (never overwrite zones/catalog).
 */
function mergeLayoutClassificationJson(existing, workerPatch) {
  if (!existing && !workerPatch) return null;
  if (!existing) return workerPatch ? { ...workerPatch, workerEnrichedAt: new Date().toISOString() } : null;
  if (!workerPatch) return existing;

  const preserveKeys = [
    'zones',
    'zoneOcr',
    'zoneOcrAt',
    'zoneOcrUsed',
    'fieldRegionMap',
    'globalCatalogLayoutId',
    'matchedCatalogLayoutId',
    'matchedCatalogLayoutTitle',
    'catalogMatchConfidence',
    'layoutMatchScope',
    'layoutMatchSource',
    'templateMatchId',
    'templateMatchScore',
    'columnBands',
    'headerYThreshold',
    'pipelineVersion',
    'identifiedAt',
    'source',
    'recordLayoutMode',
    'sourcePipeline',
    'userOverridden',
  ];

  const merged = { ...existing };
  for (const key of preserveKeys) {
    if (existing[key] !== undefined && existing[key] !== null) {
      merged[key] = existing[key];
    }
  }

  if (workerPatch.detectedLayoutType) merged.detectedLayoutType = workerPatch.detectedLayoutType;
  if (workerPatch.layoutConfidence != null) {
    merged.layoutConfidence = Math.max(existing.layoutConfidence || 0, workerPatch.layoutConfidence);
  }
  if (workerPatch.layoutSignals) {
    merged.layoutSignals = { ...(existing.layoutSignals || {}), ...workerPatch.layoutSignals };
  }
  if (workerPatch.suggestedRecordType && (!existing.suggestedRecordType || existing.suggestedRecordType === 'custom')) {
    merged.suggestedRecordType = workerPatch.suggestedRecordType;
  }
  if (workerPatch.recordTypeConfidence != null) {
    merged.recordTypeConfidence = Math.max(existing.recordTypeConfidence || 0, workerPatch.recordTypeConfidence);
  }

  merged.workerEnrichedAt = new Date().toISOString();
  merged.workerLayoutSignals = workerPatch.layoutSignals || workerPatch.classificationSignals || null;

  if (!merged.globalCatalogLayoutId && merged.matchedCatalogLayoutId) {
    merged.globalCatalogLayoutId = merged.matchedCatalogLayoutId;
  }

  return merged;
}

/**
 * Upsert global extractor learned_params from benchmark confirmations (not church-only).
 */
async function upsertGlobalLayoutLearningFromBenchmark(items) {
  const layoutGroups = new Map();

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
    if (layoutId.startsWith('candidate-')) continue;

    try {
      const globalId = await findExtractorByCatalogId(promisePool, null, stats.recordType, layoutId);
      const learnedPatch = {
        benchmark_last_run: new Date().toISOString(),
        benchmark_match_count: stats.matches,
        benchmark_mismatch_count: stats.mismatches,
        catalog_layout_id: layoutId,
        source: 'global_benchmark',
      };

      if (globalId) {
        const [rows] = await promisePool.query(
          'SELECT learned_params FROM ocr_extractors WHERE id = ? LIMIT 1',
          [globalId],
        );
        let learned = parseLearnedParams(rows[0]?.learned_params);
        await promisePool.query(
          'UPDATE ocr_extractors SET learned_params = ?, updated_at = NOW() WHERE id = ?',
          [JSON.stringify({ ...learned, ...learnedPatch }), globalId],
        );
      }

      await recordLayoutMatchStats({
        catalogLayoutId: layoutId,
        recordType: stats.recordType,
        churchId: null,
        layoutConfidence: HIGH_CONFIDENCE_LAYOUT,
        catalogMatchConfidence: HIGH_CONFIDENCE_CATALOG,
      });
    } catch (err) {
      console.warn(`[GlobalLayoutMatch] benchmark upsert failed for ${layoutId}: ${err.message}`);
    }
  }
}

module.exports = {
  HIGH_CONFIDENCE_LAYOUT,
  HIGH_CONFIDENCE_CATALOG,
  CANDIDATE_MATCH_THRESHOLD,
  ensureGlobalLayouts,
  ensureGlobalLayoutStatsTable,
  matchLayoutTemplates,
  recordLayoutMatchStats,
  persistHighConfidenceGlobalLayout,
  maybeCreateGlobalLayoutCandidate,
  afterLayoutIdentification,
  mergeLayoutClassificationJson,
  upsertGlobalLayoutLearningFromBenchmark,
};
