const roles = require('../utils/roles');
const { ViewerError } = require('./omViewerPolicy');

class CemeteryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TABLE_PATTERN = /^dr_import_[a-f0-9]{12}_[a-f0-9]{12}$/;
const ACTIONS = {
  resources: [],
  browse: ['table', 'search', 'page', 'sort', 'limit'],
  save: ['table', 'row_id', 'values', 'note', 'request_id', 'fingerprint'],
};

function positiveId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new CemeteryError(400, 'Choose a valid church.');
  return n;
}

function publicResource(resource) {
  return {
    table: resource.table,
    name: resource.name,
    kind: resource.kind,
    fields: (resource.fields || []).map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      nullable: !!field.nullable,
    })),
  };
}

function createCemeteryHandlers({ pool, runResource }) {
  const catalogCache = new Map();
  async function identity(req) {
    if (req.session?.expires && new Date(req.session.expires).getTime() <= Date.now()) {
      throw new CemeteryError(401, 'Session expired.');
    }
    const id = req.session?.user?.id || req.user?.id;
    if (!id) throw new CemeteryError(401, 'Sign in to Orthodox Metrics.');
    const [rows] = await pool.query(
      'SELECT id,email,display_name,role,church_id,is_active,is_locked,account_status,must_change_password,account_expires_at FROM users WHERE id=? LIMIT 1',
      [id]
    );
    const user = rows[0];
    if (!user || !user.is_active) throw new CemeteryError(401, 'This account is no longer active.');
    if (user.is_locked || (user.account_status && user.account_status !== 'active' && user.role !== 'super_admin')) {
      throw new CemeteryError(403, 'This account cannot open cemetery records.');
    }
    if (user.account_expires_at && new Date(user.account_expires_at).getTime() <= Date.now()) {
      throw new CemeteryError(401, 'This account has expired.');
    }
    if (!roles.canViewDashboard(user)) throw new CemeteryError(403, 'Your role cannot view cemetery records.');
    return user;
  }

  async function churchFor(user, churchId) {
    const platform = roles.canManageChurches(user);
    if (!platform && !user.church_id) throw new CemeteryError(403, 'No church is assigned to this account.');
    const id = positiveId(churchId ?? user.church_id);
    if (!platform && Number(user.church_id) !== id) throw new CemeteryError(403, 'You cannot access this church.');
    const [rows] = await pool.query(
      'SELECT id, name, database_name FROM churches WHERE is_active=1 AND id=? LIMIT 1',
      [id]
    );
    const church = rows[0];
    if (!church || !/^om_church_[1-9][0-9]*$/.test(church.database_name || '')) {
      throw new CemeteryError(404, 'Church records were not found.');
    }
    return church;
  }

  async function listed(church, refresh = false) {
    const key = String(church.id);
    const cached = catalogCache.get(key);
    if (!refresh && cached && cached.expires > Date.now()) return cached.resources;
    const result = await runResource({
      churchId: Number(church.id),
      database: church.database_name,
      action: 'resources',
      query: {},
    });
    const resources = (result.resources || []).filter((resource) => resource.kind === 'cemetery' && TABLE_PATTERN.test(resource.table || ''));
    catalogCache.set(key, { expires: Date.now() + 20000, resources });
    return resources;
  }

  async function requireCemeteryTable(church, table) {
    if (typeof table !== 'string' || !TABLE_PATTERN.test(table)) {
      throw new CemeteryError(400, 'Choose a cemetery record table.');
    }
    const resources = await listed(church);
    const found = resources.find((resource) => resource.table === table);
    if (!found) throw new CemeteryError(404, 'That cemetery record table was not found for this parish.');
    return found;
  }

  const wrap = (handler) => async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await handler(req));
    } catch (error) {
      const status = error instanceof CemeteryError || error instanceof ViewerError ? error.status : 503;
      const message = status === 503
        ? 'Cemetery records are unavailable. Ask your administrator to check the service.'
        : error.message;
      res.status(status).json({ ok: false, error: message });
    }
  };

  return {
    handle: wrap(async (req) => {
      const user = await identity(req);
      const body = req.body || {};
      const action = body.action;
      if (!Object.hasOwn(ACTIONS, action)) throw new CemeteryError(400, 'Unsupported cemetery action.');
      const church = await churchFor(user, body.churchId ?? user.church_id);
      const query = body.query && typeof body.query === 'object' && !Array.isArray(body.query) ? body.query : {};
      const selected = Object.fromEntries(ACTIONS[action].filter((key) => Object.hasOwn(query, key)).map((key) => [key, query[key]]));
      if (action === 'resources') {
        const resources = await listed(church, true);
        return { ok: true, result: { resources: resources.map(publicResource) } };
      }
      await requireCemeteryTable(church, selected.table);
      if (action === 'save' && !roles.canManageRecords(user)) {
        throw new CemeteryError(403, 'Your role has read-only access to cemetery records.');
      }
      if (action === 'save') {
        selected.actor = `${String(user.display_name || user.email || 'User').slice(0, 100)} (#${user.id})`;
      }
      const result = await runResource({
        churchId: Number(church.id),
        database: church.database_name,
        action,
        query: selected,
      });
      if (result && result.resource) result.resource = publicResource(result.resource);
      if (result && Object.hasOwn(result, 'database')) delete result.database;
      return { ok: true, result };
    }),
  };
}

module.exports = { createCemeteryHandlers, CemeteryError };
