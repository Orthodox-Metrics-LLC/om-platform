/**
 * OM Assets Library — asset collections CRUD
 */

const { getAppPool } = require('../config/db');
const { SCOPES, VISIBILITIES, SOURCE_TYPES, OWNER_SYSTEMS, defaultVisibilityForScope } = require('./omAssetsConstants');
const { isPlatformAdmin } = require('./omAssetsPermissions');

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

function parseMetadataJson(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function serializeCollection(row) {
  if (!row) return null;
  const metadata_json = parseMetadataJson(row.metadata_json);
  return {
    ...row,
    metadata_json: Object.keys(metadata_json).length ? metadata_json : null,
  };
}

async function getCollectionById(id) {
  const pool = getAppPool();
  const [rows] = await pool.query('SELECT * FROM asset_collections WHERE id = ?', [id]);
  return rows[0] ? serializeCollection(rows[0]) : null;
}

async function getCollectionBySlug(slug) {
  const pool = getAppPool();
  const [rows] = await pool.query('SELECT * FROM asset_collections WHERE slug = ?', [slug]);
  return rows[0] ? serializeCollection(rows[0]) : null;
}

async function listCollections(req, filters = {}) {
  if (!isPlatformAdmin(req) && filters.scope === 'internal') {
    return [];
  }

  const pool = getAppPool();
  // Compute asset_count per collection in a single query. LEFT JOIN keeps
  // empty collections (count 0) and matches the grid's "active asset" filter.
  let query = `SELECT c.*, COUNT(a.id) AS asset_count
    FROM asset_collections c
    LEFT JOIN om_assets a ON a.collection_id = c.id AND a.status = 'active'
    WHERE 1=1`;
  const params = [];

  if (filters.scope && SCOPES.has(filters.scope)) {
    query += ' AND c.scope = ?';
    params.push(filters.scope);
  } else if (!isPlatformAdmin(req)) {
    query += " AND c.scope != 'internal' AND c.visibility != 'internal_only'";
  }

  if (filters.visibility && VISIBILITIES.has(filters.visibility)) {
    if (!isPlatformAdmin(req) && filters.visibility === 'internal_only') {
      return [];
    }
    query += ' AND c.visibility = ?';
    params.push(filters.visibility);
  } else if (!isPlatformAdmin(req)) {
    query += " AND c.visibility != 'internal_only'";
  }

  if (filters.search) {
    query += ' AND (c.name LIKE ? OR c.slug LIKE ? OR c.description LIKE ?)';
    const q = `%${filters.search}%`;
    params.push(q, q, q);
  }

  query += ' GROUP BY c.id ORDER BY c.name ASC';
  const limit = Math.min(Number(filters.limit) || 100, 200);
  query += ' LIMIT ?';
  params.push(limit);

  const [rows] = await pool.query(query, params);
  return rows.map((row) => ({ ...serializeCollection(row), asset_count: Number(row.asset_count) || 0 }));
}

async function createCollection(data, createdBy) {
  const pool = getAppPool();
  const scope = SCOPES.has(data.scope) ? data.scope : 'public';
  let visibility = data.visibility && VISIBILITIES.has(data.visibility)
    ? data.visibility
    : defaultVisibilityForScope(scope);

  if (scope === 'internal') visibility = 'internal_only';

  const slug = data.slug ? slugify(data.slug) : slugify(data.name);
  const source_type = SOURCE_TYPES.has(data.source_type) ? data.source_type : 'upload';
  const owner_system = OWNER_SYSTEMS.has(data.owner_system) ? data.owner_system : 'om';

  const [result] = await pool.query(
    `INSERT INTO asset_collections
     (name, slug, description, scope, visibility, category, folder, source_type, owner_system, created_by, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      slug,
      data.description || null,
      scope,
      visibility,
      data.category || null,
      data.folder || null,
      source_type,
      owner_system,
      createdBy || null,
      data.metadata_json ? JSON.stringify(data.metadata_json) : null,
    ],
  );
  return getCollectionById(result.insertId);
}

async function updateCollection(id, patch) {
  const pool = getAppPool();
  const existing = await getCollectionById(id);
  if (!existing) return null;

  const fields = [];
  const params = [];

  if (patch.name !== undefined) {
    fields.push('name = ?');
    params.push(patch.name);
  }
  if (patch.slug !== undefined) {
    fields.push('slug = ?');
    params.push(slugify(patch.slug));
  }
  if (patch.description !== undefined) {
    fields.push('description = ?');
    params.push(patch.description);
  }
  if (patch.scope !== undefined && SCOPES.has(patch.scope)) {
    fields.push('scope = ?');
    params.push(patch.scope);
    if (patch.scope === 'internal') {
      fields.push('visibility = ?');
      params.push('internal_only');
    }
  }
  if (patch.visibility !== undefined && VISIBILITIES.has(patch.visibility)) {
    const scope = patch.scope || existing.scope;
    if (scope !== 'internal') {
      fields.push('visibility = ?');
      params.push(patch.visibility);
    }
  }
  if (patch.category !== undefined) {
    fields.push('category = ?');
    params.push(patch.category);
  }
  if (patch.folder !== undefined) {
    fields.push('folder = ?');
    params.push(patch.folder);
  }
  if (patch.source_type !== undefined && SOURCE_TYPES.has(patch.source_type)) {
    fields.push('source_type = ?');
    params.push(patch.source_type);
  }
  if (patch.owner_system !== undefined && OWNER_SYSTEMS.has(patch.owner_system)) {
    fields.push('owner_system = ?');
    params.push(patch.owner_system);
  }
  if (patch.metadata_json !== undefined) {
    fields.push('metadata_json = ?');
    params.push(patch.metadata_json ? JSON.stringify(patch.metadata_json) : null);
  }

  if (!fields.length) return existing;

  params.push(id);
  await pool.query(`UPDATE asset_collections SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
  return getCollectionById(id);
}

async function deleteCollection(id) {
  const pool = getAppPool();
  await pool.query('UPDATE om_assets SET collection_id = NULL WHERE collection_id = ?', [id]);
  const [result] = await pool.query('DELETE FROM asset_collections WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function assignAssetsToCollection(collectionId, assetIds) {
  const pool = getAppPool();
  const unique = [...new Set(assetIds.map(Number).filter((id) => id > 0))];
  if (!unique.length) return 0;
  const [result] = await pool.query(
    `UPDATE om_assets SET collection_id = ?, updated_at = NOW()
     WHERE id IN (${unique.map(() => '?').join(',')}) AND status = 'active'`,
    [collectionId, ...unique],
  );
  return result.affectedRows || 0;
}

async function removeAssetsFromCollection(assetIds) {
  const pool = getAppPool();
  const unique = [...new Set(assetIds.map(Number).filter((id) => id > 0))];
  if (!unique.length) return 0;
  const [result] = await pool.query(
    `UPDATE om_assets SET collection_id = NULL, updated_at = NOW()
     WHERE id IN (${unique.map(() => '?').join(',')})`,
    unique,
  );
  return result.affectedRows || 0;
}

async function countAssetsInCollection(collectionId) {
  const pool = getAppPool();
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM om_assets WHERE collection_id = ? AND status = 'active'",
    [collectionId],
  );
  return rows[0]?.cnt || 0;
}

module.exports = {
  slugify,
  serializeCollection,
  getCollectionById,
  getCollectionBySlug,
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  assignAssetsToCollection,
  removeAssetsFromCollection,
  countAssetsInCollection,
};
