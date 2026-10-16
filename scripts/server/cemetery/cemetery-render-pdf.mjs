#!/usr/bin/env node
/**
 * Render cemetery source PDF pages to high-res WebP images and update map.draft.json.
 *
 * Usage:
 *   node server/scripts/cemetery-render-pdf.mjs [--church-id 46] [--dpi 200]
 *
 * Requires: pdftoppm (poppler-utils), sharp
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const NORM_WIDTH = 1000;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { churchId: 46, dpi: 200, pdf: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--church-id') opts.churchId = Number(args[++i]);
    else if (args[i] === '--dpi') opts.dpi = Number(args[++i]);
    else if (args[i] === '--pdf') opts.pdf = args[++i];
  }
  return opts;
}

function pdfPageSizePts(pdfPath, pageNum) {
  const out = execFileSync('pdfinfo', ['-f', String(pageNum), '-l', String(pageNum), pdfPath], {
    encoding: 'utf8',
  });
  const m = out.match(new RegExp(`Page\\s+${pageNum}\\s+size:\\s+([\\d.]+)\\s+x\\s+([\\d.]+)\\s+pts`));
  if (!m) throw new Error(`Could not read page size for page ${pageNum}`);
  return { widthPts: Number(m[1]), heightPts: Number(m[2]) };
}

function pageCount(pdfPath) {
  const out = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  const m = out.match(/Pages:\s+(\d+)/);
  if (!m) throw new Error('Could not read page count from PDF');
  return Number(m[1]);
}

async function main() {
  const opts = parseArgs();
  const { churchId, dpi } = opts;
  const defaultPdf = join(REPO_ROOT, 'server/assets/cemetery-map', `church-${churchId}`, 'source/SSPPOC-Cemetery-2024.pdf');
  const pdfPath = opts.pdf ? resolve(opts.pdf) : defaultPdf;

  if (!existsSync(pdfPath)) {
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  const dataDir = join(SERVER_ROOT, 'assets/cemetery-map', `church-${churchId}`);
  const pagesDir = join(dataDir, 'pages');
  mkdirSync(pagesDir, { recursive: true });

  const totalPages = pageCount(pdfPath);
  console.log(`Rendering ${totalPages} page(s) from ${pdfPath} at ${dpi} DPI`);

  const tmpDir = join(pagesDir, '.tmp-render');
  mkdirSync(tmpDir, { recursive: true });

  execFileSync('pdftoppm', [
    '-png',
    '-r', String(dpi),
    pdfPath,
    join(tmpDir, 'page'),
  ], { stdio: 'inherit' });

  const pages = [];
  for (let n = 1; n <= totalPages; n += 1) {
    const candidates = [
      join(tmpDir, `page-${n}.png`),
      join(tmpDir, `page-${String(n).padStart(2, '0')}.png`),
    ];
    const pngPath = candidates.find((p) => existsSync(p));
    if (!pngPath) {
      throw new Error(`Expected rendered PNG missing for page ${n} (tried ${candidates.join(', ')})`);
    }

    const { widthPts, heightPts } = pdfPageSizePts(pdfPath, n);
    const normalizedHeight = Math.round((NORM_WIDTH * heightPts) / widthPts * 100) / 100;
    const imageFile = `pages/page-${n}.webp`;
    const outPath = join(dataDir, imageFile);

    const meta = await sharp(pngPath).metadata();
    await sharp(pngPath)
      .webp({ quality: 92, effort: 4 })
      .toFile(outPath);

    pages.push({
      pageNumber: n,
      pdfWidthPts: widthPts,
      pdfHeightPts: heightPts,
      normalizedWidth: NORM_WIDTH,
      normalizedHeight,
      imageFile,
      imageWidthPx: meta.width ?? 0,
      imageHeightPx: meta.height ?? 0,
    });
    console.log(`  page ${n}: ${meta.width}x${meta.height}px -> ${imageFile}`);
  }

  const draftPath = join(dataDir, 'map.draft.json');
  let doc;
  if (existsSync(draftPath)) {
    doc = JSON.parse(readFileSync(draftPath, 'utf8'));
    doc.pages = pages;
    doc.sourcePdf = pdfPath.replace(`${REPO_ROOT}/`, '');
    doc.updatedAt = new Date().toISOString();
  } else {
    const now = new Date().toISOString();
    doc = {
      schemaVersion: 1,
      churchId,
      sourcePdf: pdfPath.replace(`${REPO_ROOT}/`, ''),
      generatedAt: now,
      updatedAt: now,
      pages,
      sections: [
        { code: 'L', name: 'Left Section', pageNumber: 1 },
        { code: 'R', name: 'Right Section', pageNumber: 1 },
        { code: 'N', name: 'North Section', pageNumber: 1 },
      ],
      roads: [],
      routeNodes: [],
      routeEdges: [],
      plots: [],
      metadata: { digitizerNotes: 'Initial scaffold — plots to be digitized from PDF' },
    };
  }

  writeFileSync(draftPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`Wrote ${draftPath}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
