/**
 * OM Assets Library API — /api/assets/*
 *
 * Scope tags:
 *   public — any authenticated church user can read; platform admins write
 *   church — parish-scoped (church_id required); that church + admins only
 *   site   — OM/OMAI/OMstudio/OMworkshop internal; platform admins only
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const {
  SCOPES,
  CATEGORIES,
  normalizeClassification,
  VISIBILITIES,
  SOURCE_TYPES,
  OWNER_SYSTEMS,
  ALLOWED_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  mimeFromExt,
  defaultVisibilityForScope,
  buildLogicalStoragePath,
  scopeStorageDir,
  toRelativeStoragePath,
} = require('../assets/omAssetsConstants');
const {
  canReadAsset,
  canReadAssetFile,
  canWriteAsset,
  canCreateScope,
  isPlatformAdmin,
  isSuperAdmin,
  userChurchId,
} = require('../assets/omAssetsPermissions');
const {
  ensureStorageDirs,
  serializeAsset,
  getAssetById,
  listAssets,
  listAssetsPage,
  countAssets,
  getScopeCounts,
  getFolderCounts,
  listDirectories,
  listAllTags,
  createAssetRecord,
  updateAssetRecord,
  archiveAsset,
  bulkArchiveAssets,
  purgeAsset,
  bulkPurgeAssets,
  bulkDeleteDuplicates,
  createDirectory,
  moveAssetsToDirectory,
  bulkChangeAssetCategory,
  listCategoryNameSuggestions,
  bulkSetAssetTags,
  changeAssetScope,
  bulkChangeScope,
  copyAssetToScope,
  transformAssetImage,
  splitAssetImage,
  readImageMetaFromPath,
  listDuplicateGroups,
  listSimilarGroups,
  hashFileBuffer,
  resolveAssetFilePath,
  getAssetByLegacyUrl,
  normalizeDirectoryPath,
} = require('../assets/omAssetsService');
const { registerOmAssetFromLegacyFile, resolvePathToOmAsset } = require('../assets/omAssetsLegacyBridge');
const { SCREENSHOTS_SHARE_ROOT } = require('../assets/omAssetsImport');
const { auditFromRequest } = require('../assets/omAssetsAudit');
const {
  readableScopesForUser,
} = require('../assets/omAssetsPermissions');
const smartAnalyze = require('../assets/omAssetsSmartAnalyze');
const zipImport = require('../assets/omAssetsZipImport');
const { getCollectionBySlug } = require('../assets/omAssetsCollections');
const {
  listCollections,
  getCollectionById,
  createCollection,
  updateCollection,
  deleteCollection,
  assignAssetsToCollection,
  removeAssetsFromCollection,
} = require('../assets/omAssetsCollections');
const {
  fetchWorkshopDestinations,
  sendAssetsToWorkshop,
} = require('../assets/omAssetsWorkshopHandoff');

const extractedProfileDir = path.join(__dirname, '../../front-end/public/images/profile');
const extractedBannerDir = path.join(__dirname, '../../front-end/public/images/banner');
for (const dir of [extractedProfileDir, extractedBannerDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureStorageDirs();

function parseScope(value) {
  const s = String(value || '').toLowerCase();
  return SCOPES.has(s) ? s : null;
}

function parseVisibility(value) {
  const v = String(value || '').toLowerCase();
  return VISIBILITIES.has(v) ? v : null;
}

function parseSourceType(value) {
  return SOURCE_TYPES.has(value) ? value : null;
}

function parseOwnerSystem(value) {
  return OWNER_SYSTEMS.has(value) ? value : null;
}

function parseCategory(value) {
  return CATEGORIES.has(value) ? value : null;
}

function parseTagsInput(body) {
  if (!body.tags) return null;
  try {
    const parsed = typeof body.tags === 'string' ? JSON.parse(body.tags) : body.tags;
    return Array.isArray(parsed) ? parsed : String(body.tags).split(',').map((s) => s.trim()).filter(Boolean);
  } catch {
    return String(body.tags).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        const scope = parseScope(req.body.scope) || 'public';
        let churchId = Number(req.body.church_id);
        if (scope === 'church' && !Number.isFinite(churchId)) {
          churchId = userChurchId(req);
        }
        const dir = scopeStorageDir(scope, churchId);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) {
        cb(e);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_EXTENSIONS.test(file.originalname));
  },
}).single('file');

function handleUpload(req, res, next) {
  upload(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
}

const zipUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(zipImport.ZIP_TEMP_ROOT, { recursive: true });
      cb(null, zipImport.ZIP_TEMP_ROOT);
    },
    filename: (_req, _file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 12)}.zip`),
  }),
  limits: { fileSize: zipImport.MAX_ZIP_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname || '').toLowerCase() !== '.zip') return cb(new Error('Only .zip archives are accepted'));
    cb(null, true);
  },
}).single('archive');

function handleZipUpload(req, res, next) {
  zipUpload(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.message || 'ZIP upload failed' });
    }
    next();
  });
}

const ZIP_CHUNK_INCOMING = path.join(zipImport.ZIP_TEMP_ROOT, 'chunk-incoming');
const zipChunkUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(ZIP_CHUNK_INCOMING, { recursive: true });
      cb(null, ZIP_CHUNK_INCOMING);
    },
    filename: (_req, _file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 12)}.part`),
  }),
  limits: { fileSize: zipImport.MAX_ZIP_CHUNK_BYTES, files: 1 },
}).single('chunk');

function handleZipChunkUpload(req, res, next) {
  zipChunkUpload(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.message || 'ZIP chunk upload failed' });
    }
    next();
  });
}

async function analyzeZipRequest(req, zipPath, originalFilename) {
  const scope = parseScope(req.body.scope) || 'public';
  let churchId = Number(req.body.church_id);
  if (scope !== 'church') churchId = null;
  if (scope === 'church' && (!Number.isFinite(churchId) || churchId <= 0)) {
    throw new Error('church_id is required for church scope');
  }
  if (!canCreateScope(req, scope, churchId)) throw new Error('Insufficient permissions for this scope');
  const strategy = ['smart', 'sequential', 'preserve'].includes(req.body.naming_strategy)
    ? req.body.naming_strategy : 'smart';
  return zipImport.createAnalysis({
    zipPath,
    originalFilename,
    scope,
    churchId,
    category: parseCategory(req.body.category),
    folder: req.body.folder,
    namingStrategy: strategy,
    userId: req.user?.id || req.session?.user?.id,
  });
}

/* ─── ZIP media import ─── */
router.get('/zip-imports', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform administrators only' });
    const userId = req.user?.id || req.session?.user?.id;
    res.json({ imports: await zipImport.listImports(userId, req.query.limit) });
  } catch (err) {
    console.error('[om-assets] GET /zip-imports:', err.message);
    res.status(500).json({ error: 'Failed to list ZIP imports' });
  }
});

router.post('/zip-import/chunks/start', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform administrators only' });
    const upload = zipImport.createChunkUpload({
      filename: req.body.filename,
      totalBytes: req.body.total_bytes,
      totalChunks: req.body.total_chunks,
      userId: req.user?.id || req.session?.user?.id,
    });
    res.status(201).json({ upload });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to start ZIP upload' });
  }
});

