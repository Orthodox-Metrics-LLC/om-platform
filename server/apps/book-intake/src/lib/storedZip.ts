/**
 * Bounded-read classic ZIP/STORE adapter for OM archives (not ZIP64 or encrypted ZIP).
 * Original image Blobs remain Blobs; only headers and 1 MiB checksum chunks are read
 * into JavaScript buffers. Browser-managed Blob/IndexedDB storage still uses resources.
 * Format reference: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 */
import { ARCHIVE_READ_CHUNK_BYTES, MAX_ARCHIVE_BYTES } from './limits';

export interface StoredInput { name: string; blob: Blob }
export interface ZipEntry {
    name: string; flags: number; method: number; crc: number;
    size: number; compressedSize: number; offset: number; directoryOffset: number;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const table = new Uint32Array(256);
for (let n = 0; n < table.length; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
}
function safeName(name: string): boolean {
    return !!name && name.length <= 1024 && !/^[\\/]|[\\:\x00-\x1f]/.test(name)
        && !name.split('/').some(p => p === '.' || p === '..');
}
async function bytes(blob: Blob, start: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > blob.size)
        throw new Error('Truncated or invalid ZIP range.');
    return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}
function view(data: Uint8Array<ArrayBuffer>) { return new DataView(data.buffer, data.byteOffset, data.byteLength); }
export async function crc32Blob(blob: Blob, progress?: (bytes: number) => void): Promise<number> {
    let crc = 0xffffffff;
    for (let at = 0; at < blob.size; at += ARCHIVE_READ_CHUNK_BYTES) {
        const data = await bytes(blob, at, Math.min(ARCHIVE_READ_CHUNK_BYTES, blob.size - at));
        for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
        progress?.(at + data.length);
        // Let the interface paint even when the source is already cached in memory.
        if ((at / ARCHIVE_READ_CHUNK_BYTES) % 8 === 7) await new Promise(r => setTimeout(r, 0));
    }
    return (crc ^ 0xffffffff) >>> 0;
}
export async function makeStoredZip(entries: StoredInput[], progress?: (p: number) => void): Promise<Blob> {
    if (entries.length > 5000) throw new Error('Too many files in this book archive.');
    const names = new Set<string>();
    let projected = 22;
    for (const entry of entries) {
        if (!safeName(entry.name) || names.has(entry.name)) throw new Error('Unsafe or duplicate archive filename.');
        names.add(entry.name);
        projected += 76 + 2 * encoder.encode(entry.name).length + entry.blob.size;
    }
    if (projected > MAX_ARCHIVE_BYTES) throw new Error('The complete archive exceeds the 1.125 GiB archive limit.');
    const parts: BlobPart[] = [], directory: BlobPart[] = [];
    let offset = 0, processed = 0, directorySize = 0;
    const total = entries.reduce((sum, e) => sum + e.blob.size, 0);
    for (const entry of entries) {
        const name = encoder.encode(entry.name);
        const crc = await crc32Blob(entry.blob, count => progress?.(100 * (processed + count) / Math.max(1, total)));
        const local = new Uint8Array(30 + name.length), h = view(local);
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true);
        h.setUint16(6, 0x0800, true); // UTF-8, no compression, no data descriptor.
        h.setUint16(12, 33, true); // Jan 1, 1980; source metadata lives in manifest.
        h.setUint32(14, crc, true); h.setUint32(18, entry.blob.size, true);
        h.setUint32(22, entry.blob.size, true); h.setUint16(26, name.length, true);
        local.set(name, 30);
        const central = new Uint8Array(46 + name.length), c = view(central);
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true); c.setUint16(14, 33, true);
        c.setUint32(16, crc, true); c.setUint32(20, entry.blob.size, true);
        c.setUint32(24, entry.blob.size, true); c.setUint16(28, name.length, true);
        c.setUint32(42, offset, true); central.set(name, 46);
        parts.push(local, entry.blob); directory.push(central);
        offset += local.length + entry.blob.size; directorySize += central.length;
        processed += entry.blob.size;
    }
    const end = new Uint8Array(22), e = view(end);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true);
    e.setUint16(10, entries.length, true); e.setUint32(12, directorySize, true);
    e.setUint32(16, offset, true);
    progress?.(100);
    return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
