import { OMLogo, ThemeToggle, ApplicationCopyright } from '../components/Brand';
import { useAppTheme } from '../theme/ThemeProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, Crop, HighlightColor, LibraryState, Preferences, ReadingLayout, SelectionAnchor } from '../types';
import { saveAnnotation, toggleBookmark, patchPreferences, setPagesRead } from '../lib/db';
import { now, uid } from '../lib/text';
import { localDateKey, pagesForDate, readingUnits, unitIndex } from '../lib/reading';
import { exportNotebook } from '../lib/archive';
import { Icon } from '../components/Icon';
import { AccountControls } from '../components/AccountGate';
import { EditionHistory } from '../components/EditionHistory';
import { Sidebar } from '../components/Sidebar';
import { Notebook } from '../components/Notebook';
import { ReadingArea } from '../components/Reader';
import { NoteDialog } from '../components/NoteDialog';
import { CalendarDialog } from '../components/CalendarDialog';
import { Modal } from '../components/Modal';
import { ReadingFlow, type FlowTarget } from '../reading/ReadingFlow';
import { useReadingProgress } from '../reading/useReadingProgress';
import { useNarration } from '../reading/useNarration';
import { NarrationPanel } from '../reading/NarrationPanel';
import type { Navigate } from './WorkspaceHeader';

