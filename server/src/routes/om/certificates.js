/**
 * /api/om/certificates — Certificate Studio for the om-platform (Minimal UI).
 *
 * Template scoping
 *   OM (global) templates  → orthodoxmetrics_db.certificate_studio_templates (church_id NULL), managed by super_admin/admin,
 *                            readable by every parish. Composite id "g:<id>".
 *   Parish templates       → om_church_##.certificate_studio_templates, managed by church_admin/priest/deacon
 *                            (and platform admins acting in that church). Composite id "c:<id>".
 *
 * Generation renders through the shared pdf-renderer, files the PDF in the parish File manager under
 * Documents › Certificates with a readable name ("Baptism Certificate — Name — YYYY-MM-DD.pdf"), and writes
 * orthodoxmetrics_db.certificate_studio_generation_history.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { promisePool, getTenantPool } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');
const { PAGE_SIZES, APPROVED_FONTS } = require('../../certificates/studio/constants');
const { SAMPLE_DATA, BINDING_MAP, resolveAllBindings } = require('../../certificates/studio/field-bindings');
const { loadChurchMeta, loadRecord, searchRecords } = require('../../certificates/studio/record-loader');
const { renderCertificatePdf } = require('../../certificates/studio/pdf-renderer');

const router = express.Router();

const PLATFORM_ROLES = ['super_admin', 'admin'];
const CHURCH_DESIGN_ROLES = ['church_admin', 'manager', 'priest', 'deacon'];
const CHURCH_GENERATE_ROLES = ['church_admin', 'manager', 'priest', 'deacon', 'editor'];
const CERT_TYPES = ['baptism', 'marriage', 'reception'];
const FILES_ROOT = path.resolve(__dirname, '../../../storage/files');
const CERT_STORAGE = path.resolve(__dirname, '../../../storage');

const getUserId = (req) => req.user?.id || req.session?.user?.id;
const parseJson = (v, fb = null) => { try { return v == null ? fb : (typeof v === 'string' ? JSON.parse(v) : v); } catch { return fb; } };

// ---------------------------------------------------------------------------
// context / scoping
// ---------------------------------------------------------------------------
async function actorOf(req, requestedChurchId) {
    const [[u]] = await promisePool.query(
        "SELECT id, role, church_id, email, first_name, last_name FROM orthodoxmetrics_db.users WHERE id = ? AND is_active = 1 AND account_status = 'active'", [getUserId(req)]);
    if (!u) throw Object.assign(new Error('Account is not active'), { status: 403 });
    const isPlatform = PLATFORM_ROLES.includes(u.role);
    const churchId = isPlatform ? Number(requestedChurchId || u.church_id) || null : u.church_id;
    if (!isPlatform && requestedChurchId && Number(requestedChurchId) !== u.church_id) throw Object.assign(new Error('Not your church'), { status: 403 });
    return {
        ...u, isPlatform, churchId,
        canDesignGlobal: isPlatform,
        canDesignParish: isPlatform || CHURCH_DESIGN_ROLES.includes(u.role),
        canGenerate: isPlatform || CHURCH_GENERATE_ROLES.includes(u.role),
    };
}
function parseTemplateId(id) {
    const m = /^([gc]):(\d+)$/.exec(String(id || ''));
    if (m) return { scope: m[1] === 'g' ? 'global' : 'church', id: Number(m[2]) };
    if (/^\d+$/.test(String(id))) return { scope: 'global', id: Number(id) }; // legacy numeric ids = global
    throw Object.assign(new Error('Invalid template id'), { status: 400 });
}
const poolFor = (scope, churchId) => {
    if (scope === 'global') return promisePool;
    if (!churchId) throw Object.assign(new Error('church_id is required'), { status: 400 });
    return getTenantPool(churchId);
};
const tbl = (scope, name) => (scope === 'global' ? `orthodoxmetrics_db.${name}` : name);

function shapeTemplate(row, scope, churchId) {
    return {
        id: `${scope === 'global' ? 'g' : 'c'}:${row.id}`,
        numericId: row.id,
        scope,
        church_id: scope === 'global' ? null : churchId,
        certificate_type: row.certificate_type,
        name: row.name, description: row.description, status: row.status, is_default: !!row.is_default,
        canvas_size: row.canvas_size, orientation: row.orientation, custom_width: row.custom_width, custom_height: row.custom_height,
        current_version_id: row.current_version_id, version_number: row.version_number ?? null,
        source_global_template_id: row.source_global_template_id ?? null,
        created_at: row.created_at, updated_at: row.updated_at, published_at: row.published_at ?? null,
        layout_json: row.layout_json !== undefined ? parseJson(row.layout_json, null) : undefined,
    };
}
async function loadTemplate(scope, id, churchId, { withVersion = true } = {}) {
    const pool = poolFor(scope, churchId);
    const [[t]] = await pool.query(`SELECT * FROM ${tbl(scope, 'certificate_studio_templates')} WHERE id = ?${scope === 'global' ? ' AND church_id IS NULL' : ''}`, [id]);
    if (!t) throw Object.assign(new Error('Template not found'), { status: 404 });
    let version = null;
    if (withVersion) {
        const [[v]] = t.current_version_id
            ? await pool.query(`SELECT * FROM ${tbl(scope, 'certificate_studio_template_versions')} WHERE id = ?`, [t.current_version_id])
            : await pool.query(`SELECT * FROM ${tbl(scope, 'certificate_studio_template_versions')} WHERE template_id = ? ORDER BY version_number DESC LIMIT 1`, [id]);
        version = v || null;
    }
    return { template: t, version, pool, shaped: shapeTemplate({ ...t, version_number: version?.version_number, published_at: version?.published_at, layout_json: version?.layout_json ?? null }, scope, churchId) };
}
function assertCanDesign(actor, scope) {
    if (scope === 'global' ? !actor.canDesignGlobal : !actor.canDesignParish) throw Object.assign(new Error(scope === 'global' ? 'Only platform administrators can edit Orthodox Metrics templates' : 'Only church administrators and clergy can edit parish templates'), { status: 403 });
}

function defaultLayout(pageW, pageH) {
    return { version: 2, margins: { top: 36, right: 36, bottom: 36, left: 36 }, bleed: 0, showGuides: true, layers: [{ id: 'background', type: 'background', name: 'Background', x: 0, y: 0, width: pageW, height: pageH, rotation: 0, opacity: 1, z_index: 0, locked: true, visible: true, style: { fill: '#f7f3eb' } }] };
}
function pageDims(t) {
    if (t.canvas_size === 'custom' && t.custom_width && t.custom_height) return { width: Number(t.custom_width), height: Number(t.custom_height) };
    const base = PAGE_SIZES[t.canvas_size] || PAGE_SIZES.letter;
    return t.orientation === 'landscape' ? { width: base.height, height: base.width } : base;
}
function validateLayout(layout) {
    if (!layout || !Array.isArray(layout.layers)) throw Object.assign(new Error('layout_json.layers must be an array'), { status: 400 });
    if (layout.layers.length > 200) throw Object.assign(new Error('Too many layers'), { status: 400 });
    for (const l of layout.layers) {
        if (!l.id || !['text', 'bound_field', 'image', 'background', 'shape', 'border'].includes(l.type)) throw Object.assign(new Error(`Invalid layer ${l.id || ''}`), { status: 400 });
        if (l.style?.font_family && !APPROVED_FONTS[l.style.font_family]) throw Object.assign(new Error(`Font not available in PDF output: ${l.style.font_family}`), { status: 400 });
        if (l.binding?.key && !BINDING_MAP[l.binding.key]) throw Object.assign(new Error(`Unknown field binding: ${l.binding.key}`), { status: 400 });
    }
    return { version: 2, margins: layout.margins || { top: 36, right: 36, bottom: 36, left: 36 }, bleed: Number(layout.bleed) || 0, showGuides: !!layout.showGuides, layers: layout.layers };
}

const assetResolver = async (assetId) => {
    const { resolveAssetPathById } = require('../../assets/omAssetsService');
    const { STORAGE_ROOT } = require('../../assets/omAssetsConstants');
    const abs = await resolveAssetPathById(promisePool, assetId);
    return abs ? path.relative(STORAGE_ROOT, abs).split(path.sep).join('/') : null;
};

const handle = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        console.error('[om/certificates]', err);
        res.status(500).json({ success: false, message: 'Certificate error' });
    }
};

// ---------------------------------------------------------------------------
// meta: bindings, fonts, page sizes, sample data
// ---------------------------------------------------------------------------
router.get('/meta', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req, req.query.church_id);
    const bindings = Object.entries(BINDING_MAP).map(([key, def]) => ({ key, label: def.label || key.split('.').pop().replace(/_/g, ' '), group: key.split('.')[0] }));
    // Split-date bindings (x.md / x.yy) need sample values — same formats as the renderer
    const { dateMD, dateYY } = require('../../certificates/studio/field-bindings');
    const sample = JSON.parse(JSON.stringify(SAMPLE_DATA));
    for (const key of Object.keys(BINDING_MAP)) {
        const m = /^(.*)\.(md|yy)$/.exec(key);
        if (!m) continue;
        const group = key.split('.')[0];
        const baseVal = sample[group]?.[m[1]];
        if (!baseVal || !sample[group]) continue;
        const v = m[2] === 'md' ? dateMD(baseVal) : dateYY(baseVal);
        if (v) sample[group][key] = v;
    }
    res.json({ success: true, certificateTypes: CERT_TYPES, fonts: Object.entries(APPROVED_FONTS).map(([k, v]) => ({ value: k, css: v.css, weight: v.weight || 'normal', style: v.style || 'normal' })), pageSizes: PAGE_SIZES, bindings, sample, canDesignGlobal: actor.canDesignGlobal, canDesignParish: actor.canDesignParish && !!actor.churchId, canGenerate: actor.canGenerate, churchId: actor.churchId });
}));

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------
router.get('/templates', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req, req.query.church_id);
    const type = CERT_TYPES.includes(req.query.type) ? req.query.type : null;
    const includeArchived = req.query.include_archived === '1';
    const where = (alias) => `${alias}${type ? ' AND certificate_type = ?' : ''}${includeArchived ? '' : " AND status <> 'archived'"}`;
    const [g] = await promisePool.query(`SELECT t.*, v.version_number, v.published_at, v.layout_json FROM orthodoxmetrics_db.certificate_studio_templates t LEFT JOIN orthodoxmetrics_db.certificate_studio_template_versions v ON v.id = t.current_version_id WHERE ${where('t.church_id IS NULL')} ORDER BY t.certificate_type, t.is_default DESC, t.name`, type ? [type] : []);
    let c = [];
    if (actor.churchId) {
        try { [c] = await getTenantPool(actor.churchId).query(`SELECT t.*, v.version_number, v.published_at, v.layout_json FROM certificate_studio_templates t LEFT JOIN certificate_studio_template_versions v ON v.id = t.current_version_id WHERE ${where('1=1')} ORDER BY t.certificate_type, t.is_default DESC, t.name`, type ? [type] : []); } catch (e) { console.warn('[om/certificates] tenant templates:', e.message); }
    }
    const withThumb = (r, scope, churchId) => {
        const layout = parseJson(r.layout_json, null);
        const bg = layout?.layers?.find((l) => l.type === 'background' && l.asset_id) || layout?.layers?.find((l) => l.type === 'image' && l.asset_id);
        const { layout_json, ...rest } = r;
        return { ...shapeTemplate(rest, scope, churchId), thumbnail_asset_id: bg?.asset_id || null, layer_count: layout?.layers?.length || 0 };
    };
    res.json({ success: true, churchId: actor.churchId, canDesignGlobal: actor.canDesignGlobal, canDesignParish: actor.canDesignParish && !!actor.churchId, templates: [...c.map((r) => withThumb(r, 'church', actor.churchId)), ...g.map((r) => withThumb(r, 'global', null))] });
}));

router.get('/templates/:id', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req, req.query.church_id);
    const { scope, id } = parseTemplateId(req.params.id);
    const { shaped, template } = await loadTemplate(scope, id, actor.churchId);
    const layout = shaped.layout_json || defaultLayout(pageDims(template).width, pageDims(template).height);
    // Hydrate asset URLs so the designer can draw the real artwork (legacy designer never did)
    for (const l of layout.layers) if (l.asset_id) l.asset_url = `/api/assets/${l.asset_id}/file`;
    res.json({ success: true, template: { ...shaped, layout_json: layout, page: pageDims(template) }, canEdit: scope === 'global' ? actor.canDesignGlobal : actor.canDesignParish });
}));

router.post('/templates', requireAuth, handle(async (req, res) => {
    const b = req.body || {};
    const scope = b.scope === 'global' ? 'global' : 'church';
    const actor = await actorOf(req, b.church_id);
    assertCanDesign(actor, scope);
    if (scope === 'church' && !actor.churchId) throw Object.assign(new Error('Select a church first'), { status: 400 });
    if (!CERT_TYPES.includes(b.certificate_type)) throw Object.assign(new Error('certificate_type must be baptism, marriage or reception'), { status: 400 });
    const pool = poolFor(scope, actor.churchId);
    const canvas = ['letter', 'a4', 'custom'].includes(b.canvas_size) ? b.canvas_size : 'letter';
    const orientation = b.orientation === 'landscape' ? 'landscape' : 'portrait';
    const cols = scope === 'global' ? '(church_id, certificate_type, name, description, status, is_default, canvas_size, orientation, custom_width, custom_height, created_by, updated_by)' : '(church_id, certificate_type, name, description, status, is_default, canvas_size, orientation, custom_width, custom_height, source_global_template_id, created_by, updated_by)';
    const vals = scope === 'global'
        ? [null, b.certificate_type, (b.name || 'Untitled template').trim(), b.description || null, 'draft', 0, canvas, orientation, b.custom_width || null, b.custom_height || null, actor.id, actor.id]
        : [actor.churchId, b.certificate_type, (b.name || 'Untitled template').trim(), b.description || null, 'draft', 0, canvas, orientation, b.custom_width || null, b.custom_height || null, b.source_global_template_id || null, actor.id, actor.id];
    const [r] = await pool.query(`INSERT INTO ${tbl(scope, 'certificate_studio_templates')} ${cols} VALUES (${vals.map(() => '?').join(',')})`, vals);
    const dims = pageDims({ canvas_size: canvas, orientation, custom_width: b.custom_width, custom_height: b.custom_height });
    const layout = b.layout_json ? validateLayout(b.layout_json) : defaultLayout(dims.width, dims.height);
    const [v] = await pool.query(`INSERT INTO ${tbl(scope, 'certificate_studio_template_versions')} (template_id, version_number, layout_json, created_by) VALUES (?, 1, ?, ?)`, [r.insertId, JSON.stringify(layout), actor.id]);
    await pool.query(`UPDATE ${tbl(scope, 'certificate_studio_templates')} SET current_version_id = ? WHERE id = ?`, [v.insertId, r.insertId]);
    const { shaped } = await loadTemplate(scope, r.insertId, actor.churchId);
    res.json({ success: true, template: shaped });
}));

/** Save: metadata + a new layout version (draft stays draft; an active template gets its live version replaced). */
router.put('/templates/:id', requireAuth, handle(async (req, res) => {
    const b = req.body || {};
    const actor = await actorOf(req, b.church_id || req.query.church_id);
    const { scope, id } = parseTemplateId(req.params.id);
    assertCanDesign(actor, scope);
    const { template, version, pool } = await loadTemplate(scope, id, actor.churchId);
    const sets = []; const vals = [];
    for (const [k, col] of [['name', 'name'], ['description', 'description'], ['canvas_size', 'canvas_size'], ['orientation', 'orientation'], ['custom_width', 'custom_width'], ['custom_height', 'custom_height'], ['certificate_type', 'certificate_type']]) {
        if (b[k] !== undefined) { sets.push(`${col} = ?`); vals.push(b[k] === '' ? null : b[k]); }
    }
    if (b.layout_json) {
        const layout = validateLayout(b.layout_json);
        for (const l of layout.layers) delete l.asset_url;
        const [v] = await pool.query(`INSERT INTO ${tbl(scope, 'certificate_studio_template_versions')} (template_id, version_number, layout_json, created_by, published_at) VALUES (?, ?, ?, ?, ?)`,
            [id, (version?.version_number || 0) + 1, JSON.stringify(layout), actor.id, template.status === 'active' ? new Date() : null]);
        sets.push('current_version_id = ?'); vals.push(v.insertId);
    }
    if (sets.length) { sets.push('updated_by = ?'); vals.push(actor.id); vals.push(id); await pool.query(`UPDATE ${tbl(scope, 'certificate_studio_templates')} SET ${sets.join(', ')} WHERE id = ?`, vals); }
    const { shaped } = await loadTemplate(scope, id, actor.churchId);
    res.json({ success: true, template: shaped });
}));

