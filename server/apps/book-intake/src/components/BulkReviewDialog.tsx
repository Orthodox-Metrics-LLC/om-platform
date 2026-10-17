import { useRef, useState } from 'react';
import type { LibraryState } from '../types';
import { canBulkApprove, isApproved, lastBulkBatch, needsAttention } from '../lib/review';
import { approveAvailableText, undoBulkApproval } from '../lib/reviewStore';
import { Icon } from './Icon';
import { Modal } from './Modal';

export function BulkReviewDialog({ state, onClose, onPage, notify }: {
    state: LibraryState;
    onClose: () => void;
    onPage: (id: string) => void;
    notify: (message: string) => void;
}) {
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
    const [limit, setLimit] = useState(50);
    const lock = useRef(false);
    const available = state.pages.filter(canBulkApprove);
    const attention = state.pages.filter(needsAttention);
    const approved = state.pages.filter(p => isApproved(p) && !needsAttention(p)).length;
    const batch = lastBulkBatch(state.pages);
    const lowConfidence = available.filter(p => p.textSource === 'ocr' && p.confidence !== undefined && p.confidence < 80).length;
    const task = async (fn: () => Promise<string>) => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError(''); setStatus('');
        try { const message = await fn(); setStatus(message); notify(message); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { lock.current = false; setBusy(false); }
    };
    const approve = () => {
        if (!available.length || lock.current) return;
        if (!confirm(`Approve the available text on ${available.length} page${available.length === 1 ? '' : 's'} in one batch?\n\n${attention.length} page(s) without text or with a recorded OCR error will stay flagged. Already approved pages will not change.\n\nThis records your acceptance of the current results, not that each page was individually proofread. Text, original scans and personal notes are not changed.`)) return;
        void task(async () => {
            const result = await approveAvailableText(available);
            return `${result.approved} page${result.approved === 1 ? '' : 's'} bulk approved. No individual checkboxes required.${result.skipped ? ` ${result.skipped} page(s) changed while confirming and were skipped.` : ''}`;
        });
    };
    return <Modal title="Approve the book in one pass." description="Accept the results you are comfortable with. Only exceptions need separate attention." onClose={onClose} wide locked={busy}>
        <div className="bulk-review-summary" aria-label="Book review summary">
            <div><strong>{state.pages.length}</strong><span>Total pages</span></div>
            <div><strong>{available.length}</strong><span>Ready to approve</span></div>
            <div><strong>{approved}</strong><span>Already approved</span></div>
            <div><strong>{attention.length}</strong><span>Need attention</span></div>
        </div>
        <section className="bulk-review-action">
            <div><h3>Approve all available text</h3><p>This applies to the <strong>whole book</strong>, not just the current page or visible contents. Existing individual reviews are kept. A bulk approval is labeled separately from individual proofreading.</p></div>
            <button className="button primary" disabled={busy || !available.length} onClick={approve}><Icon name="check" size={18}/>{busy ? 'Saving…' : `Approve all available text (${available.length})`}</button>
        </section>
        {lowConfidence > 0 && <p className="notice subtle">{lowConfidence} eligible page(s) have OCR confidence below 80%. They are included in your bulk acceptance. This is an informational warning, not a required page-by-page review.</p>}
        {!available.length && !attention.length && state.pages.length > 0 && <p className="notice" role="status"><Icon name="check" size={18}/>All current page text is approved. You can continue reading.</p>}
        {!available.length && attention.length > 0 && <div className="notice subtle"><p>{state.pages.every(p => !p.text.trim()) ? <>Importing images does not create searchable text. Close this window and choose <strong>Process pending pages</strong> to run OCR on all pages without text, or add a transcript. Then approve the results together here.</> : <>Only the {attention.length} listed exception(s) remain. You can keep reading and return to them later; they do not block the book.</>}</p></div>}
        <details className="bulk-exceptions" open={attention.length > 0 || undefined}>
            <summary>Needs attention only ({attention.length})</summary>
            <p className="field-help">Only pages with no text or a recorded OCR failure are listed here. Blank or illustration-only scans can remain unapproved; approval is not required to use the reader.</p>
            {attention.length ? <div className="bulk-exception-list">{attention.slice(0, limit).map(p => <button key={p.id} disabled={busy} onClick={() => onPage(p.id)}><span><strong>Page {state.pages.findIndex(x => x.id === p.id) + 1} · {p.title}</strong><small>{p.ocrError || 'No searchable text yet. Run OCR or supply a transcript.'}</small></span><Icon name="right" size={17}/></button>)}{attention.length > limit && <button disabled={busy} onClick={() => setLimit(n => n + 50)}>Show more exceptions</button>}</div> : <p className="field-help">No missing text or recorded OCR errors.</p>}
        </details>
        {batch && <div className="bulk-undo"><div><strong>Undo is available</strong><p className="field-help">The latest remaining batch contains {batch.count} page(s). Undo changes approval status only; it does not undo edits, reading progress or notes.</p></div><button className="button secondary" disabled={busy} onClick={() => {
            if (!confirm(`Undo the latest bulk approval for up to ${batch.count} pages? Individual reviews and any later text or crop changes will be kept.`)) return;
            void task(async () => { const count = await undoBulkApproval(batch.id); return `Bulk approval undone for ${count} page(s). Your text, scans and notes are unchanged.`; });
        }}>Undo latest bulk approval</button></div>}
        {status && <p className="notice" role="status">{status}</p>}
        {error && <p className="error-list" role="alert">{error}</p>}
        <div className="modal-footer"><p>Reading, search, highlights and bookmarks work without approval. You can correct individual pages later.</p><button className="button secondary" disabled={busy} onClick={onClose}>Done</button></div>
    </Modal>;
}
