import { Router } from 'express';
import multer from 'multer';
import { promisePool } from '../../config/db';
import { validateChurchAccess, resolveChurchDb } from './helpers';
import { validateRuleSchema } from '../../services/ocr/rules/ruleSchemaValidator';
import { ParishRulesEngine } from '../../services/ocr/rules/ParishRulesEngine';
import {
  parseClergyListText,
  parseClergyStructuredRows,
  normalizeClergyImportRow,
  type ClergyImportRow,
} from '../../services/ocr/parseClergyListText';
import { normalizeEntityDate, normalizeEntityRowDates } from '../../services/ocr/normalizeEntityDate';
import {
  discoverTenantClergy,
  resolveClergyAgainstEntities,
  variantsForStorage,
  type ClergyDiscoveryGroup,
} from '../../services/ocr/clergyDiscovery';
import {
  aliasClergyFieldsForRules,
  mergeVariantCounts,
  parseClergyVariants,
  type ClergyVariantCount,
} from '../../services/ocr/clergyIdentity';
import {
  discoverTenantLocations,
  ensureTenantDefaultLocations,
  getDefaultChurchLocation,
  resolveLocationAgainstEntities,
  variantsForLocationStorage,
  type LocationDiscoveryGroup,
} from '../../services/ocr/locationDiscovery';
import {
  isTenantDefaultLocation,
  locationTypeFromEntity,
  mergeLocationVariantCounts,
  parseLocationMetadata,
  parseLocationVariants,
  type LocationMetadata,
  type LocationType,
  type LocationVariantCount,
} from '../../services/ocr/locationIdentity';

const { requireAuth } = require('../../middleware/requireAuth');

const clergyImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router({ mergeParams: true });

// Authenticate first (JWT or session), then verify parish access.
router.use(requireAuth);

const checkAccess = (req: any, res: any, next: any) => {
  const churchId = parseInt(req.params.churchId, 10);
  if (!validateChurchAccess(req, churchId)) {
    return res.status(403).json({ error: 'Access denied to this church' });
  }
  next();
};

router.use(checkAccess);

// -------------------------------------------------------------------------
// Configuration Entities APIs
// -------------------------------------------------------------------------

