'use strict';

/**
 * Email operator when an agent drops a task-completion OM Document.
 * Used by drop-om-document.js (CLI, no full server boot).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function requireFromServer(name) {
  try {
    return require(name);
  } catch {
    return require(path.join(REPO_ROOT, 'server/node_modules', name));
  }
}

const nodemailer = requireFromServer('nodemailer');

function loadServerEnv(repoRoot) {
  const envPath = path.join(repoRoot, 'server', '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    // eslint-disable-next-line global-require
    requireFromServer('dotenv').config({ path: envPath });
  } catch {
    const text = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"'))
        || (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

function parseRecipients() {
  if (process.env.OM_TASK_COMPLETION_NOTIFY_DISABLE === 'true') return [];
  const raw =
    process.env.OM_TASK_COMPLETION_NOTIFY_EMAIL
    || process.env.OM_COMMUNICATION_PICKUP_EMAIL
    || 'info@orthodoxmetrics.com';
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLocalPostfixRelay(host) {
  const h = String(host || '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function loadMailboxSmtpFromOmStudio() {
  const { resolveMailboxSmtpCredentials } = require(path.join(
    REPO_ROOT,
    'server/src/utils/platformSecretCreds',
  ));
  const creds = resolveMailboxSmtpCredentials('info');
  if (!creds.ok) return creds;
  if (isLocalPostfixRelay(creds.host)) {
    return { ok: false, error: 'invalid_smtp_host', hint: creds.hint };
  }
  return {
    ok: true,
    transportOpts: {
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      auth: { user: creds.user, pass: creds.pass },
    },
    fromEmail: creds.user,
    credentialSource: creds.source,
  };
}

async function resolveMailConfig() {
  loadServerEnv(REPO_ROOT);

  const fromName = 'Orthodox Metrics Agent Reports';
  const vaultSmtp = loadMailboxSmtpFromOmStudio();
  if (vaultSmtp.ok) {
    return {
      fromName,
      fromEmail: vaultSmtp.fromEmail,
      transportOpts: vaultSmtp.transportOpts,
      credentialSource: vaultSmtp.credentialSource,
    };
  }

  const err = new Error(
    vaultSmtp.hint
    || vaultSmtp.error
    || 'Mailbox SMTP credentials unavailable',
  );
  err.code = 'MAILBOX_CREDS_MISSING';
  throw err;
}

function sendViaSendmail({ to, from, subject, text, html }) {
  const { spawnSync } = require('child_process');
  const hasSendmail = spawnSync('bash', ['-c', 'command -v sendmail'], { encoding: 'utf8' }).stdout?.trim();
  if (!hasSendmail) {
    return { sent: false, reason: 'sendmail not available' };
  }
  const body = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html || text,
  ].join('\n');
  const r = spawnSync('sendmail', ['-t', '-oi'], { input: body, encoding: 'utf8' });
  if (r.status === 0) return { sent: true, via: 'sendmail' };
  return { sent: false, reason: r.stderr || 'sendmail failed' };
}

function buildInboxUrl(documentId) {
  const base = (process.env.OM_PUBLIC_BASE_URL || 'https://orthodoxmetrics.com').replace(/\/$/, '');
  return `${base}/devel-tools/docs?document=${encodeURIComponent(documentId)}`;
}

const ATTACH_MAX_TOTAL_BYTES = parseInt(
  process.env.OM_TASK_COMPLETION_ATTACH_MAX_BYTES || String(15 * 1024 * 1024),
  10,
);
const ATTACH_MAX_FILE_BYTES = parseInt(
  process.env.OM_TASK_COMPLETION_ATTACH_MAX_FILE_BYTES || String(8 * 1024 * 1024),
  10,
);
const ATTACH_MAX_FILES = parseInt(process.env.OM_TASK_COMPLETION_ATTACH_MAX_FILES || '25', 10);
const INLINE_DOC_MAX_CHARS = parseInt(
  process.env.OM_TASK_COMPLETION_INLINE_DOC_MAX_CHARS || '120000',
  10,
);

/** @returns {{ filename: string, content: Buffer }[]} */
function collectPackageAttachments(packageDir) {
  const out = [];
  if (!packageDir || !fs.existsSync(packageDir)) return out;
  let totalBytes = 0;

  function tryAdd(absPath, filename) {
    if (out.length >= ATTACH_MAX_FILES) return;
    if (!fs.existsSync(absPath)) return;
    let st;
    try {
      st = fs.statSync(absPath);
    } catch {
      return;
    }
    if (!st.isFile() || st.size === 0) return;
    if (st.size > ATTACH_MAX_FILE_BYTES) return;
    if (totalBytes + st.size > ATTACH_MAX_TOTAL_BYTES) return;
    out.push({ filename, content: fs.readFileSync(absPath) });
    totalBytes += st.size;
  }

  tryAdd(path.join(packageDir, 'document.md'), 'document.md');
  tryAdd(path.join(packageDir, 'manifest.json'), 'manifest.json');

  const attachmentsDir = path.join(packageDir, 'attachments');
  if (fs.existsSync(attachmentsDir)) {
    let st;
    try {
      st = fs.statSync(attachmentsDir);
    } catch {
      st = null;
    }
    if (st?.isDirectory()) {
      for (const name of fs.readdirSync(attachmentsDir).sort()) {
        const child = path.join(attachmentsDir, name);
        try {
          if (!fs.statSync(child).isFile()) continue;
        } catch {
          continue;
        }
        tryAdd(child, path.join('attachments', name));
      }
    }
  }

  return out;
}

