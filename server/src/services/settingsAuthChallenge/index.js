/**
 * Pluggable human-auth challenge registry for global settings approvals.
 *
 * A challenge provider proves that a FRESH, live human super_admin is
 * authorizing a specific approval. Plaintext "yes" is never a provider — the
 * verifier always requires cryptographic or credential proof.
 *
 * Provider contract:
 *   {
 *     method: string,                 // stable id, e.g. 'session_reauth'
 *     label: string,                  // human description
 *     available(deps): boolean,       // can this method be offered right now?
 *     async issue({ approval, actor, deps }):
 *        { prompt, expires_in_seconds, nonce? }
 *     async verify({ challenge, approval, response, deps }):
 *        { ok: boolean, verified_identity?: string, reason?: string }
 *   }
 *
 * Add new methods (TOTP, WebAuthn/passkey, OMStudio signed token) by
 * implementing this contract and calling register(). At least one concrete
 * method (session_reauth) is implemented today.
 */

const _providers = new Map();

function register(provider) {
  if (!provider || !provider.method) {
    throw new Error('auth challenge provider requires a "method"');
  }
  _providers.set(provider.method, provider);
  return provider;
}

function get(method) {
  return _providers.get(method) || null;
}

function list(deps) {
  return Array.from(_providers.values()).map((p) => ({
    method: p.method,
    label: p.label,
    available: typeof p.available === 'function' ? !!p.available(deps) : true,
  }));
}

/** The default method to offer when the caller does not specify one. */
function defaultMethod(deps) {
  const available = list(deps).filter((p) => p.available);
  return available.length ? available[0].method : null;
}

// Register built-in providers.
register(require('./sessionReauthProvider'));
register(require('./totpProvider'));
register(require('./signedTokenProvider'));

module.exports = { register, get, list, defaultMethod };
