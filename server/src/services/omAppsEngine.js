const {spawn}=require('node:child_process');
const path=require('node:path');
const {getTenantPool}=require('../config/db');
const {ViewerError}=require('./omViewerPolicy');
const engineRoot=path.resolve(__dirname,'../../apps/importer');
function tenantSettings(churchId,database){
 const tenant=getTenantPool(churchId),c=tenant.pool?.config?.connectionConfig||tenant.config?.connectionConfig;
 if(!c||typeof c.password!=='string')throw Error('Tenant database configuration is unavailable.');
 return {host:c.host||'localhost',port:c.port||3306,user:c.user,password:c.password,database,transport:c.socketPath?'socket':'tcp',socket:c.socketPath||''};
}
function runEngine(request,{database,settings}={}){
 const input=JSON.stringify(request);if(Buffer.byteLength(input)>30_000_000)throw Error('Request exceeds 30 MB.');
 return new Promise((resolve,reject)=>{
  const child=spawn(process.env.OM_IMPORTER_PYTHON||path.join(engineRoot,'.venv/bin/python'),['-m','om_importer.desktop_bridge'],{cwd:engineRoot,env:{...process.env,PYTHONPATH:path.join(engineRoot,'src'),PYTHONUTF8:'1',OM_IMPORTER_DATABASE:database,OM_IMPORTER_DB_HOST:settings?.host||'localhost'},stdio:['pipe','pipe','ignore']});
  let output='',done=false;const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const timer=setTimeout(()=>{child.kill();finish(Error('Importer timed out. Review destination and staging tables before retrying a database import.'));},request.operation==='execute_import'?600000:120000);
  child.on('error',()=>finish(Error('Importer engine is not installed.')));child.stdin.on('error',()=>finish(Error('Importer input failed.')));
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>40_000_000){child.kill();finish(Error('Importer response exceeds 40 MB.'));}});
  child.on('close',code=>{if(done)return;try{const response=JSON.parse(output);if(code||!response.ok)return finish(new ViewerError(400,response.error||'Importer failed.'));finish(null,response.result);}catch{finish(Error('Importer returned an invalid response.'));}});
  child.stdin.end(input);
 });
}
module.exports={runEngine,tenantSettings};
