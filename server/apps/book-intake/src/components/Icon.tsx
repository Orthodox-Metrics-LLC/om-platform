import type { CSSProperties } from 'react';
const paths: Record<string, string> = {
    headphones: 'M3 14v-3a9 9 0 0 1 18 0v3 M3 13h4v8H3z M17 13h4v8h-4z',
    play: 'M7 4l14 8-14 8z', pause: 'M8 4v16 M16 4v16', stop: 'M5 5h14v14H5z',
    continuous: 'M4 3h7v7H4z M14 3h7v7h-7z M4 14h7v7H4z M14 14h7v7h-7z',
    clock: 'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    book: 'M4 4h6c2 0 2 2 2 2s0-2 2-2h6v15h-6c-2 0-2 2-2 2s0-2-2-2H4z M12 6v15',
    search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    bookmark: 'M6 3h12v18l-6-4-6 4z', left: 'M15 18l-6-6 6-6', right: 'M9 18l6-6-6-6',
    upload: 'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6', download: 'M12 3v13 M7 11l5 5 5-5 M4 16v5h16v-5',
    plus: 'M12 5v14 M5 12h14', close: 'M6 6l12 12 M18 6L6 18', check: 'M4 12l5 5L20 6',
    scan: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M7 7h10v10H7z',
    compare: 'M3 4h18v16H3z M12 4v16 M6 8h3 M6 12h3 M15 8h3 M15 12h3',
    note: 'M4 3h16v14l-5 4H4z M8 7h8 M8 11h8 M8 15h4 M15 21v-4h5',
    settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6', menu: 'M4 6h16 M4 12h16 M4 18h16',
    calendar: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 18h2',
    edit: 'M16 3l5 5-12 12-6 1 1-6z M13 6l5 5', trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
    highlight: 'M15 3l6 6-10 10-6-6z M5 13l-2 6 2 2 6-2 M3 22h11',
    lock: 'M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01', help: 'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    arrowup: 'M12 19V5 M5 12l7-7 7 7', arrowdown: 'M12 5v14 M5 12l7 7 7-7',
    reset: 'M3 11a9 9 0 1 1 3 8 M3 4v7h7', external: 'M14 3h7v7 M21 3L10 14 M10 3H3v18h18v-7',
    sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1',
    moon: 'M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10', folder: 'M3 6h7l2 2h9v12H3z',
    text: 'M4 5h16 M12 5v16 M8 21h8', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    spark: 'M12 3l2 6 7 3-7 2-2 7-2-7-7-2 7-3z'
};
export function Icon({ name, size = 19, style }: {
    name: string;
    size?: number;
    style?: CSSProperties;
}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name] || paths.book}/></svg>; }