// GET /rules/config/entities
router.get('/rules/config/entities', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const [rows] = await promisePool.query(
      `SELECT * FROM ocr_parish_configuration_entities WHERE church_id = ? AND is_active = 1`,
      [churchId]
    );
    const entities = (rows as any[]).map((row) => normalizeEntityRowDates(row));
    res.json({ ok: true, entities });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/config/entities
router.post('/rules/config/entities', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const { entity_type, canonical_value, display_label, role, active_from, active_to, variants_json, source_notes, metadata_json, source_label } = req.body || {};

    if (!entity_type || !canonical_value) {
      return res.status(400).json({ error: 'entity_type and canonical_value are required' });
    }

    const userEmail = req.session?.user?.email || req.user?.email || 'system';

    const [result]: any = await promisePool.query(
      `INSERT INTO ocr_parish_configuration_entities 
       (church_id, entity_type, canonical_value, display_label, role, active_from, active_to, variants_json, source_notes, metadata_json, source_label, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        churchId,
        entity_type,
        canonical_value,
        display_label || null,
        role || null,
        normalizeEntityDate(active_from),
        normalizeEntityDate(active_to),
        typeof variants_json === 'object' ? JSON.stringify(variants_json) : (variants_json || null),
        source_notes || null,
        typeof metadata_json === 'object' ? JSON.stringify(metadata_json) : (metadata_json || null),
        source_label || null,
        userEmail
      ]
    );

    res.json({ ok: true, id: result.insertId, message: 'Entity created successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /rules/config/entities/:id
router.patch('/rules/config/entities/:id', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const entityId = parseInt(req.params.id, 10);

    const [entRows]: any = await promisePool.query(
      `SELECT * FROM ocr_parish_configuration_entities WHERE id = ? AND church_id = ?`,
      [entityId, churchId]
    );
    if (!entRows.length) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    const updates = req.body || {};
    const allowedKeys = ['canonical_value', 'display_label', 'role', 'active_from', 'active_to', 'variants_json', 'source_notes', 'is_active', 'metadata_json', 'source_label'];
    const setClause: string[] = [];
    const params: any[] = [];

    for (const key of allowedKeys) {
      if (key in updates) {
        setClause.push(`${key} = ?`);
        let val = updates[key];
        if ((key === 'variants_json' || key === 'metadata_json') && typeof val === 'object') {
          val = JSON.stringify(val);
        } else if (key === 'active_from' || key === 'active_to') {
          val = normalizeEntityDate(val);
        }
        params.push(val);
      }
    }

    if (!setClause.length) {
      return res.status(400).json({ error: 'No valid update parameters provided' });
    }

    params.push(entityId, churchId);
    await promisePool.query(
      `UPDATE ocr_parish_configuration_entities SET ${setClause.join(', ')} WHERE id = ? AND church_id = ?`,
      params
    );

    res.json({ ok: true, message: 'Entity updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /rules/config/entities/:id
router.delete('/rules/config/entities/:id', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const entityId = parseInt(req.params.id, 10);

    const [entRows]: any = await promisePool.query(
      `SELECT * FROM ocr_parish_configuration_entities WHERE id = ? AND church_id = ?`,
      [entityId, churchId]
    );
    if (!entRows.length) {
      return res.status(404).json({ error: 'Entity not found' });
    }
    if (isTenantDefaultLocation(entRows[0])) {
      return res.status(403).json({
        error: 'Tenant default Church/Cemetery locations cannot be deleted from OCR Settings. Edit them via the church or cemetery profile instead.',
      });
    }

    const [result]: any = await promisePool.query(
      `DELETE FROM ocr_parish_configuration_entities WHERE id = ? AND church_id = ?`,
      [entityId, churchId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    res.json({ ok: true, message: 'Entity deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------------
// Clergy discovery / resolve / merge / split
// -------------------------------------------------------------------------

// POST /rules/config/clergy/discover — scan tenant records; return grouped preview (no writes)
router.post('/rules/config/clergy/discover', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const groups = await discoverTenantClergy(churchId);
    res.json({ ok: true, groups, count: groups.length });
  } catch (err: any) {
    console.error('[clergy/discover]', err);
    res.status(500).json({ error: err.message || 'Discovery failed' });
  }
});

// POST /rules/config/clergy/accept — persist selected discovery groups as entities
router.post('/rules/config/clergy/accept', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const { groups, default_role } = req.body || {};
    const defaultRole = String(default_role || 'Rector').trim() || 'Rector';
    const userEmail = req.session?.user?.email || req.user?.email || 'system';

    if (!Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ error: 'groups array is required' });
    }

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let i = 0; i < groups.length; i++) {
      const g = groups[i] as Partial<ClergyDiscoveryGroup> & {
        canonical_value?: string;
        active_from?: string | null;
        active_to?: string | null;
        role?: string;
        entity_id?: number;
      };
      const canonical = String(g.canonical_value || g.suggested_canonical || '').trim();
      if (!canonical) {
        errors.push(`Group ${i + 1}: missing canonical name`);
        continue;
      }

      const variants = variantsForStorage(
        Array.isArray(g.variants) ? (g.variants as ClergyVariantCount[]) : [],
        canonical,
      );
      const activeFrom = normalizeEntityDate(g.active_from ?? g.suggested_active_from ?? null);
      const activeTo =
        'active_to' in g
          ? normalizeEntityDate(g.active_to)
          : normalizeEntityDate(g.suggested_active_to ?? null);
      const role = String(g.role || defaultRole).trim() || defaultRole;
      const variantsJson = variants.length ? JSON.stringify(variants) : null;
      const notes = `Discovered from tenant sacrament records (${g.identity_key || 'group'})`;

      try {
        if (g.entity_id) {
          await promisePool.query(
            `UPDATE ocr_parish_configuration_entities
             SET canonical_value = ?, display_label = ?, role = ?, active_from = ?, active_to = ?,
                 variants_json = ?, source_notes = COALESCE(source_notes, ?)
             WHERE id = ? AND church_id = ? AND entity_type = 'clergy'`,
            [canonical, canonical, role, activeFrom, activeTo, variantsJson, notes, g.entity_id, churchId],
          );
          updated += 1;
        } else {
          const [existing]: any = await promisePool.query(
            `SELECT id FROM ocr_parish_configuration_entities
             WHERE church_id = ? AND entity_type = 'clergy' AND is_active = 1
               AND LOWER(TRIM(canonical_value)) = ?
             LIMIT 1`,
            [churchId, canonical.toLowerCase()],
          );
          if (existing.length) {
            await promisePool.query(
              `UPDATE ocr_parish_configuration_entities
               SET role = COALESCE(role, ?), active_from = COALESCE(?, active_from),
                   active_to = COALESCE(?, active_to), variants_json = ?,
                   source_notes = COALESCE(source_notes, ?)
               WHERE id = ? AND church_id = ?`,
              [role, activeFrom, activeTo, variantsJson, notes, existing[0].id, churchId],
            );
            updated += 1;
          } else {
            await promisePool.query(
              `INSERT INTO ocr_parish_configuration_entities
               (church_id, entity_type, canonical_value, display_label, role, active_from, active_to, variants_json, source_notes, created_by)
               VALUES (?, 'clergy', ?, ?, ?, ?, ?, ?, ?, ?)`,
              [churchId, canonical, canonical, role, activeFrom, activeTo, variantsJson, notes, userEmail],
            );
            created += 1;
          }
        }
      } catch (rowErr: any) {
        errors.push(`Group ${i + 1} (${canonical}): ${rowErr.message}`);
      }
    }

    res.json({
      ok: true,
      created,
      updated,
      errors,
      message: `Accepted ${created + updated} clergy group(s) (${created} created, ${updated} updated).`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/config/clergy/resolve — match raw clergy against tenant entities
router.post('/rules/config/clergy/resolve', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const raw = String(req.body?.raw ?? req.body?.value ?? '').trim();
    const [rows]: any = await promisePool.query(
      `SELECT id, entity_type, canonical_value, variants_json
       FROM ocr_parish_configuration_entities
       WHERE church_id = ? AND entity_type = 'clergy' AND is_active = 1`,
      [churchId],
    );
    const result = resolveClergyAgainstEntities(raw, rows);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/config/clergy/merge — merge source entity IDs into target
router.post('/rules/config/clergy/merge', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const targetId = parseInt(req.body?.target_id, 10);
    const sourceIds: number[] = Array.isArray(req.body?.source_ids)
      ? req.body.source_ids.map((id: any) => parseInt(id, 10)).filter((id: number) => Number.isFinite(id) && id !== targetId)
      : [];
    const recomputeDates = req.body?.recompute_dates !== false;

    if (!Number.isFinite(targetId) || sourceIds.length === 0) {
      return res.status(400).json({ error: 'target_id and source_ids are required' });
    }

    const allIds = [targetId, ...sourceIds];
    const [rows]: any = await promisePool.query(
      `SELECT * FROM ocr_parish_configuration_entities
       WHERE church_id = ? AND entity_type = 'clergy' AND id IN (${allIds.map(() => '?').join(',')})`,
      [churchId, ...allIds],
    );
    const byId = new Map<number, any>(rows.map((r: any) => [Number(r.id), r]));
    const target: any = byId.get(targetId);
    if (!target) return res.status(404).json({ error: 'Target entity not found' });

    let variants = parseClergyVariants(target.variants_json);
    let activeFrom = normalizeEntityDate(target.active_from);
    let activeTo = normalizeEntityDate(target.active_to);

    for (const sid of sourceIds) {
      const src: any = byId.get(sid);
      if (!src) continue;
      const srcVariants = parseClergyVariants(src.variants_json);
      srcVariants.push({
        value: String(src.canonical_value || '').trim(),
        total: 0,
      });
      variants = mergeVariantCounts(variants, srcVariants.filter((v) => v.value));
      if (recomputeDates) {
        const sFrom = normalizeEntityDate(src.active_from);
        const sTo = normalizeEntityDate(src.active_to);
        if (sFrom && (!activeFrom || sFrom < activeFrom)) activeFrom = sFrom;
        if (sTo && (!activeTo || sTo > activeTo)) activeTo = sTo;
        if (target.active_to == null && src.active_to == null) activeTo = null;
      }
    }

    variants = variantsForStorage(variants, String(target.canonical_value));

    await promisePool.query(
      `UPDATE ocr_parish_configuration_entities
       SET variants_json = ?, active_from = ?, active_to = ?,
           source_notes = CONCAT(COALESCE(source_notes, ''), ?)
       WHERE id = ? AND church_id = ?`,
      [
        variants.length ? JSON.stringify(variants) : null,
        activeFrom,
        activeTo,
        `\nMerged from entity ids: ${sourceIds.join(', ')}`,
        targetId,
        churchId,
      ],
    );

    await promisePool.query(
      `UPDATE ocr_parish_configuration_entities SET is_active = 0
       WHERE church_id = ? AND id IN (${sourceIds.map(() => '?').join(',')})`,
      [churchId, ...sourceIds],
    );

    res.json({ ok: true, target_id: targetId, merged_ids: sourceIds, message: 'Clergy entities merged' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/config/clergy/split — move selected variants into a new entity
router.post('/rules/config/clergy/split', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const sourceId = parseInt(req.body?.source_id, 10);
    const variantValues: string[] = Array.isArray(req.body?.variants)
      ? req.body.variants.map((v: any) => String(v).trim()).filter(Boolean)
      : [];
    const newCanonical = String(req.body?.canonical_value || variantValues[0] || '').trim();
    const role = String(req.body?.role || 'Rector').trim() || 'Rector';
    const userEmail = req.session?.user?.email || req.user?.email || 'system';

    if (!Number.isFinite(sourceId) || !newCanonical || variantValues.length === 0) {
      return res.status(400).json({ error: 'source_id, canonical_value, and variants are required' });
    }

    const [rows]: any = await promisePool.query(
      `SELECT * FROM ocr_parish_configuration_entities
       WHERE id = ? AND church_id = ? AND entity_type = 'clergy' AND is_active = 1`,
      [sourceId, churchId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Source entity not found' });

    const source = rows[0];
    const allVariants = parseClergyVariants(source.variants_json);
    const moveSet = new Set(variantValues.map((v) => v.toLowerCase()));
    const moving = allVariants.filter((v) => moveSet.has(v.value.toLowerCase()));
    const remaining = allVariants.filter((v) => !moveSet.has(v.value.toLowerCase()));

    if (!moving.length) {
      return res.status(400).json({ error: 'None of the specified variants were found on the source entity' });
    }

    const newVariants = variantsForStorage(moving, newCanonical);
    const [insertResult]: any = await promisePool.query(
      `INSERT INTO ocr_parish_configuration_entities
       (church_id, entity_type, canonical_value, display_label, role, active_from, active_to, variants_json, source_notes, created_by)
       VALUES (?, 'clergy', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        churchId,
        newCanonical,
        newCanonical,
        role,
        normalizeEntityDate(req.body?.active_from ?? source.active_from),
        normalizeEntityDate(req.body?.active_to ?? source.active_to),
        newVariants.length ? JSON.stringify(newVariants) : null,
        `Split from entity ${sourceId} (${source.canonical_value})`,
        userEmail,
      ],
    );

    await promisePool.query(
      `UPDATE ocr_parish_configuration_entities SET variants_json = ? WHERE id = ? AND church_id = ?`,
      [remaining.length ? JSON.stringify(remaining) : null, sourceId, churchId],
    );

    res.json({
      ok: true,
      new_id: insertResult.insertId,
      source_id: sourceId,
      message: 'Clergy variants split into new entity',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------------
// Location discovery / defaults / resolve / merge / split
// -------------------------------------------------------------------------

router.post('/rules/config/locations/ensure-defaults', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const userEmail = req.session?.user?.email || req.user?.email || 'system';
    const result = await ensureTenantDefaultLocations(churchId, userEmail);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to ensure default locations' });
  }
});

router.post('/rules/config/locations/discover', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    await ensureTenantDefaultLocations(churchId);
    const groups = await discoverTenantLocations(churchId);
    res.json({ ok: true, groups, count: groups.length, source: 'funeral_records.burial_location' });
  } catch (err: any) {
    console.error('[locations/discover]', err);
    res.status(500).json({ error: err.message || 'Location discovery failed' });
  }
});

