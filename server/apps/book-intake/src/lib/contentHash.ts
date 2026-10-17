/**
 * Portable SHA-256 for non-secret image content IDs on LAN HTTP origins.
 * Native Web Crypto remains preferred when available. This is NOT an encryption,
 * authentication or transport-security layer; serve sensitive content over HTTPS.
 */
import { ARCHIVE_READ_CHUNK_BYTES } from './limits';
const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotr = (n: number, b: number) => (n >>> b) | (n << (32 - b));
export async function portableSha256(blob: Blob): Promise<string> {
    const state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const words = new Uint32Array(64);
    const block = (data: Uint8Array<ArrayBuffer>, offset: number) => {
        const view = new DataView(data.buffer, data.byteOffset + offset, 64);
        for (let i = 0; i < 16; i++) words[i] = view.getUint32(i * 4, false);
        for (let i = 16; i < 64; i++) {
            const x = words[i - 15], y = words[i - 2];
            words[i] = words[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + words[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10));
        }
        let [a,b,c,d,e,f,g,h] = state;
        for (let i = 0; i < 64; i++) {
            const t1 = (h + (rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)) + ((e & f) ^ (~e & g)) + K[i] + words[i]) >>> 0;
            const t2 = ((rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
        }
        const result = [a,b,c,d,e,f,g,h];
        for (let i = 0; i < 8; i++) state[i] = (state[i] + result[i]) >>> 0;
    };
    // The read size is a multiple of 64, so only the final chunk needs padding.
    const full = blob.size - (blob.size % 64);
    for (let start = 0; start < full; start += ARCHIVE_READ_CHUNK_BYTES) {
        const data = new Uint8Array(await blob.slice(start, Math.min(full, start + ARCHIVE_READ_CHUNK_BYTES)).arrayBuffer());
        for (let at = 0; at < data.length; at += 64) block(data, at);
        await new Promise(r => setTimeout(r, 0));
    }
    const remaining = new Uint8Array(await blob.slice(full).arrayBuffer());
    const pad = new Uint8Array(remaining.length < 56 ? 64 : 128);
    pad.set(remaining); pad[remaining.length] = 0x80;
    const end = new DataView(pad.buffer), bits = blob.size * 8;
    end.setUint32(pad.length - 8, Math.floor(bits / 0x100000000), false);
    end.setUint32(pad.length - 4, bits >>> 0, false);
    for (let at = 0; at < pad.length; at += 64) block(pad, at);
    return Array.from(state, n => n.toString(16).padStart(8, '0')).join('');
}
export async function contentSha256(blob: Blob): Promise<string> {
    if (!globalThis.crypto?.subtle) return portableSha256(blob);
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
