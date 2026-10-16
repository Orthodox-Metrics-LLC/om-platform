/**
 * OM Assets Library — database and filesystem helpers
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');
const { getAppPool } = require('../config/db');
const {
  SCOPES,
  ASSET_TYPES,
  normalizeClassification,
  classifyFilename,
  VISIBILITIES,
  SOURCE_TYPES,
  OWNER_SYSTEMS,
  defaultVisibilityForScope,
  buildLogicalStoragePath,
  resolveAbsolutePath,
  toRelativeStoragePath,
  scopeStorageDir,
  OM_ASSETS_ROOT,
  STORAGE_ROOT,
} = require('./omAssetsConstants');
const {
  canWriteAsset,
  readableScopesForUser,
  readableVisibilitiesForUser,
  resolveListChurchId,
  isPlatformAdmin,
} = require('./omAssetsPermissions');

function ensureStorageDirs() {
  for (const sub of ['public', 'site', 'internal']) {
    fs.mkdirSync(path.join(OM_ASSETS_ROOT, sub), { recursive: true });
  }
}

function parseMetadataJson(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeDirectoryPath(dir) {
  if (!dir || typeof dir !== 'string') return '';
  return dir
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim().replace(/[^a-zA-Z0-9._-]/g, '_'))
    .filter(Boolean)
    .join('/');
}

function getAssetDirectory(asset) {
  const meta = parseMetadataJson(asset?.metadata_json);
  if (meta.directory) return normalizeDirectoryPath(meta.directory);
  if (!asset?.file_path) return '';
  const rel = String(asset.file_path).replace(/^\/+/, '');
  const scopePrefix = rel.match(/^om-assets\/(?:public|site|internal|church-\d+)\/(.+)$/);
  if (!scopePrefix) return '';
  const remainder = scopePrefix[1];
  const slash = remainder.lastIndexOf('/');
  return slash > 0 ? normalizeDirectoryPath(remainder.slice(0, slash)) : '';
}

function getAssetTags(asset) {
  const meta = parseMetadataJson(asset?.metadata_json);
  const raw = meta.tags ?? meta.custom_tags ?? [];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((tag) => String(tag).trim()).filter(Boolean))];
}

function getAssetFolder(asset) {
  if (asset?.folder) return normalizeDirectoryPath(asset.folder);
  return getAssetDirectory(asset);
}

function buildAssetUrls(row) {
  const fileApi = row.id ? `/api/assets/${row.id}/file` : null;
  const isInternalOnly = row.scope === 'internal' || row.visibility === 'internal_only';
  const publicUrl = !isInternalOnly && row.visibility === 'public' && row.scope === 'public'
    ? (row.public_url || fileApi)
    : null;
  const internalUrl = fileApi;
  return { public_url: publicUrl, internal_url: internalUrl, url: internalUrl };
}

function serializeAsset(row) {
  if (!row) return null;
  const metadata_json = parseMetadataJson(row.metadata_json);
  const directory = getAssetFolder({ ...row, metadata_json });
  const tags = getAssetTags({ ...row, metadata_json });
  const urls = buildAssetUrls(row);
  const checksum = row.checksum_sha256 || row.sha256 || null;
  return {
    ...row,
    metadata_json: Object.keys(metadata_json).length ? metadata_json : null,
    directory: directory || null,
    folder: directory || row.folder || null,
    tags,
    primary_tag: metadata_json.primary_tag || null,
    secondary_tag: metadata_json.secondary_tag || null,
    checksum_sha256: checksum,
    sha256: row.sha256 || checksum,
    mime_type: row.mime_type || row.file_type || null,
    created_by: row.created_by ?? row.uploaded_by ?? null,
    collection_name: row.collection_name || null,
    ...urls,
    church_label: row.scope === 'church' && row.church_id
      ? (row.church_name || `church ${row.church_id}`)
      : null,
  };
}

async function getAssetById(id) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT a.*, c.name AS church_name, col.name AS collection_name
     FROM om_assets a
     LEFT JOIN churches c ON c.id = a.church_id
     LEFT JOIN asset_collections col ON col.id = a.collection_id
     WHERE a.id = ?`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Smart-search parser for the asset grid. Recognises media-type synonyms
 * (video, image/photo/picture, document) and year/date-range phrases,
 * then returns structured SQL fragments.
 */
function parseSmartSearch(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const q = raw.toLowerCase().trim();
  if (!q) return null;

  const result = {
    dateRange: null,
    typeGroups: [],
    textTerms: [],
  };

  // Date range: extract any 19xx/20xx years.
  const yearMatches = q.match(/\b(19|20)\d{2}\b/g);
  if (yearMatches) {
    const years = [...new Set(yearMatches.map(Number))].sort((a, b) => a - b);
    if (years.length >= 2) {
      result.dateRange = {
        start: `${years[0]}-01-01`,
        end: `${years[years.length - 1]}-12-31 23:59:59`,
      };
    } else {
      result.dateRange = {
        start: `${years[0]}-01-01`,
        end: `${years[0] + 1}-01-01`,
      };
    }
  }

  // Media-type groups.
  if (/\b(video|videos|mp4|mov|avi|mkv|webm)\b/.test(q)) result.typeGroups.push('video');
  if (/\b(picture|pictures|image|images|photo|photos)\b/.test(q)) result.typeGroups.push('image');
  if (/\b(doc|docs|document|documents|pdf|word|txt|xls|xlsx|ppt|pptx|rtf|odt)\b/.test(q)) {
    result.typeGroups.push('document');
  }

  // Remaining free-text terms (drop date years, type keywords and stop words).
  const stopWords = new Set([
    'from', 'to', 'between', 'and', 'in', 'of', 'for', 'with', 'the', 'a', 'an',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
    'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
    'can', 'need', 'dare', 'ought', 'used', 'than', 'then', 'that', 'this',
    'these', 'those', 'i', 'we', 'you', 'he', 'she', 'it', 'they', 'them',
    'their', 'there', 'where', 'when', 'which', 'while', 'who', 'whom', 'whose',
  ]);

  const typeKeywords = new Set([
    'video', 'videos', 'mp4', 'mov', 'avi', 'mkv', 'webm',
    'picture', 'pictures', 'image', 'images', 'photo', 'photos',
    'doc', 'docs', 'document', 'documents', 'pdf', 'word', 'txt',
    'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'odt',
  ]);

  result.textTerms = q
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .filter((t) => !/^\d{4}$/.test(t))
    .filter((t) => !stopWords.has(t))
    .filter((t) => !typeKeywords.has(t));

  return result;
}

/**
 * Build a smart-search WHERE clause. Returns null if the query is empty or only
 * contains stop words, so callers can fall back to simple text search.
 */
