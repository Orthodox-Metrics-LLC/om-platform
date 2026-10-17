import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Annotation, BookPage, Bookmark, Crop, ReadingLayout, SelectionAnchor } from '../types';
import { ScanReader, TextReader } from '../components/Reader';
import { Icon } from '../components/Icon';
import { readingUnits, unitIndex, visiblePixels } from '../lib/reading';

/** Image-only pages are decoded near the viewport, never all 386 at once. */
const EMPTY_ANNOTATIONS: Annotation[] = [];
function LazyScan({ page, annotations, onRegion }: { page: BookPage; annotations: Annotation[]; onRegion: (r: Crop) => void }) {
    const ref = useRef<HTMLDivElement>(null), [near, setNear] = useState(false);
    useEffect(() => {
        const observer = new IntersectionObserver(entries => setNear(entries[0].isIntersecting), { rootMargin: '900px' });
        if (ref.current) observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);
    return <div ref={ref} className="scan-reading-fallback">{near ? <ScanReader readerOnly page={page} annotations={annotations} query="" onRegion={onRegion}/> : <div className="deferred-scan">Original scan · {page.title}</div>}</div>;
}
export type FlowTarget = { id: string; revision: number; bottom?: boolean };
interface Props {
    pages: BookPage[]; layout: ReadingLayout; target: FlowTarget; activeId: string;
    annotations: Annotation[]; bookmarks: Bookmark[]; query: string; fontSize: number;
    scrollRef: RefObject<HTMLDivElement>; spoken?: { pageId: string; start: number };
    onActive: (id: string, unitIds: string[], visibleIds: string[]) => void;
    onSelection: (s: SelectionAnchor | null) => void;
    onAnnotation: (a: Annotation) => void;
    onRegion: (pageId: string, rect: Crop) => void;
    onBookmark: (id: string) => void; onRead: (id: string, value: boolean) => void;
    onSource: (id: string) => void;
    onEdge: (direction: -1 | 1) => void;
}
function ReadingFlowImpl(props: Props) {
    const { pages, layout, target, scrollRef } = props;
    const units = useMemo(() => readingUnits(pages, layout), [pages, layout]);
    const singleUnitIndex = unitIndex(pages, target.id, layout);
    const currentProps = useRef(props); currentProps.current = props;
    const refs = useRef(new Map<string, HTMLElement>());
    const frame = useRef(0), restoring = useRef(false), wheel = useRef({ at: 0, value: 0 });
    const lastSignature = useRef('');
    const activeRef = useRef(props.activeId); activeRef.current = props.activeId;
    const groups = layout === 'continuous' ? units : units.slice(singleUnitIndex, singleUnitIndex + 1);

    const inspect = () => {
        const root = scrollRef.current;
        if (!root || restoring.current) return;
        const viewport = root.getBoundingClientRect();
        let best: HTMLElement | undefined, overlap = 0;
        for (const node of refs.current.values()) {
            const amount = visiblePixels(node.getBoundingClientRect(), viewport);
            if (amount > overlap) { overlap = amount; best = node; }
        }
        if (!best || overlap < 30) {
            if (lastSignature.current !== 'off-page') { lastSignature.current = 'off-page'; currentProps.current.onActive(activeRef.current, [], []); }
            return;
        }
        const nodes = [...best.querySelectorAll<HTMLElement>('[data-reading-page]')];
        const visible = nodes.filter(node => {
            const rect = node.getBoundingClientRect();
            return visiblePixels(rect, viewport) >= Math.min(120, rect.height * .25);
        }).map(node => node.dataset.readingPage!);
        const ids = nodes.map(node => node.dataset.readingPage!);
        // Do not unexpectedly change which page's notebook is open while its page is still on screen.
        const id = visible.includes(activeRef.current) ? activeRef.current : visible[0] || ids[0];
        const signature = [id, ids.join(','), visible.join(',')].join('|');
        if (signature !== lastSignature.current) { lastSignature.current = signature; currentProps.current.onActive(id, ids, visible); }
    };
    const schedule = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(inspect); };
    useEffect(() => {
        const root = scrollRef.current;
        if (!root) return;
        root.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        const resize = new ResizeObserver(schedule); resize.observe(root);
        const timer = window.setInterval(schedule, 750); // Includes CSS content-visibility height reconciliation.
        schedule();
        return () => { root.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); resize.disconnect(); clearInterval(timer); cancelAnimationFrame(frame.current); };
    }, [layout, pages.length, target.revision]);
    useEffect(() => {
        const root = scrollRef.current;
        if (!root) return;
        restoring.current = true; lastSignature.current = '';
        let stopped = false;
        const align = () => {
            if (stopped) return;
            const node = root.querySelector<HTMLElement>(`[data-reading-page="${CSS.escape(target.id)}"]`);
            if (node) {
                // Vertical-only navigation. scrollIntoView could also move surrounding application panels.
                const bounds = node.getBoundingClientRect(), view = root.getBoundingClientRect();
                root.scrollTop += target.bottom ? bounds.bottom - view.bottom : bounds.top - view.top - 12;
            } else root.scrollTop = 0;
        };
        const f = requestAnimationFrame(() => { align(); requestAnimationFrame(() => { align(); restoring.current = false; inspect(); }); });
        return () => { stopped = true; cancelAnimationFrame(f); restoring.current = false; };
    }, [target.revision, layout]);
    useEffect(() => {
        const root = scrollRef.current;
        if (!root || layout === 'continuous') return;
        const edge = (event: WheelEvent) => {
            if (event.ctrlKey || event.shiftKey || event.deltaY === 0) return;
            const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 3, atTop = root.scrollTop <= 1;
            const direction = event.deltaY > 0 ? 1 : -1;
            if (!(direction > 0 ? atBottom : atTop)) { wheel.current.value = 0; return; }
            const now = performance.now();
            if (now - wheel.current.at > 500 || Math.sign(wheel.current.value) !== direction) wheel.current.value = 0;
            wheel.current.value += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1); wheel.current.at = now;
            if (Math.abs(wheel.current.value) >= 90) { wheel.current.value = 0; currentProps.current.onEdge(direction); }
        };
        root.addEventListener('wheel', edge, { passive: true });
        return () => root.removeEventListener('wheel', edge);
    }, [layout]);
    useEffect(() => { wheel.current = { at: performance.now(), value: 0 }; }, [target.revision]);
    const bookmarkIds = new Set(props.bookmarks.map(b => b.pageId));
    const annotations = useMemo(() => {
        const map = new Map<string, Annotation[]>();
        for (const a of props.annotations) map.set(a.pageId, [...(map.get(a.pageId) || []), a]);
        return map;
    }, [props.annotations]);
    return <div className={`reading-flow flow-${layout}`} data-testid="reading-flow">
        {groups.map(unit => {
            const first = pages.findIndex(p => p.id === unit[0].id), last = first + unit.length;
            return <section key={unit[0].id} className="reading-unit" data-unit-id={unit[0].id} ref={node => { if (node) refs.current.set(unit[0].id, node); else refs.current.delete(unit[0].id); }} aria-label={unit.length === 2 ? `Pages ${first + 1} and ${last}` : `Page ${first + 1}`}>
                <div className="spread-label"><span>{unit.length === 2 ? `PAGES ${first + 1} — ${last}` : `PAGE ${first + 1}`}</span><span>{layout === 'continuous' ? 'SCROLL TO CONTINUE' : 'READ AT YOUR OWN PACE'}</span></div>
                <div className={`spread-sheets ${unit.length === 1 ? 'one-sheet' : ''}`}>
                {unit.map((page, index) => <div key={page.id} className={`reader-sheet ${props.spoken?.pageId === page.id ? 'narration-current' : ''}`} data-reading-page={page.id}>
                    <div className="sheet-tools"><span>Page {first + index + 1}</span><div><button className={`icon-button small ${bookmarkIds.has(page.id) ? 'is-bookmarked' : ''}`} aria-label={`${bookmarkIds.has(page.id) ? 'Remove bookmark from' : 'Bookmark'} page ${first + index + 1}`} aria-pressed={bookmarkIds.has(page.id)} onClick={() => props.onBookmark(page.id)}><Icon name="bookmark" size={16}/></button><button className="icon-button small" title="View original scan" aria-label={`View original scan for page ${first + index + 1}`} onClick={() => props.onSource(page.id)}><Icon name="scan" size={16}/></button></div></div>
                    {page.text.trim() ? <TextReader readerOnly page={page} annotations={annotations.get(page.id) || EMPTY_ANNOTATIONS} query={props.query} fontSize={props.fontSize} onSelection={props.onSelection} onAnnotation={props.onAnnotation} spokenStart={props.spoken?.pageId === page.id ? props.spoken.start : undefined}/> : <LazyScan page={page} annotations={annotations.get(page.id) || EMPTY_ANNOTATIONS} onRegion={rect => props.onRegion(page.id, rect)}/>}
                    <div className="sheet-progress"><button className={`read-toggle ${page.read ? 'done' : ''}`} role="checkbox" aria-checked={page.read} aria-label={`Mark page ${first + index + 1} as read`} onClick={() => props.onRead(page.id, !page.read)}><span className="check-circle">{page.read && <Icon name="check" size={12}/>}</span>{page.read ? 'Read' : 'Mark as read'}</button><span>{page.title}</span></div>
                </div>)}
                </div>
            </section>;
        })}
        {layout === 'continuous' && <div className="end-of-book"><Icon name="book" size={24}/><strong>You have reached the end of this book.</strong><span>Your place, bookmarks and notes are saved.</span></div>}
    </div>;
}

