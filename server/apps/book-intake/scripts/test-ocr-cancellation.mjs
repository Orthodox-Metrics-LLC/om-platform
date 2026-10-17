import {build} from 'esbuild';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'ocr-worker-'));await build({entryPoints:['src/lib/ocrWorker.ts'],bundle:true,platform:'browser',format:'esm',outfile:join(dir,'worker.mjs')});
let workers=[];class FakeWorker{constructor(){this.terminated=false;workers.push(this);}postMessage(data){this.last=data;}terminate(){this.terminated=true;}}
globalThis.Worker=FakeWorker;const {startLocalOCR}=await import(pathToFileURL(join(dir,'worker.mjs')));
try{
 const cancel=new AbortController();const pending=startLocalOCR({},()=>{},cancel.signal);cancel.abort();await assert.rejects(pending,/cancelled/);assert.ok(workers[0].terminated);
 const active=new AbortController(),ready=startLocalOCR({},()=>{},active.signal);const worker=workers[1];worker.onmessage({data:{id:worker.last.id,result:true}});const engine=await ready;const recognition=engine.recognize(new Blob(['scan']));active.abort();await assert.rejects(recognition,/cancelled/);assert.ok(worker.terminated);
 const nativeTimer=globalThis.setTimeout;globalThis.setTimeout=(fn)=>nativeTimer(fn,1);await assert.rejects(startLocalOCR({},()=>{},new AbortController().signal),/initialization timed out/);assert.ok(workers[2].terminated);globalThis.setTimeout=nativeTimer;
 console.log('6 OCR cancellation and timeout checks passed.');
}finally{await rm(dir,{recursive:true,force:true});}
