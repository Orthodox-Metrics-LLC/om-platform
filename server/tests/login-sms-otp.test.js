const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashCode, verifyCode, sendCode, SmsOtpError } = require('../src/services/loginSmsOtp');

function memoryPool(user = { id: 2, phone: '+19086578000', sms_login_otp: 1 }) {
  const challenges = [];
  return {
    challenges,
    async query(sql, args = []) {
      if (sql.includes('SHOW COLUMNS')) return [[{ Field: 'sms_login_otp' }]];
      if (sql.startsWith('CREATE TABLE') || sql.startsWith('ALTER TABLE')) return [{}];
      if (sql.includes('SELECT sms_login_otp')) return [[{ sms_login_otp: user.sms_login_otp, phone: user.phone }]];
      if (sql.includes('SELECT id, phone FROM users')) return [[{ id: user.id, phone: user.phone }]];
      if (sql.includes('SELECT COUNT(*)')) return [[{ n: challenges.filter((row) => !row.consumed_at).length }]];
      if (sql.startsWith('UPDATE login_sms_challenges SET consumed_at=NOW() WHERE user_id')) {
        challenges.forEach((row) => { if (row.user_id === args[0] && row.purpose === args[1] && !row.consumed_at) row.consumed_at = new Date(); });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO login_sms_challenges')) {
        challenges.push({ id: args[0], user_id: args[1], purpose: args[2], code_hash: args[3], expires_at: new Date(Date.now() + 600000), attempts: 0, consumed_at: null });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT * FROM login_sms_challenges')) return [[challenges.find((row) => row.id === args[0])].filter(Boolean)];
      if (sql.includes('SET attempts=attempts+1')) {
        const row = challenges.find((item) => item.id === args[0]);
        if (row) row.attempts += 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SET consumed_at=NOW() WHERE id=? AND consumed_at IS NULL')) {
        const row = challenges.find((item) => item.id === args[0] && !item.consumed_at);
        if (row) row.consumed_at = new Date();
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.includes('SET consumed_at=NOW() WHERE id=?')) {
        const row = challenges.find((item) => item.id === args[0]);
        if (row) row.consumed_at = new Date();
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected sql ${sql}`);
    },
  };
}

test('login text is sent and the code is not returned', async () => {
  const pool = memoryPool();
  let sent = null;
  const issued = await sendCode(pool, { id: 2 }, 'login', async (message) => { sent = message; return { ok: true }; });
  assert.equal(issued.challenge_id.length, 36);
  assert.equal(issued.phone_hint.includes('7800') || issued.phone_hint.includes('00'), true);
  assert.match(sent.body, /sign-in code is \d{6}/);
  assert.equal(JSON.stringify(issued).includes(sent.body.match(/\d{6}/)[0]), false);
  assert.equal(pool.challenges[0].code_hash, hashCode(issued.challenge_id, sent.body.match(/\d{6}/)[0]));
});

test('wrong and reused codes are rejected', async () => {
  const pool = memoryPool();
  let code = '';
  const issued = await sendCode(pool, { id: 2 }, 'login', async (message) => { code = message.body.match(/\d{6}/)[0]; return { ok: true }; });
  await assert.rejects(() => verifyCode(pool, issued.challenge_id, '000000', 'login'), (error) => error instanceof SmsOtpError && error.status === 401);
  assert.equal(await verifyCode(pool, issued.challenge_id, code, 'login'), 2);
  await assert.rejects(() => verifyCode(pool, issued.challenge_id, code, 'login'), (error) => error.status === 400);
});

test('a failed text does not leave a usable code', async () => {
  const pool = memoryPool();
  await assert.rejects(() => sendCode(pool, { id: 2 }, 'login', async () => ({ ok: false })), (error) => error.status === 503);
  assert.ok(pool.challenges[0].consumed_at);
});
