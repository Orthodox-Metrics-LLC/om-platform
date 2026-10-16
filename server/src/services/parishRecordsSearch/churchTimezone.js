/**
 * Resolve church timezone and absolute UTC window for relative activity filters.
 * Relative windows stay relative in saved AST; absolute bounds are computed at execute time.
 */

const { getAppPool } = require('../../config/db-compat');

const DEFAULT_TZ = 'America/New_York';

async function getChurchTimezone(churchId) {
  try {
    const [rows] = await getAppPool().query(
      'SELECT timezone FROM orthodoxmetrics_db.churches WHERE id = ? LIMIT 1',
      [churchId],
    );
    const tz = rows[0]?.timezone;
    if (tz && typeof tz === 'string' && tz.trim()) return tz.trim();
  } catch (_) {
    /* fall through */
  }
  return DEFAULT_TZ;
}

function partsInTimeZone(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Approximate UTC instant for a wall-clock time in a named IANA zone. */
function zonedWallTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const p = partsInTimeZone(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    guess += desired - asUtc;
  }
  return new Date(guess);
}

function resolveRelativeWindow(relativeWindow, timeZone, now = new Date()) {
  const amount = Number(relativeWindow?.amount || 24);
  const unit = String(relativeWindow?.unit || 'hours').toLowerCase();
  const preset = relativeWindow?.preset ? String(relativeWindow.preset).toLowerCase() : null;

  if (preset === 'today' || unit === 'today') {
    const p = partsInTimeZone(now, timeZone);
    const start = zonedWallTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0 }, timeZone);
    const end = zonedWallTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 23, minute: 59, second: 59 }, timeZone);
    return { startUtc: start, endUtc: end, label: 'Today', timeZone };
  }
  if (preset === 'since_yesterday' || unit === 'since_yesterday') {
    const p = partsInTimeZone(now, timeZone);
    const startLocal = new Date(Date.UTC(p.year, p.month - 1, p.day));
    startLocal.setUTCDate(startLocal.getUTCDate() - 1);
    const start = zonedWallTimeToUtc({
      year: startLocal.getUTCFullYear(),
      month: startLocal.getUTCMonth() + 1,
      day: startLocal.getUTCDate(),
      hour: 0, minute: 0, second: 0,
    }, timeZone);
    return { startUtc: start, endUtc: now, label: 'Since yesterday', timeZone };
  }

  let ms = amount * 60 * 60 * 1000;
  if (unit === 'days' || unit === 'day') ms = amount * 24 * 60 * 60 * 1000;
  if (unit === 'weeks' || unit === 'week') ms = amount * 7 * 24 * 60 * 60 * 1000;
  if (unit === 'months' || unit === 'month') ms = amount * 30 * 24 * 60 * 60 * 1000;
  if (unit === 'years' || unit === 'year') ms = amount * 365 * 24 * 60 * 60 * 1000;
  if (unit === 'minutes' || unit === 'minute') ms = amount * 60 * 1000;
  const startUtc = new Date(now.getTime() - ms);
  return {
    startUtc,
    endUtc: now,
    label: `Past ${amount} ${unit}`,
    timeZone,
  };
}

module.exports = {
  DEFAULT_TZ,
  getChurchTimezone,
  resolveRelativeWindow,
  partsInTimeZone,
  zonedWallTimeToUtc,
};