router.post('/templates/:id/publish', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req, req.body?.church_id);
    const { scope, id } = parseTemplateId(req.params.id);
    assertCanDesign(actor, scope);
    const { template, version, pool } = await loadTemplate(scope, id, actor.churchId);
    const layout = parseJson(version?.layout_json, { layers: [] });
    if (!layout.layers.some((l) => l.type === 'bound_field')) throw Object.assign(new Error('Add at least one record field before publishing'), { status: 400 });
    await pool.query(`UPDATE ${tbl(scope, 'certificate_studio_templates')} SET status = 'active', updated_by = ? WHERE id = ?`, [actor.id, id]);
    if (version) await pool.query(`UPDATE ${tbl(scope, 'certificate_studio_template_versions')} SET published_at = NOW() WHERE id = ?`, [version.id]);
    if (req.body?.make_default) {
        await pool.query(`UPDATE ${tbl(scope, 'certificate_studio_templates')} SET is_default = 0 WHERE certificate_type = ?${scope === 'global' ? ' AND church_id IS NULL' : ''}`, [template.certificate_type]);
        await pool.query(`UPDATE ${tbl(scope, 'certificate_studio_templates')} SET is_default = 1 WHERE id = ?`, [id]);
    }
    res.json({ success: true, template: (await loadTemplate(scope, id, actor.churchId)).shaped });
}));