function buildSmartSearchClause(raw) {
  const parsed = parseSmartSearch(raw);
  if (!parsed) return null;

  const { dateRange, typeGroups, textTerms } = parsed;
  const conds = [];
  const params = [];

  if (dateRange) {
    conds.push('a.updated_at >= ? AND a.updated_at <= ?');
    params.push(dateRange.start, dateRange.end);
  }

  if (typeGroups.length) {
    const TYPE_EXTS = {
      video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
      image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff'],
      document: ['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'odt'],
    };
    const TYPE_TERMS = {
      video: ['video', 'videos', 'mp4', 'mov', 'avi', 'mkv', 'webm'],
      image: ['picture', 'pictures', 'image', 'images', 'photo', 'photos'],
      document: ['doc', 'docs', 'document', 'documents', 'pdf', 'word', 'txt', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'odt'],
    };

    const groupClauses = [];
    for (const group of typeGroups) {
      const exts = TYPE_EXTS[group];
      const terms = TYPE_TERMS[group];
      const parts = [`a.file_type IN (${exts.map(() => '?').join(',')})`];
      params.push(...exts);
      for (const term of terms) {
        parts.push('a.name LIKE ?');
        parts.push('a.slug LIKE ?');
        params.push(`%${term}%`, `%${term}%`);
      }
      groupClauses.push(`(${parts.join(' OR ')})`);
    }
    conds.push(`(${groupClauses.join(' OR ')})`);
  }

  if (textTerms.length) {
    const termConds = [];
    for (const term of textTerms) {
      termConds.push('(a.name LIKE ? OR a.slug LIKE ?)');
      params.push(`%${term}%`, `%${term}%`);
    }
    conds.push(`(${termConds.join(' AND ')})`);
  }

  if (!conds.length) return null;
  return { where: conds.join(' AND '), params };
}

/**
 * Build the shared WHERE clause (and bind params) for asset listing/count queries.
 * All permission scoping (readable scopes/visibilities, church restriction) is
 * always applied. `opts.excludeScope` omits only the caller-selected scope filter
 * (used for per-scope counts); `opts.excludeFolder` omits the folder/directory
 * filter (used for per-folder counts). Returns `{ impossible: true }` when the
 * selected scope/visibility is not readable by the user (i.e. no rows possible).
 */
function buildAssetFilterClause(req, filters = {}, opts = {}) {
  const { excludeScope = false, excludeFolder = false } = opts;
  const allowedScopes = readableScopesForUser(req);
  const allowedVisibilities = readableVisibilitiesForUser(req);
  const churchId = resolveListChurchId(req, filters.church_id);
  const conds = ["a.status = 'active'"];
  const params = [];

  if (!excludeScope && filters.scope) {
    if (!allowedScopes.includes(filters.scope)) return { impossible: true };
    conds.push('a.scope = ?');
    params.push(filters.scope);
  } else {
    conds.push(`a.scope IN (${allowedScopes.map(() => '?').join(',')})`);
    params.push(...allowedScopes);
  }

  if (filters.visibility) {
    if (!allowedVisibilities.includes(filters.visibility)) return { impossible: true };
    conds.push('a.visibility = ?');
    params.push(filters.visibility);
  } else {
    conds.push(`a.visibility IN (${allowedVisibilities.map(() => '?').join(',')})`);
    params.push(...allowedVisibilities);
  }

  if (filters.collection_id) {
    conds.push('a.collection_id = ?');
    params.push(Number(filters.collection_id));
  }

  if (filters.source_type && SOURCE_TYPES.has(filters.source_type)) {
    conds.push('a.source_type = ?');
    params.push(filters.source_type);
  }

  if (filters.owner_system && OWNER_SYSTEMS.has(filters.owner_system)) {
    conds.push('a.owner_system = ?');
    params.push(filters.owner_system);
  }

  if (!excludeFolder && filters.folder) {
    const folder = normalizeDirectoryPath(filters.folder);
    if (folder) {
      conds.push("(a.folder = ? OR JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.directory')) = ?)");
      params.push(folder, folder);
    }
  }

  if (filters.category) {
    if (ASSET_TYPES.has(filters.category)) {
      conds.push('a.category = ?');
      params.push(filters.category);
    } else {
      // Legacy subject filters (screenshot, header, …) match the primary tag
      // after those values moved out of the type column.
      conds.push("(a.category = ? OR JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.primary_tag')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.secondary_tag')) = ?)");
      params.push(filters.category, filters.category, filters.category);
    }
  }

  if (filters.primary_tag) {
    conds.push("JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.primary_tag')) = ?");
    params.push(String(filters.primary_tag));
  }

  if (filters.secondary_tag) {
    conds.push("JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.secondary_tag')) = ?");
    params.push(String(filters.secondary_tag));
  }

  if (filters.search) {
    if (filters.smartSearch) {
      const smartClause = buildSmartSearchClause(filters.search);
      if (smartClause) {
        conds.push(`(${smartClause.where})`);
        params.push(...smartClause.params);
      } else {
        // Smart parser found nothing actionable; fall back to simple text search.
        conds.push('(a.name LIKE ? OR a.slug LIKE ?)');
        const q = `%${filters.search}%`;
        params.push(q, q);
      }
    } else {
      conds.push('(a.name LIKE ? OR a.slug LIKE ?)');
      const q = `%${filters.search}%`;
      params.push(q, q);
    }
  }

  if (!excludeFolder && filters.directory) {
    const dir = normalizeDirectoryPath(filters.directory);
    if (dir) {
      conds.push("JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.directory')) = ?");
      params.push(dir);
    }
  }

  if (filters.tag) {
    const tag = String(filters.tag).trim();
    if (tag) {
      conds.push("JSON_SEARCH(a.metadata_json, 'one', ?, NULL, '$.tags') IS NOT NULL");
      params.push(tag);
    }
  }

  if (filters.file_type) {
    const types = String(filters.file_type).toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
    if (types.length === 1) {
      conds.push('a.file_type = ?');
      params.push(types[0]);
    } else if (types.length > 1) {
      conds.push(`a.file_type IN (${types.map(() => '?').join(',')})`);
      params.push(...types);
    }
  }

  if (filters.date_from) {
    conds.push('a.updated_at >= ?');
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conds.push('a.updated_at <= ?');
    params.push(filters.date_to);
  }

  if (churchId) {
    conds.push("(a.scope != 'church' OR a.church_id = ?)");
    params.push(churchId);
  } else if (!allowedScopes.includes('site') && allowedScopes.includes('church')) {
    const userCid = resolveListChurchId(req);
    if (userCid) {
      conds.push("(a.scope != 'church' OR a.church_id = ?)");
      params.push(userCid);
    } else {
      conds.push("a.scope != 'church'");
    }
  }

  return { where: conds.join(' AND '), params };
}

async function listAssets(req, filters = {}) {
  const pool = getAppPool();
  const clause = buildAssetFilterClause(req, filters);
  if (clause.impossible) return [];

  let query = `SELECT a.*, c.name AS church_name, col.name AS collection_name
    FROM om_assets a
    LEFT JOIN churches c ON c.id = a.church_id
    LEFT JOIN asset_collections col ON col.id = a.collection_id
    WHERE ${clause.where}`;
  const params = [...clause.params];

  query += ` ORDER BY ${parseSortOrder(filters.sort)}`;
  const limit = Math.min(Number(filters.limit) || 200, 500);
  query += ' LIMIT ?';
  params.push(limit);

  const offset = Math.max(Math.floor(Number(filters.offset) || 0), 0);
  if (offset > 0) {
    query += ' OFFSET ?';
    params.push(offset);
  }

  const [rows] = await pool.query(query, params);
  return rows.map(serializeAsset);
}

/** Total number of assets matching the given filters (ignores limit/offset). */
async function countAssets(req, filters = {}) {
  const pool = getAppPool();
  const clause = buildAssetFilterClause(req, filters);
  if (clause.impossible) return 0;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM om_assets a WHERE ${clause.where}`,
    clause.params,
  );
  return Number(rows[0]?.total) || 0;
}

/**
 * Per-scope asset counts for the current filter set (excluding the selected
 * scope, so every chip shows how many assets it would reveal). Single grouped
 * query — no N+1.
 */
async function getScopeCounts(req, filters = {}) {
  const pool = getAppPool();
  const clause = buildAssetFilterClause(req, filters, { excludeScope: true });
  const counts = {};
  if (clause.impossible) return counts;
  const [rows] = await pool.query(
    `SELECT a.scope AS scope, COUNT(*) AS c FROM om_assets a WHERE ${clause.where} GROUP BY a.scope`,
    clause.params,
  );
  for (const row of rows) counts[row.scope] = Number(row.c) || 0;
  return counts;
}

/**
 * Per-folder asset counts for the current filter set (excluding the selected
 * folder/directory filter). Single grouped query — no N+1.
 */
async function getFolderCounts(req, filters = {}) {
  const pool = getAppPool();
  const clause = buildAssetFilterClause(req, filters, { excludeFolder: true });
  const counts = {};
  if (clause.impossible) return counts;
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(a.folder, ''), JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.directory'))) AS folder,
            COUNT(*) AS c
     FROM om_assets a WHERE ${clause.where}
     GROUP BY folder`,
    clause.params,
  );
  for (const row of rows) {
    if (!row.folder) continue;
    counts[row.folder] = Number(row.c) || 0;
  }
  return counts;
}

