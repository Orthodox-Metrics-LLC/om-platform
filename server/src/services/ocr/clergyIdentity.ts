/**
 * Clergy identity normalization for tenant discovery and OCR/manual resolve.
 *
 * Groups probable spelling/OCR variants of the same person by a stable identity key
 * that ignores punctuation, whitespace, capitalization, and common title variants.
 */

export type SacramentSource = 'baptism' | 'marriage' | 'funeral';

export interface ClergyVariantCount {
  value: string;
  total: number;
  baptism?: number;
  marriage?: number;
  funeral?: number;
}

/** Title tokens collapsed to a canonical short form before identity hashing. */
const TITLE_CANON: Record<string, string> = {
  fr: 'fr',
  father: 'fr',
  rev: 'rev',
  reverend: 'rev',
  'v': 'v', // handled with following rev
  very: 'very',
  'vrev': 'vrev',
  'vreverend': 'vrev',
  'veryrev': 'vrev',
  'veryreverend': 'vrev',
  archpriest: 'archpriest',
  archimandrite: 'archimandrite',
  priest: 'priest',
  deacon: 'deacon',
  proto: 'proto',
  protodeacon: 'protodeacon',
  hieromonk: 'hieromonk',
  bishop: 'bishop',
  metropolitan: 'metropolitan',
};

const TITLE_PREFIXES = new Set(Object.keys(TITLE_CANON));

/**
 * Collapse punctuation/whitespace and lowercase for comparison.
 * Keeps alphanumeric tokens only (hyphens inside words become spaces).
 */
export function normalizeClergyText(raw: string): string {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip leading ecclesiastical titles and return remaining name tokens + optional title token.
 * "V. Rev. James Parsells" → { title: 'vrev', nameTokens: ['james', 'parsells'] }
 * "Fr James" → { title: 'fr', nameTokens: ['james'] }
 */
export function stripClergyTitles(normalized: string): { title: string | null; nameTokens: string[] } {
  const tokens = normalized.split(' ').filter(Boolean);
  let i = 0;
  let titleParts: string[] = [];

  while (i < tokens.length) {
    const t = tokens[i];
    // Combine "v" + "rev" / "very" + "rev" / "very" + "reverend"
    if ((t === 'v' || t === 'very') && i + 1 < tokens.length) {
      const next = tokens[i + 1];
      if (next === 'rev' || next === 'reverend') {
        titleParts = ['vrev'];
        i += 2;
        continue;
      }
    }
    if (TITLE_PREFIXES.has(t)) {
      titleParts.push(TITLE_CANON[t] || t);
      i += 1;
      continue;
    }
    break;
  }

  const nameTokens = tokens.slice(i);
  const title = titleParts.length ? titleParts[titleParts.length - 1] : null;
  return { title, nameTokens };
}

/**
 * Stable identity key for grouping/matching — title-insensitive; uses sorted name tokens
 * so "James Parsells" and "Parsells James" still collide only when tokens match as a set.
 * Prefer last-token-heavy identity: join name tokens in order (preserving word order).
 */
export function normalizeClergyIdentityKey(raw: string): string {
  const normalized = normalizeClergyText(raw);
  if (!normalized) return '';
  const { nameTokens } = stripClergyTitles(normalized);
  if (nameTokens.length === 0) return normalized;
  // Identity ignores title; keep name token order for "Fr James" vs "James"
  return nameTokens.join(' ');
}

/**
 * Parse variants_json supporting legacy string[] and rich ClergyVariantCount[].
 */
export function parseClergyVariants(variantsJson: unknown): ClergyVariantCount[] {
  let raw: unknown = variantsJson;
  if (raw == null || raw === '') return [];
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      // comma-separated fallback
      return String(raw)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .map((value) => ({ value, total: 0 }));
    }
  }
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item): ClergyVariantCount | null => {
      if (item == null) return null;
      if (typeof item === 'string') {
        const value = item.trim();
        return value ? { value, total: 0 } : null;
      }
      if (typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const value = String(o.value ?? o.variant ?? o.name ?? '').trim();
        if (!value) return null;
        return {
          value,
          total: Number(o.total) || 0,
          baptism: o.baptism != null ? Number(o.baptism) || 0 : undefined,
          marriage: o.marriage != null ? Number(o.marriage) || 0 : undefined,
          funeral: o.funeral != null ? Number(o.funeral) || 0 : undefined,
        };
      }
      return null;
    })
    .filter((v): v is ClergyVariantCount => v != null);
}

/** Flat list of variant spelling strings for matching. */
export function clergyVariantValues(variantsJson: unknown): string[] {
  return parseClergyVariants(variantsJson).map((v) => v.value);
}

/**
 * True if `raw` matches an entity's canonical name or any variant
 * (exact lowercase OR identity-key match).
 */
export function clergyNameMatchesEntity(raw: string, canonical: string, variantsJson: unknown): boolean {
  const search = String(raw || '').trim();
  if (!search) return false;
  const searchLower = search.toLowerCase();
  const searchKey = normalizeClergyIdentityKey(search);

  if (String(canonical || '').trim().toLowerCase() === searchLower) return true;
  if (searchKey && normalizeClergyIdentityKey(canonical) === searchKey) return true;

  for (const v of clergyVariantValues(variantsJson)) {
    if (v.trim().toLowerCase() === searchLower) return true;
    if (searchKey && normalizeClergyIdentityKey(v) === searchKey) return true;
  }
  return false;
}

/**
 * Merge two variant lists by value (case-insensitive), summing counts.
 */
export function mergeVariantCounts(a: ClergyVariantCount[], b: ClergyVariantCount[]): ClergyVariantCount[] {
  const map = new Map<string, ClergyVariantCount>();
  for (const list of [a, b]) {
    for (const v of list) {
      const key = v.value.trim().toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          value: v.value,
          total: v.total || 0,
          baptism: v.baptism || 0,
          marriage: v.marriage || 0,
          funeral: v.funeral || 0,
        });
      } else {
        existing.total += v.total || 0;
        existing.baptism = (existing.baptism || 0) + (v.baptism || 0);
        existing.marriage = (existing.marriage || 0) + (v.marriage || 0);
        existing.funeral = (existing.funeral || 0) + (v.funeral || 0);
      }
    }
  }
  return Array.from(map.values()).sort((x, y) => y.total - x.total || x.value.localeCompare(y.value));
}

/**
 * Alias review UI keys onto `clergy` for rules evaluation.
 * Mutates a shallow copy — does not mutate the input object.
 */
export function aliasClergyFieldsForRules(fields: Record<string, any>): Record<string, any> {
  const out = { ...fields };
  const clergy =
    out.clergy ||
    out.performed_by ||
    out.officiant ||
    out.priest ||
    out.celebrant ||
    null;
  if (clergy != null && String(clergy).trim() !== '') {
    out.clergy = clergy;
  }
  return out;
}

/** Officiant field keys used in OCR review UI. */
export const CLERGY_UI_FIELD_KEYS = ['clergy', 'performed_by', 'officiant', 'priest', 'celebrant'] as const;

export function isClergyUiField(name: string): boolean {
  return (CLERGY_UI_FIELD_KEYS as readonly string[]).includes(name);
}
