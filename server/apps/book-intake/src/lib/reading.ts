import type { BookPage, ReadingLayout } from '../types';
import { resolvePrintedDate } from './dates';
export { normalizeDateKey } from './dates';

export const AUTO_READ_MS = 90_000;
/** Units contain real logical page IDs. No synthetic repagination changes annotation anchors. */
export function readingUnits(pages: BookPage[], layout: ReadingLayout): BookPage[][] {
    const width = layout === 'single' ? 1 : 2;
    const units: BookPage[][] = [];
    for (let at = 0; at < pages.length; at += width) units.push(pages.slice(at, at + width));
    return units;
}
export function unitIndex(pages: BookPage[], pageId: string, layout: ReadingLayout): number {
    const at = Math.max(0, pages.findIndex(p => p.id === pageId));
    return Math.floor(at / (layout === 'single' ? 1 : 2));
}
export function localDateKey(date = new Date()): string {
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/** All date navigation uses the same evidence-based index as import and repair. */
export function pageDateKey(page: BookPage): string { const index=resolvePrintedDate(page); return index.status==='resolved'?index.key:''; }
export function pagesForDate(pages: BookPage[], date = new Date()): BookPage[] {
    const key = localDateKey(date);
    return pages.filter(p => pageDateKey(p) === key); // Preserve verified book order; include every matching page.
}
export function formatPublishedAt(value?: string): string {
    if (!value || !Number.isFinite(Date.parse(value))) return 'Publication date not recorded';
    return new Date(value).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}
export function visiblePixels(rect: { top: number; bottom: number }, viewport: { top: number; bottom: number }): number {
    return Math.max(0, Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top));
}
/** Focused dwell is a reading convenience, not proof of attention. Sleep/background time is excluded. */
export class ReadingClock {
    private totals = new Map<string, number>();
    private seen = new Map<string, Set<string>>();
    private suppressed = new Set<string>();
    private completed = new Set<string>();
    suppress(ids: string[]) { ids.forEach(id => this.suppressed.add(id)); }
    sample(key: string, pageIds: string[], visibleIds: string[], elapsedMs: number, active: boolean): { elapsed: number; ready: string[] } {
        let total = this.totals.get(key) || 0;
        if (active && visibleIds.length && elapsedMs > 0 && elapsedMs <= 2500) {
            total = Math.min(AUTO_READ_MS, total + elapsedMs);
            this.totals.set(key, total);
            const seen = this.seen.get(key) || new Set<string>();
            visibleIds.forEach(id => seen.add(id)); this.seen.set(key, seen);
        }
        const seen = this.seen.get(key);
        const ready = active && visibleIds.length > 0 && total >= AUTO_READ_MS && pageIds.every(id => seen?.has(id))
            ? pageIds.filter(id => !this.suppressed.has(id) && !this.completed.has(id)) : [];
        return { elapsed: total, ready };
    }
    acknowledge(ids: string[]) { ids.forEach(id => this.completed.add(id)); }
}
