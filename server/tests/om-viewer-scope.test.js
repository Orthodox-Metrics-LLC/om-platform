const {test}=require('node:test');const assert=require('node:assert/strict');
const {viewerClientScope}=require('../src/middleware/viewerClientScope');
const {isViewerLogin,establishViewerSession}=require('../src/services/omViewerLogin');
function access(path,client){let passed=false;const res={statusCode:200,status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;},send(data){this.data=data;return this;}};viewerClientScope({path,session:{client}},res,()=>{passed=true;});return {passed,status:res.statusCode};}
test('viewer session is denied portal, homepage and general website APIs',()=>{for(const path of ['/','/portal','/dashboard','/api/baptism-records','/api/auth/refresh','/api/admin/users']){const result=access(path,'om-viewer');assert.equal(result.passed,false);assert.equal(result.status,403);}});
test('viewer auth endpoints, completion and static assets remain available',()=>{for(const path of ['/auth/login','/auth/viewer-complete','/assets/app.js','/api/auth/login','/api/auth/check','/api/om-viewer/session','/api/om-viewer/resource'])assert.equal(access(path,'om-viewer').passed,true);});
test('ordinary website sessions retain normal portal and API navigation',()=>{for(const path of ['/','/portal','/api/baptism-records']){assert.equal(access(path,undefined).passed,true);assert.equal(access(path,'website').passed,true);}});
test('relogin cannot upgrade an existing viewer session into a website session',()=>{assert.equal(isViewerLogin({body:{client:'website'},session:{client:'om-viewer'}}),true);assert.equal(isViewerLogin({body:{client:'om-viewer'}}),true);assert.equal(isViewerLogin({body:{}}),false);});
test('viewer login rotates and saves a restricted session without issuing tokens',async()=>{
 let saved=false,rotated=false;const req={session:{regenerate(done){rotated=true;req.session={save(callback){saved=true;callback();}};done();}}};
 const user=await establishViewerSession(req,{id:12,email:'member@test',role:'deacon',church_id:46});
 assert.equal(rotated,true);assert.equal(saved,true);assert.equal(req.session.client,'om-viewer');assert.equal(user.id,12);assert.equal(user.access_token,undefined);assert.equal(user.refresh_token,undefined);
});
test('viewer password-change and expired accounts cannot establish a session',async()=>{const req={session:{}};await assert.rejects(()=>establishViewerSession(req,{must_change_password:1}),/password change/);await assert.rejects(()=>establishViewerSession(req,{account_expires_at:'2000-01-01'}),/expired/);});
