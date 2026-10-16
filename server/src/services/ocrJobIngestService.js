/**
 * Shared OCR file ingest — used by /api/ocr/jobs/upload and mobile pairing uploads.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { emitBrainEvent } = require('./brainEventEmitter');

const SOURCE_PIPELINE_ENUM = [
  'studio',
  'uploader',
  'worker',
  'batch_import',
  'analyze',
  'mobile_pairing',
];

async function ensureSourcePipelineEnum(platformPool) {
  const enumList = SOURCE_PIPELINE_ENUM.map((v) => `'${v}'`).join(',');
  try {
    await platformPool.query(`
      ALTER TABLE ocr_jobs MODIFY COLUMN source_pipeline
      ENUM(${enumList}) NULL
    `);
  } catch (err) {
    console.warn(`[OCR Ingest] source_pipeline enum ensure warning: ${err.message}`);
  }
}

function normalizeSourcePipeline(value) {
  const pipeline = String(value || 'uploader').toLowerCase();
  return SOURCE_PIPELINE_ENUM.includes(pipeline) ? pipeline : 'uploader';
}

/**
 * @param {object} opts
 * @param {Array<{ path: string, originalname: string, mimetype?: string }>} opts.files
 * @param {number} opts.churchId
 * @param {string} [opts.recordType]
 * @param {string} [opts.language]
 * @param {string} [opts.recordLayoutMode]
 * @param {number|null} [opts.uploadedBy]
 * @param {number} [opts.priority]
 * @param {string} [opts.sourcePipeline]
 * @param {number} [opts.splitGridRows]
 * @param {number} [opts.splitGridCols]
 * @param {string} [opts.batchId] Optional upload-session batch id (groups multi-file uploads).
 */
