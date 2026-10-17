import { contentSha256 } from './contentHash';
import type { BookPage, Crop, SourceAsset } from '../types';
import { getSource } from './db';
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from './limits';
export async function decodeImage(blob: Blob): Promise<ImageBitmap> { return createImageBitmap(blob, { imageOrientation: 'from-image' }); }
export async function imageInfo(file: Blob) { const im = await decodeImage(file); const out = { width: im.width, height: im.height }; im.close(); return out; }
export { contentSha256 as sha256 } from './contentHash';
export async function renderCrop(blob: Blob, crop: Crop, rotation = 0, maxEdge = 2600): Promise<{
    blob: Blob;
    width: number;
    height: number;
}> {
    const im = await decodeImage(blob);
    try {
        const sx = Math.round(im.width * crop.x), sy = Math.round(im.height * crop.y), sw = Math.min(im.width - sx, Math.round(im.width * crop.w)), sh = Math.min(im.height - sy, Math.round(im.height * crop.h));
        const rotated = rotation === 90 || rotation === 270;
        const ow = rotated ? sh : sw, oh = rotated ? sw : sh;
        const scale = Math.min(1, maxEdge / Math.max(ow, oh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(ow * scale));
        canvas.height = Math.max(1, Math.round(oh * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw new Error('Image rendering is unavailable.');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.drawImage(im, sx, sy, sw, sh, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale);
        const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not prepare this scan.')), 'image/png'));
        return { blob: result, width: canvas.width, height: canvas.height };
    }
    finally {
        im.close();
    }
}
export async function renderPage(page: BookPage, maxEdge = 2600) { const source = await getSource(page.sourceId); return renderCrop(source.blob, page.crop, page.rotation, maxEdge); }
export async function assetFromFile(file: File): Promise<SourceAsset> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error(`${file.name}: use JPEG, PNG, or WebP. Convert TIFF, HEIC, or PDF first.`);
    if (file.size > MAX_IMAGE_BYTES)
        throw new Error(`${file.name}: maximum individual image size is 45 MiB.`);
    const info = await imageInfo(file);
    if (info.width * info.height > MAX_IMAGE_PIXELS)
        throw new Error(`${file.name}: maximum image resolution is 60 megapixels.`);
    return { id: await contentSha256(file), name: file.name, mime: file.type, ...info, blob: file };
}
