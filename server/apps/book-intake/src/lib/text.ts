import { textDateCandidates, dateLabel } from './dates';
import type { Annotation, BookPage, Crop, TextAnchor } from '../types';
export function uid(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // getRandomValues is available on HTTP LAN origins; randomUUID may not be.
    const data = crypto.getRandomValues(new Uint8Array(16));
    data[6] = (data[6] & 15) | 64; data[8] = (data[8] & 63) | 128;
    const hex = Array.from(data, n => n.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const now = () => new Date().toISOString();
export function paragraphs(text: string) {
    const result: {
        text: string;
        start: number;
        end: number;
    }[] = [];
    const pattern = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
    for (const m of text.matchAll(pattern))
        result.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });
    return result;
}
export function makeAnchor(text: string, start: number, end: number): TextAnchor {
    return { start, end, quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - 36), start), suffix: text.slice(end, end + 36) };
}
export function reanchor(anchor: TextAnchor, nextText: string): TextAnchor {
    const positions: number[] = [];
    if (!anchor.quote)
        return { ...anchor, detached: true };
    let pos = nextText.indexOf(anchor.quote);
    while (pos !== -1) {
        positions.push(pos);
        pos = nextText.indexOf(anchor.quote, pos + 1);
    }
    if (positions.length === 1)
        return { ...makeAnchor(nextText, positions[0], positions[0] + anchor.quote.length), detached: false };
    const matches = positions.filter(p => (!anchor.prefix || nextText.slice(Math.max(0, p - anchor.prefix.length), p).endsWith(anchor.prefix)) && (!anchor.suffix || nextText.slice(p + anchor.quote.length, p + anchor.quote.length + anchor.suffix.length).startsWith(anchor.suffix)));
    if (matches.length === 1)
        return { ...makeAnchor(nextText, matches[0], matches[0] + anchor.quote.length), detached: false };
    return { ...anchor, detached: true };
}
export function normalize(text: string): string { return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(); }
export function searchPages(pages: BookPage[], query: string) {
    const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
    if (!tokens.length)
        return [];
    return pages.flatMap(page => {
        const metadata = [page.title, page.detail, page.dateKey, page.weekday, page.feast, page.fasting, page.readings].join(' ');
        if (!tokens.every(token => normalize(metadata + ' ' + page.text).includes(token)))
            return [];
        const at = normalize(page.text).indexOf(tokens[0]);
        const start = Math.max(0, at - 60);
        return [{ page, snippet: at >= 0 ? (start ? '…' : '') + page.text.slice(start, start + 190).replace(/\n/g, ' ') + (start + 190 < page.text.length ? '…' : '') : metadata, inText: at >= 0 }];
    });
}
export function searchRanges(text: string, query: string): {
    start: number;
    end: number;
}[] {
    const ranges: {
        start: number;
        end: number;
    }[] = [];
    // Offset mapping preserves accented characters and case-expanding Unicode in the original text.
    let folded = '';
    const offsets: number[] = [];
    for (let i = 0; i < text.length;) {
        const point = String.fromCodePoint(text.codePointAt(i)!);
        const value = normalize(point);
        for (let k = 0; k < value.length; k++)
            offsets.push(i);
        folded += value;
        i += point.length;
    }
    offsets.push(text.length);
    for (const token of new Set(normalize(query).trim().split(/\s+/).filter(Boolean))) {
        let p = folded.indexOf(token);
        while (p !== -1) {
            ranges.push({ start: offsets[p], end: offsets[p + token.length] });
            p = folded.indexOf(token, p + Math.max(1, token.length));
        }
    }
    return ranges;
}
export function validCrop(c: Crop): boolean { return [c.x, c.y, c.w, c.h].every(Number.isFinite) && c.x >= 0 && c.y >= 0 && c.w > 0.02 && c.h > 0.02 && c.x + c.w <= 1.000001 && c.y + c.h <= 1.000001; }
export function splitCrops(split: number, gutter: number): Crop[] {
    if (split <= 0 || split >= 1 || gutter < 0 || split - gutter / 2 <= 0 || split + gutter / 2 >= 1)
        throw new Error('The split and gutter must leave two usable pages.');
    return [{ x: 0, y: 0, w: split - gutter / 2, h: 1 }, { x: split + gutter / 2, y: 0, w: 1 - split - gutter / 2, h: 1 }];
}
export function pageAnnotations(items: Annotation[], page: BookPage) { return items.filter(a => a.pageId === page.id); }
export function monthDayLabel(key: string): string { return dateLabel(key); }
export function guessDate(text: string): string {
    const candidates = textDateCandidates(text);
    const keys = [...new Set(candidates.map(c => c.key))];
    return keys.length === 1 ? keys[0] : '';
}
