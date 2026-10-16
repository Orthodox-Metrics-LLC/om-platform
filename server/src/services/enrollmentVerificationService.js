/**
 * Parish enrollment identity verification — email trust assessment and
 * 12-digit postal authorization codes for enrollments where the submitter
 * email is not clearly tied to the parish name or website domain.
 */

'use strict';

const crypto = require('crypto');

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'protonmail.com', 'proton.me', 'pm.me', 'comcast.net', 'att.net', 'verizon.net',
  'sbcglobal.net', 'bellsouth.net', 'charter.net', 'cox.net', 'mail.com', 'zoho.com',
  'yandex.com', 'gmx.com', 'fastmail.com', 'hey.com',
]);

const CHURCH_NAME_STOPWORDS = new Set([
  'orthodox', 'church', 'parish', 'cathedral', 'chapel', 'community', 'holy', 'saint',
  'st', 'the', 'of', 'and', 'greek', 'russian', 'antiochian', 'serbian', 'romanian',
]);

const POSTAL_CODE_LENGTH = 12;
const POSTAL_CODE_TTL_DAYS = 90;
const MAX_VERIFY_ATTEMPTS = 8;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function extractWebsiteDomain(website) {
  const raw = String(website || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    const cleaned = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    return cleaned ? cleaned.toLowerCase() : null;
  }
}

function churchNameTokens(churchName) {
  return String(churchName || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !CHURCH_NAME_STOPWORDS.has(t));
}

function domainStem(domain) {
  const parts = String(domain || '').toLowerCase().split('.');
  if (parts.length >= 2 && parts[parts.length - 1].length === 2 && parts.length >= 3) {
    return parts.slice(0, -2).join('');
  }
  return parts[0] || '';
}

function emailParts(email) {
  const normalized = normalizeEmail(email);
  const at = normalized.indexOf('@');
  if (at < 1) return { local: '', domain: '' };
  return {
    local: normalized.slice(0, at),
    domain: normalized.slice(at + 1),
  };
}

/**
 * Returns whether the submitter email appears tied to the parish.
 */
function assessEmailTrust({ email, churchName, website }) {
  const { local, domain } = emailParts(email);
  if (!local || !domain) {
    return { trusted: false, reason: 'invalid_email' };
  }

  const websiteDomain = extractWebsiteDomain(website);
  if (websiteDomain) {
    if (domain === websiteDomain || domain.endsWith(`.${websiteDomain}`)) {
      return { trusted: true, reason: 'website_domain_match' };
    }
    const siteStem = domainStem(websiteDomain);
    const emailStem = domainStem(domain);
    if (siteStem && emailStem && (siteStem === emailStem || emailStem.includes(siteStem) || siteStem.includes(emailStem))) {
      return { trusted: true, reason: 'website_domain_stem_match' };
    }
  }

  const tokens = churchNameTokens(churchName);
  const emailStem = domainStem(domain);
  for (const token of tokens) {
    if (local.includes(token) || emailStem.includes(token) || domain.includes(token)) {
      return { trusted: true, reason: 'church_name_match' };
    }
  }

  if (!FREE_EMAIL_DOMAINS.has(domain)) {
    // Organizational domain with no obvious parish link still requires verification.
    return { trusted: false, reason: 'domain_not_linked_to_parish' };
  }

  return { trusted: false, reason: 'personal_email_provider' };
}

