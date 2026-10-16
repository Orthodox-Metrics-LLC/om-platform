/**
 * Canonical plot identity for parish cemetery maps.
 * plot_key = section|side|row|position (grave number is display-only, not identity).
 */

/** @typedef {'1'|'2'|'3'|'NS'} CanonicalSectionCode */

/** Acceptance-criteria section totals (church 46, authoritative workbook 2026-07). */
const EXPECTED_SECTION_TOTALS = {
  '1': 92,
  '2': 199,
  '3': 86,
  NS: 92,
};

const EXPECTED_REGION_TOTALS = {
  'L01-L14': 86,
  'L15-L27': 96,
  'R02-R15': 103,
  'L28-L36-CIRCLE': 52,
  'R16-R22-CIRCLE': 34,
  'R01-R14': 6,
  'NEW-MN': 92,
};

const EXPECTED_STATUS_TOTALS = {
  occupied: 419,
  available: 26,
  unavailable: 24,
  reserved: 0,
};

const EXPECTED_PHYSICAL_TOTAL = 469;

/** Legacy seed section letters → canonical section codes. */
const LEGACY_SECTION_MAP = {
  W: '1',
  E: '2',
  S: '3',
  N: 'NS',
  L: '1',
  R: '2',
};

const CANONICAL_SECTION_NAMES = {
  '1': 'Section 1',
  '2': 'Section 2',
  '3': 'Section 3',
  NS: 'New Section',
};

/** Known multi-number composite patterns in seed (one physical grave). */
const COMPOSITE_ALIASES = new Map([
  ['102101', '102,101'],
  ['105104', '105,104'],
  ['895896', '895,896'],
  ['194195196', '194,195,196'],
]);

/**
 * @param {string} section
 * @param {string} side
 * @param {string|number} row
 * @param {string|number} position
 * @returns {string}
 */
function buildPlotKey(section, side, row, position) {
  const sec = String(section || '').trim().toUpperCase();
  const sd = String(side || '').trim().toUpperCase();
  const rw = String(row ?? '').trim();
  const pos = String(position ?? '').trim();
  if (!sec || !sd || !rw || !pos) {
    throw new Error(`plot_key requires section, side, row, position (got ${sec}|${sd}|${rw}|${pos})`);
  }
  return `${sec}|${sd}|${rw}|${pos}`;
}

/**
 * Parse plot label like "24M", "102", "102,101" into components when possible.
 * @param {string} raw
 * @returns {{ numbers: string[], sideSuffix: string|null }}
 */
function parsePlotLabel(raw) {
  const label = String(raw || '').trim();
  if (!label) return { numbers: [], sideSuffix: null };

  const sideMatch = label.match(/^(\d+(?:,\d+)*)([A-Za-z])$/);
  if (sideMatch) {
    return {
      numbers: sideMatch[1].split(',').map((n) => n.trim()).filter(Boolean),
      sideSuffix: sideMatch[2].toUpperCase(),
    };
  }

  if (label.includes(',')) {
    return {
      numbers: label.split(',').map((n) => n.trim()).filter(Boolean),
      sideSuffix: null,
    };
  }

  const digitsOnly = label.replace(/\D/g, '');
  if (digitsOnly.length >= 6 && digitsOnly.length % 3 === 0 && !label.includes(',')) {
    const chunks = digitsOnly.match(/.{1,3}/g) || [];
    if (chunks.length > 1) {
      return { numbers: chunks, sideSuffix: null };
    }
  }

  const alias = COMPOSITE_ALIASES.get(label.replace(/\D/g, ''));
  if (alias) {
    return { numbers: alias.split(','), sideSuffix: null };
  }

  const num = label.replace(/[^0-9]/g, '');
  return { numbers: num ? [num] : [], sideSuffix: null };
}

/**
 * Normalize display_numbers string (sorted unique, no malformed composites).
 * @param {string|string[]} input
 * @returns {string}
 */
function normalizeDisplayNumbers(input) {
  const parts = (Array.isArray(input) ? input : String(input || '').split(/[,/]/))
    .map((s) => s.trim())
    .filter(Boolean);

  const expanded = [];
  for (const p of parts) {
    const parsed = parsePlotLabel(p);
    if (parsed.numbers.length) expanded.push(...parsed.numbers);
    else if (p) expanded.push(p);
  }

  const unique = [...new Set(expanded)];
  unique.sort((a, b) => Number(a) - Number(b));
  return unique.join(',');
}

/**
 * Detect malformed composite (concatenated digits without separator).
 * @param {string} plotNumber
 * @returns {boolean}
 */
function isMalformedComposite(plotNumber) {
  const s = String(plotNumber || '').trim();
  if (!s || s.includes(',') || s.includes('/')) return false;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 6) return false;
  if (COMPOSITE_ALIASES.has(digits)) return true;
  return digits.length % 3 === 0 && digits.length >= 6;
}

/**
 * Map legacy section code to canonical.
 * @param {string} code
 * @returns {string}
 */
function toCanonicalSection(code) {
  const c = String(code || '').trim().toUpperCase();
  return LEGACY_SECTION_MAP[c] || c;
}

/**
 * Dedupe manifest rows: merge rows that represent the same physical grave.
 * Merges by plot_key AND by section+normalized display_numbers (composite graves).
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Array<Record<string, unknown>>}
 */
function dedupeManifestRows(rows) {
  const byKey = new Map();
  const byDisplay = new Map();

  function mergeInto(target, row) {
    const display = normalizeDisplayNumbers(row.display_numbers || row.plot_number || '');
    target.display_numbers = normalizeDisplayNumbers(
      [target.display_numbers, display].filter(Boolean).join(','),
    );
    target.plot_number = target.display_numbers;
    if (row.occupants?.length) {
      const names = new Set([...(target.occupants || []), ...row.occupants]);
      target.occupants = [...names];
    }
    if (row.status === 'unavailable') target.status = 'unavailable';
    else if (row.status === 'occupied' && target.status === 'available') {
      target.status = 'occupied';
    }
  }

  for (const row of rows) {
    const display = normalizeDisplayNumbers(row.display_numbers || row.plot_number || '');
    const section = String(row.section || '').toUpperCase();
    const displayKey = `${section}::${display}`;

    let key;
    try {
      key = row.plot_key || buildPlotKey(row.section, row.side, row.row, row.position);
    } catch {
      key = displayKey;
    }

    if (byDisplay.has(displayKey)) {
      const existing = byDisplay.get(displayKey);
      mergeInto(existing, { ...row, display_numbers: display });
      continue;
    }

    if (byKey.has(key)) {
      const existing = byKey.get(key);
      mergeInto(existing, { ...row, display_numbers: display });
      byDisplay.set(displayKey, existing);
      continue;
    }

    const entry = {
      ...row,
      plot_key: key,
      display_numbers: display,
      plot_number: display,
    };
    byKey.set(key, entry);
    byDisplay.set(displayKey, entry);
  }

  return [...new Set(byDisplay.values())];
}

module.exports = {
  EXPECTED_SECTION_TOTALS,
  EXPECTED_REGION_TOTALS,
  EXPECTED_STATUS_TOTALS,
  EXPECTED_PHYSICAL_TOTAL,
  LEGACY_SECTION_MAP,
  CANONICAL_SECTION_NAMES,
  buildPlotKey,
  parsePlotLabel,
  normalizeDisplayNumbers,
  isMalformedComposite,
  toCanonicalSection,
  dedupeManifestRows,
};
