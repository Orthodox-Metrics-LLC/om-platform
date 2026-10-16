/**
 * Certificate Studio API — /api/certificates/*
 * Parish-facing custom certificate design, preview, and PDF generation.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getAppPool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  CERTIFICATE_TYPES,
  TEMPLATE_MGMT_ROLES,
  TEMPLATE_GENERATE_ROLES,
  ASSETS_DIR,
  GENERATED_DIR,
  defaultLayoutJson,
  resolvePageDimensions,
} = require('../certificates/studio/constants');
const {
  resolveAllBindings,
  validateRequiredFields,
  checkOverflowWarnings,
} = require('../certificates/studio/field-bindings');
const { loadChurchMeta, loadRecord, searchRecords } = require('../certificates/studio/record-loader');
const { renderCertificatePdf } = require('../certificates/studio/pdf-renderer');

const ADMIN_ROLES = ['super_admin', 'admin'];

function getChurchId(req) {
  const cid = Number(req.user?.church_id);
  if (Number.isFinite(cid) && cid > 0) return cid;
  const q = Number(
    req.query.church_id || req.query.churchId
    || req.body?.church_id || req.body?.churchId,
  );
  if (Number.isFinite(q) && q > 0 && ADMIN_ROLES.includes(req.user?.role)) return q;
  return null;
}

function assertChurchAccess(req, res, churchId) {
  if (!churchId) {
    res.status(400).json({ error: 'No church context' });
    return false;
  }
  const role = req.user?.role;
  if (ADMIN_ROLES.includes(role)) return true;
  if (Number(req.user?.church_id) === churchId) return true;
  res.status(403).json({ error: 'Access denied for this church' });
  return false;
}

function canManageTemplates(req) {
  return TEMPLATE_MGMT_ROLES.includes(req.user?.role) || ADMIN_ROLES.includes(req.user?.role);
}

function canGenerate(req) {
  return TEMPLATE_GENERATE_ROLES.includes(req.user?.role) || ADMIN_ROLES.includes(req.user?.role);
}

function ensureDirs() {
  [ASSETS_DIR, GENERATED_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

ensureDirs();

async function getTemplateWithVersion(pool, templateId, versionId = null) {
  const [tplRows] = await pool.query(
    `SELECT t.*, v.id AS version_id, v.version_number, v.layout_json, v.asset_manifest_json,
            v.font_manifest_json, v.field_bindings_json, v.published_at
     FROM certificate_studio_templates t
     LEFT JOIN certificate_studio_template_versions v
       ON v.id = COALESCE(?, t.current_version_id)
     WHERE t.id = ?`,
    [versionId, templateId],
  );
  const tpl = tplRows[0] || null;
  if (!tpl) return null;

  // Repair templates missing current_version_id (empty layout → blank certificate)
  if (!versionId && !tpl.layout_json) {
    const [latest] = await pool.query(
      `SELECT id FROM certificate_studio_template_versions
       WHERE template_id = ? ORDER BY version_number DESC LIMIT 1`,
      [templateId],
    );
    if (latest[0]?.id) {
      await pool.query(
        'UPDATE certificate_studio_templates SET current_version_id = ? WHERE id = ? AND current_version_id IS NULL',
        [latest[0].id, templateId],
      );
      return getTemplateWithVersion(pool, templateId, latest[0].id);
    }
  }

  return tpl;
}

async function assetResolver(pool, assetId) {
  const { resolveAssetPathById } = require('../assets/omAssetsService');
  const { STORAGE_ROOT } = require('../assets/omAssetsConstants');
  const abs = await resolveAssetPathById(pool, assetId);
  if (!abs) return null;
  const path = require('path');
  return path.relative(STORAGE_ROOT, abs).split(path.sep).join('/');
}

/* ═══ Templates ═══ */

