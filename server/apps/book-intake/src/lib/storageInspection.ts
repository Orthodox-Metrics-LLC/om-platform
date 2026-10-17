export interface StoredDatabase {
    name: string;
    title?: string;
    pages?: number;
    sources?: number;
    catalog?: { title: string; status: string; pages: number; sample: boolean; abandoned: boolean; purged: boolean }[];
    error?: string;
}

/** Inspect existing OM stores without creating databases, initializing samples or changing records. */
export async function inspectBookStorage(): Promise<StoredDatabase[]> {
    if (!indexedDB.databases) throw new Error('This browser cannot list its saved databases.');
    const entries = await indexedDB.databases();
    const results: StoredDatabase[] = [];
    for (const entry of entries) {
        if (!entry.name?.startsWith('om-')) continue;
        const result: StoredDatabase = { name: entry.name };
        let db: IDBDatabase | undefined;
        try {
            db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open(entry.name!);
                request.onupgradeneeded = () => request.transaction?.abort();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(new Error('Close other book tabs and try again.'));
            });
            const read = <T>(store: string, action: (store: IDBObjectStore) => IDBRequest<T>) => new Promise<T>((resolve, reject) => {
                const request = action(db!.transaction(store, 'readonly').objectStore(store));
                request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            if (db.objectStoreNames.contains('pages')) result.pages = await read('pages', store => store.count());
            if (db.objectStoreNames.contains('sources')) result.sources = await read('sources', store => store.count());
            if (db.objectStoreNames.contains('settings')) {
                const book = await read('settings', store => store.get('book'));
                result.title = book?.value?.title;
            }
            if (db.objectStoreNames.contains('books')) {
                const records = await read('books', store => store.getAll());
                result.catalog = records.map(book => ({ title: String(book.title || 'Untitled'), status: book.status,
                    pages: Number(book.pageCount || 0), sample: !!book.sample, abandoned: !!book.abandoned, purged: !!book.purged }));
            }
        } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
        finally { db?.close(); }
        results.push(result);
    }
    return results.sort((a,b) => a.name.localeCompare(b.name));
}
