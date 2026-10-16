#!/usr/bin/env node
/**
 * Run: node server/src/services/__tests__/ocrCanonicalFilename.test.js
 */
'use strict';

const assert = require('assert');
const {
  churchNameToAcronym,
  normalizeState,
  parishIdFromChurch,
  buildCanonicalFilename,
  parseSequenceFromCanonical,
  ensureFilenameColumns,
  resetFilenameColumnsCacheForTests,
} = require('../ocrCanonicalFilename');

function pass(msg) { console.log(`  PASS: ${msg}`); }
function fail(msg, err) {
  console.error(`  FAIL: ${msg}`);
  if (err) console.error(err);
  process.exitCode = 1;
}

function test(name, fn) {
  try {
    fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

test('SS. Peter & Paul → ssppoc', () => {
  assert.strictEqual(churchNameToAcronym('SS. Peter & Paul'), 'ssppoc');
  assert.strictEqual(churchNameToAcronym('Saints Peter & Paul'), 'ssppoc');
  assert.strictEqual(churchNameToAcronym('Saints Peter & Paul — Manville, NJ (#46)'), 'ssppoc');
  assert.strictEqual(churchNameToAcronym('SS. Peter & Paul Orthodox Church'), 'ssppoc');
});

test('NJ / New Jersey → nj', () => {
  assert.strictEqual(normalizeState('NJ'), 'nj');
  assert.strictEqual(normalizeState('New Jersey'), 'nj');
});

test('Manville parish id is ssppoc-nj01', () => {
  const church = { id: 46, name: 'Saints Peter & Paul', church_name: 'Saints Peter & Paul', state_province: 'NJ' };
  assert.strictEqual(parishIdFromChurch(church, [church]), 'ssppoc-nj01');
});

test('second peer in the same state gets 02', () => {
  const a = { id: 10, name: 'SS. Peter & Paul', state_province: 'NJ' };
  const b = { id: 46, name: 'Saints Peter & Paul', state_province: 'NJ' };
  assert.strictEqual(parishIdFromChurch(b, [a, b]), 'ssppoc-nj02');
});

test('unknown intake uses parish-sequence', () => {
  assert.strictEqual(
    buildCanonicalFilename({ parishId: 'ssppoc-nj01', sequence: 1, recordType: 'custom', ext: '.jpg' }),
    'ssppoc-nj01-001.jpg',
  );
  assert.strictEqual(
    buildCanonicalFilename({ parishId: 'ssppoc-nj01', sequence: 2, ext: 'jpg', intakeUnknown: true }),
    'ssppoc-nj01-002.jpg',
  );
});

test('known types use prefix-sequence-parish', () => {
  assert.strictEqual(
    buildCanonicalFilename({ parishId: 'ssppoc-nj01', sequence: 1, recordType: 'baptism', ext: '.jpg' }),
    'bap001-ssppoc-nj01.jpg',
  );
  assert.strictEqual(
    buildCanonicalFilename({ parishId: 'ssppoc-nj01', sequence: 2, recordType: 'marriage', ext: '.jpg' }),
    'mar002-ssppoc-nj01.jpg',
  );
  assert.strictEqual(
    buildCanonicalFilename({ parishId: 'ssppoc-nj01', sequence: 1, recordType: 'funeral', ext: '.jpg' }),
    'fun001-ssppoc-nj01.jpg',
  );
  assert.strictEqual(
    buildCanonicalFilename({ parishId: 'ssppoc-nj01', sequence: 1, recordType: 'burial', ext: '.jpg' }),
    'bur001-ssppoc-nj01.jpg',
  );
  assert.strictEqual(
    buildCanonicalFilename({ parishId: 'ssppoc-nj01', sequence: 1, recordType: 'unknown', ext: '.jpg', intakeUnknown: false }),
    'unk001-ssppoc-nj01.jpg',
  );
});

test('sequence pads to 4 digits after 999', () => {
  assert.strictEqual(
    buildCanonicalFilename({ parishId: 'ssppoc-nj01', sequence: 1000, recordType: 'baptism', ext: '.jpg' }),
    'bap1000-ssppoc-nj01.jpg',
  );
});

test('parseSequenceFromCanonical reads both formats', () => {
  assert.strictEqual(parseSequenceFromCanonical('ssppoc-nj01-001.jpg'), 1);
  assert.strictEqual(parseSequenceFromCanonical('fun001-ssppoc-nj01.jpg'), 1);
  assert.strictEqual(parseSequenceFromCanonical('bap0001-ssppoc-nj01.jpg'), 1);
});

async function testEnsureFilenameColumnsOnce() {
  resetFilenameColumnsCacheForTests();
  const calls = [];
  const pool = {
    query: async (sql) => {
      calls.push(sql);
      return [{ affectedRows: 0 }];
    },
  };
  await ensureFilenameColumns(pool);
  await ensureFilenameColumns(pool);
  assert.strictEqual(calls.length, 2, 'two ALTER statements on first call');
  assert.ok(calls.every((sql) => String(sql).includes('ADD COLUMN IF NOT EXISTS')));
  pass('ensureFilenameColumns runs ALTER only once per process');
}

testEnsureFilenameColumnsOnce()
  .then(() => {
    if (process.exitCode) {
      console.error('ocrCanonicalFilename tests failed');
      process.exit(1);
    }
    console.log('ocrCanonicalFilename tests passed');
  })
  .catch((err) => {
    fail('ensureFilenameColumns memo', err);
    process.exit(1);
  });