router.post('/zip-import/chunks/:uploadId', requireAuth, handleZipChunkUpload, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) {
      if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(403).json({ error: 'Platform administrators only' });
    }
    if (!req.file) return res.status(400).json({ error: 'chunk is required' });
    const chunk = zipImport.saveChunkUploadPart({
      uploadId: req.params.uploadId,
      userId: req.user?.id || req.session?.user?.id,
      chunkIndex: req.body.chunk_index,
      partPath: req.file.path,
    });
    res.status(201).json({ chunk });
  } catch (err) {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    res.status(400).json({ error: err.message || 'Failed to save ZIP chunk' });
  }
});

router.post('/zip-import/chunks/:uploadId/complete', requireAuth, async (req, res) => {
  let uploaded = null;
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform administrators only' });
    uploaded = zipImport.completeChunkUpload({
      uploadId: req.params.uploadId,
      userId: req.user?.id || req.session?.user?.id,
    });
    const analysis = await analyzeZipRequest(req, uploaded.zipPath, uploaded.originalFilename);
    await auditFromRequest(req, 'zip_analyze', {
      payload: { import_id: analysis.id, archive: analysis.archive_filename, total: analysis.manifest.length, chunked: true },
    });
    res.status(201).json({ import: analysis });
  } catch (err) {
    if (uploaded?.zipPath) try { fs.unlinkSync(uploaded.zipPath); } catch { /* ignore */ }
    console.error('[om-assets] POST /zip-import/chunks/:uploadId/complete:', err.message);
    res.status(400).json({ error: err.message || 'Failed to analyze ZIP archive' });
  }
});

router.post('/zip-import/analyze', requireAuth, handleZipUpload, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) {
      if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(403).json({ error: 'Platform administrators only' });
    }
    if (!req.file) return res.status(400).json({ error: 'archive is required' });
    const analysis = await analyzeZipRequest(req, req.file.path, req.file.originalname);
    await auditFromRequest(req, 'zip_analyze', {
      payload: { import_id: analysis.id, archive: analysis.archive_filename, total: analysis.manifest.length },
    });
    res.status(201).json({ import: analysis });
  } catch (err) {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    console.error('[om-assets] POST /zip-import/analyze:', err.message);
    res.status(400).json({ error: err.message || 'Failed to analyze ZIP archive' });
  }
});

router.delete('/zip-import/:token', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform administrators only' });
    const cancelled = await zipImport.cancelImport(req.params.token, req.user?.id || req.session?.user?.id);
    res.json({ cancelled });
  } catch (err) {
    console.error('[om-assets] DELETE /zip-import/:token:', err.message);
    res.status(400).json({ error: err.message || 'Failed to cancel ZIP import' });
  }
});

router.post('/zip-import/:token/commit', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform administrators only' });
    const scope = parseScope(req.body.scope) || undefined;
    const churchId = req.body.church_id ? Number(req.body.church_id) : null;
    if (scope && !canCreateScope(req, scope, churchId)) {
      return res.status(403).json({ error: 'Insufficient permissions for this scope' });
    }
    const result = await zipImport.commitImport({
      token: req.params.token,
      userId: req.user?.id || req.session?.user?.id,
      skipDuplicates: req.body.skip_duplicates !== false,
      overrides: {
        scope,
        church_id: churchId,
        category: parseCategory(req.body.category),
        folder: req.body.folder,
        collection_id: req.body.collection_id,
        tags: Array.isArray(req.body.tags) ? req.body.tags.map(String).slice(0, 30) : [],
        entries: Array.isArray(req.body.entries) ? req.body.entries.slice(0, zipImport.MAX_ENTRIES) : [],
      },
    });
    await auditFromRequest(req, 'zip_import', {
      payload: { import_id: result.id, imported: result.imported_count, skipped: result.skipped_count, failed: result.failed_count },
    });
    res.status(result.status === 'completed' ? 201 : 207).json({ import: result });
  } catch (err) {
    console.error('[om-assets] POST /zip-import/:token/commit:', err.message);
    res.status(400).json({ error: err.message || 'Failed to import ZIP archive' });
  }
});

/* ─── List ─── */
router.get('/', requireAuth, async (req, res) => {
  try {
    const filters = {
      scope: req.query.scope ? parseScope(req.query.scope) : undefined,
      visibility: req.query.visibility ? parseVisibility(req.query.visibility) : undefined,
      collection_id: req.query.collection_id,
      source_type: req.query.source_type ? parseSourceType(req.query.source_type) : undefined,
      owner_system: req.query.owner_system ? parseOwnerSystem(req.query.owner_system) : undefined,
      folder: req.query.folder,
      category: req.query.category || undefined,
      primary_tag: req.query.primary_tag || undefined,
      secondary_tag: req.query.secondary_tag || undefined,
      church_id: req.query.church_id,
      search: req.query.search,
      directory: req.query.directory,
      tag: req.query.tag,
      sort: req.query.sort,
      file_type: req.query.file_type,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      smartSearch: ['1', 'true'].includes(String(req.query.smart_search).toLowerCase()),
    };

    // Cursor (keyset) pagination — the incremental-loading path used by the
    // Assets Library grid. `paginate=cursor` + `limit` returns one page plus a
    // `next_cursor`/`has_more`; counts are computed only on the first page (no
    // cursor) so scrolling never re-runs the aggregate queries.
    if (String(req.query.paginate) === 'cursor') {
      const limit = Math.min(Math.max(Math.floor(Number(req.query.limit) || 48), 1), 100);
      const isFirstPage = !req.query.cursor;
      const pagePromise = listAssetsPage(req, { ...filters, limit, cursor: req.query.cursor });

      let page;
      let total;
      let scope_counts;
      let folder_counts;
      if (isFirstPage) {
        [page, total, scope_counts, folder_counts] = await Promise.all([
          pagePromise,
          countAssets(req, filters),
          getScopeCounts(req, filters),
          getFolderCounts(req, filters),
        ]);
      } else {
        page = await pagePromise;
      }

      return res.json({
        assets: page.assets,
        items: page.assets,
        next_cursor: page.nextCursor,
        has_more: page.hasMore,
        page_size: limit,
        ...(isFirstPage ? { total, scope_counts, folder_counts } : {}),
      });
    }

    // Opt-in server-side pagination: page_size drives limit/offset. Legacy
    // callers that omit page_size keep the previous "single array" behaviour.
    const pageSizeRaw = Number(req.query.page_size);
    const paginate = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0;
    let page = 1;
    let pageSize = null;
    let listFilters = { ...filters, limit: req.query.limit };
    if (paginate) {
      pageSize = Math.min(Math.max(Math.floor(pageSizeRaw), 1), 100);
      page = Math.max(Math.floor(Number(req.query.page)) || 1, 1);
      listFilters = { ...filters, limit: pageSize, offset: (page - 1) * pageSize };
    }

    const [assets, total, scope_counts, folder_counts] = await Promise.all([
      listAssets(req, listFilters),
      countAssets(req, filters),
      getScopeCounts(req, filters),
      getFolderCounts(req, filters),
    ]);

    res.json({
      assets,
      total,
      page: paginate ? page : 1,
      page_size: paginate ? pageSize : assets.length,
      scope_counts,
      folder_counts,
    });
  } catch (err) {
    console.error('[om-assets] GET /:', err.message);
    res.status(500).json({ error: 'Failed to list assets' });
  }
});