router.post('/rules/config/locations/accept', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const { groups } = req.body || {};
    const userEmail = req.session?.user?.email || req.user?.email || 'system';
    if (!Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ error: 'groups array is required' });
    }

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let i = 0; i < groups.length; i++) {
      const g = groups[i] as Partial<LocationDiscoveryGroup> & {
        canonical_value?: string;
        location_type?: LocationType;
        display_label?: string;
        street_address?: string;
        city?: string;
        state_province?: string;
        postal_code?: string;
        country?: string;
        tenant_default?: boolean;
        entity_id?: number;
      };
      const canonical = String(g.canonical_value || g.suggested_canonical || '').trim();
      if (!canonical) {
        errors.push(`Group ${i + 1}: missing canonical name`);
        continue;
      }
      const locationType: LocationType =
        g.location_type || g.suggested_type || 'Cemetery';
      const variants = variantsForLocationStorage(
        Array.isArray(g.variants) ? (g.variants as LocationVariantCount[]) : [],
        canonical,
      );
      const meta: LocationMetadata = {
        location_type: locationType,
        tenant_default: !!g.tenant_default,
        default_kind: g.tenant_default ? 'parish_cemetery' : null,
        source: g.source || 'funeral_records.burial_location',
        usage_count: g.total_records || 0,
        street_address: g.street_address || g.suggested_address?.street_address || null,
        city: g.city || g.suggested_address?.city || null,
        state_province: g.state_province || g.suggested_address?.state_province || null,
        postal_code: g.postal_code || g.suggested_address?.postal_code || null,
        country: g.country || g.suggested_address?.country || null,
      };

      try {
        if (g.entity_id) {
          await promisePool.query(
            `UPDATE ocr_parish_configuration_entities
             SET canonical_value = ?, display_label = ?, role = ?, metadata_json = ?, variants_json = ?,
                 source_notes = COALESCE(source_notes, ?)
             WHERE id = ? AND church_id = ? AND entity_type = 'location'`,
            [
              canonical,
              g.display_label || canonical,
              locationType,
              JSON.stringify(meta),
              variants.length ? JSON.stringify(variants) : null,
              `Accepted from funeral_records.burial_location (${g.identity_key || 'group'})`,
              g.entity_id,
              churchId,
            ],
          );
          updated += 1;
        } else {
          const [existing]: any = await promisePool.query(
            `SELECT id FROM ocr_parish_configuration_entities
             WHERE church_id = ? AND entity_type = 'location' AND is_active = 1
               AND LOWER(TRIM(canonical_value)) = ?
             LIMIT 1`,
            [churchId, canonical.toLowerCase()],
          );
          if (existing.length) {
            await promisePool.query(
              `UPDATE ocr_parish_configuration_entities
               SET role = ?, metadata_json = ?, variants_json = ?
               WHERE id = ? AND church_id = ?`,
              [locationType, JSON.stringify(meta), variants.length ? JSON.stringify(variants) : null, existing[0].id, churchId],
            );
            updated += 1;
          } else {
            await promisePool.query(
              `INSERT INTO ocr_parish_configuration_entities
               (church_id, entity_type, canonical_value, display_label, role, metadata_json, variants_json, source_label, source_notes, created_by)
               VALUES (?, 'location', ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                churchId,
                canonical,
                g.display_label || canonical,
                locationType,
                JSON.stringify(meta),
                variants.length ? JSON.stringify(variants) : null,
                g.tenant_default ? 'tenant_default' : 'discovered',
                `Discovered from funeral_records.burial_location (${g.identity_key || 'group'})`,
                userEmail,
              ],
            );
            created += 1;
          }
        }
      } catch (rowErr: any) {
        errors.push(`Group ${i + 1} (${canonical}): ${rowErr.message}`);
      }
    }

    res.json({
      ok: true,
      created,
      updated,
      errors,
      message: `Accepted ${created + updated} location group(s) (${created} created, ${updated} updated).`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rules/config/locations/resolve', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const raw = String(req.body?.raw ?? req.body?.value ?? '').trim();
    const types = Array.isArray(req.body?.types) ? req.body.types : undefined;
    await ensureTenantDefaultLocations(churchId);
    const [rows]: any = await promisePool.query(
      `SELECT * FROM ocr_parish_configuration_entities
       WHERE church_id = ? AND entity_type = 'location' AND is_active = 1`,
      [churchId],
    );
    const result = resolveLocationAgainstEntities(raw, rows, { types });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/rules/config/locations/default-church', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const entity = await getDefaultChurchLocation(churchId);
    res.json({ ok: true, entity });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rules/config/locations/merge', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const targetId = parseInt(req.body?.target_id, 10);
    const sourceIds: number[] = Array.isArray(req.body?.source_ids)
      ? req.body.source_ids.map((id: any) => parseInt(id, 10)).filter((id: number) => Number.isFinite(id) && id !== targetId)
      : [];
    if (!Number.isFinite(targetId) || sourceIds.length === 0) {
      return res.status(400).json({ error: 'target_id and source_ids are required' });
    }

    const allIds = [targetId, ...sourceIds];
    const [rows]: any = await promisePool.query(
      `SELECT * FROM ocr_parish_configuration_entities
       WHERE church_id = ? AND entity_type = 'location' AND id IN (${allIds.map(() => '?').join(',')})`,
      [churchId, ...allIds],
    );
    const byId = new Map<number, any>(rows.map((r: any) => [Number(r.id), r]));
    const target: any = byId.get(targetId);
    if (!target) return res.status(404).json({ error: 'Target entity not found' });

    let variants = parseLocationVariants(target.variants_json);
    for (const sid of sourceIds) {
      const src: any = byId.get(sid);
      if (!src) continue;
      if (isTenantDefaultLocation(src) && !isTenantDefaultLocation(target)) {
        return res.status(400).json({ error: 'Cannot merge a tenant default location into a non-default location. Merge the other way.' });
      }
      const srcVariants = parseLocationVariants(src.variants_json);
      srcVariants.push({ value: String(src.canonical_value || '').trim(), total: 0 });
      variants = mergeLocationVariantCounts(variants, srcVariants.filter((v) => v.value));
    }
    variants = variantsForLocationStorage(variants, String(target.canonical_value));

    await promisePool.query(
      `UPDATE ocr_parish_configuration_entities
       SET variants_json = ?, source_notes = CONCAT(COALESCE(source_notes, ''), ?)
       WHERE id = ? AND church_id = ?`,
      [
        variants.length ? JSON.stringify(variants) : null,
        `\nMerged from location ids: ${sourceIds.join(', ')}`,
        targetId,
        churchId,
      ],
    );
    await promisePool.query(
      `UPDATE ocr_parish_configuration_entities SET is_active = 0
       WHERE church_id = ? AND id IN (${sourceIds.map(() => '?').join(',')})
         AND COALESCE(JSON_EXTRACT(metadata_json, '$.tenant_default'), 0) = 0`,
      [churchId, ...sourceIds],
    );

    res.json({ ok: true, target_id: targetId, merged_ids: sourceIds, message: 'Locations merged' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rules/config/locations/split', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const sourceId = parseInt(req.body?.source_id, 10);
    const variantValues: string[] = Array.isArray(req.body?.variants)
      ? req.body.variants.map((v: any) => String(v).trim()).filter(Boolean)
      : [];
    const newCanonical = String(req.body?.canonical_value || variantValues[0] || '').trim();
    const locationType: LocationType = req.body?.location_type || 'Other';
    const userEmail = req.session?.user?.email || req.user?.email || 'system';

    if (!Number.isFinite(sourceId) || !newCanonical || variantValues.length === 0) {
      return res.status(400).json({ error: 'source_id, canonical_value, and variants are required' });
    }

    const [rows]: any = await promisePool.query(
      `SELECT * FROM ocr_parish_configuration_entities
       WHERE id = ? AND church_id = ? AND entity_type = 'location' AND is_active = 1`,
      [sourceId, churchId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Source entity not found' });

    const source = rows[0];
    const allVariants = parseLocationVariants(source.variants_json);
    const moveSet = new Set(variantValues.map((v) => v.toLowerCase()));
    const moving = allVariants.filter((v) => moveSet.has(v.value.toLowerCase()));
    const remaining = allVariants.filter((v) => !moveSet.has(v.value.toLowerCase()));
    if (!moving.length) {
      return res.status(400).json({ error: 'None of the specified variants were found on the source entity' });
    }

    const newVariants = variantsForLocationStorage(moving, newCanonical);
    const meta: LocationMetadata = {
      location_type: locationType,
      tenant_default: false,
      source: 'split',
      ...(req.body?.address || {}),
    };
    const [insertResult]: any = await promisePool.query(
      `INSERT INTO ocr_parish_configuration_entities
       (church_id, entity_type, canonical_value, display_label, role, metadata_json, variants_json, source_label, source_notes, created_by)
       VALUES (?, 'location', ?, ?, ?, ?, ?, 'manual', ?, ?)`,
      [
        churchId,
        newCanonical,
        req.body?.display_label || newCanonical,
        locationType,
        JSON.stringify(meta),
        newVariants.length ? JSON.stringify(newVariants) : null,
        `Split from location ${sourceId} (${source.canonical_value})`,
        userEmail,
      ],
    );
    await promisePool.query(
      `UPDATE ocr_parish_configuration_entities SET variants_json = ? WHERE id = ? AND church_id = ?`,
      [remaining.length ? JSON.stringify(remaining) : null, sourceId, churchId],
    );

    res.json({ ok: true, new_id: insertResult.insertId, source_id: sourceId, message: 'Location variants split' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/config/entities/parse — preview clergy rows from text or structured data
router.post('/rules/config/entities/parse', async (req: any, res: any) => {
  try {
    const { text, rows, headers, default_role } = req.body || {};
    const defaultRole = String(default_role || 'Rector').trim() || 'Rector';

    let parsed: ClergyImportRow[] = [];
    if (typeof text === 'string' && text.trim()) {
      parsed = parseClergyListText(text, defaultRole);
    } else if (Array.isArray(rows) && rows.length > 0) {
      parsed = parseClergyStructuredRows(rows, Array.isArray(headers) ? headers : undefined, defaultRole);
    } else {
      return res.status(400).json({ error: 'Provide text or rows to parse' });
    }

    res.json({ ok: true, rows: parsed, count: parsed.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/config/entities/bulk — import multiple clergy configuration entities
router.post('/rules/config/entities/bulk', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const { entities, skip_duplicates, default_role } = req.body || {};
    const defaultRole = String(default_role || 'Rector').trim() || 'Rector';
    const skipDuplicates = skip_duplicates !== false;

    if (!Array.isArray(entities) || entities.length === 0) {
      return res.status(400).json({ error: 'entities array is required' });
    }
    if (entities.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 entities per import' });
    }

    const userEmail = req.session?.user?.email || req.user?.email || 'system';
    const existing = new Set<string>();

    if (skipDuplicates) {
      const [existingRows]: any = await promisePool.query(
        `SELECT canonical_value FROM ocr_parish_configuration_entities
         WHERE church_id = ? AND entity_type = 'clergy' AND is_active = 1`,
        [churchId],
      );
      for (const row of existingRows) {
        existing.add(String(row.canonical_value || '').trim().toLowerCase());
      }
    }

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < entities.length; i++) {
      const normalized = normalizeClergyImportRow(entities[i], defaultRole);
      if (!normalized) {
        errors.push(`Row ${i + 1}: missing canonical name`);
        continue;
      }

      const key = normalized.canonical_value.toLowerCase();
      if (skipDuplicates && existing.has(key)) {
        skipped += 1;
        continue;
      }

      try {
        await promisePool.query(
          `INSERT INTO ocr_parish_configuration_entities
           (church_id, entity_type, canonical_value, display_label, role, active_from, active_to, variants_json, source_notes, created_by)
           VALUES (?, 'clergy', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            churchId,
            normalized.canonical_value,
            normalized.canonical_value,
            normalized.role,
            normalizeEntityDate(normalized.active_from),
            normalizeEntityDate(normalized.active_to),
            normalized.variants_json.length ? JSON.stringify(normalized.variants_json) : null,
            normalized.source_notes,
            userEmail,
          ],
        );
        existing.add(key);
        created += 1;
      } catch (insertErr: any) {
        errors.push(`Row ${i + 1} (${normalized.canonical_value}): ${insertErr.message}`);
      }
    }

    res.json({
      ok: true,
      created,
      skipped,
      errors,
      message: `Imported ${created} clergy record${created === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}` : ''}.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/config/entities/ocr-extract — OCR a clergy roster image and return parsed rows
router.post(
  '/rules/config/entities/ocr-extract',
  clergyImageUpload.single('file'),
  async (req: any, res: any) => {
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: 'Image file is required (field: file)' });
      }

      const defaultRole = String(req.body?.default_role || 'Rector').trim() || 'Rector';
      const vision = require('@google-cloud/vision');
      const visionConfig: any = { projectId: process.env.GOOGLE_CLOUD_PROJECT_ID };
      if (process.env.GOOGLE_VISION_KEY_PATH) visionConfig.keyFilename = process.env.GOOGLE_VISION_KEY_PATH;
      else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) visionConfig.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const client = new vision.ImageAnnotatorClient(visionConfig);
      const [visionResult] = await client.annotateImage({
        image: { content: req.file.buffer },
        imageContext: { languageHints: ['en'] },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      });

      const fullText = visionResult?.fullTextAnnotation?.text || '';
      if (!fullText.trim()) {
        return res.status(422).json({ error: 'No text detected in image' });
      }

      const rows = parseClergyListText(fullText, defaultRole);
      res.json({
        ok: true,
        text: fullText,
        rows,
        count: rows.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'OCR extraction failed' });
    }
  },
);

