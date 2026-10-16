/**
 * signed_token — short-lived HMAC-signed approval token issued by OMStudio.
 *
 * When a super_admin approves inside the OMStudio Brain Approvals UI, OMStudio
 * can mint a short-lived signed token bound to the approval ref + proposed
 * value hash + approver identity, and hand it to OMBrain to complete the apply.
 * This lets OMStudio be the human-auth authority while OMBrain performs the
 * apply — without OMBrain ever holding credentials.
 *
 * Token format (compact, dependency-free):
 *   base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, secret))
 *   payload = { ref, value_hash, sub (approver email), iat, exp }
 *
 * AVAILABLE only when OMSTUDIO_APPROVAL_TOKEN_SECRET is configured.
 */

const crypto = require('crypto');

function b64urlDecode(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function secret() {
  return process.env.OMSTUDIO_APPROVAL_TOKEN_SECRET || '';
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  method: 'signed_token',
  label: 'OMStudio short-lived signed approval token',

  available() {
    return !!secret();
  },

  async issue({ approval }) {
    return {
      prompt:
        'Approve in the OMStudio Brain Approvals UI to obtain a short-lived signed token, '
        + `then submit it here to complete approval of ${approval.approval_ref}.`,
      expires_in_seconds: 300,
      nonce: null,
    };
  },

  async verify({ approval, response }) {
    const token = response && response.token;
    const key = secret();
    if (!key) return { ok: false, reason: 'signed_token method is not configured' };
    if (!token || typeof token !== 'string' || !token.includes('.')) {
      return { ok: false, reason: 'a signed approval token is required' };
    }

    const [payloadPart, sigPart] = token.split('.');
    const expectedSig = crypto
      .createHmac('sha256', key)
      .update(payloadPart)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    if (!safeEqual(sigPart, expectedSig)) {
      return { ok: false, reason: 'invalid token signature' };
    }

    let payload;
    try {
      payload = JSON.parse(b64urlDecode(payloadPart).toString('utf8'));
    } catch {
      return { ok: false, reason: 'malformed token payload' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      return { ok: false, reason: 'token expired' };
    }
    if (payload.ref && payload.ref !== approval.approval_ref) {
      return { ok: false, reason: 'token not bound to this approval' };
    }
    if (payload.value_hash && approval.proposed_value_hash && payload.value_hash !== approval.proposed_value_hash) {
      return { ok: false, reason: 'token bound to a different proposed value' };
    }
    if (!payload.sub) {
      return { ok: false, reason: 'token missing approver identity' };
    }

    return { ok: true, verified_identity: payload.sub };
  },
};
