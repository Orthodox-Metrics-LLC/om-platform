/**
 * Probe optional columns on tenant record tables (soft-delete, timestamps).
 */

const cache = new Map();

async function getTableColumns(pool, table) {
  const key = `${pool?.pool?.config?.connectionConfig?.database || 'tenant'}:${table}`;
  if (cache.has(key)) return cache.get(key);
  const [columns] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
  const names = new Set(columns.map((c) => String(c.Field)));
  cache.set(key, names);
  return names;
}

async function softDeleteSupported(pool, table) {
  const cols = await getTableColumns(pool, table);
  return cols.has('deleted_at');
}

function notDeletedClause(cols, alias = null) {
  if (!cols.has('deleted_at')) return '1=1';
  const col = alias ? `${alias}.\`deleted_at\`` : '`deleted_at`';
  return `${col} IS NULL`;
}

function clearSchemaCache() {
  cache.clear();
}

module.exports = {
  getTableColumns,
  softDeleteSupported,
  notDeletedClause,
  clearSchemaCache,
};