const SORT_ORDERS = {
  name: 'a.name ASC',
  name_desc: 'a.name DESC',
  scope: 'a.scope ASC, a.name ASC',
  scope_desc: 'a.scope DESC, a.name ASC',
  size: 'COALESCE(a.file_size, 0) ASC, a.name ASC',
  size_desc: 'COALESCE(a.file_size, 0) DESC, a.name ASC',
  created: 'a.created_at ASC, a.id ASC',
  created_desc: 'a.created_at DESC, a.id DESC',
  updated: 'a.updated_at ASC, a.id ASC',
  updated_desc: 'a.updated_at DESC, a.id DESC',
  category: 'a.category ASC, a.name ASC',
  category_desc: 'a.category DESC, a.name ASC',
};

function parseSortOrder(sort) {
  const key = String(sort || '').toLowerCase();
  return SORT_ORDERS[key] || SORT_ORDERS.name;
}

/**
 * Keyset (cursor) sort definitions. Each defines the primary sort column and
 * direction; the unique tie-breaker is always `a.id` in the same direction so
 * the (column, id) pair is a total, stable ordering safe for cursor traversal
 * even while rows are inserted/deleted mid-browse. `key` names the field read
 * from the last row of a page to build the next cursor.
 */
const KEYSET_SORTS = {
  name: { col: 'a.name', dir: 'ASC', key: 'name' },
  name_desc: { col: 'a.name', dir: 'DESC', key: 'name' },
  scope: { col: 'a.scope', dir: 'ASC', key: 'scope' },
  scope_desc: { col: 'a.scope', dir: 'DESC', key: 'scope' },
  size: { col: 'COALESCE(a.file_size, 0)', dir: 'ASC', key: 'size' },
  size_desc: { col: 'COALESCE(a.file_size, 0)', dir: 'DESC', key: 'size' },
  created: { col: 'a.created_at', dir: 'ASC', key: 'created' },
  created_desc: { col: 'a.created_at', dir: 'DESC', key: 'created' },
  updated: { col: 'a.updated_at', dir: 'ASC', key: 'updated' },
  updated_desc: { col: 'a.updated_at', dir: 'DESC', key: 'updated' },
  category: { col: 'a.category', dir: 'ASC', key: 'category' },
  category_desc: { col: 'a.category', dir: 'DESC', key: 'category' },
};

function keysetSort(sort) {
  return KEYSET_SORTS[String(sort || '').toLowerCase()] || KEYSET_SORTS.created_desc;
}

function encodeCursor(payload) {
  if (!payload) return null;
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed && parsed.id != null) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Read the primary keyset value from a raw DB row (created/updated use formatted aliases). */
function cursorValueFromRow(ks, row) {
  switch (ks.key) {
    case 'created': return row.created_cursor;
    case 'updated': return row.updated_cursor;
    case 'size': return Number(row.file_size || 0);
    case 'name': return row.name;
    case 'scope': return row.scope;
    case 'category': return row.category || '';
    default: return row.created_cursor;
  }
}

/**
 * Cursor-based (keyset) page of assets. Applies the same permission/filter
 * clause as {@link listAssets}, then a keyset predicate derived from the sort
 * so the query itself is limited to one page. Fetches `limit + 1` rows to
 * detect whether more pages exist without a second COUNT round-trip.
 *
 * @returns {{ assets: object[], nextCursor: string|null, hasMore: boolean }}
 */
async function listAssetsPage(req, filters = {}) {
  const pool = getAppPool();
  const clause = buildAssetFilterClause(req, filters);
  if (clause.impossible) return { assets: [], nextCursor: null, hasMore: false };

  const ks = keysetSort(filters.sort);
  const conds = [clause.where];
  const params = [...clause.params];

  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    const cmp = ks.dir === 'DESC' ? '<' : '>';
    conds.push(`(${ks.col} ${cmp} ? OR (${ks.col} = ? AND a.id ${cmp} ?))`);
    const v = cursor.v;
    params.push(v, v, Number(cursor.id));
  }

  const limit = Math.min(Math.max(Math.floor(Number(filters.limit) || 48), 1), 100);

  const query = `SELECT a.*, c.name AS church_name, col.name AS collection_name,
      DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_cursor,
      DATE_FORMAT(a.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_cursor
    FROM om_assets a
    LEFT JOIN churches c ON c.id = a.church_id
    LEFT JOIN asset_collections col ON col.id = a.collection_id
    WHERE ${conds.join(' AND ')}
    ORDER BY ${ks.col} ${ks.dir}, a.id ${ks.dir}
    LIMIT ?`;
  params.push(limit + 1);

  const [rows] = await pool.query(query, params);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor({ v: cursorValueFromRow(ks, last), id: last.id })
    : null;

  return { assets: pageRows.map(serializeAsset), nextCursor, hasMore };
}

async function listDuplicateGroups(req) {
  const assets = await listAssets(req, { limit: 500 });
  const byHash = new Map();
  for (const asset of assets) {
    if (!asset.sha256) continue;
    if (!byHash.has(asset.sha256)) byHash.set(asset.sha256, []);
    byHash.get(asset.sha256).push(asset);
  }
  return Array.from(byHash.entries())
    .filter(([, group]) => group.length > 1)
    .map(([sha256, groupAssets]) => ({
      type: 'exact',
      sha256,
      assets: groupAssets,
    }))
    .sort((a, b) => b.assets.length - a.assets.length);
}

