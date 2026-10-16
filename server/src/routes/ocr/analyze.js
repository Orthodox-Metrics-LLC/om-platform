/**
 * OCR Analyze routes — pre-upload classification without creating jobs.
 */
const express = require('express');
const nodeCrypto = require('crypto');
const path = require('path');

function createAnalyzeRouter(upload) {
  const router = express.Router({ mergeParams: true });

  router.post('/analyze', upload.array('files', 25), async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      const files = req.files;
      if (!churchId || !files?.length) {
        return res.status(400).json({ error: 'churchId and files are required' });
      }

      const {
        createAnalyzeSession,
        analyzeImageFile,
        loadAnalyzeSession,
        saveAnalyzeSession,
      } = require('../../services/ocrAnalyzeService');

      let sessionId = String(req.body.sessionId || '').trim();
      let manifest = sessionId ? loadAnalyzeSession(churchId, sessionId) : null;
      if (!manifest) {
        sessionId = createAnalyzeSession(churchId);
        manifest = loadAnalyzeSession(churchId, sessionId);
      }

      const results = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const displayName = String(req.body.originalName || file.originalname || '').trim() || file.originalname;
        const fileId = `af_${nodeCrypto.randomBytes(6).toString('hex')}`;
        const result = await analyzeImageFile(
          churchId,
          sessionId,
          fileId,
          file.path,
          displayName,
        );
        manifest.files.push(result);
        results.push(result);
        try {
          const fs = require('fs');
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch {
          /* temp cleanup best-effort */
        }
      }

      saveAnalyzeSession(manifest);
      console.log(`OCR_ANALYZE ${JSON.stringify({ churchId, sessionId, added: results.length, total: manifest.files.length })}`);

      res.json({
        success: true,
        sessionId,
        files: results,
        total: manifest.files.length,
      });
    } catch (err) {
      console.error('[OCR Analyze] POST failed:', err);
      res.status(500).json({ error: 'Analyze failed', message: err.message });
    }
  });

  router.get('/analyze/active', async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      const preferred = String(req.query.sessionId || '').trim() || null;
      const { getActiveAnalyzeSession } = require('../../services/ocrAnalyzeService');
      const manifest = getActiveAnalyzeSession(churchId, preferred);
      if (!manifest) {
        return res.json({ success: true, sessionId: null, churchId, files: [], createdAt: null });
      }
      res.json({ success: true, ...manifest });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/analyze/:sessionId', async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      const { loadAnalyzeSession } = require('../../services/ocrAnalyzeService');
      const manifest = loadAnalyzeSession(churchId, req.params.sessionId);
      if (!manifest) return res.status(404).json({ error: 'Session not found' });
      res.json({ success: true, ...manifest });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/analyze/:sessionId/audit-report', async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      const { getSessionAuditReport } = require('../../services/ocrAnalyzeAuditService');
      const report = getSessionAuditReport(churchId, req.params.sessionId);
      if (!report) return res.status(404).json({ error: 'Session not found' });
      res.json({ success: true, report });
    } catch (err) {
      console.error('[OCR Analyze] audit-report failed:', err);
      res.status(500).json({ error: 'Audit report failed', message: err.message });
    }
  });

  router.post('/analyze/benchmark/load', async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      if (churchId !== 46) {
        return res.status(400).json({ error: 'Benchmark load is only available for church 46' });
      }
      const sessionId = String(req.body?.sessionId || '').trim() || null;
      const maxFiles = parseInt(req.body?.maxFiles, 10) || 250;

      const { loadBenchmarkDataset } = require('../../services/ocrAnalyzeBenchmarkService');
      const { sessionId: newSessionId, report } = await loadBenchmarkDataset(churchId, { sessionId, maxFiles });

      console.log(`OCR_ANALYZE_BENCHMARK_LOAD ${JSON.stringify({
        churchId,
        sessionId: newSessionId,
        total: report.summary.totalFiles,
      })}`);

      res.json({ success: true, sessionId: newSessionId, report });
    } catch (err) {
      console.error('[OCR Analyze] benchmark/load failed:', err);
      res.status(500).json({ error: 'Benchmark load failed', message: err.message });
    }
  });

  router.get('/analyze/benchmark/compare', async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      const sessionId = String(req.query.sessionId || '').trim();
      if (!churchId || !sessionId) {
        return res.status(400).json({ error: 'churchId and sessionId are required' });
      }
      const captureLearning = req.query.captureLearning !== 'false';

      const { buildBenchmarkCompareReport } = require('../../services/ocrAnalyzeBenchmarkService');
      const compareReport = await buildBenchmarkCompareReport(churchId, sessionId, { captureLearning });

      console.log(`OCR_ANALYZE_BENCHMARK_COMPARE ${JSON.stringify({
        churchId,
        sessionId,
        matched: compareReport.summary.matchedToDb,
        typeAccuracy: compareReport.summary.recordTypeAccuracyPct,
        fieldAccuracy: compareReport.summary.avgFieldMatchPct,
      })}`);

      res.json({ success: true, compareReport });
    } catch (err) {
      console.error('[OCR Analyze] benchmark/compare failed:', err);
      res.status(500).json({ error: 'Benchmark compare failed', message: err.message });
    }
  });

  router.post('/analyze/scan-directory', async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      const rootPath = String(req.body?.rootPath || '').trim();
      const recursive = req.body?.recursive !== false;
      const maxFiles = parseInt(req.body?.maxFiles, 10) || 500;
      const sessionId = String(req.body?.sessionId || '').trim() || null;

      if (!churchId || !rootPath) {
        return res.status(400).json({ error: 'churchId and rootPath are required' });
      }

      const { scanDirectoryAndAnalyze } = require('../../services/ocrAnalyzeAuditService');
      const report = await scanDirectoryAndAnalyze(churchId, rootPath, {
        recursive,
        maxFiles,
        sessionId,
      });

      console.log(`OCR_ANALYZE_AUDIT ${JSON.stringify({
        churchId,
        sessionId: report.sessionId,
        rootPath: report.rootPath,
        total: report.summary.totalFiles,
        needsReview: report.summary.needsReview,
      })}`);

      res.json({ success: true, report });
    } catch (err) {
      console.error('[OCR Analyze] scan-directory failed:', err);
      res.status(500).json({ error: 'Directory scan failed', message: err.message });
    }
  });

  router.get('/analyze/:sessionId/:fileId/preview', async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      const variant = req.query.variant === 'original' ? 'original' : 'optimized';
      const { getAnalyzePreviewPath } = require('../../services/ocrAnalyzeService');
      const previewPath = getAnalyzePreviewPath(
        churchId,
        req.params.sessionId,
        req.params.fileId,
        variant,
      );
      if (!previewPath) return res.status(404).json({ error: 'Preview not found' });
      res.sendFile(path.resolve(previewPath));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/analyze/:sessionId/:fileId/rotate', async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      const degrees = parseInt(req.body?.degrees, 10);
      const { rotateAnalyzeFile } = require('../../services/ocrAnalyzeService');
      const result = await rotateAnalyzeFile(
        churchId,
        req.params.sessionId,
        req.params.fileId,
        degrees,
      );
      res.json({ success: true, file: result });
    } catch (err) {
      console.error('[OCR Analyze] rotate failed:', err);
      res.status(500).json({ error: 'Rotate failed', message: err.message });
    }
  });

  router.delete('/analyze/:sessionId/:fileId', async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      const { removeAnalyzeFile } = require('../../services/ocrAnalyzeService');
      const { remainingCount, sessionDeleted } = removeAnalyzeFile(
        churchId,
        req.params.sessionId,
        req.params.fileId,
      );
      res.json({ success: true, remainingCount, sessionDeleted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/analyze/:sessionId/commit', async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      const items = req.body?.items;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array is required' });
      }
      const uploadedBy = req.session?.user?.id || req.user?.id || null;
      const {
        commitAnalyzeSession,
        removeFilesFromAnalyzeSession,
      } = require('../../services/ocrAnalyzeService');
      const { jobs, committedFileIds } = await commitAnalyzeSession(
        churchId,
        req.params.sessionId,
        items,
        uploadedBy,
      );
      const { remainingCount, sessionDeleted } = removeFilesFromAnalyzeSession(
        churchId,
        req.params.sessionId,
        committedFileIds,
      );
      res.json({
        success: true,
        jobs,
        committedFileIds,
        remainingCount,
        sessionDeleted,
        message: `Created ${jobs.length} OCR job(s)`,
      });
    } catch (err) {
      console.error('[OCR Analyze] commit failed:', err);
      res.status(500).json({ error: 'Commit failed', message: err.message });
    }
  });

  router.delete('/analyze/:sessionId', async (req, res) => {
    try {
      const churchId = parseInt(req.params.churchId, 10);
      const { deleteAnalyzeSession } = require('../../services/ocrAnalyzeService');
      deleteAnalyzeSession(churchId, req.params.sessionId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createAnalyzeRouter;
