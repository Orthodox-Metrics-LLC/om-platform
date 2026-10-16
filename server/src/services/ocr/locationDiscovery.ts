/**
 * Tenant location discovery + defaults for OCR parish configuration entities.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getTenantPool, getAppPool } = require('../../config/db');
import {
  type LocationAddressParts,
  type LocationMetadata,
  type LocationType,
  type LocationVariantCount,
  formatLocationDisplayAddress,
  locationNameCoreKey,
  locationNameMatches,
  locationTypeFromEntity,
  mergeLocationVariantCounts,
  normalizeLocationIdentityKey,
  parseLocationMetadata,
  parseLocationParts,
  parseLocationVariants,
} from './locationIdentity';

export interface LocationDiscoveryGroup {
  identity_key: string;
  name_core_key: string;
  suggested_canonical: string;
  suggested_type: LocationType;
  variants: LocationVariantCount[];
  total_records: number;
  source: 'funeral_records.burial_location';
  suggested_address?: LocationAddressParts;
}

export interface LocationResolveResult {
  status: 'matched' | 'ambiguous' | 'unmatched';
  raw: string;
  canonical?: string;
  entity_id?: number;
  location_type?: LocationType;
  candidates: Array<{
    entity_id: number;
    canonical_value: string;
    location_type: LocationType;
    match: 'exact' | 'identity' | 'variant';
  }>;
}

function isBlank(v: unknown): boolean {
  const s = String(v ?? '').trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  return lower === 'n/a' || lower === 'na' || lower === '-' || lower === 'none' || lower === 'unknown';
}

export async function scanFuneralBurialLocations(churchId: number): Promise<Array<{ original: string }>> {
  const pool = getTenantPool(churchId);
  const sql = `
    SELECT TRIM(burial_location) AS original
    FROM funeral_records
    WHERE church_id = ?
      AND burial_location IS NOT NULL
      AND TRIM(burial_location) != ''
      AND LOWER(TRIM(burial_location)) NOT IN ('n/a', 'na', '-', 'none', 'unknown')
  `;
  try {
    const [rows] = await pool.query(sql, [churchId]);
    return (rows as any[])
      .map((r) => ({ original: String(r.original || '').trim() }))
      .filter((r) => !isBlank(r.original));
  } catch {
    const [rows] = await pool.query(`
      SELECT TRIM(burial_location) AS original
      FROM funeral_records
      WHERE burial_location IS NOT NULL
        AND TRIM(burial_location) != ''
        AND LOWER(TRIM(burial_location)) NOT IN ('n/a', 'na', '-', 'none', 'unknown')
    `);
    return (rows as any[])
      .map((r) => ({ original: String(r.original || '').trim() }))
      .filter((r) => !isBlank(r.original));
  }
}

/**
 * Group burial locations. Primary key includes city/state when present.
 * Incomplete variants (name-only) merge into a city-qualified group only when
 * exactly one such city-qualified group shares the same name core — never
 * across multiple distinct cemeteries with similar names.
 */
export function groupBurialLocations(rows: Array<{ original: string }>): LocationDiscoveryGroup[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.original, (counts.get(row.original) || 0) + 1);
  }

  // First pass: group by full identity key
  const byKey = new Map<string, Array<{ original: string; total: number }>>();
  for (const [original, total] of counts.entries()) {
    const key = normalizeLocationIdentityKey(original) || original.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ original, total });
  }

  // Index groups by name core for incomplete merges
  const groupsByCore = new Map<string, string[]>(); // nameCore → identity keys
  for (const key of byKey.keys()) {
    const core = key.includes('|') ? key.split('|')[0] : key;
    if (!groupsByCore.has(core)) groupsByCore.set(core, []);
    groupsByCore.get(core)!.push(key);
  }

  // Merge name-only groups into the sole city-qualified sibling
  for (const [core, keys] of groupsByCore.entries()) {
    const qualified = keys.filter((k) => k.includes('|'));
    const incomplete = keys.filter((k) => !k.includes('|'));
    if (qualified.length === 1 && incomplete.length > 0) {
      const targetKey = qualified[0];
      for (const inc of incomplete) {
        const members = byKey.get(inc) || [];
        byKey.get(targetKey)!.push(...members);
        byKey.delete(inc);
      }
    }
    // If multiple qualified groups share a core (different cities), leave incomplete alone
    // or attach to none — do not merge across cities.
  }

  const groups: LocationDiscoveryGroup[] = [];
  for (const [identity_key, members] of byKey.entries()) {
    members.sort((a, b) => b.total - a.total || a.original.localeCompare(b.original));
    const suggested_canonical = members[0].original;
    const parts = parseLocationParts(suggested_canonical);
    let total_records = 0;
    const variants: LocationVariantCount[] = members.map((m) => {
      total_records += m.total;
      return { value: m.original, total: m.total };
    });

    groups.push({
      identity_key,
      name_core_key: locationNameCoreKey(suggested_canonical),
      suggested_canonical,
      suggested_type: /cemetery|cemetary|graveyard|memorial park/i.test(suggested_canonical)
        ? 'Cemetery'
        : 'Other',
      variants,
      total_records,
      source: 'funeral_records.burial_location',
      suggested_address: {
        city: parts.city,
        state_province: parts.state,
      },
    });
  }

  groups.sort((a, b) => b.total_records - a.total_records || a.suggested_canonical.localeCompare(b.suggested_canonical));
  return groups;
}