// The half-second progress clock must not re-render hundreds of unchanged book pages.
const MemoReadingFlow = memo(ReadingFlowImpl, (a, b) =>
    a.pages === b.pages && a.layout === b.layout && a.target.revision === b.target.revision &&
    a.activeId === b.activeId && a.annotations === b.annotations && a.bookmarks === b.bookmarks &&
    a.query === b.query && a.fontSize === b.fontSize && a.spoken?.pageId === b.spoken?.pageId && a.spoken?.start === b.spoken?.start);

// Keep event handlers fresh even when the expensive page tree does not need a render.
export function ReadingFlow(props: Props) {
    const live = useRef(props); live.current = props;
    const handlers = useMemo(() => ({
        onActive: (...args: Parameters<Props['onActive']>) => live.current.onActive(...args),
        onSelection: (...args: Parameters<Props['onSelection']>) => live.current.onSelection(...args),
        onAnnotation: (...args: Parameters<Props['onAnnotation']>) => live.current.onAnnotation(...args),
        onRegion: (...args: Parameters<Props['onRegion']>) => live.current.onRegion(...args),
        onBookmark: (...args: Parameters<Props['onBookmark']>) => live.current.onBookmark(...args),
        onRead: (...args: Parameters<Props['onRead']>) => live.current.onRead(...args),
        onSource: (...args: Parameters<Props['onSource']>) => live.current.onSource(...args),
        onEdge: (...args: Parameters<Props['onEdge']>) => live.current.onEdge(...args),
    }), []);
    return <MemoReadingFlow {...props} {...handlers}/>;
}
