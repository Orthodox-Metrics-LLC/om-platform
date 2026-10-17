const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requestChange, confirmToken, hashToken } = require('../src/services/emailChange');

function memoryPool() {
  const changes = [];
  const users = [{ id: 1, email: 'old@example.com' }];
  let nextId = 1;
  return {
    changes,
    users,
    async query(sql, args = []) {
      if (sql.startsWith('CREATE TABLE')) return [{}];
      if (sql.includes('FROM orthodoxmetrics_db.users WHERE LOWER(email)=? AND id<>?')) {
        return [users.filter((user) => user.email === args[0] && user.id !== args[1])];
      }
      if (sql.includes("status='pending' AND expires_at > NOW() AND user_id<>?")) return [[]];
      if (sql.includes('requested_at > DATE_SUB')) return [[]];
      if (sql.includes("SET status='cancelled' WHERE user_id=?")) {
        changes.forEach((row) => { if (row.user_id === args[0] && row.status === 'pending') row.status = 'cancelled'; });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO user_email_changes')) {
        const row = { id: nextId, user_id: args[0], previous_email: args[1], new_email: args[2], status: 'pending', token_hash: args[3], expires_at: new Date(Date.now() + 86400000) };
        nextId += 1;
        changes.push(row);
        return [{ insertId: row.id }];
      }
      if (sql.includes('SELECT id, user_id, previous_email, new_email FROM user_email_changes')) {
        return [changes.filter((row) => row.token_hash === args[0] && row.status === 'pending')];
      }
      if (sql.includes('SET email=?')) {
        const user = users.find((item) => item.id === args[1]);
        if (user) user.email = args[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SET status='verified'")) {
        const row = changes.find((item) => item.id === args[0] && item.status === 'pending');
        if (row) row.status = 'verified';
        return [{ affectedRows: row ? 1 : 0 }];
      }
      throw new Error(`unexpected sql ${sql}`);
    },
  };
}

test('a new address stays pending until the confirmation link is used', async () => {
  const pool = memoryPool();
  let sent = null;
  const requested = await requestChange(pool, {
    userId: 1,
    currentEmail: 'old@example.com',
    newEmail: 'New@Example.com',
    firstName: 'Nick',
  }, async (message) => { sent = message; });
  assert.equal(requested.pending_email, 'new@example.com');
  assert.equal(pool.users[0].email, 'old@example.com');
  assert.equal(sent.to, 'new@example.com');
  assert.equal(pool.changes[0].token_hash, hashToken(sent.token));
  const confirmed = await confirmToken(pool, sent.token);
  assert.equal(confirmed.email, 'new@example.com');
  assert.equal(pool.users[0].email, 'new@example.com');
  assert.equal(pool.changes[0].status, 'verified');
  assert.equal(await confirmToken(pool, sent.token), null);
});
