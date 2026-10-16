/**
 * Heuristic multi-row extract for open-book death / funeral registers.
 * One image can contain many numbered ledger rows (e.g. DEATHS 2010 = 4 people).
 */

const HEADER_SKIP = /^(full name|date of|cause of|name of|male|female|number|year|deaths|burial|age|priest|decedent)\b/i;
const MONTH_TOKEN = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)$/i;
const NUMBERED_LINE = /(?:^|\n)\s*(\d{1,3})(?:[\.)]|\s+)\s*(.+)/g;

const MONTH = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const MONTH_DAY = new RegExp(`\\b(?:${MONTH})\\s+\\d{1,2}\\b`, 'ig');

export function looksLikeTabularDeathRegister(text: string): boolean {
  const t = text || '';
  const hasDeaths = /\bdeaths\b/i.test(t) || /full\s+name\s+of\s+decedent/i.test(t);
  const hasCause = /cause\s+of\s+death/i.test(t);
  const numbered = (t.match(/^\s*\d{1,3}[\.)]?\s+[A-Z]/gm) || []).length;
  return (hasDeaths && (hasCause || numbered >= 2)) || numbered >= 3;
}

export function looksLikeMultiRowSacramentalLedger(
  text: string,
  layoutType?: 'tabular' | 'form' | 'narrative',
): boolean {
  if (looksLikeTabularDeathRegister(text)) return true;
  if (layoutType === 'tabular' && (text.match(/^\s*\d{1,3}[\.)]?\s+[A-Z]/gm) || []).length >= 2) {
    return true;
  }
  return false;
}

function splitPersonName(raw: string): { first: string; last: string; full: string } {
  const full = raw.replace(/\s+/g, ' ').trim();
  const cleaned = full.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const last = parts.pop() || '';
  return { first: parts.join(' '), last, full };
}

function nearbyDates(text: string, around: number): string[] {
  const window = text.slice(Math.max(0, around - 80), around + 160);
  return [...window.matchAll(MONTH_DAY)].map((m) => m[0]);
}

function nameFromRest(rest: string): string | null {
  const tokens = rest.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const nameTokens: string[] = [];
  for (const tok of tokens) {
    if (MONTH_TOKEN.test(tok)) break;
    if (/^\d/.test(tok) && nameTokens.length) break;
    if (/^[A-Z(]/.test(tok)) nameTokens.push(tok);
    else if (nameTokens.length) break;
  }
  if (nameTokens.length < 2) return null;
  const name = nameTokens.join(' ');
  if (HEADER_SKIP.test(name) || name.length > 80) return null;
  return name;
}

export function extractFuneralLedgerRecords(text: string): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  const seen = new Set<string>();
  const source = text || '';
  NUMBERED_LINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMBERED_LINE.exec(source))) {
    const name = nameFromRest(match[2] || '');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = splitPersonName(name);
    const dates = nearbyDates(source, match.index);
    const rec: Record<string, string> = {
      record_number: match[1],
      deceased_name: parts.full,
    };
    if (parts.first) rec.deceased_first_name = parts.first;
    if (parts.last) rec.deceased_last_name = parts.last;
    if (dates[0]) rec.date_of_death = dates[0];
    if (dates[1]) rec.date_of_burial = dates[1];
    records.push(rec);
  }
  return records;
}
