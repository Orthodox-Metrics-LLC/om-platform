/**
 * Canonical parish-record date display: MM/DD/YYYY.
 * Storage remains DATE / YYYY-MM-DD. Never use new Date('YYYY-MM-DD') for date-only values.
 */

const EMPTY = '—';
const INVALID = 'Invalid date';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDateOnlyParts(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { invalid: true };
    return {
      y: value.getUTCFullYear(),
      m: value.getUTCMonth() + 1,
      d: value.getUTCDate(),
    };
  }
  const s = String(value).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (!isValidYmd(y, m, d)) return { invalid: true };
    return { y, m, d };
  }
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const m = Number(us[1]);
    const d = Number(us[2]);
    const y = Number(us[3]);
    if (!isValidYmd(y, m, d)) return { invalid: true };
    return { y, m, d };
  }
  return { invalid: true };
}

function isValidYmd(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Storage/API canonical YYYY-MM-DD (no timezone shift for date-only). */
function formatDateOnlyIso(value) {
  const parts = parseDateOnlyParts(value);
  if (!parts) return null;
  if (parts.invalid) return null;
  return `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}`;
}

/** Visible parish-record date MM/DD/YYYY. */
function formatParishDateDisplay(value, { emptyDisplay = EMPTY, invalidDisplay = INVALID } = {}) {
  const parts = parseDateOnlyParts(value);
  if (!parts) return emptyDisplay;
  if (parts.invalid) return invalidDisplay;
  return `${pad2(parts.m)}/${pad2(parts.d)}/${parts.y}`;
}

/** Activity / audit timestamps: MM/DD/YYYY HH:mm:ss UTC */
function formatParishDateTimeDisplay(value, { emptyDisplay = EMPTY, timeZoneLabel = 'UTC' } = {}) {
  if (value == null || value === '') return emptyDisplay;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return INVALID;
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return `${m}/${day}/${y} ${hh}:${mm}:${ss} ${timeZoneLabel}`;
}

module.exports = {
  formatDateOnlyIso,
  formatParishDateDisplay,
  formatParishDateTimeDisplay,
  parseDateOnlyParts,
  isValidYmd,
  EMPTY,
  INVALID,
};
