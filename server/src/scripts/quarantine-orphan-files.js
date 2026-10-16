#!/usr/bin/env node
/**
 * Scan Asset Manager storage + every church's File Manager storage for files
 * with no corresponding DB row, and quarantine them (scope='internal',
 * source_type='quarantine', category='flagged'). View/delete only afterward.
 *
 * Usage:
 *   node server/src/scripts/quarantine-orphan-files.js [--dry-run]
 *   node server/src/scripts/quarantine-orphan-files.js --target=asset-manager
 *   node server/src/scripts/quarantine-orphan-files.js --target=file-manager
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const {
  runQuarantineScan,
  scanAssetManagerStorage,
  scanFileManagerStorage,
} = require('../assets/omAssetsQuarantine');

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const targetArg = argv.find((a) => a.startsWith('--target='));
  const target = targetArg ? targetArg.replace('--target=', '').trim() : null;
  return { dryRun, target };
}

function printStats(label, stats) {
  console.log(`\n── ${label} ──`);
  Object.entries(stats).forEach(([k, v]) => console.log(`   ${k}: ${v}`));
}

async function main() {
  const { dryRun, target } = parseArgs(process.argv.slice(2));
  console.log(`\nOM Assets — orphan quarantine scan${dryRun ? ' (DRY RUN)' : ''}\n`);

  if (target === 'asset-manager') {
    printStats('asset_manager_storage', await scanAssetManagerStorage({ dryRun }));
  } else if (target === 'file-manager') {
    printStats('file_manager_storage', await scanFileManagerStorage({ dryRun }));
  } else {
    const { assetManager, fileManager } = await runQuarantineScan({ dryRun });
    printStats('asset_manager_storage', assetManager);
    printStats('file_manager_storage', fileManager);
  }

  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error('Quarantine scan failed:', err.message);
  process.exit(1);
});
