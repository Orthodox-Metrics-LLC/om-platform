/**
 * Cemetery map digitizer API — load/save PDF-derived geometry JSON and page images.
 * Mounted under /api/churches/:churchId/cemetery/map-geometry
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });
const SUPER_ONLY = ['super_admin'];

function churchDataDir(churchId) {
  return path.resolve(__dirname, '../../assets/cemetery-map', `church-${churchId}`);
}

function draftPath(churchId) {
  return path.join(churchDataDir(churchId), 'map.draft.json');
}

function assertSuperAdmin(req, res) {
  if (!SUPER_ONLY.includes(req.user?.role)) {
    res.status(403).json({ success: false, error: 'Super admin access required' });
    return false;
  }
  return true;
}

function assertChurchId(req, res) {
  const cid = Number(req.params.churchId);
  if (!Number.isFinite(cid) || cid <= 0) {
    res.status(400).json({ success: false, error: 'Church ID is required' });
    return null;
  }
  return cid;
}

router.use(requireAuth);

/** GET / — load map geometry document */
router.get('/', (req, res) => {
  const churchId = assertChurchId(req, res);
  if (!churchId) return;
  if (!assertSuperAdmin(req, res)) return;

  const file = draftPath(churchId);
  if (!fs.existsSync(file)) {
    return res.status(404).json({
      success: false,
      error: 'Map geometry not found. Run cemetery-render-pdf.mjs first.',
    });
  }
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[cemetery-map] GET:', err.message);
    res.status(500).json({ success: false, error: 'Failed to read map geometry' });
  }
});

/** PUT / — save map geometry document */
router.put('/', (req, res) => {
  const churchId = assertChurchId(req, res);
  if (!churchId) return;
  if (!assertSuperAdmin(req, res)) return;

  const body = req.body;
  if (!body || body.schemaVersion !== 1) {
    return res.status(400).json({ success: false, error: 'Invalid map document (schemaVersion must be 1)' });
  }
  if (Number(body.churchId) !== churchId) {
    return res.status(400).json({ success: false, error: 'churchId mismatch' });
  }

  const dir = churchDataDir(churchId);
  fs.mkdirSync(dir, { recursive: true });
  body.updatedAt = new Date().toISOString();
  body.metadata = body.metadata || {};
  body.metadata.reviewFlagCount = (body.plots || []).filter((p) => p.needsReview).length
    + (body.objects || []).filter((o) => o.needsReview).length;
  body.objects = body.objects || [];

  try {
    fs.writeFileSync(draftPath(churchId), `${JSON.stringify(body, null, 2)}\n`);
    res.json({ success: true, data: { updatedAt: body.updatedAt } });
  } catch (err) {
    console.error('[cemetery-map] PUT:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save map geometry' });
  }
});

/** GET /pages/:pageNum/image — serve rendered page underlay */
router.get('/pages/:pageNum/image', (req, res) => {
  const churchId = assertChurchId(req, res);
  if (!churchId) return;
  if (!assertSuperAdmin(req, res)) return;

  const pageNum = Number(req.params.pageNum);
  const file = draftPath(churchId);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ success: false, error: 'Map geometry not found' });
  }

  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const page = (doc.pages || []).find((p) => p.pageNumber === pageNum);
    if (!page) {
      return res.status(404).json({ success: false, error: `Page ${pageNum} not found` });
    }
    const imagePath = path.join(churchDataDir(churchId), page.imageFile);
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ success: false, error: 'Page image not rendered yet' });
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(imagePath);
  } catch (err) {
    console.error('[cemetery-map] GET image:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load page image' });
  }
});

module.exports = router;
