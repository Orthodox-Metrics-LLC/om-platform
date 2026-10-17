import { useState } from 'react';
import { api } from '../lib/backend';
import { catalogEvents } from '../lib/catalog';
import { validateManifest, defaultBook, defaultPrefs } from '../lib/db';
const req=<T,>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
export function BrowserMigration(){
    const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
    const migrate=async()=>{
        setBusy(true);setMessage('Checking this browser…');let count=0;
        try{
            if(!indexedDB.databases)throw new Error('Use an OM book backup to migrate from this browser.');
            const databases=await indexedDB.databases();let catalog:any[]=[];
            if(databases.some(d=>d.name==='om-book-catalog-v1')){const db=await req(indexedDB.open('om-book-catalog-v1'));try{catalog=await req(db.transaction('books').objectStore('books').getAll());}finally{db.close();}}
            for(const info of databases){
                const name=info.name;if(!name||!(name==='om-book-reader-v1'||name.startsWith('om-book-data-')))continue;
                const opening=indexedDB.open(name);opening.onupgradeneeded=()=>opening.transaction?.abort();const db=await req(opening);
                let pages:any[],sources:any[],annotations:any[],bookmarks:any[],settings:any[];
                try{const tx=db.transaction(['pages','sources','annotations','bookmarks','settings']);[pages,sources,annotations,bookmarks,settings]=await Promise.all(['pages','sources','annotations','bookmarks','settings'].map(s=>req(tx.objectStore(s).getAll())));}finally{db.close();}
                if(!pages.length&&!settings.some(s=>s.id==='book'))continue;
                const manifest=validateManifest({format:'om-book',version:1,kind:'backup',pages,sources:sources.map(({blob,...s})=>s),annotations,bookmarks,book:settings.find(s=>s.id==='book')?.value||defaultBook,prefs:{...defaultPrefs,...settings.find(s=>s.id==='prefs')?.value},publication:settings.find(s=>s.id==='publication')?.value||{status:'draft'}});
                const entry=catalog.find(b=>b.database===name);if(entry?.purged||entry?.sample||(pages.length===4&&['opening','january-01','december-30','december-31'].every(id=>pages.some(p=>p.id===id&&p.textSource==='sample-transcription'))))continue;
                const payload={origin:location.origin,database:name,manifest,abandoned:!!entry?.abandoned};
                const staged=await api<any>('/api/migrate/start',{method:'POST',body:JSON.stringify(payload)});if(staged.completed)continue;
                for(const s of sources){setMessage(`Copying ${manifest.book.title}: ${s.name}`);const bytes=new Uint8Array(await s.blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));await api(`/api/books/${staged.id}/assets`,{method:'POST',body:JSON.stringify({...s,blob:undefined,bytes:btoa(binary)})});}
                const result=await api<any>('/api/migrate',{method:'POST',body:JSON.stringify(payload)});
                if(result.imported)count++;
            }
            catalogEvents.dispatchEvent(new Event('change'));setMessage(`${count} book(s) migrated. Existing browser books were preserved. Previously migrated books were skipped.`);
        }catch(e){setMessage(String(e));}finally{setBusy(false);}
    };
    return <section><h3>Migrate browser books</h3><p className="field-help">Run this in the original browser and address where you imported books. Copies books and this browser's notes to your account. Other browsers can then use the shared library.</p><button className="button secondary" disabled={busy} onClick={()=>void migrate()}>{busy?'Migrating…':'Copy this browser’s books'}</button>{message&&<p role="status">{message}</p>}</section>;
}
