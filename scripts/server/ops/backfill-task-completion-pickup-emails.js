#!/usr/bin/env node
'use strict';

/**
 * Send notification emails for historical task-completion pickups.
 *
 * Usage:
 *   node scripts/server/ops/backfill-task-completion-pickup-emails.js [--dry-run] [--limit N]
 *     [--delay-ms N] [--resume-log PATH]
 */

const fs = require('fs');
const path = require('path');
const { notifyTaskCompletionPickup } = require('./taskCompletionPickupNotify');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DAILY_INBOX = '/mnt/fileserver01/daily-work/00-inbox';
const LEGACY_INCOMING = path.join(REPO_ROOT, 'storage/docs-pickup/incoming');

function parseTitleAndSummary(md) {
  const titleMatch = md.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1].trim() : 'Task completion report';
  let executiveSummary = '';
  const execMatch = md.match(/## Executive summary\s*\n+([\s\S]*?)(?=\n## |\n*$)/i);
  if (execMatch) {
    executiveSummary = execMatch[1].trim().slice(0, 500);
  }
  return { title, executiveSummary };
}

function collectOmdocPackages() {
  const byId = new Map();
  if (!fs.existsSync(DAILY_INBOX)) return [];

  for (const producer of fs.readdirSync(DAILY_INBOX)) {
    const producerDir = path.join(DAILY_INBOX, producer);
    if (!fs.statSync(producerDir).isDirectory()) continue;
    for (const name of fs.readdirSync(producerDir)) {
      if (!name.startsWith('OMDOC-')) continue;
      const packageDir = path.join(producerDir, name);
      if (!fs.statSync(packageDir).isDirectory()) continue;
      const docPath = path.join(packageDir, 'document.md');
      if (!fs.existsSync(docPath)) continue;
      if (!byId.has(name)) {
        byId.set(name, { documentId: name, packageDir, producer, docPath });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.documentId.localeCompare(b.documentId));
}

function collectLegacyPickups() {
  if (!fs.existsSync(LEGACY_INCOMING)) return [];
  const items = [];
  for (const name of fs.readdirSync(LEGACY_INCOMING)) {
    const dir = path.join(LEGACY_INCOMING, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const docPath = path.join(dir, 'document.md');
    if (!fs.existsSync(docPath)) continue;
    items.push({
      documentId: null,
      packageDir: dir,
      producer: 'legacy-docs-pickup',
      docPath,
      legacySlug: name.replace(/\.processed$/, ''),
    });
  }
  return items.sort((a, b) => a.legacySlug.localeCompare(b.legacySlug));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function itemKey(item) {
  return item.documentId || item.legacySlug;
}

/** @param {string} logPath */
function loadResumeSkipKeys(logPath) {
  const skip = new Set();
  if (!logPath || !fs.existsSync(logPath)) return skip;
  for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
    const m = line.match(/^sent (.+?) via /);
    if (m) skip.add(m[1].trim());
  }
  return skip;
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;
  const delayMs = parseInt(
    argValue('--delay-ms') || process.env.OM_TASK_COMPLETION_BACKFILL_DELAY_MS || '2500',
    10,
  );
  const resumeLog = argValue('--resume-log');
  const skipKeys = loadResumeSkipKeys(resumeLog);

  const omdoc = collectOmdocPackages();
  const legacy = collectLegacyPickups();
  let all = [...omdoc, ...legacy];
  if (skipKeys.size) {
    all = all.filter((item) => !skipKeys.has(itemKey(item)));
  }
  all = all.slice(0, limit);

  process.stdout.write(
    `Found ${omdoc.length} OMDOC + ${legacy.length} legacy; `
    + `queue ${all.length}${skipKeys.size ? ` (skipped ${skipKeys.size} already sent per resume log)` : ''}.\n`,
  );

  let sent = 0;
  let failed = 0;
  let abortedRateLimit = false;
  for (const item of all) {
    const md = fs.readFileSync(item.docPath, 'utf8');
    const { title, executiveSummary } = parseTitleAndSummary(md);
    const payload = {
      documentId: item.documentId,
      title,
      packageDir: item.packageDir,
      executiveSummary: executiveSummary || (item.legacySlug ? `Legacy pickup: ${item.legacySlug}` : ''),
      documentLength: md.length,
      producer: item.producer,
      backlog: true,
    };
    if (!item.documentId) {
      payload.inboxUrl = 'https://orthodoxmetrics.com/devel-tools/docs-pickup';
    }

    if (dryRun) {
      process.stdout.write(`[dry-run] ${item.documentId || item.legacySlug} — ${title}\n`);
      continue;
    }

    try {
      const r = await notifyTaskCompletionPickup(payload);
      if (r.sent) {
        sent += 1;
        process.stdout.write(`sent ${item.documentId || item.legacySlug} via ${r.via || 'smtp'}\n`);
      } else {
        failed += 1;
        process.stderr.write(`skip ${item.documentId || item.legacySlug}: ${r.reason}\n`);
      }
    } catch (err) {
      failed += 1;
      process.stderr.write(`fail ${itemKey(item)}: ${err.message}\n`);
      if (/Hourly sending limit/i.test(err.message)) {
        abortedRateLimit = true;
        process.stderr.write(
          'Stopped: Porkbun hourly sending limit for info@. '
          + 'Wait ~1 hour, then re-run with --resume-log pointing at this run log.\n',
        );
        break;
      }
    }
    await sleep(delayMs);
  }

  process.stdout.write(
    `Done. sent=${sent} failed=${failed} dryRun=${dryRun}`
    + `${abortedRateLimit ? ' aborted_rate_limit=true' : ''}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
});
