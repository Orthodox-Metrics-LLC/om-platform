import { formatDbDate } from '../../../routes/ocr/helpers';
import { resolvePrimaryEventDate } from './dateResolvers';
import {
  clergyNameMatchesEntity,
  clergyVariantValues,
} from '../clergyIdentity';
import {
  locationTypeFromEntity,
} from '../locationIdentity';
import { resolveLocationAgainstEntities } from '../locationDiscovery';

export interface ResolverContext {
  churchId: number;
  recordType: string;
  fields: Record<string, any>;
  entities: any[];
}

/**
 * Parses the parents string to extract the father's surname.
 * Handles both:
 * - Explicit father surname: "George Smith and Anna Grabania" -> "Smith"
 * - Shared parent surname: "George and Anna Robinson" -> "Robinson"
 */
export function extractFatherSurname(parentsStr: string): string | null {
  const p = String(parentsStr || '').trim();
  if (!p) return null;

  // Split by "and" or "&"
  const parts = p.split(/\s+(?:and|\&)\s+/i);
  if (parts.length < 2) {
    // If not split, maybe last word of parent string is a surname
    const words = p.split(/\s+/);
    return words.length >= 2 ? words[words.length - 1] : null;
  }

  const part1 = parts[0].trim().split(/\s+/);
  const part2 = parts[1].trim().split(/\s+/);

  if (part1.length >= 2) {
    // Explicit surname: e.g. ["George", "Smith"]
    return part1[part1.length - 1];
  }
  
  if (part2.length >= 2) {
    // Shared surname: e.g. part1=["George"], part2=["Anna", "Robinson"]
    return part2[part2.length - 1];
  }

  return null;
}

/**
 * Extracts a shared parent surname from the parents string if present.
 * Matches: "George and Anna Robinson" -> "Robinson"
 * Returns null if they have distinct surnames listed: "George Smith and Anna Grabania"
 */
export function extractSharedParentSurname(parentsStr: string): string | null {
  const p = String(parentsStr || '').trim();
  if (!p) return null;

  const parts = p.split(/\s+(?:and|\&)\s+/i);
  if (parts.length < 2) return null;

  const part1 = parts[0].trim().split(/\s+/);
  const part2 = parts[1].trim().split(/\s+/);

  // If first parent has no surname, and second parent has a surname, it's shared
  if (part1.length === 1 && part2.length >= 2) {
    return part2[part2.length - 1];
  }

  return null;
}

/**
 * Registry of safe action value resolvers.
 */
