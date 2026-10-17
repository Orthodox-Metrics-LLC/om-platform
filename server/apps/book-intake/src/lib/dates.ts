import type { BookPage, WordBox, DateIndex } from '../types';

/** Printed-date indexing only. Never extrapolate a date from page order or today's calendar. */
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const monthNames = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sept?\\.?|Oct\\.?|Nov\\.?|Dec\\.?)';
const weekdays = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';
const glyph = '[0-9IOoil|SBbZz]';
const scripture = /^(?:[1-3]\s*)?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Kings|Kingdoms|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Wisdom|Sirach|Isaiah|Jeremiah|Lamentations|Baruch|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation)\b/i;
export const isScriptureStart = (s: string) => scripture.test(s.trim());
export function normalizeDateKey(value: string): string {
    const m = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec((value || '').trim());
    if (!m) return '';
    const month = Number(m[1]), day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > new Date(2000, month, 0).getDate()) return '';
    return `${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export function dateLabel(key: string): string {
    const normalized = normalizeDateKey(key); if (!normalized) return '';
    const [m,d] = normalized.split('-').map(Number); return `${MONTHS[m-1]} ${d}`;
}
export interface DateCandidate { key: string; raw: string; start: number; end: number; normalized: boolean; }
function digit(s: string) { return s.replace(/[IiLl|]/g,'1').replace(/[Oo]/g,'0').replace(/[Bb]/g,'8').replace(/[Ss]/g,'5').replace(/[Zz]/g,'2'); }
/** Consume the ENTIRE day token. In v0.3 a word boundary accepted only the 2 in 2.7. */
export function parsePrintedHeading(value: string, geometric = false): DateCandidate | undefined {
    const text = value.replace(/\u00a0/g,' ');
    const month = new RegExp(`^\\s*(?:${weekdays}[, \\t]+)?${monthNames}[ \\t\\n]+`, 'i').exec(text);
    if (!month) return;
    const offset = month[0].length;
    const rest = text.slice(offset);
    const first = new RegExp(`^${glyph}{1,6}`).exec(rest);
    if (!first) return;
    let token = first[0], end = offset + token.length;
    // A split digit can have OCR punctuation or a small space. Do not steal the "1" in 1 Corinthians.
    const second = new RegExp(`^([ \\t]*[.·][ \\t]*|[ \\t]+)(${glyph})(?![A-Za-z0-9])`).exec(text.slice(end));
    if (token.length === 1 && second && !scripture.test(text.slice(end).trim())) {
        token += second[2]; end += second[0].length;
    }
    const tail = text.slice(end);
    if (/^[0-9A-Za-z|]/.test(tail) && !/^(?:st|nd|rd|th)\b/i.test(tail)) return;
    if (/^\s*[:/]|^\s*[.·]\s*\d|^\s*-\s*\d/.test(tail)) return; // Verse, range, or third digit—not a date.
    const monthIndex = MONTHS.findIndex(name => name.toLowerCase().startsWith(month[1].replace('.','').toLowerCase())) + 1;
    const digits = digit(token); if (!/^\d{1,2}$/.test(digits)) return;
    const key = normalizeDateKey(`${monthIndex}-${Number(digits)}`); if (!key) return;
    const suffix = tail.replace(/^(st|nd|rd|th)\b/i,'').replace(/^\s*[,;·–—-]?\s*/, '');
    // Reject prose beginning "May I ...". OCR headers may also share a row with Scripture.
    if (!geometric && suffix && !/^(?:\d{4}\b|Fast[- ]free\b|Strict Fast\b)/i.test(suffix) && !scripture.test(suffix)) return;
    const start = text.search(new RegExp(monthNames,'i'));
    return { key, raw:value.slice(start,end), start, end, normalized: token !== digits || /[.·]/.test(text.slice(offset,end)) || /\s/.test(text.slice(offset,end)) };
}
export function textDateCandidates(text: string): DateCandidate[] {
    const result: DateCandidate[] = [];
    let offset = 0;
    // Printed heading region only. Dates inside the saint's life must never become the page date.
    for (const line of text.slice(0,1800).split('\n').slice(0,16)) {
        const candidate = parsePrintedHeading(line);
        if (candidate) result.push({...candidate,start:offset+candidate.start,end:offset+candidate.end});
        offset += line.length + 1;
    }
    for(const m of text.slice(0,1000).matchAll(new RegExp(`^\\s*${monthNames}[ \\t]*\\n[\\s]*(${glyph}{1,2})(?![A-Za-z0-9])`, 'gim'))){const c=parsePrintedHeading(m[0].replace(/\n/g,' '));if(c)result.push({...c,start:m.index!,end:m.index!+m[0].length,raw:m[0]});}
    return result;
}
export interface OCRLine { words: WordBox[]; text: string; x: number; y: number; w: number; h: number; }
/** Recover physical lines from existing OCR word boxes; no new OCR and no text mutation. */
export function physicalLines(words: WordBox[], maxY = 1): OCRLine[] {
    const lines: OCRLine[] = [];
    const valid = words.filter(w => w.text.trim() && [w.x,w.y,w.w,w.h,w.start,w.end].every(Number.isFinite) && w.y < maxY && w.h > 0 && w.w > 0 && w.h < .16);
    for (const word of valid.sort((a,b) => (a.y + a.h/2) - (b.y + b.h/2) || a.x-b.x)) {
        const center = word.y + word.h/2;
        const row = lines.find(l => Math.abs(l.y+l.h/2-center) <= Math.max(l.h,word.h)*.48);
        if (row) { row.words.push(word); row.x = Math.min(row.x,word.x); row.w = Math.max(row.x+row.w,word.x+word.w)-row.x; }
        else lines.push({words:[word],text:'',x:word.x,y:word.y,w:word.w,h:word.h});
    }
    return lines.sort((a,b)=>a.y-b.y).map(l=>({...l,words:l.words.sort((a,b)=>a.x-b.x),text:l.words.sort((a,b)=>a.x-b.x).map(w=>w.text).join(' ')}));
}
export function layoutDateCandidates(words: WordBox[]): DateCandidate[] {
    const out: DateCandidate[] = [];
    for (const line of physicalLines(words,.29)) {
        // Large month/day on the left; exclude references in the right column.
        const left = line.words.filter(w=>w.x<.66);
        const parts: WordBox[][] = []; let part:WordBox[]=[];
        for(const w of left){const prev=part.at(-1);if(prev&&w.x-(prev.x+prev.w)>.105){parts.push(part);part=[];}part.push(w);}if(part.length)parts.push(part);
        for (const cluster of parts) {
            const s = cluster.map(w=>w.text).join(' '), c = parsePrintedHeading(s,true);
            if (c && cluster[0].x < .42) out.push({...c,start:Math.min(...cluster.map(w=>w.start)),end:Math.max(...cluster.map(w=>w.end))});
        }
    }
    return out;
}
function unique(candidates: DateCandidate[]) { return [...new Map(candidates.map(c=>[c.key,c])).values()]; }
export function resolvePrintedDate(page: BookPage): DateIndex {
    const base = {version:4 as const,textVersion:page.textVersion,cropVersion:page.cropVersion};
    if (page.manualDate !== undefined) return {...base,key:normalizeDateKey(page.manualDate),status:page.manualDate?'resolved':'undated',source:'manual',evidence:page.manualDate};
    const stored = page.dateIndex;
    if(stored?.version===4&&stored.textVersion===page.textVersion&&stored.cropVersion===page.cropVersion&&stored.key===page.dateKey)return stored;
    if (stored?.source==='header-ocr' && stored.cropVersion===page.cropVersion && stored.status==='resolved') return {...stored,textVersion:page.textVersion};
    // Explicit manual/sample metadata is not an automatically generated, sticky OCR guess.
    if ((page.textSource !== 'ocr' || page.review?.method === 'individual') && normalizeDateKey(page.dateKey)) return {...base,key:normalizeDateKey(page.dateKey),status:'resolved',source:'metadata',evidence:page.dateKey};
    const layout = unique(layoutDateCandidates(page.words || []));
    const text = unique(textDateCandidates(page.text));
    if (layout.length === 1) return {...base,key:layout[0].key,status:'resolved',source:'layout-header',evidence:layout[0].raw};
    if (layout.length > 1 || text.length > 1) return {...base,key:'',status:'conflict',source:'text-header',evidence:[...layout,...text].map(c=>c.raw).join(' | ').slice(0,2000)};
    if (text.length === 1) return {...base,key:text[0].key,status:'resolved',source:'text-header',evidence:text[0].raw};
    const title = parsePrintedHeading(page.title);
    const old = normalizeDateKey(page.dateKey) || title?.key || '';
    if (old) return {...base,key:old,status:page.textSource==='ocr'?'unverified':'resolved',source:'metadata',evidence:page.title};
    const looksDated = new RegExp(`^\\s*${monthNames}\\b`,'im').test(page.text.slice(0,1000));
    return {...base,key:'',status:looksDated?'unresolved':'undated',source:'text-header',evidence:looksDated?'Printed month found, but day is not reliable.':''};
}
export function isGeneratedTitle(title: string) { return !title.trim() || /^(?:IMG[_ -]|DSC[_ -]|Scan[ _\d]|Page\s+\d|Image\s+\d)/i.test(title) || !!parsePrintedHeading(title); }
export function repairPageDate(page: BookPage): BookPage {
    const index = resolvePrintedDate(page);
    const key = index.key;
    return {...page, dateKey:key, dateIndex:index, title:key && isGeneratedTitle(page.title) ? dateLabel(key) : page.title};
}
export interface DateAudit { indexed:number; uniqueDays:number; undated:number; conflicts:number; unverified:number; duplicates:{key:string;ids:string[]}[]; suspectIds:string[]; missing:string[]; }
export function auditDates(pages: BookPage[]): DateAudit {
    const keys = new Map<string,string[]>(), suspect = new Set<string>(); let indexed=0,undated=0,conflicts=0,unverified=0;
    const resolved=pages.map(p=>({p,index:resolvePrintedDate(p)}));
    const daily = resolved.filter(r=>r.index.key).length >= Math.min(4,Math.max(1,pages.length*.3));
    for (const {p,index} of resolved) {
        if(index.key){if(index.status==='resolved')indexed++;keys.set(index.key,[...(keys.get(index.key)||[]),p.id]);}else undated++;
        if(['conflict','unresolved'].includes(index.status)){conflicts++;suspect.add(p.id);}
        if(index.status==='unverified'){unverified++;suspect.add(p.id);}
        if(daily&&p.textSource==='ocr'&&!index.key&&isGeneratedTitle(p.title))suspect.add(p.id);
    }
    const duplicates=[...keys].filter(([,ids])=>ids.length>1).map(([key,ids])=>({key,ids}));
    for(const d of duplicates) for(const id of d.ids){const p=pages.find(p=>p.id===id)!;if(p.manualDate===undefined&&p.dateIndex?.source!=='header-ocr'&&p.textSource==='ocr')suspect.add(id);}
    const reliableKeys=new Set(resolved.filter(r=>r.index.status==='resolved').map(r=>r.index.key));
    const missing:string[]=[];if(daily)for(let m=1;m<=12;m++)for(let d=1;d<=new Date(2001,m,0).getDate();d++){const key=normalizeDateKey(`${m}-${d}`);if(!reliableKeys.has(key))missing.push(key);}
    return {indexed,uniqueDays:reliableKeys.size,undated,conflicts,unverified,duplicates,suspectIds:[...suspect],missing};
}
