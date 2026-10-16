/**
 * Path-safety and delete validation for Frontend UI Audit v2 artifacts.
 * Run: node --test server/src/routes/__tests__/portal-ui-auditv2-delete.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const {
  sanitizeRunId,
  assertInside,
  resolveScopeForRun,
  deleteArtifactRuns,
  PRESET_DETAILS,
} = require('../portal-ui-auditv2').__test;

describe('portal-ui-auditv2 delete helpers', () => {
  it('sanitizeRunId accepts valid run slugs', () => {
    assert.equal(sanitizeRunId('ui-portal-all-2026-07-21T12-00-00'), 'ui-portal-all-2026-07-21T12-00-00');
    assert.equal(sanitizeRunId('my.run_name-1'), 'my.run_name-1');
  });

  it('sanitizeRunId rejects traversal and invalid characters', () => {
    assert.throws(() => sanitizeRunId('../etc/passwd'), /Invalid run id/);
    assert.throws(() => sanitizeRunId('..'), /Invalid run id/);
    assert.throws(() => sanitizeRunId(''), /Invalid run id/);
    assert.throws(() => sanitizeRunId('run/with/slash'), /Invalid run id/);
    assert.throws(() => sanitizeRunId('run name'), /Invalid run id/);
  });

  it('assertInside blocks path traversal outside artifacts root', () => {
    const root = path.join(os.tmpdir(), 'puav2-artifacts-test');
    const inside = path.join(root, 'ui-portal-all-2026');
    assert.equal(assertInside(root, inside), inside);
    assert.throws(() => assertInside(root, path.join(root, '..', 'escape')), /Path escapes allowed root/);
    assert.throws(() => assertInside(root, '/etc/passwd'), /Path escapes allowed root/);
  });

  it('resolveScopeForRun prefers preset scope over conflicting body scope', () => {
    assert.equal(resolveScopeForRun('portal', 'quick-public'), 'public');
    assert.equal(resolveScopeForRun('custom', 'authentication'), 'authentication');
    assert.equal(resolveScopeForRun('public', null), 'public');
  });

  it('PRESET_DETAILS includes effective run fields', () => {
    assert.equal(PRESET_DETAILS.portal.scope, 'portal');
    assert.equal(PRESET_DETAILS.portal.mode, 'all');
    assert.equal(PRESET_DETAILS['quick-public'].maxRoutes, 8);
    assert.equal(PRESET_DETAILS['quick-public'].seoEnabled, true);
    assert.deepEqual(PRESET_DETAILS['full-public'].themes, ['light', 'dark']);
  });
});

describe('portal-ui-auditv2 deleteArtifactRuns', () => {
  let tempRoot;

  before(async () => {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'puav2-delete-'));
    await fsp.mkdir(path.join(tempRoot, 'run-a'), { recursive: true });
    await fsp.writeFile(path.join(tempRoot, 'run-a', 'summary.md'), 'test');
    await fsp.mkdir(path.join(tempRoot, 'run-b'), { recursive: true });
  });

  after(async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });

  it('deletes existing artifact directories safely', async () => {
    const result = await deleteArtifactRuns(['run-a'], tempRoot);
    assert.deepEqual(result.deleted, ['run-a']);
    assert.equal(fs.existsSync(path.join(tempRoot, 'run-a')), false);
  });

  it('reports notFound for missing directories', async () => {
    const result = await deleteArtifactRuns(['missing-run'], tempRoot);
    assert.deepEqual(result.deleted, []);
    assert.deepEqual(result.notFound, ['missing-run']);
  });

  it('rejects invalid ids without touching disk', async () => {
    const result = await deleteArtifactRuns(['../run-b'], tempRoot);
    assert.deepEqual(result.deleted, []);
    assert.equal(result.errors.length, 1);
    assert.equal(fs.existsSync(path.join(tempRoot, 'run-b')), true);
  });
});
