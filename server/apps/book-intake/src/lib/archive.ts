import JSZip from 'jszip';
import type { BookManifest, LibraryState, SourceAsset } from '../types';
import { defaultPrefs, getAll, getSource, replaceLibrary, validateManifest } from './db';
import { serverStorage } from './backend';
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_BOOK_SOURCE_BYTES, MAX_MANIFEST_BYTES, MAX_LEGACY_COMPRESSED_BYTES } from './limits';
import { crc32Blob, indexZip, makeStoredZip, readStoredEntry } from './storedZip';

export function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    // Keep a large download's source available for longer than the old 30-second timeout.
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
}
/** Public helper also used by round-trip tests. Creates a Blob, not a whole-book ArrayBuffer. */
export async function createBookArchive(state: LibraryState, sources: SourceAsset[], publication = false, onProgress?: (p: number) => void): Promise<Blob> {
    const total = sources.reduce((n, s) => n + s.blob.size, 0);
    if (total > MAX_BOOK_SOURCE_BYTES)
        throw new Error('Full-book backups support up to 1 GiB of original images. Your local library has not changed.');
    if (sources.some(s => s.blob.size > MAX_IMAGE_BYTES || s.width * s.height > MAX_IMAGE_PIXELS))
        throw new Error('An original exceeds the 45 MiB / 60 MP per-image limit. Your library has not changed.');
    const cleanSources = sources.map(({ blob: _, ...rest }) => rest);
    const manifest: BookManifest = { ...state, format: 'om-book', version: 1, kind: publication ? 'publication' : 'backup', sources: cleanSources };
    if (publication) {
        manifest.annotations = []; manifest.bookmarks = [];
        manifest.prefs = { ...defaultPrefs, pageId: state.pages[0]?.id || '' };
        manifest.pages = state.pages.map(p => ({ ...p, read: false }));
    }
    validateManifest(manifest);
    const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    if (manifestBlob.size > MAX_MANIFEST_BYTES) throw new Error('Book text and annotations exceed the 40 MiB manifest limit.');
    return makeStoredZip([{ name: 'manifest.json', blob: manifestBlob }, ...sources.map(s => ({ name: `sources/${s.id}`, blob: s.blob }))], onProgress);
}
export async function exportBook(state: LibraryState, publication = false, onProgress?: (p: number) => void) {
    // IndexedDB returns Blob handles. The ZIP adapter never converts the whole book to a JS buffer.
    let sources = await getAll<SourceAsset>('sources');
    if(serverStorage())sources=await Promise.all(sources.map(s=>getSource(s.id)));
    const blob = await createBookArchive(state, sources, publication, onProgress);
    downloadBlob(blob, `${state.book.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'book'}-${publication ? 'publication' : 'backup'}.ombook.zip`);
}
/** Validate every referenced source before any write to the existing library. */
export async function readBookArchive(file: Blob, onProgress?: (p: number) => void): Promise<{ manifest: BookManifest; sources: SourceAsset[] }> {
    const entries = await indexZip(file);
    const manifestEntry = entries.get('manifest.json');
    if (!manifestEntry) throw new Error('The archive has no manifest.json.');
    if (manifestEntry.size > MAX_MANIFEST_BYTES) throw new Error('The manifest exceeds 40 MiB.');
    // Preflight declared sizes BEFORE invoking a decoder, including for older re-compressed ZIPs.
    let declared = 0;
    for (const e of entries.values()) {
        if (e.name === 'manifest.json') continue;
        if (e.name === 'sources/' && e.size === 0) continue;
        if (!/^sources\/[a-zA-Z0-9_-]{1,128}$/.test(e.name) || e.size > MAX_IMAGE_BYTES)
            throw new Error('Unsupported archive entry or image larger than 45 MiB.');
        declared += e.size;
    }
    if (declared > MAX_BOOK_SOURCE_BYTES) throw new Error('The archive exceeds 1 GiB of original images.');
    const compressed = [...entries.values()].some(e => e.method !== 0);
    // All books exported by OM 0.1.0 and 0.1.1 use STORE and take the bounded-read path.
    // Small third-party re-compressed archives retain JSZip compatibility.
    let legacy: JSZip | undefined;
    if (compressed) {
        if (file.size > MAX_LEGACY_COMPRESSED_BYTES || declared > MAX_LEGACY_COMPRESSED_BYTES)
            throw new Error('Large re-compressed ZIPs are not supported. Use the original OM-exported ZIP (STORE), not a re-zipped copy.');
        legacy = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false });
    }
    const read = async (name: string, progress?: (count: number) => void): Promise<Blob> => {
        const e = entries.get(name);
        if (!e) throw new Error(`The backup is missing ${name}.`);
        if (!legacy) return readStoredEntry(file, e, progress);
        const f = legacy.file(name);
        if (!f) throw new Error(`Missing archive entry: ${name}.`);
        const data = await f.async('uint8array');
        if (data.length !== e.size) throw new Error('Unpacked entry size does not match its ZIP header.');
        const blob = new Blob([data as BlobPart]);
        if (await crc32Blob(blob, progress) !== e.crc) throw new Error(`Checksum failed: ${name}.`);
        return blob;
    };
    const manifest = validateManifest(JSON.parse(await (await read('manifest.json')).text()));
    let referenced = 0;
    for (const s of manifest.sources) {
        const entry = entries.get(`sources/${s.id}`);
        if (!entry) throw new Error(`The backup is missing ${s.name}.`);
        if (s.width * s.height > MAX_IMAGE_PIXELS) throw new Error(`${s.name}: image exceeds 60 megapixels.`);
        referenced += entry.size;
    }
    if (referenced > MAX_BOOK_SOURCE_BYTES) throw new Error('The referenced images exceed 1 GiB.');
    const sources: SourceAsset[] = [];
    let processed = 0;
    for (const s of manifest.sources) {
        const blob = await read(`sources/${s.id}`, count => onProgress?.(95 * (processed + count) / Math.max(1, referenced)));
        sources.push({ ...s, blob: blob.slice(0, blob.size, s.mime) });
        processed += blob.size;
    }
    onProgress?.(95);
    return { manifest, sources };
}
export async function restoreBook(file: File, onProgress?: (p: number) => void) {
    const { manifest, sources } = await readBookArchive(file, onProgress);
    // A single IndexedDB transaction clears/replaces the library. Failed transactions roll back.
    await replaceLibrary(manifest, sources);
    onProgress?.(100);
}
export function exportNotebook(state: LibraryState) {
    const lines = [`# ${state.book.title} — My notebook`, ''];
    for (const p of state.pages) {
        const items = state.annotations.filter(a => a.pageId === p.id);
        const bookmarked = state.bookmarks.some(b => b.pageId === p.id);
        if (!items.length && !bookmarked)
            continue;
        lines.push(`## ${p.title}`, `Source: ${p.sourceName}`, bookmarked ? 'Bookmarked.' : '', '');
        for (const a of items) {
            if (a.anchor)
                lines.push(`> ${a.anchor.quote.replace(/\n/g, '\n> ')}`);
            if (a.rect)
                lines.push('[Highlighted region on the original scan]');
            if (a.anchor?.detached || (a.kind === 'region' && a.cropVersion !== p.cropVersion))
                lines.push('[Location needs review]');
            if (a.note)
                lines.push(a.note);
            lines.push('');
        }
    }
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), 'reading-notebook.md');
}
