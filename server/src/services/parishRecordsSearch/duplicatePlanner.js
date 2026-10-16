const { RECORD_TYPES } = require('./recordFieldRegistry');

const PRESETS = Object.freeze({
  baptism: {
    strict: ['first_name', 'last_name', 'reception_date', 'birth_date'],
    standard: ['first_name', 'last_name', 'reception_date'],
    loose: ['first_name', 'last_name', 'reception_year'],
  },
  marriage: {
    strict: ['fname_groom', 'lname_groom', 'fname_bride', 'lname_bride', 'mdate'],
    standard: ['lname_groom', 'lname_bride', 'mdate'],
    loose: ['couple_names', 'marriage_year'],
  },
  funeral: {
    strict: ['name', 'lastname', 'burial_date', 'deceased_date'],
    standard: ['name', 'lastname', 'burial_date'],
    loose: ['name', 'lastname', 'burial_year'],
  },
});

function normalizedSql(column) {
  // MariaDB REGEXP_REPLACE keeps database grouping consistent with normalizeText:
  // Unicode apostrophes/hyphens and punctuation become token boundaries and
  // repeated whitespace is collapsed. Stored values are never changed.
  return `LOWER(TRIM(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(\`${column}\`, ''), '’', ' '), CHAR(39), ' '), '‐', ' '), '-', ' '), '[[:space:][:punct:]]+', ' ')))`;
}

function keyExpression(type, field) {
  if (field === 'primary_name') {
    const cfg = RECORD_TYPES[type];
    return type === 'marriage'
      ? `CONCAT(${normalizedSql(cfg.personFields[0])}, '|', ${normalizedSql(cfg.personFields[1])}, '|', ${normalizedSql(cfg.personFields[2])}, '|', ${normalizedSql(cfg.personFields[3])})`
      : `CONCAT(${normalizedSql(cfg.personFields[0])}, '|', ${normalizedSql(cfg.personFields[1])})`;
  }
  if (field === 'canonical_event_date') return `\`${RECORD_TYPES[type].canonicalEventDate}\``;
  if (field.endsWith('_year')) {
    const date = field === 'reception_year' ? 'reception_date' : field === 'marriage_year' ? 'mdate' : 'burial_date';
    return `YEAR(\`${date}\`)`;
  }
  if (field === 'couple_names') {
    return `CONCAT(${normalizedSql('fname_groom')}, '|', ${normalizedSql('lname_groom')}, '|', ${normalizedSql('fname_bride')}, '|', ${normalizedSql('lname_bride')})`;
  }
  const cfg = RECORD_TYPES[type];
  if (!cfg?.fields[field] && !cfg?.personFields.includes(field)) throw new Error(`Unsafe duplicate field ${field}`);
  return cfg.fields[field]?.kind === 'date' ? `\`${field}\`` : normalizedSql(field);
}

function planRecordDuplicateQuery(ast, type, sourceColumn = null, { excludeDeleted = false } = {}) {
  const op = ast.operation;
  const preset = op.matchLevel || 'standard';
  const fields = op.fields?.length ? op.fields : PRESETS[type][preset];
  const expressions = fields.map((field) => ({ field, sql: keyExpression(type, field) }));
  const params = [];
  const { compileFilters, compileTextSearch } = require('./queryPlanner');
  const filterSql = compileFilters(type, ast.filters, params);
  const textSql = compileTextSearch(type, ast.textSearch, params);
  let sourceSql = '1=1';
  if (ast.operation.source === 'ocr') {
    if (!sourceColumn) {
      const err = new Error(`OCR/import source metadata is not available for ${type} records`);
      err.status = 400; err.code = 'unsupported_query'; throw err;
    }
    sourceSql = /(?:_id|job_id)$/i.test(sourceColumn) ? `\`${sourceColumn}\` IS NOT NULL` : `LOWER(COALESCE(\`${sourceColumn}\`, '')) LIKE ?`;
    if (!/(?:_id|job_id)$/i.test(sourceColumn)) params.push('%ocr%');
  }
  const nonEmpty = expressions.map((x) => `${x.sql} IS NOT NULL AND CAST(${x.sql} AS CHAR) <> ''`).join(' AND ');
  const deletedSql = excludeDeleted ? '`deleted_at` IS NULL' : '1=1';
  const groupBy = expressions.map((x) => x.sql).join(', ');
  const min = Math.max(2, Math.min(100, Number(op.minimumGroupSize || 2)));
  return {
    sql: `SELECT GROUP_CONCAT(id ORDER BY id) AS record_ids, COUNT(*) AS record_count, ${expressions.map((x, i) => `${x.sql} AS k${i}`).join(', ')} FROM \`${RECORD_TYPES[type].table}\` WHERE (${filterSql}) AND (${textSql}) AND (${sourceSql}) AND (${deletedSql}) AND ${nonEmpty} GROUP BY ${groupBy} HAVING COUNT(*) >= ?`,
    params: [...params, min], fields, expressions, preset,
  };
}

function planRecordDetailsQuery(type, ids) {
  const cfg = RECORD_TYPES[type];
  return {
    sql: `SELECT * FROM \`${cfg.table}\` WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    params: ids,
  };
}

module.exports = { PRESETS, normalizedSql, planRecordDuplicateQuery, planRecordDetailsQuery };