export async function indexZip(file: Blob): Promise<Map<string, ZipEntry>> {
    if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds the 1.125 GiB archive limit.');
    if (file.size < 22) throw new Error('Not a complete ZIP file.');
    const tailAt = Math.max(0, file.size - 65557), tail = await bytes(file, tailAt, file.size - tailAt), t = view(tail);
    let at = tail.length - 22;
    while (at >= 0 && !(t.getUint32(at, true) === 0x06054b50 && at + 22 + t.getUint16(at + 20, true) === tail.length)) at--;
    if (at < 0) throw new Error('The ZIP end record is missing.');
    const count = t.getUint16(at + 10, true), size = t.getUint32(at + 12, true), offset = t.getUint32(at + 16, true);
    if (t.getUint16(at + 4, true) || t.getUint16(at + 6, true) || t.getUint16(at + 8, true) !== count)
        throw new Error('Split ZIP volumes are not supported.');
    if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff)
        throw new Error('ZIP64 is not supported by this book reader.');
    if (count > 5000 || size > 8 * 1024 * 1024 || offset + size !== tailAt + at)
        throw new Error('Invalid or oversized ZIP directory.');
    const central = await bytes(file, offset, size), d = view(central), entries = new Map<string, ZipEntry>();
    let p = 0;
    for (let i = 0; i < count; i++) {
        if (p + 46 > central.length || d.getUint32(p, true) !== 0x02014b50) throw new Error('Invalid ZIP entry header.');
        const flags = d.getUint16(p + 8, true), method = d.getUint16(p + 10, true);
        const nameLength = d.getUint16(p + 28, true), extraLength = d.getUint16(p + 30, true), commentLength = d.getUint16(p + 32, true);
        const end = p + 46 + nameLength + extraLength + commentLength;
        if (end > central.length || nameLength > 1024 || d.getUint16(p + 34, true)) throw new Error('Invalid ZIP entry lengths or disk.');
        if ((flags & ~0x080e) !== 0 || (method !== 0 && method !== 8)) throw new Error('Unsupported or encrypted ZIP entry.');
        const name = decoder.decode(central.subarray(p + 46, p + 46 + nameLength));
        if (!safeName(name) || entries.has(name)) throw new Error('Unsafe or duplicate ZIP entry name.');
        const entry: ZipEntry = { name, flags, method, crc: d.getUint32(p + 16, true),
            size: d.getUint32(p + 24, true), compressedSize: d.getUint32(p + 20, true),
            offset: d.getUint32(p + 42, true), directoryOffset: offset };
        if (entry.size === 0xffffffff || entry.compressedSize === 0xffffffff || entry.offset === 0xffffffff
            || entry.offset + 30 + entry.compressedSize > offset || (method === 0 && entry.size !== entry.compressedSize))
            throw new Error('Invalid ZIP entry size or offset.');
        entries.set(name, entry); p = end;
    }
    if (p !== central.length) throw new Error('Unexpected ZIP directory data.');
    return entries;
}
export async function readStoredEntry(file: Blob, entry: ZipEntry, progress?: (bytes: number) => void): Promise<Blob> {
    if (entry.method !== 0) throw new Error('This entry uses compression rather than ZIP STORE.');
    const local = await bytes(file, entry.offset, 30), h = view(local);
    if (h.getUint32(0, true) !== 0x04034b50 || h.getUint16(6, true) !== entry.flags || h.getUint16(8, true) !== entry.method)
        throw new Error(`Inconsistent ZIP header: ${entry.name}`);
    const nameLength = h.getUint16(26, true), extraLength = h.getUint16(28, true);
    if (nameLength > 1024) throw new Error('Oversized ZIP filename.');
    const name = decoder.decode(await bytes(file, entry.offset + 30, nameLength));
    if (name !== entry.name) throw new Error('ZIP filename mismatch.');
    if (!(entry.flags & 8) && (h.getUint32(14, true) !== entry.crc || h.getUint32(18, true) !== entry.compressedSize || h.getUint32(22, true) !== entry.size))
        throw new Error(`Inconsistent ZIP sizes/checksum: ${entry.name}`);
    const start = entry.offset + 30 + nameLength + extraLength;
    if (start + entry.size > entry.directoryOffset) throw new Error('ZIP data overlaps the archive directory.');
    const blob = file.slice(start, start + entry.size);
    if (await crc32Blob(blob, progress) !== entry.crc) throw new Error(`Checksum failed: ${entry.name}. The current library has not been replaced.`);
    return blob;
}
