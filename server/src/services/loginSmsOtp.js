'use strict';

const crypto = require('crypto');
const { normalizeE164 } = require('./notificationChannels/sms/phone');
const smsChannel = require('./notificationChannels/smsChannel');

class SmsOtpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let schemaReady = false;

function hashCode(id, code) {
  return crypto.createHash('sha256').update(`${id}:${String(code)}`).digest('hex');
}

function codesMatch(expectedHash, id, code) {
  const actual = Buffer.from(hashCode(id, code));
  const expected = Buffer.from(String(expectedHash || ''), 'utf8');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const last = digits.slice(-4);
  return last ? `••• ••${last.slice(0, 2)} ${last.slice(2)}` : 'your phone';
}

async function ensureSchema(pool) {
  if (schemaReady) return;
  const [cols] = await pool.query("SHOW COLUMNS FROM users LIKE 'sms_login_otp'");
  if (!cols.length) {
    await pool.query('ALTER TABLE users ADD COLUMN sms_login_otp TINYINT(1) NOT NULL DEFAULT 0');
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS login_sms_challenges (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id INT NOT NULL,
    purpose ENUM('login','enable') NOT NULL,
    code_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_login_sms_user (user_id, purpose, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  schemaReady = true;
}

async function isEnabled(pool, user) {
  await ensureSchema(pool);
  const [rows] = await pool.query('SELECT sms_login_otp, phone FROM users WHERE id=? LIMIT 1', [user.id]);
  return Number(rows[0]?.sms_login_otp) === 1;
}

async function statusFor(pool, user) {
  await ensureSchema(pool);
  const [rows] = await pool.query('SELECT sms_login_otp, phone FROM users WHERE id=? LIMIT 1', [user.id]);
  const phone = normalizeE164(rows[0]?.phone);
  return {
    enabled: Number(rows[0]?.sms_login_otp) === 1,
    phone_ready: !!phone,
    phone_hint: phone ? maskPhone(phone) : null,
  };
}

async function sendCode(pool, user, purpose, send = (message) => smsChannel.send(message)) {
  await ensureSchema(pool);
  if (purpose !== 'login' && purpose !== 'enable') throw new SmsOtpError(400, 'Unsupported text code.');
  const [rows] = await pool.query('SELECT id, phone FROM users WHERE id=? AND is_active=1 LIMIT 1', [user.id]);
  const phone = normalizeE164(rows[0]?.phone);
  if (!phone) throw new SmsOtpError(400, 'Add a mobile number on your profile before using text sign-in.');
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM login_sms_challenges WHERE user_id=? AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)',
    [user.id]
  );
  if (Number(n) >= 5) throw new SmsOtpError(429, 'Too many text messages were sent. Wait a few minutes and try again.');
  const id = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await pool.query(
    'UPDATE login_sms_challenges SET consumed_at=NOW() WHERE user_id=? AND purpose=? AND consumed_at IS NULL',
    [user.id, purpose]
  );
  await pool.query(
    'INSERT INTO login_sms_challenges (id, user_id, purpose, code_hash, expires_at) VALUES (?,?,?,?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))',
    [id, user.id, purpose, hashCode(id, code)]
  );
  const body = purpose === 'login'
    ? `Your Orthodox Metrics sign-in code is ${code}. It expires in 10 minutes.`
    : `Your Orthodox Metrics code to turn on text sign-in is ${code}. It expires in 10 minutes.`;
  const deliver = send || ((message) => smsChannel.send(message));
  const result = await deliver({ to: phone, body });
  if (!result?.ok) {
    await pool.query('UPDATE login_sms_challenges SET consumed_at=NOW() WHERE id=?', [id]);
    throw new SmsOtpError(503, 'The text message could not be sent. Try again in a moment.');
  }
  return { challenge_id: id, phone_hint: maskPhone(phone), expires_in: 600 };
}

async function verifyCode(pool, challengeId, code, purpose) {
  await ensureSchema(pool);
  const token = String(challengeId || '');
  const digits = String(code || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(token) || !/^\d{6}$/.test(digits)) {
    throw new SmsOtpError(400, 'Enter the 6-digit code from the text message.');
  }
  const [rows] = await pool.query('SELECT * FROM login_sms_challenges WHERE id=? LIMIT 1', [token]);
  const row = rows[0];
  if (!row || row.purpose !== purpose || row.consumed_at) {
    throw new SmsOtpError(400, 'That code is no longer valid. Request a new text.');
  }
  if (new Date(row.expires_at).getTime() <= Date.now() || Number(row.attempts) >= 5) {
    await pool.query('UPDATE login_sms_challenges SET consumed_at=NOW() WHERE id=?', [token]);
    throw new SmsOtpError(400, 'That code has expired. Request a new text.');
  }
  await pool.query('UPDATE login_sms_challenges SET attempts=attempts+1 WHERE id=?', [token]);
  if (!codesMatch(row.code_hash, token, digits)) {
    throw new SmsOtpError(401, 'That code does not match. Check the text and try again.');
  }
  const [spent] = await pool.query('UPDATE login_sms_challenges SET consumed_at=NOW() WHERE id=? AND consumed_at IS NULL', [token]);
  if (!spent.affectedRows) throw new SmsOtpError(400, 'That code is no longer valid. Request a new text.');
  return Number(row.user_id);
}

async function sendLoginCode(pool, user, send) {
  return sendCode(pool, user, 'login', send);
}

async function resendLoginCode(pool, challengeId, send) {
  await ensureSchema(pool);
  const token = String(challengeId || '');
  const [rows] = await pool.query(
    'SELECT user_id FROM login_sms_challenges WHERE id=? AND purpose=\'login\' AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) LIMIT 1',
    [token]
  );
  if (!rows[0]) throw new SmsOtpError(400, 'Sign in again to get a new text.');
  return sendCode(pool, { id: rows[0].user_id }, 'login', send);
}

module.exports = {
  SmsOtpError,
  ensureSchema,
  isEnabled,
  statusFor,
  sendCode,
  sendLoginCode,
  verifyCode,
  resendLoginCode,
  maskPhone,
  hashCode,
};
