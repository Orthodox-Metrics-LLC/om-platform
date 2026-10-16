'use strict';

/**
 * OMBrain client — replaces the old in-process `misc/omai/services/index.js`
 * bridge (archived out of this repo on 2026-06-13). The askOMAI/askOMAIWithMetadata/
 * getOMAIHealth/getOMAIStats capability now lives in the standalone OMBrain
 * HTTP service (see /var/www/omai/om-brain), not in-process.
 *
 * Mirrors the HTTP-client conventions already used by brainEventEmitter.js.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_BRAIN_URL = 'http://192.168.1.254:8390';
const DEFAULT_TIMEOUT_MS = 30000;
const HEALTH_TIMEOUT_MS = 5000;

function resolveBrainUrl(env = process.env) {
  return (env.OM_BRAIN_URL || DEFAULT_BRAIN_URL).replace(/\/$/, '');
}

function brainRequest(method, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(path, resolveBrainUrl() + '/');
    } catch (err) {
      return reject(new Error(`omaiBrainClient: invalid URL: ${path}`));
    }

    const payload = body ? JSON.stringify(body) : null;
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : null;
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
            else reject(new Error(`Brain ${method} ${path} HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          } catch (err) {
            reject(new Error(`Brain ${method} ${path} non-JSON response: ${data.slice(0, 200)}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`omaiBrainClient: request timeout (${method} ${path})`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Ask OMBrain a question. Returns the plain-text answer string
 * (mirrors the old askOMAI(prompt) -> string surface).
 */
async function askOMAI(prompt) {
  const res = await brainRequest('POST', '/brain/ask', { query: prompt });
  return res && res.answer ? String(res.answer) : '';
}

/**
 * Ask OMBrain with extra context, returning the old
 * askOMAIWithMetadata surface: { response, usage?, ... }.
 */
async function askOMAIWithMetadata(prompt, context = {}) {
  const res = await brainRequest('POST', '/brain/ask', {
    query: prompt,
    session_id: context.sessionId || context.session_id,
    force_mode: context.forceMode || context.force_mode,
    skill: context.skill,
  });
  return {
    response: res && res.answer ? String(res.answer) : '',
    mode: res && res.mode,
    recommendation: res && res.recommendation,
    detail: res && res.detail,
    ok: res && res.ok,
    error: res && res.error,
  };
}

async function getOMAIHealth() {
  const res = await brainRequest('GET', '/health', null, HEALTH_TIMEOUT_MS);
  return { status: res && res.ok ? 'healthy' : 'unhealthy', ...res };
}

/**
 * OMBrain has no request-count/latency stats endpoint (the old
 * getOMAIStats() surface doesn't have a direct equivalent) — /status is
 * the closest available runtime snapshot.
 */
async function getOMAIStats() {
  return brainRequest('GET', '/status', null, HEALTH_TIMEOUT_MS);
}

module.exports = { askOMAI, askOMAIWithMetadata, getOMAIHealth, getOMAIStats, resolveBrainUrl };
