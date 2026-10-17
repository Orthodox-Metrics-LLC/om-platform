import type { SourceAsset } from '../types';
export interface Account { id:string; loginName:string; displayName:string; role:'administrator'|'preparer'|'reader'; status:string; }
export let currentAccount: Account | null = null;
let useServer=false;
export const enableServerStorage=()=>{useServer=true;};
export const setAccount = (account:Account|null) => {currentAccount=account;if(account)useServer=true;};
export const serverStorage = () => useServer;
export async function api<T=any>(path:string, init:RequestInit={}) : Promise<T> {
    const response=await fetch(path,{...init,headers:{'Content-Type':'application/json','X-OM-Reader':'1',...init.headers}});
    const result=await response.json();
    if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('om-session-expired'));throw new Error(result.error||`Request failed (${response.status}).`);}
    return result;
}
let mode:'read'|'preparation'='preparation';
let selectedEdition:string|undefined;
export const setStorageEdition=(id?:string)=>{selectedEdition=id;};
export const setStorageMode=(value:'read'|'preparation')=>{mode=value;};
export const storageMode=()=>mode;
export const bookId=(name:string)=>name.replace(/^om-book-data-/,'');
type RecordValue = {id:string;[key:string]:any};
type Operation = {store:string;kind:'put'|'delete'|'clear';value?:RecordValue;id?:string};
interface Snapshot { editionId:string;revision:number;personalRevision:number;stores:Record<string,RecordValue[]>; }
const queues=new Map<string,Promise<unknown>>();
export async function remoteDB(name:string):Promise<IDBDatabase> {
    const id=bookId(name),selectedMode=mode,editionQuery=selectedEdition?`&edition=${selectedEdition}`:'';
    await queues.get(id)?.catch(()=>{});
    const snapshot=await api<Snapshot>(`/api/books/${id}/snapshot?mode=${selectedMode}${editionQuery}`);
    const transaction=(names:string|string[],access:IDBTransactionMode='readonly')=>{
        const allowed=typeof names==='string'?[names]:names;
        const stores=new Map(allowed.map(s=>[s,new Map((snapshot.stores[s]||[]).map(v=>[v.id,structuredClone(v)]))]));
        const ops:Operation[]=[];let pending=0,aborted=false,finished=false;
        const tx:any={error:null,oncomplete:null,onerror:null,onabort:null,abort(){if(finished)return;aborted=true;tx.error=new Error('Transaction cancelled.');queueMicrotask(()=>tx.onabort?.());}};
        const finish=()=>{if(pending||aborted||finished)return;finished=true;
            if(access==='readonly'||!ops.length){tx.oncomplete?.();return;}
            const save=async()=>{
                // Upload immutable bytes before the atomic metadata transaction; failed commits leave harmless unreferenced files.
                for(const op of ops)if(op.store==='sources'&&op.kind==='put'&&op.value?.blob instanceof Blob){
                    const source=op.value as unknown as SourceAsset,bytes=new Uint8Array(await source.blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
                    await api(`/api/books/${id}/assets`,{method:'POST',body:JSON.stringify({...source,blob:undefined,bytes:btoa(binary)})});
                    delete op.value!.blob;
                }
                await api(`/api/books/${id}/commit`,{method:'POST',body:JSON.stringify({mode:selectedMode,editionId:snapshot.editionId,revision:snapshot.revision,personalRevision:snapshot.personalRevision,ops})});
            };
            const previous=queues.get(id)||Promise.resolve();const operation=previous.catch(()=>{}).then(save);queues.set(id,operation);
            void operation.then(()=>tx.oncomplete?.(),(error)=>{tx.error=error;tx.onerror?.();});
        };
        const request=(result:unknown)=>{pending++;const req:any={result:structuredClone(result),error:null,onsuccess:null,onerror:null};queueMicrotask(()=>{if(!aborted){try{req.onsuccess?.();}catch(error){tx.error=error;aborted=true;tx.onabort?.();}}pending--;queueMicrotask(finish);});return req;};
        tx.objectStore=(store:string)=>{
            const rows=stores.get(store);if(!rows)throw new Error(`Store ${store} is outside this transaction.`);
            const write=()=>{if(access!=='readwrite')throw new Error('Read-only transaction.');if(aborted||finished)throw new Error('Transaction is inactive.');};
            return {get:(id:string)=>request(rows.get(String(id))),getAll:()=>request([...rows.values()]),getAllKeys:()=>request([...rows.keys()]),
                put:(value:RecordValue)=>{write();const v=structuredClone(value);rows.set(v.id,v);ops.push({store,kind:'put',value:v});return request(v.id);},
                delete:(id:string)=>{write();rows.delete(String(id));ops.push({store,kind:'delete',id:String(id)});return request(undefined);},
                clear:()=>{write();rows.clear();ops.push({store,kind:'clear'});return request(undefined);}};
        };
        // Match IndexedDB's callback ordering, including transactions with no requests.
        setTimeout(finish,0);return tx as IDBTransaction;
    };
    return {transaction,close(){}} as unknown as IDBDatabase;
}
export async function remoteSource(name:string,id:string):Promise<SourceAsset>{
    const selectedMode=mode,editionQuery=selectedEdition?`&edition=${selectedEdition}`:'',book=bookId(name),snapshot=await api<Snapshot>(`/api/books/${book}/snapshot?mode=${selectedMode}${editionQuery}`);
    const s=snapshot.stores.sources.find(s=>s.id===id);if(!s)throw new Error('The original scan is missing.');
    const response=await fetch(`/api/books/${book}/assets/${id}?mode=${selectedMode}${editionQuery}`);if(!response.ok)throw new Error('Could not load original scan.');return {...s,blob:await response.blob()} as SourceAsset;
}