// -------------------------------------------------------------------------
// Rules Configuration APIs
// -------------------------------------------------------------------------

// GET /rules
router.get('/rules', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const scopeFilter = req.query.scope as string | undefined;

    let sql = `SELECT * FROM ocr_parish_rules WHERE (church_id IS NULL OR church_id = ?)`;
    const params: any[] = [churchId];

    if (scopeFilter && ['global', 'church', 'diocesan'].includes(scopeFilter)) {
      sql += ` AND scope = ?`;
      params.push(scopeFilter);
    }

    sql += ` ORDER BY FIELD(scope, 'global', 'diocesan', 'church'), priority ASC`;

    const [rows] = await promisePool.query(sql, params);
    res.json({ ok: true, rules: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules
router.post('/rules', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const { name, description, record_type, conditions_json, actions_json, severity, priority } = req.body || {};

    const ruleObj = {
      name,
      description,
      record_type,
      conditions: typeof conditions_json === 'string' ? JSON.parse(conditions_json) : conditions_json,
      actions: typeof actions_json === 'string' ? JSON.parse(actions_json) : actions_json,
      severity: severity || 'suggestion',
      priority: priority ?? 100
    };

    // Strict validation
    try {
      validateRuleSchema(ruleObj);
    } catch (valErr: any) {
      return res.status(400).json({ error: `Rule schema validation failed: ${valErr.message}` });
    }

    const userEmail = req.session?.user?.email || req.user?.email || 'system';
    const ruleScope = req.body.scope || 'church';
    const ruleChurchId = ruleScope === 'global' ? null : churchId;

    const [result]: any = await promisePool.query(
      `INSERT INTO ocr_parish_rules 
       (church_id, scope, name, description, record_type, conditions_json, actions_json, severity, priority, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ruleChurchId,
        ruleScope,
        name,
        description || null,
        record_type,
        JSON.stringify(ruleObj.conditions),
        JSON.stringify(ruleObj.actions),
        ruleObj.severity,
        ruleObj.priority,
        userEmail
      ]
    );

    res.json({ ok: true, id: result.insertId, message: 'Rule created successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /rules/:id
router.patch('/rules/:id', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const ruleId = parseInt(req.params.id, 10);

    const [ruleRows]: any = await promisePool.query(
      `SELECT id, church_id FROM ocr_parish_rules WHERE id = ?`,
      [ruleId]
    );
    if (!ruleRows.length) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    if (ruleRows[0].church_id !== null && ruleRows[0].church_id !== churchId) {
      return res.status(403).json({ error: 'Access denied: Cannot edit another parish rule' });
    }

    const updates = req.body || {};
    const allowedKeys = ['name', 'description', 'record_type', 'conditions_json', 'actions_json', 'severity', 'priority', 'is_active'];
    const setClause: string[] = [];
    const params: any[] = [];

    for (const key of allowedKeys) {
      if (key in updates) {
        setClause.push(`${key} = ?`);
        let val = updates[key];
        if ((key === 'conditions_json' || key === 'actions_json') && typeof val === 'object') {
          val = JSON.stringify(val);
        }
        params.push(val);
      }
    }

    if (!setClause.length) {
      return res.status(400).json({ error: 'No valid update parameters provided' });
    }

    params.push(ruleId);
    await promisePool.query(
      `UPDATE ocr_parish_rules SET ${setClause.join(', ')} WHERE id = ?`,
      params
    );

    res.json({ ok: true, message: 'Rule updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /rules/:id
router.delete('/rules/:id', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const ruleId = parseInt(req.params.id, 10);

    const [ruleRows]: any = await promisePool.query(
      `SELECT id, church_id FROM ocr_parish_rules WHERE id = ?`,
      [ruleId]
    );
    if (!ruleRows.length) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    if (ruleRows[0].church_id !== null && ruleRows[0].church_id !== churchId) {
      return res.status(403).json({ error: 'Access denied: Cannot delete platform-level global rules' });
    }

    await promisePool.query(`DELETE FROM ocr_parish_rules WHERE id = ?`, [ruleId]);
    res.json({ ok: true, message: 'Rule deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------------
// Evaluation & Seeding Integration APIs
// -------------------------------------------------------------------------

// POST /rules/evaluate
router.post('/rules/evaluate', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const { record_type, fields, confidence } = req.body || {};

    if (!record_type || !fields) {
      return res.status(400).json({ error: 'record_type and fields object are required' });
    }

    const engine = new ParishRulesEngine(churchId);
    await engine.init();

    const aliasedFields = aliasClergyFieldsForRules(fields);
    const result = await engine.evaluateRecord(record_type, aliasedFields, {
      confidenceMetadata: confidence
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/outcomes/:id/accept
router.post('/rules/outcomes/:id/accept', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const logId = parseInt(req.params.id, 10);
    const userEmail = req.session?.user?.email || req.user?.email || 'reviewer';

    // 1. Fetch the log outcome
    const [logs]: any = await promisePool.query(
      `SELECT * FROM ocr_rule_evaluation_logs WHERE id = ? AND church_id = ?`,
      [logId, churchId]
    );
    if (!logs.length) {
      return res.status(404).json({ error: 'Evaluation log entry not found' });
    }
    const log = logs[0];

    // 2. Fetch the corresponding job
    const [jobs]: any = await promisePool.query(
      `SELECT id, agent_extract_json FROM ocr_jobs WHERE id = ? AND church_id = ?`,
      [log.ocr_job_id, churchId]
    );
    if (!jobs.length) {
      return res.status(404).json({ error: 'OCR Job not found' });
    }
    const job = jobs[0];

    // 3. Update the value inside agent_extract_json
    let extractPayload: any = {};
    try {
      extractPayload = typeof job.agent_extract_json === 'string' 
        ? JSON.parse(job.agent_extract_json) 
        : job.agent_extract_json;
    } catch (_) {
      return res.status(400).json({ error: 'Invalid agent_extract_json in job' });
    }

    const index = log.record_index ?? 0;
    const records = extractPayload.records || [];
    if (records[index]) {
      // Clean target value before updating
      let valToApply = log.suggested_value;
      // Handle array structure for clergy concurrency
      if (typeof valToApply === 'string' && valToApply.startsWith('[')) {
        try {
          const parsed = JSON.parse(valToApply);
          if (Array.isArray(parsed) && parsed.length > 0) {
            valToApply = parsed[0].canonical_value || valToApply;
          }
        } catch (_) {}
      }

      records[index][log.target_field] = valToApply;
      
      // Keep main fields in sync if updating record index 0
      if (index === 0) {
        extractPayload.fields = extractPayload.fields || {};
        extractPayload.fields[log.target_field] = valToApply;
      }
    }

    // 4. Update the DB records
    await promisePool.query(
      `UPDATE ocr_jobs SET agent_extract_json = ? WHERE id = ?`,
      [JSON.stringify(extractPayload), job.id]
    );

    await promisePool.query(
      `UPDATE ocr_rule_evaluation_logs 
       SET reviewer_decision = 'accepted', resolved_value = ?, decided_by = ?, decided_at = NOW() 
       WHERE id = ?`,
      [log.suggested_value, userEmail, logId]
    );

    res.json({ ok: true, message: 'Suggestion accepted and draft updated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/outcomes/:id/reject
router.post('/rules/outcomes/:id/reject', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const logId = parseInt(req.params.id, 10);
    const userEmail = req.session?.user?.email || req.user?.email || 'reviewer';

    const [result]: any = await promisePool.query(
      `UPDATE ocr_rule_evaluation_logs 
       SET reviewer_decision = 'rejected', decided_by = ?, decided_at = NOW() 
       WHERE id = ? AND church_id = ?`,
      [userEmail, logId, churchId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Evaluation log entry not found' });
    }

    res.json({ ok: true, message: 'Suggestion rejected' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/outcomes/:id/override
router.post('/rules/outcomes/:id/override', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const logId = parseInt(req.params.id, 10);
    const { reason } = req.body || {};
    const userEmail = req.session?.user?.email || req.user?.email || 'reviewer';

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'An override reason is required' });
    }

    const [result]: any = await promisePool.query(
      `UPDATE ocr_rule_evaluation_logs 
       SET reviewer_decision = 'overridden', decision_notes = ?, decided_by = ?, decided_at = NOW() 
       WHERE id = ? AND church_id = ?`,
      [reason, userEmail, logId, churchId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Evaluation log entry not found' });
    }

    res.json({ ok: true, message: 'Warning/error overridden successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/revalidate-record
router.post('/rules/revalidate-record', async (req: any, res: any) => {
  try {
    const churchId = parseInt(req.params.churchId, 10);
    const { job_id, record_index, fields } = req.body || {};

    if (!job_id || !fields) {
      return res.status(400).json({ error: 'job_id and fields object are required' });
    }

    const [jobs]: any = await promisePool.query(
      `SELECT record_type FROM ocr_jobs WHERE id = ? AND church_id = ?`,
      [job_id, churchId]
    );
    if (!jobs.length) {
      return res.status(404).json({ error: 'OCR Job not found' });
    }
    const recordType = jobs[0].record_type;

    const engine = new ParishRulesEngine(churchId);
    await engine.init();

    const aliasedFields = aliasClergyFieldsForRules(fields);
    const evalResult = await engine.evaluateRecord(recordType, aliasedFields, {
      ocrJobId: job_id,
      recordIndex: record_index
    });

    // Clear previous outcomes for this record to prevent duplications
    await promisePool.query(
      `DELETE FROM ocr_rule_evaluation_logs WHERE ocr_job_id = ? AND record_index = ?`,
      [job_id, record_index]
    );

    // Persist new outcomes
    await ParishRulesEngine.persistEvaluationLogs(churchId, job_id, null, record_index, evalResult.outcomes);

    res.json({ ok: true, ...evalResult });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /rules/seed-defaults — idempotent global rule seed (super_admin only)
router.post('/rules/seed-defaults', async (req: any, res: any) => {
  try {
    const role = req.session?.user?.role || req.user?.role;
    if (role !== 'super_admin') {
      return res.status(403).json({ error: 'super_admin required' });
    }

    const [countRows]: any = await promisePool.query(
      `SELECT COUNT(*) AS cnt FROM ocr_parish_rules WHERE scope = 'global' AND church_id IS NULL`
    );
    const existing = countRows[0]?.cnt || 0;
    if (existing > 0) {
      return res.json({ ok: true, skipped: true, message: `Global rules already present (${existing})`, count: existing });
    }

    const fs = require('fs');
    const path = require('path');
    const migrationPath = path.join(__dirname, '../../../database/migrations/2026_06_06_seed_default_rules.sql');
    if (!fs.existsSync(migrationPath)) {
      return res.status(500).json({ error: 'Seed migration file not found' });
    }

    const sql = fs.readFileSync(migrationPath, 'utf8');
    const statements = sql
      .split(';')
      .map((s: string) => s.trim())
      .filter((s: string) => s.startsWith('INSERT'));

    let inserted = 0;
    for (const stmt of statements) {
      const [result]: any = await promisePool.query(stmt);
      inserted += result.affectedRows || 0;
    }

    const userEmail = req.session?.user?.email || req.user?.email || 'system';
    console.log(`[OCR Rules] seed-defaults invoked by ${userEmail}: inserted=${inserted}`);

    res.json({ ok: true, inserted, message: 'Default global OCR rules seeded' });
  } catch (err: any) {
    console.error('[OCR Rules] seed-defaults failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
