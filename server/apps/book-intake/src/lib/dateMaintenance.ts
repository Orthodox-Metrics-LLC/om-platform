import type { BookPage, DateIndex } from '../types';
import { changeEvent, getAll, getDatabaseName, openDB, readLibrary } from './db';
import { dateLabel, isGeneratedTitle, repairPageDate } from './dates';

/** Metadata-only, merge-on-write maintenance. Never writes text, versions, approval, personal data or originals. */
export async function rebuildDateIndex(database = getDatabaseName()): Promise<{changed:number;skipped:number}> {
    const state=await readLibrary(database), db=await openDB(database);let changed=0,skipped=0;
    await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction(['pages','settings'],'readwrite'), store=tx.objectStore('pages');
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        const history:{id:string;before:Pick<BookPage,'title'|'dateKey'|'dateIndex'>;after:Pick<BookPage,'title'|'dateKey'|'dateIndex'>}[]=[];
        const proposals=state.pages.map(snapshot=>({snapshot,proposal:repairPageDate(snapshot)})).filter(({snapshot,proposal})=>snapshot.title!==proposal.title||snapshot.dateKey!==proposal.dateKey||JSON.stringify(snapshot.dateIndex)!==JSON.stringify(proposal.dateIndex));
        let pending=proposals.length;
        const complete=()=>{pending--;if(!pending&&history.length)tx.objectStore('settings').put({id:'date-repair-v4-last',value:{at:new Date().toISOString(),changes:history}});};
        for(const {snapshot,proposal} of proposals){
            const req=store.get(snapshot.id);req.onsuccess=()=>{
                const current=req.result as BookPage|undefined;
                if(!current||current.textVersion!==snapshot.textVersion||current.cropVersion!==snapshot.cropVersion||current.title!==snapshot.title||current.dateKey!==snapshot.dateKey||current.manualDate!==snapshot.manualDate){skipped++;complete();return;}
                const before={title:current.title,dateKey:current.dateKey,dateIndex:current.dateIndex},after={title:proposal.title,dateKey:proposal.dateKey,dateIndex:proposal.dateIndex};
                store.put({...current,...after});changed++;history.push({id:current.id,before,after});complete();
            };
        }
    });
    changeEvent.dispatchEvent(new Event('change'));return {changed,skipped};
}
export async function migrateV04(database:string):Promise<void>{
    const settings=await getAll<{id:string;value:unknown}>('settings',database);
    if(settings.some(s=>s.id==='migration-v04'))return;
    await rebuildDateIndex(database);
    const db=await openDB(database);
    await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings'),req=store.get('book');
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        req.onsuccess=()=>{const book=req.result?.value;if(book&&/^(?:The )?Daily Reader$/i.test(book.title.trim()))store.put({id:'book',value:{...book,title:'OM Daily Reading'}});store.put({id:'migration-v04',value:{at:new Date().toISOString()}});};
    });changeEvent.dispatchEvent(new Event('change'));
}
export async function saveHeaderDate(snapshot:BookPage,result:{key:string;raw:string;confidence:number},database=getDatabaseName()):Promise<boolean>{
    const db=await openDB(database);let saved=false;
    await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction('pages','readwrite'),store=tx.objectStore('pages'),req=store.get(snapshot.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        req.onsuccess=()=>{
            const current=req.result as BookPage|undefined;
            if(!current||current.manualDate!==undefined||current.textVersion!==snapshot.textVersion||current.cropVersion!==snapshot.cropVersion||current.dateKey!==snapshot.dateKey||current.title!==snapshot.title)return;
            const dateIndex:DateIndex={version:4,key:result.key||current.dateKey,status:result.key?'resolved':'unverified',source:'header-ocr',evidence:result.raw.slice(0,2000),textVersion:current.textVersion,cropVersion:current.cropVersion,checkedAt:new Date().toISOString()};
            store.put({...current,dateIndex,dateKey:result.key||current.dateKey,title:result.key&&isGeneratedTitle(current.title)?dateLabel(result.key):current.title});saved=!!result.key;
        };
    });changeEvent.dispatchEvent(new Event('change'));return saved;
}
