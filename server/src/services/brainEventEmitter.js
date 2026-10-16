'use strict';

/**
 * OMBrain Phase 1 — fire-and-forget event plane emitter (OM copy).
 * Mirrors omai/_runtime/server/src/services/brainEventEmitter.js
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const ALLOWED_SOURCES = new Set(['om', 'omai', 'omstudio', 'workshop']);
const ALLOWED_SEVERITIES = new Set(['debug', 'info', 'warning', 'error', 'critical']);
const ALLOWED_ACTOR_TYPES = new Set(['user', 'system', 'agent', 'service']);

const SECRET_KEY_RE = /secret|password|passwd|token|api[_-]?key|authorization|bearer|private[_-]?key|credential/i;

const DEFAULT_URL = 'http://192.168.1.254:8390/brain/ingest/event';
const DEFAULT_TIMEOUT_MS = 4000;
const RETRY_DELAY_MS = 750;

function resolveIngestUrl(env = process.env) {
  return (env.BRAIN_INGEST_URL || DEFAULT_URL).trim();
}

function resolveIngestSecret(env = process.env) {
  return env.BRAIN_INGEST_SECRET || env.OMSTUDIO_WEBHOOK_SECRET || '';
}

function isDisabled(env = process.env) {
  const v = env.BRAIN_INGEST_DISABLED;
  return v === '1' || v === 'true';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function redactValue(key, value, depth = 0) {
  if (value == null) return value;
  if (depth > 8) return '[REDACTED_DEPTH]';

  if (typeof key === 'string' && SECRET_KEY_RE.test(key)) {
    return '[REDACTED]';
  }

  if (typeof value === 'string') {
    if (/^Bearer\s+/i.test(value)) return '[REDACTED]';
    if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return '[REDACTED]';
    if (/^(sk|rk|whsec)_/i.test(value)) return '[REDACTED]';
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(null, item, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(k, v, depth + 1);
    }
    return out;
  }

  return value;
}

function redactPayload(data) {
  if (data == null) return {};
  if (typeof data !== 'object' || Array.isArray(data)) return {};
  return redactValue(null, data);
}

function buildBrainEvent(opts = {}) {
  const source = String(opts.source || '').toLowerCase();
  if (!ALLOWED_SOURCES.has(source)) {
    throw new RangeError(`brainEventEmitter: source must be one of: ${[...ALLOWED_SOURCES].join(', ')}`);
  }

  const eventType = String(opts.event_type || opts.type || '').trim();
  if (!eventType) {
    throw new RangeError('brainEventEmitter: event_type is required');
  }

  const severity = ALLOWED_SEVERITIES.has(opts.severity) ? opts.severity : 'info';
  const actorType = ALLOWED_ACTOR_TYPES.has(opts.actor_type) ? opts.actor_type : 'system';

  const requestId = opts.request_id != null ? String(opts.request_id) : null;
  const runId = opts.run_id != null ? String(opts.run_id) : requestId;

  return {
    source,
    event_type: eventType,
    type: eventType,
    severity,
    summary: opts.summary != null ? String(opts.summary).slice(0, 512) : eventType,
    actor_type: actorType,
    actor_id: opts.actor_id != null ? String(opts.actor_id).slice(0, 128) : null,
    request_id: requestId,
    run_id: runId,
    object_type: opts.object_type != null ? String(opts.object_type).slice(0, 64) : null,
    object_id: opts.object_id != null ? String(opts.object_id).slice(0, 128) : null,
    correlation: requestId || runId || null,
    data: redactPayload(opts.data || {}),
    timestamp: opts.timestamp || new Date().toISOString(),
  };
}

function postJson(urlStr, secret, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      return reject(new Error(`brainEventEmitter: invalid URL: ${urlStr}`));
    }

    const payload = JSON.stringify(body);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-OM-Webhook-Secret': secret,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, body: data });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('brainEventEmitter: request timeout'));
    });
    req.write(payload);
    req.end();
  });
}

function emitBrainEvent(event) {
  if (isDisabled()) return;

  const secret = resolveIngestSecret();
  if (!secret) return;

  let envelope;
  try {
    envelope = event.source && event.event_type ? event : buildBrainEvent(event);
  } catch (err) {
    console.error('[brainEventEmitter] invalid event:', err.message);
    return;
  }

  const url = resolveIngestUrl();
  const timeoutMs = Math.max(1000, parseInt(process.env.BRAIN_INGEST_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10));

  const deliver = async () => {
    try {
      await postJson(url, secret, envelope, timeoutMs);
    } catch (err) {
      await sleep(RETRY_DELAY_MS);
      try {
        await postJson(url, secret, envelope, timeoutMs);
      } catch (retryErr) {
        console.error(
          `[brainEventEmitter] delivery failed (${envelope.source}/${envelope.event_type}):`,
          retryErr.message,
        );
      }
    }
  };

  setImmediate(() => {
    deliver().catch(() => {});
  });
}

module.exports = {
  ALLOWED_SOURCES,
  ALLOWED_SEVERITIES,
  buildBrainEvent,
  emitBrainEvent,
  redactPayload,
  resolveIngestSecret,
  resolveIngestUrl,
};
