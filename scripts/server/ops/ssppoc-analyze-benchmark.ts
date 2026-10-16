#!/usr/bin/env npx tsx
/**
 * Benchmark OCR analyze record-type identification against SSP POC images.
 *
 * Run:
 *   npx tsx server/scripts/ssppoc-analyze-benchmark.ts
 *   npx tsx server/scripts/ssppoc-analyze-benchmark.ts --limit 30
 *   npx tsx server/scripts/ssppoc-analyze-benchmark.ts --root /path/to/images
 */

import fs from 'fs';
import path from 'path';

const SERVER_ROOT = path.resolve(__dirname, '../../../server');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);
const DEFAULT_ROOT = path.resolve(__dirname, '../../../server/storage/ocr-reference/ssppoc-record-images');
const CHURCH_ID = 46;

function parseArgs() {
  const args = process.argv.slice(2);
  let root = DEFAULT_ROOT;
  let limit = 0;
  let mixed = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root' && args[i + 1]) {
      root = path.resolve(args[++i]);
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = Number(args[++i]) || 0;
    } else if (args[i] === '--mixed') {
      mixed = true;
    }
  }
  return { root, limit, mixed };
}

function collectMixedSample(rootDir: string, perType = 6) {
  const typeDirs = [
    { dir: 'Baptism', expected: 'baptism' },
    { dir: 'Marriages', expected: 'marriage' },
    { dir: 'Deaths', expected: 'funeral' },
  ];
  const out: Array<{ absolutePath: string; relativePath: string; expected: string }> = [];
  for (const { dir, expected } of typeDirs) {
    const full = path.join(rootDir, dir);
    if (!fs.existsSync(full)) continue;
    const files = collectImages(full).map((f) => ({
      ...f,
      relativePath: path.posix.join(dir, f.relativePath),
      expected,
    }));
    const step = Math.max(1, Math.floor(files.length / perType));
    for (let i = 0; i < perType && i * step < files.length; i += 1) {
      out.push(files[i * step]);
    }
  }
  return out;
}

function expectedTypeFromRelative(rel: string): 'baptism' | 'marriage' | 'funeral' | 'unknown' {
  const p = rel.replace(/\\/g, '/').toLowerCase();
  if (p.startsWith('baptism')) return 'baptism';
  if (p.startsWith('marriages') || p.startsWith('marriage')) return 'marriage';
  if (p.startsWith('deaths') || p.startsWith('death') || p.startsWith('funeral')) return 'funeral';
  return 'unknown';
}

function collectImages(rootDir: string) {
  const out: Array<{ absolutePath: string; relativePath: string; expected: string }> = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && IMAGE_EXT.has(path.extname(ent.name).toLowerCase())) {
        const relativePath = path.relative(rootDir, full).replace(/\\/g, '/');
        out.push({
          absolutePath: full,
          relativePath,
          expected: expectedTypeFromRelative(relativePath),
        });
      }
    }
  };
  walk(rootDir);
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function main() {
  const { root, limit, mixed } = parseArgs();
  if (!fs.existsSync(root)) {
    console.error(`Root not found: ${root}`);
    process.exit(1);
  }

  const {
    createAnalyzeSession,
    analyzeImageFile,
    deleteAnalyzeSession,
  } = require(SERVER_ROOT + '/src/services/ocrAnalyzeService') as typeof import('../../../server/src/services/ocrAnalyzeService');

  let files = mixed ? collectMixedSample(root) : collectImages(root);
  if (limit > 0) files = files.slice(0, limit);

  console.log(`SSP POC analyze benchmark — ${files.length} images from ${root}`);

  const sessionId = createAnalyzeSession(CHURCH_ID);
  let correct = 0;
  let reviewed = 0;
  const confusion: Record<string, Record<string, number>> = {};
  const failures: Array<{ file: string; expected: string; got: string; conf: number }> = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const fileId = `bench_${String(i).padStart(4, '0')}`;
    process.stdout.write(`\r[${i + 1}/${files.length}] ${file.relativePath.slice(0, 60).padEnd(60)}`);
    try {
      const result = await analyzeImageFile(
        CHURCH_ID,
        sessionId,
        fileId,
        file.absolutePath,
        file.relativePath,
      );
      const got = result.suggestedRecordType === 'custom' ? 'unknown' : result.suggestedRecordType;
      const exp = file.expected;
      confusion[exp] = confusion[exp] || {};
      confusion[exp][got] = (confusion[exp][got] || 0) + 1;
      if (got === exp) correct += 1;
      else {
        failures.push({
          file: file.relativePath,
          expected: exp,
          got,
          conf: result.recordTypeConfidence,
        });
      }
      if (result.needsReview) reviewed += 1;
    } catch (e: any) {
      failures.push({
        file: file.relativePath,
        expected: file.expected,
        got: `error:${e?.message || 'failed'}`,
        conf: 0,
      });
    }
  }

  console.log('\n');
  console.log('── Summary ──');
  console.log(`Accuracy: ${correct}/${files.length} (${((correct / files.length) * 100).toFixed(1)}%)`);
  console.log(`Needs review: ${reviewed}/${files.length} (${((reviewed / files.length) * 100).toFixed(1)}%)`);
  console.log('Confusion matrix (rows=expected, cols=predicted):');
  console.log(JSON.stringify(confusion, null, 2));

  if (failures.length) {
    console.log('\n── Misclassifications (first 25) ──');
    for (const f of failures.slice(0, 25)) {
      console.log(`  ${f.expected} → ${f.got} (${f.conf})  ${f.file}`);
    }
  }

  try {
    deleteAnalyzeSession(CHURCH_ID, sessionId);
  } catch {
    /* ignore cleanup errors */
  }

  process.exit(correct === files.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
