#!/usr/bin/env node
/**
 * Import cemetery manifest into tenant DB — dry-run, staging, apply, rollback.
 *
 * Usage:
 *   node server/scripts/cemetery-import.mjs --church-id 46 --dry-run
 *   node server/scripts/cemetery-import.mjs --church-id 46 --stage
 *   node server/scripts/cemetery-import.mjs --church-id 46 --apply
 *   node server/scripts/cemetery-import.mjs --church-id 46 --rollback
 *
 * Env: DB_HOST, DB_USER, DB_PASSWORD, DB_PORT
 * BLOCKED: --apply without --force on production host without operator approval.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import mysql from 'mysql2/promise';

const require = createRequire(import.meta.url);
const SERVER_ROOT = resolve(__dirname, '../../../server');
const REPO_ROOT = resolve(__dirname, '../../..');
const { CANONICAL_SECTION_NAMES, buildPlotKey } = require(SERVER_ROOT + '/src/services/cemetery/plotKey.js');
const { parseOccupantForImport } = require(SERVER_ROOT + '/src/services/cemetery/displayNames.js');

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    churchId: 46,
    manifest: null,
    db: null,
    dryRun: false,
    stage: false,
    apply: false,
    rollback: false,
    force: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--church-id') opts.churchId = Number(args[++i]);
    else if (args[i] === '--manifest') opts.manifest = args[++i];
    else if (args[i] === '--db') opts.db = args[++i];
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--stage') opts.stage = true;
    else if (args[i] === '--apply') opts.apply = true;
    else if (args[i] === '--rollback') opts.rollback = true;
    else if (args[i] === '--force') opts.force = true;
  }
  if (!opts.dryRun && !opts.stage && !opts.apply && !opts.rollback) opts.dryRun = true;
  return opts;
}

function churchDir(churchId) {
  return join(SERVER_ROOT, 'assets/cemetery-map', `church-${churchId}`);
}

function loadManifest(opts) {
  const path =
    opts.manifest || join(churchDir(opts.churchId), 'import-manifest.json');
  if (!existsSync(path)) throw new Error(`Manifest not found: ${path}`);
  return { path, doc: JSON.parse(readFileSync(path, 'utf8')) };
}

async function connect(dbName) {
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'orthodoxapps',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    multipleStatements: true,
  });
}

async function ensurePlotKeyColumns(conn) {
  const [cols] = await conn.query('SHOW COLUMNS FROM cemetery_plots');
  const names = new Set(cols.map((c) => c.Field));
  const alters = [];
  if (!names.has('plot_key')) alters.push('ADD COLUMN plot_key varchar(64) DEFAULT NULL');
  if (!names.has('stable_location_id')) alters.push('ADD COLUMN stable_location_id varchar(64) DEFAULT NULL');
  if (!names.has('side')) alters.push('ADD COLUMN side varchar(8) DEFAULT NULL');
  if (!names.has('position')) alters.push('ADD COLUMN position varchar(16) DEFAULT NULL');
  if (!names.has('display_numbers')) alters.push('ADD COLUMN display_numbers varchar(128) DEFAULT NULL');
  if (!names.has('region_code')) alters.push('ADD COLUMN region_code varchar(32) DEFAULT NULL');
  if (!names.has('normalized_row')) alters.push('ADD COLUMN normalized_row varchar(16) DEFAULT NULL');
  if (!names.has('family_crest')) alters.push('ADD COLUMN family_crest varchar(128) DEFAULT NULL');
  if (!names.has('plot_kind')) alters.push("ADD COLUMN plot_kind varchar(16) DEFAULT 'grave'");
  if (alters.length) {
    await conn.query(`ALTER TABLE cemetery_plots ${alters.join(', ')}`);
  }
  try {
    await conn.query(
      'CREATE UNIQUE INDEX cemetery_plots_plot_key_unique ON cemetery_plots (plot_key)',
    );
  } catch {
    /* index may exist */
  }
}

function backupPath(churchId) {
  const dir = join(churchDir(churchId), 'backups');
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dir, `pre-import-${ts}.json`);
}

async function exportCurrentState(conn) {
  const [sections] = await conn.query('SELECT * FROM cemetery_sections');
  const [rows] = await conn.query('SELECT * FROM cemetery_rows');
  const [plots] = await conn.query('SELECT * FROM cemetery_plots');
  const [people] = await conn.query('SELECT * FROM cemetery_people');
  const [interments] = await conn.query('SELECT * FROM cemetery_interments');
  return { sections, rows, plots, people, interments, exportedAt: new Date().toISOString() };
}

async function dryRun(manifest, conn) {
  const plots = manifest.doc.plots || [];
  const keys = new Set();
  let dupes = 0;
  let missing = 0;
  for (const p of plots) {
    if (!p.plot_key) missing++;
    else if (keys.has(p.plot_key)) dupes++;
    else keys.add(p.plot_key);
  }
  console.log(`DRY RUN — ${plots.length} plots from ${manifest.path}`);
  console.log(`  missing plot_key: ${missing}`);
  console.log(`  duplicate plot_key: ${dupes}`);
  console.log(`  would upsert sections: ${(manifest.doc.sections || []).length}`);
  return { plots: plots.length, missing, dupes, ok: missing === 0 && dupes === 0 };
}

