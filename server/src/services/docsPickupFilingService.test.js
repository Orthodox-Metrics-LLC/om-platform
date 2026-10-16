'use strict';

/**
 * Tests for docsPickupFilingService.
 *
 *   node --test server/src/services/docsPickupFilingService.test.js
 *
 * Pure-function tests (path validation, category mapping, id/receipt format,
 * slugging) always run — no DB required.
 *
 * The full request → approve → reject → file workflow test is opt-in and runs
 * only when DOCS_FILING_DB_TEST=1 and the app DB is reachable. It writes to a
 * temp OM_DOCS_REPO_ROOT and cleans up its DB rows.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const svc = require('./docsPickupFilingService');

// ── Pure functions ──────────────────────────────────────────────────────────

test('pickup_id has the stable OMDOC-PICKUP-YYYYMMDD-XXXXX format and is unique-ish', () => {
  const a = svc.genPickupId(new Date('2026-07-01T00:00:00Z'));
  assert.match(a, /^OMDOC-PICKUP-20260701-[A-Z0-9]{5}$/);
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) ids.add(svc.genPickupId());
  assert.ok(ids.size > 490, 'pickup ids should be highly unique');
});

test('category display labels normalize to canonical keys', () => {
  assert.equal(svc.normalizeCategory('Architecture'), 'architecture');
  assert.equal(svc.normalizeCategory('Design System'), 'design-system');
  assert.equal(svc.normalizeCategory('Product Docs'), 'product-docs');
  assert.equal(svc.normalizeCategory('API & Integrations'), 'api-integrations');
  assert.equal(svc.normalizeCategory('Operations'), 'operations');
  assert.equal(svc.normalizeCategory('operations'), 'operations');
  assert.equal(svc.normalizeCategory('nonsense'), null);
});

test('valid target path under the category dir is accepted', () => {
  const r = svc.validateTargetPath('docs/internal/architecture/my-doc.md', 'architecture');
  assert.equal(r.ok, true);
  assert.equal(r.path, 'docs/internal/architecture/my-doc.md');
});

test('path traversal is blocked', () => {
  assert.equal(svc.validateTargetPath('docs/internal/../../etc/passwd.md', 'operations').ok, false);
  assert.equal(svc.validateTargetPath('docs/internal/ops/../../../x.md', 'operations').ok, false);
});

test('absolute paths are blocked', () => {
  assert.equal(svc.validateTargetPath('/etc/passwd.md', 'operations').ok, false);
  assert.equal(svc.validateTargetPath('/var/www/x.md').ok, false);
});

test('shell metacharacters are blocked', () => {
  assert.equal(svc.validateTargetPath('docs/internal/ops/x;rm -rf.md', 'operations').ok, false);
  assert.equal(svc.validateTargetPath('docs/internal/ops/$(whoami).md', 'operations').ok, false);
  assert.equal(svc.validateTargetPath('docs/internal/ops/a`b`.md', 'operations').ok, false);
});

test('paths outside docs/internal are rejected', () => {
  assert.equal(svc.validateTargetPath('docs/architecture/x.md', 'architecture').ok, false);
  assert.equal(svc.validateTargetPath('README.md').ok, false);
});

test('unsupported extensions are rejected', () => {
  assert.equal(svc.validateTargetPath('docs/internal/operations/x.exe', 'operations').ok, false);
  assert.equal(svc.validateTargetPath('docs/internal/operations/x.sh', 'operations').ok, false);
  assert.equal(svc.validateTargetPath('docs/internal/operations/x.md', 'operations').ok, true);
});

test('path must match the supplied category dir', () => {
  const r = svc.validateTargetPath('docs/internal/operations/x.md', 'architecture');
  assert.equal(r.ok, false, 'operations path should not validate under architecture category');
});

test('default target path is derived from category + slug', () => {
  assert.equal(
    svc.defaultTargetPath('architecture', 'My Great Doc.md'),
    'docs/internal/architecture/my-great-doc.md',
  );
});

// ── Opt-in DB workflow test ─────────────────────────────────────────────────

const DB_TEST = process.env.DOCS_FILING_DB_TEST === '1';

test('workflow: request → block-without-approval → approve → file lands in category; reject blocks', { skip: !DB_TEST }, async () => {
  const { getAppPool } = require('../config/db');
  const docsPickup = require('./docsPickupService');
  const crypto = require('crypto');
  const pool = getAppPool();

  // Use a throwaway om-docs root so we never touch the real repo.
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'omdocs-test-'));
  process.env.OM_DOCS_REPO_ROOT = tmpRepo;

  const ids = [];
  const superAdmin = { id: 1, email: 'admin@test', name: 'Admin', role: 'super_admin' };
  const nonAdmin = { id: 2, email: 'ed@test', name: 'Ed', role: 'editor' };

  async function makePickupFile(content) {
    docsPickup.ensureStorageDirs();
    const id = crypto.randomUUID();
    const storedName = `${id}.md`;
    const dest = path.join(docsPickup.getFilesDir(), storedName);
    fs.writeFileSync(dest, content);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    await docsPickup.insertFileRecord(pool, {
      id,
      fileName: storedName,
      originalFileName: `${id}.md`,
      storagePath: `files/${storedName}`,
      agentPath: `storage/docs-pickup/files/${storedName}`,
      status: 'waiting',
      savedBy: { id: null, email: null, name: 'test' },
      savedAt: new Date().toISOString(),
      sizeBytes: content.length,
      mimeType: 'text/markdown',
      sha256,
      source: 'unit_test',
    });
    ids.push(id);
    return id;
  }

  try {
    await svc.ensurePickupIds();

    // 1. Create a filing request — must NOT file immediately.
    const id1 = await makePickupFile('# Test doc one\n');
    const created = await svc.createFilingRequest({
      idOrPickupId: id1, category: 'Architecture', title: 'Test Doc One',
      requestingActor: 'ombrain', requestSource: 'ombrain_cli', actor: superAdmin,
    });
    assert.equal(created.ok, true, created.error);
    const receipt = created.request.receipt;
    assert.match(receipt, /^OM-[A-Z0-9]{5}$/, 'receipt format OM-XXXXX');
    assert.equal(created.request.status, 'submitted');
    assert.equal(created.pickup.filingState, 'approval_pending');
    // File must not exist yet.
    assert.equal(fs.existsSync(path.join(tmpRepo, created.request.proposedTargetPath)), false);

    // Receipt is persisted + unique.
    const fetched = await svc.getFilingRequest(receipt);
    assert.equal(fetched.receipt, receipt);

    // 2. Filing is blocked before approval.
    const early = await svc.fileApprovedRequest(receipt, superAdmin);
    assert.equal(early.ok, false, 'unapproved request must not be fileable');

    // 3. Non-super_admin cannot approve.
    const badApprove = await svc.approveFilingRequest(receipt, nonAdmin);
    assert.equal(badApprove.ok, false);

    // 4. Approve as super_admin → appears in waiting-to-file.
    const approved = await svc.approveFilingRequest(receipt, superAdmin);
    assert.equal(approved.ok, true, approved.error);
    assert.equal(approved.request.status, 'approved');
    const waiting = await svc.listWaitingToFile();
    assert.ok(waiting.some((r) => r.receipt === receipt), 'approved request should be waiting-to-file');

    // 5. File now → lands under the architecture category dir with matching content.
    const filed = await svc.fileApprovedRequest(receipt, superAdmin);
    assert.equal(filed.ok, true, filed.error);
    assert.match(filed.filedPath, /^docs\/internal\/architecture\//);
    assert.equal(fs.existsSync(filed.absolutePath), true);
    assert.equal(fs.readFileSync(filed.absolutePath, 'utf8'), '# Test doc one\n');

    // 6. Rejected request cannot be filed.
    const id2 = await makePickupFile('# Test doc two\n');
    const created2 = await svc.createFilingRequest({
      idOrPickupId: id2, category: 'Operations', title: 'Test Doc Two',
      requestSource: 'omdocs_pickup_ui', actor: superAdmin,
    });
    assert.equal(created2.ok, true, created2.error);
    const rejected = await svc.rejectFilingRequest(created2.request.receipt, superAdmin, 'not needed');
    assert.equal(rejected.ok, true);
    assert.equal(rejected.request.status, 'rejected');
    const fileRejected = await svc.fileApprovedRequest(created2.request.receipt, superAdmin);
    assert.equal(fileRejected.ok, false, 'rejected request must not be fileable');

    // 7. Path traversal is blocked at request time.
    const id3 = await makePickupFile('# Test doc three\n');
    const traversal = await svc.createFilingRequest({
      idOrPickupId: id3, category: 'Operations', targetPath: 'docs/internal/../../../etc/x.md',
      requestSource: 'omdocs_pickup_ui', actor: superAdmin,
    });
    assert.equal(traversal.ok, false, 'traversal path must be rejected');
  } finally {
    for (const id of ids) {
      await pool.query('DELETE FROM docs_pickup_files WHERE id = ?', [id]).catch(() => {});
    }
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});
