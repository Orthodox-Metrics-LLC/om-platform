/** Real local HTTP requests, deterministic fake Azure upstream. No credentials or paid requests. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createNarrationMiddleware } from '../server/narration.mjs';
let count=0;
const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS',name);count++;};
async function fixture(env={},upstream=async()=>new Response(new Uint8Array([73,68,51,0,1]),{status:200})) {
  const middleware=createNarrationMiddleware(env,upstream);
  const server=http.createServer((req,res)=>void middleware(req,res,()=>{res.writeHead(404);res.end('not found');}));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,request:(route='/synthesize',options={})=>fetch(origin+'/api/narration'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-OM-Reader':'1'},body:JSON.stringify({text:'Read this passage.',preset:'us-female',rate:.95}),...options}),close:()=>new Promise(resolve=>server.close(resolve))};
}
const env={OM_AZURE_SPEECH_KEY:'TEST-ONLY-SECRET',OM_AZURE_SPEECH_REGION:'eastus'};
let calls=[];
let f=await fixture();
try {
 let r=await f.request('/status',{method:'GET',body:undefined});check('No credentials reports unconfigured',(await r.json()).configured===false);
 r=await f.request();check('Unconfigured synthesis is a clear 503',r.status===503);
 check('Unconfigured response does not pretend to contain audio',(r.headers.get('Content-Type')||'').includes('json'));
}finally{await f.close();}
f=await fixture(env,async(url,options)=>{calls.push({url,options});return new Response(new Uint8Array([73,68,51,0,1]),{status:200});});
try {
 let r=await f.request('/status',{method:'GET',body:undefined});const status=await r.json();check('Configured status contains only a boolean',JSON.stringify(status)==='{"configured":true}');
 r=await f.request('/synthesize',{method:'GET',body:undefined});check('Synthesis requires POST',r.status===405);
 r=await f.request('/synthesize',{headers:{Origin:'https://untrusted.example','Content-Type':'application/json','X-OM-Reader':'1'}});check('Cross-origin browser requests are rejected',r.status===403);
 r=await f.request('/synthesize',{headers:{Origin:f.origin,'Content-Type':'application/json'}});check('Missing anti-CSRF custom header is rejected',r.status===403);
 r=await f.request('/synthesize',{headers:{'Content-Type':'application/json','X-OM-Reader':'1'}});check('Missing origin is rejected',r.status===403);
 r=await f.request('/synthesize',{headers:{Origin:f.origin,'Content-Type':'text/plain','X-OM-Reader':'1'}});check('Non-JSON requests are rejected',r.status===403);
 r=await f.request('/synthesize',{body:'not-json'});check('Malformed JSON is rejected before upstream',r.status===400);
 r=await f.request('/synthesize',{body:JSON.stringify({text:'test',preset:'random-url',rate:1})});check('Unknown speaker cannot alter upstream destination',r.status===400);
 r=await f.request('/synthesize',{body:JSON.stringify({text:'test',preset:'uk-male',rate:20})});check('Invalid speed is rejected',r.status===400);
 r=await f.request('/synthesize',{body:JSON.stringify({text:'x'.repeat(1401),preset:'uk-male',rate:1})});check('Excessively long phrase is rejected',r.status===400);
 check('Validation failures made no upstream calls',calls.length===0);
 for(const [preset,voice] of [['us-female','en-US-JennyNeural'],['us-male','en-US-GuyNeural'],['uk-female','en-GB-SoniaNeural'],['uk-male','en-GB-RyanNeural']]) {
   r=await f.request('/synthesize',{body:JSON.stringify({text:'A <tag> & "words"',preset,rate:.95})});
   const bytes=await r.arrayBuffer();check(`${preset} returns the requested audio bytes`,r.status===200&&bytes.byteLength===5);
   check(`${preset} maps to its genuine distinct neural voice`,calls.at(-1).options.body.includes(`name="${voice}"`));
 }
 check('Only the configured Azure endpoint is used',calls.every(c=>c.url==='https://eastus.tts.speech.microsoft.com/cognitiveservices/v1'));
 check('Provider key is server-side request header only',calls.every(c=>c.options.headers['Ocp-Apim-Subscription-Key']===env.OM_AZURE_SPEECH_KEY));
 check('User text is XML-escaped',calls.at(-1).options.body.includes('A &lt;tag&gt; &amp; &quot;words&quot;'));
 check('Audio response is not cached',r.headers.get('Cache-Control')==='no-store');
 check('Audio response has safe content type',r.headers.get('Content-Type')==='audio/mpeg');
 let limited=false;for(let i=0;i<92;i++){r=await f.request();await r.arrayBuffer();if(r.status===429){limited=true;break;}}
 check('Per-client rate limit stops excessive synthesis',limited);
}finally{await f.close();}
for(const upstreamStatus of [401,429,503]){
 f=await fixture(env,async()=>new Response('SECRET upstream details',{status:upstreamStatus}));
 try{const r=await f.request();const body=await r.text();check(`Provider ${upstreamStatus} is sanitized for the client`,r.status===(upstreamStatus===429?429:502)&&!body.includes('SECRET')&&!body.includes(env.OM_AZURE_SPEECH_KEY));}finally{await f.close();}
}
f=await fixture(env,async()=>{throw new Error('private key detail');});
try{const r=await f.request();check('Transport failures are sanitized',r.status===502&&!(await r.text()).includes('private key'));}finally{await f.close();}
f=await fixture({...env,OM_AZURE_SPEECH_REGION:'evil.example/path'});
try{const r=await f.request('/status',{method:'GET',body:undefined});check('Unsafe region configuration is disabled',(await r.json()).configured===false);}finally{await f.close();}
console.log(`\n${count} server HTTP tests passed. Azure upstream was mocked; no live speech was requested.`);