export async function discoverTenantLocations(churchId: number): Promise<LocationDiscoveryGroup[]> {
  const rows = await scanFuneralBurialLocations(churchId);
  return groupBurialLocations(rows);
}

export function variantsForLocationStorage(
  variants: LocationVariantCount[],
  canonical: string,
): LocationVariantCount[] {
  const canonLower = canonical.trim().toLowerCase();
  return variants.filter((v) => v.value.trim().toLowerCase() !== canonLower);
}

export function resolveLocationAgainstEntities(
  raw: string,
  entities: any[],
  opts?: { types?: LocationType[] },
): LocationResolveResult {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { status: 'unmatched', raw: trimmed, candidates: [] };

  const allowed = opts?.types;
  const locationEntities = entities.filter((e) => {
    if (e.entity_type && e.entity_type !== 'location') return false;
    if (!allowed) return true;
    return allowed.includes(locationTypeFromEntity(e));
  });

  const candidates: LocationResolveResult['candidates'] = [];
  const searchLower = trimmed.toLowerCase();

  for (const ent of locationEntities) {
    const canon = String(ent.canonical_value || '').trim();
    if (!canon) continue;
    let match: 'exact' | 'identity' | 'variant' | null = null;
    if (canon.toLowerCase() === searchLower) {
      match = 'exact';
    } else if (parseLocationVariants(ent.variants_json).some((v) => v.value.trim().toLowerCase() === searchLower)) {
      match = 'variant';
    } else if (locationNameMatches(trimmed, canon, ent.variants_json)) {
      match = 'identity';
    }
    if (match) {
      candidates.push({
        entity_id: Number(ent.id),
        canonical_value: canon,
        location_type: locationTypeFromEntity(ent),
        match,
      });
    }
  }

  const seen = new Set<number>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.entity_id)) return false;
    seen.add(c.entity_id);
    return true;
  });

  const rank = (m: string) => (m === 'exact' ? 3 : m === 'variant' ? 2 : 1);
  unique.sort((a, b) => rank(b.match) - rank(a.match) || a.canonical_value.localeCompare(b.canonical_value));

  if (unique.length === 0) return { status: 'unmatched', raw: trimmed, candidates: [] };
  if (unique.length === 1 || new Set(unique.map((c) => c.canonical_value.toLowerCase())).size === 1) {
    return {
      status: 'matched',
      raw: trimmed,
      canonical: unique[0].canonical_value,
      entity_id: unique[0].entity_id,
      location_type: unique[0].location_type,
      candidates: unique,
    };
  }
  return { status: 'ambiguous', raw: trimmed, candidates: unique };
}

async function loadChurchProfile(churchId: number): Promise<any | null> {
  const [rows] = await getAppPool().query(
    `SELECT id, name, church_name, address, city, state_province, postal_code, country, short_name, location, settings
     FROM churches WHERE id = ? LIMIT 1`,
    [churchId],
  );
  return rows[0] || null;
}

async function loadCemeteryProfile(churchId: number): Promise<{
  name: string;
  address: LocationAddressParts;
} | null> {
  // parish_settings system category
  try {
    const [rows] = await getAppPool().query(
      `SELECT setting_key, value FROM parish_settings
       WHERE church_id = ? AND category IN ('system', 'branding', 'ui')
         AND setting_key LIKE 'cemetery%'`,
      [churchId],
    );
    const map: Record<string, any> = {};
    for (const row of rows as any[]) {
      let val = row.value;
      if (typeof val === 'string') {
        try {
          val = JSON.parse(val);
        } catch {
          /* keep string */
        }
      }
      map[row.setting_key] = val;
    }
    const name = String(map.cemetery_name || map.cemeteryName || '').trim();
    if (name) {
      return {
        name,
        address: {
          street_address: map.cemetery_street_address || map.cemetery_address || map.cemeteryAddress || null,
          city: map.cemetery_city || null,
          state_province: map.cemetery_state || map.cemetery_state_province || null,
          postal_code: map.cemetery_postal_code || null,
          country: map.cemetery_country || null,
        },
      };
    }
  } catch {
    /* ignore */
  }

  // churches.settings.cemetery
  try {
    const church = await loadChurchProfile(churchId);
    let settings = church?.settings;
    if (typeof settings === 'string') {
      try {
        settings = JSON.parse(settings);
      } catch {
        settings = null;
      }
    }
    const cem = settings?.cemetery;
    if (cem && (cem.name || cem.cemetery_name)) {
      return {
        name: String(cem.name || cem.cemetery_name).trim(),
        address: {
          street_address: cem.street_address || cem.address || null,
          city: cem.city || null,
          state_province: cem.state_province || cem.state || null,
          postal_code: cem.postal_code || null,
          country: cem.country || null,
        },
      };
    }
  } catch {
    /* ignore */
  }

  return null;
}

