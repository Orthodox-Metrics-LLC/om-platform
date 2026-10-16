/**
 * Best-effort detection of non-sacramental / out-of-domain images
 * (e.g. medical order forms) mis-routed into portal OCR.
 *
 * Limitation: heuristic + classifier signals only — not a vision document
 * classifier. False negatives/positives are possible; operators can manually
 * flag via POST .../flag-not-church-record.
 */

const OUT_OF_DOMAIN_PATTERNS = [
  /\border\s*form\b/i,
  /\bpatient\b/i,
  /\bmedical\b/i,
  /\bhipaa\b/i,
  /\bprescription\b/i,
  /\blaboratory\b/i,
  /\binsurance\b/i,
  /\bclaim\s*form\b/i,
  /\binvoice\b/i,
  /\breceipt\b/i,
  /\bdiagnosis\b/i,
  /\bclinical\b/i,
  /\bpharmacy\b/i,
  /\bmedicare\b/i,
  /\bmedicaid\b/i,
  /\bnpi\b/i,
  /\bicd[-\s]?10\b/i,
  /\bcpt\b/i,
];

const SACRAMENTAL_PATTERNS = [
  /\bbaptis/i,
  /\bchrism/i,
  /\bgodparent/i,
  /\bsponsor/i,
  /\bmarriage\b/i,
  /\bwedding\b/i,
  /\bbride\b/i,
  /\bgroom\b/i,
  /\bfuneral\b/i,
  /\bburial\b/i,
  /\bdeceased\b/i,
  /\bpriest\b/i,
  /\brev\.?\b/i,
  /\bsacrament/i,
  /\bparish\b/i,
  /\bchurch\b/i,
  /\borthodox\b/i,
];

/**
 * @param {object} opts
 * @param {string} [opts.ocrText]
 * @param {string|null} [opts.classifierSuggestedType]
 * @param {number|null} [opts.classifierConfidence]
 * @param {string|null} [opts.recordTypeHint] — user-selected upload type
 * @returns {{ isNonChurchRecord: boolean, reasons: string[], confidence: number }}
 */
function detectNonChurchRecord({
  ocrText = '',
  classifierSuggestedType = null,
  classifierConfidence = null,
  recordTypeHint = null,
} = {}) {
  const text = String(ocrText || '');
  const reasons = [];
  let score = 0;

  const domainHits = OUT_OF_DOMAIN_PATTERNS.filter((re) => re.test(text));
  const sacramentalHits = SACRAMENTAL_PATTERNS.filter((re) => re.test(text));

  if (domainHits.length > 0) {
    score += Math.min(0.55, domainHits.length * 0.18);
    reasons.push(`out_of_domain_keywords:${domainHits.length}`);
  }

  if (sacramentalHits.length === 0 && text.trim().length > 40) {
    score += 0.15;
    reasons.push('no_sacramental_keywords');
  } else if (sacramentalHits.length > 0) {
    score -= Math.min(0.45, sacramentalHits.length * 0.12);
    reasons.push(`sacramental_keywords:${sacramentalHits.length}`);
  }

  const suggested = String(classifierSuggestedType || '').toLowerCase();
  const conf = Number(classifierConfidence);
  if (suggested === 'unknown' || suggested === '') {
    score += 0.2;
    reasons.push('classifier_unknown');
    if (!Number.isFinite(conf) || conf < 0.3) {
      score += 0.1;
      reasons.push('classifier_low_confidence');
    }
  } else if (['baptism', 'marriage', 'funeral'].includes(suggested)) {
    score -= 0.35;
    reasons.push(`classifier_${suggested}`);
  }

  // User forced a sacramental type but text looks medical → still flag when strong domain signal
  const hint = String(recordTypeHint || '').toLowerCase();
  if (
    ['baptism', 'marriage', 'funeral'].includes(hint) &&
    domainHits.length >= 2 &&
    sacramentalHits.length === 0
  ) {
    score += 0.25;
    reasons.push('hint_vs_domain_mismatch');
  }

  const confidence = Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
  // Require clear domain signal to avoid false positives on blank/noisy pages
  const isNonChurchRecord =
    confidence >= 0.55 && domainHits.length >= 1 && sacramentalHits.length === 0;

  return { isNonChurchRecord, reasons, confidence };
}

module.exports = {
  detectNonChurchRecord,
  OUT_OF_DOMAIN_PATTERNS,
  SACRAMENTAL_PATTERNS,
};
