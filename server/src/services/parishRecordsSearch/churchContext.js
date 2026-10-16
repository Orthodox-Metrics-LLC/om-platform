/**
 * Resolve and authorize church context for parish search.
 * Never trust a client churchId alone.
 */

const { getAppPool } = require('../../config/db-compat');
const { getTenantPool } = require('../../config/db');

class ChurchContextError extends Error {
  constructor(message, code = 'tenant_context_mismatch', status = 403) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function isPlatformAdmin(role) {
  return ['super_admin', 'admin'].includes(String(role || '').toLowerCase());
}

function resolveUser(req) {
  return req.user || req.session?.user || {};
}

async function resolveAuthorizedChurchId(req, requestedChurchId) {
  const user = resolveUser(req);
  const sessionChurchId = Number(user.church_id || user.churchId || 0) || null;
  const requested = requestedChurchId != null ? Number(requestedChurchId) : null;

  if (isPlatformAdmin(user.role)) {
    const churchId = requested || sessionChurchId;
    if (!churchId) throw new ChurchContextError('churchId required for platform operators', 'tenant_context_mismatch', 400);
    return { churchId, user };
  }

  if (!sessionChurchId) {
    throw new ChurchContextError('No church context on session', 'tenant_context_mismatch', 403);
  }
  if (requested && requested !== sessionChurchId) {
    throw new ChurchContextError('Cannot query another church database', 'tenant_context_mismatch', 403);
  }
  return { churchId: sessionChurchId, user };
}

async function getTenantConnection(churchId) {
  // Prefer getTenantPool(om_church_<id>); fall back to churches.database_name lookup
  try {
    return getTenantPool(churchId);
  } catch (_) {
    const [rows] = await getAppPool().query(
      'SELECT database_name FROM orthodoxmetrics_db.churches WHERE id = ? LIMIT 1',
      [churchId],
    );
    if (!rows.length || !rows[0].database_name) {
      throw new ChurchContextError('Church database not found', 'tenant_context_mismatch', 404);
    }
    const { getChurchDbConnection } = require('../../utils/dbSwitcher');
    return getChurchDbConnection(rows[0].database_name);
  }
}

module.exports = {
  resolveAuthorizedChurchId,
  getTenantConnection,
  ChurchContextError,
  isPlatformAdmin,
};
