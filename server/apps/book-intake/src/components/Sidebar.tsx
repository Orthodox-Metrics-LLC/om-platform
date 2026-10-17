import { ApplicationCopyright } from './Brand';
import { isApproved, reviewLabel } from '../lib/review';
import { useEffect, useRef, useState } from 'react';
import type { BookPage, LibraryState } from '../types';
import { searchPages } from '../lib/text';
import { usePageImage } from '../hooks';
import { Icon } from './Icon';
export function Thumbnail({ page }: {
    page: BookPage;
}) { const ref = useRef<HTMLDivElement>(null); const [visible, setVisible] = useState(false); useEffect(() => { const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting) {
    setVisible(true);
    observer.disconnect();
} }, { rootMargin: '150px' }); if (ref.current)
    observer.observe(ref.current); return () => observer.disconnect(); }, []); const { image } = usePageImage(page, 150, visible); return <div className="page-thumb" ref={ref}>{image ? <img src={image.url} alt=""/> : <Icon name="book" size={17}/>}</div>; }
export function Sidebar({ state, activeId, query, onPage, onImport, onCalendar, onManage, onClose, readerOnly = false }: {
    readerOnly?: boolean;
    state: LibraryState;
    activeId: string;
    query: string;
    onPage: (id: string) => void;
    onImport: () => void;
    onCalendar: () => void;
    onManage: () => void;
    onClose: () => void;
}) {
    const [tab, setTab] = useState<'contents' | 'bookmarks'>('contents');
    const [limit, setLimit] = useState(60);
    const results = query.trim() ? searchPages(state.pages, query) : null;
    const bookmarked = new Set(state.bookmarks.map(b => b.pageId));
    const pages = results ? results.map(r => r.page) : tab === 'bookmarks' ? state.pages.filter(p => bookmarked.has(p.id)) : state.pages;
    const ready = state.pages.filter(p => p.text.trim()).length, read = state.pages.filter(p => p.read).length;
    useEffect(() => setLimit(60), [tab, query]);
    return <><div className="sidebar-book"><div className="book-spine"><Icon name="book" size={24}/></div><div><span className="eyebrow">YOUR READING ROOM</span><h2>{state.book.title}</h2><p>{state.pages.length} pages · {ready} searchable</p></div><button className="icon-button mobile-only" onClick={onClose} aria-label="Close contents"><Icon name="close"/></button></div>
  <div className="side-shortcuts"><button onClick={onCalendar}><Icon name="calendar" size={17}/> Browse by date</button>{!readerOnly && <button onClick={onManage}><Icon name="settings" size={17}/> Manage book</button>}</div>
  <div className="side-tabs"><button className={tab === 'contents' ? 'active' : ''} onClick={() => setTab('contents')}>Contents</button><button className={tab === 'bookmarks' ? 'active' : ''} onClick={() => setTab('bookmarks')}>Bookmarks <span>{state.bookmarks.length}</span></button></div>
  <div className="list-label">{results ? `${results.length} SEARCH ${results.length === 1 ? 'RESULT' : 'RESULTS'}` : tab === 'bookmarks' ? 'SAVED FOR LATER' : 'PAGES IN YOUR BOOK'}</div>
  <nav className="page-list" aria-label="Book pages">{pages.length ? pages.slice(0, limit).map(page => <button key={page.id} className={`page-item ${activeId === page.id ? 'active' : ''}`} onClick={() => onPage(page.id)} aria-current={activeId === page.id ? 'page' : undefined}><Thumbnail page={page}/><span className="page-item-text"><strong>{page.title}</strong><small>{page.detail || page.sourceName}</small>{results && <span className="search-snippet">{results.find(r => r.page.id === page.id)?.snippet}</span>}<span className="page-state">{readerOnly ? `Page ${state.pages.findIndex(p => p.id === page.id) + 1}${!page.text ? ' · Scan' : ''}` : <>{page.text ? `${isApproved(page) || page.ocrError ? reviewLabel(page) : 'Text available'} · ` : 'Needs OCR · '}Page {state.pages.findIndex(p => p.id === page.id) + 1}</>}</span></span>{bookmarked.has(page.id) ? <Icon name="bookmark" size={14}/> : page.read ? <Icon name="check" size={14}/> : null}</button>) : <div className="side-empty"><Icon name={results ? 'search' : 'bookmark'} size={25}/><p>{results ? 'No matching pages. Unprocessed scans cannot yet be searched by their printed text.' : 'Your saved pages will appear here.'}</p></div>}{pages.length > limit && <button className="button secondary load-more" onClick={() => setLimit(limit + 60)}>Show more pages</button>}</nav>
  <div className="sidebar-bottom"><div className="reading-progress"><span>YOUR READING JOURNEY</span><strong>{read} / {state.pages.length}</strong></div><div className="progress-track"><div style={{ width: `${state.pages.length ? read / state.pages.length * 100 : 0}%` }}/></div>{!readerOnly && <button className="button primary full" onClick={onImport}><Icon name="plus" size={17}/> Add scanned pages</button>}<div className="privacy-line"><Icon name="lock" size={12}/> Saved in your account</div></div><ApplicationCopyright compact/></>;
}
