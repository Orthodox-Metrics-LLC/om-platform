'use strict';

const crypto = require('crypto');

class EmailChangeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let schemaReady = false;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function ensureSchema(pool) {
  if (schemaReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS user_email_changes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    previous_email VARCHAR(255) NOT NULL,
    new_email VARCHAR(255) NOT NULL,
    status ENUM('pending','verified','cancelled','expired') NOT NULL DEFAULT 'pending',
    token_hash CHAR(64) NOT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME NULL,
    expires_at DATETIME NOT NULL,
    INDEX idx_email_change_user (user_id, status),
    INDEX idx_email_change_token (token_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  schemaReady = true;
}

async function pendingFor(pool, userId) {
  await ensureSchema(pool);
  const [rows] = await pool.query(
    `SELECT new_email, expires_at FROM user_email_changes
     WHERE user_id=? AND status='pending' AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  return rows[0] ? { pending_email: rows[0].new_email, expires_at: rows[0].expires_at } : null;
}

async function requestChange(pool, { userId, currentEmail, newEmail, firstName }, sendMail) {
  await ensureSchema(pool);
  const next = normalizeEmail(newEmail);
  const current = normalizeEmail(currentEmail);
  if (!validEmail(next)) throw new EmailChangeError(400, 'Enter a valid email address.');
  if (next === current) return { pending: false };
  const [taken] = await pool.query(
    'SELECT id FROM orthodoxmetrics_db.users WHERE LOWER(email)=? AND id<>? LIMIT 1',
    [next, userId]
  );
  if (taken.length) throw new EmailChangeError(400, 'Email is already in use.');
  const [pendingTaken] = await pool.query(
    `SELECT id FROM user_email_changes WHERE LOWER(new_email)=? AND status='pending' AND expires_at > NOW() AND user_id<>? LIMIT 1`,
    [next, userId]
  );
  if (pendingTaken.length) throw new EmailChangeError(400, 'Email is already in use.');
  const [recent] = await pool.query(
    `SELECT id FROM user_email_changes WHERE user_id=? AND requested_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE) LIMIT 1`,
    [userId]
  );
  if (recent.length) throw new EmailChangeError(429, 'A confirmation email was sent recently. Wait a few minutes and try again.');

  await pool.query(
    `UPDATE user_email_changes SET status='cancelled' WHERE user_id=? AND status='pending'`,
    [userId]
  );
  const rawToken = crypto.randomBytes(48).toString('base64url');
  const [inserted] = await pool.query(
    `INSERT INTO user_email_changes (user_id, previous_email, new_email, status, token_hash, expires_at)
     VALUES (?, ?, ?, 'pending', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
    [userId, current, next, hashToken(rawToken)]
  );
  try {
    await sendMail({ to: next, token: rawToken, firstName, previousEmail: current });
  } catch (error) {
    await pool.query(`UPDATE user_email_changes SET status='cancelled' WHERE id=?`, [inserted.insertId]);
    throw new EmailChangeError(503, 'The confirmation email could not be sent. Your sign-in address was not changed.');
  }
  return { pending: true, pending_email: next };
}

async function confirmToken(pool, token) {
  await ensureSchema(pool);
  const raw = String(token || '');
  if (raw.length < 20) throw new EmailChangeError(400, 'Invalid or expired verification link.');
  const [rows] = await pool.query(
    `SELECT id, user_id, previous_email, new_email FROM user_email_changes
     WHERE token_hash=? AND status='pending' AND expires_at > NOW() LIMIT 1`,
    [hashToken(raw)]
  );
  const change = rows[0];
  if (!change) return null;
  const [taken] = await pool.query(
    'SELECT id FROM orthodoxmetrics_db.users WHERE LOWER(email)=? AND id<>? LIMIT 1',
    [change.new_email, change.user_id]
  );
  if (taken.length) throw new EmailChangeError(409, 'That email was claimed by another account before it could be confirmed.');
  await pool.query(
    `UPDATE orthodoxmetrics_db.users SET email=?, email_verified=1, verification_status='verified', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [change.new_email, change.user_id]
  );
  await pool.query(
    `UPDATE user_email_changes SET status='verified', verified_at=NOW() WHERE id=? AND status='pending'`,
    [change.id]
  );
  await pool.query(
    `UPDATE user_email_changes SET status='cancelled' WHERE user_id=? AND status='pending'`,
    [change.user_id]
  );
  return { user_id: change.user_id, previous_email: change.previous_email, email: change.new_email };
}

module.exports = {
  EmailChangeError,
  ensureSchema,
  normalizeEmail,
  pendingFor,
  requestChange,
  confirmToken,
  hashToken,
};
