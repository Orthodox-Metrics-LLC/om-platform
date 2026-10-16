/**
 * Location identity normalization for tenant discovery and OCR/manual resolve.
 *
 * Groups probable spelling/OCR variants of the same place carefully:
 * different cemeteries must not merge merely because names look similar.
 */

export type LocationType = 'Church' | 'Cemetery' | 'Other';

export interface LocationAddressParts {
  street_address?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export interface LocationVariantCount {
  value: string;
  total: number;
}

export interface LocationMetadata extends LocationAddressParts {
  location_type?: LocationType;
  tenant_default?: boolean;
  default_kind?: 'church' | 'parish_cemetery' | null;
  source?: string;
  usage_count?: number;
  /** Entity id mirrored for clients when resolving */
  location_id?: number;
}

/** Common abbreviation expansions for location matching. */
const ABBREV: Array<[RegExp, string]> = [
  [/\bst\b\.?/gi, 'saint'],
  [/\bss\b\.?/gi, 'saints'],
  [/\bsts\b\.?/gi, 'saints'],
  [/\bn\.?\s*j\.?\b/gi, 'nj'],
  [/\bn\.?\s*y\.?\b/gi, 'ny'],
  [/\bp\.?\s*a\.?\b/gi, 'pa'],
  [/\bct\b\.?/gi, 'connecticut'],
  [/\brd\b\.?/gi, 'road'],
  [/\bdr\b\.?/gi, 'drive'],
  [/\bave\b\.?/gi, 'avenue'],
  [/\bblvd\b\.?/gi, 'boulevard'],
  [/\bcem\.?\b/gi, 'cemetery'],
  [/\bcemetary\b/gi, 'cemetery'], // common OCR misspelling
  [/\bcemetry\b/gi, 'cemetery'],
  [/\b&amp;\b/gi, 'and'],
  [/&/g, 'and'],
];

export function normalizeLocationText(raw: string): string {
  let s = String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  for (const [re, rep] of ABBREV) {
    s = s.replace(re, rep);
  }
  s = s
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

/**
 * Split a burial location string into name core + optional city/state.
 * "Ss. Peter & Paul Cemetery, Hillsborough, NJ" →
 *   { nameCore: 'saints peter and paul cemetery', city: 'hillsborough', state: 'nj' }
 */
export function parseLocationParts(raw: string): {
  nameCore: string;
  city: string | null;
  state: string | null;
  normalized: string;
} {
  const normalized = normalizeLocationText(raw);
  if (!normalized) {
    return { nameCore: '', city: null, state: null, normalized: '' };
  }

  // Try "name, city, state" or "name city state"
  const commaParts = String(raw || '')
    .split(',')
    .map((p) => normalizeLocationText(p))
    .filter(Boolean);

  if (commaParts.length >= 3) {
    const state = commaParts[commaParts.length - 1];
    const city = commaParts[commaParts.length - 2];
    const nameCore = commaParts.slice(0, -2).join(' ');
    return { nameCore, city, state, normalized };
  }
  if (commaParts.length === 2) {
    // "Name, City ST" or "Name City, ST" or "Name, State"
    const left = commaParts[0];
    const right = commaParts[1];
    const rightTokens = right.split(' ').filter(Boolean);
    const leftTokens = left.split(' ').filter(Boolean);
    const stateLike = /^(nj|ny|pa|ct|ma|md|va|fl|ca|oh|il|tx|mi|de|nc|sc|ga|al|tn|ky|wv|vt|nh|me|ri|dc)$/;

    if (rightTokens.length === 1 && stateLike.test(rightTokens[0]) && leftTokens.length >= 2) {
      // "Name City, ST"
      const state = rightTokens[0];
      const city = leftTokens[leftTokens.length - 1];
      const nameCore = leftTokens.slice(0, -1).join(' ');
      return { nameCore, city, state, normalized };
    }
    if (rightTokens.length >= 2) {
      const state = rightTokens[rightTokens.length - 1];
      const city = rightTokens.slice(0, -1).join(' ');
      return { nameCore: left, city, state, normalized };
    }
    // Could be city-only or state-only — treat as city
    return { nameCore: left, city: right, state: null, normalized };
  }

  // No commas — last 1–2 tokens might be state/city if name ends with cemetery
  const tokens = normalized.split(' ');
  const stateLike = /^(nj|ny|pa|ct|ma|md|va|fl|ca|oh|il|tx|mi)$/;
  if (tokens.length >= 3 && stateLike.test(tokens[tokens.length - 1])) {
    const state = tokens[tokens.length - 1];
    const city = tokens[tokens.length - 2];
    const nameCore = tokens.slice(0, -2).join(' ');
    return { nameCore, city, state, normalized };
  }

  return { nameCore: normalized, city: null, state: null, normalized };
}

/**
 * Stable identity key. Includes city/state when present so different cities
 * with similar cemetery names do not collide.
 * When city/state absent, key is name-core only (may later merge with a
 * city-qualified sibling that shares the exact same nameCore).
 */
export function normalizeLocationIdentityKey(raw: string): string {
  const { nameCore, city, state } = parseLocationParts(raw);
  if (!nameCore) return '';
  const loc = [city, state].filter(Boolean).join(' ');
  return loc ? `${nameCore}|${loc}` : nameCore;
}

/** Name-core only key for optional secondary merge of incomplete variants. */
export function locationNameCoreKey(raw: string): string {
  return parseLocationParts(raw).nameCore;
}

export function parseLocationVariants(variantsJson: unknown): LocationVariantCount[] {
  let raw: unknown = variantsJson;
  if (raw == null || raw === '') return [];
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return String(raw)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .map((value) => ({ value, total: 0 }));
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): LocationVariantCount | null => {
      if (typeof item === 'string') {
        const value = item.trim();
        return value ? { value, total: 0 } : null;
      }
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const value = String(o.value ?? o.variant ?? '').trim();
        if (!value) return null;
        return { value, total: Number(o.total) || 0 };
      }
      return null;
    })
    .filter((v): v is LocationVariantCount => v != null);
}

