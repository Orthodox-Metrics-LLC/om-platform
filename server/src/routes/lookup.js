const express = require('express');
const { getAppPool } = require('../config/db-compat');
const { getTenantPool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// LOOKUP API — Canonical namespace for all dropdown/lookup data
// Mounted at /api/lookup
// ═══════════════════════════════════════════════════════════════

router.use(requireAuth);

// ───────────────────────────────────────────────────────────────
// GET /api/lookup/clergy
// Prefers parish configuration canonical names, then raw DISTINCT
// values from sacrament tables (with counts).
// Query params:
//   church_id    (required — or falls back to session)
//   record_type  (optional: baptism | marriage | funeral — defaults to all)
//   search       (optional: contains match on clergy name)
//   limit        (optional: default 100, max 500)
// ───────────────────────────────────────────────────────────────

const CLERGY_TABLE_MAP = {
    baptism:  { table: 'baptism_records',  column: 'clergy' },
    marriage: { table: 'marriage_records',  column: 'clergy' },
    funeral:  { table: 'funeral_records',   column: 'clergy' },
};

router.get('/clergy', async (req, res) => {
    try {
        const churchId = req.query.church_id
            || req.session?.user?.church_id
            || req.user?.church_id;
        if (!churchId) {
            return res.status(400).json({ error: 'church_id is required (query param or session)' });
        }

        const recordType = req.query.record_type || null;
        const search = (req.query.search || '').trim();
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);

        if (recordType && !CLERGY_TABLE_MAP[recordType]) {
            return res.status(400).json({ error: `Invalid record_type: ${recordType}. Must be one of: baptism, marriage, funeral` });
        }

        const items = [];
        const seen = new Set();

        // 1) Canonical parish clergy entities (preferred)
        try {
            let entitySql = `
                SELECT id, canonical_value, role, active_from, active_to
                FROM ocr_parish_configuration_entities
                WHERE church_id = ? AND entity_type = 'clergy' AND is_active = 1
            `;
            const entityParams = [churchId];
            if (search) {
                entitySql += ` AND canonical_value LIKE ?`;
                entityParams.push(`%${search}%`);
            }
            entitySql += ` ORDER BY canonical_value ASC LIMIT ?`;
            entityParams.push(limit);

            const [entityRows] = await getAppPool().query(entitySql, entityParams);
            for (const row of entityRows) {
                const name = String(row.canonical_value || '').trim();
                if (!name) continue;
                const key = name.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                items.push({
                    value: name,
                    label: name,
                    count: null,
                    source: 'canonical',
                    role: row.role || null,
                    entity_id: row.id,
                    active_from: row.active_from || null,
                    active_to: row.active_to || null,
                });
            }
        } catch (entityErr) {
            console.warn('[Lookup] clergy entities unavailable:', entityErr.message);
        }

        // 2) Raw DISTINCT leftovers from tenant sacrament tables
        if (items.length < limit) {
            const tablesToQuery = recordType
                ? [CLERGY_TABLE_MAP[recordType]]
                : Object.values(CLERGY_TABLE_MAP);

            const unionParts = [];
            const params = [];

            for (const { table, column } of tablesToQuery) {
                unionParts.push(
                    `SELECT ${column} AS clergy_name FROM ${table} WHERE church_id = ? AND ${column} IS NOT NULL AND ${column} != '' AND ${column} != 'N/A'`
                );
                params.push(churchId);
            }

            let sql = `
                SELECT clergy_name, COUNT(*) AS cnt
                FROM (${unionParts.join(' UNION ALL ')}) AS combined
            `;

            if (search) {
                sql += ` WHERE clergy_name LIKE ?`;
                params.push(`%${search}%`);
            }

            sql += ` GROUP BY clergy_name ORDER BY cnt DESC, clergy_name ASC LIMIT ?`;
            params.push(limit);

            try {
                const tenantPool = getTenantPool(churchId);
                const [rows] = await tenantPool.query(sql, params);

                for (const row of rows) {
                    const name = String(row.clergy_name || '').trim();
                    if (!name) continue;
                    const key = name.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    items.push({
                        value: name,
                        label: name,
                        count: row.cnt,
                        source: 'record',
                    });
                    if (items.length >= limit) break;
                }
            } catch (tenantErr) {
                console.warn('[Lookup] tenant clergy scan failed:', tenantErr.message);
            }
        }

        res.json({
            items: items.slice(0, limit),
            meta: {
                church_id: parseInt(churchId, 10),
                record_type: recordType || 'all',
                limit,
                total: Math.min(items.length, limit),
            }
        });
    } catch (error) {
        console.error('[Lookup] Error fetching clergy:', error);
        res.status(500).json({ error: error.message });
    }
});

