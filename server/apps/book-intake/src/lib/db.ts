import { repairPageDate, normalizeDateKey } from './dates';
import { serverStorage, remoteDB, remoteSource } from './backend';
import type { Annotation, BookInfo, BookManifest, BookPage, LibraryState, Preferences, SourceAsset } from '../types';
import { reanchor, uid, now, validCrop } from './text';
export const changeEvent = new EventTarget();
export const LEGACY_DATABASE = 'om-book-reader-v1';
let databaseName = LEGACY_DATABASE;
export const getDatabaseName = () => databaseName;
const connections = new Map<string, Promise<IDBDatabase>>();
const pendingWrites = new Set<Promise<void>>();
/** Catalog names are generated internally, never taken directly from a URL. */
export function selectDatabase(name: string) {
    if (name !== LEGACY_DATABASE && !/^om-book-data-[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid book database.');
    databaseName = name;
}
export async function waitForWrites() { while (pendingWrites.size) await Promise.allSettled([...pendingWrites]); }
export const defaultBook: BookInfo = { title: 'OM Daily Reading', subtitle: 'An Orthodox companion, one page at a time.', year: '', calendar: 'As printed in this edition' };
export const defaultPrefs: Preferences = { pageId: '', view: 'read', theme: 'paper', fontSize: 19, readingLayout: 'continuous', autoMarkRead: true, autoOpenToday: false, narrationEngine: 'browser', narrationPreset: 'us-female', narrationRate: 0.95, narrationFollow: true, narrationCloudConsent: false };
export function openDB(name = databaseName): Promise<IDBDatabase> {
    if (serverStorage()) return remoteDB(name);
    let connection = connections.get(name);
    if (!connection) {
        connection = new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('This browser does not support local book storage.')); return; }
            const req = indexedDB.open(name, 1);
            req.onupgradeneeded = () => { for (const store of ['pages', 'sources', 'annotations', 'bookmarks', 'settings'])
                req.result.createObjectStore(store, { keyPath: 'id' }); };
            req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); connections.delete(name); }; resolve(req.result); };
            req.onerror = () => { connections.delete(name); reject(req.error); };
            req.onblocked = () => reject(new Error('Close other reader tabs and reload to update local storage.'));
        });
        connections.set(name, connection);
    }
    return connection;
}
function request<T>(req: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
export async function getAll<T>(store: string, name = databaseName): Promise<T[]> { const db = await openDB(name); return request(db.transaction(store).objectStore(store).getAll()); }
export async function getSource(id: string): Promise<SourceAsset> { if(serverStorage())return remoteSource(databaseName,id); const db = await openDB(); const result = await request(db.transaction('sources').objectStore('sources').get(id)); if (!result)
    throw new Error('The original scan is missing. Restore a complete book backup.'); return result; }
export function commit(stores: string[], job: (tx: IDBTransaction) => void, name = databaseName): Promise<void> {
    const operation = (async () => {
        const db = await openDB(name);
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(stores, 'readwrite');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Local save failed.'));
            tx.onabort = () => reject(tx.error || new Error('Save was cancelled.'));
            try { job(tx); } catch (e) { tx.abort(); reject(e); }
        });
        changeEvent.dispatchEvent(new Event('change'));
    })();
    pendingWrites.add(operation);
    void operation.then(() => pendingWrites.delete(operation), () => pendingWrites.delete(operation));
    return operation;
}
export async function readLibrary(name = databaseName): Promise<LibraryState> {
    if(serverStorage()) {
        const db=await openDB(name),tx=db.transaction(['pages','annotations','bookmarks','settings']);
        const [pages,annotations,bookmarks,settings]=await Promise.all([request(tx.objectStore('pages').getAll()),request(tx.objectStore('annotations').getAll()),request(tx.objectStore('bookmarks').getAll()),request(tx.objectStore('settings').getAll())]);
        return {pages:pages.sort((a:BookPage,b:BookPage)=>a.order-b.order),annotations,bookmarks,publication:settings.find(s=>s.id==='publication')?.value||{status:'draft'},book:settings.find(s=>s.id==='book')?.value||defaultBook,prefs:{...defaultPrefs,...settings.find(s=>s.id==='prefs')?.value}};
    }
    const [pages, annotations, bookmarks, settings] = await Promise.all([getAll<BookPage>('pages', name), getAll<Annotation>('annotations', name), getAll<LibraryState['bookmarks'][number]>('bookmarks', name), getAll<{
            id: string;
            value: unknown;
        }>('settings', name)]);
    return { publication: (settings.find(s => s.id === 'publication')?.value as LibraryState['publication']) || { status: 'draft' }, pages: pages.sort((a, b) => a.order - b.order), annotations, bookmarks, book: (settings.find(s => s.id === 'book')?.value as BookInfo) || defaultBook, prefs: { ...defaultPrefs, ...(settings.find(s => s.id === 'prefs')?.value as Preferences) } };
}
export async function savePage(page: BookPage) { await commit(['pages'], tx => tx.objectStore('pages').put(page)); }
export async function saveSetting(id: string, value: unknown) { await commit(['settings'], tx => tx.objectStore('settings').put({ id, value })); }
export async function saveAnnotation(annotation: Annotation) { await commit(['annotations'], tx => tx.objectStore('annotations').put(annotation)); }
export async function deleteAnnotation(id: string) { await commit(['annotations'], tx => tx.objectStore('annotations').delete(id)); }
export async function toggleBookmark(pageId: string, current: LibraryState['bookmarks']) { const found = current.find(b => b.pageId === pageId); await commit(['bookmarks'], tx => { if (found)
    tx.objectStore('bookmarks').delete(found.id);
else
    tx.objectStore('bookmarks').put({ id: uid(), pageId, createdAt: now() }); }); }