router.post('/templates/:id/archive', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req, req.body?.church_id);
    const { scope, id } = parseTemplateId(req.params.id);
    assertCanDesign(actor, scope);
    const { pool } = await loadTemplate(scope, id, actor.churchId, { withVersion: false });
    await pool.query(`UPDATE ${tbl(scope, 'certificate_studio_templates')} SET status = 'archived', is_default = 0, updated_by = ? WHERE id = ?`, [actor.id, id]);
    res.json({ success: true });
}));

router.post('/templates/:id/default', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req, req.body?.church_id);
    const { scope, id } = parseTemplateId(req.params.id);
    assertCanDesign(actor, scope);
    const { template, pool } = await loadTemplate(scope, id, actor.churchId, { withVersion: false });
    await pool.query(`UPDATE ${tbl(scope, 'certificate_studio_templates')} SET is_default = 0 WHERE certificate_type = ?${scope === 'global' ? ' AND church_id IS NULL' : ''}`, [template.certificate_type]);
    await pool.query(`UPDATE ${tbl(scope, 'certificate_studio_templates')} SET is_default = 1, updated_by = ? WHERE id = ?`, [actor.id, id]);
    res.json({ success: true });
}));

/** Duplicate: OM template → parish copy (church users) or same-scope copy (platform admins). */
router.post('/templates/:id/duplicate', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req, req.body?.church_id);
    const { scope, id } = parseTemplateId(req.params.id);
    const src = await loadTemplate(scope, id, actor.churchId);
    const targetScope = req.body?.scope === 'global' && actor.canDesignGlobal ? 'global' : 'church';
    assertCanDesign(actor, targetScope);
    if (targetScope === 'church' && !actor.churchId) throw Object.assign(new Error('Select a church first'), { status: 400 });
    const pool = poolFor(targetScope, actor.churchId);
    const t = src.template;
    const name = (req.body?.name || `${t.name} (copy)`).trim();
    const cols = targetScope === 'global' ? '(church_id, certificate_type, name, description, status, is_default, canvas_size, orientation, custom_width, custom_height, created_by, updated_by)' : '(church_id, certificate_type, name, description, status, is_default, canvas_size, orientation, custom_width, custom_height, source_global_template_id, created_by, updated_by)';
    const vals = targetScope === 'global'
        ? [null, t.certificate_type, name, t.description, 'draft', 0, t.canvas_size, t.orientation, t.custom_width, t.custom_height, actor.id, actor.id]
        : [actor.churchId, t.certificate_type, name, t.description, 'draft', 0, t.canvas_size, t.orientation, t.custom_width, t.custom_height, scope === 'global' ? id : (t.source_global_template_id || null), actor.id, actor.id];
    const [r] = await pool.query(`INSERT INTO ${tbl(targetScope, 'certificate_studio_templates')} ${cols} VALUES (${vals.map(() => '?').join(',')})`, vals);
    const [v] = await pool.query(`INSERT INTO ${tbl(targetScope, 'certificate_studio_template_versions')} (template_id, version_number, layout_json, created_by) VALUES (?, 1, ?, ?)`, [r.insertId, src.version?.layout_json || JSON.stringify(defaultLayout(612, 792)), actor.id]);
    await pool.query(`UPDATE ${tbl(targetScope, 'certificate_studio_templates')} SET current_version_id = ? WHERE id = ?`, [v.insertId, r.insertId]);
    res.json({ success: true, template: (await loadTemplate(targetScope, r.insertId, actor.churchId)).shaped });
}));

