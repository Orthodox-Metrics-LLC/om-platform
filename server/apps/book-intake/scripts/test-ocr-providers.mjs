import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createOCRMiddleware} from '../build-server/ocr.mjs';
let settings={},calls=[],reply={responses:[{fullTextAnnotation:{text:'Test page'}}]};
const middleware=createOCRMiddleware(settings,async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(reply),{status:200,headers:{'Content-Type':'application/json'}});});
const server=createServer((req,res)=>void middleware(req,res,()=>{res.writeHead(404);res.end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
let checks=0;const check=(v)=>{assert.ok(v);checks++;};
const parse=()=>fetch(base+'/api/ocr/parse',{method:'POST',headers:{'Content-Type':'image/png'},body:Buffer.from('test-image')});
try{
 check((await (await fetch(base+'/api/ocr/config')).json()).provider==='none');check((await parse()).status===503);check(calls.length===0);
 Object.assign(settings,{OCR_PROVIDER:'google-vision',GOOGLE_VISION_API_KEY:'private-google-key'});
 let r=await parse();check(r.status===200);check((await r.json()).text==='Test page');check(calls[0].options.headers['X-Goog-Api-Key']==='private-google-key');check(!calls[0].url.includes('private-google-key'));check(JSON.parse(calls[0].options.body).requests[0].features[0].type==='DOCUMENT_TEXT_DETECTION');
 reply={responses:[{error:{message:'upstream private-google-key'}}]};r=await parse();check(r.status===502);check(!(await r.text()).includes('private-google-key'));
 settings.OCR_PROVIDER='llamaparse';settings.LLAMA_CLOUD_API_KEY='private-llama-key';let step=0;
 calls=[];reply={};
 const llama=createOCRMiddleware(settings,async()=>new Response(JSON.stringify(step++===0?{id:'file'}:step===2?{id:'job'}:{status:'COMPLETED',text:{pages:[{text:'Llama text'}]}}),{status:200}));
 server.removeAllListeners('request');server.on('request',(req,res)=>void llama(req,res,()=>{}));r=await parse();check(r.status===200);check((await r.json()).text==='Llama text');
 settings.LLAMA_PARSE_TIMEOUT_MS='20';const slow=createOCRMiddleware(settings,async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true})));server.removeAllListeners('request');server.on('request',(req,res)=>void slow(req,res,()=>{}));r=await parse();check(r.status===502);check((await r.json()).error.includes('timed out'));
 console.log(`${checks} OCR provider checks passed.`);
}finally{await new Promise(r=>server.close(r));}
