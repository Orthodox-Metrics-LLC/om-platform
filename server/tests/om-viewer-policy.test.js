const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createViewerHandlers}=require('../src/services/omViewerPolicy');
function harness(overrides={}){
 const user={id:12,email:'member@test',display_name:'Member',role:'deacon',church_id:46,is_active:1,must_change_password:0,...overrides};
 const calls=[];let executions=[];
 const pool={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM users'))return [[user]];return [[{id:46,name:'Parish 46',database_name:'om_church_46'},...(user.role==='admin'?[{id:47,name:'Parish 47',database_name:'om_church_47'}]:[])]];}};
 const handlers=createViewerHandlers({pool,runResource:async request=>{executions.push(request);return {resources:[]};}});
 const req={session:{client:'om-viewer',user:{id:12,role:'super_admin',church_id:99},omViewerCsrf:'valid-token',save:done=>done()},body:{churchId:46,action:'resources'},get:()=> 'valid-token'};
 async function call(handler){const res={statusCode:200,set(){return this;},status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}};await handlers[handler](req,res);return res;}
 return {user,req,call,calls,executions};
}
test('session uses fresh database identity and never exposes database names or credentials',async()=>{
 const h=harness({role:'viewer'}),res=await h.call('session');assert.equal(res.statusCode,200);assert.equal(res.data.result.permissions.can_edit,false);assert.equal(res.data.result.user.role,'viewer');assert.equal(res.data.result.user.church_id,46);assert.ok(!JSON.stringify(res.data).includes('om_church_46'));assert.deepEqual(h.calls[1].args,[46]);
});
test('ordinary account cannot change church through request body',async()=>{const h=harness();h.req.body.churchId=47;assert.equal((await h.call('resource')).statusCode,403);assert.equal(h.executions.length,0);});
test('viewer cannot forge write permission or audit actor',async()=>{const h=harness({role:'viewer'});h.req.body={churchId:46,action:'save',can_edit:true,query:{actor:'Admin'}};assert.equal((await h.call('resource')).statusCode,403);assert.equal(h.executions.length,0);});
test('authorized save uses registered database and verified account identity',async()=>{
 const h=harness();h.req.body={churchId:46,action:'save',settings:{database:'om_church_99'},query:{table:'namedays',actor:'Admin',database:'om_church_99',values:{subject:'Test'},note:'Correction',request_id:'test'}};
 assert.equal((await h.call('resource')).statusCode,200);assert.equal(h.executions[0].database,'om_church_46');assert.equal(h.executions[0].query.actor,'Member (#12)');assert.equal(h.executions[0].query.database,undefined);
});
test('platform admin can choose an active authorized church',async()=>{const h=harness({role:'admin',church_id:null});h.req.body.churchId=47;assert.equal((await h.call('resource')).statusCode,200);assert.equal(h.executions[0].database,'om_church_47');});
for(const [label,change,status] of [['disabled',{is_active:0},401],['expired',{account_expires_at:'2000-01-01'},401],['password change',{must_change_password:1},403],['guest',{role:'guest'},403],['missing church',{role:'viewer',church_id:null},403]])test(label+' account cannot use viewer',async()=>{const h=harness(change);assert.equal((await h.call('session')).statusCode,status);assert.equal(h.executions.length,0);});
test('CSRF failure and arbitrary actions fail before engine invocation',async()=>{const h=harness();h.req.get=()=> 'wrong';assert.equal((await h.call('resource')).statusCode,403);h.req.get=()=> 'valid-token';h.req.body.action='execute_import';assert.equal((await h.call('resource')).statusCode,400);assert.equal(h.executions.length,0);});
test('roles and membership are reloaded for every resource call',async()=>{const h=harness();assert.equal((await h.call('resource')).statusCode,200);h.user.church_id=47;h.req.body.action='save';h.user.role='viewer';assert.equal((await h.call('resource')).statusCode,403);assert.equal(h.calls.filter(c=>c.sql.includes('FROM users')).length,2);});
test('CSRF token is saved on session creation',async()=>{const h=harness();delete h.req.session.omViewerCsrf;assert.equal((await h.call('session')).data.result.csrf.length,64);});


test('normal website session cannot stand in for viewer login',async()=>{const h=harness();delete h.req.session.client;assert.equal((await h.call('session')).statusCode,401);});
test('locked and no-longer-active lifecycle accounts are denied',async()=>{for(const change of [{is_locked:1},{account_status:'banned'}]){const h=harness(change);assert.equal((await h.call('session')).statusCode,403);}});