function readDocumentMarkdown(packageDir) {
  const docPath = path.join(packageDir || '', 'document.md');
  if (!packageDir || !fs.existsSync(docPath)) return '';
  try {
    return fs.readFileSync(docPath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * @param {object} payload
 * @param {string} payload.documentId
 * @param {string} payload.title
 * @param {string} payload.packageDir
 * @param {string} [payload.executiveSummary]
 * @param {number} payload.documentLength
 * @param {string} [payload.producer]
 * @param {boolean} [payload.backlog] historical backfill (subject prefix)
 * @param {string} [payload.inboxUrl] override link when not in OM Documents
 */
async function notifyTaskCompletionPickup(payload) {
  const recipients = parseRecipients();
  if (!recipients.length) {
    return { sent: false, reason: 'notifications disabled or no recipients' };
  }

  const { fromName, fromEmail, transportOpts } = await resolveMailConfig();
  const from = `"${fromName}" <${fromEmail}>`;
  const inboxUrl = payload.inboxUrl || (payload.documentId
    ? buildInboxUrl(payload.documentId)
    : `${(process.env.OM_PUBLIC_BASE_URL || 'https://orthodoxmetrics.com').replace(/\/$/, '')}/devel-tools/docs`);
  const summary = (payload.executiveSummary || '').trim();
  const backlogNote = payload.backlog
    ? '\n\n(Historical backfill — this report was filed before automatic email notifications were enabled.)\n'
    : '';
  const summaryBlock = summary
    ? `\n\nExecutive summary\n${summary}\n`
    : '';

  const fullDocument = readDocumentMarkdown(payload.packageDir);
  let inlineDoc = fullDocument;
  let inlineTruncated = false;
  if (inlineDoc.length > INLINE_DOC_MAX_CHARS) {
    inlineDoc = `${inlineDoc.slice(0, INLINE_DOC_MAX_CHARS)}\n\n… [truncated in email body; see document.md attachment]`;
    inlineTruncated = true;
  }
  const documentBlock = inlineDoc
    ? `\n\n--- Handoff (document.md) ---\n${inlineDoc}\n`
    : '';

  const mailAttachments = collectPackageAttachments(payload.packageDir);

  const text = [
    payload.backlog ? 'Agent task completion report (historical backfill).' : 'Agent task completion report dropped.',
    '',
    `Title: ${payload.title}`,
    `Document ID: ${payload.documentId}`,
    `Producer: ${payload.producer || 'omdev'}`,
    `Package: ${payload.packageDir}`,
    `Length: ${payload.documentLength} characters`,
    summaryBlock,
    documentBlock,
    backlogNote.trim(),
    mailAttachments.length
      ? `\nAttachments: ${mailAttachments.map((a) => a.filename).join(', ')}\n`
      : '',
    `Open: ${inboxUrl}`,
    '',
    'You can also reconcile in Developer Tools → OM Documents (00-inbox).',
  ].join('\n');

  const html = `
<p><strong>Agent task completion report</strong></p>
<ul>
  <li><strong>Title:</strong> ${escapeHtml(payload.title)}</li>
  <li><strong>Document ID:</strong> ${escapeHtml(payload.documentId)}</li>
  <li><strong>Producer:</strong> ${escapeHtml(payload.producer || 'omdev')}</li>
  <li><strong>Package:</strong> <code>${escapeHtml(payload.packageDir)}</code></li>
  <li><strong>Length:</strong> ${payload.documentLength} characters</li>
</ul>
${summary ? `<p><strong>Executive summary</strong></p><p>${escapeHtml(summary)}</p>` : ''}
${inlineDoc ? `<p><strong>Handoff</strong>${inlineTruncated ? ' <span style="color:#666">(truncated — full text in attachment)</span>' : ''}</p><pre style="white-space:pre-wrap;font-size:12px;background:#f6f6f6;padding:12px;border-radius:6px;max-height:480px;overflow:auto">${escapeHtml(inlineDoc)}</pre>` : ''}
${mailAttachments.length ? `<p style="color:#666;font-size:12px">Attached: ${escapeHtml(mailAttachments.map((a) => a.filename).join(', '))}</p>` : ''}
<p><a href="${escapeHtml(inboxUrl)}">Open in OM Documents</a></p>
<p style="color:#666;font-size:12px">Developer Tools → OM Documents · inbox on fileserver daily-work</p>`;

  const idLabel = payload.documentId || 'legacy-pickup';
  const subjectPrefix = payload.backlog ? '[OM Agent backlog]' : '[OM Agent]';
  const subject = `${subjectPrefix} Task complete: ${payload.title} (${idLabel})`;
  const to = recipients.join(', ');

  if (!transportOpts.host || isLocalPostfixRelay(transportOpts.host)) {
    throw new Error(
      'Task-completion email requires authenticated direct SMTP (e.g. SMTP_HOST in server/.env). '
      + 'Local Postfix relay is not used — messages were previously queued but not delivered to info@.',
    );
  }
  if (!transportOpts.auth || !transportOpts.auth.user || !transportOpts.auth.pass) {
    throw new Error(
      'SMTP credentials missing for task-completion notifications. '
      + 'Set INFO_PASSWORD in OMStudio Platform Secrets and render to '
      + '/var/lib/omstudio/secrets/INFO_PASSWORD.creds on this host.',
    );
  }

  const transport = nodemailer.createTransport(transportOpts);
  await transport.verify();
  const info = await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
    attachments: mailAttachments,
  });
  return {
    sent: true,
    recipients,
    messageId: info.messageId,
    via: 'smtp',
    response: info.response,
    attachmentCount: mailAttachments.length,
    attachmentNames: mailAttachments.map((a) => a.filename),
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { notifyTaskCompletionPickup, parseRecipients, loadServerEnv };
