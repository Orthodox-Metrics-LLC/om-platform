import type { BookPage } from '../types';
import { commit } from './db';
import { now, uid } from './text';
import { canBulkApprove, isApproved, matchesReviewSnapshot } from './review';

/** One read/write transaction. No image blobs, annotations or settings are rewritten. */
export async function approveAvailableText(snapshots: BookPage[]) {
    const expected = new Map(snapshots.filter(canBulkApprove).map(p => [p.id, p]));
    const batchId = uid(), at = now();
    let approved = 0;
    if (!expected.size) return { approved, skipped: 0, batchId };
    await commit(['pages'], tx => {
        const store = tx.objectStore('pages');
        const req = store.getAll();
        req.onsuccess = () => {
            for (const current of req.result as BookPage[]) {
                const snapshot = expected.get(current.id);
                if (!snapshot || !canBulkApprove(current) || !matchesReviewSnapshot(current, snapshot)) continue;
                store.put({ ...current, reviewed: true,
                    review: { method: 'bulk', batchId, at, textVersion: current.textVersion, cropVersion: current.cropVersion } });
                approved++;
            }
        };
    });
    return { approved, skipped: expected.size - approved, batchId };
}
/** Only approval flags from this batch are undone; later edits/reviews are protected. */
export async function undoBulkApproval(batchId: string) {
    if (!batchId) throw new Error('No bulk approval batch was selected.');
    let undone = 0;
    await commit(['pages'], tx => {
        const store = tx.objectStore('pages');
        const req = store.getAll();
        req.onsuccess = () => {
            for (const page of req.result as BookPage[]) {
                if (!isApproved(page) || page.review?.method !== 'bulk' || page.review.batchId !== batchId) continue;
                const { review: _review, ...rest } = page;
                store.put({ ...rest, reviewed: false });
                undone++;
            }
        };
    });
    return undone;
}
/** Retain a failed retry as an exception without destroying earlier usable text. */
export async function recordOCRFailure(snapshot: BookPage, error: string) {
    await commit(['pages'], tx => {
        const store = tx.objectStore('pages');
        const req = store.get(snapshot.id);
        req.onsuccess = () => {
            const current = req.result as BookPage | undefined;
            if (current && matchesReviewSnapshot(current, snapshot))
                store.put({ ...current, ocrError: error.slice(0, 2000) });
        };
    });
}
