/**
 * Pagination helpers for Frontend UI Audit v2 artifacts and recent runs.
 * Run: node --test server/src/routes/__tests__/portal-ui-auditv2-pagination.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const {
  parsePaginationParams,
  paginateArray,
  listArtifactRunEntries,
  listArtifactRuns,
  listRecentRunsPaginated,
} = require('../portal-ui-auditv2').__test;

describe('portal-ui-auditv2 pagination helpers', () => {
  it('parsePaginationParams defaults to page 1 and pageSize 15', () => {
    assert.deepEqual(parsePaginationParams({}), { page: 1, pageSize: 15 });
  });

  it('parsePaginationParams accepts pageSize and limit alias', () => {
    assert.deepEqual(parsePaginationParams({ page: '2', pageSize: '10' }), { page: 2, pageSize: 10 });
    assert.deepEqual(parsePaginationParams({ page: '3', limit: '25' }), { page: 3, pageSize: 25 });
  });

  it('parsePaginationParams clamps invalid values', () => {
    assert.deepEqual(parsePaginationParams({ page: '-1', pageSize: '0' }), { page: 1, pageSize: 15 });
    assert.deepEqual(parsePaginationParams({ pageSize: '500' }), { page: 1, pageSize: 100 });
  });

  it('paginateArray returns metadata and slices items', () => {
    const items = Array.from({ length: 23 }, (_, index) => index + 1);
    const page1 = paginateArray(items, 1, 10);
    assert.deepEqual(page1.items, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(page1.total, 23);
    assert.equal(page1.totalPages, 3);

    const page3 = paginateArray(items, 3, 10);
    assert.deepEqual(page3.items, [21, 22, 23]);
    assert.equal(page3.page, 3);
  });
});

describe('portal-ui-auditv2 artifact pagination', () => {
  let tempRoot;

  before(async () => {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'puav2-page-'));
    const names = ['run-a', 'run-b', 'run-c', 'run-d', 'run-e'];
    for (const [index, name] of names.entries()) {
      const dir = path.join(tempRoot, name);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'summary.md'), `summary ${name}`);
      const touched = Date.now() - index * 60_000;
      await fsp.utimes(dir, touched / 1000, touched / 1000);
    }
  });

  after(async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });

  it('listArtifactRunEntries sorts newest directory first', async () => {
    const entries = await listArtifactRunEntries(tempRoot);
    assert.equal(entries.length, 5);
    assert.equal(entries[0].id, 'run-a');
    assert.equal(entries[entries.length - 1].id, 'run-e');
  });

  it('listArtifactRuns paginates without reading every findings file', async () => {
    const page1 = await listArtifactRuns({ artifactsRoot: tempRoot, page: 1, pageSize: 2 });
    assert.equal(page1.total, 5);
    assert.equal(page1.page, 1);
    assert.equal(page1.pageSize, 2);
    assert.equal(page1.totalPages, 3);
    assert.deepEqual(
      page1.runs.map((run) => run.id),
      ['run-a', 'run-b'],
    );

    const page3 = await listArtifactRuns({ artifactsRoot: tempRoot, page: 3, pageSize: 2 });
    assert.deepEqual(
      page3.runs.map((run) => run.id),
      ['run-e'],
    );
  });

  it('listRecentRunsPaginated merges jobs and artifacts newest first', async () => {
    const jobs = new Map([
      [
        'job-1',
        {
          id: 'job-1',
          status: 'complete',
          mode: 'source-only',
          createdAt: '2026-07-21T10:00:00.000Z',
          startedAt: '2026-07-21T10:00:01.000Z',
          outputDir: path.join(tempRoot, 'run-b'),
          safeArgs: { scope: 'portal' },
          command: 'scan-source',
          finishedAt: '2026-07-21T10:01:00.000Z',
          exitCode: 0,
          error: null,
          logs: '',
          pid: null,
          outputDirRel: 'run-b',
        },
      ],
    ]);

    const result = await listRecentRunsPaginated(jobs, {
      artifactsRoot: tempRoot,
      page: 1,
      pageSize: 5,
    });

    assert.equal(result.total, 5);
    assert.equal(result.rows.length, 5);
    assert.equal(result.rows[0].kind, 'artifact');
    assert.equal(result.rows[0].runId, 'run-a');
    const linkedJob = result.rows.find((row) => row.kind === 'job' && row.runId === 'run-b');
    assert.ok(linkedJob);
    assert.equal(linkedJob?.scope, 'portal');
    assert.ok(!result.rows.some((row) => row.kind === 'artifact' && row.runId === 'run-b'));
  });
});
