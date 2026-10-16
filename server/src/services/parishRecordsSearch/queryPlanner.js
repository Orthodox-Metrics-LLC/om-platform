/**
 * Convert validated AST → parameterized SQL fragments for tenant sacrament tables.
 * Table/column identifiers come only from the allowlist registry.
 */

const { RECORD_TYPES, resolvePhysicalColumn } = require('./recordFieldRegistry');

function opSql(operator, columnSql, value, params) {
  switch (operator) {
    case 'equals':
      params.push(value);
      return `${columnSql} = ?`;
    case 'not_equals':
      params.push(value);
      return `${columnSql} <> ?`;
    case 'contains':
      params.push(`%${value}%`);
      return `${columnSql} LIKE ?`;
    case 'starts_with':
      params.push(`${value}%`);
      return `${columnSql} LIKE ?`;
    case 'ends_with':
      params.push(`%${value}`);
      return `${columnSql} LIKE ?`;
    case 'in': {
      const arr = Array.isArray(value) ? value : [value];
      params.push(...arr);
      return `${columnSql} IN (${arr.map(() => '?').join(',')})`;
    }
    case 'not_in': {
      const arr = Array.isArray(value) ? value : [value];
      params.push(...arr);
      return `${columnSql} NOT IN (${arr.map(() => '?').join(',')})`;
    }
    case 'before':
    case 'less_than':
      params.push(value);
      return `${columnSql} < ?`;
    case 'after':
    case 'greater_than':
      params.push(value);
      return `${columnSql} > ?`;
    case 'between':
      params.push(value[0], value[1]);
      return `${columnSql} BETWEEN ? AND ?`;
    case 'is_empty':
      return `(${columnSql} IS NULL OR TRIM(CAST(${columnSql} AS CHAR)) = '')`;
    case 'is_not_empty':
      return `(${columnSql} IS NOT NULL AND TRIM(CAST(${columnSql} AS CHAR)) <> '')`;
    default:
      throw new Error(`Unsupported operator ${operator}`);
  }
}

function columnExpr(type, fieldKey) {
  const cfg = RECORD_TYPES[type];
  if (!cfg) return null;
  if (fieldKey === 'primary_name') return cfg.primaryNameSql;
  if (fieldKey === 'canonical_event_date') return `\`${cfg.canonicalEventDate}\``;
  if (fieldKey === 'location') {
    return cfg.locationField ? `\`${cfg.locationField}\`` : 'NULL';
  }
  if (fieldKey === 'record_type') return null;
  if (fieldKey === 'source_record_id') return '`id`'; // normalized id used by exports / selections
  const col = resolvePhysicalColumn(type, fieldKey);
  if (!col) {
    // field may not apply to this type
    return null;
  }
  return `\`${col}\``;
}

function compileFilters(type, filters, params) {
  if (!filters) return '1=1';
  if (filters.conditions && Array.isArray(filters.conditions)) {
    const op = String(filters.operator || 'and').toUpperCase() === 'OR' ? 'OR' : 'AND';
    const parts = [];
    for (const c of filters.conditions) {
      if (c.conditions) {
        parts.push(`(${compileFilters(type, c, params)})`);
      } else {
        const expr = columnExpr(type, c.field);
        if (!expr) continue; // skip inapplicable field for this type
        parts.push(opSql(c.operator, expr, c.value, params));
      }
    }
    if (!parts.length) return '1=1';
    return parts.join(` ${op} `);
  }
  return '1=1';
}

function compileTextSearch(type, textSearch, params) {
  if (!textSearch) return '1=1';
  const cfg = RECORD_TYPES[type];
  const fields = cfg.textSearchFields || [];
  if (!fields.length) return '1=1';
  const terms = String(textSearch).trim().split(/\s+/).filter(Boolean);
  const andParts = [];
  for (const term of terms) {
    const ors = [];
    for (const f of fields) {
      ors.push(`\`${f}\` LIKE ?`);
      params.push(`%${term}%`);
    }
    andParts.push(`(${ors.join(' OR ')})`);
  }
  return andParts.join(' AND ') || '1=1';
}

