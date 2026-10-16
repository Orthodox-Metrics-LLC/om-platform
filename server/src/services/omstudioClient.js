/**
 * Shared OMStudio omsvc client for read-only governance proxies.
 *
 * OM authenticates as the omsvc service identity against OMStudio /api/auth/login,
 * caches the JWT in-memory (OMStudio TTL is 8h), and uses it for upstream GETs.
 * On 401 we clear the cache and retry once.
 *
 * Config:
 *   OMSTUDIO_URL                  default http://192.168.1.242
 *   OMSTUDIO_OMSVC_EMAIL          default omsvc@orthodoxmetrics.com
 *   OMSTUDIO_OMSVC_PASSWORD       env, else /var/lib/omstudio/secrets/OMSTUDIO_OMSVC_PASSWORD.creds
 *   OMSTUDIO_OMSVC_PASSWORD_FILE  override password file path
 */

const fs = require('fs');

const TOKEN_CACHE_MS = 7 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8000;
const DEFAULT_PASSWORD_FILES = [
  '/var/lib/omstudio/secrets/OMSTUDIO_OMSVC_PASSWORD.creds',
  '/var/lib/omstudio/secrets/OMSVC_PASSWORD.creds',
];

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function omstudioBase() {
  const raw = process.env.OMSTUDIO_URL || 'http://192.168.1.242';
  return raw.replace(/\/$/, '');
}

function emptyState(upstream, error, detail) {
  return { ok: false, available: false, upstream, error, detail };
}

function readPassword() {
  const fromEnv = process.env.OMSTUDIO_OMSVC_PASSWORD;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const candidates = [
    process.env.OMSTUDIO_OMSVC_PASSWORD_FILE,
    ...DEFAULT_PASSWORD_FILES,
  ].filter(Boolean);
  for (const filePath of candidates) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const trimmed = raw.trim();
      if (trimmed) return trimmed;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function mintToken(base) {
  const password = readPassword();
  if (!password) {
    const err = new Error(
      `OMStudio omsvc password not found (checked OMSTUDIO_OMSVC_PASSWORD env, then ${[
        process.env.OMSTUDIO_OMSVC_PASSWORD_FILE,
        ...DEFAULT_PASSWORD_FILES,
      ].filter(Boolean).join(', ')})`,
    );
    err.code = 'credentials_not_provisioned';
    throw err;
  }
  const email = process.env.OMSTUDIO_OMSVC_EMAIL || 'omsvc@orthodoxmetrics.com';

  let res;
  try {
    res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (cause) {
    const err = new Error(`omsvc login network error: ${cause.message || cause}`);
    err.code = 'omstudio_unreachable';
    throw err;
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    const err = new Error(`omsvc login HTTP ${res.status} — ${body.slice(0, 300)}`);
    err.code = res.status === 401 || res.status === 403 ? 'omsvc_login_rejected' : 'omsvc_login_failed';
    throw err;
  }

  let payload;
  try { payload = await res.json(); } catch {
    const err = new Error('omsvc login returned non-JSON');
    err.code = 'omsvc_login_failed';
    throw err;
  }
  const token = payload && (payload.access_token || payload.token || payload.accessToken);
  if (!token) {
    const err = new Error('omsvc login response missing access_token');
    err.code = 'omsvc_login_failed';
    throw err;
  }
  return token;
}

async function getToken(base, { force = false } = {}) {
  const now = Date.now();
  if (!force && cachedToken && cachedTokenExpiresAt > now) return cachedToken;
  cachedToken = await mintToken(base);
  cachedTokenExpiresAt = now + TOKEN_CACHE_MS;
  return cachedToken;
}

function clearTokenCache() {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
}

/**
 * Fetch a JSON governance endpoint from OMStudio.
 * @returns {{ ok: true, data: object, upstream: string, fetched_at: string } | ReturnType<emptyState>}
 */
async function fetchGovernance(path) {
  const base = omstudioBase();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const upstream = `${base}/api${normalized}`;

  let token;
  try {
    token = await getToken(base);
  } catch (err) {
    return emptyState(upstream, err.code || 'auth_error', err.message);
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    return emptyState(upstream, 'omstudio_unreachable', String(err.message || err));
  }

  if (upstreamRes.status === 401) {
    clearTokenCache();
    try {
      token = await getToken(base, { force: true });
      upstreamRes = await fetch(upstream, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      return emptyState(upstream, err.code || 'auth_error', err.message);
    }
  }

  if (upstreamRes.status === 404) {
    return emptyState(
      upstream,
      'endpoint_not_yet_published',
      `OMStudio has not yet published ${normalized}.`,
    );
  }

  if (!upstreamRes.ok) {
    let detail = `upstream HTTP ${upstreamRes.status}`;
    try {
      const body = await upstreamRes.text();
      if (body) detail += ` — ${body.slice(0, 500)}`;
    } catch { /* ignore */ }
    return emptyState(upstream, 'upstream_error', detail);
  }

  let payload;
  try {
    payload = await upstreamRes.json();
  } catch (err) {
    return emptyState(upstream, 'upstream_invalid_json', String(err.message || err));
  }

  return {
    ok: true,
    available: true,
    upstream,
    fetched_at: new Date().toISOString(),
    data: payload,
  };
}

module.exports = {
  omstudioBase,
  emptyState,
  fetchGovernance,
  clearTokenCache,
};
