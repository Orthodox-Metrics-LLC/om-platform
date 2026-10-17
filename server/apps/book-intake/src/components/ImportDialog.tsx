import { useEffect, useRef, useState } from 'react';
import type { BookPage, LibraryState, SourceAsset } from '../types';
import { commit, getAll } from '../lib/db';
import { assetFromFile } from '../lib/images';
import { now, splitCrops, uid } from '../lib/text';
import { formatBytes, IMPORT_LIMITS_LABEL } from '../lib/limits';
import { Icon } from './Icon';
import { Modal } from './Modal';
export function ImportDialog({ state, onClose, onDone }: {
    state: LibraryState;
    onClose: () => void;
    onDone: (message: string) => void;
}) {
    const [files, setFiles] = useState<File[]>([]), [layout, setLayout] = useState('auto'), [split, setSplit] = useState(50), [gutter, setGutter] = useState(10), [url, setUrl] = useState(''), [index, setIndex] = useState(0), [dimensions, setDimensions] = useState({ w: 0, h: 0 });
    const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [message, setMessage] = useState(''), [errors, setErrors] = useState<string[]>([]), [done, setDone] = useState(false);
    const input = useRef<HTMLInputElement>(null), folder = useRef<HTMLInputElement>(null), cancel = useRef(false);
    useEffect(() => folder.current?.setAttribute('webkitdirectory', ''), []);
    useEffect(() => { if (!files[index]) {
        setUrl('');
        return;
    } const u = URL.createObjectURL(files[index]); setUrl(u); return () => URL.revokeObjectURL(u); }, [files, index]);
    const pick = (list: File[]) => { const sorted = list.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true, sensitivity: 'base' })); setFiles(sorted); setIndex(0); setErrors([]); setDone(false); };
    const previewSplit = layout === 'spread' || (layout === 'auto' && dimensions.w > dimensions.h * 1.1);
    const importFiles = async () => {
        setBusy(true);
        setErrors([]);
        cancel.current = false;
        let added = 0, skipped = 0;
        const problems: string[] = [];
        try {
            const assets = await getAll<SourceAsset>('sources');
            const existing = new Set(assets.map(a => a.id));
            let order = Math.max(-1, ...state.pages.map(p => p.order)) + 1;
            for (let i = 0; i < files.length; i++) {
                if (cancel.current)
                    break;
                setMessage(`${i + 1} of ${files.length} · ${files[i].name}`);
                setProgress(i / files.length * 100);
                try {
                    const source = await assetFromFile(files[i]);
                    if (existing.has(source.id)) {
                        skipped++;
                        continue;
                    }
                    const spread = layout === 'spread' || (layout === 'auto' && source.width > source.height * 1.1);
                    const crops = spread ? splitCrops(split / 100, gutter / 100) : [{ x: 0, y: 0, w: 1, h: 1 }];
                    const pages: BookPage[] = crops.map((crop, j) => ({ id: uid(), sourceId: source.id, sourceName: source.name, order: order++, title: source.name.replace(/\.[^.]+$/, '') + (spread ? j === 0 ? ' · left' : ' · right' : ''), detail: '', dateKey: '', weekday: '', feast: '', fasting: '', readings: '', crop, rotation: 0, cropVersion: 1, text: '', textVersion: 0, textSource: 'none', reviewed: false, words: [], read: false, createdAt: now() }));
                    await commit(['sources', 'pages'], tx => { tx.objectStore('sources').put(source); for (const p of pages)
                        tx.objectStore('pages').put(p); });
                    existing.add(source.id);
                    added += pages.length;
                }
                catch (e) {
                    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
                        problems.push('Browser storage is full. Import stopped safely; already-saved pages remain. Keep your source folder and export a backup before changing browser storage.');
                        cancel.current = true;
                        break;
                    }
                    problems.push(e instanceof Error ? e.message : String(e));
                }
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            setProgress(100);
            setDone(true);
            const summary = `${added} pages imported${skipped ? ` · ${skipped} duplicate scans skipped` : ''}${cancel.current ? ' · Stopped safely' : ''}${problems.length ? ` · ${problems.length} files need attention` : ''}. Run “Process pending pages” to create searchable text.`;
            setMessage(summary);
            setErrors(problems);
            onDone(summary);
        }
        catch (e) {
            setErrors([e instanceof Error ? e.message : String(e)]);
        }
        finally {
            setBusy(false);
        }
    };
    return <Modal title="Bring your book to life." description="Import the originals. We’ll keep them intact and give each page its own place." onClose={onClose} wide locked={busy}>
    <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" hidden onChange={e => pick(Array.from(e.target.files || []))}/><input ref={folder} type="file" multiple hidden onChange={e => pick(Array.from(e.target.files || []).filter(f => /\.(jpe?g|png|webp)$/i.test(f.name)))}/>
    <div className="import-grid"><div><div className="drop-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy)
        pick(Array.from(e.dataTransfer.files)); }}><div className="drop-icon"><Icon name="upload" size={28}/></div><h3>{files.length ? `${files.length} scans selected · ${formatBytes(files.reduce((n, f) => n + f.size, 0))}` : 'Your next chapter starts here.'}</h3><p>Drop JPEG, PNG, or WebP images here.<br />Filenames are sorted naturally: 1, 2, 3…</p><div className="button-row"><button className="button primary" disabled={busy} onClick={() => input.current?.click()}>Choose images</button><button className="button secondary" disabled={busy} onClick={() => folder.current?.click()}>Choose folder</button></div></div>
    <div className="import-options"><label>Scan layout<select disabled={busy} value={layout} onChange={e => setLayout(e.target.value)}><option value="auto">Auto: split landscape scans</option><option value="spread">Two-page spreads (left, then right)</option><option value="single">One page per image</option></select></label>{layout !== 'single' && <><label>Binding position <strong>{split}%</strong><input disabled={busy} type="range" min="30" max="70" value={split} onChange={e => setSplit(Number(e.target.value))}/></label><label>Binding area to exclude <strong>{gutter}%</strong><input disabled={busy} type="range" min="0" max="20" value={gutter} onChange={e => setGutter(Number(e.target.value))}/></label></>}<p className="field-help">These settings apply to this batch. Check the guide against your binding before import; each page’s crop can be adjusted later. Originals are never overwritten.</p></div></div>
    <div className="import-preview"><span className="eyebrow">SPLIT PREVIEW</span>{url ? <><div className="split-preview-image"><img src={url} alt="Selected scan with binding guide" onLoad={e => setDimensions({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}/>{previewSplit && <div className="gutter-guide" style={{ left: `${split - gutter / 2}%`, width: `${gutter}%` }}><span>Binding</span></div>}</div><label className="preview-file-label">Inspect scan<select value={index} onChange={e => setIndex(Number(e.target.value))}>{files.map((f, i) => <option key={`${i}-${f.name}`} value={i}>{f.name}</option>)}</select></label><p className="field-help">{previewSplit ? 'This image will become two logical pages.' : 'This image will remain one logical page.'}</p></> : <div className="no-preview"><Icon name="compare" size={50}/><p>Your scan and binding guides will appear here.</p></div>}<div className="notice subtle"><Icon name="lock" size={16}/><p>Your images are saved in this installation’s managed library. Import does not send them to LlamaCloud or run OCR automatically.</p></div></div></div>
    {(busy || done) && <div className="import-progress"><progress max={100} value={progress}/><p role="status">{message}</p></div>}{errors.length > 0 && <div className="error-list" role="alert">{errors.map((e, i) => <p key={i}>{e}</p>)}</div>}
    <div className="modal-footer"><p>{IMPORT_LIMITS_LABEL}</p><div className="button-row">{busy ? <button className="button secondary" onClick={() => { cancel.current = true; setMessage('Stopping after this image…'); }}>Stop safely</button> : <><button className="button secondary" onClick={onClose}>{done ? 'Done' : 'Cancel'}</button><button className="button primary" disabled={!files.length || done} onClick={importFiles}><Icon name="upload" size={17}/> Import {files.length || ''} scans</button></>}</div></div>
  </Modal>;
}
