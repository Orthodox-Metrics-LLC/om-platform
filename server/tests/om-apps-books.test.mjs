import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createBackend} from '../apps/book-intake/build-server/backend.mjs';
test('hosted books use trusted website identity, refresh roles, preserve grants and isolate churches',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'om-books-test-'));
 const one=createBackend({dataDir:join(dir,'46'),externalIdentity:req=>req.identity}),two=createBackend({dataDir:join(dir,'47'),externalIdentity:req=>req.identity});
 const admin={id:7,displayName:'Website admin',role:'administrator'},reader={id:8,displayName:'Reader',role:'reader'};
 async function call(backend,path,method='GET',payload,identity=admin){const req=Readable.from([]);Object.assign(req,{url:path,method,identity,body:payload,headers:{host:'test.local',origin:'https://test.local','x-om-reader':'1','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}});let result;const res={writableEnded:false,writeHead(status){this.status=status;},setHeader(){},end(body){this.writableEnded=true;result={status:this.status,data:JSON.parse(body)};}};await backend.middleware(req,res,()=>{throw Error('Unexpected fallthrough');});return result;}
 try{
  assert.equal((await call(one,'/api/auth/status')).data.user.id,'om_7');
  assert.equal((await call(one,'/api/auth/status')).data.setupRequired,false);
  for(const p of ['/api/auth/setup','/api/auth/login','/api/admin/users','/api/admin/restore'])assert.equal((await call(one,p,'POST',{})).status,403);
  const created=await call(one,'/api/books','POST',{title:'Hosted test'});assert.equal(created.status,201);const id=created.data.id;
  assert.equal((await call(two,'/api/books')).data.length,0);
  assert.equal((await call(one,'/api/books','GET',undefined,reader)).data.length,0);
  assert.equal((await call(one,'/api/books/'+id+'/access','PUT',{userId:'om_8',level:'read'})).status,200);
  assert.equal(one.db.prepare('SELECT actor_id FROM audit_events WHERE action=?').get('book.create').actor_id,'om_7');
  assert.equal((await call(one,'/api/admin/users','GET',undefined,{...admin,role:'reader'})).status,403);
  assert.equal((await call(one,'/api/books','GET',undefined,null)).status,401);
 }finally{one.close();two.close();rmSync(dir,{recursive:true,force:true});}
});
