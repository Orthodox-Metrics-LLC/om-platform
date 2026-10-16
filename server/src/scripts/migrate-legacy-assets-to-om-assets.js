#!/usr/bin/env node
/**
 * PR3 — Import legacy asset sources into om_assets.
 *
 * Usage:
 *   node server/src/scripts/migrate-legacy-assets-to-om-assets.js [--dry-run]
 *   node server/src/scripts/migrate-legacy-assets-to-om-assets.js --source=global_images
 *   node server/src/scripts/migrate-legacy-assets-to-om-assets.js --source=public_images,church_branding
 *   node server/src/scripts/migrate-legacy-assets-to-om-assets.js --source=frontend_public_assets
 *   node server/src/scripts/migrate-legacy-assets-to-om-assets.js --source=screenshots_share
 *
 * `frontend_public_assets` scans the om-platform frontend's static assets
 * directory and registers each file as an om_assets row with scope='site' —
 * re-run any time new files land there to pick them up (unchanged files are
 * skipped via legacy_source+legacy_id dedup, so this is safe to re-run).
 *
 * `screenshots_share` scans /mnt/storage/screenshots (the mounted
 * \\192.168.1.79\screenshots SMB share) and registers new files as
 * scope='site', folder='screenshots' — not part of the default source list,
 * invoked on its own schedule by the om-screenshots-sync systemd timer.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { runLegacyImport } = require('../assets/omAssetsImport');

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const sourceArg = argv.find((a) => a.startsWith('--source='));
  const sources = sourceArg
    ? sourceArg.replace('--source=', '').split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  return { dryRun, sources };
}

async function main() {
  const { dryRun, sources } = parseArgs(process.argv.slice(2));
  console.log(`\nOM Assets Library — legacy import${dryRun ? ' (DRY RUN)' : ''}\n`);

  const results = await runLegacyImport({ sources, dryRun });

  let imported = 0;
  let exists = 0;
  let skipped = 0;

  for (const r of results) {
    console.log(`── ${r.source} ──`);
    console.log(`   total scanned: ${r.total}`);
    console.log(`   imported:      ${dryRun ? (r.dry_run ?? 0) : (r.imported ?? 0)}${dryRun ? ' (would import)' : ''}`);
    console.log(`   already exist: ${r.exists ?? 0}`);
    console.log(`   skipped:       ${r.skipped ?? 0}`);
    imported += dryRun ? (r.dry_run ?? 0) : (r.imported ?? 0);
    exists += r.exists || 0;
    skipped += r.skipped || 0;
  }

  console.log('\nSummary');
  console.log(`   imported: ${imported}${dryRun ? ' (dry run)' : ''}`);
  console.log(`   exists:   ${exists}`);
  console.log(`   skipped:  ${skipped}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
