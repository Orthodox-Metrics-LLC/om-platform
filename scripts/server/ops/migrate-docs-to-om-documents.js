#!/usr/bin/env node
/**
 * Dry-run (default) migration inventory: Dropbox/Pickup → OM Documents packages.
 *
 *   node scripts/server/ops/migrate-docs-to-om-documents.js
 *   node scripts/server/ops/migrate-docs-to-om-documents.js --apply
 *
 * Never deletes legacy storage/docs-dropbox or storage/docs-pickup.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '../../..');
const PROD = process.env.OM_PROD_ROOT || '/var/www/orthodoxmetrics/prod';
const DROPBOX_ROOT = process.env.DOCS_DROPBOX_ROOT || path.join(PROD, 'storage', 'docs-dropbox');
const PICKUP_ROOT = process.env.DOCS_PICKUP_ROOT || path.join(PROD, 'storage', 'docs-pickup');

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name !== '.gitkeep') n += 1;
    }
  };
  walk(dir);
  return n;
}

function listIncoming() {
  const incoming = path.join(PICKUP_ROOT, 'incoming');
  if (!fs.existsSync(incoming)) return { total: 0, active: [], processed: 0 };
  const entries = fs.readdirSync(incoming, { withFileTypes: true }).filter((e) => e.isDirectory());
  const active = entries.filter((e) => !e.name.endsWith('.processed')).map((e) => e.name);
  const processed = entries.filter((e) => e.name.endsWith('.processed')).length;
  return { total: entries.length, active, processed };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { generateDocumentId } = require(path.join(repoRoot, 'server/src/services/om-documents/documentId'));
  const storage = require(path.join(repoRoot, 'server/src/services/om-documents/DocumentStorageService'));

  process.chdir(path.join(repoRoot, 'server'));
  // Prefer server node_modules for mysql2
  const mysql = require(path.join(repoRoot, 'server/node_modules/mysql2/promise'));
  const env = fs.readFileSync(path.join(PROD, 'server/.env'), 'utf8');
  const get = (k) => {
    const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  // Ensure documentService / getAppPool see the same DB if register is used later
  process.env.DB_HOST = process.env.DB_HOST || get('DB_HOST') || '192.168.1.241';
  process.env.DB_USER = process.env.DB_USER || get('DB_USER') || 'orthodoxapps';
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || get('DB_PASSWORD') || get('DB_PASS');
  process.env.DB_NAME = process.env.DB_NAME || get('DB_NAME') || 'orthodoxmetrics_db';
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [[dropboxCount]] = await conn.query('SELECT COUNT(*) AS c FROM docs_dropbox_files');
  const [[pickupCount]] = await conn.query('SELECT COUNT(*) AS c FROM docs_pickup_files');
  const [[dispatchActive]] = await conn.query(
    `SELECT COUNT(*) AS c FROM om_agent_dispatches
     WHERE status IN ('requested','notified','claimed','in_progress','blocked')`,
  );
  const [[filingCount]] = await conn.query(
    'SELECT COUNT(*) AS c FROM docs_pickup_filing_requests',
  ).catch(() => [[{ c: 0 }]]);

  const incoming = listIncoming();
  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    inventory: {
      dropboxDbRows: Number(dropboxCount.c),
      pickupDbRows: Number(pickupCount.c),
      dropboxDiskFiles: countFiles(DROPBOX_ROOT),
      pickupDiskFiles: countFiles(path.join(PICKUP_ROOT, 'files')),
      pickupIncomingDirs: incoming.total,
      pickupIncomingActive: incoming.active,
      pickupIncomingProcessed: incoming.processed,
      activeDispatches: Number(dispatchActive.c),
      filingRequests: Number(filingCount.c),
    },
    proposed: [],
    applied: [],
    errors: [],
  };

  const [dropboxRows] = await conn.query(
    'SELECT id, title, storage_path, agent_path, status, original_file_name FROM docs_dropbox_files WHERE deleted_at IS NULL LIMIT 500',
  );
  for (const row of dropboxRows) {
    const documentId = generateDocumentId();
    const src = path.join(DROPBOX_ROOT, row.storage_path || '');
    const exists = fs.existsSync(src);
    const proposal = {
      legacyType: 'dropbox',
      legacyId: row.id,
      title: row.title || row.original_file_name || row.id,
      status: row.status,
      sourcePath: src,
      sourceExists: exists,
      proposedDocumentId: documentId,
      proposedPath: `00-inbox/manual/${documentId}/`,
      legacy: { dropbox_id: row.id, agent_path: row.agent_path },
    };
    report.proposed.push(proposal);
    if (apply && exists) {
      try {
        const buf = fs.readFileSync(src);
        const created = storage.createDocument({
          documentId,
          title: proposal.title,
          producer: 'manual',
          source: 'HUMAN',
          lifecycle: 'inbox',
          primaryFileName: path.basename(row.original_file_name || row.storage_path || 'document.md'),
          contentBuffer: buf,
          legacy: proposal.legacy,
        });
        await conn.query(
          `INSERT INTO om_documents (
            id, document_id, title, source, producer, lifecycle,
            physical_path, relative_path, primary_file, size_bytes, sha256,
            created_by_name, legacy_json
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE updated_at = NOW()`,
          [
            crypto.randomUUID(),
            documentId,
            proposal.title,
            'HUMAN',
            'manual',
            'inbox',
            created.packageDir,
            created.relativePath,
            created.primaryFile,
            created.sizeBytes,
            created.sha256,
            'migration',
            JSON.stringify(proposal.legacy),
          ],
        );
        report.applied.push(proposal);
      } catch (err) {
        report.errors.push({ legacyId: row.id, error: err.message });
      }
    } else if (apply && !exists) {
      report.errors.push({ legacyId: row.id, error: 'source_missing' });
    }
  }

  const [pickupRows] = await conn.query(
    `SELECT id, pickup_id, title, storage_path, status, original_file_name
     FROM docs_pickup_files WHERE deleted_at IS NULL LIMIT 500`,
  );
  for (const row of pickupRows) {
    const documentId = generateDocumentId();
    const src = path.join(PICKUP_ROOT, row.storage_path || '');
    const exists = fs.existsSync(src);
    const proposal = {
      legacyType: 'pickup',
      legacyId: row.id,
      pickupId: row.pickup_id,
      title: row.title || row.original_file_name || row.id,
      status: row.status,
      sourcePath: src,
      sourceExists: exists,
      proposedDocumentId: documentId,
      proposedPath: `00-inbox/omdev/${documentId}/`,
      legacy: { pickup_id: row.pickup_id || row.id, pickup_uuid: row.id },
    };
    report.proposed.push(proposal);
    if (apply && exists) {
      try {
        const buf = fs.readFileSync(src);
        const created = storage.createDocument({
          documentId,
          title: proposal.title,
          producer: 'omdev',
          source: 'OMDEV',
          lifecycle: 'inbox',
          primaryFileName: path.basename(row.original_file_name || 'document.md'),
          contentBuffer: buf,
          legacy: proposal.legacy,
        });
        await conn.query(
          `INSERT INTO om_documents (
            id, document_id, title, source, producer, lifecycle,
            physical_path, relative_path, primary_file, size_bytes, sha256,
            created_by_name, legacy_json
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE updated_at = NOW()`,
          [
            crypto.randomUUID(),
            documentId,
            proposal.title,
            'OMDEV',
            'omdev',
            'inbox',
            created.packageDir,
            created.relativePath,
            created.primaryFile,
            created.sizeBytes,
            created.sha256,
            'migration',
            JSON.stringify(proposal.legacy),
          ],
        );
        report.applied.push(proposal);
      } catch (err) {
        report.errors.push({ legacyId: row.id, error: err.message });
      }
    } else if (apply && !exists) {
      report.errors.push({ legacyId: row.id, error: 'source_missing' });
    }
  }

  await conn.end();

  const outDir = path.join(
    process.env.OM_DOCUMENTS_PLANS_ROOT || '/mnt/fileserver01/daily-work',
    '10-working',
    '24-hours-out',
    'om-documents-migration',
  );
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `migration-report-${Date.now()}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

  const md = [
    '# OM Documents migration report',
    '',
    `Mode: **${report.mode}**`,
    `Generated: ${report.generatedAt}`,
    '',
    '## Inventory',
    '',
    '```json',
    JSON.stringify(report.inventory, null, 2),
    '```',
    '',
    `Proposed mappings: ${report.proposed.length}`,
    `Applied: ${report.applied.length}`,
    `Errors: ${report.errors.length}`,
    '',
    'Legacy storage was **not** deleted.',
    '',
  ].join('\n');
  const mdFile = path.join(outDir, `migration-report-${Date.now()}.md`);
  fs.writeFileSync(mdFile, md);

  process.stdout.write(`Report written:\n  ${outFile}\n  ${mdFile}\n`);
  process.stdout.write(`Proposed: ${report.proposed.length} Applied: ${report.applied.length} Errors: ${report.errors.length}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