async function applyManifest(conn, manifest, { backupFile }) {
  const plots = manifest.doc.plots || [];
  await conn.beginTransaction();
  try {
    await ensurePlotKeyColumns(conn);

    // Remove plots not in the current manifest (legacy keys / pre-authoritative imports)
    const manifestKeys = new Set(plots.map((p) => p.plot_key).filter(Boolean));
    const [existingPlots] = await conn.query('SELECT id, plot_key FROM cemetery_plots');
    const staleIds = existingPlots.filter((r) => !manifestKeys.has(r.plot_key)).map((r) => r.id);
    if (staleIds.length) {
      await conn.query('DELETE FROM cemetery_interments WHERE plot_id IN (?)', [staleIds]);
      await conn.query(
        `DELETE FROM cemetery_people WHERE id NOT IN (SELECT person_id FROM cemetery_interments)`,
      );
      await conn.query('DELETE FROM cemetery_plots WHERE id IN (?)', [staleIds]);
    }

    // Remove legacy plots seeded without plot_key (pre-Excel canonical import)
    await conn.query(
      `DELETE i FROM cemetery_interments i
       JOIN cemetery_plots p ON p.id = i.plot_id
       WHERE p.plot_key IS NULL OR p.plot_key = ''`,
    );
    await conn.query(
      `DELETE FROM cemetery_people WHERE id NOT IN (SELECT person_id FROM cemetery_interments)`,
    );
    await conn.query(`DELETE FROM cemetery_plots WHERE plot_key IS NULL OR plot_key = ''`);

    const sectionId = {};
    for (const [code, name] of Object.entries(CANONICAL_SECTION_NAMES)) {
      const [existing] = await conn.query('SELECT id FROM cemetery_sections WHERE code = ?', [code]);
      if (existing.length) {
        sectionId[code] = existing[0].id;
        await conn.query('UPDATE cemetery_sections SET name = ? WHERE id = ?', [name, existing[0].id]);
      } else {
        const [res] = await conn.query(
          'INSERT INTO cemetery_sections (code, name, description, center_x, center_y) VALUES (?,?,?,?,?)',
          [code, name, null, 50, 50],
        );
        sectionId[code] = res.insertId;
      }
    }

    const rowId = {};
    for (const p of plots) {
      const sec = p.section;
      const rowNum = String(p.row);
      const rk = `${sec}:${rowNum}`;
      if (!rowId[rk]) {
        const [existing] = await conn.query(
          'SELECT id FROM cemetery_rows WHERE section_id = ? AND number = ?',
          [sectionId[sec], rowNum],
        );
        if (existing.length) rowId[rk] = existing[0].id;
        else {
          const [res] = await conn.query(
            'INSERT INTO cemetery_rows (section_id, number) VALUES (?,?)',
            [sectionId[sec], rowNum],
          );
          rowId[rk] = res.insertId;
        }
      }
    }

    let inserted = 0;
    let updated = 0;
    for (const p of plots) {
      const rk = `${p.section}:${p.row}`;
      const [existing] = await conn.query('SELECT id FROM cemetery_plots WHERE plot_key = ?', [
        p.plot_key,
      ]);

      const plotFields = [
        sectionId[p.section],
        rowId[rk],
        p.display_numbers || p.plot_number,
        p.status || 'available',
        p.map_x ?? 0,
        p.map_y ?? 0,
        p.map_w ?? 3.4,
        p.map_h ?? 3.0,
        p.map_page || 'pg1',
        p.side || null,
        p.position || null,
        p.display_numbers || p.plot_number,
      ];

      let plotId;
      if (existing.length) {
        plotId = existing[0].id;
        const [upd] = await conn.query(
          `UPDATE cemetery_plots SET section_id=?, row_id=?, plot_number=?, status=?,
           map_x=?, map_y=?, map_w=?, map_h=?, map_page=?, side=?, position=?, display_numbers=?,
           stable_location_id=?, region_code=?, normalized_row=?, family_crest=?, plot_kind=?
           WHERE plot_key=?`,
          [
            ...plotFields,
            p.stable_location_id || p.plot_key,
            p.region_code || null,
            p.normalized_row || null,
            p.family_crest || null,
            p.plot_kind || 'grave',
            p.plot_key,
          ],
        );
        if (upd.affectedRows) updated++;
      } else {
        const [res] = await conn.query(
          `INSERT INTO cemetery_plots
           (section_id, row_id, plot_number, status, map_x, map_y, map_w, map_h, map_page,
            side, position, display_numbers, plot_key, stable_location_id, region_code, normalized_row,
            family_crest, plot_kind)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            ...plotFields,
            p.plot_key,
            p.stable_location_id || p.plot_key,
            p.region_code || null,
            p.normalized_row || null,
            p.family_crest || null,
            p.plot_kind || 'grave',
          ],
        );
        plotId = res.insertId;
        inserted++;
      }

      if (p.occupants?.length) {
        await conn.query('DELETE FROM cemetery_interments WHERE plot_id = ?', [plotId]);
        for (const name of p.occupants) {
          const { firstName, lastName } = parseOccupantForImport(name, p.family_crest);
          const [per] = await conn.query(
            'INSERT INTO cemetery_people (first_name, last_name, birth_date, death_date) VALUES (?,?,?,?)',
            [firstName || lastName, lastName, null, null],
          );
          await conn.query(
            'INSERT INTO cemetery_interments (plot_id, person_id, burial_date, interment_type) VALUES (?,?,?,?)',
            [plotId, per.insertId, null, 'burial'],
          );
        }
      }
    }

    await conn.commit();
    return { inserted, updated, backupFile };
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

async function rollback(conn, churchId) {
  const dir = join(churchDir(churchId), 'backups');
  if (!existsSync(dir)) throw new Error('No backups directory');
  const { readdirSync } = await import('node:fs');
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith('pre-import-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (!backups.length) throw new Error('No backup files found');
  const latest = join(dir, backups[0]);
  const snap = JSON.parse(readFileSync(latest, 'utf8'));
  console.log(`Rolling back from ${latest}`);

  await conn.beginTransaction();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    for (const t of [
      'cemetery_interments',
      'cemetery_people',
      'cemetery_plots',
      'cemetery_rows',
      'cemetery_sections',
    ]) {
      await conn.query(`DELETE FROM \`${t}\``);
      await conn.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS=1');

    for (const s of snap.sections || []) {
      await conn.query(
        'INSERT INTO cemetery_sections (id, code, name, description, center_x, center_y) VALUES (?,?,?,?,?,?)',
        [s.id, s.code, s.name, s.description, s.center_x, s.center_y],
      );
    }
    for (const r of snap.rows || []) {
      await conn.query('INSERT INTO cemetery_rows (id, section_id, number) VALUES (?,?,?)', [
        r.id,
        r.section_id,
        r.number,
      ]);
    }
    for (const p of snap.plots || []) {
      const cols = Object.keys(p).map((k) => `\`${k}\``).join(',');
      const vals = Object.values(p);
      await conn.query(`INSERT INTO cemetery_plots (${cols}) VALUES (${vals.map(() => '?').join(',')})`, vals);
    }
    for (const pe of snap.people || []) {
      await conn.query(
        'INSERT INTO cemetery_people (id, first_name, last_name, birth_date, death_date, notes) VALUES (?,?,?,?,?,?)',
        [pe.id, pe.first_name, pe.last_name, pe.birth_date, pe.death_date, pe.notes],
      );
    }
    for (const i of snap.interments || []) {
      await conn.query(
        'INSERT INTO cemetery_interments (id, plot_id, person_id, burial_date, interment_type) VALUES (?,?,?,?,?)',
        [i.id, i.plot_id, i.person_id, i.burial_date, i.interment_type],
      );
    }
    await conn.commit();
    console.log('Rollback complete');
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

async function main() {
  const opts = parseArgs();
  const dbName = opts.db || `om_church_${opts.churchId}`;
  const manifest = loadManifest(opts);

  if (opts.apply && !opts.force) {
    console.error(
      'BLOCKED: --apply requires operator approval. Pass --force after validation passes.',
    );
    process.exit(2);
  }

  let conn;
  try {
    conn = await connect(dbName);
  } catch (e) {
    console.error(`Cannot connect to ${dbName}: ${e.message}`);
    if (opts.dryRun) {
      const result = await dryRun(manifest, null);
      process.exit(result.ok ? 0 : 1);
    }
    process.exit(1);
  }

  try {
    if (opts.rollback) {
      await rollback(conn, opts.churchId);
      return;
    }

    if (opts.dryRun) {
      const result = await dryRun(manifest, conn);
      process.exit(result.ok ? 0 : 1);
    }

    if (opts.stage) {
      const staged = join(churchDir(opts.churchId), 'import-staging.json');
      copyFileSync(manifest.path, staged);
      console.log(`Staged manifest copy: ${staged}`);
      const result = await dryRun({ path: staged, doc: manifest.doc }, conn);
      process.exit(result.ok ? 0 : 1);
    }

    if (opts.apply) {
      const backup = backupPath(opts.churchId);
      const snap = await exportCurrentState(conn);
      writeFileSync(backup, `${JSON.stringify(snap, null, 2)}\n`);
      console.log(`Backup written: ${backup}`);
      const result = await applyManifest(conn, manifest, { backupFile: backup });
      console.log(`APPLY complete: inserted=${result.inserted} updated=${result.updated}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('IMPORT ERROR', e.message);
  process.exit(1);
});
