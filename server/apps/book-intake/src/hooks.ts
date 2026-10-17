import { useEffect, useState } from 'react';
import type { BookPage, LibraryState } from './types';
import { changeEvent, initialize, readLibrary, getDatabaseName } from './lib/db';
import { renderPage } from './lib/images';
export function useLibrary() {
    const [state, setState] = useState<LibraryState | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true, sequence = 0;
        const database = getDatabaseName();
        const load = async () => { const run = ++sequence; try {
            const s = await readLibrary(database);
            if (active && run === sequence)
                setState(s);
        }
        catch (e) {
            if (active)
                setError(String(e));
        } };
        initialize(database).then(load).catch(e => setError(e instanceof Error ? e.message : String(e)));
        changeEvent.addEventListener('change', load);
        return () => { active = false; changeEvent.removeEventListener('change', load); };
    }, []);
    return { state, error };
}
export function usePageImage(page: BookPage | undefined, maxEdge = 2600, enabled = true) {
    const [image, setImage] = useState<{
        url: string;
        width: number;
        height: number;
    } | null>(null);
    const [error, setError] = useState('');
    const signature = page ? `${page.id}:${JSON.stringify(page.crop)}:${page.rotation}` : '';
    useEffect(() => {
        if (!page || !enabled) {
            setImage(null);
            return;
        }
        let active = true, url = '';
        setImage(null);
        setError('');
        renderPage(page, maxEdge).then(result => { url = URL.createObjectURL(result.blob); if (active)
            setImage({ url, width: result.width, height: result.height });
        else
            URL.revokeObjectURL(url); }).catch(e => active && setError(e instanceof Error ? e.message : String(e)));
        return () => { active = false; if (url)
            URL.revokeObjectURL(url); };
    }, [signature, maxEdge, enabled]);
    return { image, error };
}
