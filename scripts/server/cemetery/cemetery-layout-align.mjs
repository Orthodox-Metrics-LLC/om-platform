#!/usr/bin/env node
/**
 * Recompute map_x/map_y for church 46 cemetery plots from section layout transforms.
 * Updates import-manifest.json and optionally the tenant DB (coordinates only).
 *
 * Usage:
 *   node server/scripts/cemetery-layout-align.mjs --church-id 46
 *   node server/scripts/cemetery-layout-align.mjs --church-id 46 --apply --force
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import mysql from 'mysql2/promise';

const require = createRequire(import.meta.url);
const SERVER_ROOT = resolve(__dirname, '../../../server');
const REPO_ROOT = resolve(__dirname, '../../..');
const { computeLayoutCoords } = require(SERVER_ROOT + '/src/services/cemetery/rowLayout.js');

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { churchId: 46, manifest: null, apply: false, force: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--church-id') opts.churchId = Number(args[++i]);
    else if (args[i] === '--manifest') opts.manifest = args[++i];
    else if (args[i] === '--apply') opts.apply = true;
    else if (args[i] === '--force') opts.force = true;
  }
  return opts;
}

function manifestPath(churchId, override) {
  return override || join(SERVER_ROOT, 'assets/cemetery-map', `church-${churchId}`, 'import-manifest.json');
}

function alignManifest(doc) {
  let updated = 0;
  const plots = (doc.plots || []).map((p) => {
    const coords = computeLayoutCoords(p);
    const changed =
      p.map_x !== coords.map_x ||
      p.map_y !== coords.map_y ||
      p.map_page !== coords.map_page;
    if (changed) updated++;
    return { ...p, ...coords };
  });
  return [{ ...doc, plots, alignedAt: new Date().toISOString(), alignmentSource: 'sectionLayout' }, updated];
}

async function applyToDb(churchId, plots) {
  const dbName = `om_church_${churchId}`;
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'orthodoxapps',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
  });
  try {
    await conn.beginTransaction();
    let count = 0;
    for (const p of plots) {
      if (!p.plot_key) continue;
      const [res] = await conn.query(
        `UPDATE cemetery_plots SET map_x=?, map_y=?, map_w=?, map_h=?, map_page=? WHERE plot_key=?`,
        [p.map_x, p.map_y, p.map_w ?? 3, p.map_h ?? 2.6, p.map_page || 'pg1', p.plot_key],
      );
      count += res.affectedRows || 0;
    }
    await conn.commit();
    return count;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    await conn.end();
  }
}

async function main() {
  const opts = parseArgs();
  const path = manifestPath(opts.churchId, opts.manifest);
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const [aligned, manifestUpdates] = alignManifest(doc);
  writeFileSync(path, `${JSON.stringify(aligned, null, 2)}\n`);
  console.log(`Aligned manifest: ${path}`);
  console.log(`  plots repositioned in manifest: ${manifestUpdates} / ${aligned.plots.length}`);

  if (opts.apply) {
    if (!opts.force) {
      console.error('BLOCKED: --apply requires --force');
      process.exit(2);
    }
    const dbUpdates = await applyToDb(opts.churchId, aligned.plots);
    console.log(`  DB rows updated: ${dbUpdates}`);
  }
}

main().catch((e) => {
  console.error('LAYOUT ALIGN ERROR', e.message);
  process.exit(1);
});
