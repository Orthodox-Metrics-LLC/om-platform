import { useRef, useState } from 'react';
import type { BookPage, LibraryState } from '../types';
import { updatePageText } from '../lib/db';
import { validCrop, now } from '../lib/text';
import { isApproved } from '../lib/review';
import { Modal } from './Modal';
import { Icon } from './Icon';
export function PageEditor({ page, state, onClose, onSaved }: {
    page: BookPage;
    state: LibraryState;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [draft, setDraft] = useState(page), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [individuallyChecked, setIndividuallyChecked] = useState(isApproved(page) && page.review?.method !== 'bulk');
    const txt = useRef<HTMLInputElement>(null);
    const patch = (value: Partial<BookPage>) => setDraft(p => ({ ...p, ...value }));
    const save = async () => {
        if (!draft.title.trim()) {
            setError('Give this page a title.');
            return;
        }
        if (!validCrop(draft.crop)) {
            setError('The crop must fit inside the original image. Left + width and top + height cannot exceed 100%.');
            return;
        }
        if (draft.dateKey && !/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(draft.dateKey)) {
            setError('Use MM-DD for the printed date, or leave it empty.');
            return;
        }
        if (draft.dateKey) {
            const [m, d] = draft.dateKey.split('-').map(Number);
            if (d > new Date(2000, m, 0).getDate()) {
                setError('That day is not valid for the selected month.');
                return;
            }
        }
        setBusy(true);
        setError('');
        try {
            const changed = draft.text !== page.text, cropChanged = JSON.stringify(draft.crop) !== JSON.stringify(page.crop) || draft.rotation !== page.rotation;
            // A metadata-only save can preserve bulk acceptance. Text/crop changes cannot.
            const keepBulk = !changed && !cropChanged && !individuallyChecked && isApproved(page) && page.review?.method === 'bulk';
            const reviewed = !cropChanged && Boolean(individuallyChecked || keepBulk) && Boolean(draft.text.trim());
            const nextReview = reviewed ? { method: individuallyChecked ? 'individual' as const : 'bulk' as const,
                at: individuallyChecked ? now() : page.review!.at,
                ...(keepBulk ? { batchId: page.review!.batchId } : {}),
                textVersion: page.textVersion + 1, cropVersion: page.cropVersion } : undefined;
            await updatePageText(page, draft.text, state.annotations, { ...draft, ...(draft.dateKey !== page.dateKey ? {manualDate:draft.dateKey,dateIndex:undefined} : {}), words: changed || cropChanged ? [] : page.words, textSource: changed ? 'manual' : page.textSource, confidence: changed ? undefined : page.confidence, cropVersion: cropChanged ? page.cropVersion + 1 : page.cropVersion, reviewed, review: nextReview, ocrError: changed || reviewed ? undefined : page.ocrError });
            onSaved();
            onClose();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    };
    return <Modal title="Review this page" description="Correct the reading text without changing the original scan." onClose={onClose} wide locked={busy}>
    <div className="editor-grid"><div><div className="form-grid"><label>Page title<input value={draft.title} onChange={e => patch({ title: e.target.value })}/></label><label>Printed date (MM-DD)<input placeholder="01-01" value={draft.dateKey} onChange={e => patch({ dateKey: e.target.value })}/></label><label className="span-two">Saint / page description<input value={draft.detail} onChange={e => patch({ detail: e.target.value })}/></label><label>Weekday as printed<input value={draft.weekday} onChange={e => patch({ weekday: e.target.value })}/></label><label>Fasting label as printed<input value={draft.fasting} onChange={e => patch({ fasting: e.target.value })}/></label><label className="span-two">Feast title<input value={draft.feast} onChange={e => patch({ feast: e.target.value })}/></label><label className="span-two">Scripture references<input value={draft.readings} onChange={e => patch({ readings: e.target.value })}/></label></div>
    <details className="crop-settings"><summary>Adjust crop & orientation</summary><p className="field-help">Percentages of the original spread. Crop changes detach existing area marks and clear word-location mapping; review or rerun OCR afterward.</p><div className="form-grid">{(['x', 'y', 'w', 'h'] as const).map((key, i) => <label key={key}>{['Left', 'Top', 'Width', 'Height'][i]} (%)<input type="number" min={0} max={100} step={.1} value={Number((draft.crop[key] * 100).toFixed(2))} onChange={e => patch({ crop: { ...draft.crop, [key]: Number(e.target.value) / 100 } })}/></label>)}<label>Rotate<select value={draft.rotation} onChange={e => patch({ rotation: Number(e.target.value) as BookPage['rotation'] })}>{[0, 90, 180, 270].map(n => <option key={n} value={n}>{n}°</option>)}</select></label></div></details></div>
    <div><div className="text-editor-label"><label htmlFor="page-transcription">Selectable reading text</label><button className="text-button" onClick={() => txt.current?.click()}><Icon name="upload" size={14}/> Import .txt</button></div><input ref={txt} type="file" accept=".txt,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) {
        if (f.size > 2000000) {
            setError('Text files must be under 2 MB.');
            return;
        }
        patch({ text: await f.text(), reviewed: false }); setIndividuallyChecked(false);
    } }}/><textarea id="page-transcription" className="transcription-editor" value={draft.text} onChange={e => { patch({ text: e.target.value, reviewed: false }); setIndividuallyChecked(false); }} placeholder="Paste a transcription, or run OCR first. Separate paragraphs with a blank line."/>
    <p className="field-help">Saved highlights are reattached when their exact wording can be located unambiguously. Unmatched passages remain in your notebook and are flagged for review.</p><label className="checkbox-label"><input type="checkbox" checked={individuallyChecked} disabled={!draft.text.trim()} onChange={e => { setIndividuallyChecked(e.target.checked); patch({ reviewed: e.target.checked }); }}/> I have checked this text against the original scan (optional).</label><p className="field-help">{page.review?.method === 'bulk' && isApproved(page) ? 'This page was bulk approved; the individual-proofreading box is intentionally unchecked. ' : ''}Use Bulk approve in the reader toolbar to accept the whole book at once. Individual proofreading is not required to use it.</p></div></div>
    {error && <p role="alert" className="error-list">{error}</p>}<div className="modal-footer"><p>Transcription is not theological or historical verification. Labels remain as printed.</p><div className="button-row"><button className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy} onClick={save}><Icon name="check" size={17}/> Save page</button></div></div>
  </Modal>;
}
