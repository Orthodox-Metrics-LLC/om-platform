#!/usr/bin/env npx tsx
/**
 * Run: npx tsx server/src/workers/__tests__/ocrWorkerEfficiency.test.ts
 */

import {
  clampWorkerConcurrency,
  mapWithConcurrency,
  OCR_WORKER_SCHEMA_STATEMENTS,
  resolveWorkerConcurrency,
} from '../ocrWorkerEfficiency';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

console.log('=== ocrWorkerEfficiency tests ===');

assert(clampWorkerConcurrency(2) === 2, 'clamp keeps 2');
assert(clampWorkerConcurrency(0) === 2, 'clamp 0 falls back');
assert(clampWorkerConcurrency(99) === 4, 'clamp caps at 4');
assert(clampWorkerConcurrency('abc') === 2, 'clamp NaN falls back');

assert(resolveWorkerConcurrency({ OCR_WORKER_CONCURRENCY: '3' }) === 3, 'env wins');
assert(resolveWorkerConcurrency({}, 1) === 1, 'registry used when env absent');
assert(resolveWorkerConcurrency({}) === 2, 'default 2');

assert(OCR_WORKER_SCHEMA_STATEMENTS.length === 5, 'startup schema covers classifier + agent2');
assert(
  OCR_WORKER_SCHEMA_STATEMENTS.some((sql) => sql.includes('agent2_extract_json')),
  'includes agent2 column',
);

async function testConcurrencyOrder(): Promise<void> {
  const started: number[] = [];
  const finished: number[] = [];
  await mapWithConcurrency([1, 2, 3], 2, async (n) => {
    started.push(n);
    await new Promise((r) => setTimeout(r, n === 1 ? 40 : 5));
    finished.push(n);
  });
  assert(started[0] === 1 && started[1] === 2, 'starts two jobs before the third');
  assert(finished.includes(2) && finished.includes(1) && finished.includes(3), 'all jobs finish');
  assert(finished.indexOf(2) < finished.indexOf(1), 'faster job 2 finishes before slower job 1');
}

async function testSequentialFallback(): Promise<void> {
  const order: number[] = [];
  await mapWithConcurrency([1, 2], 1, async (n) => {
    order.push(n);
    await new Promise((r) => setTimeout(r, 5));
  });
  assert(order[0] === 1 && order[1] === 2, 'concurrency 1 stays sequential');
}

async function main(): Promise<void> {
  await testConcurrencyOrder();
  await testSequentialFallback();
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