function generatePostalCode() {
  let code = '';
  for (let i = 0; i < POSTAL_CODE_LENGTH; i += 1) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

function hashPostalCode(code) {
  const normalized = String(code || '').replace(/\D/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function normalizePostalCodeInput(code) {
  return String(code || '').replace(/\D/g, '');
}

function formatPostalCodeDisplay(code) {
  const digits = normalizePostalCodeInput(code);
  if (digits.length !== POSTAL_CODE_LENGTH) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`;
}

function buildMailingAddress(payload) {
  const street = String(payload.address || payload.street || '').trim();
  const city = String(payload.city || '').trim();
  const state = String(payload.state || payload.stateCode || '').trim();
  const zip = String(payload.zip || payload.postal_code || '').trim();
  const country = String(payload.country || 'United States').trim();
  const parishName = String(payload.churchName || payload.parish_name || '').trim();
  return { parishName, street, city, state, zip, country };
}

function mailingAddressComplete(addr) {
  return Boolean(addr.street && addr.city && addr.state && addr.zip);
}

function formatMailingAddressLines(addr) {
  const lines = [];
  if (addr.parishName) lines.push(addr.parishName);
  if (addr.street) lines.push(addr.street);
  const cityLine = [addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
  if (cityLine) lines.push(cityLine);
  if (addr.country && addr.country !== 'United States') lines.push(addr.country);
  return lines;
}

async function applyPostalVerification(pool, onboardingRequestId, {
  codePlaintext,
  mailingAddress,
  trustAssessment,
}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + POSTAL_CODE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const codeHash = hashPostalCode(codePlaintext);

  await pool.query(
    `UPDATE onboarding_requests SET
       status = 'postal_verification_pending',
       email_trust_status = 'postal_verification_required',
       email_trust_reason = ?,
       postal_verification_code_hash = ?,
       postal_verification_generated_at = NOW(),
       postal_verification_expires_at = ?,
       postal_verification_verified_at = NULL,
       postal_verification_attempts = 0,
       postal_mailing_address_json = ?,
       updated_at = NOW()
     WHERE onboarding_request_id = ?`,
    [
      trustAssessment.reason,
      codeHash,
      expiresAt,
      JSON.stringify(mailingAddress),
      onboardingRequestId,
    ],
  );

  return {
    codePlaintext,
    codeDisplay: formatPostalCodeDisplay(codePlaintext),
    expiresAt: expiresAt.toISOString(),
    mailingAddress,
    trustAssessment,
  };
}

async function verifyPostalCode(pool, onboardingRequestId, codeInput) {
  const [rows] = await pool.query(
    `SELECT onboarding_request_id, status, postal_verification_code_hash,
            postal_verification_expires_at, postal_verification_verified_at,
            postal_verification_attempts, parish_name, submitted_by_email
     FROM onboarding_requests
     WHERE onboarding_request_id = ?
     LIMIT 1`,
    [onboardingRequestId],
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, error: 'not_found', message: 'Enrollment reference not found.' };
  }
  if (row.postal_verification_verified_at) {
    return { ok: true, alreadyVerified: true, status: row.status };
  }
  if (row.status !== 'postal_verification_pending') {
    return { ok: false, error: 'not_pending', message: 'This enrollment is not awaiting postal verification.' };
  }
  if (!row.postal_verification_code_hash) {
    return { ok: false, error: 'no_code', message: 'No verification code is on file for this enrollment.' };
  }
  if (row.postal_verification_expires_at && new Date(row.postal_verification_expires_at) < new Date()) {
    return { ok: false, error: 'expired', message: 'This authorization code has expired. Contact info@orthodoxmetrics.com for a new code.' };
  }
  if (row.postal_verification_attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, error: 'too_many_attempts', message: 'Too many incorrect attempts. Contact info@orthodoxmetrics.com for assistance.' };
  }

  const normalized = normalizePostalCodeInput(codeInput);
  if (normalized.length !== POSTAL_CODE_LENGTH) {
    return { ok: false, error: 'invalid_format', message: 'Enter the full 12-digit authorization code from your letter.' };
  }

  const match = hashPostalCode(normalized) === row.postal_verification_code_hash;
  if (!match) {
    await pool.query(
      `UPDATE onboarding_requests SET postal_verification_attempts = postal_verification_attempts + 1, updated_at = NOW()
       WHERE onboarding_request_id = ?`,
      [onboardingRequestId],
    );
    const remaining = Math.max(0, MAX_VERIFY_ATTEMPTS - (row.postal_verification_attempts + 1));
    return {
      ok: false,
      error: 'invalid_code',
      message: 'That authorization code does not match our records.',
      attemptsRemaining: remaining,
    };
  }

  await pool.query(
    `UPDATE onboarding_requests SET
       status = 'submitted',
       postal_verification_verified_at = NOW(),
       updated_at = NOW()
     WHERE onboarding_request_id = ?`,
    [onboardingRequestId],
  );

  return { ok: true, status: 'submitted', parishName: row.parish_name, email: row.submitted_by_email };
}

async function getVerificationStatus(pool, onboardingRequestId) {
  const [rows] = await pool.query(
    `SELECT onboarding_request_id, status, parish_name, submitted_by_email,
            email_trust_status, email_trust_reason,
            postal_verification_verified_at, postal_verification_expires_at,
            postal_verification_attempts, postal_mailing_address_json,
            postal_lob_postcard_id, postal_lob_status,
            postal_lob_mailed_at, postal_lob_delivered_at, postal_lob_last_event
     FROM onboarding_requests WHERE onboarding_request_id = ? LIMIT 1`,
    [onboardingRequestId],
  );
  const row = rows[0];
  if (!row) return null;

  const mailing = row.postal_mailing_address_json
    ? (typeof row.postal_mailing_address_json === 'string'
      ? JSON.parse(row.postal_mailing_address_json)
      : row.postal_mailing_address_json)
    : null;

  return {
    onboarding_request_id: row.onboarding_request_id,
    status: row.status,
    parish_name: row.parish_name,
    requires_postal_verification: row.status === 'postal_verification_pending',
    verified: Boolean(row.postal_verification_verified_at),
    email_trust_reason: row.email_trust_reason,
    expires_at: row.postal_verification_expires_at,
    attempts_remaining: Math.max(0, MAX_VERIFY_ATTEMPTS - (row.postal_verification_attempts || 0)),
    mailing_address: mailing,
    lob_postcard_id: row.postal_lob_postcard_id || null,
    lob_status: row.postal_lob_status || null,
    lob_mailed_at: row.postal_lob_mailed_at,
    lob_delivered_at: row.postal_lob_delivered_at,
    lob_last_event: row.postal_lob_last_event || null,
  };
}

module.exports = {
  POSTAL_CODE_LENGTH,
  MAX_VERIFY_ATTEMPTS,
  assessEmailTrust,
  generatePostalCode,
  hashPostalCode,
  normalizePostalCodeInput,
  formatPostalCodeDisplay,
  buildMailingAddress,
  mailingAddressComplete,
  formatMailingAddressLines,
  applyPostalVerification,
  verifyPostalCode,
  getVerificationStatus,
};
