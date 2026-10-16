#!/usr/bin/env node
/**
 * Run: node server/src/config/__tests__/dbQueryLog.test.js
 */
'use strict';

const assert = require('assert');
const { shouldLogDbQuery } = require('../dbQueryLog');

function pass(msg) { console.log(`  PASS: ${msg}`); }

function test(name, fn) {
  try {
    fn();
    pass(name);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('=== dbQueryLog tests ===');

test('production is quiet by default', () => {
  assert.strictEqual(shouldLogDbQuery({ NODE_ENV: 'production' }), false);
});

test('non-production logs by default', () => {
  assert.strictEqual(shouldLogDbQuery({ NODE_ENV: 'development' }), true);
});

test('OM_DB_QUERY_LOG=1 forces on', () => {
  assert.strictEqual(shouldLogDbQuery({ NODE_ENV: 'production', OM_DB_QUERY_LOG: '1' }), true);
});

test('OM_DB_QUERY_LOG=0 forces off', () => {
  assert.strictEqual(shouldLogDbQuery({ NODE_ENV: 'development', OM_DB_QUERY_LOG: '0' }), false);
});

if (!process.exitCode) {
  console.log('dbQueryLog tests passed');
}
