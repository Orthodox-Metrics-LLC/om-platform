import { useRef, useState } from 'react';
import type { BookInfo, LibraryState } from '../types';
import { commit, removePage, resetLibrary, saveSetting } from '../lib/db';
import { exportBook, exportNotebook, restoreBook } from '../lib/archive';
import { Modal } from './Modal';
import { serverStorage } from '../lib/backend';
import { Icon } from './Icon';
export function ManageDialog({ state, onClose, notify, onBulkReview }: {
    state: LibraryState;
    onBulkReview: () => void;
    onClose: () => void;
    notify: (message: string) => void;
}) {
    const [book, setBook] = useState<BookInfo>(state.book), [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
    const restore = useRef<HTMLInputElement>(null);
    const task = async (fn: () => Promise<unknown>, message?: string) => { setBusy(true); setError(''); try {
        await fn();
        if (message) {
            notify(message);
            setStatus(message);
        }
    }
    catch (e) {
        setError(e instanceof Error ? e.message : String(e));
    }
    finally {
        setBusy(false);
    } };
    return <Modal title="Your book, organized." description="Manage the edition, keep a backup, and put every page in order." onClose={onClose} wide locked={busy}>
    <div className="manage-grid"><section><h3>Book details</h3><div className="form-grid"><label className="span-two">Reader / book title<input value={book.title} onChange={e => setBook({ ...book, title: e.target.value })}/></label><label className="span-two">Subtitle<input value={book.subtitle} onChange={e => setBook({ ...book, subtitle: e.target.value })}/></label><label>Edition year (optional)<input value={book.year} placeholder="Not specified" onChange={e => setBook({ ...book, year: e.target.value })}/></label><label>Calendar convention<input value={book.calendar} onChange={e => setBook({ ...book, calendar: e.target.value })}/></label></div><button className="button primary" disabled={busy || !book.title.trim()} onClick={() => task(() => saveSetting('book', book), 'Book details saved.')}><Icon name="check" size={16}/> Save details</button>
    <h3 className="section-gap">Review the whole book</h3><p className="field-help">Accept available text in a single batch instead of approving every page separately. Missing text and recorded OCR errors remain flagged.</p><button className="button secondary" disabled={busy} onClick={onBulkReview}><Icon name="check" size={16}/> Bulk approve book</button>
    <h3 className="section-gap">Keep it safe</h3><p className="field-help">Keep a backup outside this installation. A full backup includes original images, corrected text, crop settings, bookmarks, highlights, and notes. Backup and restore support up to 1 GiB of original images; originals are not recompressed.</p>
    <div className="manage-actions"><button disabled={busy} onClick={() => task(() => exportBook(state, false, p => setStatus(`Creating backup · ${Math.round(p)}%`)), 'Backup prepared. Save the downloaded file somewhere safe.')}><Icon name="download"/><span><strong>Export full backup</strong><small>Everything, including your private notebook</small></span></button><button disabled={busy} onClick={() => task(() => exportBook(state, true, p => setStatus(`Creating publication copy · ${Math.round(p)}%`)), 'Book-only copy prepared. Personal notes and reading progress were excluded.')}><Icon name="book"/><span><strong>Export book-only copy</strong><small>Images and text; no private annotations</small></span></button><button disabled={busy} onClick={() => exportNotebook(state)}><Icon name="note"/><span><strong>Export my notebook</strong><small>Readable Markdown notes and quotations</small></span></button><button disabled={busy} onClick={() => restore.current?.click()}><Icon name="upload"/><span><strong>Restore a book file</strong><small>Replaces this book’s active preparation</small></span></button></div>
    <input ref={restore} type="file" accept=".zip" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file && confirm('Restore this book? This replaces all current pages and private notes. Export a backup first. Only restore files you trust.'))
        task(async () => { await restoreBook(file, p => setStatus(`Validating / restoring book · ${Math.round(p)}%`)); onClose(); }, 'Book restored.'); }}/>
    {!serverStorage()&&<button className="text-button" disabled={busy} onClick={() => task(async () => { if (!navigator.storage?.persist)
        throw new Error('This browser does not expose persistent storage requests. Keep external backups.'); const ok = await navigator.storage.persist(); setStatus(ok ? 'Browser granted persistent storage. External backups are still recommended.' : 'Browser did not grant persistent storage. Continue exporting backups.'); })}><Icon name="lock" size={15}/> Ask browser to retain local data</button>}
    </section><section><div className="section-label"><h3>Page order</h3><span>{state.pages.length} pages</span></div><p className="field-help">Source filenames determine the initial order. Use the arrows to correct it; annotations follow their page IDs.</p><div className="reorder-list">{state.pages.map((page, i) => <div key={page.id} className="reorder-item"><span className="order-number">{i + 1}</span><div><strong>{page.title}</strong><small>{page.sourceName}</small></div><button className="icon-button" aria-label={`Move ${page.title} up`} disabled={busy || i === 0} onClick={() => task(() => commit(['pages'], tx => { const other = state.pages[i - 1]; tx.objectStore('pages').put({ ...page, order: other.order }); tx.objectStore('pages').put({ ...other, order: page.order }); }))}><Icon name="arrowup" size={15}/></button><button className="icon-button" aria-label={`Move ${page.title} down`} disabled={busy || i === state.pages.length - 1} onClick={() => task(() => commit(['pages'], tx => { const other = state.pages[i + 1]; tx.objectStore('pages').put({ ...page, order: other.order }); tx.objectStore('pages').put({ ...other, order: page.order }); }))}><Icon name="arrowdown" size={15}/></button><button className="icon-button danger-text" aria-label={`Delete ${page.title}`} disabled={busy} onClick={() => { if (confirm(`Delete “${page.title}” and its bookmarks and notes? The original spread is retained while another page uses it.`))
        task(() => removePage(page, state), 'Page removed.'); }}><Icon name="trash" size={15}/></button></div>)}</div>
    <div className="notice subtle"><Icon name="help" size={17}/><p>The bundled title is a working reader name. Sample transcriptions were prepared from the two supplied scans and still need your review. Confirm permission before publicly distributing book content.</p></div>
    <button className="button danger-text" disabled={busy} onClick={() => { if (confirm('Remove all pages from this book’s draft and your draft bookmarks and notes? This cannot be undone without a backup.'))
        task(async () => { await resetLibrary(); onClose(); }, 'Library cleared. You can now import a complete book.'); }}><Icon name="trash" size={16}/> Start with an empty library</button>
    </section></div>
    {status && <p className="notice" role="status">{status}</p>}{error && <p className="error-list" role="alert">{error}</p>}<div className="modal-footer"><p>Books are saved in this installation. Private reading data belongs to your account.</p><button className="button secondary" disabled={busy} onClick={onClose}>Done</button></div>
  </Modal>;
}