router.delete('/templates/:id', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req, req.query.church_id);
    const { scope, id } = parseTemplateId(req.params.id);
    assertCanDesign(actor, scope);
    const { template, pool } = await loadTemplate(scope, id, actor.churchId, { withVersion: false });
    if (template.status === 'active') throw Object.assign(new Error('Archive an active template instead of deleting it'), { status: 400 });
    await pool.query(`DELETE FROM ${tbl(scope, 'certificate_studio_template_versions')} WHERE template_id = ?`, [id]);
    await pool.query(`DELETE FROM ${tbl(scope, 'certificate_studio_templates')} WHERE id = ?`, [id]);
    res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// records for the generator
// ---------------------------------------------------------------------------
router.get('/records/:type', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req, req.query.church_id);
    if (!actor.churchId) throw Object.assign(new Error('church_id is required'), { status: 400 });
    if (!CERT_TYPES.includes(req.params.type)) throw Object.assign(new Error('Unknown certificate type'), { status: 400 });
    const records = await searchRecords(req.params.type, actor.churchId, { search: req.query.search || '', limit: Math.min(50, Number(req.query.limit) || 25), recordId: req.query.record_id || null });
    res.json({ success: true, records });
}));

// ---------------------------------------------------------------------------
// preview + generate
// ---------------------------------------------------------------------------
async function renderFor({ actor, templateId, recordId, useSample, layoutOverride }) {
    const { scope, id } = parseTemplateId(templateId);
    const { template, version } = await loadTemplate(scope, id, actor.churchId);
    const certType = template.certificate_type;
    const church = actor.churchId ? (await loadChurchMeta(actor.churchId)) || {} : {};
    let record = {};
    if (!useSample && recordId) {
        if (!actor.churchId) throw Object.assign(new Error('church_id is required'), { status: 400 });
        record = await loadRecord(certType, recordId, actor.churchId);
        if (!record) throw Object.assign(new Error('Record not found'), { status: 404 });
    }
    const bindingValues = resolveAllBindings(certType, record, church, !!useSample || !recordId);
    const v = layoutOverride ? { ...(version || {}), layout_json: JSON.stringify(validateLayout(layoutOverride)) } : version;
    if (!v) throw Object.assign(new Error('Template has no layout yet'), { status: 400 });
    const pdfBytes = await renderCertificatePdf({ template, version: v, bindingValues, assetResolver });
    return { pdfBytes, template, version: v, record, certType, bindingValues, scope, id };
}