function normalizedSelect(type, hasDeletedAt = false) {
  const cfg = RECORD_TYPES[type];
  const deletedAtExpr = hasDeletedAt ? '`deleted_at`' : 'NULL';
  const loc = cfg.locationField ? `\`${cfg.locationField}\`` : 'NULL';
  const status = cfg.statusField ? `\`${cfg.statusField}\`` : 'NULL';
  return `
    '${type}' AS record_type,
    ${cfg.primaryNameSql} AS primary_name,
    \`${cfg.canonicalEventDate}\` AS canonical_event_date,
    \`${cfg.clergyField}\` AS clergy,
    ${loc} AS location,
    ${status} AS status,
    id AS source_record_id,
    ${deletedAtExpr} AS deleted_at
  `.replace(/\s+/g, ' ').trim();
}

/**
 * Build UNION ALL query for multi-type search with normalized columns.
 * @param {object} ast
 * @param {Map<string, Set<string>>|null} columnSets optional table→columns for soft-delete exclusion
 */
function planUnionQuery(ast, columnSets = null) {
  const types = ast.scope.recordTypes;
  const parts = [];
  const params = [];
  for (const type of types) {
    const table = RECORD_TYPES[type].table;
    const cols = columnSets?.get(table);
    const hasDeletedAt = !!cols?.has('deleted_at');
    // includeDeleted (restore workflow): 'only' → deleted rows only; true → both; default → live rows only
    const deletedClause = !hasDeletedAt ? '1=1'
      : ast.includeDeleted === 'only' ? '`deleted_at` IS NOT NULL'
        : ast.includeDeleted ? '1=1'
          : '`deleted_at` IS NULL';
    const whereParts = [
      compileFilters(type, ast.filters, params),
      compileTextSearch(type, ast.textSearch, params),
      deletedClause,
    ];
    const where = whereParts.map((w) => `(${w})`).join(' AND ');
    parts.push(`SELECT ${normalizedSelect(type, hasDeletedAt)} FROM \`${table}\` WHERE ${where}`);
  }
  const unionSql = parts.join(' UNION ALL ');
  const sortField = ast.sort?.[0]?.field || 'canonical_event_date';
  const sortDir = (ast.sort?.[0]?.direction || 'asc').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const allowedSort = new Set(['canonical_event_date', 'primary_name', 'clergy', 'location', 'status', 'record_type', 'source_record_id']);
  const safeSort = allowedSort.has(sortField) ? sortField : 'canonical_event_date';

  if (ast.aggregates?.length && ast.groupBy?.includes('canonical_event_year')) {
    const sql = `
      SELECT YEAR(canonical_event_date) AS year, record_type, COUNT(*) AS count
      FROM (${unionSql}) AS u
      WHERE canonical_event_date IS NOT NULL
      GROUP BY YEAR(canonical_event_date), record_type
      ORDER BY year ASC, record_type ASC
    `;
    return { sql, params, mode: 'aggregate' };
  }

  const countSql = `SELECT COUNT(*) AS total FROM (${unionSql}) AS u`;
  const dataSql = `
    SELECT * FROM (${unionSql}) AS u
    ORDER BY \`${safeSort}\` ${sortDir}
    LIMIT ? OFFSET ?
  `;
  const dataParams = [...params, ast.limit, ast.offset];
  return {
    sql: dataSql,
    params: dataParams,
    countSql,
    countParams: [...params],
    mode: 'union',
  };
}

async function planUnionQueryAsync(ast, pool) {
  const { getTableColumns } = require('./schemaSupport');
  const columnSets = new Map();
  for (const type of ast.scope.recordTypes) {
    const table = RECORD_TYPES[type].table;
    columnSets.set(table, await getTableColumns(pool, table));
  }
  return planUnionQuery(ast, columnSets);
}

module.exports = {
  planUnionQuery,
  planUnionQueryAsync,
  compileFilters,
  compileTextSearch,
  normalizedSelect,
  columnExpr,
};
