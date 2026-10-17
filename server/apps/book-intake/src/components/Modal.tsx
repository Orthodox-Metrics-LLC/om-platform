import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
export function Modal({ title, description, children, onClose, wide = false, locked = false }: {
    title: string;
    description?: string;
    children: ReactNode;
    onClose: () => void;
    wide?: boolean;
    locked?: boolean;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => { ref.current?.showModal(); const d = ref.current; return () => d?.close(); }, []);
    return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={e => { e.preventDefault(); if (!locked)
        onClose(); }} onClick={e => { if (e.target === e.currentTarget && !locked)
        onClose(); }}>
    <div className="modal-head"><div><span className="eyebrow">YOUR BOOK, YOUR SPACE</span><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={locked}><Icon name="close"/></button></div>
    <div className="modal-content">{children}</div>
  </dialog>;
}
