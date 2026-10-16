/**
 * Tenant clergy discovery: scan sacrament tables, group by identity key,
 * suggest canonical names + tenure dates from observed record dates.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getTenantPool } = require('../../config/db');
import {
  type ClergyVariantCount,
  type SacramentSource,
  clergyNameMatchesEntity,
  clergyVariantValues,
  mergeVariantCounts,
  normalizeClergyIdentityKey,
  parseClergyVariants,
} from './clergyIdentity';
import { normalizeEntityDate } from './normalizeEntityDate';

export interface ClergyOccurrenceRow {
  original: string;
  source: SacramentSource;
  event_date: string | null;
}

export interface ClergyOriginalAgg {
  original: string;
  total: number;
  baptism: number;
  marriage: number;
  funeral: number;
  minDate: string | null;
  maxDate: string | null;
}

export interface ClergyDiscoveryGroup {
  identity_key: string;
  suggested_canonical: string;
  suggested_active_from: string | null;
  suggested_active_to: string | null;
  /** All observed originals with counts (canonical included for display; accept strips it from variants). */
  variants: ClergyVariantCount[];
  total_records: number;
}

export interface ClergyResolveResult {
  status: 'matched' | 'ambiguous' | 'unmatched';
  raw: string;
  canonical?: string;
  entity_id?: number;
  candidates: Array<{
    entity_id: number;
    canonical_value: string;
    match: 'exact' | 'identity' | 'variant';
  }>;
}

const SCAN_SOURCES: Array<{ source: SacramentSource; table: string; dateCol: string }> = [
  { source: 'baptism', table: 'baptism_records', dateCol: 'reception_date' },
  { source: 'marriage', table: 'marriage_records', dateCol: 'mdate' },
  { source: 'funeral', table: 'funeral_records', dateCol: 'deceased_date' },
];

function isBlankClergy(v: unknown): boolean {
  const s = String(v ?? '').trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  return lower === 'n/a' || lower === 'na' || lower === '-' || lower === 'none' || lower === 'unknown';
}

function minDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function toIsoDate(val: unknown): string | null {
  return normalizeEntityDate(val);
}

/**
 * Scan tenant DB for clergy strings + event dates across baptism/marriage/funeral.
 */
export async function scanTenantClergyOccurrences(churchId: number): Promise<ClergyOccurrenceRow[]> {
  const pool = getTenantPool(churchId);
  const unionParts: string[] = [];
  const params: any[] = [];

  for (const { source, table, dateCol } of SCAN_SOURCES) {
    unionParts.push(`
      SELECT TRIM(clergy) AS original, ? AS source, ${dateCol} AS event_date
      FROM ${table}
      WHERE church_id = ?
        AND clergy IS NOT NULL
        AND TRIM(clergy) != ''
        AND LOWER(TRIM(clergy)) NOT IN ('n/a', 'na', '-', 'none', 'unknown')
    `);
    params.push(source, churchId);
  }

  const sql = unionParts.join(' UNION ALL ');
  try {
    const [rows] = await pool.query(sql, params);
    return (rows as any[])
      .map((r) => ({
        original: String(r.original || '').trim(),
        source: r.source as SacramentSource,
        event_date: toIsoDate(r.event_date),
      }))
      .filter((r) => !isBlankClergy(r.original));
  } catch (err: any) {
    // Fallback without church_id filter (some older single-tenant schemas)
    const fallbackParts: string[] = [];
    const fallbackParams: any[] = [];
    for (const { source, table, dateCol } of SCAN_SOURCES) {
      fallbackParts.push(`
        SELECT TRIM(clergy) AS original, ? AS source, ${dateCol} AS event_date
        FROM ${table}
        WHERE clergy IS NOT NULL
          AND TRIM(clergy) != ''
          AND LOWER(TRIM(clergy)) NOT IN ('n/a', 'na', '-', 'none', 'unknown')
      `);
      fallbackParams.push(source);
    }
    try {
      const [rows] = await pool.query(fallbackParts.join(' UNION ALL '), fallbackParams);
      return (rows as any[])
        .map((r) => ({
          original: String(r.original || '').trim(),
          source: r.source as SacramentSource,
          event_date: toIsoDate(r.event_date),
        }))
        .filter((r) => !isBlankClergy(r.original));
    } catch (err2: any) {
      console.error('[clergyDiscovery] scan failed:', err2?.message || err2);
      throw err;
    }
  }
}

export function aggregateOriginals(rows: ClergyOccurrenceRow[]): Map<string, ClergyOriginalAgg> {
  const map = new Map<string, ClergyOriginalAgg>();
  for (const row of rows) {
    const key = row.original; // preserve exact original string as key for counting
    let agg = map.get(key);
    if (!agg) {
      agg = {
        original: row.original,
        total: 0,
        baptism: 0,
        marriage: 0,
        funeral: 0,
        minDate: null,
        maxDate: null,
      };
      map.set(key, agg);
    }
    agg.total += 1;
    agg[row.source] += 1;
    if (row.event_date) {
      agg.minDate = minDate(agg.minDate, row.event_date);
      agg.maxDate = maxDate(agg.maxDate, row.event_date);
    }
  }
  return map;
}

