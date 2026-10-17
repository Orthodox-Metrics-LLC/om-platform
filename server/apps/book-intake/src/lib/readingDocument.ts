import type { BookPage } from '../types';
import { MONTHS, dateLabel, isScriptureStart, parsePrintedHeading, physicalLines, resolvePrintedDate, textDateCandidates } from './dates';

export interface ReadingPart { start:number; end:number; kind:'body'|'quote'|'author'|'heading'|'commemorations'; }
export interface ReadingDocument { title:string; weekday:string; fasting:string; feast:string; readings:string; parts:ReadingPart[]; rawHeaderRanges:{start:number;end:number}[]; }
const dayNames=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const weekdayRE=/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i;
const fastingRE=/\b(?:Fast[- ]free|Strict\s+Fast|Wine\s+and\s+oil(?:\s+allowed)?|Fish\s+allowed|Fasting)\b/i;
const cache=new WeakMap<BookPage,ReadingDocument>();
/** Presentation layer only. Source strings, offsets, OCR words and all annotation anchors stay intact. */
export function readingDocument(page:BookPage):ReadingDocument {
    const cached=cache.get(page);if(cached)return cached;
    const text=page.text, omit:{start:number;end:number}[]=[];
    let weekday=page.weekday,fasting=page.fasting,feast=page.feast;
    const references:string[] = page.readings ? [page.readings] : [];
    const index=resolvePrintedDate(page);
    // Scan-verified metadata can replace a broken OCR date header for display without rewriting text.
    const dateSpan=(value:string)=>{
        const known=parsePrintedHeading(value);if(known)return known;
        if(index.status!=='resolved'||!index.key)return undefined;
        const month=MONTHS[Number(index.key.slice(0,2))-1];
        const broken=new RegExp(`^\\s*${month}\\s+[0-9IOil|SBZ?.· \\t]{1,10}(?=\\s|$)`,'i').exec(value);
        return broken?{start:0,end:broken[0].trimEnd().length}:undefined;
    };
    const verifiedHeader=page.dateIndex?.source==='header-ocr'&&index.status==='resolved'?page.dateIndex.evidence:'';
    const verifiedReferences:string[]=[];
    if(verifiedHeader){
        for(const line of verifiedHeader.split('\n').slice(0,16)){
            let value=line.trim();const date=parsePrintedHeading(value);if(date)value=value.slice(date.end).trim();
            if(!page.readings&&isScriptureStart(value)&&value.length<180&&/\d/.test(value))verifiedReferences.push(value);
            const day=weekdayRE.exec(value);if(day&&!page.weekday)weekday=dayNames.find(d=>d.toLowerCase()===day[1].toLowerCase())!;
            if(!page.fasting&&fastingRE.test(value)&&value.replace(fastingRE,'').trim().length<2)fasting=value;
        }
    }
    const meta=(start:number,end:number)=>{if(end>start)omit.push({start,end});};
    for(const c of textDateCandidates(text))meta(c.start,c.end);
    // The old OCR flattened multi-column header rows. Reconstruct header groups from their actual coordinates.
    const lines=physicalLines(page.words||[],.255);
    for(const line of lines){
        const clusters:typeof line.words[]=[];let cluster:typeof line.words=[];
        for(const w of line.words){const prev=cluster.at(-1);if(prev&&w.x-(prev.x+prev.w)>.09){clusters.push(cluster);cluster=[];}cluster.push(w);}if(cluster.length)clusters.push(cluster);
        for(const words of clusters){
            const s=words.map(w=>w.text).join(' ').trim();
            if(!s)continue;
            const date=parsePrintedHeading(s,true);
            if(date){ // Omit only the month/day words, never a following Scripture reference.
                let offset=0;for(const w of words){if(offset<date.end)meta(w.start,w.end);offset+=w.text.length+1;}
            }else if(weekdayRE.test(s)&&s.length<125){
                const m=weekdayRE.exec(s)!;weekday ||= dayNames.find(d=>d.toLowerCase()===m[1].toLowerCase())!;
                if(words.length===1)meta(words[0].start,words[0].end);
            }else if(isScriptureStart(s)&&s.length<180&&/\d/.test(s)){
                if(!page.readings&&!references.includes(s))references.push(s);words.forEach(w=>meta(w.start,w.end));
            }else if(fastingRE.test(s)&&s.replace(fastingRE,'').trim().length<3){
                fasting ||= s;words.forEach(w=>meta(w.start,w.end));
            }
        }
    }
    // Also repair older books without word geometry. Restrict metadata stripping to the top of the transcript.
    let position=0;
    for(const raw of text.split(/\n\s*\n/)){
        const start=text.indexOf(raw,position);position=start+raw.length;
        if(start>1100)break;
        let body=raw.trim();const lead=raw.indexOf(body),base=start+Math.max(0,lead);
        const wd=weekdayRE.exec(body);
        if(wd&&body.length<200){
            weekday ||= dayNames.find(d=>d.toLowerCase()===wd[1].toLowerCase())!;meta(base,base+wd[0].length);
            const fast=fastingRE.exec(body);if(fast){fasting ||= fast[0];meta(base+fast.index,base+fast.index+fast[0].length);}
            const rest=body.slice(wd[0].length,fast?.index??body.length).trim();
            if(rest&&rest.length<130&&!/\d|January|February|March|April|June|July|August|September|October|November|December/i.test(rest)){
                feast ||= rest;const at=body.indexOf(rest);meta(base+at,base+at+rest.length);
            }
        }
        const date=dateSpan(body);if(date){meta(base+date.start,base+date.end);body=body.slice(date.end).trim();}
        if(isScriptureStart(body)&&/\d/.test(body)&&body.length<210&&!/[.!?]\s+[A-Za-z]{5,}\s+[a-z]/.test(body)){
            if(!page.readings&&!references.includes(body))references.push(body);
            const at=raw.indexOf(body);if(at>=0)meta(start+at,start+at+body.length);
        }
        if(body.length<70&&fastingRE.test(body)&&body.replace(fastingRE,'').trim().length<2){fasting ||= body;const at=raw.indexOf(body);meta(start+at,start+at+body.length);}
    }
    // De-duplicate equivalent references from text and geometry without inventing corrected verses.
    const seen=new Set<string>();const readings=(verifiedReferences.length?verifiedReferences:references).filter(r=>{const key=r.replace(/\s/g,'').toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).join('; ');
    const mask=new Uint8Array(text.length);for(const r of omit)mask.fill(1,Math.max(0,r.start),Math.min(text.length,r.end));
    const spans:ReadingPart[]=[];
    const add=(s:number,e:number,kind:ReadingPart['kind']='body')=>{
        while(s<e&&(/[\s;|]/.test(text[s])||mask[s]))s++;while(e>s&&(/[\s|]/.test(text[e-1])||mask[e-1]))e--;
        if(e>s&&/[\p{L}\p{N}]/u.test(text.slice(s,e)))spans.push({start:s,end:e,kind});
    };
    // Split at real paragraph boundaries and omitted header ranges, retaining exact source offsets.
    for(const match of text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)){
        let start=match.index!,end=start+match[0].length,run=start;
        for(let i=start;i<=end;i++)if(i===end||mask[i]){add(run,i);while(i<end&&mask[i])i++;run=i;}
    }
    const parts:ReadingPart[]=[];
    for(const span of spans){
        const value=text.slice(span.start,span.end);
        const comm=/^COMMEMORATIONS\s*:\s*/i.exec(value);
        if(comm){parts.push({...span,end:span.start+comm[0].trimEnd().length,kind:'heading'});const s=span.start+comm[0].length;if(s<span.end)parts.push({...span,start:s,kind:'commemorations'});continue;}
        const heading=/^([A-Z][A-Z\s.,;:’'()\-–]+[.:])\s+(?=[A-Z](?:[a-z]|[ \t]))/.exec(value);
        if(heading&&heading[1].length>12&&heading[1].length<250){
            parts.push({...span,end:span.start+heading[1].length,kind:'heading'});
            parts.push({...span,start:span.start+heading[0].length});continue;
        }
        const upper=value===value.toUpperCase()&&/[A-Z]/.test(value)&&value.length<250;
        const author=/^(?:St\.|Saint|Elder|Archimandrite|Metropolitan|Abba|Mother)\s+[A-Z]/.test(value)&&value.length<125&&!upper&&!/[.!?]\s+[A-Z][a-z]/.test(value.slice(4));
        parts.push({...span,kind:upper?'heading':author?'author':'body'});
    }
    const firstBody=parts.findIndex(p=>p.kind==='body');
    if(firstBody>=0){const p=parts[firstBody],v=text.slice(p.start,p.end);if(parts[firstBody+1]?.kind==='author'||/^[“"«]/.test(v)||(page.textSource==='sample-transcription'&&firstBody===0))p.kind='quote';}
    const result={title:index.key&&parsePrintedHeading(page.title)?dateLabel(index.key):page.title,weekday,fasting,feast,readings,parts,rawHeaderRanges:omit};
    cache.set(page,result);return result;
}