async function upsertLocationEntity(
  churchId: number,
  payload: {
    canonical_value: string;
    display_label?: string | null;
    role: LocationType;
    metadata: LocationMetadata;
    source_label: string;
    source_notes: string;
    variants_json?: LocationVariantCount[] | null;
    created_by: string;
  },
): Promise<{ id: number; created: boolean }> {
  const [existing]: any = await getAppPool().query(
    `SELECT id, metadata_json FROM ocr_parish_configuration_entities
     WHERE church_id = ? AND entity_type = 'location' AND is_active = 1
       AND (
         JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.default_kind')) = ?
         OR (LOWER(TRIM(canonical_value)) = ? AND role = ?)
       )
     LIMIT 1`,
    [
      churchId,
      payload.metadata.default_kind || '',
      payload.canonical_value.toLowerCase(),
      payload.role,
    ],
  );

  const metaJson = JSON.stringify(payload.metadata);
  const variantsJson = payload.variants_json?.length
    ? JSON.stringify(payload.variants_json)
    : null;

  if (existing.length) {
    await getAppPool().query(
      `UPDATE ocr_parish_configuration_entities
       SET canonical_value = ?, display_label = ?, role = ?, metadata_json = ?,
           source_label = ?, source_notes = COALESCE(source_notes, ?),
           variants_json = COALESCE(?, variants_json)
       WHERE id = ? AND church_id = ?`,
      [
        payload.canonical_value,
        payload.display_label || payload.canonical_value,
        payload.role,
        metaJson,
        payload.source_label,
        payload.source_notes,
        variantsJson,
        existing[0].id,
        churchId,
      ],
    );
    return { id: existing[0].id, created: false };
  }

  const [result]: any = await getAppPool().query(
    `INSERT INTO ocr_parish_configuration_entities
     (church_id, entity_type, canonical_value, display_label, role, metadata_json, variants_json, source_label, source_notes, created_by)
     VALUES (?, 'location', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      churchId,
      payload.canonical_value,
      payload.display_label || payload.canonical_value,
      payload.role,
      metaJson,
      variantsJson,
      payload.source_label,
      payload.source_notes,
      payload.created_by,
    ],
  );
  return { id: result.insertId, created: true };
}

/**
 * Ensure tenant Church (and parish Cemetery when configured) default locations exist.
 */
export async function ensureTenantDefaultLocations(
  churchId: number,
  createdBy = 'system',
): Promise<{ church: any; cemetery: any | null }> {
  const church = await loadChurchProfile(churchId);
  if (!church) throw new Error('Church not found');

  const churchName = String(church.name || church.church_name || '').trim() || `Church #${churchId}`;
  const address: LocationAddressParts = {
    street_address: church.address || null,
    city: church.city || null,
    state_province: church.state_province || null,
    postal_code: church.postal_code || null,
    country: church.country || null,
  };
  const displayLabel =
    formatLocationDisplayAddress(address)
      ? `${churchName} — ${formatLocationDisplayAddress(address)}`
      : churchName;

  const churchResult = await upsertLocationEntity(churchId, {
    canonical_value: churchName,
    display_label: displayLabel,
    role: 'Church',
    metadata: {
      location_type: 'Church',
      tenant_default: true,
      default_kind: 'church',
      source: 'church_profile',
      ...address,
    },
    source_label: 'tenant_default',
    source_notes: `System default Church location from churches.id=${churchId}`,
    created_by: createdBy,
  });

  let cemeteryResult: any = null;
  const cemProfile = await loadCemeteryProfile(churchId);
  if (cemProfile) {
    const cemDisplay = formatLocationDisplayAddress(cemProfile.address)
      ? `${cemProfile.name} — ${formatLocationDisplayAddress(cemProfile.address)}`
      : cemProfile.name;
    cemeteryResult = await upsertLocationEntity(churchId, {
      canonical_value: cemProfile.name,
      display_label: cemDisplay,
      role: 'Cemetery',
      metadata: {
        location_type: 'Cemetery',
        tenant_default: true,
        default_kind: 'parish_cemetery',
        source: 'cemetery_profile',
        ...cemProfile.address,
      },
      source_label: 'tenant_default',
      source_notes: `System default parish Cemetery from tenant cemetery profile (church_id=${churchId})`,
      created_by: createdBy,
    });
  }

  return {
    church: { id: churchResult.id, created: churchResult.created, canonical_value: churchName },
    cemetery: cemeteryResult
      ? { id: cemeteryResult.id, created: cemeteryResult.created, canonical_value: cemProfile!.name }
      : null,
  };
}

export async function getDefaultChurchLocation(churchId: number): Promise<any | null> {
  await ensureTenantDefaultLocations(churchId);
  const [rows]: any = await getAppPool().query(
    `SELECT * FROM ocr_parish_configuration_entities
     WHERE church_id = ? AND entity_type = 'location' AND is_active = 1
       AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.default_kind')) = 'church'
     LIMIT 1`,
    [churchId],
  );
  return rows[0] || null;
}

export { mergeLocationVariantCounts, parseLocationVariants, parseLocationMetadata };
