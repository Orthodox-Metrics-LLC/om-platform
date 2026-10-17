export async function startLocalOCR(options:Record<string,unknown>,progress:(p:any)=>void,signal:AbortSignal){
 const worker=new Worker(new URL('./tesseractWorker.ts',import.meta.url),{type:'module'});
 let counter=0;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const terminate=()=>{worker.terminate();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(signal.aborted?'OCR cancelled.':'OCR worker stopped.'));}pending.clear();signal.removeEventListener('abort',terminate);};
 signal.addEventListener('abort',terminate,{once:true});
 worker.onmessage=({data})=>{if(data.progress){if(!signal.aborted)progress(data.progress);return;}const p=pending.get(data.id);if(!p)return;clearTimeout(p.timer);pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result);};
 worker.onerror=()=>terminate();
 const call=(action:string,value?:unknown)=>new Promise<any>((resolve,reject)=>{if(signal.aborted){reject(new Error('OCR cancelled.'));return;}const id=++counter;const timer=setTimeout(()=>{reject(new Error(action==='init'?'OCR initialization timed out after 60 seconds. Select a cloud provider in Administration or retry.':'OCR page timed out after 5 minutes.'));terminate();},action==='init'?60000:300000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,action,value,options});});
 try{await call('init');}catch(e){terminate();throw e;}
 return {setParameters:(value:unknown)=>call('parameters',value),recognize:(value:Blob,..._options:unknown[])=>call('recognize',value),terminate:async()=>terminate()};
}
