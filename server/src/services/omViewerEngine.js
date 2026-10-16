const path=require('node:path');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const {getTenantPool}=require('../config/db');
const {ViewerError}=require('./omViewerPolicy');
async function runResource({churchId,database,action,query}){
 const engineRoot=path.resolve(__dirname,'../../viewer-engine');
 const python=process.env.OM_VIEWER_PYTHON || path.join(engineRoot,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 if(!fs.existsSync(python))throw Error('Viewer engine is not installed.');
 const tenant=getTenantPool(churchId);
 const config=tenant.pool?.config?.connectionConfig || tenant.config?.connectionConfig;
 if(!config || typeof config.password!=='string')throw Error('Tenant connection configuration is unavailable.');
 const settings={host:config.host||'localhost',port:config.port||3306,user:config.user,password:config.password,database,transport:config.socketPath?'socket':'tcp',socket:config.socketPath||''};
 const input=JSON.stringify({operation:'resource',settings,action,query});
 if(Buffer.byteLength(input)>30_000_000)throw Error('Request too large.');
 return new Promise((resolve,reject)=>{
  const child=spawn(python,['-m','om_viewer.bridge'],{cwd:engineRoot,env:{...process.env,PYTHONPATH:path.join(engineRoot,'src'),PYTHONUTF8:'1'},windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});
  let output='',done=false;
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const timer=setTimeout(()=>{child.kill();finish(Error('Viewer operation timed out.'));},120000);
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>40_000_000){child.kill();finish(Error('Viewer response too large.'));}});
  child.on('error',()=>finish(Error('Viewer engine could not start.')));
  child.stdin.on('error',()=>finish(Error('Viewer engine input failed.')));
  child.on('close',code=>{try{const data=JSON.parse(output);if(code!==0)return finish(Error('Viewer engine failed.'));if(!data.ok)return finish(new ViewerError(/Another change/.test(data.error||'')?409:400,data.error||'Viewer operation failed.'));finish(null,data.result);}catch{finish(Error('Viewer engine returned an invalid response.'));}});
  child.stdin.end(input);
 });
}
module.exports={runResource};
