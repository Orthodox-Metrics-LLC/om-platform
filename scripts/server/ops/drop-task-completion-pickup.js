#!/usr/bin/env node
/**
 * Compatibility wrapper — formerly wrote to storage/docs-pickup/incoming.
 * Now forwards to drop-om-document.js which creates OMDOC packages under
 * /mnt/fileserver01/daily-work/00-inbox/{producer}/.
 *
 * Default producer: omdev (Cursor / agent-cursor worktree).
 * Preserve CLI flags from the legacy pickup helper.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const target = path.join(__dirname, 'drop-om-document.js');
const args = process.argv.slice(2);

// Default producer for Cursor agents when not specified
if (!args.includes('--producer')) {
  args.push('--producer', process.env.OM_DOCUMENTS_PRODUCER || 'omdev');
}

// Prefer DB registration when running in OM server context
if (!args.includes('--register-db') && !args.includes('--dry-run')) {
  args.push('--register-db');
}

const result = spawnSync(process.execPath, [target, ...args], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status == null ? 1 : result.status);
