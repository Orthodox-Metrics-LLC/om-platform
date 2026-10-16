'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  isValidDocumentId,
  generateDocumentId,
} = require('../documentId');
const plansPaths = require('../plansPaths');
const storage = require('../DocumentStorageService');
const { scanSecrets } = require('../secretScan');

function withTempPlansRoot(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-documents-'));
  const prev = process.env.OM_DOCUMENTS_PLANS_ROOT;
  process.env.OM_DOCUMENTS_PLANS_ROOT = tmp;
  // seed lifecycle dirs
  for (const dir of Object.values(plansPaths.LIFECYCLE_DIRS)) {
    fs.mkdirSync(path.join(tmp, dir), { recursive: true });
  }
  for (const p of plansPaths.PRODUCERS) {
    fs.mkdirSync(path.join(tmp, '00-inbox', p), { recursive: true });
  }
  for (const h of plansPaths.WORKING_HORIZONS) {
    fs.mkdirSync(path.join(tmp, '10-working', h), { recursive: true });
  }
  try {
    return fn(tmp);
  } finally {
    if (prev === undefined) delete process.env.OM_DOCUMENTS_PLANS_ROOT;
    else process.env.OM_DOCUMENTS_PLANS_ROOT = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('om-documents unit tests');

test('default plans root is daily-work when env unset', () => {
  const prev = process.env.OM_DOCUMENTS_PLANS_ROOT;
  delete process.env.OM_DOCUMENTS_PLANS_ROOT;
  try {
    assert.strictEqual(plansPaths.DEFAULT_PLANS_ROOT, '/mnt/fileserver01/daily-work');
    assert.strictEqual(plansPaths.getPlansRoot(), path.resolve('/mnt/fileserver01/daily-work'));
  } finally {
    if (prev === undefined) delete process.env.OM_DOCUMENTS_PLANS_ROOT;
    else process.env.OM_DOCUMENTS_PLANS_ROOT = prev;
  }
});

test('document id format', () => {
  const id = generateDocumentId(new Date('2026-08-08T12:00:00Z'));
  assert.ok(isValidDocumentId(id));
  assert.ok(id.startsWith('OMDOC-20260808-'));
  assert.strictEqual(isValidDocumentId('OMDOC-PICKUP-20260808-12345'), false);
  assert.strictEqual(isValidDocumentId('../etc/passwd'), false);
});

test('path traversal rejected', () => {
  withTempPlansRoot((root) => {
    assert.throws(() => plansPaths.assertUnderPlans(path.join(root, '..', 'etc')), /PATH_TRAVERSAL/);
    assert.throws(() => plansPaths.joinUnderPlans('..', 'etc', 'passwd'), /PATH_TRAVERSAL/);
  });
});

test('create package in inbox/manual', () => {
  withTempPlansRoot((root) => {
    const id = generateDocumentId();
    const created = storage.createDocument({
      documentId: id,
      title: 'Test Doc',
      producer: 'manual',
      source: 'HUMAN',
      lifecycle: 'inbox',
      primaryFileName: 'document.md',
      contentBuffer: '# Hello\n',
    });
    assert.ok(fs.existsSync(path.join(created.packageDir, 'document.md')));
    assert.ok(fs.existsSync(path.join(created.packageDir, 'manifest.json')));
    assert.ok(created.relativePath.startsWith('00-inbox/manual/'));
    const verified = storage.verifyFilesystemState(created.packageDir);
    assert.strictEqual(verified.ok, true);
  });
});

test('move inbox to working horizon', () => {
  withTempPlansRoot(() => {
    const id = generateDocumentId();
    const created = storage.createDocument({
      documentId: id,
      title: 'Move Me',
      producer: 'manual',
      source: 'HUMAN',
      lifecycle: 'inbox',
      primaryFileName: 'document.md',
      contentBuffer: 'body',
    });
    const moved = storage.moveDocument(created.packageDir, {
      lifecycle: 'working',
      producer: 'manual',
      horizon: '24-hours-out',
      documentId: id,
    });
    assert.ok(moved.relativePath.includes('10-working/24-hours-out/'));
    assert.ok(!fs.existsSync(created.packageDir));
    assert.ok(fs.existsSync(moved.packageDir));
  });
});

test('blocked executable extension', () => {
  withTempPlansRoot(() => {
    const id = generateDocumentId();
    assert.throws(() => storage.createDocument({
      documentId: id,
      title: 'Bad',
      producer: 'manual',
      lifecycle: 'inbox',
      primaryFileName: 'run.sh',
      contentBuffer: '#!/bin/sh\n',
    }), /not allowed|INVALID_EXTENSION/i);
  });
});

test('secret scan detects bearer token', () => {
  const hits = scanSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789');
  assert.ok(hits.length >= 1);
});

test('scanPackages finds OMDOC dirs only', () => {
  withTempPlansRoot((root) => {
    const id = generateDocumentId();
    storage.createDocument({
      documentId: id,
      title: 'Scan',
      producer: 'omdev',
      source: 'OMDEV',
      lifecycle: 'inbox',
      primaryFileName: 'document.md',
      contentBuffer: 'x',
    });
    fs.writeFileSync(path.join(root, '00-inbox', 'omdev', 'loose-notes.md'), 'ignore me');
    fs.mkdirSync(path.join(root, '00-inbox', 'omdev', 'not-a-package'));
    const found = storage.scanPackages({ includeAllLifecycles: false });
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].documentId, id);
  });
});

console.log('All om-documents unit tests passed');