router.get('/directories', requireAuth, async (req, res) => {
  try {
    const scope = req.query.scope ? parseScope(req.query.scope) : undefined;
    const directories = await listDirectories(req, {
      scope,
      church_id: req.query.church_id,
    });
    res.json({ directories });
  } catch (err) {
    console.error('[om-assets] GET /directories:', err.message);
    res.status(500).json({ error: 'Failed to list directories' });
  }
});

router.get('/tags', requireAuth, async (req, res) => {
  try {
    const tags = await listAllTags(req, {
      scope: req.query.scope ? parseScope(req.query.scope) : undefined,
      church_id: req.query.church_id,
    });
    res.json({ tags });
  } catch (err) {
    console.error('[om-assets] GET /tags:', err.message);
    res.status(500).json({ error: 'Failed to list tags' });
  }
});

/* ─── Collections ─── */
router.get('/collections', requireAuth, async (req, res) => {
  try {
    const collections = await listCollections(req, {
      scope: req.query.scope ? parseScope(req.query.scope) : undefined,
      visibility: req.query.visibility ? parseVisibility(req.query.visibility) : undefined,
      search: req.query.search,
      limit: req.query.limit,
    });
    res.json({ collections });
  } catch (err) {
    console.error('[om-assets] GET /collections:', err.message);
    res.status(500).json({ error: 'Failed to list collections' });
  }
});

router.get('/collections/:id', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform admin required' });
    const collection = await getCollectionById(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    const assets = await listAssets(req, { collection_id: collection.id, limit: 500 });
    res.json({
      collection: { ...collection, asset_count: assets.length },
      assets: assets.map(serializeAsset),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get collection' });
  }
});

router.post('/collections', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform admin required' });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const scope = parseScope(req.body.scope) || 'public';
    if (scope === 'internal' && !isPlatformAdmin(req)) {
      return res.status(403).json({ error: 'Internal collections require platform admin' });
    }
    const collection = await createCollection({
      name,
      slug: req.body.slug,
      description: req.body.description,
      scope,
      visibility: parseVisibility(req.body.visibility),
      category: req.body.category,
      folder: req.body.folder,
      source_type: parseSourceType(req.body.source_type),
      owner_system: parseOwnerSystem(req.body.owner_system),
      metadata_json: req.body.metadata_json,
    }, req.user?.id || req.session?.user?.id);
    await auditFromRequest(req, 'collection_create', { collection_id: collection.id, payload: { name } });
    res.status(201).json({ collection });
  } catch (err) {
    console.error('[om-assets] POST /collections:', err.message);
    res.status(400).json({ error: err.message || 'Failed to create collection' });
  }
});

router.put('/collections/:id', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform admin required' });
    const existing = await getCollectionById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Collection not found' });
    const collection = await updateCollection(req.params.id, {
      name: req.body.name,
      slug: req.body.slug,
      description: req.body.description,
      scope: req.body.scope ? parseScope(req.body.scope) : undefined,
      visibility: req.body.visibility ? parseVisibility(req.body.visibility) : undefined,
      category: req.body.category,
      folder: req.body.folder,
      source_type: req.body.source_type ? parseSourceType(req.body.source_type) : undefined,
      owner_system: req.body.owner_system ? parseOwnerSystem(req.body.owner_system) : undefined,
      metadata_json: req.body.metadata_json,
    });
    await auditFromRequest(req, 'collection_update', { collection_id: collection.id });
    res.json({ collection });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update collection' });
  }
});

router.delete('/collections/:id', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform admin required' });
    const existing = await getCollectionById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Collection not found' });
    await deleteCollection(req.params.id);
    await auditFromRequest(req, 'collection_delete', { collection_id: existing.id, payload: { name: existing.name } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete collection' });
  }
});

router.post('/collections/:id/assign', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform admin required' });
    const collection = await getCollectionById(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids array is required' });
    const assigned = await assignAssetsToCollection(collection.id, ids);
    await auditFromRequest(req, 'collection_assign', {
      collection_id: collection.id,
      payload: { ids, assigned },
    });
    res.json({ success: true, assigned });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign assets' });
  }
});

router.post('/collections/:id/remove', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform admin required' });
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids array is required' });
    const removed = await removeAssetsFromCollection(ids);
    await auditFromRequest(req, 'collection_remove', {
      collection_id: Number(req.params.id),
      payload: { ids, removed },
    });
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove assets from collection' });
  }
});

/* ─── Resolve legacy /images/ path → om_assets row ─── */
router.get('/resolve', requireAuth, async (req, res) => {
  try {
    const urlPath = req.query.path || req.query.image_path;
    if (!urlPath) return res.status(400).json({ error: 'path query parameter is required' });

    const asset = await getAssetByLegacyUrl(urlPath);
    if (!asset) return res.status(404).json({ error: 'No asset registered for this path' });
    if (!canReadAssetFile(req, asset)) return res.status(403).json({ error: 'Access denied' });

    res.json({ asset: serializeAsset(asset) });
  } catch (err) {
    console.error('[om-assets] GET /resolve:', err.message);
    res.status(500).json({ error: 'Failed to resolve asset path' });
  }
});

/* ─── Duplicate / similar grouping ─── */
router.get('/duplicates', requireAuth, async (req, res) => {
  try {
    const groups = await listDuplicateGroups(req);
    res.json({ groups });
  } catch (err) {
    console.error('[om-assets] GET /duplicates:', err.message);
    res.status(500).json({ error: 'Failed to load duplicate groups' });
  }
});

router.get('/category-suggestions', requireAuth, async (req, res) => {
  try {
    const suggestions = await listCategoryNameSuggestions(req);
    res.json({ success: true, suggestions });
  } catch (err) {
    console.error('[om-assets] GET /category-suggestions:', err.message);
    res.status(500).json({ error: err.message || 'Failed to load category suggestions' });
  }
});

router.get('/similar-groups', requireAuth, async (req, res) => {
  try {
    const groups = await listSimilarGroups(req);
    res.json({ groups });
  } catch (err) {
    console.error('[om-assets] GET /similar-groups:', err.message);
    res.status(500).json({ error: 'Failed to load similar groups' });
  }
});

/* ─── Bulk actions ─── */
router.post('/bulk-archive', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids array is required' });

    for (const id of ids) {
      const asset = await getAssetById(id);
      if (!asset) continue;
      if (!canWriteAsset(req, asset)) {
        return res.status(403).json({ error: `Access denied for asset ${id}` });
      }
    }

    const archived = await bulkArchiveAssets(ids);
    res.json({ success: true, archived });
  } catch (err) {
    console.error('[om-assets] POST /bulk-archive:', err.message);
    res.status(500).json({ error: 'Failed to archive assets' });
  }
});

/** Hard delete — removes the file + row permanently. Cannot be undone. */
router.post('/bulk-purge', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids array is required' });

    for (const id of ids) {
      const asset = await getAssetById(id);
      if (!asset) continue;
      if (!canWriteAsset(req, asset)) {
        return res.status(403).json({ error: `Access denied for asset ${id}` });
      }
    }

    const purged = await bulkPurgeAssets(ids);
    await auditFromRequest(req, 'purge', { payload: { ids, purged } });
    res.json({ success: true, purged });
  } catch (err) {
    console.error('[om-assets] POST /bulk-purge:', err.message);
    res.status(500).json({ error: 'Failed to delete assets' });
  }
});