async function listSimilarGroups(req) {
  const assets = await listAssets(req, { limit: 500 });
  const byKey = new Map();
  for (const asset of assets) {
    if (!asset.width || !asset.height) continue;
    const key = `${asset.category}|${asset.width}|${asset.height}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(asset);
  }
  return Array.from(byKey.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, groupAssets]) => {
      const [category, width, height] = key.split('|');
      return {
        type: 'similar',
        key,
        category,
        width: Number(width),
        height: Number(height),
        assets: groupAssets,
      };
    })
    .sort((a, b) => b.assets.length - a.assets.length);
}

async function listDirectories(req, filters = {}) {
  const assets = await listAssets(req, {
    scope: filters.scope,
    church_id: filters.church_id,
    limit: 500,
  });
  const dirs = new Set();
  for (const asset of assets) {
    const dir = getAssetDirectory(asset);
    if (dir) {
      dirs.add(dir);
      dir.split('/').reduce((acc, part) => {
        const next = acc ? `${acc}/${part}` : part;
        dirs.add(next);
        return next;
      }, '');
    }
  }

  const allowedScopes = readableScopesForUser(req);
  const scopesToScan = filters.scope
    ? (allowedScopes.includes(filters.scope) ? [filters.scope] : [])
    : allowedScopes;

  for (const scope of scopesToScan) {
    let churchId = null;
    if (scope === 'church') {
      churchId = resolveListChurchId(req, filters.church_id);
      if (!churchId) continue;
    }
    try {
      const root = scopeStorageDir(scope, churchId);
      collectFilesystemDirectories(root, '', dirs);
    } catch {
      // skip unreadable scope roots
    }
  }

  return Array.from(dirs).sort((a, b) => a.localeCompare(b));
}

function collectFilesystemDirectories(rootDir, relativePrefix, dirs) {
  if (!fs.existsSync(rootDir)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    dirs.add(normalizeDirectoryPath(rel));
    collectFilesystemDirectories(path.join(rootDir, entry.name), rel, dirs);
  }
}

async function createDirectory(scope, churchId, dirPath) {
  const normalized = normalizeDirectoryPath(dirPath);
  if (!normalized) throw new Error('Directory path is required');
  const absDir = path.join(
    scopeStorageDir(scope, scope === 'church' ? churchId : null),
    normalized,
  );
  fs.mkdirSync(absDir, { recursive: true });
  return normalized;
}

async function moveAssetsToDirectory(ids, directory) {
  const pool = getAppPool();
  const normalized = normalizeDirectoryPath(directory);
  const updated = [];

  for (const id of ids) {
    const asset = await getAssetById(id);
    if (!asset) continue;

    const scopeDir = scopeStorageDir(
      asset.scope,
      asset.scope === 'church' ? asset.church_id : null,
    );
    const targetDir = normalized ? path.join(scopeDir, normalized) : scopeDir;
    fs.mkdirSync(targetDir, { recursive: true });

    let relPath = asset.file_path;
    const currentPath = resolveAssetFilePath(asset);
    if (currentPath && fs.existsSync(currentPath)) {
      const fileName = path.basename(currentPath);
      let destPath = path.join(targetDir, fileName);
      if (path.resolve(destPath) !== path.resolve(currentPath)) {
        if (fs.existsSync(destPath)) {
          const ext = path.extname(fileName);
          const base = path.basename(fileName, ext);
          destPath = path.join(targetDir, `${base}-${Date.now()}${ext}`);
        }
        try {
          fs.renameSync(currentPath, destPath);
        } catch {
          fs.copyFileSync(currentPath, destPath);
          fs.unlinkSync(currentPath);
        }
        relPath = toRelativeStoragePath(destPath);
      }
    }

    const meta = parseMetadataJson(asset.metadata_json);
    if (normalized) meta.directory = normalized;
    else delete meta.directory;

    await pool.query(
      `UPDATE om_assets SET file_path = ?, metadata_json = ?, updated_at = NOW() WHERE id = ?`,
      [relPath, Object.keys(meta).length ? JSON.stringify(meta) : null, id],
    );
    updated.push(await getAssetById(id));
  }

  return updated;
}

function sameClassification(current, suggested) {
  return current.category === suggested.category
    && (current.primary_tag || null) === (suggested.primary_tag || null)
    && (current.secondary_tag || null) === (suggested.secondary_tag || null);
}

/** First filename that implies a different type or tags than the asset has now. */
function suggestClassificationForAsset(row) {
  const meta = parseMetadataJson(row?.metadata_json);
  const current = {
    category: row?.category,
    primary_tag: meta.primary_tag || null,
    secondary_tag: meta.secondary_tag || null,
  };
  const labels = [row?.name, row?.title, row?.original_filename, row?.stored_filename, row?.display_name];
  for (const label of labels) {
    const suggested = classifyFilename(label);
    if (suggested && !sameClassification(current, suggested)) return suggested;
  }
  return null;
}

async function bulkChangeAssetCategory(ids, classification) {
  const classified = normalizeClassification(classification);
  if (!ASSET_TYPES.has(classified.category)) {
    throw new Error('Valid type is required');
  }
  const pool = getAppPool();
  const numericIds = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id)),
  )];
  if (!numericIds.length) return [];

  const updated = [];
  for (const id of numericIds) {
    const asset = await getAssetById(id);
    if (!asset) continue;
    const meta = parseMetadataJson(asset.metadata_json);
    if (classified.primary_tag) meta.primary_tag = classified.primary_tag;
    else delete meta.primary_tag;
    if (classified.secondary_tag) meta.secondary_tag = classified.secondary_tag;
    else delete meta.secondary_tag;
    await pool.query(
      `UPDATE om_assets SET category = ?, metadata_json = ?, updated_at = NOW() WHERE id = ?`,
      [classified.category, Object.keys(meta).length ? JSON.stringify(meta) : null, id],
    );
    updated.push(await getAssetById(id));
  }
  return updated;
}

/**
 * Active assets the caller can write whose file name starts with a category
 * they are not already in.
 */
async function listCategoryNameSuggestions(req) {
  const pool = getAppPool();
  const clause = buildAssetFilterClause(req, {});
  if (clause.impossible) return [];

  const [rows] = await pool.query(
    `SELECT a.id, a.name, a.title, a.original_filename, a.stored_filename, a.display_name,
            a.category, a.metadata_json, a.scope, a.church_id
     FROM om_assets a
     WHERE ${clause.where}`,
    clause.params,
  );

  const suggestions = [];
  for (const row of rows) {
    if (!canWriteAsset(req, row)) continue;
    const suggested = suggestClassificationForAsset(row);
    if (!suggested) continue;
    const meta = parseMetadataJson(row.metadata_json);
    suggestions.push({
      id: row.id,
      name: row.name,
      category: row.category,
      primary_tag: meta.primary_tag || null,
      secondary_tag: meta.secondary_tag || null,
      suggested_category: suggested.category,
      suggested_primary_tag: suggested.primary_tag,
      suggested_secondary_tag: suggested.secondary_tag,
    });
  }
  return suggestions;
}

async function bulkSetAssetTags(ids, tags, mode = 'set') {
  const pool = getAppPool();
  const normalizedTags = [...new Set(
    (Array.isArray(tags) ? tags : [])
      .map((tag) => String(tag).trim())
      .filter(Boolean),
  )];
  const updated = [];

  for (const id of ids) {
    const asset = await getAssetById(id);
    if (!asset) continue;
    const meta = parseMetadataJson(asset.metadata_json);
    const existing = getAssetTags(asset);

    let nextTags = existing;
    if (mode === 'add') {
      nextTags = [...new Set([...existing, ...normalizedTags])];
    } else if (mode === 'remove') {
      const removeSet = new Set(normalizedTags);
      nextTags = existing.filter((tag) => !removeSet.has(tag));
    } else {
      nextTags = normalizedTags;
    }

    if (nextTags.length) meta.tags = nextTags;
    else delete meta.tags;

    await pool.query(
      `UPDATE om_assets SET metadata_json = ?, updated_at = NOW() WHERE id = ?`,
      [Object.keys(meta).length ? JSON.stringify(meta) : null, id],
    );
    updated.push(await getAssetById(id));
  }

  return updated;
}

async function bulkDeleteDuplicates(req) {
  const groups = await listDuplicateGroups(req);
  const toArchive = [];
  for (const group of groups) {
    const sorted = [...group.assets].sort((a, b) => a.id - b.id);
    for (let i = 1; i < sorted.length; i += 1) {
      toArchive.push(sorted[i].id);
    }
  }
  if (!toArchive.length) {
    return { archived: 0, groups: groups.length, removed_ids: [] };
  }
  const archived = await bulkArchiveAssets(toArchive);
  return { archived, groups: groups.length, removed_ids: toArchive };
}

async function listAllTags(req, filters = {}) {
  const assets = await listAssets(req, {
    scope: filters.scope,
    church_id: filters.church_id,
    limit: 500,
  });
  const tags = new Set();
  for (const asset of assets) {
    getAssetTags(asset).forEach((tag) => tags.add(tag));
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

async function bulkArchiveAssets(ids) {
  const pool = getAppPool();
  const unique = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!unique.length) return 0;
  const [result] = await pool.query(
    `UPDATE om_assets SET status = 'archived', updated_at = NOW()
     WHERE id IN (${unique.map(() => '?').join(',')}) AND status = 'active'`,
    unique,
  );
  return result.affectedRows || 0;
}

async function moveAssetFile(asset, newScope, newChurchId) {
  const currentPath = resolveAssetFilePath(asset);
  if (!currentPath || !fs.existsSync(currentPath)) {
    throw new Error('Asset file not found on disk');
  }
  const newDir = scopeStorageDir(newScope, newScope === 'church' ? newChurchId : null);
  fs.mkdirSync(newDir, { recursive: true });
  const fileName = path.basename(currentPath);
  let destPath = path.join(newDir, fileName);
  if (path.resolve(destPath) === path.resolve(currentPath)) {
    return toRelativeStoragePath(currentPath);
  }
  if (fs.existsSync(destPath)) {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    destPath = path.join(newDir, `${base}-${Date.now()}${ext}`);
  }
  try {
    fs.renameSync(currentPath, destPath);
  } catch {
    fs.copyFileSync(currentPath, destPath);
    fs.unlinkSync(currentPath);
  }
  return toRelativeStoragePath(destPath);
}

async function changeAssetScope(id, newScope, newChurchId, newVisibility) {
  const pool = getAppPool();
  const asset = await getAssetById(id);
  if (!asset) throw new Error('Asset not found');
  if (asset.source_type === 'quarantine') {
    throw new Error('Quarantined assets cannot change scope — view or delete only');
  }
  if (!SCOPES.has(newScope)) throw new Error('Invalid scope');
  const churchId = newScope === 'church' ? Number(newChurchId) : null;
  if (newScope === 'church' && (!Number.isFinite(churchId) || churchId <= 0)) {
    throw new Error('church_id required for church scope');
  }

  const relPath = asset.file_path
    ? await moveAssetFile(asset, newScope, churchId)
    : asset.file_path;

  const visibility = newScope === 'internal'
    ? 'internal_only'
    : (newVisibility && VISIBILITIES.has(newVisibility)
      ? newVisibility
      : defaultVisibilityForScope(newScope));

  const fileName = relPath ? path.basename(relPath) : null;
  const storage_path = fileName
    ? buildLogicalStoragePath(newScope, churchId, fileName)
    : asset.storage_path;

  await pool.query(
    `UPDATE om_assets SET scope = ?, church_id = ?, file_path = ?, visibility = ?,
     storage_path = ?, updated_at = NOW() WHERE id = ?`,
    [newScope, churchId, relPath, visibility, storage_path, id],
  );

  const updated = await getAssetById(id);
  if (updated?.id) {
    const isInternalOnly = visibility === 'internal_only' || newScope === 'internal';
    const apiUrl = `/api/assets/${updated.id}/file`;
    const pubUrl = !isInternalOnly && visibility === 'public' ? apiUrl : null;
    await pool.query(
      'UPDATE om_assets SET internal_url = ?, public_url = ? WHERE id = ?',
      [apiUrl, pubUrl, updated.id],
    );
  }
  return getAssetById(id);
}

/** Copy asset to a new scope (original unchanged) — super_admin promote/copy */
async function copyAssetToScope(id, { target_scope, target_visibility, church_id, collection_id, actor_user_id }) {
  const asset = await getAssetById(id);
  if (!asset) throw new Error('Asset not found');
  if (asset.source_type === 'quarantine') {
    throw new Error('Quarantined assets cannot be copied/promoted — view or delete only');
  }
  if (!SCOPES.has(target_scope)) throw new Error('Invalid target scope');

  const srcPath = resolveAssetFilePath(asset);
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error('Source file not found');

  const targetChurchId = target_scope === 'church' ? Number(church_id) : null;
  if (target_scope === 'church' && (!Number.isFinite(targetChurchId) || targetChurchId <= 0)) {
    throw new Error('church_id required for church scope');
  }

  const targetDir = scopeStorageDir(target_scope, targetChurchId);
  fs.mkdirSync(targetDir, { recursive: true });
  const ext = path.extname(srcPath);
  const destName = `${Date.now()}-copy-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const destPath = path.join(targetDir, destName);
  fs.copyFileSync(srcPath, destPath);

  const relPath = toRelativeStoragePath(destPath);
  const buf = fs.readFileSync(destPath);
  const hash = hashFileBuffer(buf);
  let width = asset.width;
  let height = asset.height;
  let file_size = buf.length;
  try {
    const meta = await readImageMetaFromPath(destPath);
    width = meta.width;
    height = meta.height;
    file_size = meta.file_size || file_size;
  } catch {
    // non-image
  }

  const visibility = target_scope === 'internal'
    ? 'internal_only'
    : (target_visibility && VISIBILITIES.has(target_visibility)
      ? target_visibility
      : defaultVisibilityForScope(target_scope));

  const storage_path = buildLogicalStoragePath(target_scope, targetChurchId, destName);

  const productTags = (() => {
    if (!asset.product_tags) return null;
    if (typeof asset.product_tags === 'object') return asset.product_tags;
    try {
      return JSON.parse(asset.product_tags);
    } catch {
      return null;
    }
  })();

  const copy = await createAssetRecord({
    name: `${asset.name} (copy)`,
    title: asset.title,
    description: asset.description,
    alt_text: asset.alt_text,
    caption: asset.caption,
    credit: asset.credit,
    scope: target_scope,
    visibility,
    church_id: targetChurchId,
    collection_id: collection_id ?? asset.collection_id,
    folder: asset.folder,
    category: asset.category,
    file_path: relPath,
    storage_path,
    file_type: asset.file_type,
    mime_type: asset.mime_type || asset.file_type,
    width,
    height,
    file_size,
    metadata_json: parseMetadataJson(asset.metadata_json),
    licensing_note: asset.licensing_note,
    product_tags: productTags,
    sha256: hash,
    source_type: 'promote_copy',
    owner_system: asset.owner_system || 'om',
    uploaded_by: actor_user_id,
    created_by: actor_user_id,
  });

  return copy;
}

async function bulkChangeScope(ids, newScope, newChurchId, newVisibility) {
  const updated = [];
  for (const id of ids) {
    updated.push(await changeAssetScope(id, newScope, newChurchId, newVisibility));
  }
  return updated;
}

async function readImageMetaFromPath(fullPath) {
  try {
    const stat = fs.statSync(fullPath);
    const meta = await sharp(fullPath).metadata();
    return {
      width: meta.width || null,
      height: meta.height || null,
      file_size: stat.size,
    };
  } catch {
    const stat = fs.statSync(fullPath);
    return { width: null, height: null, file_size: stat.size };
  }
}

async function transformAssetImage(id, options = {}) {
  const pool = getAppPool();
  const asset = await getAssetById(id);
  if (!asset) throw new Error('Asset not found');
  const fullPath = resolveAssetFilePath(asset);
  if (!fullPath || !fs.existsSync(fullPath)) throw new Error('File not found on disk');

  let pipeline = sharp(fullPath);
  const rotate = Number(options.rotate);
  if (Number.isFinite(rotate) && rotate % 360 !== 0) {
    pipeline = pipeline.rotate(rotate);
  }

  const crop = options.crop;
  if (crop && crop.width > 0 && crop.height > 0) {
    pipeline = pipeline.extract({
      left: Math.max(0, Math.round(Number(crop.left) || 0)),
      top: Math.max(0, Math.round(Number(crop.top) || 0)),
      width: Math.round(Number(crop.width)),
      height: Math.round(Number(crop.height)),
    });
  }

  const targetW = Number(options.width);
  const targetH = Number(options.height);
  if ((Number.isFinite(targetW) && targetW > 0) || (Number.isFinite(targetH) && targetH > 0)) {
    pipeline = pipeline.resize(
      Number.isFinite(targetW) && targetW > 0 ? targetW : null,
      Number.isFinite(targetH) && targetH > 0 ? targetH : null,
      { fit: 'inside', withoutEnlargement: false },
    );
  }

  const buffer = await pipeline.toBuffer();
  fs.writeFileSync(fullPath, buffer);
  const meta = await sharp(buffer).metadata();
  const sha256 = hashFileBuffer(buffer);
  await pool.query(
    `UPDATE om_assets SET width = ?, height = ?, file_size = ?, sha256 = ?, updated_at = NOW() WHERE id = ?`,
    [meta.width || null, meta.height || null, buffer.length, sha256, id],
  );
  return getAssetById(id);
}

/**
 * Split one raster image asset into an nRows × nCols grid of separate image
 * files. Each tile is registered as a NEW asset in the SAME scope / church /
 * category / folder as the source (so it inherits the corrected category→
 * subdirectory placement) and physically lands alongside the source file.
 * The source asset is left untouched unless `deleteSource` is set.
 */
async function splitAssetImage(asset, { rows, cols, deleteSource = false, actorUserId = null } = {}) {
  if (!asset) throw new Error('Asset not found');
  const nRows = Math.max(1, Math.min(12, Math.floor(Number(rows) || 0)));
  const nCols = Math.max(1, Math.min(12, Math.floor(Number(cols) || 0)));
  if (nRows * nCols < 2) throw new Error('Split must produce at least 2 tiles');

  const srcPath = resolveAssetFilePath(asset);
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error('Source file not found on disk');

  const ext = path.extname(srcPath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
    throw new Error('Split supports PNG, JPEG, WebP, and GIF images only');
  }

  const meta = await sharp(srcPath).metadata();
  const imgW = meta.width;
  const imgH = meta.height;
  if (!imgW || !imgH) throw new Error('Could not read source image dimensions');

  const destDir = path.dirname(srcPath);
  const baseName = path.basename(srcPath, path.extname(srcPath));
  const folder = asset.folder ? normalizeDirectoryPath(asset.folder) : null;
  const churchId = asset.scope === 'church' ? asset.church_id : null;
  const srcMeta = parseMetadataJson(asset.metadata_json);
  const srcTags = getAssetTags(asset);
  const productTags = (() => {
    if (!asset.product_tags) return null;
    if (typeof asset.product_tags === 'object') return asset.product_tags;
    try { return JSON.parse(asset.product_tags); } catch { return null; }
  })();
  const mime = asset.mime_type || asset.file_type || null;
  const creator = actorUserId ?? asset.created_by ?? asset.uploaded_by ?? null;

  const created = [];
  for (let r = 0; r < nRows; r += 1) {
    for (let c = 0; c < nCols; c += 1) {
      // Edge-to-edge integer boundaries so tiles fully tile the image with no gaps.
      const left = Math.round((c * imgW) / nCols);
      const top = Math.round((r * imgH) / nRows);
      const right = Math.round(((c + 1) * imgW) / nCols);
      const bottom = Math.round(((r + 1) * imgH) / nRows);
      const w = right - left;
      const h = bottom - top;
      if (w <= 0 || h <= 0) continue;

      // eslint-disable-next-line no-await-in-loop
      const buffer = await sharp(srcPath).extract({ left, top, width: w, height: h }).toBuffer();

      const suffix = `r${r + 1}c${c + 1}`;
      let tileName = `${baseName}-${suffix}${ext}`;
      let destPath = path.join(destDir, tileName);
      if (fs.existsSync(destPath)) {
        tileName = `${baseName}-${suffix}-${Date.now()}${ext}`;
        destPath = path.join(destDir, tileName);
      }
      fs.writeFileSync(destPath, buffer);

      const relPath = toRelativeStoragePath(destPath);
      const storage_path = buildLogicalStoragePath(
        asset.scope,
        churchId,
        folder ? `${folder}/${tileName}` : tileName,
      );
      const hash = hashFileBuffer(buffer);
      // eslint-disable-next-line no-await-in-loop
      const tileMeta = await sharp(buffer).metadata();

      const tileMetadata = { ...srcMeta };
      delete tileMetadata.legacy_url;
      if (srcTags.length) tileMetadata.tags = srcTags;

      // eslint-disable-next-line no-await-in-loop
      const tile = await createAssetRecord({
        name: `${asset.name} ${suffix}`,
        title: asset.title ? `${asset.title} ${suffix}` : `${asset.name} ${suffix}`,
        description: asset.description || null,
        alt_text: asset.alt_text || null,
        caption: asset.caption || null,
        credit: asset.credit || null,
        scope: asset.scope,
        visibility: asset.visibility,
        church_id: churchId,
        collection_id: asset.collection_id || null,
        folder,
        category: asset.category,
        file_path: relPath,
        storage_path,
        file_type: mime,
        mime_type: mime,
        width: tileMeta.width || w,
        height: tileMeta.height || h,
        file_size: buffer.length,
        metadata_json: tileMetadata,
        licensing_note: asset.licensing_note || null,
        product_tags: productTags,
        sha256: hash,
        source_type: 'generated',
        owner_system: asset.owner_system || 'om',
        uploaded_by: creator,
        created_by: creator,
        original_filename: tileName,
        stored_filename: tileName,
        display_name: `${asset.name} ${suffix}`,
        content_hash: hash,
      });
      created.push(tile);
    }
  }

  if (deleteSource) {
    await archiveAsset(asset.id);
  }

  return created;
}

async function createAssetRecord({
  name,
  title,
  description,
  alt_text,
  caption,
  credit,
  scope,
  visibility,
  church_id,
  collection_id,
  folder,
  category,
  primary_tag,
  secondary_tag,
  file_path,
  file_type,
  mime_type,
  width,
  height,
  file_size,
  metadata_json,
  licensing_note,
  product_tags,
  sha256,
  checksum_sha256,
  storage_path,
  public_url,
  internal_url,
  source_type,
  owner_system,
  uploaded_by,
  created_by,
  legacy_source,
  legacy_id,
  original_filename,
  stored_filename,
  display_name,
  content_hash,
  smart_rename_applied,
  smart_metadata_applied,
  classification_source,
  category_confidence,
}) {
  const pool = getAppPool();
  const vis = visibility && VISIBILITIES.has(visibility)
    ? visibility
    : defaultVisibilityForScope(scope);
  const resolvedVisibility = scope === 'internal' ? 'internal_only' : vis;
  const hash = checksum_sha256 || sha256 || null;
  const mime = mime_type || file_type || null;
  const creator = created_by ?? uploaded_by ?? null;
  const srcType = source_type && SOURCE_TYPES.has(source_type) ? source_type : 'upload';
  const owner = owner_system && OWNER_SYSTEMS.has(owner_system) ? owner_system : 'om';
  const normalizedFolder = folder ? normalizeDirectoryPath(folder) : null;

  let meta = metadata_json && typeof metadata_json === 'object' ? { ...metadata_json } : {};
  if (normalizedFolder) meta.directory = normalizedFolder;
  const classified = normalizeClassification({
    category,
    primary_tag: primary_tag !== undefined ? primary_tag : meta.primary_tag,
    secondary_tag: secondary_tag !== undefined ? secondary_tag : meta.secondary_tag,
    file_type,
    mime_type: mime,
  });
  if (classified.primary_tag) meta.primary_tag = classified.primary_tag;
  else delete meta.primary_tag;
  if (classified.secondary_tag) meta.secondary_tag = classified.secondary_tag;
  else delete meta.secondary_tag;

  const classificationSource = ['manual', 'smart', 'edited'].includes(classification_source)
    ? classification_source
    : 'manual';
  const categoryConfidence = Number.isFinite(Number(category_confidence))
    ? Math.max(0, Math.min(1, Number(category_confidence)))
    : null;
  const storedName = stored_filename || (file_path ? path.basename(file_path) : null);

  const [result] = await pool.query(
    `INSERT INTO om_assets
     (name, title, description, alt_text, caption, credit, scope, visibility, collection_id, folder,
      church_id, category, file_path, storage_path, public_url, internal_url, file_type, mime_type,
      width, height, file_size, metadata_json, licensing_note, product_tags, sha256, checksum_sha256,
      source_type, owner_system, uploaded_by, created_by, legacy_source, legacy_id,
      original_filename, stored_filename, display_name, content_hash,
      smart_rename_applied, smart_metadata_applied, classification_source, category_confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      title || null,
      description || null,
      alt_text || null,
      caption || null,
      credit || null,
      scope,
      resolvedVisibility,
      collection_id || null,
      normalizedFolder,
      scope === 'church' ? church_id : null,
      classified.category,
      file_path,
      storage_path || null,
      public_url || null,
      internal_url || null,
      file_type || null,
      mime,
      width || null,
      height || null,
      file_size || null,
      Object.keys(meta).length ? JSON.stringify(meta) : null,
      licensing_note || null,
      product_tags ? JSON.stringify(product_tags) : null,
      hash,
      hash,
      srcType,
      owner,
      uploaded_by || creator,
      creator,
      legacy_source || null,
      legacy_id || null,
      original_filename || null,
      storedName,
      display_name || title || name || null,
      content_hash || hash,
      smart_rename_applied ? 1 : 0,
      smart_metadata_applied ? 1 : 0,
      classificationSource,
      categoryConfidence,
    ],
  );
  const asset = await getAssetById(result.insertId);
  if (asset?.id && file_path) {
    const apiUrl = `/api/assets/${asset.id}/file`;
    const isInternalOnly = resolvedVisibility === 'internal_only' || scope === 'internal';
    const pubUrl = !isInternalOnly && resolvedVisibility === 'public' ? apiUrl : null;
    await pool.query(
      'UPDATE om_assets SET internal_url = ?, public_url = ? WHERE id = ?',
      [apiUrl, pubUrl, asset.id],
    );
  }
  return getAssetById(result.insertId);
}

async function updateAssetRecord(id, patch) {
  const pool = getAppPool();
  const asset = await getAssetById(id);
  if (!asset) return null;

  const fields = [];
  const params = [];
  let metadata = parseMetadataJson(asset.metadata_json);

  if (patch.primary_tag !== undefined || patch.secondary_tag !== undefined || patch.category !== undefined) {
    const classified = normalizeClassification({
      category: patch.category !== undefined ? patch.category : asset.category,
      primary_tag: patch.primary_tag !== undefined ? patch.primary_tag : metadata.primary_tag,
      secondary_tag: patch.secondary_tag !== undefined ? patch.secondary_tag : metadata.secondary_tag,
      file_type: asset.file_type,
      mime_type: asset.mime_type,
    });
    if (patch.category !== undefined) patch.category = classified.category;
    if (patch.primary_tag !== undefined || patch.category !== undefined) {
      if (classified.primary_tag) metadata.primary_tag = classified.primary_tag;
      else delete metadata.primary_tag;
    }
    if (patch.secondary_tag !== undefined || patch.category !== undefined) {
      if (classified.secondary_tag) metadata.secondary_tag = classified.secondary_tag;
      else delete metadata.secondary_tag;
    }
  }

  if (patch.tags !== undefined) {
    const tags = Array.isArray(patch.tags)
      ? [...new Set(patch.tags.map((tag) => String(tag).trim()).filter(Boolean))]
      : [];
    if (tags.length) metadata.tags = tags;
    else delete metadata.tags;
  }

  if (patch.directory !== undefined) {
    const directory = normalizeDirectoryPath(patch.directory);
    if (directory) {
      metadata.directory = directory;
      fields.push('folder = ?');
      params.push(directory);
    } else {
      delete metadata.directory;
      fields.push('folder = ?');
      params.push(null);
    }
  }

  if (patch.folder !== undefined) {
    const folder = normalizeDirectoryPath(patch.folder);
    if (folder) {
      metadata.directory = folder;
      fields.push('folder = ?');
      params.push(folder);
    } else {
      delete metadata.directory;
      fields.push('folder = ?');
      params.push(null);
    }
  }

  const directFields = [
    'name', 'title', 'description', 'alt_text', 'caption', 'credit',
    'category', 'licensing_note', 'status', 'product_tags',
    'visibility', 'collection_id', 'source_type', 'owner_system',
  ];
  for (const key of directFields) {
    if (patch[key] !== undefined) {
      if (key === 'visibility' && patch[key] && !VISIBILITIES.has(patch[key])) continue;
      if (key === 'source_type' && patch[key] && !SOURCE_TYPES.has(patch[key])) continue;
      if (key === 'owner_system' && patch[key] && !OWNER_SYSTEMS.has(patch[key])) continue;
      fields.push(`${key} = ?`);
      params.push(typeof patch[key] === 'object' ? JSON.stringify(patch[key]) : patch[key]);
    }
  }

  if (patch.scope !== undefined && SCOPES.has(patch.scope)) {
    fields.push('scope = ?');
    params.push(patch.scope);
    if (patch.scope === 'internal') {
      fields.push('visibility = ?');
      params.push('internal_only');
    }
  }

  if (patch.metadata_json !== undefined) {
    metadata = {
      ...metadata,
      ...parseMetadataJson(patch.metadata_json),
    };
  }

  const metadataDirty = patch.tags !== undefined
    || patch.directory !== undefined
    || patch.folder !== undefined
    || patch.metadata_json !== undefined
    || patch.primary_tag !== undefined
    || patch.secondary_tag !== undefined
    || patch.category !== undefined;

  if (metadataDirty) {
    fields.push('metadata_json = ?');
    params.push(Object.keys(metadata).length ? JSON.stringify(metadata) : null);
  }

  if (!fields.length) return getAssetById(id);

  params.push(id);
  await pool.query(`UPDATE om_assets SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
  return getAssetById(id);
}

async function archiveAsset(id) {
  const pool = getAppPool();
  await pool.query(`UPDATE om_assets SET status = 'archived', updated_at = NOW() WHERE id = ?`, [id]);
  return getAssetById(id);
}

/**
 * Hard delete — removes the physical file and the om_assets row permanently.
 * Unlike archiveAsset() this cannot be undone. No FK constraints reference
 * om_assets, so a plain row delete is safe (verified against
 * information_schema.KEY_COLUMN_USAGE).
 */
async function purgeAsset(id) {
  const pool = getAppPool();
  const asset = await getAssetById(id);
  if (!asset) return false;

  const filePath = resolveAssetFilePath(asset);
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`[om-assets] purgeAsset(${id}): could not remove file ${filePath}:`, err.message);
    }
  }

  await pool.query('DELETE FROM om_assets WHERE id = ?', [id]);
  return true;
}

