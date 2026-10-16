'use strict';

const https = require('https');
const { normalizeE164 } = require('./phone');

const REQUIRED = Object.freeze([
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
]);

function health(env) {
  const source = env || process.env;
  const missing = [];
  if (!String(source.TWILIO_ACCOUNT_SID || '').trim()) missing.push('TWILIO_ACCOUNT_SID');
  if (!String(source.TWILIO_AUTH_TOKEN || '').trim()) missing.push('TWILIO_AUTH_TOKEN');
  if (!normalizeE164(source.TWILIO_FROM_NUMBER)) missing.push('TWILIO_FROM_NUMBER');
  return {
    provider: 'twilio',
    operational: missing.length === 0,
    missing,
  };
}

function redact(text, env) {
  let out = String(text || '');
  const source = env || {};
  for (const secret of [source.TWILIO_AUTH_TOKEN, source.TWILIO_ACCOUNT_SID]) {
    const value = String(secret || '').trim();
    if (value) out = out.split(value).join('[redacted]');
  }
  return out.slice(0, 500);
}

function postForm(request) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(request.url);
    } catch (err) {
      reject(err);
      return;
    }
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers: request.headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').slice(0, 4000);
        let json = null;
        try { json = JSON.parse(raw); } catch (_) { json = null; }
        resolve({ statusCode: res.statusCode, json });
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('sms_timeout')));
    req.on('error', reject);
    req.end(request.body);
  });
}

async function send(message, env, post) {
  const source = env || process.env;
  const status = health(source);
  if (!status.operational) {
    return { ok: false, error: 'sms_transport_unconfigured', retryable: false };
  }
  const to = normalizeE164(message && message.to);
  const from = normalizeE164(source.TWILIO_FROM_NUMBER);
  if (!to) return { ok: false, error: 'invalid_phone', retryable: false };
  const sid = String(source.TWILIO_ACCOUNT_SID).trim();
  const token = String(source.TWILIO_AUTH_TOKEN).trim();
  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: String((message && message.body) || '').slice(0, 1600),
  }).toString();
  const deliver = post || postForm;
  try {
    const response = await deliver({
      url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      body,
    });
    const payload = response && response.json;
    if (response && response.statusCode >= 200 && response.statusCode < 300 && payload && payload.sid) {
      return { ok: true, providerMessageId: String(payload.sid).slice(0, 64) };
    }
    const detail = payload && (payload.message || payload.code)
      ? `${payload.code || 'twilio'}: ${payload.message || response.statusCode}`
      : `twilio_http_${response && response.statusCode}`;
    return { ok: false, error: redact(detail, source), retryable: true };
  } catch (err) {
    return {
      ok: false,
      error: redact(err && err.message ? err.message : 'sms_failed', source),
      retryable: true,
    };
  }
}

module.exports = {
  REQUIRED,
  health,
  redact,
  send,
};