router.post('/bulk-scope', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const scope = parseScope(req.body.scope);
    if (!ids.length) return res.status(400).json({ error: 'ids array is required' });
    if (!scope) return res.status(400).json({ error: 'Valid scope is required' });

    let churchId = Number(req.body.church_id);
    if (scope === 'church' && !Number.isFinite(churchId)) {
      churchId = userChurchId(req);
    }
    if (!canCreateScope(req, scope, churchId)) {
      return res.status(403).json({ error: 'Insufficient permissions for target scope' });
    }

    for (const id of ids) {
      const asset = await getAssetById(id);
      if (!asset) continue;
      if (!canWriteAsset(req, asset)) {
        return res.status(403).json({ error: `Access denied for asset ${id}` });
      }
    }

    const assets = await bulkChangeScope(ids, scope, churchId, parseVisibility(req.body.visibility));
    for (const asset of assets) {
      await auditFromRequest(req, 'scope_change', {
        asset_id: asset.id,
        payload: { scope, church_id: churchId },
      });
    }
    res.json({ success: true, assets: assets.map(serializeAsset) });
  } catch (err) {
    console.error('[om-assets] POST /bulk-scope:', err.message);
    res.status(500).json({ error: err.message || 'Failed to change asset scope' });
  }
});

router.post('/directories', requireAuth, async (req, res) => {
  try {
    const scope = parseScope(req.body.scope);
    if (!scope) return res.status(400).json({ error: 'Valid scope is required' });

    let churchId = Number(req.body.church_id);
    if (scope === 'church' && !Number.isFinite(churchId)) {
      churchId = userChurchId(req);
    }
    if (!canCreateScope(req, scope, churchId)) {
      return res.status(403).json({ error: 'Insufficient permissions for this scope' });
    }

    const directory = await createDirectory(scope, churchId, req.body.path || req.body.directory);
    res.status(201).json({ success: true, directory });
  } catch (err) {
    console.error('[om-assets] POST /directories:', err.message);
    res.status(400).json({ error: err.message || 'Failed to create directory' });
  }
});

router.post('/bulk-move', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids array is required' });

    for (const id of ids) {
      const asset = await getAssetById(id);
      if (!asset) continue;
      if (!canWriteAsset(req, asset)) {
        return res.status(403).json({ error: `Access denied for asset ${id}` });
      }
    }

    const directory = req.body.directory ?? req.body.path ?? '';
    const assets = await moveAssetsToDirectory(ids, directory);
    res.json({ success: true, assets: assets.map(serializeAsset) });
  } catch (err) {
    console.error('[om-assets] POST /bulk-move:', err.message);
    res.status(500).json({ error: err.message || 'Failed to move assets' });
  }
});

router.post('/bulk-category', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const classification = {
      category: req.body.category,
      primary_tag: req.body.primary_tag,
      secondary_tag: req.body.secondary_tag,
    };
    if (!ids.length) return res.status(400).json({ error: 'ids array is required' });
    if (!req.body.category) return res.status(400).json({ error: 'Valid type is required' });

    for (const id of ids) {
      const asset = await getAssetById(id);
      if (!asset) continue;
      if (!canWriteAsset(req, asset)) {
        return res.status(403).json({ error: `Access denied for asset ${id}` });
      }
    }

    const assets = await bulkChangeAssetCategory(ids, classification);
    await auditFromRequest(req, 'edit', {
      payload: { bulk_category: classification, count: assets.length, ids: ids.slice(0, 50) },
    });
    res.json({ success: true, assets: assets.map(serializeAsset) });
  } catch (err) {
    console.error('[om-assets] POST /bulk-category:', err.message);
    res.status(500).json({ error: err.message || 'Failed to change category' });
  }
});

router.post('/bulk-tags', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const tags = Array.isArray(req.body.tags) ? req.body.tags : [];
    const mode = ['set', 'add', 'remove'].includes(req.body.mode) ? req.body.mode : 'set';
    if (!ids.length) return res.status(400).json({ error: 'ids array is required' });

    for (const id of ids) {
      const asset = await getAssetById(id);
      if (!asset) continue;
      if (!canWriteAsset(req, asset)) {
        return res.status(403).json({ error: `Access denied for asset ${id}` });
      }
    }

    const assets = await bulkSetAssetTags(ids, tags, mode);
    res.json({ success: true, assets: assets.map(serializeAsset) });
  } catch (err) {
    console.error('[om-assets] POST /bulk-tags:', err.message);
    res.status(500).json({ error: err.message || 'Failed to update tags' });
  }
});

router.post('/bulk-delete-duplicates', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) {
      return res.status(403).json({ error: 'Platform admin required' });
    }

    const result = await bulkDeleteDuplicates(req);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[om-assets] POST /bulk-delete-duplicates:', err.message);
    res.status(500).json({ error: err.message || 'Failed to delete duplicate assets' });
  }
});

/* ─── Save grid-extracted profile/banner tiles (replaces global-images shim) ─── */
router.post('/save-extracted', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) {
      return res.status(403).json({ error: 'Platform admin required' });
    }

    const { images, type } = req.body;
    if (!images || !Array.isArray(images) || !type || !['profile', 'banner'].includes(type)) {
      return res.status(400).json({ error: 'Invalid images data or type' });
    }

    const targetDir = type === 'profile' ? extractedProfileDir : extractedBannerDir;
    const baseUrl = type === 'profile' ? '/images/profile' : '/images/banner';
    const savedImages = [];
    const uploadedBy = req.user?.id || req.session?.user?.id || null;

    for (let i = 0; i < images.length; i++) {
      const imageData = images[i];
      if (!imageData?.data || !imageData?.name) continue;

      try {
        const base64Data = imageData.data.replace(/^data:image\/[a-z]+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const timestamp = Date.now() + i;
        const fileName = `${type}_${timestamp}.png`;
        const filePath = path.join(targetDir, fileName);
        fs.writeFileSync(filePath, buffer);

        const urlPath = `${baseUrl}/${fileName}`;
        const assetId = await registerOmAssetFromLegacyFile({
          absPath: filePath,
          urlPath,
          legacySource: 'public_images',
          scope: 'public',
          category: type === 'banner' ? 'header' : 'icon',
          name: imageData.name,
          productTags: ['om', 'omai'],
          uploadedBy,
        });

        savedImages.push({
          id: assetId ? String(assetId) : fileName,
          name: imageData.name,
          url: urlPath,
          type,
          asset_id: assetId,
        });
      } catch (err) {
        console.warn('[om-assets] save-extracted tile skipped:', err.message);
      }
    }

    res.json({
      success: true,
      message: `Successfully saved ${savedImages.length} extracted images`,
      images: savedImages,
    });
  } catch (err) {
    console.error('[om-assets] POST /save-extracted:', err.message);
    res.status(500).json({ error: 'Failed to save extracted images' });
  }
});

/* ─── Workshop destinations + send (must be before /:id) ─── */
router.get('/workshop/destinations', requireAuth, async (req, res) => {
  try {
    const data = await fetchWorkshopDestinations();
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('[om-assets] GET /workshop/destinations:', err.message);
    res.status(err.status || 502).json({
      error: err.code || 'workshop_destinations_failed',
      message: err.message,
    });
  }
});