router.post('/preview', requireAuth, handle(async (req, res) => {
    const b = req.body || {};
    const actor = await actorOf(req, b.church_id);
    if (!actor.canGenerate && !actor.canDesignParish) throw Object.assign(new Error('Not permitted'), { status: 403 });
    const { pdfBytes } = await renderFor({ actor, templateId: b.template_id, recordId: b.record_id, useSample: !!b.use_sample_data || !b.record_id, layoutOverride: b.layout_json || null });
    res.json({ success: true, pdf_base64: Buffer.from(pdfBytes).toString('base64') });
}));

const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const typeLabel = { baptism: 'Baptism', marriage: 'Marriage', reception: 'Reception' };

/** Person / couple + sacrament date for the filename, from the resolved bindings. */
function fileNameParts(certType, bindingValues, record) {
    const bv = bindingValues || {};
    const name = certType === 'marriage'
        ? [bv['marriage.groom_name'], bv['marriage.bride_name']].filter(Boolean).join(' & ')
        : certType === 'reception' ? bv['reception.person_name'] : bv['baptism.full_name'] || [bv['baptism.first_name'], bv['baptism.last_name']].filter(Boolean).join(' ');
    const rawDate = record?.reception_date || record?.mdate || record?.baptism_date || record?.marriage_date || record?.date || null;
    const d = rawDate ? new Date(rawDate) : null;
    const iso = d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
    return { name: safeName(name) || `Record ${record?.id ?? ''}`.trim(), date: iso };
}