export function ReaderWorkspace({ state, navigate, setLocked }: { state: LibraryState; navigate: Navigate; setLocked: (b: boolean) => void }) {
    const appTheme=useAppTheme();
    const initialId = state.pages.some(p => p.id === state.prefs.pageId) ? state.prefs.pageId : state.pages[0]?.id || '';
    const [currentId, setCurrentId] = useState(initialId), [target, setTarget] = useState<FlowTarget>({ id:initialId, revision:0 });
    const [query, setQuery] = useState(''), [selection, setSelection] = useState<SelectionAnchor | null>(null);
    const [modal, setModal] = useState<'' | 'appearance' | 'calendar' | 'help' | 'source'>('');
    const [sourceId, setSourceId] = useState(''), [sourceCompare, setSourceCompare] = useState(false);
    const [note, setNote] = useState<{ annotation: Annotation; isNew: boolean } | null>(null);
    const [sideOpen, setSideOpen] = useState(false), [notebookOpen, setNotebookOpen] = useState(false), [listenOpen, setListenOpen] = useState(false);
    const [visible, setVisible] = useState<{ unit: string[]; pages: string[] }>({ unit:[], pages:[] });
    const [toast, setToast] = useState(''), [undoIds, setUndoIds] = useState<string[]>([]), [date, setDate] = useState(new Date());
    const search = useRef<HTMLInputElement>(null), scroll = useRef<HTMLDivElement>(null), once = useRef(false);
    const page = state.pages.find(p => p.id === currentId) || state.pages[0];
    const layout = state.prefs.readingLayout || 'continuous';
    const units = readingUnits(state.pages, layout), at = unitIndex(state.pages, page?.id || '', layout);
    const group = units[at] || [], ids = group.map(p => p.id), firstIndex = state.pages.findIndex(p => p.id === group[0]?.id);
    const today = pagesForDate(state.pages, date), todayLabel = date.toLocaleDateString(undefined, { month:'long', day:'numeric' });
    const localKey = localDateKey(date);
    const run = async (fn: () => Promise<unknown>, message?: string) => { try { await fn(); if (message) setToast(message); } catch(e) { setToast(e instanceof Error ? e.message : String(e)); } };
    const patch = (value: Partial<Preferences>) => { void run(() => patchPreferences(value)); };
    const reveal = useCallback((id: string, bottom = false) => {
        setSelection(null); setSideOpen(false); setCurrentId(id); setVisible({ unit:[], pages:[] });
        window.getSelection()?.removeAllRanges(); setTarget(old => ({ id, revision:old.revision + 1, bottom }));
    }, []);
    const followNarration = useCallback((id: string) => reveal(id), [reveal]);
    const narration = useNarration(state.prefs, followNarration);
    const go = useCallback((id: string, bottom = false) => { narration.stop(); reveal(id, bottom); }, [reveal, narration.stop]);
    const onActive = useCallback((id: string, unit: string[], pages: string[]) => { setCurrentId(id); setVisible({ unit, pages }); }, []);
    const progress = useReadingProgress({ unitIds:visible.unit, visibleIds:visible.pages, enabled:state.prefs.autoMarkRead !== false,
        paused:!!modal || !!note || notebookOpen || listenOpen || !!selection || sideOpen,
        onMarked: marked => { const changed = marked.filter(id => !state.pages.find(p => p.id === id)?.read); if (changed.length) { setUndoIds(changed); setToast(`${changed.length === 1 ? 'Page' : 'Both pages'} marked read after 90 seconds of active reading.`); } },
        onError:setToast });
    const changeRead = (pageIds: string[], read: boolean) => { if (!read) progress.suppress(pageIds); setUndoIds([]); void run(() => setPagesRead(pageIds, read)); };
    const bookmark = (id: string) => { void run(() => toggleBookmark(id, state.bookmarks)); };
    const move = (direction: -1 | 1) => { const next = units[at + direction]; if (next) go(next[0].id, direction < 0); };
    const edgeAt = useRef(0);
    const moveAtEdge = (direction: -1 | 1) => { const t = performance.now(); if (t - edgeAt.current < 800 || modal || note) return; edgeAt.current = t; move(direction); };
    const chooseLayout = (value: ReadingLayout) => { patch({ readingLayout:value }); setTarget(old => ({ id:currentId, revision:old.revision + 1 })); setVisible({ unit:[], pages:[] }); };
    const readFromHere = () => { const start = Math.max(0, firstIndex); narration.start(state.pages.slice(start)); };
    const openToday = (listen: boolean) => {
        if (!today.length) { setToast(`${todayLabel} has no reliable date index yet. Its scan may already be present. Open Book Preparation → Repair dates & structure.`); return; }
        go(today[0].id);
        if (listen) { if (!narration.available) { setListenOpen(true); setToast('Select an available voice before listening.'); } else narration.start(today); }
    };
    useEffect(() => { document.title = `${state.book.title} · Reader`; }, [state.book.title]);
    useEffect(() => { if (currentId) void patchPreferences({ pageId:currentId }).catch(e => setToast(String(e))); }, [currentId]);
    useEffect(() => { if (!once.current) { once.current = true; if (state.prefs.autoOpenToday && today.length) reveal(today[0].id); } }, []);
    useEffect(() => { const refresh = () => setDate(new Date()); const timer = setInterval(refresh, 30_000); document.addEventListener('visibilitychange', refresh); return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); }; }, []);
    const previousDate = useRef(localKey);
    useEffect(() => { if (previousDate.current !== localKey) { previousDate.current = localKey; setToast(`It is now ${todayLabel}. Today's reading has been updated; use Today when you are ready.`); } }, [localKey]);
    useEffect(() => { setLocked(Boolean(note || modal)); return () => setLocked(false); }, [note !== null, modal, setLocked]);
    useEffect(() => { if (!toast) return; const timer = setTimeout(() => { setToast(''); setUndoIds([]); }, 10000); return () => clearTimeout(timer); }, [toast]);
    useEffect(() => { const key = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.current?.focus(); return; }
        if (/INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target as HTMLElement)?.tagName) || document.querySelector('dialog[open]') || window.getSelection()?.toString()) return;
        if (e.key === 'ArrowRight' && at < units.length - 1) { e.preventDefault(); move(1); }
        if (e.key === 'ArrowLeft' && at > 0) { e.preventDefault(); move(-1); }
        if (e.key === 'Escape') { setSelection(null); setSideOpen(false); setNotebookOpen(false); setListenOpen(false); }
    }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [at, state.pages, go, layout]);
    const newNote = (rect?: Crop, explicitId?: string) => {
        const pageId = explicitId || selection?.pageId || page?.id, selectedPage = state.pages.find(p => p.id === pageId);
        if (!selectedPage) return;
        const sel = selection?.pageId === pageId && !rect ? selection : undefined;
        const anchor = sel ? { start:sel.start, end:sel.end, quote:sel.quote, prefix:sel.prefix, suffix:sel.suffix } : undefined;
        setNote({ isNew:true, annotation:{ id:uid(), pageId:selectedPage.id, kind:rect ? 'region' : anchor ? 'text' : 'note', color:'gold', note:'', createdAt:now(), ...(rect ? { rect, cropVersion:selectedPage.cropVersion } : anchor ? { anchor } : {}) } }); setSelection(null);
    };
    const highlight = (color: HighlightColor) => { if (!selection) return; const { pageId, ...anchor } = selection;
        void run(() => saveAnnotation({ id:uid(), pageId, kind:'text', color, note:'', anchor, createdAt:now() }), 'Passage highlighted.'); setSelection(null); window.getSelection()?.removeAllRanges();
    };
    const openSource = (id: string) => { setSourceId(id); setSourceCompare(false); setModal('source'); };
    const original = state.pages.find(p => p.id === sourceId), bookmarked = state.bookmarks.some(b => b.pageId === page?.id);
    const allRead = group.length > 0 && group.every(p => p.read), seconds = Math.floor(progress.elapsed / 1000), timerLabel = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const audioStatus = narration.playback.status;
    return <div className={`app theme-${state.prefs.theme} reading-workspace reader-v3`}>
        <header className="reader-library-header"><button className="button secondary small" onClick={() => navigate('/library')}><Icon name="left" size={17}/>Library</button><OMLogo/><div className="reader-edition"><span className="eyebrow">OM DAILY READING</span><strong>{state.book.title}</strong></div><ThemeToggle/><EditionHistory navigate={navigate}/><AccountControls/><div className="global-search"><Icon name="search" size={18}/><input ref={search} aria-label="Search the entire book" placeholder="Search this book…" value={query} onChange={e => { setQuery(e.target.value); if (innerWidth < 900) setSideOpen(true); }}/>{query ? <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" size={15}/></button> : <kbd>Ctrl K</kbd>}</div><button className="icon-button" aria-label="Reader help" onClick={() => setModal('help')}><Icon name="help"/></button></header>
        <div className="app-body">{sideOpen && <button className="drawer-backdrop" aria-label="Close contents" onClick={() => setSideOpen(false)}/>}
            <aside className={`sidebar ${sideOpen ? 'open' : ''}`}><Sidebar readerOnly state={{ ...state, prefs:{ ...state.prefs, pageId:currentId } }} activeId={page?.id || ''} query={query} onPage={go} onImport={() => {}} onManage={() => {}} onCalendar={() => setModal('calendar')} onClose={() => setSideOpen(false)}/></aside>
            <main className="reader-main"><div className="reader-top"><div className="reader-breadcrumb"><button className="icon-button contents-toggle" aria-label="Open contents" onClick={() => setSideOpen(!sideOpen)}><Icon name="menu"/></button><span>{group.map(p => p.title).join(' / ') || state.book.title}</span></div><div className="reader-actions"><button className="icon-button" aria-label="Reading appearance" title="Reading appearance" onClick={() => setModal('appearance')}><span className="type-icon">Aa</span></button><button className={`icon-button ${bookmarked ? 'is-bookmarked' : ''}`} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'} title={bookmarked ? 'Remove bookmark' : 'Bookmark this page'} aria-pressed={bookmarked} disabled={!page} onClick={() => page && bookmark(page.id)}><Icon name="bookmark"/></button><button className="icon-button" aria-label={notebookOpen ? 'Close notebook' : 'Open notebook'} title="Open notebook" aria-expanded={notebookOpen} onClick={() => setNotebookOpen(!notebookOpen)}><Icon name="note"/></button></div></div>
            {page && <><div className="reader-toolbar reader-mode-toolbar"><div className="view-switch" role="group" aria-label="Reading layout">{(['single','spread','continuous'] as ReadingLayout[]).map(value => <button key={value} className={layout === value ? 'active' : ''} aria-pressed={layout === value} onClick={() => chooseLayout(value)}><Icon name={value === 'single' ? 'text' : value === 'spread' ? 'book' : 'continuous'} size={16}/>{value === 'single' ? 'Single page' : value === 'spread' ? 'Two pages' : 'Continuous'}</button>)}</div><div className="reading-tools-right"><button className="button secondary small" title={`Open dated reading for ${todayLabel}`} onClick={() => openToday(false)}><Icon name="calendar" size={16}/>Today</button><button className={`button small ${listenOpen ? 'primary' : 'secondary'}`} aria-expanded={listenOpen} onClick={() => setListenOpen(!listenOpen)}><Icon name="headphones" size={17}/>Read aloud</button></div></div>
                {listenOpen && <NarrationPanel prefs={state.prefs} control={narration} onPrefs={patch} onPlay={readFromHere} onToday={() => openToday(true)} todayCount={today.length} onClose={() => setListenOpen(false)}/>}
                {selection && <div className="selection-tools" role="toolbar" aria-label="Selected passage"><Icon name="highlight" size={17}/><span>Highlight</span>{(['gold','green','blue','rose'] as HighlightColor[]).map(color => <button key={color} className={`color-dot ${color}`} aria-label={`Highlight selection ${color}`} onPointerDown={e => e.preventDefault()} onClick={() => highlight(color)}/>)}<button className="text-button" onPointerDown={e => e.preventDefault()} onClick={() => newNote()}><Icon name="note" size={15}/>Add note</button><button className="icon-button" aria-label="Dismiss selected passage" onClick={() => { setSelection(null); window.getSelection()?.removeAllRanges(); }}><Icon name="close" size={15}/></button></div>}
                <div className="reading-scroll" ref={scroll} tabIndex={0} aria-label="Book reading area"><ReadingFlow pages={state.pages} layout={layout} target={target} activeId={currentId} annotations={state.annotations} bookmarks={state.bookmarks} query={query} fontSize={state.prefs.fontSize} scrollRef={scroll} spoken={narration.active ? { pageId:narration.playback.pageId, start:narration.playback.start } : undefined} onActive={onActive} onSelection={setSelection} onAnnotation={a => setNote({ annotation:a, isNew:false })} onRegion={(id, rect) => newNote(rect, id)} onBookmark={bookmark} onRead={(id, read) => changeRead([id], read)} onSource={openSource} onEdge={moveAtEdge}/></div>
                {(narration.active || audioStatus === 'error' || audioStatus === 'finished') && <div className="audio-dock" aria-label="Narration playback"><Icon name="headphones" size={18}/><div className="audio-now"><strong>{audioStatus === 'finished' ? 'Reading complete' : narration.playback.title || 'Read aloud'}</strong><span role="status">{narration.playback.message || `${audioStatus === 'loading' ? 'Preparing voice' : audioStatus === 'paused' ? 'Paused' : 'Reading'} · ${narration.playback.index + 1} / ${narration.playback.total} passages`}</span></div><button className="icon-button" aria-label="Previous spoken passage" disabled={!narration.active} onClick={() => narration.skip(-1)}><Icon name="left"/></button><button className="icon-button" aria-label={audioStatus === 'playing' || audioStatus === 'loading' ? 'Pause narration' : 'Resume narration'} disabled={!narration.active} onClick={audioStatus === 'playing' || audioStatus === 'loading' ? narration.pause : narration.resume}><Icon name={audioStatus === 'playing' || audioStatus === 'loading' ? 'pause' : 'play'}/></button><button className="icon-button" aria-label="Next spoken passage" disabled={!narration.active} onClick={() => narration.skip(1)}><Icon name="right"/></button><button className="icon-button" aria-label="Stop narration" onClick={narration.stop}><Icon name="stop"/></button></div>}
                <footer className="reader-footer"><button className={`read-toggle ${allRead ? 'done' : ''}`} role="checkbox" aria-checked={allRead} aria-label={group.length > 1 ? 'Mark both pages as read' : 'Mark current page as read'} onClick={() => changeRead(ids, !allRead)}><span className="check-circle">{allRead && <Icon name="check" size={12}/>}</span>{allRead ? group.length > 1 ? 'Both pages read' : 'Read' : group.length > 1 ? 'Mark both as read' : 'Mark as read'}</button><div className="page-navigation"><button className="icon-button" aria-label="Previous reading pages" disabled={!at} onClick={() => move(-1)}><Icon name="left" size={18}/></button><span>{group.length === 1 ? 'Page' : 'Pages'} <strong>{firstIndex + 1}{group.length > 1 ? `–${firstIndex + group.length}` : ''}</strong> of {state.pages.length}</span><button className="icon-button" aria-label="Next reading pages" disabled={at >= units.length - 1} onClick={() => move(1)}><Icon name="right" size={18}/></button></div><span className="auto-read-status" title="Only focused, visible reading time counts. Both pages must have appeared. This is a convenience, not proof of reading."><Icon name="clock" size={13}/>{state.prefs.autoMarkRead === false ? 'Auto-read off' : allRead ? 'Progress saved' : `${progress.running ? 'Auto-read' : 'Paused'} ${timerLabel} / 1:30`}</span></footer></>}
            </main>
            {page && notebookOpen && <aside className="notebook open reader-notebook"><Notebook readerOnly state={state} page={page} onAdd={() => { setSelection(null); newNote(undefined, page.id); }} onEdit={a => setNote({ annotation:a, isNew:false })} onReview={() => {}} onClose={() => setNotebookOpen(false)}/><button className="text-button notebook-export" onClick={() => exportNotebook(state)}><Icon name="download" size={15}/>Export entire notebook</button></aside>}
        </div>
        {toast && <div className="toast" role="status"><Icon name="check" size={18}/><span>{toast}</span>{undoIds.length > 0 && <button className="text-button" onClick={() => { changeRead(undoIds, false); setToast('Automatic read status undone. These pages will not be automatically rechecked this session.'); }}>Undo</button>}<button className="icon-button" aria-label="Dismiss notification" onClick={() => { setToast(''); setUndoIds([]); }}><Icon name="close" size={15}/></button></div>}
        {note && <NoteDialog annotation={note.annotation} isNew={note.isNew} onClose={() => setNote(null)} onSaved={() => { setNote(null); setToast('Note saved.'); }}/>} 
        {modal === 'calendar' && <CalendarDialog state={{ ...state, prefs:{ ...state.prefs, pageId:currentId } }} onPage={go} onClose={() => setModal('')}/>}
        {modal === 'source' && original && <Modal wide title={`Original page · ${original.title}`} description="The preserved scan is a reference, separate from the reading layout." onClose={() => setModal('')}><div className="button-row"><button className={`button small ${!sourceCompare ? 'primary' : 'secondary'}`} onClick={() => setSourceCompare(false)}>Original scan</button><button className={`button small ${sourceCompare ? 'primary' : 'secondary'}`} onClick={() => setSourceCompare(true)}>Text + scan</button></div><ReadingArea readerOnly mode={sourceCompare ? 'compare' : 'scan'} page={original} annotations={state.annotations.filter(a => a.pageId === original.id)} query={query} fontSize={state.prefs.fontSize} onSelection={setSelection} onAnnotation={a => { setModal(''); setNote({ annotation:a, isNew:false }); }} onRegion={rect => { setModal(''); newNote(rect, original.id); }}/></Modal>}
        {modal === 'appearance' && <Modal title="Reading appearance" description="Make the book comfortable to read." onClose={() => setModal('')}><label>Text size · {state.prefs.fontSize}px<input aria-label="Text size" type="range" min="15" max="27" value={state.prefs.fontSize} onChange={e => patch({ fontSize:Number(e.target.value) })}/></label><span className="field-label">Reading surface</span><div className="theme-options">{(['paper','light','dark'] as const).map(theme => <button key={theme} className={`theme-choice ${theme} ${(theme==='dark'?appTheme.theme==='dark':appTheme.theme==='light'&&state.prefs.theme===theme) ? 'selected' : ''}`} aria-pressed={theme==='dark'?appTheme.theme==='dark':appTheme.theme==='light'&&state.prefs.theme===theme} onClick={() => {patch({ theme });appTheme.setTheme(theme==='dark'?'dark':'light');}}><span>Aa</span>{theme === 'paper' ? 'Warm paper' : theme === 'light' ? 'Clear light' : 'Evening'}</button>)}</div><label className="automation-choice"><input type="checkbox" checked={state.prefs.autoMarkRead !== false} onChange={e => patch({ autoMarkRead:e.target.checked })}/><span>Automatically mark the displayed pages read after 1 minute 30 seconds of active reading</span></label><p className="field-help">The timer pauses in background tabs or while a dialog is open. On narrow screens, each page must have appeared before both are checked. Unchecking a page disables automatic rechecking for this session.</p><label className="automation-choice"><input type="checkbox" checked={!!state.prefs.autoOpenToday} onChange={e => patch({ autoOpenToday:e.target.checked })}/><span>Open this book at today's dated reading</span></label><p className="field-help">Uses your device's local month and day and this edition's printed dates. It does not recalculate feast dates, Scripture schedules or fasting rules for a different year or calendar.</p></Modal>}
        {modal === 'help' && <Modal title="A reading room, not a processing screen" onClose={() => setModal('')}><div className="help-sections"><h3>Read continuously</h3><p>Single page gives one column. Two pages gives a facing spread. Continuous places successive two-page spreads beneath one another: scroll naturally into the next pair without turning a page. On smaller screens, pages stack at a comfortable width. In Single page and Two pages, scrolling beyond the end advances to the next reading unit.</p><h3>Save your place</h3><p>The 90-second timer counts only focused, visible reading time. It is a convenience, not proof of reading. Each page has its own bookmark and read checkbox. Highlights and notes stay attached to the original logical page, regardless of layout.</p><h3>Listen and follow the date</h3><p>Read aloud continues from the current spread. Listen today reads only pages whose printed month and day match your device's date. Audio requires a Play click. The optional four neural voices need server credentials; installed device voices vary.</p><h3>Application rights</h3><ApplicationCopyright/><h3>Keep the original</h3><p>Use the scan icon on a page to inspect the original, or compare text and scan there. Preparation tools remain in Book Preparation. Keep external backups; this edition and your personal notes are saved in the shared library.</p></div></Modal>}
    </div>;
}
