/**
 * OCR Mobile Pairing Sessions
 * Desktop creates a session; phone uploads images via token (no OM login required).
 */
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { createRateLimiter } = require('../../middleware/rateLimiter');
const { validateChurchAccess } = require('./helpers');
const pairingService = require('../../services/ocrPairingSessionService');
const { ingestOcrFiles } = require('../../services/ocrJobIngestService');

const ACCEPTED_EXT = /\.(jpe?g|png|tiff?)$/i;
const MOBILE_MAX_FILE_BYTES = 25 * 1024 * 1024;

const pairMobileGetLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 60,
  keyGenerator: (req) => `${req.ip || 'unknown'}_pair_get_${(req.params.token || '').slice(0, 8)}`,
});

const pairUploadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  keyGenerator: (req) => `${req.ip || 'unknown'}_pair_up_${(req.params.token || '').slice(0, 8)}`,
});

function isPlatformAdmin(req) {
  const role = String(req.session?.user?.role || req.user?.role || '').toLowerCase();
  return ['super_admin', 'superadmin', 'admin'].includes(role);
}

function userId(req) {
  return req.session?.user?.id || req.user?.id;
}

function createPairingRouter(upload) {
  const router = express.Router();

  router.post('/pairing-sessions', requireAuth, async (req, res) => {
    try {
      const churchId = parseInt(req.body.churchId, 10);
      if (!churchId) {
        return res.status(400).json({ error: 'churchId is required' });
      }
      if (!validateChurchAccess(req, churchId)) {
        return res.status(403).json({ error: 'Not authorized for this church' });
      }

      const validTypes = ['baptism', 'marriage', 'funeral', 'custom'];
      const recordType = validTypes.includes(req.body.recordType) ? req.body.recordType : 'custom';

      const session = await pairingService.createSession({
        churchId,
        userId: userId(req),
        recordType,
        language: req.body.language || 'en',
        recordLayoutMode: req.body.recordLayoutMode || 'auto',
      });

      const mobilePath = `/ocr/mobile-upload/${session.token}`;
      const mobileUrl = `${req.protocol}://${req.get('host')}${mobilePath}`;

      res.status(201).json({
        ...session,
        mobileUrl,
        mobilePath,
      });
    } catch (err) {
      console.error('[OCR Pairing] create error:', err);
      res.status(500).json({ error: 'Failed to create pairing session' });
    }
  });

  router.get('/pairing-sessions/:token', requireAuth, async (req, res) => {
    try {
      const result = await pairingService.getSessionForDesktop(
        req.params.token,
        userId(req),
        isPlatformAdmin(req),
      );
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error, session: result.session || null });
      }
      res.json({ session: result.session });
    } catch (err) {
      console.error('[OCR Pairing] poll error:', err);
      res.status(500).json({ error: 'Failed to load pairing session' });
    }
  });

  router.delete('/pairing-sessions/:token', requireAuth, async (req, res) => {
    try {
      const result = await pairingService.closeSession(
        req.params.token,
        userId(req),
        isPlatformAdmin(req),
      );
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      res.json({ success: true });
    } catch (err) {
      console.error('[OCR Pairing] close error:', err);
      res.status(500).json({ error: 'Failed to close pairing session' });
    }
  });

  router.get('/pair/mobile/:token', pairMobileGetLimiter, async (req, res) => {
    try {
      const result = await pairingService.markConnected(req.params.token);
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error });
      }
      res.json(result.session);
    } catch (err) {
      console.error('[OCR Pairing] mobile info error:', err);
      res.status(500).json({ error: 'Failed to load pairing session' });
    }
  });

  router.post(
    '/pairing-sessions/:token/upload',
    pairUploadLimiter,
    upload.array('files', 10),
    async (req, res) => {
      try {
        const row = await pairingService.lookupByToken(req.params.token);
        if (!row) {
          return res.status(404).json({ error: 'Invalid pairing link', jobs: [] });
        }
        if (row.status === 'expired' || row.status === 'closed') {
          return res.status(410).json({ error: 'Pairing session is no longer active', jobs: [] });
        }

        const files = req.files || [];
        if (!files.length) {
          return res.status(400).json({ error: 'No files uploaded', jobs: [] });
        }

        for (const file of files) {
          if (!ACCEPTED_EXT.test(file.originalname || '')) {
            return res.status(400).json({
              error: 'Only JPG, PNG, and TIFF images are accepted',
              jobs: [],
            });
          }
          if (file.size > MOBILE_MAX_FILE_BYTES) {
            return res.status(400).json({
              error: 'Each image must be 25 MB or smaller',
              jobs: [],
            });
          }
        }

        const ingest = await ingestOcrFiles({
          files,
          churchId: row.church_id,
          recordType: row.record_type,
          language: row.language,
          recordLayoutMode: row.record_layout_mode,
          uploadedBy: row.created_by,
          sourcePipeline: 'mobile_pairing',
        });

        if (!ingest.ok) {
          return res.status(ingest.status || 500).json({
            error: ingest.error,
            detail: ingest.detail,
            jobs: [],
          });
        }

        await pairingService.recordUpload(req.params.token, ingest.jobs);

        res.json({
          success: true,
          jobs: ingest.jobs,
          message: ingest.message,
        });
      } catch (err) {
        console.error('[OCR Pairing] upload error:', err);
        res.status(500).json({ error: err.message || 'Upload failed', jobs: [] });
      }
    },
  );

  return router;
}

module.exports = createPairingRouter;
