import { useState } from 'react';
import type { Annotation, HighlightColor } from '../types';
import { deleteAnnotation, saveAnnotation } from '../lib/db';
import { Modal } from './Modal';
import { Icon } from './Icon';
export function NoteDialog({ annotation, isNew, onClose, onSaved }: {
    annotation: Annotation;
    isNew: boolean;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [note, setNote] = useState(annotation.note), [color, setColor] = useState(annotation.color), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const save = async () => { if (annotation.kind === 'note' && !note.trim()) {
        setError('Write a note before saving.');
        return;
    } setBusy(true); try {
        await saveAnnotation({ ...annotation, note: note.trim(), color });
        onSaved();
        onClose();
    }
    catch (e) {
        setError(String(e));
        setBusy(false);
    } };
    return <Modal title={isNew ? 'Save a reflection' : 'Your saved passage'} onClose={onClose} locked={busy}>
    {annotation.anchor && <blockquote className="selected-quote">{annotation.anchor.quote}</blockquote>}{annotation.kind === 'region' && <p className="notice">This note is attached to the area marked on the original scan.</p>}
    <label>Personal note<textarea rows={6} value={note} onChange={e => setNote(e.target.value)} placeholder="What would you like to remember?" autoFocus/></label>
    {annotation.kind !== 'note' && <div className="color-picker"><span>Highlight color</span>{(['gold', 'green', 'blue', 'rose'] as HighlightColor[]).map(c => <button key={c} className={`color-dot ${c} ${color === c ? 'selected' : ''}`} aria-label={`${c} highlight`} aria-pressed={color === c} onClick={() => setColor(c)}>{color === c && <Icon name="check" size={14}/>}</button>)}</div>}
    {error && <p className="error-list" role="alert">{error}</p>}<div className="modal-footer">{!isNew ? <button className="button danger-text" disabled={busy} onClick={async () => { if (!confirm('Delete this saved note or highlight?'))
        return; setBusy(true); try {
        await deleteAnnotation(annotation.id);
        onClose();
    }
    catch (e) {
        setError(String(e));
        setBusy(false);
    } }}><Icon name="trash" size={16}/> Delete</button> : <span />}<div className="button-row"><button className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy} onClick={save}>Save {annotation.kind === 'note' ? 'note' : 'highlight'}</button></div></div>
  </Modal>;
}