export function locationVariantValues(variantsJson: unknown): string[] {
  return parseLocationVariants(variantsJson).map((v) => v.value);
}

export function parseLocationMetadata(metadataJson: unknown): LocationMetadata {
  if (metadataJson == null || metadataJson === '') return {};
  let raw: unknown = metadataJson;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!raw || typeof raw !== 'object') return {};
  return raw as LocationMetadata;
}

export function locationTypeFromEntity(entity: {
  role?: string | null;
  metadata_json?: unknown;
}): LocationType {
  const meta = parseLocationMetadata(entity.metadata_json);
  const fromMeta = meta.location_type;
  if (fromMeta === 'Church' || fromMeta === 'Cemetery' || fromMeta === 'Other') return fromMeta;
  const role = String(entity.role || '').trim();
  if (role === 'Church' || role === 'Cemetery' || role === 'Other') return role;
  return 'Other';
}

export function isTenantDefaultLocation(entity: {
  source_label?: string | null;
  metadata_json?: unknown;
}): boolean {
  const meta = parseLocationMetadata(entity.metadata_json);
  if (meta.tenant_default) return true;
  const label = String(entity.source_label || '').toLowerCase();
  return label === 'tenant_default' || label === 'system';
}

/**
 * Match raw against canonical + variants using identity keys.
 * Strict: name cores must match exactly after normalization.
 * If both sides have city/state, those must match too.
 * If one side lacks city/state, name-core match alone is enough.
 */
export function locationNameMatches(
  raw: string,
  canonical: string,
  variantsJson: unknown,
): boolean {
  const search = String(raw || '').trim();
  if (!search) return false;
  const candidates = [canonical, ...locationVariantValues(variantsJson)].filter(Boolean);
  const searchParts = parseLocationParts(search);
  if (!searchParts.nameCore) return false;

  for (const c of candidates) {
    if (c.trim().toLowerCase() === search.toLowerCase()) return true;
    const cand = parseLocationParts(c);
    if (!cand.nameCore || cand.nameCore !== searchParts.nameCore) continue;
    // Same name core
    if (!searchParts.city && !searchParts.state) return true;
    if (!cand.city && !cand.state) return true;
    if (searchParts.city && cand.city && searchParts.city !== cand.city) continue;
    if (searchParts.state && cand.state && searchParts.state !== cand.state) continue;
    return true;
  }
  return false;
}

export function mergeLocationVariantCounts(
  a: LocationVariantCount[],
  b: LocationVariantCount[],
): LocationVariantCount[] {
  const map = new Map<string, LocationVariantCount>();
  for (const list of [a, b]) {
    for (const v of list) {
      const key = v.value.trim().toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { value: v.value, total: v.total || 0 });
      } else {
        existing.total += v.total || 0;
      }
    }
  }
  return Array.from(map.values()).sort((x, y) => y.total - x.total || x.value.localeCompare(y.value));
}

export function formatLocationDisplayAddress(parts: LocationAddressParts): string {
  const street = (parts.street_address || '').trim();
  const cityState = [parts.city, parts.state_province].filter(Boolean).join(', ');
  const line = [street, cityState].filter(Boolean).join(', ');
  if (parts.postal_code) return `${line} ${parts.postal_code}`.trim();
  return line;
}

/**
 * Alias OCR review keys so burial location rules see a single working field.
 * place_of_burial (review UI) ↔ burial_location (DB).
 */
export function aliasLocationFieldsForRules(fields: Record<string, any>): Record<string, any> {
  const out = { ...fields };
  const burial =
    String(out.place_of_burial ?? '').trim() ||
    String(out.burial_location ?? '').trim() ||
    '';
  if (burial) {
    if (!String(out.place_of_burial ?? '').trim()) out.place_of_burial = burial;
    if (!String(out.burial_location ?? '').trim()) out.burial_location = burial;
  }
  return out;
}