async function ingestOcrFiles(opts) {
  const {
    files,
    churchId,
    recordType: rawType = 'custom',
    language = 'en',
    recordLayoutMode: bodyLayoutMode,
    uploadedBy = null,
    priority: rawPriority = 5,
    sourcePipeline: rawSourcePipeline = 'uploader',
    splitGridRows,
    splitGridCols,
    batchId: rawBatchId = null,
  } = opts;

  if (!files || files.length === 0) {
    return { ok: false, status: 400, error: 'No files uploaded', jobs: [] };
  }
  if (!churchId) {
    return { ok: false, status: 400, error: 'churchId is required', jobs: [] };
  }

  const validTypes = ['baptism', 'marriage', 'funeral', 'custom'];
  const recordType = validTypes.includes(rawType) ? rawType : 'custom';
  const sourcePipeline = normalizeSourcePipeline(rawSourcePipeline);

  const { promisePool: platformPool, assertTenantOcrTablesExist } = require('../config/db');
  const ocrPaths = require('../utils/ocrPaths');

  const [[dbRow]] = await platformPool.query('SELECT DATABASE() AS db');
  const currentDb = dbRow?.db;
  if (currentDb !== 'orthodoxmetrics_db') {
    return { ok: false, status: 500, error: `Platform pool connected to '${currentDb}' instead of orthodoxmetrics_db`, jobs: [] };
  }

  const [churchRows] = await platformPool.query(
    'SELECT database_name, name, church_name, state_province FROM churches WHERE id = ?',
    [churchId],
  );
  if (!churchRows.length) {
    return { ok: false, status: 404, error: 'Church not found', jobs: [] };
  }

  await assertTenantOcrTablesExist(churchId);

  const uploadDir = ocrPaths.getOcrUploadDir(churchId);

  for (const file of files) {
    if (!fs.existsSync(file.path)) {
      return { ok: false, status: 500, error: `Uploaded file missing on disk: ${file.originalname}`, jobs: [] };
    }
  }

  const createdJobs = [];
  let lastSqlError = null;

  let uploadLayoutTemplateId = null;
  if (recordType !== 'custom') {
    try {
      const globalCorpus = require('./globalLayoutCorpusService');
      const onboardingLayoutExtractor = require('./onboardingLayoutExtractorService');

      if (globalCorpus.isEnglishLanguage(language)) {
        await globalCorpus.ensureGlobalEnglishLayouts(recordType);
      }
      const globalLayoutMatch = require('./globalLayoutMatchService');
      await globalLayoutMatch.ensureGlobalLayouts(recordType);

      await onboardingLayoutExtractor.ensureOnboardingLayoutCandidates(churchId, recordType);
      uploadLayoutTemplateId = await onboardingLayoutExtractor.resolveUploadLayoutTemplateId(churchId, recordType);
    } catch (onbErr) {
      console.warn(`[OCR Ingest] Layout corpus wiring failed (non-blocking): ${onbErr.message}`);
    }
  }

  const tenantPool = require('../config/db').getTenantPool(churchId);
  const {
    resolveUploadRecordLayoutMode,
    planMultiRecordUpload,
    buildPerSplitLayoutClassification,
    removeSourceIfSplit,
  } = require('./ocrMultiRecordUploadService');
  const uploadRecordLayoutMode = await resolveUploadRecordLayoutMode(
    tenantPool,
    churchId,
    bodyLayoutMode,
  );

  try {
    await platformPool.query('ALTER TABLE ocr_jobs ADD COLUMN IF NOT EXISTS layout_classification_json TEXT NULL');
    await platformPool.query('ALTER TABLE ocr_jobs ADD COLUMN IF NOT EXISTS batch_id VARCHAR(64) NULL');
    const { ensureFilenameColumns } = require('./ocrCanonicalFilename');
    await ensureFilenameColumns(platformPool);
    await ensureSourcePipelineEnum(platformPool);
  } catch (_) { /* columns may already exist */ }

  const jobPriority = Math.min(9, Math.max(1, parseInt(rawPriority, 10) || 5));

  // Every upload session gets a real batch id (even single-file uploads) so the
  // Parish Uploads dashboard has a stable identity to persist a batch name and
  // the P1->P2 "Ready for Image Review" gate against.
  const sessionBatchId = (() => {
    const cleaned = typeof rawBatchId === 'string' ? rawBatchId.trim().slice(0, 64) : '';
    if (cleaned) return cleaned;
    return `batch_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  })();

  for (const file of files) {
    try {
      const timestamp = Date.now();
      const ext = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, ext);
      const uniqueFilename = `${baseName}_${timestamp}${ext}`;
      const finalPath = path.join(uploadDir, uniqueFilename);

      fs.renameSync(file.path, finalPath);

      if (!fs.existsSync(finalPath)) {
        throw new Error(`File move failed: ${file.path} -> ${finalPath}`);
      }

      // Bake phone EXIF orientation before region detection / job create.
      try {
        const { bakeExifOrientation } = require('../ocr/preprocessing/autoOrientImage');
        const orient = await bakeExifOrientation(finalPath);
        if (orient.applied) {
          console.log(
            `[OCR Ingest] Baked EXIF orientation=${orient.orientation} → ${orient.width}x${orient.height} (${file.originalname})`,
          );
        }
      } catch (orientErr) {
        console.warn(`[OCR Ingest] EXIF auto-orient skipped: ${orientErr.message}`);
      }

      const plan = await planMultiRecordUpload(
        finalPath,
        uploadDir,
        file.originalname,
        uploadRecordLayoutMode,
        {
          gridRows: Number.isFinite(splitGridRows) ? splitGridRows : undefined,
          gridCols: Number.isFinite(splitGridCols) ? splitGridCols : undefined,
        },
      );
      removeSourceIfSplit(finalPath, plan.split);

      const fileMimeType = file.mimetype || 'image/jpeg';

      for (let splitIdx = 0; splitIdx < plan.paths.length; splitIdx += 1) {
        const jobPath = plan.paths[splitIdx];
        const storedFilename = plan.filenames[splitIdx];
        const fileBuffer = fs.readFileSync(jobPath);
        const sha256Hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        const fileStats = fs.statSync(jobPath);

        let jobLayoutTemplateId = uploadLayoutTemplateId;
        let layoutClassificationJson = null;
        try {
          const {
            identifyLayoutFromImage,
            layoutResultToClassificationJson,
          } = require('./ocrLayoutIdentificationService');
          const layoutResult = await identifyLayoutFromImage(jobPath, {
            churchId,
            recordTypeHint: recordType,
            language,
            source: 'upload',
            identificationContext: { originalFilename: file.originalname },
          });
          if (layoutResult.templateMatchId) {
            jobLayoutTemplateId = layoutResult.templateMatchId;
          }
          const splitExtra = plan.split && plan.batchId
            ? buildPerSplitLayoutClassification(
              uploadRecordLayoutMode,
              splitIdx + 1,
              plan.paths.length,
              file.originalname,
              plan.batchId,
            )
            : (plan.layoutClassification || {});
          layoutClassificationJson = JSON.stringify(
            layoutResultToClassificationJson(layoutResult, {
              recordLayoutMode: uploadRecordLayoutMode,
              sourcePipeline,
              ...splitExtra,
            }),
          );
        } catch (layoutErr) {
          console.warn(`[OCR Ingest] Layout identification failed for ${file.originalname}: ${layoutErr.message}`);
          if (plan.split && plan.batchId) {
            layoutClassificationJson = JSON.stringify(
              buildPerSplitLayoutClassification(
                uploadRecordLayoutMode,
                splitIdx + 1,
                plan.paths.length,
                file.originalname,
                plan.batchId,
              ),
            );
          } else if (plan.layoutClassification) {
            layoutClassificationJson = JSON.stringify(plan.layoutClassification);
          }
        }

        const effectiveBatchId = plan.batchId || sessionBatchId;

        let canonicalFilename = null;
        try {
          const { assignCanonicalAtIngest } = require('./ocrCanonicalFilename');
          const assigned = await assignCanonicalAtIngest(platformPool, {
            churchId,
            originalFilename: file.originalname,
            recordType,
          });
          canonicalFilename = assigned.canonical_filename;
        } catch (nameErr) {
          console.warn(`[OCR Ingest] Canonical filename skipped for ${file.originalname}: ${nameErr.message}`);
        }

        const insertParams = [
          churchId,
          effectiveBatchId,
          uploadedBy,
          storedFilename,
          file.originalname,
          canonicalFilename,
          jobPriority,
          recordType,
          language,
          sourcePipeline,
        ];
        let insertSql = `INSERT INTO ocr_jobs (church_id, batch_id, uploaded_by, filename, original_filename, canonical_filename, status, priority, review_status, record_type, language, created_at, source_pipeline`;
        if (jobLayoutTemplateId) {
          insertSql += `, layout_template_id`;
          insertParams.push(jobLayoutTemplateId);
        }
        if (layoutClassificationJson) {
          insertSql += `, layout_classification_json`;
          insertParams.push(layoutClassificationJson);
        }
        insertSql += `) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 'uploaded', ?, ?, NOW(), ?`;
        if (jobLayoutTemplateId) insertSql += `, ?`;
        if (layoutClassificationJson) insertSql += `, ?`;
        insertSql += `)`;

        const [result] = await platformPool.query(insertSql, insertParams);
        const jobId = result.insertId;

        if (!result.affectedRows) {
          throw new Error(`INSERT returned 0 affectedRows for ${file.originalname}`);
        }

        try {
          try {
            await tenantPool.query(`ALTER TABLE ocr_feeder_artifacts ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64) NULL`);
            await tenantPool.query(`ALTER TABLE ocr_feeder_artifacts ADD COLUMN IF NOT EXISTS bytes BIGINT NULL`);
            await tenantPool.query(`ALTER TABLE ocr_feeder_artifacts ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) NULL`);
          } catch (_) { /* columns may already exist */ }

          const [pageResult] = await tenantPool.query(
            `INSERT INTO ocr_feeder_pages (job_id, page_index, status, input_path, created_at, updated_at)
             VALUES (?, 0, 'queued', ?, NOW(), NOW())`,
            [jobId, jobPath],
          );
          const pageId = pageResult.insertId;

          await tenantPool.query(
            `INSERT INTO ocr_feeder_artifacts (page_id, type, storage_path, meta_json, sha256, bytes, mime_type, created_at)
             VALUES (?, 'source_image', ?, ?, ?, ?, ?, NOW())`,
            [
              pageId,
              jobPath,
              JSON.stringify({
                original_filename: file.originalname,
                upload_timestamp: timestamp,
                split_index: plan.split ? splitIdx + 1 : null,
                split_total: plan.split ? plan.paths.length : null,
                record_layout_mode: uploadRecordLayoutMode,
                upload_batch_id: effectiveBatchId,
              }),
              sha256Hash,
              fileStats.size,
              fileMimeType,
            ],
          );
        } catch (artifactErr) {
          console.warn(`[OCR Ingest] Artifact creation failed for job ${jobId}: ${artifactErr.message}`);
        }

        createdJobs.push({
          id: jobId,
          church_id: churchId,
          filename: storedFilename,
          original_filename: file.originalname,
          canonical_filename: canonicalFilename,
          status: 'pending',
          record_type: recordType,
          language,
          batch_id: effectiveBatchId,
          split_index: plan.split ? splitIdx + 1 : null,
          split_total: plan.split ? plan.paths.length : null,
          layout_summary: layoutClassificationJson
            ? (() => {
              try {
                const lc = JSON.parse(layoutClassificationJson);
                return {
                  detectedLayoutType: lc.detectedLayoutType,
                  layoutConfidence: lc.layoutConfidence,
                  matchedCatalogLayoutTitle: lc.matchedCatalogLayoutTitle,
                  globalCatalogLayoutId: lc.globalCatalogLayoutId ?? lc.matchedCatalogLayoutId,
                  layoutMatchScope: lc.layoutMatchScope,
                  zoneCount: lc.zones?.length ?? 0,
                  templateMatchId: lc.templateMatchId,
                };
              } catch {
                return null;
              }
            })()
            : null,
          created_at: new Date().toISOString(),
        });
      }
    } catch (fileError) {
      lastSqlError = {
        message: fileError.message,
        code: fileError.code || null,
      };
      console.error(`[OCR Ingest] Error for ${file.originalname}:`, lastSqlError);
    }
  }

  if (createdJobs.length === 0) {
    return {
      ok: false,
      status: 500,
      error: `Failed to create any OCR jobs for church ${churchId}`,
      detail: { churchId, uploadDir, sqlError: lastSqlError },
      jobs: [],
    };
  }

  // Register the batch itself (idempotent) so the Parish Uploads dashboard has
  // somewhere to persist a human-readable name and the Ready for Image Review gate.
  const registeredBatchIds = new Set(createdJobs.map((j) => j.batch_id).filter(Boolean));
  for (const batchId of registeredBatchIds) {
    try {
      await platformPool.query(
        `INSERT INTO ocr_upload_batches (batch_id, church_id, created_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE updated_at = NOW()`,
        [batchId, churchId],
      );
    } catch (batchErr) {
      console.warn(`[OCR Ingest] ocr_upload_batches upsert failed for ${batchId}: ${batchErr.message}`);
    }
  }

  emitBrainEvent({
    source: 'om',
    event_type: 'ocr_job.created',
    severity: 'info',
    summary: `${createdJobs.length} OCR job(s) queued for church ${churchId}`,
    actor_type: uploadedBy ? 'user' : 'system',
    actor_id: uploadedBy != null ? String(uploadedBy) : null,
    object_type: 'ocr_job',
    object_id: String(churchId),
    data: {
      job_count: createdJobs.length,
      job_ids: createdJobs.map((j) => j.id),
      record_types: [...new Set(createdJobs.map((j) => j.record_type))],
      source_pipeline: sourcePipeline,
    },
  });

  return {
    ok: true,
    status: 200,
    jobs: createdJobs,
    message: `Successfully uploaded ${createdJobs.length} file(s)`,
  };
}

module.exports = { ingestOcrFiles };