export async function updatePageText(page: BookPage, text: string, items: Annotation[], extra: Partial<BookPage> = {}) {
    const updated = { ...page, ...extra, text, textVersion: page.textVersion + 1 };
    await commit(['pages', 'annotations'], tx => {
        tx.objectStore('pages').put(updated);
        for (const item of items.filter(a => a.pageId === page.id && a.anchor))
            tx.objectStore('annotations').put({ ...item, anchor: reanchor(item.anchor!, text) });
    });
}
export async function removePage(page: BookPage, all: LibraryState) {
    await commit(['pages', 'annotations', 'bookmarks', 'sources'], tx => {
        tx.objectStore('pages').delete(page.id);
        for (const a of all.annotations.filter(a => a.pageId === page.id))
            tx.objectStore('annotations').delete(a.id);
        for (const b of all.bookmarks.filter(b => b.pageId === page.id))
            tx.objectStore('bookmarks').delete(b.id);
        if (!all.pages.some(p => p.id !== page.id && p.sourceId === page.sourceId))
            tx.objectStore('sources').delete(page.sourceId);
    });
}
export async function resetLibrary() { await commit(['pages', 'sources', 'annotations', 'bookmarks', 'settings'], tx => { for (const s of ['pages', 'sources', 'annotations', 'bookmarks'])
    tx.objectStore(s).clear(); tx.objectStore('settings').put({ id: 'initialized', value: true }); tx.objectStore('settings').put({ id: 'prefs', value: defaultPrefs }); tx.objectStore('settings').put({ id: 'publication', value: { status: 'draft' } }); }); }
