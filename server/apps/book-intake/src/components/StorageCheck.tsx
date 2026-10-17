import { useState } from 'react';
import { inspectBookStorage, type StoredDatabase } from '../lib/storageInspection';

export function StorageCheck() {
    const [results, setResults] = useState<StoredDatabase[] | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const inspect = async () => {
        setBusy(true); setError('');
        try { setResults(await inspectBookStorage()); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
    };
    return <details className="storage-check"><summary>Check saved book storage</summary>
        <p>This checks saved book records and page counts in this browser at <strong>{location.origin}</strong>. It does not import, delete or modify books.</p>
        <button className="button secondary" disabled={busy} onClick={() => void inspect()}>{busy ? 'Checking…' : 'Check this browser'}</button>
        {error && <p role="alert" className="error-list">{error}</p>}
        {results && <div role="status" className="storage-check-results">
            <p>{results.length} OM database{results.length === 1 ? '' : 's'} found. {results.reduce((n,db) => n + (db.pages || 0),0)} pages stored.</p>
            <ul>{results.map(db => <li key={db.name}>
                <strong>{db.title || (db.catalog ? 'Book catalog' : db.name)}</strong>
                {db.pages !== undefined && <span>{db.pages} pages · {db.sources || 0} source scans</span>}
                {db.catalog && <><span>{db.catalog.length} catalog record{db.catalog.length === 1 ? '' : 's'}</span>
                    <ul>{db.catalog.map((book,i) => <li key={i}>{book.title} · {book.pages} pages · {book.purged ? 'Purged' : book.sample ? 'Bundled sample' : book.abandoned ? 'Abandoned (saved)' : book.status === 'published' ? 'Ready to read' : 'In preparation'}</li>)}</ul></>}
                {db.error && <span>{db.error}</span>}
            </li>)}</ul>
        </div>}
    </details>;
}
