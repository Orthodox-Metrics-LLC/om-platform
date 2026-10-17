import type { Annotation, BookPage, LibraryState } from '../types';
import { Icon } from './Icon';
import { isApproved, reviewLabel } from '../lib/review';
export function Notebook({ state, page, onAdd, onEdit, onReview, onClose, readerOnly = false }: {
    readerOnly?: boolean;
    state: LibraryState;
    page: BookPage;
    onAdd: () => void;
    onEdit: (a: Annotation) => void;
    onReview: () => void;
    onClose: () => void;
}) {
    const items = state.annotations.filter(a => a.pageId === page.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const highlights = items.filter(a => a.kind !== 'note').length;
    return <><div className="notebook-head"><div><span className="eyebrow">MAKE IT YOUR OWN</span><h2>My notebook</h2></div><button className="icon-button close-notebook" aria-label="Close notebook" onClick={onClose}><Icon name="close"/></button></div>
  <div className="notebook-scope"><span>{page.title}</span><span>{items.length} saved</span></div>
  <div className="notebook-list">{items.length ? items.map(a => <button key={a.id} className={`annotation-card ${a.color}`} onClick={() => onEdit(a)} data-testid="annotation"><span className="annotation-type"><Icon name={a.kind === 'note' ? 'note' : 'highlight'} size={13}/>{a.kind === 'text' ? 'Highlighted passage' : a.kind === 'region' ? 'Scan area' : 'Page note'}<Icon name="edit" size={12}/></span>{a.anchor && <blockquote>{a.anchor.quote}</blockquote>}{a.kind === 'region' && <span className="region-preview"><Icon name="scan" size={22}/> Saved on original scan</span>}{a.note && <p>{a.note}</p>}{(a.anchor?.detached || (a.kind === 'region' && a.cropVersion !== page.cropVersion)) && <span className="review-warning">Location needs review after an edit.</span>}<time>{new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></button>) : <div className="notebook-empty"><div className="notebook-illustration"><Icon name="note" size={33}/></div><h3>A little room for reflection.</h3><p>Select a passage to highlight it, or save a thought about this page.</p><button className="button secondary" onClick={onAdd}><Icon name="plus" size={16}/> Write a note</button></div>}</div>
  {items.length > 0 && <button className="button secondary full" onClick={onAdd}><Icon name="plus" size={16}/> Add a page note</button>}
  {!readerOnly && <div className="page-details"><span className="eyebrow">ABOUT THIS PAGE</span><dl><div><dt>Text source</dt><dd>{page.textSource === 'sample-transcription' ? 'Sample transcription' : page.textSource === 'ocr' ? 'OCR' : page.textSource === 'manual' ? 'Manually edited' : 'Not transcribed'}</dd></div><div><dt>Review</dt><dd className={isApproved(page) && !page.ocrError ? 'good' : 'pending'}>{reviewLabel(page)}</dd></div>{page.confidence !== undefined && <div><dt>OCR confidence</dt><dd>{Math.round(page.confidence)}% <span title="Engine confidence is not an accuracy guarantee.">ⓘ</span></dd></div>}<div><dt>Highlights</dt><dd>{highlights}</dd></div></dl><button className="text-button" onClick={onReview}>Review text & page details <Icon name="right" size={14}/></button><p>Dates and fasting labels follow this book’s edition, not a live liturgical calendar.</p></div>}</>;
}
