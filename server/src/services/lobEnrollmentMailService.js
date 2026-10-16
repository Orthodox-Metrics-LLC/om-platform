/**
 * Lob postcard automation for parish enrollment postal verification.
 *
 * Required env (when LOB_ENABLED=true):
 *   LOB_API_KEY              — Lob **secret** print & mail API key (test_… or live_…; NOT test_pub_…)
 *   LOB_FROM_NAME            — e.g. Orthodox Metrics LLC
 *   LOB_FROM_LINE1           — verified return-address street
 *   LOB_FROM_CITY
 *   LOB_FROM_STATE           — 2-letter state
 *   LOB_FROM_ZIP
 * Optional:
 *   LOB_WEBHOOK_SECRET       — Lob dashboard webhook signing secret
 *   LOB_POSTCARD_SIZE        — 4x6 (default) or 6x9
 *   LOB_POSTCARD_FRONT_URL   — public HTTPS URL to designed front image (PNG/JPEG/PDF)
 *   LOB_VERIFY_URL_BASE      — default https://orthodoxmetrics.com/enroll
 */

'use strict';

const crypto = require('crypto');
const axios = require('axios');

const LOB_API_BASE = 'https://api.lob.com/v1';

function isEnabled() {
  return String(process.env.LOB_ENABLED || '').toLowerCase() === 'true'
    && Boolean(process.env.LOB_API_KEY);
}

function fromAddressConfig() {
  const name = process.env.LOB_FROM_NAME || 'Orthodox Metrics LLC';
  const line1 = process.env.LOB_FROM_LINE1 || '';
  const city = process.env.LOB_FROM_CITY || '';
  const state = process.env.LOB_FROM_STATE || '';
  const zip = process.env.LOB_FROM_ZIP || '';
  if (!line1 || !city || !state || !zip) {
    return null;
  }
  return {
    name,
    address_line1: line1,
    address_city: city,
    address_state: state,
    address_zip: zip,
    address_country: 'US',
  };
}

function buildToAddress(mailingAddress) {
  const parishName = String(mailingAddress.parishName || '').trim();
  const street = String(mailingAddress.street || '').trim();
  const city = String(mailingAddress.city || '').trim();
  const state = String(mailingAddress.state || '').trim();
  const zip = String(mailingAddress.zip || '').trim();
  if (!street || !city || !state || !zip) {
    throw new Error('Incomplete parish mailing address for Lob postcard');
  }
  return {
    name: parishName || 'Parish Contact',
    address_line1: street,
    address_city: city,
    address_state: state,
    address_zip: zip,
    address_country: 'US',
  };
}

