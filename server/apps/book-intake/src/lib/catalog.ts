import { migrateV04 } from './dateMaintenance';
import type { LibraryState } from '../types';
import { defaultBook, defaultPrefs, LEGACY_DATABASE, openDB, readLibrary, commit, getAll } from './db';
import { now, uid } from './text';
import { isApproved } from './review';
import { api, serverStorage } from './backend';

export interface CatalogBook {
    publishedAvailable?: boolean;
    canPrepare?: boolean;
    id: string;
    database: string;
    title: string;
    subtitle: string;
    author: string;
    year: string;
    status: 'draft' | 'published';
    createdAt: string;
    updatedAt: string;
    publishedAt?: string;
    lastOpenedAt?: string;
    pageCount: number;
    searchableCount: number;
    approvedCount: number;
    readCount: number;
    bookmarkCount: number;
    annotationCount: number;
    lastPageTitle: string;
    cover?: Blob;
    migrated?: boolean;
    abandoned?: boolean;
    purged?: boolean;
    sample?: boolean;
}
const CATALOG_DATABASE = 'om-book-catalog-v1';
let catalog: Promise<IDBDatabase> | undefined;
export const catalogEvents = new EventTarget();
const broadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('om-book-catalog') : undefined;
broadcast?.addEventListener('message', () => catalogEvents.dispatchEvent(new Event('change')));
function changed() { catalogEvents.dispatchEvent(new Event('change')); broadcast?.postMessage('changed'); }
function catalogDB() {
    if (!catalog) catalog = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(CATALOG_DATABASE, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('books', { keyPath: 'id' });
        req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); catalog = undefined; }; resolve(req.result); };
        req.onerror = () => { catalog = undefined; reject(req.error); };
        req.onblocked = () => reject(new Error('Close other book tabs and reload.'));
    });
    return catalog;
}
export async function listBooks(): Promise<CatalogBook[]> {
    if(serverStorage())return api('/api/books');
    const db = await catalogDB();
    return new Promise((resolve, reject) => { const req = db.transaction('books').objectStore('books').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
export async function getCatalogBook(id: string): Promise<CatalogBook | undefined> {
    if(serverStorage())return (await listBooks()).find(b=>b.id===id);
    const db = await catalogDB();
    return new Promise((resolve, reject) => { const req = db.transaction('books').objectStore('books').get(id); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
/** Read/modify/write in one transaction so cover, progress and publication updates do not overwrite each other. */
async function patchBook(id: string, patch: Partial<CatalogBook>, initial?: CatalogBook) {
    const db = await catalogDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('books', 'readwrite'), store = tx.objectStore('books'), req = store.get(id);
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        req.onsuccess = () => { const current = req.result || initial; if (current) store.put({ ...current, ...patch, id }); };
    }); changed();
}
export function summarizeBook(state: LibraryState): Partial<CatalogBook> {
    return { sample: state.pages.length === 4 && ['opening','january-01','december-30','december-31'].every(id => state.pages.some(p => p.id === id && p.textSource === 'sample-transcription')), title: state.book.title, subtitle: state.book.subtitle, author: state.book.author || '', year: state.book.year,
        status: state.publication?.status || 'draft', publishedAt: state.publication?.publishedAt,
        pageCount: state.pages.length, searchableCount: state.pages.filter(p => p.text.trim()).length,
        approvedCount: state.pages.filter(p => isApproved(p) && !p.ocrError).length,
        readCount: state.pages.filter(p => p.read).length, bookmarkCount: state.bookmarks.length,
        annotationCount: state.annotations.length, lastPageTitle: state.pages.find(p => p.id === state.prefs.pageId)?.title || '' };
}
export async function syncCatalogBook(id: string, state: LibraryState, extra: Partial<CatalogBook> = {}) {
    if(serverStorage()){changed();return;}
    await patchBook(id, { ...summarizeBook(state), ...extra, updatedAt: now() });
}
export async function touchBook(id: string) { if(serverStorage())return; await patchBook(id, { lastOpenedAt: now() }); }
function blankRecord(id: string, database: string, title: string): CatalogBook {
    return { id, database, title, subtitle: '', author: '', year: '', status: 'draft', createdAt: now(), updatedAt: now(), pageCount: 0,
        searchableCount: 0, approvedCount: 0, readCount: 0, bookmarkCount: 0, annotationCount: 0, lastPageTitle: '' };
}
/** Register the existing database IN PLACE. No scans, page IDs, annotations or preferences are copied/cleared. */
export async function ensureCatalog() {
    if(serverStorage())return;
    if (!await getCatalogBook('legacy')) {
        const settings = await getAll<{ id: string }>('settings', LEGACY_DATABASE);
        const existing = await readLibrary(LEGACY_DATABASE);
        if (!settings.some(s => s.id === 'initialized')) {
            // A fresh collection starts empty, rather than silently importing the four-page demo.
            await commit(['settings'], tx => tx.objectStore('settings').put({id:'initialized',value:true}), LEGACY_DATABASE);
        }
        const state = await readLibrary(LEGACY_DATABASE);
        const entry = { ...blankRecord('legacy', LEGACY_DATABASE, state.book.title), ...summarizeBook(state), migrated: existing.pages.length > 0 } as CatalogBook;
        // Empty patch + transaction guard makes concurrent first opens idempotent.
        if (state.pages.length || settings.some(s => s.id === 'book')) await patchBook('legacy', {}, entry);
    }
    // Recover uncatalogued databases without loading the sample over their content.
    if (indexedDB.databases) for (const info of await indexedDB.databases()) {
        const database = info.name;
        if (!database || !/^om-book-data-[a-zA-Z0-9_-]+$/.test(database)) continue;
        const id = database.slice('om-book-data-'.length);
        if (!await getCatalogBook(id)) {
            const state = await readLibrary(database);
            await patchBook(id, {}, { ...blankRecord(id, database, state.book.title), ...summarizeBook(state), migrated: true } as CatalogBook);
        }
    }
    // Lifecycle is authoritative in each book DB; repair stale catalog snapshots after an interrupted write.
    for (const entry of await listBooks()) {
        if (entry.purged) continue;
        // A catalog publication is evidence for repairing a missing legacy lifecycle marker.
        const settings = await getAll<{id:string;value:unknown}>('settings', entry.database);
        if (entry.status === 'published' && !settings.some(s => s.id === 'publication'))
            await commit(['settings'], tx => tx.objectStore('settings').put({id:'publication',value:{status:'published',publishedAt:entry.publishedAt}}), entry.database);
        await migrateV04(entry.database);
        const state = await readLibrary(entry.database);
        await syncCatalogBook(entry.id, state);
    }
}
export async function createBook(title: string) {
    if(serverStorage()){const entry=await api<CatalogBook>('/api/books',{method:'POST',body:JSON.stringify({title})});changed();return entry;}
    if (!title.trim()) throw new Error('Enter a book title.');
    const id = uid(), database = `om-book-data-${id}`;
    await openDB(database);
    await commit(['settings'], tx => { const store = tx.objectStore('settings');
        store.put({ id: 'book', value: { ...defaultBook, title: title.trim(), subtitle: '' } });
        store.put({ id: 'prefs', value: defaultPrefs }); store.put({ id: 'initialized', value: true });
        store.put({ id: 'publication', value: { status: 'draft' } });
    }, database);
    const entry = blankRecord(id, database, title.trim());
    await patchBook(id, {}, entry); return entry;
}

/** Rename a library title without unpublishing, changing page IDs, or switching the active database. */
export async function renameLibraryBook(id: string, title: string, expectedTitle?: string) {
    if(serverStorage()){await api(`/api/books/${id}`,{method:'PATCH',body:JSON.stringify({title,expectedTitle})});changed();return;}
    const clean = title.trim();
    if (!clean || clean.length > 1000) throw new Error('Enter a title of 1–1,000 characters.');
    const book = await getCatalogBook(id);
    if (!book) throw new Error('This book is no longer in the library.');
    const db = await openDB(book.database);
    let reason: Error | undefined;
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('settings', 'readwrite'), store = tx.objectStore('settings'), req = store.get('book');
            tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(reason || tx.error);
            req.onsuccess = () => {
                const current = req.result?.value || defaultBook;
                if (expectedTitle !== undefined && current.title !== expectedTitle) { reason = new Error('The title changed in another tab. Close this dialog and try again.'); tx.abort(); return; }
                store.put({ id: 'book', value: { ...current, title: clean } });
            };
        });
    } catch (e) { throw reason || e; }
    await syncCatalogBook(id, await readLibrary(book.database));
}

/** Abandon keeps originals and personal data available for resumption. */
export async function abandonBook(id: string, abandoned = true) {
    if(serverStorage()){await api(`/api/books/${id}`,{method:'PATCH',body:JSON.stringify({abandoned})});changed();return;}
    const entry = await getCatalogBook(id);
    if (!entry || entry.purged || entry.status === 'published') throw new Error('Only an unpublished preparation can be abandoned.');
    await patchBook(id, { abandoned, updatedAt: now() });
}
/** Atomic per-book purge; a tombstone prevents the legacy sample from reappearing. */
export async function purgeBook(id: string) {
    if(serverStorage()){await api(`/api/books/${id}`,{method:'DELETE'});changed();return;}
    const entry = await getCatalogBook(id);
    if (!entry || entry.purged || entry.status === 'published') throw new Error('Only an unpublished preparation can be purged.');
    await commit(['pages','sources','annotations','bookmarks','settings'], tx => {
        for (const store of ['pages','sources','annotations','bookmarks','settings']) tx.objectStore(store).clear();
        tx.objectStore('settings').put({id:'initialized',value:true});
    }, entry.database);
    await patchBook(id, { purged: true, abandoned: true, pageCount: 0, searchableCount: 0, approvedCount: 0, annotationCount: 0, bookmarkCount: 0, readCount: 0, cover: undefined });
}
