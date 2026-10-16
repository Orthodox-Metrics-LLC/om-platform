/**
 * Detect optional cemetery_plots columns per tenant (plot_key migration may not be applied).
 */

const columnCache = new Map();

async function currentSchema(pool) {
  const [[row]] = await pool.query('SELECT DATABASE() AS db');
  return row?.db || null;
}

async function getCemeteryPlotColumns(pool) {
  const schema = await currentSchema(pool);
  if (!schema) return new Set();
  if (columnCache.has(schema)) return columnCache.get(schema);

  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'cemetery_plots'`,
    [schema],
  );
  const cols = new Set(rows.map((r) => r.COLUMN_NAME));
  columnCache.set(schema, cols);
  return cols;
}

async function hasCemeteryPlotsTable(pool) {
  const schema = await currentSchema(pool);
  if (!schema) return false;
  const [rows] = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'cemetery_plots' LIMIT 1`,
    [schema],
  );
  return rows.length > 0;
}

function isTenantSchemaError(err) {
  const code = err?.code || '';
  const msg = String(err?.message || '');
  return (
    code === 'ER_BAD_DB_ERROR' ||
    code === 'ER_NO_SUCH_TABLE' ||
    msg.includes('Unknown database')
  );
}

function plotIdentitySelect(cols) {
  const parts = ['p.id', 'p.plot_number AS plotNumber'];
  parts.push(cols.has('plot_key') ? 'p.plot_key AS plotKey' : 'NULL AS plotKey');
  parts.push(
    cols.has('stable_location_id') ? 'p.stable_location_id AS stableLocationId' : 'NULL AS stableLocationId',
  );
  parts.push(
    cols.has('display_numbers') ? 'p.display_numbers AS displayNumbers' : 'NULL AS displayNumbers',
  );
  parts.push(cols.has('side') ? 'p.side' : 'NULL AS side');
  parts.push(cols.has('position') ? 'p.position' : 'NULL AS position');
  if (cols.has('family_crest')) parts.push('p.family_crest AS familyCrest');
  else parts.push('NULL AS familyCrest');
  if (cols.has('plot_kind')) parts.push('p.plot_kind AS plotKind');
  else parts.push("'grave' AS plotKind");
  return parts.join(', ');
}

function plotMapSelect(cols) {
  const parts = [
    `p.status, p.map_x AS mapX, p.map_y AS mapY,
          p.map_w AS mapW, p.map_h AS mapH, p.map_page AS mapPage`,
  ];
  if (cols.has('family_crest')) parts.push('p.family_crest AS familyCrest');
  else parts.push('NULL AS familyCrest');
  if (cols.has('plot_kind')) parts.push('p.plot_kind AS plotKind');
  else parts.push("'grave' AS plotKind");
  return parts.join(',\n          ');
}

function plotOrderClause(cols) {
  if (cols.has('position')) {
    return 'ORDER BY s.code, r.number, p.position, p.plot_number';
  }
  return 'ORDER BY s.code, r.number, p.plot_number';
}

function plotSearchLikeClauses(cols) {
  const clauses = ['p.plot_number LIKE ?'];
  if (cols.has('display_numbers')) clauses.push('p.display_numbers LIKE ?');
  if (cols.has('plot_key')) clauses.push('p.plot_key LIKE ?');
  return clauses;
}

function plotSearchParams(q, cols) {
  const like = `%${q}%`;
  const params = [];
  params.push(like);
  if (cols.has('display_numbers')) params.push(like);
  if (cols.has('plot_key')) params.push(like);
  params.push(like, like, like);
  return params;
}

/** plot_key / display_numbers only (for people joins where p.id is aliased separately). */
function plotKeyFieldsSelect(cols) {
  const parts = ['p.plot_number AS plotNumber'];
  parts.push(cols.has('plot_key') ? 'p.plot_key AS plotKey' : 'NULL AS plotKey');
  parts.push(
    cols.has('display_numbers') ? 'p.display_numbers AS displayNumbers' : 'NULL AS displayNumbers',
  );
  return parts.join(', ');
}

/** plot fields for search/detail list rows (id aliased as plotId). */
function plotSearchSelect(cols) {
  const parts = ['p.id AS plotId', 'p.plot_number AS plotNumber'];
  parts.push(cols.has('plot_key') ? 'p.plot_key AS plotKey' : 'NULL AS plotKey');
  parts.push(
    cols.has('display_numbers') ? 'p.display_numbers AS displayNumbers' : 'NULL AS displayNumbers',
  );
  parts.push(cols.has('side') ? 'p.side' : 'NULL AS side');
  parts.push(cols.has('position') ? 'p.position' : 'NULL AS position');
  return parts.join(', ');
}

function plotSurnameSelect(cols) {
  const occupantLast = `(SELECT pe.last_name
                   FROM cemetery_interments i JOIN cemetery_people pe ON pe.id = i.person_id
                  WHERE i.plot_id = p.id
                  ORDER BY i.id LIMIT 1)`;
  if (cols.has('family_crest')) {
    return `COALESCE(NULLIF(p.family_crest, ''), ${occupantLast}) AS surname`;
  }
  return `${occupantLast} AS surname`;
}

module.exports = {
  getCemeteryPlotColumns,
  hasCemeteryPlotsTable,
  isTenantSchemaError,
  plotIdentitySelect,
  plotKeyFieldsSelect,
  plotSearchSelect,
  plotMapSelect,
  plotSurnameSelect,
  plotOrderClause,
  plotSearchLikeClauses,
  plotSearchParams,
};