router.get('/templates', requireAuth, async (req, res) => {
  try {
    const pool = getAppPool();
    const churchId = getChurchId(req);
    const { certificate_type, status, include_global } = req.query;

    let query = `SELECT t.*, v.version_number, v.published_at,
      CASE WHEN t.church_id IS NULL THEN 'global' ELSE 'parish' END AS scope_label
      FROM certificate_studio_templates t
      LEFT JOIN certificate_studio_template_versions v ON v.id = t.current_version_id
      WHERE 1=1`;
    const params = [];

    if (certificate_type) {
      query += ' AND t.certificate_type = ?';
      params.push(certificate_type);
    }
    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }

    if (churchId) {
      query += ' AND (t.church_id = ? OR (t.church_id IS NULL AND ? = 1))';
      params.push(churchId, include_global !== '0' ? 1 : 0);
    } else if (!ADMIN_ROLES.includes(req.user?.role)) {
      return res.status(400).json({ error: 'No church context' });
    }

    query += ' ORDER BY t.certificate_type, t.is_default DESC, t.name';
    const [rows] = await pool.query(query, params);
    res.json({ templates: rows });
  } catch (err) {
    console.error('[certificate-studio] GET /templates:', err.message);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

router.post('/templates', requireAuth, requireRole(TEMPLATE_MGMT_ROLES), async (req, res) => {
  try {
    if (!canManageTemplates(req)) return res.status(403).json({ error: 'Insufficient permissions' });

    const pool = getAppPool();
    const churchId = getChurchId(req);
    const {
      certificate_type, name, description, canvas_size, orientation,
      custom_width, custom_height, layout_json,
    } = req.body;

    if (!CERTIFICATE_TYPES.has(certificate_type)) {
      return res.status(400).json({ error: 'Invalid certificate_type' });
    }
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    if (churchId && !assertChurchAccess(req, res, churchId)) return;

    const layout = layout_json || defaultLayoutJson();
    const userId = req.user?.id;

    const [result] = await pool.query(
      `INSERT INTO certificate_studio_templates
       (church_id, certificate_type, name, description, status, canvas_size, orientation,
        custom_width, custom_height, created_by, updated_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      [
        churchId, certificate_type, name.trim(), description || null,
        canvas_size || 'letter', orientation || 'landscape',
        custom_width || null, custom_height || null, userId, userId,
      ],
    );

    const templateId = result.insertId;
    const [verResult] = await pool.query(
      `INSERT INTO certificate_studio_template_versions
       (template_id, version_number, layout_json, created_by)
       VALUES (?, 1, ?, ?)`,
      [templateId, JSON.stringify(layout), userId],
    );

    await pool.query(
      'UPDATE certificate_studio_templates SET current_version_id = ? WHERE id = ?',
      [verResult.insertId, templateId],
    );

    const tpl = await getTemplateWithVersion(pool, templateId);
    res.status(201).json({ template: tpl });
  } catch (err) {
    console.error('[certificate-studio] POST /templates:', err.message);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

router.get('/templates/:id', requireAuth, async (req, res) => {
  try {
    const pool = getAppPool();
    const tpl = await getTemplateWithVersion(pool, req.params.id, req.query.version_id || null);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const churchId = tpl.church_id;
    if (churchId && !assertChurchAccess(req, res, churchId)) return;
    if (!churchId && !ADMIN_ROLES.includes(req.user?.role) && !canGenerate(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [versions] = await pool.query(
      'SELECT id, version_number, published_at, created_at FROM certificate_studio_template_versions WHERE template_id = ? ORDER BY version_number DESC',
      [req.params.id],
    );

    res.json({ template: tpl, versions });
  } catch (err) {
    console.error('[certificate-studio] GET /templates/:id:', err.message);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

router.put('/templates/:id', requireAuth, requireRole(TEMPLATE_MGMT_ROLES), async (req, res) => {
  try {
    if (!canManageTemplates(req)) return res.status(403).json({ error: 'Insufficient permissions' });

    const pool = getAppPool();
    const tpl = await getTemplateWithVersion(pool, req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (tpl.church_id && !assertChurchAccess(req, res, tpl.church_id)) return;
    if (!tpl.church_id && !ADMIN_ROLES.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Only admins can edit global templates' });
    }

    const {
      name, description, canvas_size, orientation, custom_width, custom_height,
      layout_json, save_new_version,
    } = req.body;
    const userId = req.user?.id;
    const updates = [];
    const params = [];

    if (name != null) { updates.push('name = ?'); params.push(name.trim()); }
    if (description != null) { updates.push('description = ?'); params.push(description); }
    if (canvas_size != null) { updates.push('canvas_size = ?'); params.push(canvas_size); }
    if (orientation != null) { updates.push('orientation = ?'); params.push(orientation); }
    if (custom_width != null) { updates.push('custom_width = ?'); params.push(custom_width); }
    if (custom_height != null) { updates.push('custom_height = ?'); params.push(custom_height); }
    updates.push('updated_by = ?');
    params.push(userId);

    if (updates.length) {
      params.push(req.params.id);
      await pool.query(`UPDATE certificate_studio_templates SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    if (layout_json) {
      if (save_new_version) {
        const [maxVer] = await pool.query(
          'SELECT COALESCE(MAX(version_number), 0) AS mv FROM certificate_studio_template_versions WHERE template_id = ?',
          [req.params.id],
        );
        const nextVer = maxVer[0].mv + 1;
        const [verResult] = await pool.query(
          `INSERT INTO certificate_studio_template_versions
           (template_id, version_number, layout_json, created_by)
           VALUES (?, ?, ?, ?)`,
          [req.params.id, nextVer, JSON.stringify(layout_json), userId],
        );
        await pool.query(
          'UPDATE certificate_studio_templates SET current_version_id = ? WHERE id = ?',
          [verResult.insertId, req.params.id],
        );
      } else if (tpl.version_id) {
        await pool.query(
          'UPDATE certificate_studio_template_versions SET layout_json = ? WHERE id = ?',
          [JSON.stringify(layout_json), tpl.version_id],
        );
      }
    }

    const updated = await getTemplateWithVersion(pool, req.params.id);
    res.json({ template: updated });
  } catch (err) {
    console.error('[certificate-studio] PUT /templates/:id:', err.message);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

router.post('/templates/:id/duplicate', requireAuth, requireRole(TEMPLATE_MGMT_ROLES), async (req, res) => {
  try {
    const pool = getAppPool();
    const src = await getTemplateWithVersion(pool, req.params.id);
    if (!src) return res.status(404).json({ error: 'Template not found' });

    const churchId = getChurchId(req);
    if (!churchId) return res.status(400).json({ error: 'No church context' });
    if (!assertChurchAccess(req, res, churchId)) return;

    const userId = req.user?.id;
    const [result] = await pool.query(
      `INSERT INTO certificate_studio_templates
       (church_id, certificate_type, name, description, status, canvas_size, orientation,
        custom_width, custom_height, created_by, updated_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      [
        churchId, src.certificate_type, `${src.name} (Copy)`, src.description,
        src.canvas_size, src.orientation, src.custom_width, src.custom_height, userId, userId,
      ],
    );

    const [verResult] = await pool.query(
      `INSERT INTO certificate_studio_template_versions
       (template_id, version_number, layout_json, asset_manifest_json, font_manifest_json, created_by)
       VALUES (?, 1, ?, ?, ?, ?)`,
      [result.insertId, src.layout_json, src.asset_manifest_json, src.font_manifest_json, userId],
    );

    await pool.query(
      'UPDATE certificate_studio_templates SET current_version_id = ? WHERE id = ?',
      [verResult.insertId, result.insertId],
    );

    const tpl = await getTemplateWithVersion(pool, result.insertId);
    res.status(201).json({ template: tpl });
  } catch (err) {
    console.error('[certificate-studio] POST duplicate:', err.message);
    res.status(500).json({ error: 'Failed to duplicate template' });
  }
});

router.post('/templates/:id/publish', requireAuth, requireRole(TEMPLATE_MGMT_ROLES), async (req, res) => {
  try {
    const pool = getAppPool();
    const tpl = await getTemplateWithVersion(pool, req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (tpl.church_id && !assertChurchAccess(req, res, tpl.church_id)) return;

    const { set_default } = req.body;
    await pool.query(
      `UPDATE certificate_studio_templates SET status = 'active', updated_by = ? WHERE id = ?`,
      [req.user?.id, req.params.id],
    );
    await pool.query(
      `UPDATE certificate_studio_template_versions SET published_at = NOW() WHERE id = ?`,
      [tpl.version_id],
    );

    if (set_default) {
      await pool.query(
        `UPDATE certificate_studio_templates SET is_default = FALSE
         WHERE certificate_type = ? AND church_id <=> ? AND id != ?`,
        [tpl.certificate_type, tpl.church_id, req.params.id],
      );
      await pool.query(
        'UPDATE certificate_studio_templates SET is_default = TRUE WHERE id = ?',
        [req.params.id],
      );
    }

    const updated = await getTemplateWithVersion(pool, req.params.id);
    res.json({ template: updated });
  } catch (err) {
    console.error('[certificate-studio] POST publish:', err.message);
    res.status(500).json({ error: 'Failed to publish template' });
  }
});

router.post('/templates/:id/archive', requireAuth, requireRole(TEMPLATE_MGMT_ROLES), async (req, res) => {
  try {
    const pool = getAppPool();
    const tpl = await getTemplateWithVersion(pool, req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (tpl.church_id && !assertChurchAccess(req, res, tpl.church_id)) return;

    await pool.query(
      `UPDATE certificate_studio_templates SET status = 'archived', is_default = FALSE, updated_by = ? WHERE id = ?`,
      [req.user?.id, req.params.id],
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[certificate-studio] POST archive:', err.message);
    res.status(500).json({ error: 'Failed to archive template' });
  }
});

/* ═══ Assets (compat — delegates to om_assets /api/assets) ═══ */

const {
  listAssets: omListAssets,
  getAssetById: omGetAssetById,
  createAssetRecord: omCreateAssetRecord,
  updateAssetRecord: omUpdateAssetRecord,
  archiveAsset: omArchiveAsset,
  serializeAsset: omSerializeAsset,
  toRelativeStoragePath: omToRelativePath,
  hashFileBuffer: omHashFileBuffer,
  scopeStorageDir: omScopeStorageDir,
} = require('../assets/omAssetsService');
const {
  canWriteAsset: omCanWriteAsset,
  canCreateScope: omCanCreateScope,
  userChurchId: omUserChurchId,
} = require('../assets/omAssetsPermissions');
const { ALLOWED_EXTENSIONS: OM_EXT } = require('../assets/omAssetsConstants');

router.get('/assets', requireAuth, async (req, res) => {
  try {
    const assets = await omListAssets(req, {
      category: req.query.category,
      scope: req.query.scope,
      church_id: req.query.church_id,
      search: req.query.search,
      limit: req.query.limit,
    });
    res.json({ assets });
  } catch (err) {
    console.error('[certificate-studio] GET /assets:', err.message);
    res.status(500).json({ error: 'Failed to list assets' });
  }
});

const assetUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        const scope = req.body.scope === 'church' ? 'church' : 'public';
        let churchId = Number(req.body.church_id) || omUserChurchId(req);
        if (scope === 'public') churchId = null;
        const dir = omScopeStorageDir(scope, churchId);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) {
        cb(e);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, OM_EXT.test(file.originalname));
  },
}).single('file');

router.post('/assets', requireAuth, requireRole(TEMPLATE_MGMT_ROLES), (req, res) => {
  assetUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const churchId = getChurchId(req) || omUserChurchId(req);
      const scope = churchId && !isPlatformAdmin(req) ? 'church' : (req.body.scope || 'public');
      const targetChurchId = scope === 'church' ? churchId : null;
      if (!canCreateScopeCompat(req, scope, targetChurchId)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const { name, category, licensing_note } = req.body;
      if (!name || !category) return res.status(400).json({ error: 'name and category required' });

      const relPath = req.file ? omToRelativePath(req.file.path) : null;
      const asset = await omCreateAssetRecord({
        name,
        scope,
        church_id: targetChurchId,
        category,
        file_path: relPath,
        file_type: req.file?.mimetype,
        licensing_note: licensing_note || null,
        sha256: req.file ? omHashFileBuffer(fs.readFileSync(req.file.path)) : null,
        uploaded_by: req.user?.id,
        legacy_source: 'certificate_studio_upload',
      });
      res.status(201).json({ asset: omSerializeAsset(asset) });
    } catch (e) {
      console.error('[certificate-studio] POST /assets:', e.message);
      res.status(500).json({ error: 'Failed to upload asset' });
    }
  });
});

function isPlatformAdmin(req) {
  return ['super_admin', 'admin'].includes(req.user?.role);
}

function canCreateScopeCompat(req, scope, churchId) {
  return omCanCreateScope(req, scope, churchId);
}

router.put('/assets/:id', requireAuth, requireRole(TEMPLATE_MGMT_ROLES), async (req, res) => {
  try {
    const asset = await omGetAssetById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!omCanWriteAsset(req, asset)) return res.status(403).json({ error: 'Access denied' });

    const updated = await omUpdateAssetRecord(req.params.id, {
      name: req.body.name,
      category: req.body.category,
      licensing_note: req.body.licensing_note,
      status: req.body.status,
    });
    res.json({ asset: omSerializeAsset(updated) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update asset' });
  }
});

router.delete('/assets/:id', requireAuth, requireRole(TEMPLATE_MGMT_ROLES), async (req, res) => {
  try {
    const asset = await omGetAssetById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!omCanWriteAsset(req, asset)) return res.status(403).json({ error: 'Access denied' });

    await omArchiveAsset(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete asset' });
  }
});

/* ═══ Records search (for generate flow) ═══ */

router.get('/records/:certificateType', requireAuth, async (req, res) => {
  try {
    if (!canGenerate(req)) return res.status(403).json({ error: 'Insufficient permissions' });
    const churchId = getChurchId(req);
    if (!churchId || !assertChurchAccess(req, res, churchId)) return;

    const records = await searchRecords(req.params.certificateType, churchId, {
      search: req.query.search,
      limit: req.query.limit,
      recordId: req.query.record_id || req.query.recordId,
    });
    res.json({ records });
  } catch (err) {
    res.status(500).json({ error: 'Failed to search records' });
  }
});

/* ═══ Preview & Render ═══ */

router.post('/preview', requireAuth, async (req, res) => {
  try {
    if (!canGenerate(req)) return res.status(403).json({ error: 'Insufficient permissions' });

    const pool = getAppPool();
    const churchId = getChurchId(req);
    if (!churchId || !assertChurchAccess(req, res, churchId)) return;

    const {
      template_id, template_version_id, certificate_type, record_id, use_sample_data,
    } = req.body;

    const tpl = await getTemplateWithVersion(pool, template_id, template_version_id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const layout = typeof tpl.layout_json === 'string' ? JSON.parse(tpl.layout_json) : tpl.layout_json;
    const certType = certificate_type || tpl.certificate_type;

    let record = {};
    let church = await loadChurchMeta(churchId) || {};
    if (use_sample_data) {
      // sample bindings only
    } else if (record_id) {
      record = await loadRecord(certType, record_id, churchId) || {};
      if (!record) return res.status(404).json({ error: 'Record not found' });
    }

    const bindingValues = resolveAllBindings(certType, record, church, !!use_sample_data);
    const { warnings, missing, valid } = validateRequiredFields(layout.layers || [], bindingValues);
    const overflowWarnings = checkOverflowWarnings(layout.layers || [], bindingValues);

    const resolver = async (id) => assetResolver(pool, id);
    const pdfBytes = await renderCertificatePdf({
      template: tpl,
      version: tpl,
      bindingValues,
      assetResolver: resolver,
    });

    res.json({
      preview: {
        pdf_base64: Buffer.from(pdfBytes).toString('base64'),
        binding_values: bindingValues,
        warnings: [...warnings, ...overflowWarnings],
        valid,
        missing_fields: missing,
        page: resolvePageDimensions(tpl),
      },
    });
  } catch (err) {
    console.error('[certificate-studio] POST /preview:', err.message);
    res.status(500).json({ error: 'Preview failed', detail: err.message });
  }
});

router.post('/render', requireAuth, async (req, res) => {
  try {
    if (!canGenerate(req)) return res.status(403).json({ error: 'Insufficient permissions' });

    const pool = getAppPool();
    const churchId = getChurchId(req);
    if (!churchId || !assertChurchAccess(req, res, churchId)) return;

    const { template_id, template_version_id, certificate_type, record_id, force } = req.body;
    if (!record_id) return res.status(400).json({ error: 'record_id is required' });

    const tpl = await getTemplateWithVersion(pool, template_id, template_version_id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const certType = certificate_type || tpl.certificate_type;
    const record = await loadRecord(certType, record_id, churchId);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    const church = await loadChurchMeta(churchId) || {};
    const layout = typeof tpl.layout_json === 'string' ? JSON.parse(tpl.layout_json) : tpl.layout_json;
    const bindingValues = resolveAllBindings(certType, record, church, false);
    const { valid, missing } = validateRequiredFields(layout.layers || [], bindingValues);

    if (!valid && !force) {
      return res.status(422).json({
        error: 'Required fields missing',
        missing_fields: missing,
        binding_values: bindingValues,
      });
    }

    const [jobResult] = await pool.query(
      `INSERT INTO certificate_studio_render_jobs
       (church_id, template_id, template_version_id, certificate_type, record_id, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'rendering', ?)`,
      [churchId, tpl.id, tpl.version_id, certType, record_id, req.user?.id],
    );
    const jobId = jobResult.insertId;

    try {
      const resolver = async (id) => assetResolver(pool, id);
      const pdfBytes = await renderCertificatePdf({
        template: tpl,
        version: tpl,
        bindingValues,
        assetResolver: resolver,
      });

      const outDir = path.join(GENERATED_DIR, String(churchId));
      fs.mkdirSync(outDir, { recursive: true });
      const filename = `cert-${certType}-${record_id}-${Date.now()}.pdf`;
      const outPath = path.join(outDir, filename);
      fs.writeFileSync(outPath, pdfBytes);

      const relPath = path.relative(path.join(__dirname, '../../storage'), outPath);

      await pool.query(
        `UPDATE certificate_studio_render_jobs SET status = 'completed', output_file_path = ?, completed_at = NOW() WHERE id = ?`,
        [relPath, jobId],
      );

      const [histResult] = await pool.query(
        `INSERT INTO certificate_studio_generation_history
         (church_id, certificate_type, record_id, template_id, template_version_id,
          generated_pdf_path, record_snapshot_json, generated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [churchId, certType, record_id, tpl.id, tpl.version_id, relPath, JSON.stringify(record), req.user?.id],
      );

      res.json({
        job_id: jobId,
        history_id: histResult.insertId,
        status: 'completed',
        download_url: `/api/certificates/history/${histResult.insertId}/download`,
        file_path: relPath,
      });
    } catch (renderErr) {
      await pool.query(
        `UPDATE certificate_studio_render_jobs SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
        [renderErr.message, jobId],
      );
      throw renderErr;
    }
  } catch (err) {
    console.error('[certificate-studio] POST /render:', err.message);
    res.status(500).json({ error: 'Render failed', detail: err.message });
  }
});

router.get('/render-jobs/:id', requireAuth, async (req, res) => {
  try {
    const pool = getAppPool();
    const [rows] = await pool.query('SELECT * FROM certificate_studio_render_jobs WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Job not found' });
    const job = rows[0];
    if (!assertChurchAccess(req, res, job.church_id)) return;
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const pool = getAppPool();
    const churchId = getChurchId(req);
    const { certificate_type, limit } = req.query;
    const lim = Math.min(Number(limit) || 50, 200);

    let query = `SELECT h.*, t.name AS template_name
      FROM certificate_studio_generation_history h
      JOIN certificate_studio_templates t ON t.id = h.template_id
      WHERE 1=1`;
    const params = [];

    if (churchId) {
      if (!assertChurchAccess(req, res, churchId)) return;
      query += ' AND h.church_id = ?';
      params.push(churchId);
    } else if (!ADMIN_ROLES.includes(req.user?.role)) {
      return res.status(400).json({ error: 'No church context' });
    }

    if (certificate_type) {
      query += ' AND h.certificate_type = ?';
      params.push(certificate_type);
    }
    query += ' ORDER BY h.generated_at DESC LIMIT ?';
    params.push(lim);

    const [rows] = await pool.query(query, params);
    res.json({ history: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list history' });
  }
});

router.get('/history/:id/download', requireAuth, async (req, res) => {
  try {
    const pool = getAppPool();
    const [rows] = await pool.query(
      'SELECT * FROM certificate_studio_generation_history WHERE id = ?',
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const entry = rows[0];
    if (!assertChurchAccess(req, res, entry.church_id)) return;

    const fullPath = path.join(__dirname, '../../storage', entry.generated_pdf_path);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${entry.id}.pdf"`);
    fs.createReadStream(fullPath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Download failed' });
  }
});

module.exports = router;
