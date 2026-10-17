import { memo, Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Annotation, BookPage, Crop, SelectionAnchor, ViewMode } from '../types';
import { makeAnchor, searchRanges } from '../lib/text';
import { readingDocument } from '../lib/readingDocument';
import { usePageImage } from '../hooks';
import { Icon } from './Icon';
function TextReaderImpl({ page, annotations, query, fontSize, onSelection, onAnnotation, readerOnly = false, spokenStart }: {
    spokenStart?: number;
    readerOnly?: boolean;
    page: BookPage;
    annotations: Annotation[];
    query: string;
    fontSize: number;
    onSelection: (s: SelectionAnchor | null) => void;
    onAnnotation: (a: Annotation) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let timeout: ReturnType<typeof setTimeout>;
        const selected = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed || !sel.rangeCount)
                    return;
                const range = sel.getRangeAt(0);
                const root = ref.current;
                if (!root?.contains(range.startContainer) || !root.contains(range.endContainer))
                    return;
                const offset = (node: Node, at: number) => { const parent = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest('[data-text-start]') as HTMLElement | null; if (!parent)
                    return null; const r = document.createRange(); r.selectNodeContents(parent); r.setEnd(node, at); return Number(parent.dataset.textStart) + r.toString().length; };
                const start = offset(range.startContainer, range.startOffset), end = offset(range.endContainer, range.endOffset);
                if (start === null || end === null || end <= start)
                    return;
                onSelection({ ...makeAnchor(page.text, start, end), pageId: page.id });
            }, 100);
        };
        document.addEventListener('selectionchange', selected);
        return () => { clearTimeout(timeout); document.removeEventListener('selectionchange', selected); };
    }, [page.id, page.text, onSelection]);
    const content = readingDocument(page);
    const hits = searchRanges(page.text, query);
    const highlights = annotations.filter(a => a.kind === 'text' && a.anchor && !a.anchor.detached);
    return <article className="reading-paper" style={{ '--reading-size': `${fontSize}px` } as CSSProperties}>
    <div className="paper-kicker"><span>{content.weekday || 'FROM THE BOOK'}</span>{content.fasting && <span className="fasting"><span /> {content.fasting}</span>}</div>
    <h1>{content.title}</h1>{content.feast && <div className="feast-title">{content.feast}</div>}
    {content.readings && <div className="reading-references"><Icon name="book" size={15}/>{content.readings}</div>}
    <div className="paper-rule"><span>✦</span></div>
    {page.text ? <div ref={ref} className="book-text" data-testid="book-text">
      {content.parts.map((part) => {
                const marks = highlights.filter(a => a.anchor!.start < part.end && a.anchor!.end > part.start);
                const ranges = hits.filter(h => h.start < part.end && h.end > part.start);
                const cuts = [...new Set([part.start, part.end, ...marks.flatMap(a => [Math.max(part.start, a.anchor!.start), Math.min(part.end, a.anchor!.end)]), ...ranges.flatMap(h => [Math.max(part.start, h.start), Math.min(part.end, h.end)])])].sort((a, b) => a - b);
                const roleClass = ({body:'',heading:'section-heading',author:'quote-author',quote:'opening-quote',commemorations:'commemorations-text'})[part.kind];
                return <p key={part.start} data-text-start={part.start} className={`${roleClass} ${spokenStart !== undefined && spokenStart >= part.start && spokenStart < part.end ? 'spoken-paragraph' : ''}`} >{cuts.slice(0, -1).map((start, i) => {
                        const end = cuts[i + 1], active = marks.filter(a => a.anchor!.start < end && a.anchor!.end > start).at(-1), hit = ranges.some(h => h.start < end && h.end > start), value = page.text.slice(start, end);
                        return active ? <mark key={start} className={`highlight ${active.color} ${hit ? 'search-hit' : ''}`} title={active.note || 'Saved highlight'} onClick={() => onAnnotation(active)}>{value}</mark> : hit ? <mark key={start} className="search-hit">{value}</mark> : <Fragment key={start}>{value}</Fragment>;
                    })}</p>;
            })}
    </div> : <div className="empty-text"><Icon name="scan" size={34}/><h3>The original is here.</h3><p>{readerOnly ? "This page is available as an original scan. You can bookmark it, mark an area, or add a note." : "Run OCR to make this page searchable and selectable, or add a corrected transcription in Review text."}</p></div>}
    <div className="paper-end">{readerOnly ? 'Original scan preserved · Your notes stay personal' : page.textSource === 'sample-transcription' ? 'Sample transcription · compare with the original before approval' : page.reviewed ? 'Text marked reviewed by you' : page.text ? 'Unreviewed transcription · original scan remains authoritative' : 'Original scan preserved'}</div>
  </article>;
}
export const TextReader = memo(TextReaderImpl, (a, b) => a.page === b.page && a.annotations === b.annotations && a.query === b.query && a.fontSize === b.fontSize && a.readerOnly === b.readerOnly && a.spokenStart === b.spokenStart && a.onSelection === b.onSelection && a.onAnnotation === b.onAnnotation);
export function ScanReader({ page, annotations, query, onRegion, readerOnly = false }: {
    readerOnly?: boolean;
    page: BookPage;
    annotations: Annotation[];
    query: string;
    onRegion: (rect: Crop) => void;
}) {
    const { image, error } = usePageImage(page);
    const [zoom, setZoom] = useState(100);
    const [drawing, setDrawing] = useState(false);
    const [draft, setDraft] = useState<Crop | null>(null);
    const start = useRef<{
        x: number;
        y: number;
    } | null>(null);
    const plane = useRef<HTMLDivElement>(null);
    useEffect(() => { setDraft(null); setDrawing(false); setZoom(100); }, [page.id, page.cropVersion]);
    const point = (clientX: number, clientY: number) => { const box = plane.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (clientY - box.top) / box.height)) }; };
    const drawRect = (rect: Crop, key: string, color: string) => <div key={key} className={`scan-mark ${color}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}/>;
    const textMarks = annotations.filter(a => a.kind === 'text' && a.anchor && !a.anchor.detached);
    const hits = searchRanges(page.text, query);
    return <section className="scan-panel" aria-label="Original page scan">
    <div className="scan-controls"><span><Icon name="scan" size={15}/> Original page</span><div><button className={`button small ${drawing ? 'primary' : 'secondary'}`} onClick={() => setDrawing(!drawing)}><Icon name="highlight" size={15}/>{drawing ? 'Drag an area' : 'Mark an area'}</button><label className="zoom-control"><span className="sr-only">Scan zoom</span><select aria-label="Scan zoom" value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value={100}>Fit</option><option value={150}>150%</option><option value={200}>200%</option><option value={300}>300%</option></select></label></div></div>
    {!page.words.length && <p className="scan-hint">{readerOnly ? "Mark an area to save a passage directly on this scan." : "Area marks work here. Text-to-scan locations become available after OCR."}</p>}
    <div className="scan-scroll">{error ? <div className="empty-state error">{error}</div> : !image ? <div className="loading-scan"><span className="spinner"/> Preparing scan…</div> : <div ref={plane} className={`scan-plane ${drawing ? 'drawing' : ''}`} style={{ width: `${zoom}%`, touchAction: drawing ? 'none' : 'auto' }} onPointerDown={e => { if (!drawing)
            return; e.preventDefault(); start.current = point(e.clientX, e.clientY); e.currentTarget.setPointerCapture(e.pointerId); setDraft(null); }} onPointerMove={e => { if (!drawing || !start.current)
            return; const end = point(e.clientX, e.clientY), s = start.current; setDraft({ x: Math.min(s.x, end.x), y: Math.min(s.y, end.y), w: Math.abs(end.x - s.x), h: Math.abs(end.y - s.y) }); }} onPointerUp={e => { if (!start.current)
            return; const end = point(e.clientX, e.clientY), s = start.current; const rect = { x: Math.min(s.x, end.x), y: Math.min(s.y, end.y), w: Math.abs(end.x - s.x), h: Math.abs(end.y - s.y) }; start.current = null; setDraft(null); if (rect.w > .004 && rect.h > .004) {
            onRegion(rect);
            setDrawing(false);
        } }} onPointerCancel={() => { start.current = null; setDraft(null); }}>
      <img src={image.url} alt={`Original scanned page: ${page.title}`} draggable={false} width={image.width} height={image.height}/>
      <div className="scan-overlays" aria-hidden="true">{annotations.filter(a => a.kind === 'region' && a.rect && a.cropVersion === page.cropVersion).map(a => drawRect(a.rect!, a.id, a.color))}
      {textMarks.flatMap(a => page.words.filter(w => w.start < a.anchor!.end && w.end > a.anchor!.start).map((w, i) => drawRect(w, `${a.id}-${i}`, a.color)))}
      {page.words.filter(w => hits.some(h => w.start < h.end && w.end > h.start)).map((w, i) => drawRect(w, `find-${i}`, 'search-region'))}
      {draft && drawRect(draft, 'draft', 'gold draft')}
      </div>
    </div>}</div>
    {drawing && <div className="scan-hint">Drag over the printed passage to save an area highlight. Press “Drag an area” again to exit.</div>}
  </section>;
}
export function ReadingArea({ mode, ...props }: {
    mode: ViewMode;
    readerOnly?: boolean;
    page: BookPage;
    annotations: Annotation[];
    query: string;
    fontSize: number;
    onSelection: (s: SelectionAnchor | null) => void;
    onAnnotation: (a: Annotation) => void;
    onRegion: (r: Crop) => void;
}) {
    return <div className={`reading-layout ${mode}`}>
    {mode !== 'scan' && <TextReader {...props}/>}{mode !== 'read' && <ScanReader readerOnly={props.readerOnly} page={props.page} annotations={props.annotations} query={props.query} onRegion={props.onRegion}/>}
  </div>;
}