router.post('/workshop/send', requireAuth, async (req, res) => {
  try {
    const result = await sendAssetsToWorkshop(req, req.body || {});
    if (!result.ok && result.status && result.status >= 400) {
      return res.status(result.status).json(result);
    }
    res.status(result.status && result.status !== 200 ? result.status : 200).json({
      success: !!result.ok,
      ...result,
    });
  } catch (err) {
    console.error('[om-assets] POST /workshop/send:', err.message);
    res.status(err.status || 500).json({
      error: 'workshop_send_failed',
      message: err.message,
    });
  }
});

function isWorkshopServiceCaller(req) {
  const expected = process.env.OMSTUDIO_SERVICE_TOKEN || process.env.OM_WORKSHOP_SERVICE_TOKEN || '';
  if (!expected) return false;
  const hdr = req.headers['x-service-token'];
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return hdr === expected || bearer === expected;
}

/* ─── Website files — browse/replace om-platform front-end/public ───
 * Registered before /:id so this path is never treated as an asset id.
 */
router.use('/handoff-notes', require('../assets/omHandoffNotes'));
router.use('/website-files', require('../assets/omWebsiteFiles'));

/* ─── Stream file ─── */
router.get('/:id/file', async (req, res) => {
  try {
    const asset = await getAssetById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    // Workshop service pull (trusted server-to-server after OM send authz)
    if (!isWorkshopServiceCaller(req) && !canReadAssetFile(req, asset)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const fullPath = resolveAssetFilePath(asset);
    if (!fullPath || !fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    const ext = path.extname(fullPath);
    res.setHeader('Content-Type', asset.mime_type || asset.file_type || mimeFromExt(ext));
    const isInternal = asset.scope === 'internal' || asset.visibility === 'internal_only';
    res.setHeader('Cache-Control', isInternal ? 'private, no-store' : 'private, max-age=3600');
    fs.createReadStream(fullPath).pipe(res);
  } catch (err) {
    console.error('[om-assets] GET /:id/file:', err.message);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const asset = await getAssetById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!canReadAsset(req, asset)) return res.status(403).json({ error: 'Access denied' });
    res.json({ asset: serializeAsset(asset) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get asset' });
  }
});

/* ─── Copy / promote (super_admin) ─── */
router.post('/:id/copy', requireAuth, async (req, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: 'super_admin required' });
    const asset = await getAssetById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!canReadAsset(req, asset)) return res.status(403).json({ error: 'Access denied' });

    const targetScope = parseScope(req.body.target_scope || req.body.scope);
    if (!targetScope) return res.status(400).json({ error: 'Valid target_scope is required' });

    let churchId = Number(req.body.church_id);
    if (targetScope === 'church' && !Number.isFinite(churchId)) {
      churchId = userChurchId(req);
    }

    const copy = await copyAssetToScope(asset.id, {
      target_scope: targetScope,
      target_visibility: parseVisibility(req.body.visibility),
      church_id: churchId,
      collection_id: req.body.collection_id ? Number(req.body.collection_id) : null,
      actor_user_id: req.user?.id || req.session?.user?.id,
    });

    const eventType = req.body.promote ? 'promote' : 'copy';
    await auditFromRequest(req, eventType, {
      asset_id: copy.id,
      payload: { source_asset_id: asset.id, target_scope: targetScope },
    });

    res.status(201).json({ asset: serializeAsset(copy) });
  } catch (err) {
    console.error('[om-assets] POST /:id/copy:', err.message);
    res.status(400).json({ error: err.message || 'Failed to copy asset' });
  }
});

/* ─── Smart Upload Assist — analyze (no file stored) ─── */
router.post('/analyze-upload', requireAuth, async (req, res) => {
  try {
    const allowedScopes = readableScopesForUser(req);
    const contextScope = parseScope(req.body.scope);
    let contextChurchId = Number(req.body.church_id);
    if (!Number.isFinite(contextChurchId) || contextChurchId <= 0) contextChurchId = userChurchId(req);

    const destination = smartAnalyze.deriveContextDefaults({
      contextScope: contextScope || undefined,
      contextChurchId,
      allowedScopes,
      hasChurch: !!userChurchId(req),
    });

    if (!destination.permitted) {
      // Still return suggestions but flag the scope as not writable for this user.
      destination.error = `Scope "${destination.scope}" is not permitted for your role.`;
    }

    const contextCategory = parseCategory(req.body.category) || null;
    const contextCollectionId = req.body.collection_id ? Number(req.body.collection_id) : null;
    const contextFolder = req.body.folder ? normalizeDirectoryPath(req.body.folder) : null;

    const rawFiles = Array.isArray(req.body.files) ? req.body.files : [];
    if (!rawFiles.length) return res.status(400).json({ error: 'files array is required' });
    if (rawFiles.length > 50) return res.status(400).json({ error: 'Too many files (max 50 per analyze call)' });

    const visionProvider = smartAnalyze.getVisionProvider();

    const suggestions = [];
    for (const f of rawFiles) {
      const originalFilename = String(f.original_filename || f.name || 'file').slice(0, 400);
      const mime = String(f.mime || f.mime_type || '').slice(0, 128);
      const width = Number.isFinite(Number(f.width)) ? Number(f.width) : null;
      const height = Number.isFinite(Number(f.height)) ? Number(f.height) : null;
      let detectedText = typeof f.detected_text === 'string' ? f.detected_text.slice(0, 8000) : '';
      let detectedLabels = Array.isArray(f.detected_labels)
        ? f.detected_labels.map((l) => String(l).slice(0, 120)).slice(0, 60)
        : [];

      // Pluggable vision (flag-gated): augment detected text/labels if a provider
      // is registered and a preview is supplied. Never a hard dependency.
      if (visionProvider && f.preview_base64) {
        try {
          const out = await visionProvider({
            base64: f.preview_base64, mime, filename: originalFilename,
          });
          if (out?.text) detectedText = `${detectedText} ${out.text}`.trim().slice(0, 8000);
          if (Array.isArray(out?.labels)) detectedLabels = [...detectedLabels, ...out.labels].slice(0, 60);
        } catch (e) {
          console.warn('[om-assets] vision provider failed:', e.message);
        }
      }

      const suggestion = smartAnalyze.buildSuggestion({
        originalFilename,
        mime,
        width,
        height,
        scope: destination.scope,
        visibility: destination.visibility,
        churchId: destination.church_id,
        contextCategory,
        contextCollectionId,
        contextFolder,
        detectedText,
        detectedLabels,
        title: typeof f.title === 'string' ? f.title : '',
      });

      // Resolve a suggested collection name → existing collection id (never create here).
      if (suggestion.collection_name && !suggestion.collection_id) {
        try {
          const slug = smartAnalyze.slugifySegment(suggestion.collection_name);
          const col = await getCollectionBySlug(slug);
          if (col) suggestion.collection_id = col.id;
        } catch { /* non-fatal */ }
      }

      const classified = normalizeClassification({
        category: suggestion.category,
        primary_tag: suggestion.primary_tag,
        secondary_tag: suggestion.secondary_tag,
        mime_type: mime,
      });
      suggestion.category = classified.category;
      suggestion.primary_tag = classified.primary_tag;
      suggestion.secondary_tag = classified.secondary_tag;
      suggestions.push(suggestion);
    }

    res.json({
      destination: {
        scope: destination.scope,
        visibility: destination.visibility,
        church_id: destination.church_id,
        permitted: destination.permitted,
        error: destination.error || null,
      },
      vision_enabled: smartAnalyze.isVisionEnabled(),
      suggestions,
    });
  } catch (err) {
    console.error('[om-assets] POST /analyze-upload:', err.message);
    res.status(500).json({ error: 'Failed to analyze upload' });
  }
});

