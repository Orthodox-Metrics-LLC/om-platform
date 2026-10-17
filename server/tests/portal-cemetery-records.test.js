const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCemeteryHandlers } = require('../src/services/portalCemeteryRecords');

const CEMETERY = {
  table: 'dr_import_f979d896da05_46eacf185be6',
  kind: 'cemetery',
  name: 'cemetery october 2024',
  fields: [{ name: 'plot', label: 'Plot', type: 'string', nullable: true }],
  database: 'om_church_46',
  constraints: { plot: { sql_type: 'text' } },
};

function harness(overrides = {}) {
  const user = {
    id: 12,
    email: 'priest@test',
    display_name: 'Fr. Paul',
    role: 'priest',
    church_id: 46,
    is_active: 1,
    must_change_password: 0,
    ...overrides,
  };
  const calls = [];
  const executions = [];
  const pool = {
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.includes('FROM users')) return [[user]];
      return [[{ id: 46, name: 'Parish 46', database_name: 'om_church_46' }]];
    },
  };
  const handlers = createCemeteryHandlers({
    pool,
    runResource: async (request) => {
      executions.push(request);
      if (request.action === 'resources') return { resources: [CEMETERY, { ...CEMETERY, table: 'dr_import_aaaaaaaaaaaa_bbbbbbbbbbbb', kind: 'parish', name: 'Parish' }], database: 'om_church_46' };
      return { rows: [], total: 0, resource: CEMETERY, database: 'om_church_46' };
    },
  });
  const req = {
    session: { user: { id: 12, role: 'viewer', church_id: 99 } },
    body: { churchId: 46, action: 'resources' },
  };
  async function call() {
    const res = {
      statusCode: 200,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.data = data; return this; },
    };
    await handlers.handle(req, res);
    return res;
  }
  return { user, req, call, calls, executions };
}

test('priest sees only cemetery import tables and no database name', async () => {
  const h = harness();
  const res = await h.call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.result.resources.length, 1);
  assert.equal(res.data.result.resources[0].name, 'cemetery october 2024');
  assert.equal(res.data.result.resources[0].constraints, undefined);
  assert.equal(JSON.stringify(res.data).includes('om_church_46'), false);
});

test('priest cannot browse another church', async () => {
  const h = harness();
  h.req.body.churchId = 47;
  assert.equal((await h.call()).statusCode, 403);
  assert.equal(h.executions.length, 0);
});

test('viewer can browse but cannot save or forge the audit actor', async () => {
  const h = harness({ role: 'viewer' });
  h.req.body = { action: 'browse', churchId: 46, query: { table: CEMETERY.table, sort: [{ field: 'plot', direction: 'asc' }], limit: 100 } };
  assert.equal((await h.call()).statusCode, 200);
  h.req.body = { action: 'save', churchId: 46, query: { table: CEMETERY.table, actor: 'Admin', values: {} } };
  assert.equal((await h.call()).statusCode, 403);
  assert.equal(h.executions.some((call) => call.action === 'save'), false);
});

test('save uses the signed-in account and drops client database overrides', async () => {
  const h = harness();
  h.req.body = {
    action: 'save',
    churchId: 46,
    database: 'om_church_99',
    query: { table: CEMETERY.table, actor: 'Admin', database: 'om_church_99', values: { plot: '1' }, note: 'New burial', request_id: 'abc' },
  };
  const res = await h.call();
  assert.equal(res.statusCode, 200);
  const save = h.executions.find((call) => call.action === 'save');
  assert.equal(save.database, 'om_church_46');
  assert.equal(save.query.actor, 'Fr. Paul (#12)');
  assert.equal(save.query.database, undefined);
  assert.equal(JSON.stringify(res.data).includes('om_church_46'), false);
});

test('unknown tables and actions never reach the engine write path', async () => {
  const h = harness();
  h.req.body = { action: 'browse', churchId: 46, query: { table: 'funeral_records' } };
  assert.equal((await h.call()).statusCode, 400);
  h.req.body = { action: 'execute', churchId: 46 };
  assert.equal((await h.call()).statusCode, 400);
  assert.equal(h.executions.length, 0);
});

test('signed-out requests are rejected', async () => {
  const h = harness();
  delete h.req.session.user;
  assert.equal((await h.call()).statusCode, 401);
});
