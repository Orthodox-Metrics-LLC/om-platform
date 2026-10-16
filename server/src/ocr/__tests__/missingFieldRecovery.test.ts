#!/usr/bin/env npx tsx
/**
 * Same-record missing-field recovery tests
 *
 * Run: npx tsx server/src/ocr/__tests__/missingFieldRecovery.test.ts
 */

import {
  missingRequiredFields,
  recoverMissingRequiredFields,
  recoverThenFindMissingRequired,
  surnameFromParents,
} from '../missingFieldRecovery';

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

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    console.error(`  FAIL: ${message}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

function testSurnameFromParents(): void {
  console.log('\n[surnameFromParents]');
  assertEq(surnameFromParents('George Smith and Anna Grabania'), 'Smith', 'explicit father surname');
  assertEq(surnameFromParents('George and Anna Robinson'), 'Robinson', 'shared parent surname');
  assertEq(surnameFromParents('George & Anna Robinson'), 'Robinson', 'ampersand shared surname');
  assertEq(surnameFromParents(''), null, 'empty parents');
}

function testBaptismFatherSurname(): void {
  console.log('\n[baptism — father surname recovery]');

  const recovered = recoverThenFindMissingRequired('baptism', {
    child_first_name: 'John',
    father_name: 'Michael Smith',
    date_of_baptism: '1950-06-01',
  });

  assertEq(recovered.fields.child_last_name, 'Smith', 'fills child_last_name from father_name');
  assertEq(recovered.recoveredFrom.child_last_name, 'father_name', 'tracks recoveredFrom');
  assertEq(recovered.fields.child_first_name, 'John', 'does not overwrite first name');
  assertEq(recovered.missingRequired.length, 0, 'required fields satisfied after recovery');
}

function testBaptismParentsSurname(): void {
  console.log('\n[baptism — parents field surname]');

  const recovered = recoverMissingRequiredFields('baptism', {
    child_first_name: 'Helen',
    parents: 'George and Anna Robinson',
    date_of_baptism: '1961-03-12',
  });

  assertEq(recovered.fields.child_last_name, 'Robinson', 'fills last name from parents');
  assertEq(recovered.recoveredFrom.child_last_name, 'parents', 'recoveredFrom is parents');
}

function testNeverOverwrite(): void {
  console.log('\n[never overwrite populated fields]');

  const recovered = recoverMissingRequiredFields('baptism', {
    child_first_name: 'John',
    child_last_name: 'Kapala',
    father_name: 'Michael Smith',
    date_of_baptism: '1950-06-01',
  });

  assertEq(recovered.fields.child_last_name, 'Kapala', 'keeps existing surname');
  assertEq(recovered.recoveredFrom.child_last_name, undefined, 'does not record overwrite');
}

function testNoCrossRecordOrInference(): void {
  console.log('\n[no invented values]');

  const recovered = recoverThenFindMissingRequired('baptism', {
    child_first_name: 'John',
    date_of_baptism: '1950-06-01',
  });

  assertEq(recovered.fields.child_last_name, undefined, 'does not invent a surname');
  assert(recovered.missingRequired.includes('child_last_name'), 'still missing after recovery');
}

function testBaptismSplitAndCompose(): void {
  console.log('\n[baptism — split combined name]');

  const split = recoverMissingRequiredFields('baptism', {
    child_name: 'Maria Papadopoulos',
    date_of_baptism: '1955-06-15',
  });
  assertEq(split.fields.child_first_name, 'Maria', 'first from child_name');
  assertEq(split.fields.child_last_name, 'Papadopoulos', 'last from child_name');
  assertEq(split.recoveredFrom.child_last_name, 'child_name', 'recoveredFrom child_name');

  const composed = recoverMissingRequiredFields('baptism', {
    child_first_name: 'John',
    father_name: 'Michael Smith',
    date_of_baptism: '1950-01-01',
  });
  assertEq(composed.fields.child_name, 'John Smith', 'composes child_name when empty');
}

function testMarriageSplit(): void {
  console.log('\n[marriage — split combined names]');

  const recovered = recoverThenFindMissingRequired('marriage', {
    groom_name: 'Nicholas Petros',
    bride_name: 'Anna Mihail',
    date_of_marriage: '1945-08-20',
  });

  assertEq(recovered.fields.groom_first_name, 'Nicholas', 'groom first');
  assertEq(recovered.fields.groom_last_name, 'Petros', 'groom last');
  assertEq(recovered.fields.bride_first_name, 'Anna', 'bride first');
  assertEq(recovered.fields.bride_last_name, 'Mihail', 'bride last');
  assertEq(recovered.missingRequired.length, 0, 'marriage required satisfied');
  assertEq(recovered.recoveredFrom.groom_last_name, 'groom_name', 'tracks groom source');
}

function testMarriageParentSurname(): void {
  console.log('\n[marriage — last name from parents]');

  const recovered = recoverMissingRequiredFields('marriage', {
    groom_first_name: 'Nicholas',
    groom_parents: 'George Petros and Helen',
    bride_first_name: 'Anna',
    bride_parents: 'Demetrios and Maria Mihail',
    date_of_marriage: '1945-08-20',
  });

  assertEq(recovered.fields.groom_last_name, 'Petros', 'groom last from parents');
  assertEq(recovered.fields.bride_last_name, 'Mihail', 'bride last from parents');
  assertEq(recovered.recoveredFrom.groom_last_name, 'groom_parents', 'groom recoveredFrom');
  assertEq(recovered.recoveredFrom.bride_last_name, 'bride_parents', 'bride recoveredFrom');
}

function testFuneralSplit(): void {
  console.log('\n[funeral — split combined name]');

  const recovered = recoverThenFindMissingRequired('funeral', {
    deceased_name: 'Stephanie Kacher',
    date_of_death: '1969-09-23',
  });

  assertEq(recovered.fields.deceased_first_name, 'Stephanie', 'deceased first');
  assertEq(recovered.fields.deceased_last_name, 'Kacher', 'deceased last');
  assertEq(recovered.missingRequired.length, 0, 'funeral required satisfied');
  assertEq(recovered.recoveredFrom.deceased_last_name, 'deceased_name', 'tracks source');
}

function testFuneralDoesNotOverwrite(): void {
  console.log('\n[funeral — no overwrite]');

  const recovered = recoverMissingRequiredFields('funeral', {
    deceased_name: 'Stephanie Kacher',
    deceased_first_name: 'Stephanie',
    deceased_last_name: 'Papadopoulos',
  });

  assertEq(recovered.fields.deceased_last_name, 'Papadopoulos', 'keeps populated last name');
}

function testInputNotMutated(): void {
  console.log('\n[input is not mutated]');

  const input = { child_first_name: 'John', father_name: 'Michael Smith' };
  const snapshot = JSON.stringify(input);
  recoverMissingRequiredFields('baptism', input);
  assertEq(JSON.stringify(input), snapshot, 'original fields object unchanged');
}

function testValidateAfterRecoveryOnly(): void {
  console.log('\n[validate only after recovery]');

  const raw = {
    child_first_name: 'John',
    father_name: 'Michael Smith',
    date_of_baptism: '1950-06-01',
  };
  const before = missingRequiredFields('baptism', raw);
  assert(before.includes('child_last_name'), 'pre-recovery validation would fail');

  const after = recoverThenFindMissingRequired('baptism', raw);
  assertEq(after.missingRequired.length, 0, 'post-recovery validation passes');
}

function testUnknownTypeNoOp(): void {
  console.log('\n[unknown type is a no-op]');

  const recovered = recoverMissingRequiredFields('custom', { foo: 'bar' });
  assertEq(recovered.fields.foo, 'bar', 'keeps existing fields');
  assertEq(Object.keys(recovered.recoveredFrom).length, 0, 'recovers nothing');
}

testSurnameFromParents();
testBaptismFatherSurname();
testBaptismParentsSurname();
testNeverOverwrite();
testNoCrossRecordOrInference();
testBaptismSplitAndCompose();
testMarriageSplit();
testMarriageParentSurname();
testFuneralSplit();
testFuneralDoesNotOverwrite();
testInputNotMutated();
testValidateAfterRecoveryOnly();
testUnknownTypeNoOp();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
