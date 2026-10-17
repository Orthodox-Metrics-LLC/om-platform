import type { BookPage } from '../types';

/** Approval records are about the current transcription and crop, not its truth. */
export function isApproved(page: BookPage): boolean {
    return page.reviewed && (!page.review || (
        page.review.textVersion === page.textVersion && page.review.cropVersion === page.cropVersion
    ));
}
export function needsAttention(page: BookPage): boolean {
    return !page.text.trim() || Boolean(page.ocrError);
}
export function canBulkApprove(page: BookPage): boolean {
    return !isApproved(page) && !needsAttention(page);
}
export function reviewLabel(page: BookPage): string {
    if (page.ocrError) return 'OCR needs attention';
    if (!page.text.trim()) return 'Needs OCR / transcript';
    if (isApproved(page)) return page.review?.method === 'bulk' ? 'Bulk approved' : 'Individually reviewed';
    return 'Not yet approved';
}
export function lastBulkBatch(pages: BookPage[]) {
    const remaining = pages.filter(p => isApproved(p) && p.review?.method === 'bulk' && p.review.batchId);
    const last = remaining.reduce<BookPage | undefined>((a, b) =>
        !a || b.review!.at > a.review!.at ? b : a, undefined);
    if (!last) return null;
    return { id: last.review!.batchId!, at: last.review!.at,
        count: remaining.filter(p => p.review!.batchId === last.review!.batchId).length };
}
/** Compare the approved content, not unrelated reading progress or page ordering. */
export function matchesReviewSnapshot(current: BookPage, snapshot: BookPage): boolean {
    return current.id === snapshot.id && current.sourceId === snapshot.sourceId &&
        current.textVersion === snapshot.textVersion && current.cropVersion === snapshot.cropVersion &&
        current.text === snapshot.text && current.rotation === snapshot.rotation &&
        ['x', 'y', 'w', 'h'].every(k => current.crop[k as keyof BookPage['crop']] === snapshot.crop[k as keyof BookPage['crop']]);
}