/* ─── Upload ─── */
router.post('/', requireAuth, handleUpload, async (req, res) => {
  try {
    const scope = parseScope(req.body.scope) || (userChurchId(req) ? 'church' : 'public');
    const classifiedUpload = normalizeClassification({
      category: req.body.category,
      primary_tag: req.body.primary_tag,
      secondary_tag: req.body.secondary_tag,
      mime_type: req.file?.mimetype,
      file_type: req.file?.mimetype,
    });
    const category = classifiedUpload.category;
    const name = (req.body.name || req.file?.originalname || '').trim();

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!category) return res.status(400).json({ error: 'Valid category is required' });

    let churchId = Number(req.body.church_id);
    if (scope === 'church') {
      if (!Number.isFinite(churchId) || churchId <= 0) {
        churchId = userChurchId(req);
      }
      if (!churchId) {
        return res.status(400).json({ error: 'church_id is required for church-scoped assets' });
      }
    } else {
      churchId = null;
    }

    if (!canCreateScope(req, scope, churchId)) {
      return res.status(403).json({ error: 'Insufficient permissions for this scope' });
    }

    let visibility = parseVisibility(req.body.visibility) || defaultVisibilityForScope(scope);
    if (scope === 'internal') visibility = 'internal_only';

    const altText = (req.body.alt_text || '').trim();
    if (scope === 'public' && category !== 'font' && req.file?.mimetype?.startsWith('image/') && !altText) {
      return res.status(400).json({ error: 'alt_text is required for public images' });
    }

    const folder = normalizeDirectoryPath(req.body.folder || req.body.directory || '');

    // JSON uploads are limited to Internal scope (Playwright storage_state, etc.)
    if (req.file && path.extname(req.file.originalname).toLowerCase() === '.json' && scope !== 'internal') {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(400).json({
        error: 'JSON uploads are only allowed for Internal scope (e.g. Playwright storage_state under Admin Assets)',
      });
    }

    let sha256 = null;
    let width = null;
    let height = null;
    let file_size = null;
    let relPath = null;
    let storage_path = null;
    if (req.file) {
      // Place file under the folder subdirectory so disk path matches Admin Assets folders
      // (e.g. om-assets/internal/playwright/<file>.json for Portal UI Audit storage-state).
      if (folder) {
        const scopeDir = scopeStorageDir(scope, churchId);
        const targetDir = path.join(scopeDir, folder);
        const resolvedTarget = path.resolve(targetDir);
        if (!resolvedTarget.startsWith(path.resolve(scopeDir) + path.sep) && resolvedTarget !== path.resolve(scopeDir)) {
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
          return res.status(400).json({ error: 'Invalid folder path' });
        }
        fs.mkdirSync(resolvedTarget, { recursive: true });
        // Prefer stable storage_state.json name for Playwright exports
        let destName = path.basename(req.file.path);
        const originalBase = path.basename(req.file.originalname || '').toLowerCase();
        if (scope === 'internal' && originalBase === 'storage_state.json') {
          destName = 'storage_state.json';
        }
        let destPath = path.join(resolvedTarget, destName);
        if (fs.existsSync(destPath) && path.resolve(req.file.path) !== path.resolve(destPath)) {
          const ext = path.extname(destName);
          const base = path.basename(destName, ext);
          destPath = path.join(resolvedTarget, `${base}-${Date.now()}${ext}`);
        }
        if (path.resolve(req.file.path) !== path.resolve(destPath)) {
          fs.renameSync(req.file.path, destPath);
          req.file.path = destPath;
        }
      }

      const buf = fs.readFileSync(req.file.path);
      sha256 = hashFileBuffer(buf);
      file_size = buf.length;
      relPath = toRelativeStoragePath(req.file.path);
      storage_path = buildLogicalStoragePath(
        scope,
        churchId,
        folder ? `${folder}/${path.basename(req.file.path)}` : path.basename(req.file.path),
      );
      try {
        const meta = await readImageMetaFromPath(req.file.path);
        width = meta.width;
        height = meta.height;
        if (meta.file_size) file_size = meta.file_size;
      } catch {
        // non-image uploads are allowed
      }
    }

    // ── Smart rename: sanitize + collision-safe rename of the stored file ──
    const smartRenameApplied = req.body.smart_rename_applied === 'true' || req.body.smart_rename_applied === true;
    const smartMetadataApplied = req.body.smart_metadata_applied === 'true' || req.body.smart_metadata_applied === true;
    const originalFilename = (req.body.original_filename || req.file?.originalname || name || '').slice(0, 255);
    let storedFilename = req.file ? path.basename(req.file.path) : null;
    let renameCollision = false;

    if (req.file && smartRenameApplied && req.body.stored_filename) {
      try {
        const ext = path.extname(req.file.originalname).toLowerCase();
        const desired = smartAnalyze.sanitizeFilename(req.body.stored_filename, ext);
        // Keep the smart-renamed file inside the selected folder subdirectory.
        // Previously targetDir was the scope root, which silently moved
        // folder-scoped uploads (e.g. category "icon" → folder "icon/2026")
        // back to the scope root and desynced file_path from disk.
        const scopeDir = scopeStorageDir(scope, churchId);
        const targetDir = folder ? path.join(scopeDir, folder) : scopeDir;
        fs.mkdirSync(targetDir, { recursive: true });
        const resolved = await smartAnalyze.resolveStoredFilename({
          pool: require('../config/db').getAppPool(),
          scope,
          churchId,
          desiredName: desired,
          targetDir,
          contentHash: sha256 || '',
          fsMod: fs,
        });
        renameCollision = resolved.collision;
        const finalPath = path.join(targetDir, resolved.filename);
        if (path.dirname(finalPath) === targetDir && !fs.existsSync(finalPath)) {
          fs.renameSync(req.file.path, finalPath);
          req.file.path = finalPath;
          storedFilename = resolved.filename;
          relPath = toRelativeStoragePath(finalPath);
          storage_path = buildLogicalStoragePath(
            scope,
            churchId,
            folder ? `${folder}/${resolved.filename}` : resolved.filename,
          );
        }
      } catch (e) {
        console.warn('[om-assets] smart rename failed, keeping original stored name:', e.message);
      }
    }

    let product_tags = null;
    if (req.body.product_tags) {
      try {
        product_tags = typeof req.body.product_tags === 'string'
          ? JSON.parse(req.body.product_tags)
          : req.body.product_tags;
      } catch {
        product_tags = String(req.body.product_tags).split(',').map((s) => s.trim());
      }
    }

    const tags = parseTagsInput(req.body);
    const metadata_json = {
      ...(tags?.length ? { tags } : {}),
      ...(classifiedUpload.primary_tag ? { primary_tag: classifiedUpload.primary_tag } : {}),
      ...(classifiedUpload.secondary_tag ? { secondary_tag: classifiedUpload.secondary_tag } : {}),
    };

    const collectionId = req.body.collection_id ? Number(req.body.collection_id) : null;

    const asset = await createAssetRecord({
      name,
      title: req.body.title || name,
      description: req.body.description || null,
      alt_text: altText || null,
      caption: req.body.caption || null,
      credit: req.body.credit || null,
      scope,
      visibility,
      church_id: churchId,
      collection_id: collectionId,
      folder: folder || null,
      category,
      file_path: relPath,
      storage_path,
      file_type: req.file?.mimetype,
      mime_type: req.file?.mimetype,
      width,
      height,
      file_size,
      metadata_json,
      licensing_note: req.body.licensing_note || null,
      product_tags,
      sha256,
      source_type: parseSourceType(req.body.source_type) || 'upload',
      owner_system: parseOwnerSystem(req.body.owner_system) || 'om',
      uploaded_by: req.user?.id,
      created_by: req.user?.id,
      original_filename: originalFilename || null,
      stored_filename: storedFilename,
      display_name: req.body.display_name || req.body.title || name,
      content_hash: sha256,
      smart_rename_applied: smartRenameApplied,
      smart_metadata_applied: smartMetadataApplied,
      classification_source: req.body.classification_source || (smartMetadataApplied ? 'smart' : 'manual'),
      category_confidence: req.body.category_confidence,
    });

    await auditFromRequest(req, 'upload', { asset_id: asset.id, payload: { scope, visibility, name } });
    if (smartRenameApplied && originalFilename && storedFilename && originalFilename !== storedFilename) {
      await auditFromRequest(req, 'smart_rename', {
        asset_id: asset.id,
        payload: {
          original_filename: originalFilename,
          stored_filename: storedFilename,
          scope,
          visibility,
          collision_resolved: renameCollision,
          classification_source: req.body.classification_source || 'smart',
          category,
          category_confidence: req.body.category_confidence || null,
        },
      });
    }
    res.status(201).json({ asset: serializeAsset(asset) });
  } catch (err) {
    console.error('[om-assets] POST /:', err.message);
    res.status(500).json({ error: 'Failed to create asset' });
  }
});