async function bulkPurgeAssets(ids) {
  const unique = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  let purged = 0;
  for (const id of unique) {
    // eslint-disable-next-line no-await-in-loop
    if (await purgeAsset(id)) purged += 1;
  }
  return purged;
}

function hashFileBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function resolveAssetFilePath(asset) {
  if (!asset?.file_path) return null;
  let full = resolveAbsolutePath(asset.file_path);
  if (full && fs.existsSync(full)) return full;

  const legacy = resolveAbsolutePath(path.join('certificates/studio/assets', asset.file_path));
  if (legacy && fs.existsSync(legacy)) return legacy;

  // Legacy public images (/images/... stored in metadata or file_path)
  const legacyUrl = asset.metadata_json?.legacy_url
    || (asset.file_path?.startsWith('/images/') ? asset.file_path : null);
  if (legacyUrl) {
    try {
      const { getImagesRoot } = require('../services/publicImagesFs');
      const rel = legacyUrl.replace(/^\/images\/?/, '');
      const pub = path.join(getImagesRoot(), rel);
      if (fs.existsSync(pub)) return pub;
    } catch {
      // ignore missing images root
    }
  }

  // Legacy church branding (/church-branding/{id}/...)
  if (typeof legacyUrl === 'string' && legacyUrl.startsWith('/church-branding/')) {
    const rel = legacyUrl.replace(/^\/church-branding\//, '');
    const branding = path.join(STORAGE_ROOT, 'church-branding', rel);
    if (fs.existsSync(branding)) return branding;
  }

  return full;
}

async function getAssetByLegacy(legacySource, legacyId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT a.*, c.name AS church_name
     FROM om_assets a
     LEFT JOIN churches c ON c.id = a.church_id
     WHERE a.legacy_source = ? AND a.legacy_id = ? AND a.status = 'active'
     LIMIT 1`,
    [legacySource, String(legacyId)],
  );
  return rows[0] ? serializeAsset(rows[0]) : null;
}

async function getAssetByLegacyUrl(urlPath) {
  if (!urlPath) return null;
  const normalized = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;

  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT a.*, c.name AS church_name
     FROM om_assets a
     LEFT JOIN churches c ON c.id = a.church_id
     WHERE a.status = 'active'
       AND (
         (a.legacy_source = 'public_images' AND a.legacy_id = ?)
         OR JSON_UNQUOTE(JSON_EXTRACT(a.metadata_json, '$.legacy_url')) = ?
       )
     LIMIT 1`,
    [normalized, normalized],
  );
  if (rows[0]) return serializeAsset(rows[0]);
  return getAssetByLegacy('global_images', normalized);
}

