import { useMemo, useRef, useState } from 'react';
import type { BookPage, LibraryState } from '../types';
import { auditDates, dateLabel, resolvePrintedDate } from '../lib/dates';
import { rebuildDateIndex, saveHeaderDate } from '../lib/dateMaintenance';
import { getDatabaseName, readLibrary } from '../lib/db';
import { createOCREngine } from '../lib/ocr';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';

export function DateRepairDialog({state,onClose}:{state:LibraryState;onClose:()=>void}){
    const audit=useMemo(()=>auditDates(state.pages),[state.pages]);
    const [busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('');
    const cancelled=useRef(false),controller=useRef<AbortController>();const [month,setMonth]=useState('09');
    const suspects=state.pages.filter(p=>audit.suspectIds.includes(p.id)&&p.manualDate===undefined);
    const scan=async(all:boolean)=>{
        const database=getDatabaseName();setBusy(true);setError('');setMessage('');cancelled.current=false;controller.current=new AbortController();
        let engine:Awaited<ReturnType<typeof createOCREngine>>|undefined;let saved=0,unresolved=0;
        try{
            await rebuildDateIndex(database);
            const current=await readLibrary(database),report=auditDates(current.pages);
            const pages=current.pages.filter(p=>p.manualDate===undefined&&(all||report.suspectIds.includes(p.id)));
            if(!pages.length){setMessage('No suspect date headers remain. Existing text has been reindexed.');return;}
            setProgress('Loading OCR for date headers…');engine=await createOCREngine(()=>{},controller.current.signal);
            for(let i=0;i<pages.length;i++){
                if(cancelled.current)break;
                const page=pages[i];setProgress(`Checking printed header ${i+1} of ${pages.length} · ${page.title}`);
                try{const result=await engine.recognizeHeader(page);if(cancelled.current)break;if(await saveHeaderDate(page,result,database))saved++;else unresolved++;}
                catch(e){unresolved++;setError(`A header could not be checked: ${e instanceof Error?e.message:String(e)}`);}
            }
            setMessage(`${saved} printed date headers saved. ${unresolved} could not be resolved automatically.${cancelled.current?' Stopped after the current page.':''} Body text, approval and personal notes were not changed.`);
        }catch(e){setError(e instanceof Error?e.message:String(e));}
        finally{try{await engine?.terminate();}catch{}setBusy(false);setProgress('');}
    };
    const reindex=async()=>{setBusy(true);setError('');try{const r=await rebuildDateIndex();setMessage(`${r.changed} page indexes repaired from existing text and word locations. ${r.skipped} changed concurrently and were left untouched.`);}catch(e){setError(String(e));}finally{setBusy(false);}};
    const monthPages=state.pages.filter(p=>{const i=resolvePrintedDate(p);return i.status==='resolved'&&i.key.startsWith(month+'-');});
    return <Modal wide locked={busy} title="Repair dates & reading structure" description="Whole-book maintenance. No reimport, repeated approval or replacement of your reading text." onClose={onClose}>
        <div className="date-quality-stats"><div><strong>{audit.indexed}</strong><span>dated pages</span></div><div><strong>{audit.uniqueDays}</strong><span>distinct days</span></div><div><strong>{audit.suspectIds.length}</strong><span>headers to check</span></div><div><strong>{audit.undated}</strong><span>without a date</span></div></div>
        <div className="notice"><Icon name="scan" size={22}/><p>The new index reads complete day numbers—including OCR forms such as <strong>2.7 → 27</strong>. Uncertain dates can be recovered directly from each page's printed header. A neighbor's date is never used to invent a missing one.</p></div>
        <div className="button-row repair-actions"><button className="button secondary" disabled={busy} onClick={()=>void reindex()}><Icon name="refresh" size={17}/>Rebuild from existing OCR</button><button className="button primary" disabled={busy||!suspects.length} onClick={()=>void scan(false)}><Icon name="scan" size={17}/>Repair suspect headers ({suspects.length})</button></div>
        <p className="field-help">Header repair uses the configured OCR provider and crops already stored in the book. With LlamaParse enabled, header images are uploaded to LlamaCloud. It reads only the upper header region, not the full page bodies. Choose your provider in Administration. Manual date overrides are preserved.</p>
        {busy&&<div className="repair-progress" role="status"><span className="spinner"/><span>{progress||'Rebuilding date index…'}</span><button className="button secondary small" onClick={()=>{cancelled.current=true;controller.current?.abort();setMessage('OCR cancelled. Saved date headers are preserved.');}}>Cancel now</button></div>}
        {message&&<p className="notice" role="status">{message}</p>}{error&&<p className="error-list" role="alert">{error}</p>}
        <details className="repair-details"><summary>Verify every printed header</summary><p>Use this after upgrading an older OCR book with widespread date errors. All non-manual headers are checked in one job; only date metadata and generated page titles can change. Books may legitimately contain undated front matter and multiple pages for a date.</p><button className="button secondary" disabled={busy} onClick={()=>void scan(true)}>Check all date headers ({state.pages.filter(p=>p.manualDate===undefined).length})</button></details>
        <section className="date-coverage"><div className="panel-heading"><h3>Printed date coverage</h3><select aria-label="Coverage month" value={month} onChange={e=>setMonth(e.target.value)}>{Array.from({length:12},(_,i)=><option key={i} value={String(i+1).padStart(2,'0')}>{dateLabel(`${String(i+1).padStart(2,'0')}-01`).replace(' 1','')}</option>)}</select></div><div className="coverage-grid">{Array.from({length:new Date(2000,Number(month),0).getDate()},(_,i)=>{const key=`${month}-${String(i+1).padStart(2,'0')}`,found=monthPages.filter(p=>resolvePrintedDate(p).key===key);return <div key={key} className={found.length?'covered':'not-indexed'} title={found.length?`${found.length} indexed page(s)`:'No reliable indexed page yet'}><strong>{i+1}</strong><small>{found.length?`${found.length} page${found.length===1?'':'s'}`:'—'}</small></div>;})}</div><p className="field-help">An unindexed day does not mean its scan is missing. February 29 is shown when present; no leap year or liturgical calendar is assumed.</p></section>
        <details className="repair-details"><summary>Show remaining suspect pages ({suspects.length})</summary><div className="repair-page-list">{suspects.map(p=><div key={p.id}><strong>{state.pages.indexOf(p)+1} · {p.title}</strong><span>{p.sourceName}</span><small>{resolvePrintedDate(p).evidence||'No reliable printed date'}</small></div>)}</div></details>
        <div className="notice subtle"><p>Reading structure is now derived without rewriting the transcript: date, weekday, fasting, references, quotations, headings and commemorations get separate formatting. A garbled word in body OCR is not silently replaced with invented text. Original scans remain the reference.</p></div>
        <div className="modal-footer"><p>This is index maintenance, not a new proofreading approval.</p><button className="button primary" disabled={busy} onClick={onClose}>Done</button></div>
    </Modal>;
}
