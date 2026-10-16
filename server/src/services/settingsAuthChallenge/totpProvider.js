/**
 * totp — RFC 6238 time-based one-time password challenge (pluggable).
 *
 * The algorithm is fully implemented, but the method only becomes AVAILABLE
 * once a TOTP secret store is wired up (env SETTINGS_APPROVAL_TOTP_ENABLED=1
 * plus a per-user secret source). Until then it registers as an unavailable
 * provider so the pluggable interface is demonstrated without offering an
 * unusable path. Swap `loadSecret` for your real secret store to enable.
 */

const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 180;
const STEP = 30;
const DIGITS = 6;

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input).replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

function verifyTotp(secretBase32, token, window = 1) {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / STEP);
  for (let i = -window; i <= window; i += 1) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, counter + i)), Buffer.from(String(token)))) {
      return true;
    }
  }
  return false;
}

// Placeholder secret source. Replace with a real per-user store to enable.
async function loadSecret(/* email, deps */) {
  return null;
}

module.exports = {
  method: 'totp',
  label: 'Authenticator app (TOTP)',
  verifyTotp, // exported for tests / other callers

  available() {
    return process.env.SETTINGS_APPROVAL_TOTP_ENABLED === '1';
  },

  async issue() {
    return {
      prompt: 'Enter the 6-digit code from your authenticator app for the approving super_admin.',
      expires_in_seconds: DEFAULT_TTL_SECONDS,
      nonce: null,
    };
  },

  async verify({ response, deps }) {
    const email = response && response.email;
    const token = response && (response.token || response.code);
    if (!email || !token) {
      return { ok: false, reason: 'email and TOTP code are required' };
    }
    const secret = await loadSecret(email, deps);
    if (!secret) {
      return { ok: false, reason: 'no TOTP secret configured for this account' };
    }
    // Confirm the account is an active super_admin before honoring the code.
    const [rows] = await deps.pool.query(
      'SELECT role, is_active FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    const user = rows && rows[0];
    if (!user || !user.is_active || user.role !== 'super_admin') {
      return { ok: false, reason: 'approver must be an active super_admin' };
    }
    if (!verifyTotp(secret, token)) {
      return { ok: false, reason: 'invalid TOTP code' };
    }
    return { ok: true, verified_identity: email };
  },
};
