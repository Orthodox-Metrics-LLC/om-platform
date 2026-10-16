'use strict';

// OMSD-1640 — System-Wide Audit Event Emitter
// Batches events and POSTs to OMStudio POST /api/v2/studio/ingest/audit.

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const ALLOWED_SOURCES = new Set(['OM', 'OMAI', 'OMWorkshop', 'OMStudio']);
const INGEST_PATH = '/api/v2/studio/ingest/audit';

function httpPost(urlStr, token, body) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      return reject(new Error(`auditEmitter: invalid URL: ${urlStr}`));
    }

    const payload = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${token}`,
      },
    };

    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: data });
        } else {
          reject(new Error(`auditEmitter: HTTP ${res.statusCode} — ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('auditEmitter: request timeout'));
    });
    req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class AuditEmitter {
  constructor({
    sourceSystem,
    studioUrl,
    ingestUrl,
    serviceToken,
    batchSize,
    flushMs,
    disabled,
  }) {
    if (!ALLOWED_SOURCES.has(sourceSystem)) {
      throw new RangeError(
        `auditEmitter: sourceSystem must be one of: ${[...ALLOWED_SOURCES].join(', ')}`,
      );
    }

    this._source = sourceSystem;
    const baseUrl = (studioUrl || process.env.OMSTUDIO_AUDIT_URL || 'http://192.168.1.242:3001')
      .replace(/\/$/, '');
    this._url = ingestUrl
      || process.env.OMSTUDIO_AUDIT_INGEST_URL
      || `${baseUrl}${INGEST_PATH}`;
    this._token = serviceToken || process.env.OMSTUDIO_SERVICE_TOKEN || '';
    this._batchSize = Math.min(200, Math.max(1, batchSize || 50));
    this._flushMs = Math.max(100, flushMs || 2000);
    this._disabled = disabled === true || disabled === '1' || disabled === 'true';
    this._queue = [];
    this._timer = null;
    this._flushing = false;

    if (!this._disabled) {
      this._startTimer();
    }
  }

  emit(event) {
    if (this._disabled) return;

    const ev = {
      event_id: event.event_id || crypto.randomUUID(),
      source_system: this._source,
      event_type: event.event_type || 'unknown',
      action: event.action || 'unknown',
      actor_id: event.actor_id || null,
      actor_email: event.actor_email || null,
      actor_role: event.actor_role || null,
      target_type: event.target_type || null,
      target_id: event.target_id || null,
      details: event.details || null,
      ip_address: event.ip_address || null,
      user_agent: event.user_agent || null,
      emitted_at: event.emitted_at || new Date().toISOString(),
    };

    this._queue.push(ev);

    if (this._queue.length >= this._batchSize) {
      this._scheduleFlush();
    }
  }

  emitFromRequest(req, event) {
    const user = req.user || {};
    this.emit({
      actor_id: user.id || user.sub || null,
      actor_email: user.email || null,
      actor_role: user.role || null,
      ip_address: req.ip || null,
      user_agent: req.get ? req.get('User-Agent') : null,
      ...event,
    });
  }

  async flush() {
    return this._flush();
  }

  async shutdown() {
    this._stopTimer();
    await this._flush();
  }

  _startTimer() {
    this._timer = setInterval(() => this._scheduleFlush(), this._flushMs);
    if (this._timer.unref) this._timer.unref();
  }

  _stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _scheduleFlush() {
    setImmediate(() => this._flush().catch(() => {}));
  }

  async _flush() {
    if (this._flushing || this._queue.length === 0) return;
    if (!this._token) {
      this._queue.length = 0;
      return;
    }

    this._flushing = true;
    const batch = this._queue.splice(0, this._batchSize);

    try {
      await httpPost(this._url, this._token, { events: batch });
    } catch (err) {
      await sleep(1000);
      try {
        await httpPost(this._url, this._token, { events: batch });
      } catch (retryErr) {
        console.error(
          `[auditEmitter] Failed to deliver ${batch.length} events after retry:`,
          retryErr.message,
        );
      }
    } finally {
      this._flushing = false;
    }
  }
}

function createAuditEmitter(opts = {}) {
  return new AuditEmitter({
    sourceSystem: opts.sourceSystem,
    studioUrl: opts.studioUrl,
    ingestUrl: opts.ingestUrl,
    serviceToken: opts.serviceToken,
    batchSize: opts.batchSize
      || parseInt(process.env.OMSTUDIO_AUDIT_BATCH_SIZE || '50', 10),
    flushMs: opts.flushMs
      || parseInt(process.env.OMSTUDIO_AUDIT_FLUSH_MS || '2000', 10),
    disabled: opts.disabled !== undefined
      ? opts.disabled
      : (process.env.OMSTUDIO_AUDIT_DISABLED || ''),
  });
}

module.exports = { createAuditEmitter, AuditEmitter };