/* ─── Update metadata ─── */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const asset = await getAssetById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!canWriteAsset(req, asset)) return res.status(403).json({ error: 'Access denied' });

    const updated = await updateAssetRecord(req.params.id, {
      name: req.body.name,
      title: req.body.title,
      description: req.body.description,
      alt_text: req.body.alt_text,
      caption: req.body.caption,
      credit: req.body.credit,
      category: req.body.category,
      primary_tag: req.body.primary_tag,
      secondary_tag: req.body.secondary_tag,
      licensing_note: req.body.licensing_note,
      status: req.body.status,
      visibility: req.body.visibility ? parseVisibility(req.body.visibility) : undefined,
      collection_id: req.body.collection_id !== undefined ? Number(req.body.collection_id) || null : undefined,
      source_type: req.body.source_type ? parseSourceType(req.body.source_type) : undefined,
      owner_system: req.body.owner_system ? parseOwnerSystem(req.body.owner_system) : undefined,
      metadata_json: req.body.metadata_json,
      product_tags: req.body.product_tags,
      tags: req.body.tags,
      directory: req.body.directory,
      folder: req.body.folder,
      scope: req.body.scope ? parseScope(req.body.scope) : undefined,
    });

    await auditFromRequest(req, 'edit', { asset_id: Number(req.params.id) });
    res.json({ asset: serializeAsset(updated) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update asset' });
  }
});

/* ─── Image transform (crop / rotate / resize) ─── */
router.post('/:id/transform', requireAuth, async (req, res) => {
  try {
    const asset = await getAssetById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!canWriteAsset(req, asset)) return res.status(403).json({ error: 'Access denied' });

    const ext = path.extname(asset.file_path || '').toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
      return res.status(400).json({ error: 'Image transform supports PNG, JPEG, WebP, and GIF only' });
    }

    const updated = await transformAssetImage(req.params.id, {
      rotate: req.body.rotate,
      width: req.body.width,
      height: req.body.height,
      crop: req.body.crop,
    });
    res.json({ asset: serializeAsset(updated) });
  } catch (err) {
    console.error('[om-assets] POST /:id/transform:', err.message);
    res.status(500).json({ error: err.message || 'Failed to transform image' });
  }
});

/* ─── Split image into a grid of separate assets ─── */
router.post('/:id/split', requireAuth, async (req, res) => {
  try {
    const asset = await getAssetById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!canWriteAsset(req, asset)) return res.status(403).json({ error: 'Access denied' });

    const ext = path.extname(asset.file_path || '').toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
      return res.status(400).json({ error: 'Split supports PNG, JPEG, WebP, and GIF images only' });
    }

    const rows = Math.floor(Number(req.body.rows));
    const cols = Math.floor(Number(req.body.cols));
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1) {
      return res.status(400).json({ error: 'rows and cols must be positive integers' });
    }
    if (rows * cols < 2) return res.status(400).json({ error: 'Split must produce at least 2 tiles' });
    if (rows > 12 || cols > 12) return res.status(400).json({ error: 'rows and cols must be 12 or fewer' });

    const deleteSource = req.body.delete_source === true || req.body.delete_source === 'true';

    const tiles = await splitAssetImage(asset, {
      rows,
      cols,
      deleteSource,
      actorUserId: req.user?.id || req.session?.user?.id || null,
    });

    await auditFromRequest(req, 'split', {
      asset_id: asset.id,
      payload: { rows, cols, tiles: tiles.length, delete_source: deleteSource },
    });

    res.status(201).json({
      success: true,
      assets: tiles.map(serializeAsset),
      deleted_source: deleteSource,
    });
  } catch (err) {
    console.error('[om-assets] POST /:id/split:', err.message);
    res.status(400).json({ error: err.message || 'Failed to split image' });
  }
});

/* ─── Archive ─── */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const asset = await getAssetById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!canWriteAsset(req, asset)) return res.status(403).json({ error: 'Access denied' });

    await archiveAsset(req.params.id);
    await auditFromRequest(req, 'delete', { asset_id: Number(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive asset' });
  }
});

