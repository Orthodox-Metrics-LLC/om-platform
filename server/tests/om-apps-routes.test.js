const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createRequire}=require('node:module');
const express=require('express');
test('hosted HTTP routes enforce role, CSRF, church, source ownership and one-use reviewed imports',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'om-app-routes-')),route=path.resolve(__dirname,'../src/routes/om-apps.js'),localRequire=createRequire(route),executions=[];
 const user={id:7,email:'member@test',role:'deacon',church_id:46,is_active:1},pool={query:async sql=>[sql.includes('FROM users')?[user]:[{id:46,name:'Church',database_name:'om_church_46'}]]};
 const mockEngine={tenantSettings:()=>({host:'localhost',user:'private',password:'secret',database:'om_church_46'}),runEngine:async(request,context)=>{executions.push({request,context});return request.operation==='import_preflight'?{plan:{target:{table:'new_table'},review_sha256:'review-sha'}}:{operation:request.operation};}};
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync(route,'utf8'),{require:name=>name==='../config/db-compat'?{getAppPool:()=>pool}:name==='../services/omAppsEngine'?mockEngine:localRequire(name),module:mod,exports:mod.exports,__dirname:path.dirname(route),process:{env:{OM_APPS_DATA_DIR:directory}},Buffer,console});
 const session={user:{id:7},omAppsCsrf:'csrf-token',save:cb=>cb()};const app=express();app.use(express.json());app.use((req,res,next)=>{req.session=req.headers['x-test-anonymous']?{}:session;next();});app.use(mod.exports);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 async function post(body,headers={}){const r=await fetch(base+'/apps/importer/api/operation',{method:'POST',headers:{'Content-Type':'application/json','X-OM-Apps-CSRF':'csrf-token',...headers},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
 try{
  assert.equal((await fetch(base+'/apps/',{headers:{'X-Test-Anonymous':'1'},redirect:'manual'})).status,302);
  assert.equal((await fetch(base+'/apps/')).status,200);
  assert.equal((await fetch(base+'/apps/launcher.js')).status,200);
  assert.equal((await post({operation:'validate',package:{}})).status,200);
  assert.equal((await post({operation:'validate'},{'X-OM-Apps-CSRF':'wrong'})).status,403);
  assert.equal((await post({operation:'validate',churchId:47})).status,403);
  user.role='viewer';assert.equal((await post({operation:'validate'})).status,403);user.role='deacon';
  assert.equal((await post({operation:'extract',token:'../../private'})).status,400);
  await post({operation:'correct',package:{},actor:'forged',settings:{password:'forged'},record_id:'1',note:'test'});
  assert.equal(executions.at(-1).request.actor,'member@test (#7)');assert.equal(executions.at(-1).request.settings,undefined);
  assert.equal((await post({operation:'execute_import',package:{},reviewToken:'missing',table:'new_table'})).status,409);
  const review=await post({operation:'import_preflight',package:{revision:1}});assert.equal(review.status,200);const token=review.data.result.token;
  const payload={operation:'execute_import',package:{revision:1},reviewToken:token,table:'new_table'};
  assert.equal((await post(payload)).status,200);assert.equal(executions.at(-1).request.review_sha256,'review-sha');
  assert.equal((await post(payload)).status,409);
  const form=new FormData();form.append('source',new Blob(['fixture']),'Original.xlsx');const response=await fetch(base+'/apps/importer/api/source',{method:'POST',headers:{'X-OM-Apps-CSRF':'csrf-token'},body:form});assert.equal(response.status,200);
  assert.ok(executions.at(-1).request.source.endsWith('/Original.xlsx'));
  session.user.id=8;user.id=8;const source=await response.json();assert.equal((await post({operation:'inspect',token:source.result.token})).status,404);
  user.is_active=0;assert.equal((await post({operation:'validate'})).status,401);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
});
