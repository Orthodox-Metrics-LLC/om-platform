/**
 * Work Accountability — canonical time-range resolver.
 *
 * Single source of truth for turning the Command Center's global "Range" filter
 * (e.g. `6m`, `3m`, `30d`, `24h`, or a custom from/to) into explicit start/end
 * timestamps plus the chart bucket size that spans the *full* window.
 *
 * Consolidates the previous split logic (aggregator `parseWindow` +
 * reporting `resolveTrendGranularity`) so /overview, /timeline, /agents,
 * /exceptions, and /reports all derive identical windows from one range value.
 */

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Canonical + legacy range presets.
 *
 * - Rolling presets use `hours` and cover a rolling window ending "now".
 * - Multi-month presets use `months` and produce a *calendar-month-aligned*
 *   window: exactly N month buckets ending with the current month. This is
 *   what makes "Last 6 months" render EXACTLY 6 buckets (e.g. 2026-02 … 2026-07)
 *   instead of the 7–8 partial-month buckets a rolling 183-day span produced.
 *
 * `bucket` drives chart granularity so the whole window is covered without
 * silently collapsing to a shorter hardcoded slice.
 */
const RANGE_PRESETS = {
  '24h': { hours: 24, bucket: 'hour', label: 'Last 24 hours' },
  '7d': { hours: 168, bucket: 'day', label: 'Last 7 days' },
  '30d': { hours: 720, bucket: 'day', label: 'Last 30 days' },
  // Legacy report presets kept for API/back-compat (rolling, week-bucketed).
  '60d': { hours: 1440, bucket: 'week', label: 'Last 60 days' },
  '90d': { hours: 2160, bucket: 'week', label: 'Last 90 days' },
  // Canonical multi-month presets — calendar-month aligned, N month buckets.
  '3m': { months: 3, bucket: 'month', label: 'Last 3 months' },
  '6m': { months: 6, bucket: 'month', label: 'Last 6 months' },
  '12m': { months: 12, bucket: 'month', label: 'Last 12 months' },
  '1y': { months: 12, bucket: 'month', label: 'Last 12 months' },
};

/** Loose aliases → canonical keys (only where key identity does not matter). */
const RANGE_ALIASES = {
  '1m': '30d',
  '3mo': '3m',
  '6mo': '6m',
  '12mo': '12m',
};

const DEFAULT_RANGE = '30d';

function bucketForDays(days) {
  const span = Math.max(1, Number(days) || 1);
  if (span <= 2) return 'hour';
  if (span <= 31) return 'day';
  if (span <= 92) return 'week';
  return 'month';
}

function clampHours(hours) {
  return Math.min(Math.max(Number(hours) || 24, 1), 8760);
}

function buildRolling(preset, hours, bucket, label, now) {
  const start = new Date(now.getTime() - hours * HOUR_MS);
  return {
    preset,
    mode: 'rolling',
    from: start.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
    start,
    end: now,
    hours,
    days: Math.max(1, Math.round(hours / 24)),
    months: null,
    bucket,
    label,
    invalid: false,
  };
}

/**
 * Calendar-month-aligned window: exactly `months` month buckets ending with the
 * current month. `start` is the first day (00:00:00 UTC) of the month `months-1`
 * before `now`; `end` is `now`. Passing this start/end to generateBucketKeys
 * yields precisely `months` UTC-month keys — no partial leading/trailing month.
 */
function buildCalendarMonths(preset, months, label, now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1, 0, 0, 0, 0));
  const end = now;
  return {
    preset,
    mode: 'calendar',
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    start,
    end,
    hours: null,
    days: Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1),
    months,
    bucket: 'month',
    label,
    invalid: false,
  };
}

/**
 * @param {string|object} input - a range key string, or an options object
 *   `{ range, period, hours, from, to, now }`.
 * @returns {{preset,mode,from,to,start,end,hours,days,bucket,label,invalid}}
 */
function resolveWorkAccountabilityRange(input = {}) {
  const opts = typeof input === 'string' ? { range: input } : (input || {});
  const now = opts.now ? new Date(opts.now) : new Date();

  // Explicit custom window wins.
  if (opts.from && opts.to) {
    const start = new Date(`${opts.from}T00:00:00.000Z`);
    const end = new Date(`${opts.to}T23:59:59.999Z`);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
    return {
      preset: 'custom',
      mode: 'custom',
      from: opts.from,
      to: opts.to,
      start,
      end,
      hours: null,
      days,
      months: null,
      bucket: bucketForDays(days),
      label: `${opts.from} → ${opts.to}`,
      invalid: false,
    };
  }

  const requested = opts.range || opts.period;
  if (requested && String(requested).toLowerCase() !== 'custom') {
    const raw = String(requested).toLowerCase();
    const key = RANGE_ALIASES[raw] || raw;
    const preset = RANGE_PRESETS[key];
    if (preset) {
      return preset.months
        ? buildCalendarMonths(key, preset.months, preset.label, now)
        : buildRolling(key, preset.hours, preset.bucket, preset.label, now);
    }
    // Invalid range → graceful, explicitly-defined default (never a hidden window).
    const fallback = RANGE_PRESETS[DEFAULT_RANGE];
    return {
      ...buildRolling(DEFAULT_RANGE, fallback.hours, fallback.bucket, fallback.label, now),
      invalid: true,
      requested: raw,
    };
  }

  // Bare `hours` (legacy callers) — honor it as a rolling window.
  if (opts.hours) {
    const hours = clampHours(opts.hours);
    const days = Math.max(1, Math.round(hours / 24));
    return buildRolling(`rolling:${hours}h`, hours, bucketForDays(days), `Last ${hours}h`, now);
  }

  const fallback = RANGE_PRESETS[DEFAULT_RANGE];
  return buildRolling(DEFAULT_RANGE, fallback.hours, fallback.bucket, fallback.label, now);
}

module.exports = {
  RANGE_PRESETS,
  RANGE_ALIASES,
  DEFAULT_RANGE,
  bucketForDays,
  buildCalendarMonths,
  resolveWorkAccountabilityRange,
};
