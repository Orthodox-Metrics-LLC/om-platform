import { useRef, useState } from 'react';
import type { BookPage } from '../types';
import { createOCREngine } from '../lib/ocr';
import { readLibrary, updatePageText } from '../lib/db';
import { repairPageDate } from '../lib/dates';
import { recordOCRFailure } from '../lib/reviewStore';
export function useOCR(notify: (text: string) => void) {
    const [job, setJob] = useState<{current:number;total:number;progress:number;status:string} | null>(null);
    const busy = useRef(false), cancelled = useRef(false), controller = useRef<AbortController>();
    const start = async (pages: BookPage[]) => {
        if (busy.current || !pages.length) return;
        if (pages.some(p => p.text.trim()) && !confirm('Replace the text on these pages with fresh OCR? Existing highlights will be reattached where possible or flagged. Original images are unchanged.')) return;
        busy.current = true; cancelled.current = false;controller.current=new AbortController();
        setJob({current:0,total:pages.length,progress:0,status:'Connecting to selected OCR provider…'});
        let engine: Awaited<ReturnType<typeof createOCREngine>> | undefined, completed = 0;
        const failures: string[] = [];
        try {
            engine = await createOCREngine(p => setJob(j => j ? {...j,progress:Math.round(p.progress*100),status:p.status} : j),controller.current.signal);
            for (let i=0;i<pages.length;i++) {
                if (cancelled.current) break;
                const p = pages[i]; setJob({current:i+1,total:pages.length,progress:0,status:p.title});
                try {
                    const result = await engine.recognize(p);
                    if(cancelled.current)break;
                    if (!result.text.trim()) throw new Error('No readable text found. Check the crop and orientation.');
                    const latest = await readLibrary(), current = latest.pages.find(x => x.id === p.id);
                    if (latest.publication?.status === 'published') { cancelled.current = true; throw new Error('The book was published in another tab. OCR stopped without replacing the published text.'); }
                    if (!current || current.textVersion !== p.textVersion || current.cropVersion !== p.cropVersion) throw new Error('The page changed during OCR; the new result was not saved.');
                    if(cancelled.current)break;
                    const indexed = repairPageDate({...current,text:result.text,textVersion:current.textVersion+1,textSource:'ocr',dateIndex:undefined,words:result.words});
                    await updatePageText(current,result.text,latest.annotations,{textSource:'ocr',reviewed:false,review:undefined,ocrError:undefined,words:result.words,confidence:result.confidence,dateKey:indexed.dateKey,title:indexed.title,dateIndex:indexed.dateIndex});
                    completed++;
                } catch(e) {
                    if(cancelled.current)break;
                    const message = e instanceof Error ? e.message : String(e); failures.push(message);
                    if (!cancelled.current) { try { await recordOCRFailure(p,message); } catch { /* surfaced in summary */ } }
                }
            }
            notify(`${completed} pages transcribed${cancelled.current?' · Cancelled':''}.${failures.length?` ${failures.length} need attention. ${failures[0]}`:' Continue to verification or publish with bulk acceptance.'}`);
        } catch(e) { notify(cancelled.current?'OCR cancelled. Previously saved pages are preserved.':e instanceof Error?e.message:String(e)); }
        finally { try {await engine?.terminate();} catch {} busy.current=false;setJob(null); }
    };
    const stop = () => {cancelled.current=true;controller.current?.abort();notify('OCR cancelled. Previously saved pages are preserved.');};
    return {job,start,stop};
}
