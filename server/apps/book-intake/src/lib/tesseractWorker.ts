import { createWorker } from 'tesseract.js';
let engine:Awaited<ReturnType<typeof createWorker>>;
self.onmessage=async({data})=>{try{
 if(data.action==='init'){engine=await createWorker('eng',1,{...data.options,logger:p=>self.postMessage({progress:p})});self.postMessage({id:data.id,result:true});}
 else {const result=data.action==='parameters'?await engine.setParameters(data.value):await engine.recognize(data.value,{}, {text:true,blocks:true});self.postMessage({id:data.id,result});}
}catch(e){self.postMessage({id:data.id,error:e instanceof Error?e.message:String(e)});}};