export const ruleResolvers = {
  literal_value: (args: any, action: any): any => {
    return action.value;
  },

  existing_field_value: (args: any, action: any, ctx: ResolverContext): any => {
    const sourceField = action.resolver_args?.source_field;
    return sourceField ? ctx.fields[sourceField] : null;
  },

  normalized_date_value: (args: any, action: any, ctx: ResolverContext): any => {
    const val = ctx.fields[action.field];
    return formatDbDate(val);
  },

  father_surname_from_parents: (args: any, action: any, ctx: ResolverContext): any => {
    const sourceField = action.resolver_args?.source_field || 'parents';
    const parentsVal = ctx.fields[sourceField];
    return extractFatherSurname(parentsVal);
  },

  shared_parent_surname: (args: any, action: any, ctx: ResolverContext): any => {
    const sourceField = action.resolver_args?.source_field || 'parents';
    const parentsVal = ctx.fields[sourceField];
    return extractSharedParentSurname(parentsVal);
  },

  canonical_entity_value: (args: any, action: any, ctx: ResolverContext): any => {
    const entityType = action.resolver_args?.entity_type;
    const matchField = action.resolver_args?.match_field || action.field;
    const searchVal = String(ctx.fields[matchField] || '').trim();
    if (!searchVal) return null;

    const matched = ctx.entities.find(e => {
      if (e.entity_type !== entityType) return false;
      return clergyNameMatchesEntity(searchVal, e.canonical_value, e.variants_json);
    });

    return matched ? matched.canonical_value : null;
  },

  best_matching_clergy_by_tenure_and_variant: (args: any, action: any, ctx: ResolverContext): any => {
    const clergyVal = String(
      ctx.fields[action.field] ||
      ctx.fields.clergy ||
      ctx.fields.performed_by ||
      ctx.fields.officiant ||
      ''
    ).trim();
    const eventDateStr = resolvePrimaryEventDate(ctx.recordType, ctx.fields);

    const clergyEntities = ctx.entities.filter(e => e.entity_type === 'clergy');
    const matchedClergy: any[] = [];

    const eventTime = eventDateStr ? new Date(eventDateStr).getTime() : null;

    for (const ent of clergyEntities) {
      let isNameMatch = false;
      let matchType: 'canonical' | 'variant' | 'identity' | 'date_only' = 'date_only';

      if (clergyVal) {
        const searchLower = clergyVal.toLowerCase();
        if (ent.canonical_value.toLowerCase() === searchLower) {
          isNameMatch = true;
          matchType = 'canonical';
        } else {
          const variants = clergyVariantValues(ent.variants_json);
          if (variants.some(v => String(v).trim().toLowerCase() === searchLower)) {
            isNameMatch = true;
            matchType = 'variant';
          } else if (clergyNameMatchesEntity(clergyVal, ent.canonical_value, ent.variants_json)) {
            isNameMatch = true;
            matchType = 'identity';
          }
        }
      }

      let isDateMatch = false;
      if (eventTime) {
        const fromTime = ent.active_from ? new Date(ent.active_from).getTime() : -Infinity;
        const toTime = ent.active_to ? new Date(ent.active_to).getTime() : Infinity;
        if (eventTime >= fromTime && eventTime <= toTime) {
          isDateMatch = true;
        }
      }

      if (isNameMatch || (!clergyVal && isDateMatch)) {
        let score = 0;
        if (matchType === 'canonical') score += 100;
        else if (matchType === 'variant') score += 90;
        else if (matchType === 'identity') score += 85;

        if (isDateMatch) score += 50;

        const role = String(ent.role || '').toLowerCase();
        if (role.includes('rector')) score += 30;
        else if (role.includes('priest')) score += 20;
        else if (role.includes('deacon')) score += 10;

        if (ent.active_from && ent.active_to) {
          const tenureDays = (new Date(ent.active_to).getTime() - new Date(ent.active_from).getTime()) / (1000 * 60 * 60 * 24);
          if (tenureDays > 0) {
            score += Math.max(0, Math.min(10, 10 - (tenureDays / 365)));
          }
        }

        matchedClergy.push({
          entity: ent,
          score,
          match_type: matchType,
          is_date_match: isDateMatch
        });
      }
    }

    matchedClergy.sort((a, b) => b.score - a.score);

    if (matchedClergy.length === 0) {
      return null;
    }

    const results = matchedClergy.map(m => {
      const ent = m.entity;
      const tenureStr = ent.active_from && ent.active_to
        ? `served ${ent.active_from} to ${ent.active_to}`
        : (ent.active_from
          ? (ent.active_to == null ? `served starting ${ent.active_from} (current)` : `served starting ${ent.active_from}`)
          : 'active tenure');

      const reason = m.match_type !== 'date_only'
        ? `Name matches variation and ${m.is_date_match ? 'date matches active service period' : 'tenure checks skipped'}`
        : `Clergy served during record event date (${eventDateStr})`;

      return {
        canonical_value: ent.canonical_value,
        role: ent.role || 'Clergy',
        tenure: tenureStr,
        reason,
        match_strength: m.score >= 140 ? 'strong' : (m.score >= 90 ? 'medium' : 'weak'),
        score: m.score,
        raw_value: clergyVal || null,
      };
    });

    const distinctCanons = new Set(results.map(r => String(r.canonical_value).toLowerCase()));
    const isAmbiguous =
      distinctCanons.size > 1 &&
      results.length > 1 &&
      (results[0].score === results[1].score || results[0].score - results[1].score < 10);

    const topIsNameMatch = matchedClergy[0].match_type !== 'date_only';
    const confidentUnique = !isAmbiguous && topIsNameMatch && results[0].score >= 85 && distinctCanons.size === 1;

    return {
      canonical_value: results[0].canonical_value,
      suggestions: results,
      is_ambiguous: isAmbiguous || !confidentUnique,
      confident: confidentUnique,
      raw_value: clergyVal || null,
    };
  },

  default_tenant_church_location: (_args: any, action: any, ctx: ResolverContext): any => {
    if (ctx.recordType !== 'baptism' && ctx.recordType !== 'marriage') {
      return null;
    }
    const churchEntity = ctx.entities.find((e) => {
      if (e.entity_type !== 'location') return false;
      if (locationTypeFromEntity(e) !== 'Church') return false;
      try {
        const meta = typeof e.metadata_json === 'string' ? JSON.parse(e.metadata_json || '{}') : (e.metadata_json || {});
        return meta.default_kind === 'church' || !!meta.tenant_default;
      } catch {
        return e.role === 'Church';
      }
    }) || ctx.entities.find((e) => e.entity_type === 'location' && locationTypeFromEntity(e) === 'Church');

    if (!churchEntity) return null;

    const field = action.field || 'church';
    const existing = String(ctx.fields[field] || ctx.fields.church || ctx.fields.location || '').trim();
    if (existing && existing.toLowerCase() === String(churchEntity.canonical_value).toLowerCase()) {
      return {
        canonical_value: churchEntity.canonical_value,
        suggestions: [{
          canonical_value: churchEntity.canonical_value,
          role: 'Church',
          reason: 'Already set to tenant Church location',
          match_strength: 'strong',
          entity_id: churchEntity.id,
        }],
        is_ambiguous: false,
        confident: true,
        raw_value: existing || null,
        entity_id: churchEntity.id,
      };
    }
    if (existing) {
      // Do not overwrite an explicit non-church location on baptism/marriage
      return null;
    }

    return {
      canonical_value: churchEntity.canonical_value,
      suggestions: [{
        canonical_value: churchEntity.canonical_value,
        role: 'Church',
        reason: 'Tenant default Church implied by church_id',
        match_strength: 'strong',
        entity_id: churchEntity.id,
      }],
      is_ambiguous: false,
      confident: true,
      raw_value: null,
      entity_id: churchEntity.id,
    };
  },

  best_matching_burial_location: (_args: any, action: any, ctx: ResolverContext): any => {
    const raw = String(
      ctx.fields[action.field] ||
      ctx.fields.place_of_burial ||
      ctx.fields.burial_location ||
      '',
    ).trim();
    if (!raw) return null;

    const result = resolveLocationAgainstEntities(raw, ctx.entities, {
      types: ['Cemetery', 'Other'],
    });

    if (result.status === 'unmatched') {
      return {
        canonical_value: null,
        suggestions: [],
        is_ambiguous: true,
        confident: false,
        raw_value: raw,
        review_required: true,
        explanation: `Unmatched burial location “${raw}” — review required (will not create a canonical location automatically)`,
      };
    }

    const suggestions = result.candidates.map((c) => ({
      canonical_value: c.canonical_value,
      role: c.location_type,
      reason: c.match === 'exact'
        ? 'Exact match to canonical location'
        : c.match === 'variant'
          ? 'Matched Spelling/OCR variant'
          : 'Matched normalized location identity',
      match_strength: c.match === 'exact' || c.match === 'variant' ? 'strong' : 'medium',
      entity_id: c.entity_id,
      score: c.match === 'exact' ? 100 : c.match === 'variant' ? 90 : 80,
    }));

    const confident = result.status === 'matched';
    return {
      canonical_value: confident ? result.canonical : null,
      suggestions,
      is_ambiguous: !confident,
      confident,
      raw_value: raw,
      entity_id: confident ? result.entity_id : null,
      review_required: !confident,
    };
  },
};