/** Hard delete — removes the file + row permanently. Cannot be undone. */
router.delete('/:id/purge', requireAuth, async (req, res) => {
  try {
    const asset = await getAssetById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!canWriteAsset(req, asset)) return res.status(403).json({ error: 'Access denied' });

    await purgeAsset(req.params.id);
    await auditFromRequest(req, 'purge', { asset_id: Number(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error('[om-assets] DELETE /:id/purge:', err.message);
    res.status(500).json({ error: 'Failed to delete asset' });
  }
});

/* ─── Cloud Files — real-time browse of the \\192.168.1.79\screenshots SMB share ───
 * Not backed by om_assets at all: lists the live mount directly, so it always
 * reflects exactly what's on the share right now, independent of the
 * scheduled screenshots_share importer. Platform admins only.
 *
 * Performance: the SMB share is accessed over CIFS. Directory listings with
 * stat per entry are slow (~1–2 s for 500+ files). Two caches mitigate this:
 *
 *   1. In-memory directory listing cache (30 s TTL) — avoids repeated CIFS
 *      readdir+stat on rapid page loads / navigation.
 *   2. Local-disk thumbnail cache — generates a 200 px wide WebP thumbnail
 *      on first request and serves it from local storage afterward, avoiding
 *      both the SMB round-trip and the full-size image transfer for table
 *      preview icons.
 */
const crypto = require('crypto');
const sharp = require('sharp');

const CLOUD_THUMB_ROOT = path.join(__dirname, '../../storage/om-assets/cloud-cache/thumbs');
const CLOUD_THUMB_WIDTH = 200;
const CLOUD_THUMB_QUALITY = 70;
const CLOUD_IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

// In-memory directory listing cache: relPath → { entries, ts }
const _dirCache = new Map();
const DIR_CACHE_TTL_MS = 30_000;

function resolveScreenshotsSharePath(relativePath) {
  const base = path.resolve(SCREENSHOTS_SHARE_ROOT);
  const target = path.resolve(base, (relativePath || '').replace(/^\/+/, ''));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

/** Cache key for a thumbnail: hash of the relative path + mtime (ISO). */
function thumbCacheKey(relPath, mtimeIso) {
  return crypto.createHash('sha1').update(`${relPath}\0${mtimeIso}`).digest('hex');
}

/** Return the local thumbnail path, generating it from the SMB source when absent. */
async function ensureThumbnail(absPath, relPath, mtimeIso) {
  const key = thumbCacheKey(relPath, mtimeIso);
  const subDir = key.slice(0, 2);
  const thumbDir = path.join(CLOUD_THUMB_ROOT, subDir);
  const thumbPath = path.join(thumbDir, `${key}.webp`);

  if (fs.existsSync(thumbPath)) return thumbPath;

  // Generate thumbnail from the SMB source
  fs.mkdirSync(thumbDir, { recursive: true });
  await sharp(absPath, { failOn: 'none' })
    .resize({ width: CLOUD_THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: CLOUD_THUMB_QUALITY })
    .toFile(thumbPath);

  return thumbPath;
}

/** Invalidate cached thumbnails whose source was deleted from the share. */
function evictThumbCache(relPath, mtimeIso) {
  const key = thumbCacheKey(relPath, mtimeIso);
  const subDir = key.slice(0, 2);
  const thumbPath = path.join(CLOUD_THUMB_ROOT, subDir, `${key}.webp`);
  if (fs.existsSync(thumbPath)) { try { fs.unlinkSync(thumbPath); } catch { /* best-effort */ } }
}

function readDirCached(relPath, absPath) {
  const cached = _dirCache.get(relPath);
  if (cached && Date.now() - cached.ts < DIR_CACHE_TTL_MS) return cached.entries;

  const entries = fs.readdirSync(absPath, { withFileTypes: true }).map((entry) => {
    const entryAbs = path.join(absPath, entry.name);
    const entryStat = fs.statSync(entryAbs);
    const entryRelPath = path.posix.join(relPath, entry.name);
    const isDir = entry.isDirectory();
    const isImage = !isDir && CLOUD_IMAGE_EXT.test(entry.name);
    return {
      name: entry.name,
      type: isDir ? 'directory' : 'file',
      size: isDir ? null : entryStat.size,
      modified_at: entryStat.mtime.toISOString(),
      path: entryRelPath,
      file_url: isDir ? null : `/api/assets/cloud-files/screenshots/file?path=${encodeURIComponent(entryRelPath)}`,
      thumb_url: isImage ? `/api/assets/cloud-files/screenshots/thumb?path=${encodeURIComponent(entryRelPath)}` : null,
    };
  }).sort((a, b) => (a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)));

  _dirCache.set(relPath, { entries, ts: Date.now() });
  return entries;
}

/** Invalidate the directory listing cache entry that contains a given file path. */
function invalidateDirCache(relPath) {
  const parentDir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
  _dirCache.delete(parentDir);
}

router.get('/cloud-files/screenshots', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform admin required' });

    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const absPath = resolveScreenshotsSharePath(relPath);
    if (!absPath) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Path not found on share' });
    if (!fs.statSync(absPath).isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    const entries = readDirCached(relPath, absPath);
    res.json({ path: relPath, entries, share: '\\\\192.168.1.79\\screenshots' });
  } catch (err) {
    console.error('[om-assets] GET /cloud-files/screenshots:', err.message);
    res.status(500).json({ error: 'Failed to list share contents' });
  }
});

router.get('/cloud-files/screenshots/thumb', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform admin required' });

    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const absPath = resolveScreenshotsSharePath(relPath);
    if (!absPath || !fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
      return res.status(404).json({ error: 'File not found on share' });
    }
    if (!CLOUD_IMAGE_EXT.test(path.extname(absPath))) {
      return res.status(400).json({ error: 'Not an image' });
    }

    const mtimeIso = fs.statSync(absPath).mtime.toISOString();
    const thumbPath = await ensureThumbnail(absPath, relPath, mtimeIso);

    const etag = thumbCacheKey(relPath, mtimeIso);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.setHeader('ETag', etag);
    fs.createReadStream(thumbPath).pipe(res);
  } catch (err) {
    console.error('[om-assets] GET /cloud-files/screenshots/thumb:', err.message);
    // Fall back to full file on thumbnail failure
    try {
      const relPath = typeof req.query.path === 'string' ? req.query.path : '';
      const absPath = resolveScreenshotsSharePath(relPath);
      if (absPath && fs.existsSync(absPath)) {
        res.setHeader('Content-Type', mimeFromExt(path.extname(absPath)));
        fs.createReadStream(absPath).pipe(res);
        return;
      }
    } catch { /* fall through */ }
    res.status(500).json({ error: 'Failed to generate thumbnail' });
  }
});

router.get('/cloud-files/screenshots/file', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform admin required' });

    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const absPath = resolveScreenshotsSharePath(relPath);
    if (!absPath || !fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
      return res.status(404).json({ error: 'File not found on share' });
    }

    res.setHeader('Content-Type', mimeFromExt(path.extname(absPath)));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(absPath).pipe(res);
  } catch (err) {
    console.error('[om-assets] GET /cloud-files/screenshots/file:', err.message);
    res.status(500).json({ error: 'Failed to read file from share' });
  }
});

/** Permanently removes a file from the live share. No recovery — this is real personal data, not a managed asset. */
router.delete('/cloud-files/screenshots/file', requireAuth, async (req, res) => {
  try {
    if (!isPlatformAdmin(req)) return res.status(403).json({ error: 'Platform admin required' });

    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const absPath = resolveScreenshotsSharePath(relPath);
    if (!absPath || !fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
      return res.status(404).json({ error: 'File not found on share' });
    }

    // Evict caches before deleting the source
    const mtimeIso = fs.statSync(absPath).mtime.toISOString();
    evictThumbCache(relPath, mtimeIso);
    invalidateDirCache(relPath);

    fs.unlinkSync(absPath);
    res.json({ success: true });
  } catch (err) {
    console.error('[om-assets] DELETE /cloud-files/screenshots/file:', err.message);
    res.status(500).json({ error: 'Failed to delete file from share' });
  }
});

module.exports = router;