/**
 * Group aggregated originals by identity key.
 * Suggested canonical = most frequently occurring original string in the group.
 * Suggested Active From/To = min/max associated record dates (editable later; never auto-Current).
 */
export function groupClergyByIdentity(aggs: Map<string, ClergyOriginalAgg>): ClergyDiscoveryGroup[] {
  const byKey = new Map<string, ClergyOriginalAgg[]>();

  for (const agg of aggs.values()) {
    const key = normalizeClergyIdentityKey(agg.original) || agg.original.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(agg);
  }

  const groups: ClergyDiscoveryGroup[] = [];
  for (const [identity_key, members] of byKey.entries()) {
    members.sort((a, b) => b.total - a.total || a.original.localeCompare(b.original));
    const suggested_canonical = members[0].original;
    let suggested_active_from: string | null = null;
    let suggested_active_to: string | null = null;
    let total_records = 0;
    const variants: ClergyVariantCount[] = members.map((m) => {
      total_records += m.total;
      suggested_active_from = minDate(suggested_active_from, m.minDate);
      suggested_active_to = maxDate(suggested_active_to, m.maxDate);
      return {
        value: m.original,
        total: m.total,
        baptism: m.baptism,
        marriage: m.marriage,
        funeral: m.funeral,
      };
    });

    groups.push({
      identity_key,
      suggested_canonical,
      suggested_active_from,
      suggested_active_to,
      variants,
      total_records,
    });
  }

  groups.sort((a, b) => b.total_records - a.total_records || a.suggested_canonical.localeCompare(b.suggested_canonical));
  return groups;
}

export async function discoverTenantClergy(churchId: number): Promise<ClergyDiscoveryGroup[]> {
  const rows = await scanTenantClergyOccurrences(churchId);
  const aggs = aggregateOriginals(rows);
  return groupClergyByIdentity(aggs);
}

/** Variants list for storage: exclude the canonical string itself. */
export function variantsForStorage(
  variants: ClergyVariantCount[],
  canonical: string,
): ClergyVariantCount[] {
  const canonLower = canonical.trim().toLowerCase();
  return variants.filter((v) => v.value.trim().toLowerCase() !== canonLower);
}

/**
 * Resolve a raw clergy string against configured parish clergy entities.
 * Confident unique match → matched; multiple distinct entities → ambiguous; else unmatched.
 */
export function resolveClergyAgainstEntities(
  raw: string,
  entities: Array<{ id: number; canonical_value: string; variants_json?: unknown; entity_type?: string }>,
): ClergyResolveResult {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { status: 'unmatched', raw: trimmed, candidates: [] };
  }

  const clergyEntities = entities.filter((e) => !e.entity_type || e.entity_type === 'clergy');
  const candidates: ClergyResolveResult['candidates'] = [];
  const searchLower = trimmed.toLowerCase();
  const searchKey = normalizeClergyIdentityKey(trimmed);

  for (const ent of clergyEntities) {
    const canon = String(ent.canonical_value || '').trim();
    if (!canon) continue;

    let match: 'exact' | 'identity' | 'variant' | null = null;
    if (canon.toLowerCase() === searchLower) {
      match = 'exact';
    } else if (clergyVariantValues(ent.variants_json).some((v) => v.trim().toLowerCase() === searchLower)) {
      match = 'variant';
    } else if (searchKey && clergyNameMatchesEntity(trimmed, canon, ent.variants_json)) {
      match = 'identity';
    }

    if (match) {
      candidates.push({
        entity_id: Number(ent.id),
        canonical_value: canon,
        match,
      });
    }
  }

  // Dedupe by entity_id
  const seen = new Set<number>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.entity_id)) return false;
    seen.add(c.entity_id);
    return true;
  });

  // Prefer exact > variant > identity when ranking a single best
  const rank = (m: string) => (m === 'exact' ? 3 : m === 'variant' ? 2 : 1);
  unique.sort((a, b) => rank(b.match) - rank(a.match) || a.canonical_value.localeCompare(b.canonical_value));

  if (unique.length === 0) {
    return { status: 'unmatched', raw: trimmed, candidates: [] };
  }
  if (unique.length === 1) {
    return {
      status: 'matched',
      raw: trimmed,
      canonical: unique[0].canonical_value,
      entity_id: unique[0].entity_id,
      candidates: unique,
    };
  }
  // Multiple entities — ambiguous unless all share the same canonical string
  const canonSet = new Set(unique.map((c) => c.canonical_value.toLowerCase()));
  if (canonSet.size === 1) {
    return {
      status: 'matched',
      raw: trimmed,
      canonical: unique[0].canonical_value,
      entity_id: unique[0].entity_id,
      candidates: unique,
    };
  }
  return { status: 'ambiguous', raw: trimmed, candidates: unique };
}

export { mergeVariantCounts, parseClergyVariants };
