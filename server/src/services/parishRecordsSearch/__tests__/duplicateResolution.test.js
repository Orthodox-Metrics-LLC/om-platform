const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDuplicateGroup, duplicateSignature } = require('../duplicateRemovalService');

const user = { id: 12, role: 'priest' };

test('duplicate resolution rejects keep record in removal set', async () => {
  await assert.rejects(
    resolveDuplicateGroup({}, { churchId: 46, signature: 'a'.repeat(64), recordType: 'baptism', keepRecordId: 26, removeRecordIds: [26, 27], user }),
    (error) => error.code === 'survivor_in_remove_set',
  );
});

test('duplicate resolution rejects records outside signed group before database mutation', async () => {
  const pool = { query() { throw new Error('database should not be reached'); } };
  await assert.rejects(
    resolveDuplicateGroup(pool, { churchId: 46, signature: duplicateSignature(46, 'baptism', [26, 27]), recordType: 'baptism', keepRecordId: 26, removeRecordIds: [28], user }),
    (error) => error.code === 'records_outside_duplicate_group',
  );
});
