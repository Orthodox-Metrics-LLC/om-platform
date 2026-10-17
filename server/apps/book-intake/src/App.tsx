import { DateRepairDialog } from './quality/DateRepairDialog';
import { ApplicationCopyright } from './components/Brand';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLibrary } from './hooks';
import { openDB, selectDatabase, waitForWrites, readLibrary } from './lib/db';
import { catalogEvents, ensureCatalog, getCatalogBook, listBooks, syncCatalogBook, touchBook, type CatalogBook } from './lib/catalog';
import { reopenBook } from './lib/publication';
import { exportBook } from './lib/archive';
import { Icon } from './components/Icon';
import { LibraryHome } from './workspaces/LibraryHome';
import { ReaderWorkspace } from './workspaces/ReaderWorkspace';
import { PreparationWorkspace } from './workspaces/PreparationWorkspace';
import { WorkspaceHeader, type Navigate } from './workspaces/WorkspaceHeader';
import { setStorageMode, setStorageEdition } from './lib/backend';

function BookContent({ record, mode, navigate, setLocked }: { record: CatalogBook; mode: 'read' | 'preparation'; navigate: Navigate; setLocked: (b: boolean) => void }) {
    const { state, error } = useLibrary();
    const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false);
    const [repairOpen,setRepairOpen]=useState(false);
    useEffect(()=>{setLocked(repairOpen||busy);return()=>setLocked(false);},[repairOpen,busy,setLocked]);
    useEffect(() => { if (state) void syncCatalogBook(record.id, state).catch(e => setFailure(`Catalog update failed: ${String(e)}`)); }, [state, record.id]);
    useEffect(() => { if (mode === 'read') void touchBook(record.id).catch(e => setFailure(String(e))); }, [record.id, mode]);
    if (error) return <div className="fatal-error"><h1>Could not open this book.</h1><p>{error}</p><button onClick={() => navigate('/library')}>Back to library</button></div>;
    if (!state) return <div className="loading-app"><span className="spinner"/><h2>Opening book…</h2></div>;
    if ((mode === 'read' && state.publication?.status !== 'published') || (mode === 'preparation' && state.publication?.status === 'published')) {
        const published = state.publication?.status === 'published';
        return <div className="app theme-paper workspace-app"><WorkspaceHeader active={mode === 'read' ? 'library' : 'preparation'} navigate={navigate}/><main className="publication-state"><div className="publication-card"><span className={`status-pill ${published ? 'published' : 'draft'}`}>{published ? 'PUBLISHED TO LIBRARY' : 'IN PREPARATION'}</span><h1>{state.book.title}</h1><p>{published ? 'This book is ready to read. Its preparation controls are closed so the published edition stays separate from editing.' : 'This book has not been published yet. Finish preparation and publish once to open it in the library.'}</p><div className="publication-summary"><span><strong>{state.pages.length}</strong> pages</span><span><strong>{state.pages.filter(p => p.text.trim()).length}</strong> searchable</span><span><strong>{state.annotations.length}</strong> notes / highlights preserved</span></div><div className="button-row"><button className="button primary" disabled={busy} onClick={() => navigate(`/${published ? 'read' : 'preparation'}/${record.id}`)}>{published ? 'Open reader' : 'Continue preparation'}<Icon name="right" size={16}/></button>{published && <button className="button secondary" disabled={busy} onClick={async () => {
            if (!confirm('Create a new preparation edition? The published edition remains readable, and all existing reading data is retained.')) return;
            setBusy(true); setLocked(true); try { await reopenBook(); await syncCatalogBook(record.id, await readLibrary()); } catch(e) { setFailure(String(e)); } finally { setBusy(false); setLocked(false); }
        }}>Reopen for editing</button>}{published && <button className="button secondary" disabled={busy} onClick={async () => {
            setBusy(true); setLocked(true); try { await exportBook(state); } catch (e) { setFailure(String(e)); } finally { setBusy(false); setLocked(false); }
        }}><Icon name="download" size={16}/>Export full backup</button>}</div>{published && <p className="field-help">Reopening creates a separate draft. The published edition and its reading data remain available.</p>}{failure && <p className="error-list" role="alert">{failure}</p>}</div><ApplicationCopyright/></main>{repairOpen&&<DateRepairDialog state={state} onClose={()=>setRepairOpen(false)}/>}</div>;
    }
    return <>{failure && <div className="catalog-error" role="alert">{failure}</div>}{mode === 'read' ? <ReaderWorkspace state={state} navigate={navigate} setLocked={setLocked}/> : <PreparationWorkspace state={state} record={record} navigate={navigate} setLocked={setLocked}/>}</>;
}
function BookSession(props: { editionId?:string; record: CatalogBook; mode: 'read' | 'preparation'; navigate: Navigate; setLocked: (b: boolean) => void }) {
    const [ready, setReady] = useState(false), [error, setError] = useState('');
    useEffect(() => { let active = true; setStorageMode(props.mode); setStorageEdition(props.editionId); selectDatabase(props.record.database); openDB(props.record.database).then(() => active && setReady(true)).catch(e => active && setError(String(e))); return () => { active = false; }; }, [props.record.database,props.mode,props.editionId]);
    if (error) return <div className="fatal-error"><h1>Could not open the book database.</h1><p>{error}</p></div>;
    return ready ? <BookContent {...props}/> : <div className="loading-app"><span className="spinner"/></div>;
}
export default function App() {
    const [books, setBooks] = useState<CatalogBook[]>([]), [ready, setReady] = useState(false), [error, setError] = useState('');
    const [route, setRoute] = useState(location.hash.slice(1) || '/library');
    const locked = useRef(false), acceptedRoute = useRef(route);
    const setLocked = useCallback((value: boolean) => { locked.current = value; }, []);
    const navigate = useCallback((path: string) => { if (locked.current) { alert('Finish or close the current operation before changing workspaces. OCR can be stopped safely after the current page.'); return; } location.hash = path; }, []);
    useEffect(() => {
        let active = true, seq = 0;
        const load = async () => { const run = ++seq; try { const rows = await listBooks(); if (active && run === seq) setBooks(rows); } catch(e) { if (active) setError(String(e)); } };
        void ensureCatalog().then(async () => { await load(); if (active) setReady(true); }).catch(e => active && setError(String(e)));
        catalogEvents.addEventListener('change', load);
        return () => { active = false; catalogEvents.removeEventListener('change', load); };
    }, []);
    useEffect(() => {
        let seq = 0;
        const onRoute = async () => {
            const next = location.hash.slice(1) || '/library', run = ++seq;
            if (locked.current) { history.replaceState(null, '', `#${acceptedRoute.current}`); alert('Finish or close the current operation before leaving this book.'); return; }
            await waitForWrites(); if (run !== seq) return;
            const previous = /^\/(?:read|preparation)\/([a-zA-Z0-9_-]+)$/.exec(acceptedRoute.current);
            if (previous) {
                try { const entry = await getCatalogBook(previous[1]); if (entry) await syncCatalogBook(entry.id, await readLibrary(entry.database)); }
                catch (e) { setError(`Could not save the library summary: ${String(e)}`); return; }
            }
            if (run !== seq) return;
            acceptedRoute.current = next; setRoute(next);
        };
        const beforeUnload = (e: BeforeUnloadEvent) => { if (locked.current) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('hashchange', onRoute); window.addEventListener('beforeunload', beforeUnload);
        return () => { seq++; window.removeEventListener('hashchange', onRoute); window.removeEventListener('beforeunload', beforeUnload); };
    }, []);
    if (error) return <div className="fatal-error"><Icon name="book" size={40}/><h1>The library could not open.</h1><p>{error}</p><p>Do not clear browser data. Keep your original scans and exported backups.</p><button className="button primary" onClick={() => location.reload()}>Retry</button></div>;
    if (!ready) return <div className="loading-app"><div className="book-spine"><Icon name="book" size={30}/></div><h1>Opening your library…</h1><span className="spinner"/></div>;
    const match = /^\/(read|preparation)\/([a-zA-Z0-9_-]+)(?:\/edition\/([a-zA-Z0-9_-]+))?$/.exec(route);
    if (match) {
        const record = books.find(b => b.id === match[2]);
        return record ? <BookSession key={`${match[1]}:${record.id}:${match[3]||'current'}`} editionId={match[3]} record={record} mode={match[1] as 'read' | 'preparation'} navigate={navigate} setLocked={setLocked}/> : <div className="fatal-error"><h1>Book not found or access not granted.</h1><p>This address does not identify a book in your local collection.</p><button className="button primary" onClick={() => navigate('/library')}>Back to library</button></div>;
    }
    return <LibraryHome key={route} books={books} preparation={route === '/preparation'} navigate={navigate} setLocked={setLocked}/>;
}