/** Ensure Documents › Certificates exists in the tenant file manager; returns folder id. */
async function certificatesFolder(pool, churchId, userId) {
    const [[docs]] = await pool.query("SELECT id FROM fm_folders WHERE system_key = 'documents' AND deleted_at IS NULL LIMIT 1");
    let docsId = docs?.id;
    if (!docsId) { const [r] = await pool.query("INSERT INTO fm_folders (church_id, parent_id, name, system_key, created_by) VALUES (?, NULL, 'Documents', 'documents', ?)", [churchId, userId]); docsId = r.insertId; }
    const [[cert]] = await pool.query("SELECT id FROM fm_folders WHERE parent_id = ? AND name = 'Certificates' AND deleted_at IS NULL LIMIT 1", [docsId]);
    if (cert) return cert.id;
    const [r] = await pool.query("INSERT INTO fm_folders (church_id, parent_id, name, created_by) VALUES (?, ?, 'Certificates', ?)", [churchId, docsId, userId]);
    return r.insertId;
}

router.post('/generate', requireAuth, handle(async (req, res) => {
    const b = req.body || {};
    const actor = await actorOf(req, b.church_id);
    if (!actor.canGenerate) throw Object.assign(new Error('Not permitted to generate certificates'), { status: 403 });
    if (!actor.churchId) throw Object.assign(new Error('church_id is required'), { status: 400 });
    if (!b.record_id) throw Object.assign(new Error('record_id is required'), { status: 400 });
    const { pdfBytes, template, version, record, certType, bindingValues, scope, id } = await renderFor({ actor, templateId: b.template_id, recordId: b.record_id, useSample: false });
    if (template.status !== 'active' && !b.allow_draft) throw Object.assign(new Error('This template is a draft — publish it (or preview) before generating official certificates'), { status: 400 });

    // 1. file in the parish File manager: Documents › Certificates / "Baptism Certificate — Name — YYYY-MM-DD.pdf"
    const pool = getTenantPool(actor.churchId);
    const folderId = await certificatesFolder(pool, actor.churchId, actor.id);
    const parts = fileNameParts(certType, bindingValues, record);
    const base = `${typeLabel[certType]} Certificate — ${parts.name}${parts.date ? ` — ${parts.date}` : ''}`;
    const [existing] = await pool.query('SELECT name FROM fm_files WHERE folder_id = ? AND deleted_at IS NULL AND name LIKE ?', [folderId, `${base}%`]);
    const taken = new Set(existing.map((r) => r.name));
    let fileName = `${base}.pdf`; let n = 2;
    while (taken.has(fileName)) fileName = `${base} (${n++}).pdf`;
    const dir = path.join(FILES_ROOT, `church_${actor.churchId}`);
    fs.mkdirSync(dir, { recursive: true });
    const stored = `${Date.now()}-cert-${certType}-${record.id}`;
    const abs = path.join(dir, stored);
    fs.writeFileSync(abs, pdfBytes);
    const [f] = await pool.query(
        `INSERT INTO fm_files (church_id, folder_id, name, original_name, stored_name, storage_path, mime_type, ext, size_bytes, category, uploaded_by, tags)
         VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', 'pdf', ?, 'document', ?, ?)`,
        [actor.churchId, folderId, fileName, fileName, stored, abs, pdfBytes.length, actor.id, JSON.stringify(['certificate', certType])]);
    await pool.query('INSERT INTO fm_activity (church_id, item_type, item_id, item_name, category, action, size_delta, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [actor.churchId, 'file', f.insertId, fileName, 'document', 'upload', pdfBytes.length, actor.id]).catch(() => {});

    // 2. generation history (orthodoxmetrics_db) — also keep a copy under storage/certificates/studio/generated for legacy downloads
    const genDir = path.join(CERT_STORAGE, 'certificates/studio/generated', String(actor.churchId));
    fs.mkdirSync(genDir, { recursive: true });
    const genPath = path.join(genDir, `${stored}.pdf`);
    fs.writeFileSync(genPath, pdfBytes);
    const [h] = await promisePool.query(
        `INSERT INTO orthodoxmetrics_db.certificate_studio_generation_history (church_id, certificate_type, record_id, template_id, template_scope, church_template_id, template_version_id, generated_pdf_path, record_snapshot_json, generated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [actor.churchId, certType, record.id, scope === 'global' ? id : null, scope, scope === 'church' ? id : null, version.id || null, path.relative(CERT_STORAGE, genPath), JSON.stringify({ template: `${scope}:${id}`, template_name: template.name, bindings: bindingValues, file_id: f.insertId, file_name: fileName }), actor.id]);

    res.json({ success: true, history_id: h.insertId, file: { id: f.insertId, name: fileName, folder_id: folderId, download_url: `/api/om/files/download/${actor.churchId}/${f.insertId}` }, template: { id: `${scope === 'global' ? 'g' : 'c'}:${id}`, name: template.name } });
}));

router.get('/history', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req, req.query.church_id);
    if (!actor.churchId) return res.json({ success: true, history: [], total: 0 });
    const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(50, Number(req.query.limit) || 6);
    const type = CERT_TYPES.includes(req.query.type) ? req.query.type : null;
    const where = `h.church_id = ?${type ? ' AND h.certificate_type = ?' : ''}`; const params = type ? [actor.churchId, type] : [actor.churchId];
    const [[{ total }]] = await promisePool.query(`SELECT COUNT(*) total FROM orthodoxmetrics_db.certificate_studio_generation_history h WHERE ${where}`, params);
    const [rows] = await promisePool.query(`SELECT h.*, u.first_name, u.last_name FROM orthodoxmetrics_db.certificate_studio_generation_history h LEFT JOIN orthodoxmetrics_db.users u ON u.id = h.generated_by WHERE ${where} ORDER BY h.generated_at DESC, h.id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
    res.json({ success: true, total, page, limit, history: rows.map((r) => { const snap = parseJson(r.record_snapshot_json, {}); return { id: r.id, certificate_type: r.certificate_type, record_id: r.record_id, template_name: snap.template_name || (r.template_id ? `Template ${r.template_id}` : 'Template'), file_id: snap.file_id || null, file_name: snap.file_name || null, person: snap.bindings?.['baptism.full_name'] || (snap.bindings?.['marriage.groom_name'] ? `${snap.bindings['marriage.groom_name']} & ${snap.bindings['marriage.bride_name'] || ''}` : snap.bindings?.['reception.person_name']) || null, generated_at: r.generated_at, generated_by: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, download_url: snap.file_id ? `/api/om/files/download/${actor.churchId}/${snap.file_id}` : `/api/om/certificates/history/${r.id}/download${actor.isPlatform ? `?church_id=${actor.churchId}` : ''}` }; }) });
}));

router.get('/history/:id/download', requireAuth, handle(async (req, res) => {
    const actor = await actorOf(req, req.query.church_id);
    const [[h]] = await promisePool.query('SELECT * FROM orthodoxmetrics_db.certificate_studio_generation_history WHERE id = ?', [Number(req.params.id)]);
    if (!h || (h.church_id !== actor.churchId && !actor.isPlatform)) throw Object.assign(new Error('Not found'), { status: 404 });
    const abs = path.isAbsolute(h.generated_pdf_path) ? h.generated_pdf_path : path.join(CERT_STORAGE, h.generated_pdf_path);
    if (!fs.existsSync(abs)) throw Object.assign(new Error('File missing'), { status: 404 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${typeLabel[h.certificate_type] || 'Certificate'} ${h.record_id}.pdf"`);
    res.sendFile(abs);
}));

module.exports = router;
