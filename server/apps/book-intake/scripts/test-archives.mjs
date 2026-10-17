import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import ts from 'typescript';
import JSZip from 'jszip';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await fs.mkdtemp(path.join(root, '.archive-tests-'));
const MIB = 1024 * 1024;
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS', name); }
try {
    for (const name of ['backend','dates','limits', 'storedZip', 'archive', 'contentHash', 'text', 'db']) {
        const source = await fs.readFile(path.join(root, 'src/lib', name + '.ts'), 'utf8');
        const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
        await fs.writeFile(path.join(tmp, name + '.mjs'), result.outputText.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, '$1$2.mjs$3'));
    }
    const zip = await import(pathToFileURL(path.join(tmp, 'storedZip.mjs')));
    const archive = await import(pathToFileURL(path.join(tmp, 'archive.mjs')));
    const hash = await import(pathToFileURL(path.join(tmp, 'contentHash.mjs')));
    await test('CRC32 standard known vector', async () => assert.equal(await zip.crc32Blob(new Blob(['123456789'])), 0xcbf43926));
    await test('CRC32 empty entry', async () => assert.equal(await zip.crc32Blob(new Blob([])), 0));
    for (const n of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1024, MIB - 1, MIB, MIB + 1]) {
        await test(`portable SHA-256 matches Node, ${n} bytes`, async () => {
            const data = randomBytes(n);
            assert.equal(await hash.portableSha256(new Blob([data])), createHash('sha256').update(data).digest('hex'));
        });
    }
    const inputs = [{ name: 'manifest.json', blob: new Blob(['{"ok":true}']) }, { name: 'sources/test', blob: new Blob(['hello']) }];
    const sampleZip = await zip.makeStoredZip(inputs);
    await test('new ZIP is readable with JSZip and CRC32 checking', async () => {
        const read = await JSZip.loadAsync(await sampleZip.arrayBuffer(), { checkCRC32: true });
        assert.equal(await read.file('sources/test').async('string'), 'hello');
    });
    await test('new ZIP round-trips through bounded-read adapter', async () => {
        const index = await zip.indexZip(sampleZip);
        assert.equal(await (await zip.readStoredEntry(sampleZip, index.get('sources/test'))).text(), 'hello');
    });
    await test('duplicate output paths rejected', async () => assert.rejects(zip.makeStoredZip([inputs[0], inputs[0]]), /duplicate/i));
    await test('unsafe output paths rejected', async () => assert.rejects(zip.makeStoredZip([{ name: '../escape', blob: new Blob([]) }]), /Unsafe/));
    await test('truncated ZIP rejected', async () => assert.rejects(zip.indexZip(sampleZip.slice(0, -5)), /ZIP/));
    await test('corrupted source bytes rejected by CRC32', async () => {
        const data = new Uint8Array(await sampleZip.arrayBuffer());
        const idx = await zip.indexZip(sampleZip), entry = idx.get('sources/test');
        data[entry.offset + 30 + entry.name.length] ^= 1;
        const corrupted = new Blob([data]);
        await assert.rejects(zip.readStoredEntry(corrupted, (await zip.indexZip(corrupted)).get('sources/test')), /Checksum/);
    });
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'tests/fixtures/sample-book.json'), 'utf8'));
    const state = { book: manifest.book, pages: manifest.pages, prefs: manifest.prefs, bookmarks: [{id:'test-bookmark',pageId:manifest.pages[0].id,createdAt:'2026-09-28'}], annotations: [{id:'test-note',pageId:manifest.pages[0].id,kind:'note',color:'gold',note:'Private test note',createdAt:'2026-09-28'}] };
    const sources = await Promise.all(manifest.sources.map(async s => ({ ...s, blob: new Blob([await fs.readFile(path.join(root, 'public/book/sources', s.id))], { type: s.mime }) })));
    await test('backup retains notebook and restores original source bytes', async () => {
        const data = await archive.readBookArchive(await archive.createBookArchive(state, sources));
        assert.equal(data.manifest.annotations[0].note, 'Private test note'); assert.equal(data.manifest.bookmarks.length, 1);
        assert.deepEqual(new Uint8Array(await data.sources[0].blob.arrayBuffer()), new Uint8Array(await sources[0].blob.arrayBuffer()));
    });
    await test('publication excludes private annotations/bookmarks/read progress', async () => {
        const data = await archive.readBookArchive(await archive.createBookArchive(state, sources, true));
        assert.equal(data.manifest.annotations.length, 0); assert.equal(data.manifest.bookmarks.length, 0);
        assert.ok(data.manifest.pages.every(p => !p.read));
    });
    await test('original JSZip streaming STORE export remains restorable', async () => {
        const old = new JSZip(); old.file('manifest.json', JSON.stringify({ ...manifest, ...state }));
        for (const s of sources) old.file(`sources/${s.id}`, await s.blob.arrayBuffer(), { compression: 'STORE' });
        const oldBlob = new Blob([await old.generateAsync({ type: 'uint8array', streamFiles: true, compression: 'STORE' })]);
        const data = await archive.readBookArchive(oldBlob); assert.equal(data.sources.length, sources.length);
    });
    await test('small re-compressed legacy ZIP remains restorable', async () => {
        const old = new JSZip(); old.file('manifest.json', JSON.stringify(manifest));
        for (const s of sources) old.file(`sources/${s.id}`, await s.blob.arrayBuffer());
        const data = await archive.readBookArchive(new Blob([await old.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })]));
        assert.equal(data.sources.length, sources.length);
    });
    await test('missing referenced image rejected before library writes', async () => {
        const bad = await zip.makeStoredZip([{ name: 'manifest.json', blob: new Blob([JSON.stringify(manifest)]) }]);
        await assert.rejects(archive.readBookArchive(bad), /missing/i);
    });
    await test('per-image byte guard remains in force', async () => {
        const oversized = [{ ...sources[0], blob: new Blob([new Uint8Array(45 * MIB), 'extra']) }];
        await assert.rejects(archive.createBookArchive(state, oversized), /per-image/);
    });
    await test('1 GiB book guard checked before checksum work', async () => {
        const chunk = new Blob([new Uint8Array(45 * MIB)]);
        await assert.rejects(archive.createBookArchive(state, Array.from({length:24}, (_, i) => ({...sources[0],id:`test-${i}`,blob:chunk}))), /1 GiB/);
    });
    await test('empty book backup/restore allowed', async () => {
        const blank = {...state,pages:[],annotations:[],bookmarks:[]};
        const data = await archive.readBookArchive(await archive.createBookArchive(blank, [])); assert.equal(data.sources.length, 0);
    });
    if (process.argv.includes('--large')) {
        await test('465 MiB synthetic JPEG book export/restore with bounded checksum reads', async () => {
            // Distinct valid JPEGs with inert trailing bytes: full original pixels plus padding.
            const original = sources[0].blob;
            const pad = new Blob([new Uint8Array(31 * MIB - original.size - 1)]);
            const bigSources = Array.from({ length: 15 }, (_, i) => ({ ...sources[0], id: `large-${i}`, name: `large-${i}.jpg`, blob: new Blob([original, pad, new Uint8Array([i])], {type:'image/jpeg'}) }));
            const bigState = { ...state, annotations: [], bookmarks: [], pages: bigSources.map((s,i)=>({...state.pages[0], id:`page-${i}`,sourceId:s.id,sourceName:s.name,order:i})) };
            bigState.prefs = {...state.prefs, pageId: 'page-0'};
            let ticks = 0;
            const data = await archive.createBookArchive(bigState, bigSources, false, () => ticks++);
            assert.ok(data.size > 465 * MIB); assert.ok(ticks > 15);
            const restored = await archive.readBookArchive(data);
            assert.equal(restored.sources.reduce((n,s)=>n+s.blob.size,0),465*MIB);
            for (let i=0;i<15;i++) assert.equal(new Uint8Array(await restored.sources[i].blob.slice(-1).arrayBuffer())[0],i);
            const output = process.env.OM_TEST_LARGE_OUTPUT;
            if (output) { await pipeline(Readable.fromWeb(data.stream()), createWriteStream(output)); console.log('Large test archive written to', output); }
        });
    }
    console.log(`\n${passed} archive/hash tests passed.`);
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
