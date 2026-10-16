const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const {
  inspectArchive,
  inferArchiveDefaults,
  buildSmartFilename,
  mediaTypeForExtension,
  hasVideoContainerSignature,
  probeVideoBuffer,
  createChunkUpload,
  saveChunkUploadPart,
  completeChunkUpload,
} = require('../omAssetsZipImport');

async function makeZip(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-asset-zip-test-'));
  const file = path.join(dir, 'test.zip');
  const image = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#fff' } }).png().toBuffer();
  const zip = new AdmZip();
  for (const item of entries) {
    const [name, data] = Array.isArray(item) ? item : [item, image];
    zip.addFile(name, data);
  }
  zip.writeZip(file);
  return { file, dir };
}

function fakeMp4() {
  const buffer = Buffer.alloc(32);
  buffer.write('ftyp', 4, 'latin1');
  return buffer;
}

test('infers archive category and smart names', async () => {
  assert.equal(inferArchiveDefaults('map-regions.zip').category, 'map');
  assert.equal(buildSmartFilename('map-regions', 'ethiopia 1.png', 0), 'map-regions-ethiopia-1.png');
  assert.equal(buildSmartFilename('orthodox-churches', 'image 34.png', 0), 'orthodox-churches-001.png');
  assert.equal(buildSmartFilename('illustrations', 'ChatGPT Image Sep 14.png', 1), 'illustrations-002.png');
  assert.equal(
    buildSmartFilename('midjourney-session', 'https_mj.runFdNKRwsyIm_https_c_2b1440dc-8cc9-4f06-9f4a-4f95e4f44a95_0.png', 0),
    'midjourney-session-001.png',
  );

  const { file, dir } = await makeZip(['image 1.png', 'ethiopia.png']);
  try {
    const result = inspectArchive(file, 'map-regions.zip', 'smart');
    assert.equal(result.category, 'map');
    const names = Object.fromEntries(result.manifest.map((entry) => [entry.original_name, entry.stored_filename]));
    assert.match(names['image 1.png'], /^map-regions-\d{3}\.png$/);
    assert.equal(names['ethiopia.png'], 'map-regions-ethiopia.png');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('smart names never preserve input paths', () => {
  const name = buildSmartFilename('safe-archive', '../../escape.png', 0, 'smart');
  assert.equal(name, 'safe-archive-escape.png');
  assert.equal(path.basename(name), name);
});

test('accepts mixed image and video manifests', async () => {
  const video = fakeMp4();
  const { file, dir } = await makeZip([
    ['intro.mp4', video],
    ['clip.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])],
    'cover.png',
    'notes.txt',
  ]);
  try {
    const result = inspectArchive(file, 'media-session.zip', 'smart');
    const byName = Object.fromEntries(result.manifest.map((entry) => [entry.original_name, entry]));
    assert.equal(byName['intro.mp4'].media_type, 'video');
    assert.equal(byName['clip.webm'].media_type, 'video');
    assert.equal(byName['cover.png'].media_type, 'image');
    assert.equal(byName['notes.txt'].status, 'skipped');
    assert.equal(mediaTypeForExtension('.mov'), 'video');
    assert.equal(mediaTypeForExtension('.pdf'), null);
    assert.equal(hasVideoContainerSignature(video, '.mp4'), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reassembles a chunked ZIP upload in order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-asset-chunks-'));
  const first = path.join(dir, 'one.part');
  const second = path.join(dir, 'two.part');
  fs.writeFileSync(first, Buffer.from('test'));
  fs.writeFileSync(second, Buffer.from('data'));
  const upload = createChunkUpload({ filename: 'large.zip', totalBytes: 8, totalChunks: 2, userId: 1 });
  let output;
  try {
    saveChunkUploadPart({ uploadId: upload.upload_id, userId: 1, chunkIndex: 0, partPath: first });
    saveChunkUploadPart({ uploadId: upload.upload_id, userId: 1, chunkIndex: 1, partPath: second });
    output = completeChunkUpload({ uploadId: upload.upload_id, userId: 1 });
    assert.equal(output.originalFilename, 'large.zip');
    assert.equal(fs.readFileSync(output.zipPath).toString(), 'testdata');
  } finally {
    if (output?.zipPath) fs.rmSync(output.zipPath, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ffprobe validates a real mp4 video stream', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-asset-video-test-'));
  const file = path.join(dir, 'sample.mp4');
  try {
    execFileSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=16x16:duration=0.2',
      '-pix_fmt', 'yuv420p', '-vcodec', 'libx264', file,
    ]);
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    t.skip('ffmpeg is unavailable');
    return;
  }

  const meta = await probeVideoBuffer(fs.readFileSync(file), '.mp4');
  assert.equal(meta.width, 16);
  assert.equal(meta.height, 16);
  assert.ok(meta.duration > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
