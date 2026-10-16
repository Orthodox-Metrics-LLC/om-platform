/**
 * OCR mobile pairing sessions — short-lived tokens for phone → desktop upload flow.
 */
const crypto = require('crypto');
const { promisePool } = require('../config/db');
const { generateToken, hashToken } = require('../utils/tokenUtils');

const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_UPLOADS_PER_SESSION = 50;
const PAIRING_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  await promisePool.query(`
    CREATE TABLE IF NOT EXISTS ocr_pairing_sessions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      pairing_code VARCHAR(8) NOT NULL,
      church_id INT NOT NULL,
      created_by INT NOT NULL,
      status ENUM('waiting','connected','receiving','expired','closed') NOT NULL DEFAULT 'waiting',
      record_type VARCHAR(32) NOT NULL DEFAULT 'custom',
      language VARCHAR(8) NOT NULL DEFAULT 'en',
      record_layout_mode VARCHAR(32) NOT NULL DEFAULT 'auto',
      upload_count INT NOT NULL DEFAULT 0,
      uploads_json JSON NULL,
      first_connected_at DATETIME NULL,
      last_upload_at DATETIME NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_pairing_code (pairing_code),
      INDEX idx_church_creator (church_id, created_by),
      INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  tableReady = true;
}

function generatePairingCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += PAIRING_CODE_CHARS[crypto.randomInt(0, PAIRING_CODE_CHARS.length)];
  }
  return code;
}

function parseUploads(row) {
  if (!row?.uploads_json) return [];
  try {
    const parsed = typeof row.uploads_json === 'string' ? JSON.parse(row.uploads_json) : row.uploads_json;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function expireIfNeeded(row) {
  if (!row) return null;
  if (row.status === 'closed') return row;
  if (new Date(row.expires_at) < new Date()) {
    if (row.status !== 'expired') {
      await promisePool.query(
        `UPDATE ocr_pairing_sessions SET status = 'expired', updated_at = NOW() WHERE id = ?`,
        [row.id],
      );
    }
    return { ...row, status: 'expired' };
  }
  return row;
}

async function lookupByToken(token) {
  await ensureTable();
  const tokenHash = hashToken(token);
  const [rows] = await promisePool.query(
    `SELECT * FROM ocr_pairing_sessions WHERE token_hash = ? LIMIT 1`,
    [tokenHash],
  );
  if (!rows.length) return null;
  return expireIfNeeded(rows[0]);
}

async function createSession({ churchId, userId, recordType, language, recordLayoutMode }) {
  await ensureTable();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const pairingCode = generatePairingCode();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const [result] = await promisePool.query(
    `INSERT INTO ocr_pairing_sessions
      (token_hash, pairing_code, church_id, created_by, record_type, language, record_layout_mode, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tokenHash,
      pairingCode,
      churchId,
      userId,
      recordType || 'custom',
      language || 'en',
      recordLayoutMode || 'auto',
      expiresAt,
    ],
  );

  return {
    id: result.insertId,
    token,
    pairingCode,
    churchId,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: Math.floor(SESSION_TTL_MS / 1000),
    status: 'waiting',
    uploadCount: 0,
    uploads: [],
  };
}

function serializeSession(row, { includeUploads = true } = {}) {
  const uploads = includeUploads ? parseUploads(row) : [];
  return {
    id: row.id,
    churchId: row.church_id,
    createdBy: row.created_by,
    status: row.status,
    pairingCode: row.pairing_code,
    recordType: row.record_type,
    language: row.language,
    recordLayoutMode: row.record_layout_mode,
    uploadCount: row.upload_count,
    uploads,
    firstConnectedAt: row.first_connected_at,
    lastUploadAt: row.last_upload_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

async function getSessionForDesktop(token, userId, isAdmin) {
  const row = await lookupByToken(token);
  if (!row) return { ok: false, status: 404, error: 'Pairing session not found' };
  if (row.status === 'expired') {
    return { ok: false, status: 410, error: 'Pairing session expired', session: serializeSession(row) };
  }
  if (!isAdmin && row.created_by !== userId) {
    return { ok: false, status: 403, error: 'Not authorized for this pairing session' };
  }
  return { ok: true, session: serializeSession(row) };
}

async function markConnected(token) {
  const row = await lookupByToken(token);
  if (!row) return { ok: false, status: 404, error: 'Invalid pairing link' };
  if (row.status === 'expired' || row.status === 'closed') {
    return { ok: false, status: 410, error: 'Pairing session is no longer active' };
  }
  if (row.status === 'waiting') {
    await promisePool.query(
      `UPDATE ocr_pairing_sessions
       SET status = 'connected', first_connected_at = COALESCE(first_connected_at, NOW()), updated_at = NOW()
       WHERE id = ?`,
      [row.id],
    );
    row.status = 'connected';
    row.first_connected_at = row.first_connected_at || new Date();
  }
  const [churchRows] = await promisePool.query(
    'SELECT church_name, name FROM churches WHERE id = ?',
    [row.church_id],
  );
  const churchLabel = churchRows[0]?.church_name || churchRows[0]?.name || 'Church';
  return {
    ok: true,
    session: {
      status: row.status,
      churchId: row.church_id,
      churchLabel,
      recordType: row.record_type,
      language: row.language,
      expiresAt: row.expires_at,
      uploadCount: row.upload_count,
      maxUploads: MAX_UPLOADS_PER_SESSION,
    },
  };
}

async function recordUpload(token, jobs) {
  const row = await lookupByToken(token);
  if (!row) return { ok: false, status: 404, error: 'Invalid pairing link' };
  if (row.status === 'expired' || row.status === 'closed') {
    return { ok: false, status: 410, error: 'Pairing session is no longer active' };
  }
  if (row.upload_count + jobs.length > MAX_UPLOADS_PER_SESSION) {
    return { ok: false, status: 429, error: `Maximum ${MAX_UPLOADS_PER_SESSION} uploads per session` };
  }

  const uploads = parseUploads(row);
  const now = new Date().toISOString();
  for (const job of jobs) {
    uploads.push({
      jobId: job.id,
      filename: job.original_filename || job.filename,
      uploadedAt: now,
    });
  }

  await promisePool.query(
    `UPDATE ocr_pairing_sessions
     SET status = 'receiving',
         upload_count = upload_count + ?,
         uploads_json = ?,
         last_upload_at = NOW(),
         updated_at = NOW()
     WHERE id = ?`,
    [jobs.length, JSON.stringify(uploads), row.id],
  );

  return { ok: true, uploads };
}

async function closeSession(token, userId, isAdmin) {
  const row = await lookupByToken(token);
  if (!row) return { ok: false, status: 404, error: 'Pairing session not found' };
  if (!isAdmin && row.created_by !== userId) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }
  await promisePool.query(
    `UPDATE ocr_pairing_sessions SET status = 'closed', updated_at = NOW() WHERE id = ?`,
    [row.id],
  );
  return { ok: true };
}

module.exports = {
  SESSION_TTL_MS,
  MAX_UPLOADS_PER_SESSION,
  createSession,
  getSessionForDesktop,
  markConnected,
  recordUpload,
  closeSession,
  lookupByToken,
  serializeSession,
};
