'use strict';

/**
 * Read single-line secrets rendered from OMStudio Platform Secrets vault
 * (see OMStudio platformSecretCatalog + secretRenderTargets).
 *
 * Passwords for info@ / records@ belong in OMStudio — not in server/.env.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SECRETS_DIR = '/var/lib/omstudio/secrets';

const MAILBOX_SMTP_DEFAULTS = Object.freeze({
  info: Object.freeze({
    secretName: 'INFO_PASSWORD',
    email: 'info@orthodoxmetrics.com',
    smtpHost: 'smtp.porkbun.com',
    smtpPort: 587,
    smtpSecure: false,
  }),
  records: Object.freeze({
    secretName: 'RECORDS_PASSWORD',
    email: 'records@orthodoxmetrics.com',
    smtpHost: 'smtp.porkbun.com',
    smtpPort: 587,
    smtpSecure: false,
  }),
});

function secretsDir() {
  return process.env.OMSTUDIO_SECRETS_DIR || DEFAULT_SECRETS_DIR;
}

function stripWrappingQuotes(value) {
  const v = String(value).trim();
  if (
    (v.startsWith('"') && v.endsWith('"'))
    || (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * OMStudio `creds_file` render writes the vault value verbatim (see buildRenderScript).
 * Preferred vault value: mailbox password only, one line, no KEY= prefix.
 * Also accepts a single line `INFO_PASSWORD=secret` or `INFO_PASSWORD="secret"`.
 */
function readCredsFile(fileName) {
  const filePath = path.join(secretsDir(), fileName);
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    const line = raw.split(/\r?\n/)[0].trim();
    if (!line) return null;
    const eq = line.indexOf('=');
    if (eq > 0) {
      return stripWrappingQuotes(line.slice(eq + 1));
    }
    return stripWrappingQuotes(line);
  } catch {
    return null;
  }
}

/**
 * @param {'info'|'records'} mailboxKey
 * @returns {{ ok: true, user: string, pass: string, host: string, port: number, secure: boolean, source: string } | { ok: false, error: string, hint?: string }}
 */
function resolveMailboxSmtpCredentials(mailboxKey) {
  const base = MAILBOX_SMTP_DEFAULTS[mailboxKey];
  if (!base) {
    return { ok: false, error: `unknown_mailbox:${mailboxKey}` };
  }

  const pass = readCredsFile(`${base.secretName}.creds`);
  if (!pass) {
    return {
      ok: false,
      error: `${base.secretName} not found on this host`,
      hint:
        `Store ${base.email} password in OMStudio → Platform Secrets (${base.secretName}), `
        + `then render to ${secretsDir()}/${base.secretName}.creds on this server.`,
    };
  }

  // Do not fall back to server/.env SMTP_* — those often point at legacy O365 while
  // mailbox passwords in the vault are Porkbun (webmail.porkbun.com / mail.porkbun.com).
  const host =
    process.env[`OM_${mailboxKey.toUpperCase()}_SMTP_HOST`]
    || base.smtpHost;
  const port = parseInt(
    process.env[`OM_${mailboxKey.toUpperCase()}_SMTP_PORT`]
    || String(base.smtpPort),
    10,
  );
  const secureRaw = process.env[`OM_${mailboxKey.toUpperCase()}_SMTP_SECURE`];
  const secure = secureRaw === 'true' || secureRaw === true;

  return {
    ok: true,
    user: base.email,
    pass,
    host,
    port,
    secure,
    source: `${secretsDir()}/${base.secretName}.creds`,
  };
}

module.exports = {
  secretsDir,
  readCredsFile,
  resolveMailboxSmtpCredentials,
  MAILBOX_SMTP_DEFAULTS,
};
