/**
 * Repository for parish_saved_queries (app DB).
 */

const { getAppPool } = require('../../config/db-compat');
const { validateAst } = require('./astValidator');
const { logParishSearchEvent } = require('./audit');

async function ensureTable() {
  const pool = getAppPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parish_saved_queries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      church_id INT NOT NULL,
      owner_user_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      description TEXT NULL,
      query_ast JSON NOT NULL,
      query_version INT NOT NULL DEFAULT 1,
      visibility ENUM('private','parish','parish_admin') NOT NULL DEFAULT 'private',
      export_config JSON NULL,
      pinned TINYINT(1) NOT NULL DEFAULT 0,
      run_count INT NOT NULL DEFAULT 0,
      last_run_at DATETIME NULL,
      last_result_count INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_psq_church_owner (church_id, owner_user_id),
      KEY idx_psq_church_vis (church_id, visibility),
      KEY idx_psq_pinned (church_id, pinned)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

function rowToDto(row) {
  if (!row) return null;
  let ast = row.query_ast;
  if (typeof ast === 'string') {
    try { ast = JSON.parse(ast); } catch { /* keep */ }
  }
  let exportConfig = row.export_config;
  if (typeof exportConfig === 'string') {
    try { exportConfig = JSON.parse(exportConfig); } catch { /* keep */ }
  }
  return {
    id: row.id,
    churchId: row.church_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    queryAst: ast,
    queryVersion: row.query_version,
    visibility: row.visibility,
    exportConfig,
    pinned: !!row.pinned,
    runCount: row.run_count,
    lastRunAt: row.last_run_at,
    lastResultCount: row.last_result_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listSavedSearches({ churchId, userId, isAdmin }) {
  await ensureTable();
  const pool = getAppPool();
  const [rows] = await pool.query(
    `SELECT * FROM parish_saved_queries
     WHERE church_id = ?
       AND (
         owner_user_id = ?
         OR visibility = 'parish'
         OR (visibility = 'parish_admin' AND ? = 1)
       )
     ORDER BY pinned DESC, updated_at DESC
     LIMIT 200`,
    [churchId, userId, isAdmin ? 1 : 0],
  );
  return rows.map(rowToDto);
}

async function getSavedSearch(id, { churchId, userId, isAdmin }) {
  await ensureTable();
  const pool = getAppPool();
  const [rows] = await pool.query(`SELECT * FROM parish_saved_queries WHERE id = ? AND church_id = ? LIMIT 1`, [id, churchId]);
  const dto = rowToDto(rows[0]);
  if (!dto) return null;
  if (dto.ownerUserId !== userId && dto.visibility === 'private') return null;
  if (dto.visibility === 'parish_admin' && !isAdmin && dto.ownerUserId !== userId) return null;
  return dto;
}

async function createSavedSearch({ churchId, userId, name, description, queryAst, visibility, exportConfig, pinned }) {
  await ensureTable();
  const ast = validateAst(queryAst);
  if (Number(ast.scope.churchId) !== Number(churchId)) {
    const err = new Error('Saved search church mismatch');
    err.status = 403;
    err.code = 'tenant_context_mismatch';
    throw err;
  }
  const vis = ['private', 'parish', 'parish_admin'].includes(visibility) ? visibility : 'private';
  const pool = getAppPool();
  const [result] = await pool.query(
    `INSERT INTO parish_saved_queries
      (church_id, owner_user_id, name, description, query_ast, query_version, visibility, export_config, pinned)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      churchId, userId, name.slice(0, 200), description || null,
      JSON.stringify(ast), vis,
      exportConfig ? JSON.stringify(exportConfig) : null,
      pinned ? 1 : 0,
    ],
  );
  await logParishSearchEvent('saved_search_created', {
    churchId, userId, meta: { id: result.insertId, visibility: vis, duplicateSearch: ast.operation?.type === 'duplicate_detection', duplicateMode: ast.operation?.mode || null },
  });
  return getSavedSearch(result.insertId, { churchId, userId, isAdmin: true });
}

async function updateSavedSearch(id, { churchId, userId, isAdmin, patch }) {
  const existing = await getSavedSearch(id, { churchId, userId, isAdmin });
  if (!existing) {
    const err = new Error('Saved search not found');
    err.status = 404;
    throw err;
  }
  if (existing.ownerUserId !== userId && !isAdmin) {
    const err = new Error('Not allowed to modify this saved search');
    err.status = 403;
    throw err;
  }
  const fields = [];
  const params = [];
  if (patch.name != null) { fields.push('name = ?'); params.push(String(patch.name).slice(0, 200)); }
  if (patch.description !== undefined) { fields.push('description = ?'); params.push(patch.description); }
  if (patch.visibility != null) { fields.push('visibility = ?'); params.push(patch.visibility); }
  if (patch.pinned != null) { fields.push('pinned = ?'); params.push(patch.pinned ? 1 : 0); }
  if (patch.queryAst != null) {
    const ast = validateAst(patch.queryAst);
    if (Number(ast.scope.churchId) !== Number(churchId)) {
      const err = new Error('Saved search church mismatch');
      err.status = 403;
      throw err;
    }
    fields.push('query_ast = ?'); params.push(JSON.stringify(ast));
    fields.push('query_version = ?'); params.push(1);
  }
  if (patch.exportConfig !== undefined) {
    fields.push('export_config = ?');
    params.push(patch.exportConfig ? JSON.stringify(patch.exportConfig) : null);
  }
  if (!fields.length) return existing;
  params.push(id, churchId);
  await getAppPool().query(`UPDATE parish_saved_queries SET ${fields.join(', ')} WHERE id = ? AND church_id = ?`, params);
  await logParishSearchEvent('saved_search_modified', { churchId, userId, meta: { id } });
  if (patch.visibility && patch.visibility !== existing.visibility) {
    await logParishSearchEvent('saved_search_shared', { churchId, userId, meta: { id, visibility: patch.visibility } });
  }
  return getSavedSearch(id, { churchId, userId, isAdmin });
}

async function deleteSavedSearch(id, { churchId, userId, isAdmin }) {
  const existing = await getSavedSearch(id, { churchId, userId, isAdmin });
  if (!existing) {
    const err = new Error('Saved search not found');
    err.status = 404;
    throw err;
  }
  if (existing.ownerUserId !== userId && !isAdmin) {
    const err = new Error('Not allowed to delete this saved search');
    err.status = 403;
    throw err;
  }
  await getAppPool().query(`DELETE FROM parish_saved_queries WHERE id = ? AND church_id = ?`, [id, churchId]);
  return { deleted: true };
}

async function touchRun(id, { churchId, resultCount }) {
  await getAppPool().query(
    `UPDATE parish_saved_queries
     SET run_count = run_count + 1, last_run_at = NOW(), last_result_count = ?
     WHERE id = ? AND church_id = ?`,
    [resultCount, id, churchId],
  );
}

module.exports = {
  listSavedSearches,
  getSavedSearch,
  createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  touchRun,
  ensureTable,
};
