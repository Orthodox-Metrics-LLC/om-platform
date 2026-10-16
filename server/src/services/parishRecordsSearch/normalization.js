/** Deterministic matching normalization. Stored values are never modified. */
const TITLE_RE = /^(?:rev(?:erend)?|fr|father|priest)\.?\s+/i;

function normalizeText(value, { clergy = false } = {}) {
  let text = String(value ?? '').normalize('NFKC');
  text = text.replace(/[\u2018\u2019\u02BC`]/g, "'").replace(/[\u2010-\u2015]/g, '-');
  if (clergy) text = text.replace(TITLE_RE, '');
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]+/gu, ' ')
    .replace(/[\s'-]+/g, ' ')
    .replace(/\b([a-z])\.(?=\s|$)/g, '$1')
    .trim();
}

function normalizeName(first, last) {
  return { first: normalizeText(first), last: normalizeText(last) };
}

function tokenKey(value) {
  return normalizeText(value).split(' ').filter(Boolean).sort().join(' ');
}

function levenshteinBounded(a, b, maxDistance = 2) {
  const left = normalizeText(a); const right = normalizeText(b);
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;
  let prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const next = [i]; let rowMin = i;
    for (let j = 1; j <= right.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, next[j]);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    prev = next;
  }
  return prev[right.length];
}

module.exports = { normalizeText, normalizeName, tokenKey, levenshteinBounded };
