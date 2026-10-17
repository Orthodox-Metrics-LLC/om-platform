import { useState } from 'react';
import type { LibraryState } from '../types';
import { pageDateKey } from '../lib/reading';
import { Modal } from './Modal';
export function CalendarDialog({ state, onPage, onClose }: {
    state: LibraryState;
    onPage: (id: string) => void;
    onClose: () => void;
}) {
    const current = state.pages.find(p => p.id === state.prefs.pageId), [month, setMonth] = useState(Number((current ? pageDateKey(current) : '').split('-')[0]) || 1);
    const months = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString('en-US', { month: 'long' }));
    const count = new Date(2000, month, 0).getDate();
    const pages = state.pages.filter(p => Number(pageDateKey(p).split('-')[0]) === month);
    return <Modal title="Find a day in the book" description="An index of printed dates—not a calculated church calendar." onClose={onClose}>
    <label>Month<select aria-label="Month" value={month} onChange={e => setMonth(Number(e.target.value))}>{months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
    <div className="date-grid">{Array.from({ length: count }, (_, i) => { const found = pages.find(p => Number(pageDateKey(p).split('-')[1]) === i + 1); return <button key={i} disabled={!found} className={found ? 'has-page' : ''} onClick={() => { if (found) {
        onPage(found.id);
        onClose();
    } }} title={found ? found.title : 'Not indexed yet — the scan may already be in the book'}>{i + 1}{found && <span />}</button>; })}</div>
    <p className="field-help">Available days are highlighted. Blank days have no reliable date index yet; their scans may still be present. Use Book Preparation → Repair dates & reading structure to recover printed headings. Dates are never inferred or generated.</p>
    <div className="dated-pages">{pages.map(p => <button key={p.id} onClick={() => { onPage(p.id); onClose(); }}><strong>{p.title}</strong><span>{p.detail || 'Open page'}</span></button>)}</div>
    <div className="notice subtle"><p>{state.book.calendar}{state.book.year ? ` · Edition year: ${state.book.year}` : ' · Edition year not specified'}. Readings and fasting labels are never shifted to another year or calendar automatically.</p></div>
  </Modal>;
}
