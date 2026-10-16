#!/usr/bin/env node
/**
 * Drop an agent task completion report into OM Docs Pickup incoming queue.
 *
 * Produces substantive handoff documents — not one-line placeholders.
 *
 * Usage:
 *   node server/scripts/drop-task-completion-pickup.js \
 *     --title "Work streams consolidation plan" \
 *     --prompt-file /tmp/prompt.txt \
 *     --executive-summary "Canonical model for work items, accountability, OM Daily." \
 *     --what-was-done-file /tmp/completion.txt \
 *     --include docs/internal/work-streams-consolidation-plan.md \
 *     --commits "cac442189" \
 *     --deploy-status "Docs only — no deploy"
 *
 *   node server/scripts/drop-task-completion-pickup.js \
 *     --title "My task" \
 *     --prompt-stdin \
 *     --result-file /path/to/result.md \
 *     --verification "Smoke tests pass; Waiting tab shows new pickup"
 *
 * Optional env:
 *   DOCS_PICKUP_ROOT — override storage root (default: .../storage/docs-pickup)
 *   CURSOR_SESSION_ID / AGENT_SESSION_ID — auto-filled session identifier
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.join('/var/www/om-platform', 'storage', 'docs-pickup');

function usage(exitCode = 0) {
  const msg = `Usage: node drop-task-completion-pickup.js --title TITLE [content options] [metadata options]

Required:
  --title TEXT              Task title

Prompt (one required):
  --prompt TEXT             Original user prompt (verbatim; multi-paragraph OK)
  --prompt-file PATH        Read prompt from file
  --prompt-stdin            Read prompt from stdin (until EOF)

Result / body (at least one required unless --brief with --result):
  --result TEXT             Result / completion narrative
  --result-file PATH        Read result from file
  --body-file PATH          Alias for --result-file
  --result-stdin            Read result from stdin (until EOF)
  --what-was-done TEXT      Detailed work narrative (preferred over short --result)
  --what-was-done-file PATH Read what-was-done from file
  --include PATH            Embed full file content under ## Deliverable (repeatable)
  --artifact PATH           Alias for --include

Sections:
  --executive-summary TEXT  Short operator-facing summary (defaults to first paragraph of result)
  --verification TEXT       How completion was verified
  --commits TEXT            Comma-separated commit hashes
  --files-changed TEXT      Comma-separated changed file paths
  --deploy-status TEXT      Deploy outcome
  --follow-up TEXT          Follow-up items

Meta:
  --work-item-id ID         Linked om_daily_items id (OMD-####)
  --work-packet-id ID       Linked OMPKT work packet id
  --parent-pickup-id ID     Parent pickup id/pickup_id for grouping (child of a parent)
  --group-id ID             Group id (OMGRP-YYYYMMDD-XXXXX) for cluster membership
  --session-id TEXT         Agent/session identifier (no secrets)
  --slug TEXT               Override task slug for incoming dir name
  --agent TEXT              Agent name (default: cursor)
  --description TEXT        metadata.json description override
  --brief                   Allow compact one-line summaries (legacy mode)
  --dry-run                 Print paths and document without writing
  -h, --help                Show this help

Minimum handoff quality (default, without --brief):
  - Full verbatim prompt (never truncated)
  - Substantive What was done section OR embedded deliverable via --include
  - Pickup document should be readable without opening another file
`;
  process.stdout.write(msg);
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
    sessionId: process.env.CURSOR_SESSION_ID || process.env.AGENT_SESSION_ID || null,
    slug: null,
    agent: 'cursor',
    description: null,
    workItemId: null,
    workPacketId: null,
    parentPickupId: null,
    groupId: null,
    brief: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') usage(0);
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--brief') opts.brief = true;
    else if (arg === '--prompt-stdin') opts.promptStdin = true;
    else if (arg === '--result-stdin') opts.resultStdin = true;
    else if (arg === '--title' && argv[i + 1]) opts.title = argv[++i];
    else if (arg === '--prompt' && argv[i + 1]) opts.prompt = argv[++i];
    else if (arg === '--prompt-file' && argv[i + 1]) opts.promptFile = argv[++i];
    else if (arg === '--result' && argv[i + 1]) opts.result = argv[++i];
    else if (arg === '--result-file' && argv[i + 1]) opts.resultFile = argv[++i];
    else if (arg === '--body-file' && argv[i + 1]) opts.bodyFile = argv[++i];
    else if (arg === '--what-was-done' && argv[i + 1]) opts.whatWasDone = argv[++i];
    else if (arg === '--what-was-done-file' && argv[i + 1]) opts.whatWasDoneFile = argv[++i];
    else if (arg === '--executive-summary' && argv[i + 1]) opts.executiveSummary = argv[++i];
    else if (arg === '--verification' && argv[i + 1]) opts.verification = argv[++i];
    else if (arg === '--include' && argv[i + 1]) opts.includes.push(argv[++i]);
    else if (arg === '--artifact' && argv[i + 1]) opts.includes.push(argv[++i]);
    else if (arg === '--commits' && argv[i + 1]) opts.commits = argv[++i];
    else if (arg === '--files-changed' && argv[i + 1]) opts.filesChanged = argv[++i];
    else if (arg === '--deploy-status' && argv[i + 1]) opts.deployStatus = argv[++i];
    else if (arg === '--follow-up' && argv[i + 1]) opts.followUp = argv[++i];
    else if (arg === '--session-id' && argv[i + 1]) opts.sessionId = argv[++i];
    else if (arg === '--slug' && argv[i + 1]) opts.slug = argv[++i];
    else if (arg === '--agent' && argv[i + 1]) opts.agent = argv[++i];
    else if (arg === '--description' && argv[i + 1]) opts.description = argv[++i];
    else if (arg === '--work-item-id' && argv[i + 1]) opts.workItemId = argv[++i];
    else if (arg === '--work-packet-id' && argv[i + 1]) opts.workPacketId = argv[++i];
    else if (arg === '--parent-pickup-id' && argv[i + 1]) opts.parentPickupId = argv[++i];
    else if (arg === '--group-id' && argv[i + 1]) opts.groupId = argv[++i];
    else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      usage(1);
    }
  }

  return opts;
}

function readTextFile(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} file not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}

function readStdin(label) {
  if (process.stdin.isTTY) {
    throw new Error(`${label}: --prompt-stdin/--result-stdin requires piped stdin`);
  }
  const data = fs.readFileSync(0, 'utf-8');
  return data.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}

function slugify(title) {
  return String(title || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'task';
}

function isoStampUtc() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

function splitList(value) {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function formatPromptSection(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return ['_(No prompt provided)_', ''];
  if (text.includes('\n')) {
    return ['```text', text, '```', ''];
  }
  return [`> ${text}`, ''];
}

function formatBodySection(text) {
  const body = String(text || '').trim();
  if (!body) return ['_(No content provided)_', ''];
  return [body, ''];
}

function firstParagraph(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const para = trimmed.split(/\n\s*\n/)[0];
  return para.replace(/\s+/g, ' ').trim();
}

function resolveIncludes(includePaths, cwd) {
  const resolved = [];
  for (const p of includePaths) {
    const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
    if (!fs.existsSync(abs)) {
      throw new Error(`Include file not found: ${abs}`);
    }
    const content = fs.readFileSync(abs, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
    resolved.push({
      displayPath: p.replace(/\\/g, '/'),
      absPath: abs,
      content,
    });
  }
  return resolved;
}

function buildDocument(opts, completedAt, deliverables) {
  const lines = [
    `# ${opts.title}`,
    '',
    `**Completion (UTC):** ${completedAt}`,
    '',
  ];

  const execSummary = opts.executiveSummary
    || firstParagraph(opts.whatWasDone)
    || firstParagraph(opts.result)
    || (deliverables.length ? `Deliverable embedded: ${deliverables.map((d) => d.displayPath).join(', ')}` : '');

  lines.push('## Executive summary', '', execSummary || '_(See sections below.)_', '');

  lines.push('## Original user prompt', '', ...formatPromptSection(opts.prompt));

  const whatWasDone = opts.whatWasDone || opts.result;
  if (whatWasDone) {
    lines.push('## What was done', '', ...formatBodySection(whatWasDone));
  }

  if (deliverables.length) {
    lines.push('## Deliverable', '');
    for (const d of deliverables) {
      lines.push(`### ${d.displayPath}`, '', d.content, '');
    }
  }

  const commits = splitList(opts.commits);
  if (commits.length) {
    lines.push('## Commits', '');
    for (const c of commits) lines.push(`- \`${c}\``);
    lines.push('');
  }

  const files = splitList(opts.filesChanged);
  if (files.length) {
    lines.push('## Files changed', '');
    for (const f of files) lines.push(`- \`${f}\``);
    lines.push('');
  }

  if (opts.deployStatus) {
    lines.push('## Deploy status', '', opts.deployStatus, '');
  }

  if (opts.verification) {
    lines.push('## Verification', '', opts.verification, '');
  }

  if (opts.followUp) {
    lines.push('## Follow-up items', '', opts.followUp, '');
  }

  if (opts.sessionId) {
    lines.push('## Agent / session', '', `- Session: \`${opts.sessionId}\``, `- Agent: ${opts.agent}`, '');
  }

  if (opts.workItemId || opts.workPacketId) {
    lines.push('## Work accountability links', '');
    if (opts.workItemId) lines.push(`- Work item: OMD-${opts.workItemId} (id ${opts.workItemId})`);
    if (opts.workPacketId) lines.push(`- Work packet: ${opts.workPacketId}`);
    lines.push('');
  }

  lines.push('---', '', '_Generated by drop-task-completion-pickup.js_');
  return lines.join('\n');
}

function getStorageRoot() {
  return process.env.DOCS_PICKUP_ROOT || DEFAULT_ROOT;
}

function validateSubstance(opts, deliverables) {
  if (opts.brief) return;

  const whatWasDone = (opts.whatWasDone || opts.result || '').trim();
  const hasDeliverable = deliverables.length > 0;
  const promptLen = (opts.prompt || '').trim().length;

  if (promptLen < 20) {
    process.stderr.write('Warning: prompt is very short — pass full verbatim user prompt via --prompt-file\n');
  }

  const minWhatWasDone = 80;
  if (!hasDeliverable && whatWasDone.length < minWhatWasDone) {
    throw new Error(
      'Substantive handoff required: provide --what-was-done / --result-file (≥80 chars), '
      + 'or embed deliverable via --include. Use --brief to override.'
    );
  }

  if (hasDeliverable) {
    const totalEmbed = deliverables.reduce((n, d) => n + d.content.length, 0);
    if (totalEmbed < 200 && whatWasDone.length < minWhatWasDone) {
      throw new Error(
        'Embedded deliverable is too thin — include full artifact content or expand --what-was-done'
      );
    }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (!opts.title) {
    process.stderr.write('Error: --title is required\n');
    usage(1);
  }

  if (opts.promptFile) opts.prompt = readTextFile(opts.promptFile, 'Prompt');
  if (opts.promptStdin) opts.prompt = readStdin('Prompt');

  const resultPath = opts.resultFile || opts.bodyFile;
  if (resultPath) opts.result = readTextFile(resultPath, 'Result');
  if (opts.resultStdin) opts.result = readStdin('Result');
  if (opts.whatWasDoneFile) opts.whatWasDone = readTextFile(opts.whatWasDoneFile, 'What was done');

  if (!opts.prompt) {
    process.stderr.write('Error: --prompt, --prompt-file, or --prompt-stdin is required\n');
    usage(1);
  }

  const hasBody = Boolean(
    (opts.result && opts.result.trim())
    || (opts.whatWasDone && opts.whatWasDone.trim())
    || opts.includes.length
  );

  if (!hasBody) {
    process.stderr.write('Error: provide --result, --result-file, --body-file, --what-was-done, --include, or --result-stdin\n');
    usage(1);
  }

  const deliverables = resolveIncludes(opts.includes, cwd);
  validateSubstance(opts, deliverables);

  const completedAt = new Date().toISOString();
  const slug = opts.slug || slugify(opts.title);
  const stamp = isoStampUtc();
  const dirName = `${stamp}-${slug}`;
  const incomingRoot = path.join(getStorageRoot(), 'incoming');
  const dropDir = path.join(incomingRoot, dirName);
  const documentPath = path.join(dropDir, 'document.md');
  const metadataPath = path.join(dropDir, 'metadata.json');

  const originalFileName = `${slug}.md`;
  const description = opts.description || `Task completion: ${opts.title}`;

  const metadata = {
    description,
    originalFileName,
    saved_by_name: `${opts.agent}-agent`,
    saved_by_email: 'omsvc@orthodoxmetrics.com',
    agent: opts.agent,
    reportType: 'task_completion',
    taskTitle: opts.title,
    completedAt,
    sessionId: opts.sessionId || null,
    commits: splitList(opts.commits),
    deployStatus: opts.deployStatus || null,
    deliverables: deliverables.map((d) => d.displayPath),
    substantive: !opts.brief,
    workItemId: opts.workItemId || null,
    workPacketId: opts.workPacketId || null,
    // Optional Phase 1 grouping hints consumed by docsPickupService.syncIncomingDirs
    // (omitted from metadata.json entirely when unset).
    ...(opts.parentPickupId ? { parentPickupId: opts.parentPickupId } : {}),
    ...(opts.groupId ? { groupId: opts.groupId } : {}),
  };

  const document = buildDocument(opts, completedAt, deliverables);

  if (opts.dryRun) {
    process.stdout.write(JSON.stringify({
      dropDir,
      documentPath,
      metadataPath,
      metadata,
      documentLength: document.length,
      documentPreview: document.slice(0, 800) + (document.length > 800 ? '\n...' : ''),
    }, null, 2) + '\n');
    return;
  }

  fs.mkdirSync(incomingRoot, { recursive: true });
  fs.mkdirSync(dropDir, { recursive: true });
  fs.writeFileSync(documentPath, document, 'utf-8');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf-8');

  process.stdout.write(`Dropped task completion pickup:\n  ${dropDir}\n`);
  process.stdout.write(`Document length: ${document.length} characters\n`);
  process.stdout.write('Refresh OM Docs Pickup Waiting tab to register.\n');
}

try {
  main();
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}
