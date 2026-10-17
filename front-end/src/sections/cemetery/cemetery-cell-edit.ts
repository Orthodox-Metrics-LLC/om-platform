import type { CemeteryField, PartialDateValue } from './cemetery-records-api';

// ----------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const EDITABLE_TYPES = ['string', 'integer', 'number', 'boolean', 'date', 'partial_date', 'json'] as const;

type EditableType = (typeof EDITABLE_TYPES)[number];

function isEditableType(type: string): type is EditableType {
  return (EDITABLE_TYPES as readonly string[]).includes(type);
}

function monthNumber(token: string): number | null {
  const numeric = Number(token);
  if (/^\d{1,2}$/.test(token) && Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) return numeric;
  const name = token.toLowerCase();
  const exact = MONTHS.findIndex((month) => month.toLowerCase() === name);
  if (exact >= 0) return exact + 1;
  if (name.length < 3) return null;
  const matches = MONTHS.filter((month) => month.toLowerCase().startsWith(name));
  return matches.length === 1 ? MONTHS.indexOf(matches[0]) + 1 : null;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function partialDate(year: number, month: number | null, day: number | null): PartialDateValue {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error('Use a year from 1 to 9999.');
  if (month != null && (!Number.isInteger(month) || month < 1 || month > 12)) throw new Error('Use a month from 1 to 12.');
  if (day != null) {
    if (month == null) throw new Error('A day needs a month.');
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) throw new Error('That day is not in the month.');
    return { year, month, day, precision: 'day' };
  }
  if (month != null) return { year, month, day: null, precision: 'month' };
  return { year, month: null, day: null, precision: 'year' };
}

export function parsePartialDate(label: string, text: string): PartialDateValue {
  const value = text.trim();
  const reject = (message: string): never => {
    throw new Error(`${label}: ${message}`);
  };
  try {
    const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (isoDay) return partialDate(Number(isoDay[1]), Number(isoDay[2]), Number(isoDay[3]));
    const isoMonth = /^(\d{4})-(\d{2})$/.exec(value);
    if (isoMonth) return partialDate(Number(isoMonth[1]), Number(isoMonth[2]), null);
    const numericDay = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
    if (numericDay) return partialDate(Number(numericDay[3]), Number(numericDay[1]), Number(numericDay[2]));
    const numericMonth = /^(\d{1,2})\/(\d{4})$/.exec(value);
    if (numericMonth) return partialDate(Number(numericMonth[2]), Number(numericMonth[1]), null);
    const namedDay = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(value);
    if (namedDay) {
      const month = monthNumber(namedDay[1]);
      if (!month) throw new Error('use a month name, such as January 5, 1990.');
      return partialDate(Number(namedDay[3]), month, Number(namedDay[2]));
    }
    const namedMonth = /^([A-Za-z]+)\s+(\d{4})$/.exec(value);
    if (namedMonth) {
      const month = monthNumber(namedMonth[1]);
      if (!month) throw new Error('use a month name, such as January 1990.');
      return partialDate(Number(namedMonth[2]), month, null);
    }
    if (/^\d{1,4}$/.test(value)) return partialDate(Number(value), null, null);
    throw new Error('enter a year, a month and year, or a full date.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'enter a year, a month and year, or a full date.';
    return reject(message.replace(new RegExp(`^${label}:\\s*`), ''));
  }
}

export function editString(field: CemeteryField, value: unknown): string {
  if (value == null || value === '') return '';
  if (field.type === 'partial_date') {
    const date = value as PartialDateValue;
    if (!date?.year) return '';
    const month = date.month ? MONTHS[date.month - 1] : '';
    if (date.day && date.month) return `${month} ${date.day}, ${date.year}`;
    if (date.month) return `${month} ${date.year}`;
    return String(date.year);
  }
  if (field.type === 'boolean') return value ? 'true' : 'false';
  if (field.type === 'json') return typeof value === 'string' ? value : JSON.stringify(value);
  return String(value);
}

export function parseFieldInput(field: CemeteryField, raw: string): unknown {
  const text = raw.trim();
  if (!text) {
    if (!field.nullable) throw new Error(`${field.label} is required.`);
    return null;
  }
  const type: EditableType = isEditableType(field.type) ? field.type : 'string';
  switch (type) {
    case 'string':
      return text;
    case 'integer': {
      if (!/^-?\d+$/.test(text)) throw new Error(`${field.label} must be a whole number.`);
      const parsed = Number(text);
      if (!Number.isSafeInteger(parsed)) throw new Error(`${field.label} is too large.`);
      return parsed;
    }
    case 'number': {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) throw new Error(`${field.label} must be a number.`);
      return parsed;
    }
    case 'boolean': {
      const normalized = text.toLowerCase();
      if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
      if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
      throw new Error(`${field.label} must be true or false.`);
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text < '1000-01-01') {
        throw new Error(`${field.label} must be a date like 1990-01-05.`);
      }
      const [year, month, day] = text.split('-').map(Number);
      if (day < 1 || day > daysInMonth(year, month)) throw new Error(`${field.label} is not a real date.`);
      return text;
    }
    case 'partial_date':
      return parsePartialDate(field.label, text);
    case 'json':
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`${field.label} must be valid JSON.`);
      }
    default: {
      const unexpected: never = type;
      throw new Error(`Unsupported field type ${unexpected}`);
    }
  }
}

export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left == null || right == null || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}