// ───────────────────────────────────────────────────────────────
// GET /api/lookup/locations
// Prefers parish configuration canonical locations, then raw DISTINCT
// burial_location values from funeral_records.
// Query params:
//   church_id  (required)
//   types      (optional: Church,Cemetery,Other — comma-separated)
//   search     (optional)
//   limit      (optional)
// ───────────────────────────────────────────────────────────────

router.get('/locations', async (req, res) => {
    try {
        const churchId = req.query.church_id
            || req.session?.user?.church_id
            || req.user?.church_id;
        if (!churchId) {
            return res.status(400).json({ error: 'church_id is required (query param or session)' });
        }

        const search = (req.query.search || '').trim();
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
        const types = String(req.query.types || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);

        const items = [];
        const seen = new Set();

        try {
            let entitySql = `
                SELECT id, canonical_value, display_label, role, metadata_json
                FROM ocr_parish_configuration_entities
                WHERE church_id = ? AND entity_type = 'location' AND is_active = 1
            `;
            const entityParams = [churchId];
            if (search) {
                entitySql += ` AND (canonical_value LIKE ? OR display_label LIKE ?)`;
                entityParams.push(`%${search}%`, `%${search}%`);
            }
            entitySql += ` ORDER BY canonical_value ASC LIMIT ?`;
            entityParams.push(limit * 2);

            const [entityRows] = await getAppPool().query(entitySql, entityParams);
            for (const row of entityRows) {
                let meta = {};
                try {
                    meta = typeof row.metadata_json === 'string'
                        ? JSON.parse(row.metadata_json || '{}')
                        : (row.metadata_json || {});
                } catch (_) {}
                const locType = meta.location_type || row.role || 'Other';
                if (types.length && !types.includes(locType)) continue;
                const name = String(row.display_label || row.canonical_value || '').trim();
                const value = String(row.canonical_value || '').trim();
                if (!value) continue;
                const key = value.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                items.push({
                    value,
                    label: name || value,
                    count: meta.usage_count ?? null,
                    source: 'canonical',
                    location_type: locType,
                    entity_id: row.id,
                    tenant_default: !!meta.tenant_default,
                });
                if (items.length >= limit) break;
            }
        } catch (entityErr) {
            console.warn('[Lookup] location entities unavailable:', entityErr.message);
        }

        if (items.length < limit && (!types.length || types.includes('Cemetery') || types.includes('Other'))) {
            try {
                const tenantPool = getTenantPool(churchId);
                let sql = `
                    SELECT burial_location AS loc, COUNT(*) AS cnt
                    FROM funeral_records
                    WHERE church_id = ?
                      AND burial_location IS NOT NULL
                      AND TRIM(burial_location) != ''
                `;
                const params = [churchId];
                if (search) {
                    sql += ` AND burial_location LIKE ?`;
                    params.push(`%${search}%`);
                }
                sql += ` GROUP BY burial_location ORDER BY cnt DESC, loc ASC LIMIT ?`;
                params.push(limit);

                const [rows] = await tenantPool.query(sql, params);
                for (const row of rows) {
                    const name = String(row.loc || '').trim();
                    if (!name) continue;
                    const key = name.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    items.push({
                        value: name,
                        label: name,
                        count: row.cnt,
                        source: 'record',
                    });
                    if (items.length >= limit) break;
                }
            } catch (tenantErr) {
                console.warn('[Lookup] tenant burial_location scan failed:', tenantErr.message);
            }
        }

        res.json({
            items: items.slice(0, limit),
            meta: {
                church_id: parseInt(churchId, 10),
                types: types.length ? types : ['all'],
                limit,
                total: Math.min(items.length, limit),
            }
        });
    } catch (error) {
        console.error('[Lookup] Error fetching locations:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
