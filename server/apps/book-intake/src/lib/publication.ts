import type { BookPage, LibraryState } from '../types';
import { commit, getDatabaseName, changeEvent } from './db';
import { api, bookId, serverStorage } from './backend';
import { canBulkApprove, isApproved, needsAttention } from './review';
import { uid, now } from './text';

export function preparationStats(pages: BookPage[]) {
    return { pages: pages.length, sources: new Set(pages.map(p => p.sourceId)).size,
        searchable: pages.filter(p => p.text.trim()).length,
        approved: pages.filter(p => isApproved(p) && !needsAttention(p)).length,
        unapproved: pages.filter(canBulkApprove).length, exceptions: pages.filter(needsAttention).length,
        pending: pages.filter(p => !p.text.trim()).length, failed: pages.filter(p => p.ocrError).length };
}
/** Reading flags and annotations are deliberately excluded from the editorial fingerprint. */
export function contentFingerprint(pages: BookPage[]) {
    return JSON.stringify([...pages].sort((a,b) => a.order-b.order).map(p => [p.id, p.order, p.sourceId, p.title, p.detail, p.dateKey,
        p.weekday, p.feast, p.fasting, p.readings, p.rotation, p.crop, p.textVersion, p.cropVersion, p.text, p.ocrError || '']));
}
export interface PublishOptions { orderVerified: boolean; approveAvailable: boolean; acceptExceptions: boolean; }
export function checkPublish(pages: BookPage[], options: PublishOptions) {
    const stats = preparationStats(pages);
    if (!pages.length) throw new Error('Import at least one page before publishing.');
    if (!options.orderVerified) throw new Error('Confirm the page order once for this book.');
    if (stats.unapproved && !options.approveAvailable) throw new Error('Accept the available text in bulk, or approve it before publishing.');
    if (stats.exceptions && !options.acceptExceptions) throw new Error('Acknowledge the remaining text exceptions or resolve them first.');
    return stats;
}
/** Approval + publication marker are atomic. Image blobs and personal annotations are never rewritten. */
export async function publishBook(snapshot: LibraryState, options: PublishOptions) {
    checkPublish(snapshot.pages, options);
    const fingerprint = contentFingerprint(snapshot.pages), at = now(), batchId = uid();
    let reason: Error | undefined;
    try { await commit(['pages', 'settings', 'sources'], tx => {
        const pages = tx.objectStore('pages'), settings = tx.objectStore('settings');
        const pageReq = pages.getAll(), sourceReq = tx.objectStore('sources').getAllKeys(), bookReq = settings.get('book');
        let ready = 0;
        const finish = () => { if (++ready < 3) return;
            try {
                const current = pageReq.result as BookPage[];
                if (contentFingerprint(current) !== fingerprint || JSON.stringify(bookReq.result?.value) !== JSON.stringify(snapshot.book))
                    throw new Error('The book changed during publication. Check the updated summary and publish again.');
                const stats = checkPublish(current, options), sources = new Set(sourceReq.result.map(String));
                if (current.some(p => !sources.has(p.sourceId))) throw new Error('An original scan is missing. Restore the missing source before publishing.');
                if (options.approveAvailable) for (const p of current.filter(canBulkApprove)) pages.put({ ...p, reviewed: true,
                    review: { method: 'bulk', batchId, at, textVersion: p.textVersion, cropVersion: p.cropVersion } });
                settings.put({ id: 'publication', value: { status: 'published', publishedAt: at, acceptedExceptions: stats.exceptions } });
            } catch (e) { reason = e instanceof Error ? e : new Error(String(e)); tx.abort(); }
        };
        pageReq.onsuccess = finish; sourceReq.onsuccess = finish; bookReq.onsuccess = finish;
    }); } catch (e) { throw reason || e; }
}
export async function reopenBook() {
    if(serverStorage()){await api(`/api/books/${bookId(getDatabaseName())}/reopen`,{method:'POST'});changeEvent.dispatchEvent(new Event('change'));return;}
    await commit(['settings'], tx => tx.objectStore('settings').put({ id: 'publication', value: { status: 'draft' } }));
}
/** Reordering merges the latest page records, preserving text edits, IDs, annotations and reading state. */
export async function reorderPages(ids: string[]) {
    let error: Error | undefined;
    try { await commit(['pages'], tx => {
        const store = tx.objectStore('pages'), req = store.getAll();
        req.onsuccess = () => {
            const pages = new Map((req.result as BookPage[]).map(p => [p.id, p]));
            if (pages.size !== ids.length || new Set(ids).size !== ids.length || ids.some(id => !pages.has(id))) {
                error = new Error('The page list changed. Reload the order and try again.'); tx.abort(); return;
            }
            ids.forEach((id, order) => store.put({ ...pages.get(id)!, order }));
        };
    }); } catch (e) { throw error || e; }
}
