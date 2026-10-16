/**
 * Gate for [DB QUERY] console logging.
 * Production is quiet unless OM_DB_QUERY_LOG=1.
 */
'use strict';

function shouldLogDbQuery(env = process.env) {
  const flag = String(env.OM_DB_QUERY_LOG || '').toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  return env.NODE_ENV !== 'production';
}

module.exports = { shouldLogDbQuery };