function postcardFrontImageUrl() {
  const raw = String(process.env.LOB_POSTCARD_FRONT_URL || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function postcardBackHtml({ parishName, codeDisplay, reference, verifyUrl }) {
  const safeParish = escapeHtml(parishName);
  const safeCode = escapeHtml(codeDisplay);
  const safeRef = escapeHtml(reference);
  const safeUrl = escapeHtml(verifyUrl);

  return `<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css?family=Source+Sans+Pro:400,600,700" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Source Sans Pro', Arial, sans-serif; background: #fdfcf9; color: #1a2e52; width: 100%; height: 100%; }
    .wrap { padding: 28px 24px; }
    .brand { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #d4af37; font-weight: 600; margin-bottom: 10px; }
    .parish { font-size: 14px; font-weight: 600; margin-bottom: 14px; line-height: 1.35; }
    .label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #1a2e52; opacity: 0.6; font-weight: 600; }
    .code { margin: 10px 0 16px; font-size: 30px; font-weight: 700; letter-spacing: 0.14em; color: #1a2e52; }
    .ref { font-size: 12px; margin-bottom: 14px; }
    p { font-size: 13px; line-height: 1.55; margin-bottom: 10px; }
    .url { color: #1a2e52; font-weight: 600; font-size: 12px; word-break: break-all; }
    .help { margin-top: 16px; font-size: 11px; color: #1a2e52; opacity: 0.65; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">Orthodox Metrics LLC</div>
    <div class="parish">${safeParish}</div>
    <div class="label">Authorization Code</div>
    <div class="code">${safeCode}</div>
    <div class="ref"><strong>Reference:</strong> ${safeRef}</div>
    <p>Enter this 12-digit code at our enrollment page to verify your parish identity and complete enrollment.</p>
    <p class="url">${safeUrl}</p>
    <p class="help">Questions? info@orthodoxmetrics.com</p>
  </div>
</body>
</html>`;
}

/** Fallback front HTML when LOB_POSTCARD_FRONT_URL is not configured. */
function postcardFrontHtmlFallback({ parishName }) {
  const safeParish = escapeHtml(parishName);
  return `<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css?family=Source+Sans+Pro:400,600,700" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Source Sans Pro', Arial, sans-serif; background: #1a2e52; color: #fff; width: 100%; height: 100%; }
    .wrap { padding: 36px 28px; height: 100%; display: flex; flex-direction: column; justify-content: space-between; }
    .brand { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #d4af37; font-weight: 600; }
    h1 { font-size: 26px; line-height: 1.2; margin-top: 18px; font-weight: 700; }
    .parish { margin-top: 10px; font-size: 15px; color: rgba(255,255,255,0.85); }
    .footer { font-size: 11px; color: rgba(255,255,255,0.55); }
  </style>
</head>
<body>
  <div class="wrap">
    <div>
      <div class="brand">Orthodox Metrics LLC</div>
      <h1>Parish Enrollment Verification</h1>
      <p class="parish">${safeParish}</p>
    </div>
    <p class="footer">Preserving parish records with care and precision.</p>
  </div>
</body>
</html>`;
}

function resolvePostcardFront({ parishName }) {
  const imageUrl = postcardFrontImageUrl();
  if (imageUrl) {
    return { type: 'url', value: imageUrl };
  }
  return { type: 'html', value: postcardFrontHtmlFallback({ parishName }) };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isPublishableLobKey(apiKey) {
  return /_(pub|publishable)_/i.test(String(apiKey || '')) || String(apiKey || '').includes('_pub_');
}

function assertSecretLobApiKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) {
    throw new Error('LOB_API_KEY is not set');
  }
  if (isPublishableLobKey(key)) {
    throw new Error(
      'LOB_API_KEY is a Lob publishable key (test_pub_/live_pub_). '
      + 'Use the secret Print & Mail API key from Lob → Settings → API Keys.',
    );
  }
}

async function lobRequest(method, path, data) {
  const apiKey = process.env.LOB_API_KEY;
  assertSecretLobApiKey(apiKey);
  const url = `${LOB_API_BASE}${path}`;
  const response = await axios({
    method,
    url,
    data,
    auth: { username: apiKey, password: '' },
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (response.status >= 400) {
    const lobCode = response.data?.error?.code;
    const detail = response.data?.error?.message || response.data?.message || JSON.stringify(response.data);
    if (lobCode === 'publishable_key_not_allowed' || response.status === 403) {
      throw new Error(
        'Lob rejected the API key: use the secret Print & Mail key (test_… or live_…), not the publishable key (test_pub_…).',
      );
    }
    throw new Error(`Lob API ${response.status}: ${detail}`);
  }
  return response.data;
}

async function sendVerificationPostcard({
  onboardingRequestId,
  parishName,
  mailingAddress,
  codeDisplay,
}) {
  if (!isEnabled()) {
    return { ok: false, skipped: true, reason: 'lob_disabled' };
  }

  const from = fromAddressConfig();
  if (!from) {
    return { ok: false, skipped: true, reason: 'lob_from_address_not_configured' };
  }

  const verifyBase = (process.env.LOB_VERIFY_URL_BASE || 'https://orthodoxmetrics.com/enroll').replace(/\/$/, '');
  const verifyUrl = `${verifyBase}?verify=${encodeURIComponent(onboardingRequestId)}`;
  const size = process.env.LOB_POSTCARD_SIZE || '4x6';
  const front = resolvePostcardFront({ parishName });

  const payload = {
    description: `Enrollment verification — ${onboardingRequestId}`,
    to: buildToAddress(mailingAddress),
    from,
    size,
    front: front.value,
    back: postcardBackHtml({
      parishName,
      codeDisplay,
      reference: onboardingRequestId,
      verifyUrl,
    }),
    metadata: {
      onboarding_request_id: onboardingRequestId,
      type: 'enrollment_postal_verification',
      front_type: front.type,
    },
  };

  const postcard = await lobRequest('POST', '/postcards', payload);
  return {
    ok: true,
    postcardId: postcard.id,
    status: postcard.status || 'created',
    expectedDeliveryDate: postcard.expected_delivery_date || null,
    url: postcard.url || null,
  };
}

async function recordLobPostcardQueued(pool, onboardingRequestId, lobResult) {
  await pool.query(
    `UPDATE onboarding_requests SET
       postal_lob_postcard_id = ?,
       postal_lob_status = ?,
       postal_lob_last_event = 'postcard.created',
       postal_lob_last_event_at = NOW(),
       updated_at = NOW()
     WHERE onboarding_request_id = ?`,
    [lobResult.postcardId, lobResult.status, onboardingRequestId],
  );
}

const LOB_DELIVERED_EVENTS = new Set([
  'postcard.processed_for_delivery',
  'postcard.delivered',
]);

const LOB_MAILED_EVENTS = new Set([
  'postcard.mailed',
  'postcard.in_transit',
  'postcard.in_local_area',
]);

function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.LOB_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return !secret;

  const parts = String(signatureHeader).split(',');
  let timestamp = '';
  let signature = '';
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    if (key === 'v1') signature = value;
  }
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

async function handleWebhookEvent(pool, event) {
  const eventType = event?.event_type?.id || event?.type || '';
  const body = event?.body || event?.data || {};
  const postcardId = body?.id || event?.reference_id || null;
  const onboardingRequestId = body?.metadata?.onboarding_request_id || null;

  if (!postcardId && !onboardingRequestId) {
    return { ok: false, reason: 'no_identifiers' };
  }

  const [rows] = await pool.query(
    `SELECT onboarding_request_id FROM onboarding_requests
     WHERE ${onboardingRequestId ? 'onboarding_request_id = ?' : 'postal_lob_postcard_id = ?'}
     LIMIT 1`,
    [onboardingRequestId || postcardId],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'onboarding_not_found' };

  const updates = [
    'postal_lob_last_event = ?',
    'postal_lob_last_event_at = NOW()',
    'updated_at = NOW()',
  ];
  const params = [eventType];

  if (LOB_MAILED_EVENTS.has(eventType)) {
    updates.push('postal_lob_status = ?', 'postal_lob_mailed_at = COALESCE(postal_lob_mailed_at, NOW())');
    params.push('mailed');
  }
  if (LOB_DELIVERED_EVENTS.has(eventType)) {
    updates.push('postal_lob_status = ?', 'postal_lob_delivered_at = COALESCE(postal_lob_delivered_at, NOW())');
    params.push('delivered');
  }
  if (eventType === 'postcard.returned_to_sender') {
    updates.push('postal_lob_status = ?');
    params.push('returned');
  }
  if (eventType === 'postcard.failed' || eventType === 'postcard.rejected') {
    updates.push('postal_lob_status = ?');
    params.push('failed');
  }

  params.push(row.onboarding_request_id);
  await pool.query(
    `UPDATE onboarding_requests SET ${updates.join(', ')} WHERE onboarding_request_id = ?`,
    params,
  );

  return { ok: true, onboardingRequestId: row.onboarding_request_id, eventType };
}

function publicConfig() {
  const frontUrl = postcardFrontImageUrl();
  const apiKey = process.env.LOB_API_KEY || '';
  return {
    enabled: isEnabled(),
    apiKeyType: isPublishableLobKey(apiKey) ? 'publishable_invalid' : apiKey ? 'secret' : 'missing',
    fromAddressConfigured: Boolean(fromAddressConfig()),
    postcardSize: process.env.LOB_POSTCARD_SIZE || '4x6',
    frontImageUrl: frontUrl,
    frontImageConfigured: Boolean(frontUrl),
    backRenderedOnServer: true,
    webhookConfigured: Boolean(process.env.LOB_WEBHOOK_SECRET),
  };
}

module.exports = {
  isEnabled,
  publicConfig,
  sendVerificationPostcard,
  recordLobPostcardQueued,
  verifyWebhookSignature,
  handleWebhookEvent,
};