export async function initialize(name = databaseName) {
    if(serverStorage())return;
    const settings = await getAll<{
        id: string;
    }>('settings', name);
    if (settings.some(s => s.id === 'initialized'))
        return;
    // Existing content is authoritative, even when an older import omitted initialized.
    if ((await getAll<BookPage>('pages', name)).length) {
        await commit(['settings'], tx => tx.objectStore('settings').put({ id: 'initialized', value: true }), name);
        return;
    }
    if (name !== LEGACY_DATABASE) {
        await commit(['settings'], tx => tx.objectStore('settings').put({ id: 'initialized', value: true }), name);
        return;
    }
    const response = await fetch(new URL('book/manifest.json', document.baseURI));
    if (!response.ok)
        throw new Error('The sample book could not be loaded. Serve the project over localhost, rather than opening index.html directly.');
    const manifest = validateManifest(await response.json());
    const sources: SourceAsset[] = [];
    for (const source of manifest.sources) {
        const r = await fetch(new URL(`book/sources/${source.id}`, document.baseURI));
        if (!r.ok)
            throw new Error(`Missing source image: ${source.name}`);
        sources.push({ ...source, blob: await r.blob() });
    }
    await replaceLibrary(manifest, sources, name);
}
export async function replaceLibrary(manifest: BookManifest, sources: SourceAsset[], name = databaseName) {
    await commit(['pages', 'sources', 'annotations', 'bookmarks', 'settings'], tx => {
        for (const name of ['pages', 'sources', 'annotations', 'bookmarks'])
            tx.objectStore(name).clear();
        for (const page of manifest.pages)
            tx.objectStore('pages').put(repairPageDate(page));
        for (const source of sources)
            tx.objectStore('sources').put(source);
        for (const a of manifest.annotations)
            tx.objectStore('annotations').put(a);
        for (const b of manifest.bookmarks)
            tx.objectStore('bookmarks').put(b);
        tx.objectStore('settings').put({ id: 'book', value: manifest.book });
        tx.objectStore('settings').put({ id: 'prefs', value: manifest.prefs });
        tx.objectStore('settings').put({ id: 'initialized', value: true });
        tx.objectStore('settings').delete('migration-v04');
        // Full backups retain the saved lifecycle; older archives remain drafts.
        tx.objectStore('settings').put({ id: 'publication', value: manifest.publication || { status: 'draft' } });
    }, name);
}
export function validateManifest(input: unknown): BookManifest {
    const m = input as BookManifest;
    const safeId = (s: unknown) => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(s);
    const str = (s: unknown, max = 2000000) => typeof s === 'string' && s.length <= max;
    if (!m || m.format !== 'om-book' || m.version !== 1 || !['backup', 'publication'].includes(m.kind) || !Array.isArray(m.pages) || !Array.isArray(m.sources) || !Array.isArray(m.annotations) || !Array.isArray(m.bookmarks) || m.pages.length > 2000)
        throw new Error('Not a supported OM book file (format version 1).');
    if (!m.book || !['title', 'subtitle', 'year', 'calendar'].every(k => str((m.book as unknown as Record<string, unknown>)[k], 1000)))
        throw new Error('Invalid book details.');
    if ((m.book.author !== undefined && !str(m.book.author, 1000)) || (m.book.coverPageId !== undefined && !safeId(m.book.coverPageId)))
        throw new Error('Invalid optional book metadata.');
    if (m.publication !== undefined && (!m.publication || !['draft','published'].includes(m.publication.status) ||
        (m.publication.publishedAt !== undefined && (!str(m.publication.publishedAt,100) || !Number.isFinite(Date.parse(m.publication.publishedAt)))) ||
        (m.publication.acceptedExceptions !== undefined && (!Number.isInteger(m.publication.acceptedExceptions) || m.publication.acceptedExceptions < 0))))
        throw new Error('Invalid publication metadata.');
    const sources = new Set<string>();
    for (const s of m.sources) {
        if (!safeId(s.id) || sources.has(s.id) || !str(s.name, 1000) || !['image/jpeg', 'image/png', 'image/webp'].includes(s.mime) || !Number.isFinite(s.width) || !Number.isFinite(s.height) || s.width <= 0 || s.height <= 0)
            throw new Error('Invalid source image metadata.');
        sources.add(s.id);
    }
    const pages = new Set<string>();
    for (const p of m.pages) {
        if (!safeId(p.id) || pages.has(p.id) || !sources.has(p.sourceId) || !p.crop || !validCrop(p.crop) || ![0, 90, 180, 270].includes(p.rotation) || !Number.isFinite(p.order) || !Number.isInteger(p.textVersion) || !Number.isInteger(p.cropVersion) || typeof p.reviewed !== 'boolean' || typeof p.read !== 'boolean' || !['none', 'sample-transcription', 'ocr', 'manual'].includes(p.textSource) || !Array.isArray(p.words) || !['title', 'detail', 'dateKey', 'weekday', 'feast', 'fasting', 'readings', 'sourceName', 'text', 'createdAt'].every(k => str((p as unknown as Record<string, unknown>)[k])))
            throw new Error('Invalid page data.');
        if (p.review !== undefined && (!p.review || !['individual', 'bulk'].includes(p.review.method) ||
            !str(p.review.at, 100) || !Number.isFinite(Date.parse(p.review.at)) ||
            !Number.isInteger(p.review.textVersion) || p.review.textVersion < 0 ||
            !Number.isInteger(p.review.cropVersion) || p.review.cropVersion < 0 ||
            (p.review.method === 'bulk' && !safeId(p.review.batchId))))
            throw new Error('Invalid page review metadata.');
        if(p.manualDate !== undefined && (!str(p.manualDate,10) || (p.manualDate !== '' && !normalizeDateKey(p.manualDate)))) throw new Error('Invalid manual printed date.');
        if(p.dateIndex !== undefined && (!p.dateIndex || p.dateIndex.version !== 4 ||
            !['resolved','unverified','unresolved','undated','conflict'].includes(p.dateIndex.status) ||
            !['manual','metadata','text-header','layout-header','header-ocr'].includes(p.dateIndex.source) ||
            !str(p.dateIndex.key,10) || (p.dateIndex.key !== '' && !normalizeDateKey(p.dateIndex.key)) ||
            !str(p.dateIndex.evidence,2000) || !Number.isInteger(p.dateIndex.textVersion) || !Number.isInteger(p.dateIndex.cropVersion))) throw new Error('Invalid printed date index.');
        if (p.ocrError !== undefined && !str(p.ocrError, 2000)) throw new Error('Invalid OCR error metadata.');
        for (const w of p.words)
            if (!str(w.text) || !Number.isInteger(w.start) || !Number.isInteger(w.end) || w.start < 0 || w.end < w.start || w.end > p.text.length || ![w.x, w.y, w.w, w.h].every(Number.isFinite) || w.x < 0 || w.y < 0 || w.w < 0 || w.h < 0 || w.x + w.w > 1.001 || w.y + w.h > 1.001)
                throw new Error('Invalid OCR word positions.');
        pages.add(p.id);
    }
    const annotationIds = new Set<string>();
    for (const a of m.annotations) {
        if (!safeId(a.id) || annotationIds.has(a.id) || !pages.has(a.pageId) || !['text', 'region', 'note'].includes(a.kind) || !['gold', 'green', 'blue', 'rose'].includes(a.color) || !str(a.note) || !str(a.createdAt))
            throw new Error('Invalid annotation.');
        if (a.kind === 'text' && (!a.anchor || !Number.isInteger(a.anchor.start) || !Number.isInteger(a.anchor.end) || a.anchor.start < 0 || a.anchor.end <= a.anchor.start || !str(a.anchor.quote) || !str(a.anchor.prefix) || !str(a.anchor.suffix)))
            throw new Error('Invalid text highlight.');
        if (a.kind === 'region' && (!a.rect || ![a.rect.x, a.rect.y, a.rect.w, a.rect.h].every(Number.isFinite) || a.rect.x < 0 || a.rect.y < 0 || a.rect.w <= 0 || a.rect.h <= 0 || a.rect.x + a.rect.w > 1.001 || a.rect.y + a.rect.h > 1.001 || !Number.isInteger(a.cropVersion)))
            throw new Error('Invalid scan highlight.');
        annotationIds.add(a.id);
    }
    const bookmarkIds = new Set<string>();
    for (const b of m.bookmarks) {
        if (!safeId(b.id) || bookmarkIds.has(b.id) || !pages.has(b.pageId) || !str(b.createdAt))
            throw new Error('Invalid bookmark.');
        bookmarkIds.add(b.id);
    }
    if (!m.prefs || !str(m.prefs.pageId, 128) || !['read', 'scan', 'compare'].includes(m.prefs.view) || !['paper', 'light', 'dark'].includes(m.prefs.theme) || !Number.isFinite(m.prefs.fontSize) || m.prefs.fontSize < 15 || m.prefs.fontSize > 27)
        throw new Error('Invalid reader preferences.');
    // Optional v0.3 preferences keep old backups compatible without trusting malformed settings.
    const pref = m.prefs;
    if (pref.readingLayout !== undefined && !['single','spread','continuous'].includes(pref.readingLayout)) throw new Error('Invalid reading layout.');
    for (const k of ['autoMarkRead','autoOpenToday','narrationFollow','narrationCloudConsent'] as const)
        if (pref[k] !== undefined && typeof pref[k] !== 'boolean') throw new Error('Invalid reader automation preference.');
    if (pref.narrationEngine !== undefined && !['browser','azure'].includes(pref.narrationEngine)) throw new Error('Invalid narration engine.');
    if (pref.narrationPreset !== undefined && !['us-female','us-male','uk-female','uk-male'].includes(pref.narrationPreset)) throw new Error('Invalid narrator.');
    if (pref.narrationVoiceURI !== undefined && !str(pref.narrationVoiceURI, 2000)) throw new Error('Invalid speech voice.');
    if (pref.narrationRate !== undefined && (!Number.isFinite(pref.narrationRate) || pref.narrationRate < .65 || pref.narrationRate > 1.5)) throw new Error('Invalid narration speed.');
    return m;
}

/** Patch progress against the current record; never replace text with a stale reader snapshot. */
export async function setPageRead(id: string, read: boolean) {
    await commit(['pages'], tx => { const store = tx.objectStore('pages'); const req = store.get(id);
        req.onsuccess = () => { if (req.result) store.put({ ...req.result, read }); }; });
}
export async function patchPreferences(patch: Partial<Preferences>) {
    await commit(['settings'], tx => { const store = tx.objectStore('settings'); const req = store.get('prefs');
        req.onsuccess = () => store.put({ id: 'prefs', value: { ...defaultPrefs, ...req.result?.value, ...patch } }); });
}

/** Atomic spread progress update. Only the read flag is changed on the latest page records. */
export async function setPagesRead(ids: string[], read: boolean) {
    await commit(['pages'], tx => {
        const store = tx.objectStore('pages');
        for (const id of new Set(ids)) {
            const request = store.get(id);
            request.onsuccess = () => { if (request.result) store.put({ ...request.result, read }); };
        }
    });
}