async function resolveAssetPathById(pool, assetId) {
  const [rows] = await pool.query(
    'SELECT file_path FROM om_assets WHERE id = ? AND status = ?',
    [assetId, 'active'],
  );
  if (!rows.length) return null;
  return resolveAssetFilePath(rows[0]);
}

module.exports = {
  ensureStorageDirs,
  serializeAsset,
  parseMetadataJson,
  normalizeDirectoryPath,
  getAssetDirectory,
  getAssetTags,
  getAssetFolder,
  buildAssetUrls,
  getAssetById,
  listAssets,
  listAssetsPage,
  countAssets,
  getScopeCounts,
  getFolderCounts,
  listDirectories,
  listAllTags,
  listDuplicateGroups,
  listSimilarGroups,
  createAssetRecord,
  updateAssetRecord,
  archiveAsset,
  bulkArchiveAssets,
  purgeAsset,
  bulkPurgeAssets,
  bulkDeleteDuplicates,
  createDirectory,
  moveAssetsToDirectory,
  classifyFilename,
  bulkChangeAssetCategory,
  listCategoryNameSuggestions,
  bulkSetAssetTags,
  changeAssetScope,
  bulkChangeScope,
  copyAssetToScope,
  transformAssetImage,
  splitAssetImage,
  readImageMetaFromPath,
  hashFileBuffer,
  resolveAssetFilePath,
  resolveAssetPathById,
  getAssetByLegacy,
  getAssetByLegacyUrl,
  scopeStorageDir,
  toRelativeStoragePath,
};
