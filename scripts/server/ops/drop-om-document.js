#!/usr/bin/env node
/**
 * Drop an OM Document package onto fileserver01/daily-work (00-inbox/{producer}/OMDOC-...).
 *
 * Replaces storage/docs-pickup/incoming as the agent completion destination.
 *
 * Usage mirrors drop-task-completion-pickup.js flags, plus:
 *   --producer manual|omdev|om-workshop|omai-ops01   (default: omdev)
 *   --parent-document-id OMDOC-...
 *   --related-dispatch-id ...
 *
 * Env:
 *   OM_DOCUMENTS_PLANS_ROOT  (default /mnt/fileserver01/daily-work)
 *   OM_TASK_COMPLETION_NOTIFY_EMAIL  (default info@orthodoxmetrics.com)
 *   SMTP auth: INFO_PASSWORD from OMStudio vault → /var/lib/omstudio/secrets/INFO_PASSWORD.creds
 *   OM_TASK_COMPLETION_NOTIFY_DISABLE=true  skip operator email
 */

const fs = require('fs');
const path = require('path');

// Reuse task-completion document builder by loading sibling pickup script helpers
// via a minimal local re-implementation of the CLI parse + document body.

const DEFAULT_PRODUCER = 'omdev';

function usage(exitCode = 0) {
  process.stdout.write(`Usage: node drop-om-document.js --title TITLE [content options]

Same content flags as drop-task-completion-pickup.js, plus:
  --producer NAME              manual|omdev|om-workshop|omai-ops01 (default: omdev)
  --parent-document-id ID      Parent OMDOC-* relationship
  --related-dispatch-id ID     Related dispatch id
  --register-db                Attempt DB registration via documentService (when available)
  --dry-run
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const opts = {
    title: null,
    prompt: null,
    promptFile: null,
    promptStdin: false,
    result: null,
    resultFile: null,
    bodyFile: null,
    resultStdin: false,
    whatWasDone: null,
    whatWasDoneFile: null,
    includes: [],
    executiveSummary: null,
    verification: null,
    commits: null,
    filesChanged: null,
    deployStatus: null,
    followUp: null,
    workItemId: null,
    workPacketId: null,
    sessionId: null,
    slug: null,
    agent: 'cursor',
    description: null,
    brief: false,
    dryRun: false,
    producer: DEFAULT_PRODUCER,
    parentDocumentId: null,
    relatedDispatchId: null,
    registerDb: false,
    noEmail: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '-h': case '--help': usage(0); break;
      case '--title': opts.title = next(); break;
      case '--prompt': opts.prompt = next(); break;
      case '--prompt-file': opts.promptFile = next(); break;
      case '--prompt-stdin': opts.promptStdin = true; break;
      case '--result': opts.result = next(); break;
      case '--result-file': opts.resultFile = next(); break;
      case '--body-file': opts.bodyFile = next(); break;
      case '--result-stdin': opts.resultStdin = true; break;
      case '--what-was-done': opts.whatWasDone = next(); break;
      case '--what-was-done-file': opts.whatWasDoneFile = next(); break;
      case '--include': case '--artifact': opts.includes.push(next()); break;
      case '--executive-summary': opts.executiveSummary = next(); break;
      case '--verification': opts.verification = next(); break;
      case '--commits': opts.commits = next(); break;
      case '--files-changed': opts.filesChanged = next(); break;
      case '--deploy-status': opts.deployStatus = next(); break;
      case '--follow-up': opts.followUp = next(); break;
      case '--work-item-id': opts.workItemId = next(); break;
      case '--work-packet-id': opts.workPacketId = next(); break;
      case '--session-id': opts.sessionId = next(); break;
      case '--slug': opts.slug = next(); break;
      case '--agent': opts.agent = next(); break;
      case '--description': opts.description = next(); break;
      case '--brief': opts.brief = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--producer': opts.producer = next(); break;
      case '--parent-document-id': opts.parentDocumentId = next(); break;
      case '--related-dispatch-id': opts.relatedDispatchId = next(); break;
      case '--register-db': opts.registerDb = true; break;
      case '--no-email': opts.noEmail = true; break;
      // legacy ignored but accepted
      case '--parent-pickup-id': case '--group-id': next(); break;
      default:
        process.stderr.write(`Unknown arg: ${a}\n`);
        usage(1);
    }
  }
  return opts;
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function resolveText(opts) {
  if (opts.promptFile) opts.prompt = fs.readFileSync(opts.promptFile, 'utf8');
  if (opts.promptStdin) opts.prompt = readStdin();
  if (opts.resultFile) opts.result = fs.readFileSync(opts.resultFile, 'utf8');
  if (opts.bodyFile) opts.result = fs.readFileSync(opts.bodyFile, 'utf8');
  if (opts.resultStdin) opts.result = readStdin();
  if (opts.whatWasDoneFile) opts.whatWasDone = fs.readFileSync(opts.whatWasDoneFile, 'utf8');
}

function loadIncludes(paths, cwd) {
  return paths.map((p) => {
    const abs = path.isAbsolute(p) ? p : path.join(cwd, p);
    return {
      displayPath: p,
      content: fs.readFileSync(abs, 'utf8'),
    };
  });
}

function buildDocument(opts, deliverables) {
  const completedAt = new Date().toISOString();
  const parts = [
    `# ${opts.title}`,
    '',
    `**Completion (UTC):** ${completedAt}`,
    '',
  ];
  if (opts.executiveSummary) {
    parts.push('## Executive summary', '', opts.executiveSummary.trim(), '');
  }
  if (opts.prompt) {
    parts.push('## Original user prompt', '', '```', opts.prompt.trimEnd(), '```', '');
  }
  const what = opts.whatWasDone || opts.result;
  if (what) {
    parts.push('## What was done', '', what.trim(), '');
  }
  for (const d of deliverables) {
    parts.push(`## Deliverable — ${d.displayPath}`, '', d.content.trim(), '');
  }
  if (opts.commits) parts.push('## Commits', '', opts.commits, '');
  if (opts.filesChanged) parts.push('## Files changed', '', opts.filesChanged, '');
  if (opts.deployStatus) parts.push('## Deploy status', '', opts.deployStatus, '');
  if (opts.verification) parts.push('## Verification', '', opts.verification, '');
  if (opts.followUp) parts.push('## Follow-up items', '', opts.followUp, '');
  parts.push('## Agent / session', '', `- Agent: ${opts.agent}`, `- Session: ${opts.sessionId || 'n/a'}`, '');
  return parts.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.title) {
    process.stderr.write('Error: --title required\n');
    usage(1);
  }
  resolveText(opts);
  const cwd = process.cwd();
  const deliverables = loadIncludes(opts.includes, cwd);
  const hasBody = Boolean(
    (opts.result && opts.result.trim())
    || (opts.whatWasDone && opts.whatWasDone.trim())
    || deliverables.length,
  );
  if (!hasBody) {
    process.stderr.write('Error: provide result / what-was-done / --include\n');
    usage(1);
  }
  if (!opts.brief) {
    const bodyLen = ((opts.whatWasDone || opts.result || '') + deliverables.map((d) => d.content).join('')).length;
    if (bodyLen < 200 && !deliverables.length) {
      process.stderr.write('Error: handoff too thin; use --include or --brief\n');
      process.exit(1);
    }
  }

  const document = buildDocument(opts, deliverables);
  const storagePath = path.join(__dirname, '../../../server/src/services/om-documents/DocumentStorageService');
  const idPath = path.join(__dirname, '../../../server/src/services/om-documents/documentId');
  // scripts/server/ops -> repo root is ../../..
  const repoRoot = path.resolve(__dirname, '../../..');
  const DocumentStorageService = require(path.join(repoRoot, 'server/src/services/om-documents/DocumentStorageService'));
  const { generateDocumentId } = require(path.join(repoRoot, 'server/src/services/om-documents/documentId'));
  const { PRODUCER_TO_SOURCE, PRODUCERS } = require(path.join(repoRoot, 'server/src/services/om-documents/plansPaths'));

  if (!PRODUCERS.has(opts.producer)) {
    process.stderr.write(`Error: invalid producer ${opts.producer}\n`);
    process.exit(1);
  }

  const documentId = generateDocumentId();
  const source = PRODUCER_TO_SOURCE[opts.producer] || 'OMDEV';

  if (opts.dryRun) {
    process.stdout.write(`${JSON.stringify({
      documentId,
      producer: opts.producer,
      source,
      title: opts.title,
      documentLength: document.length,
      parentDocumentId: opts.parentDocumentId,
      relatedDispatchId: opts.relatedDispatchId,
    }, null, 2)}\n`);
    return;
  }

  const created = DocumentStorageService.createDocument({
    documentId,
    title: opts.title,
    producer: opts.producer,
    source,
    lifecycle: 'inbox',
    primaryFileName: 'document.md',
    contentBuffer: document,
    parentDocumentId: opts.parentDocumentId,
    relatedDispatchId: opts.relatedDispatchId,
    legacy: {
      reportType: 'task_completion',
      workItemId: opts.workItemId,
      workPacketId: opts.workPacketId,
      sessionId: opts.sessionId,
      agent: opts.agent,
    },
  });

  if (opts.registerDb) {
    try {
      // Load db only when requested (requires server env)
      process.chdir(path.join(repoRoot, 'server'));
      require(path.join(repoRoot, 'server/src/config/db'));
      const documentService = require(path.join(repoRoot, 'server/src/services/om-documents/documentService'));
      // Register without re-creating FS: insert row pointing at existing package
      const crypto = require('crypto');
      const { getAppPool } = require(path.join(repoRoot, 'server/src/config/db'));
      const pool = getAppPool();
      await pool.query(
        `INSERT INTO om_documents (
          id, document_id, title, description, source, producer, lifecycle,
          physical_path, relative_path, primary_file, size_bytes, sha256,
          parent_document_id, related_dispatch_id, work_packet_id,
          created_by_name, legacy_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          crypto.randomUUID(),
          documentId,
          opts.title,
          opts.description || `Task completion: ${opts.title}`,
          source,
          opts.producer,
          'inbox',
          created.packageDir,
          created.relativePath,
          created.primaryFile,
          created.sizeBytes,
          created.sha256,
          opts.parentDocumentId,
          opts.relatedDispatchId,
          opts.workPacketId,
          `${opts.agent}-agent`,
          JSON.stringify({
            reportType: 'task_completion',
            workItemId: opts.workItemId,
            sessionId: opts.sessionId,
          }),
        ],
      );
      await documentService.recordAudit(documentId, 'created', { name: `${opts.agent}-agent` }, {
        via: 'drop-om-document',
      });
    } catch (err) {
      process.stderr.write(`Warning: DB registration skipped: ${err.message}\n`);
    }
  }

  process.stdout.write(`Dropped OM Document:\n  ${created.packageDir}\n`);
  process.stdout.write(`document_id: ${documentId}\n`);
  process.stdout.write(`Document length: ${document.length} characters\n`);
  process.stdout.write('Refresh OM Documents Inbox (or Reconcile) to register if DB insert was skipped.\n');

  if (!opts.noEmail) {
    try {
      const { notifyTaskCompletionPickup } = require('./taskCompletionPickupNotify');
      const mail = await notifyTaskCompletionPickup({
        documentId,
        title: opts.title,
        packageDir: created.packageDir,
        executiveSummary: opts.executiveSummary,
        documentLength: document.length,
        producer: opts.producer,
      });
      if (mail.sent) {
        process.stdout.write(`Notification email sent to: ${mail.recipients.join(', ')}\n`);
      } else {
        process.stdout.write(`Notification email skipped: ${mail.reason || 'unknown'}\n`);
      }
    } catch (err) {
      process.stderr.write(`Warning: notification email failed: ${err.message}\n`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
