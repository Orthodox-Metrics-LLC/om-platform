const {randomBytes,timingSafeEqual}=require('node:crypto');
const roles=require('../utils/roles');
class ViewerError extends Error {constructor(status,message){super(message);this.status=status;}}
function positiveId(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new ViewerError(400,'Choose a valid church.');return n;}
function createViewerHandlers({pool,runResource}){
 async function identity(req){
  if(req.session?.client!=='om-viewer')throw new ViewerError(401,'Sign in through OM Viewer.');
  const id=req.session?.user?.id;
  if(!id)throw new ViewerError(401,'Sign in to Orthodox Metrics.');
  const [rows]=await pool.query('SELECT id,email,display_name,role,church_id,is_active,is_locked,account_status,must_change_password,account_expires_at FROM users WHERE id=? LIMIT 1',[id]);
  const user=rows[0];
  if(!user || !user.is_active)throw new ViewerError(401,'This account is no longer active.');
  if(user.is_locked || (user.account_status && user.account_status!=='active' && user.role!=='super_admin'))throw new ViewerError(403,'This account is not available for OM Viewer.');
  if(user.account_expires_at && new Date(user.account_expires_at).getTime()<=Date.now())throw new ViewerError(401,'This account has expired.');
  if(user.must_change_password)throw new ViewerError(403,'Complete your password change on the website before using OM Viewer.');
  if(!roles.canViewDashboard(user))throw new ViewerError(403,'Your role cannot view records.');
  return user;
 }
 async function workspaces(user){
  const platform=roles.canManageChurches(user);
  if(!platform && !user.church_id)throw new ViewerError(403,'No church is assigned to this account.');
  const sql='SELECT id,name,database_name FROM churches WHERE is_active=1'+(platform?'':' AND id=?')+' ORDER BY name';
  const [rows]=await pool.query(sql,platform?[]:[positiveId(user.church_id)]);
  return rows.filter(c=>c.database_name && /^om_church_[1-9][0-9]*$/.test(c.database_name));
 }
 async function context(req){
  const user=await identity(req),churches=await workspaces(user);
  return {user,churches,permissions:{can_view:true,can_edit:roles.canManageRecords(user),can_select_church:roles.canManageChurches(user)}};
 }
 const wrap=handler=>async(req,res)=>{try{res.set('Cache-Control','no-store');res.json(await handler(req));}catch(error){const status=error instanceof ViewerError?error.status:503;res.status(status).json({ok:false,error:status===503?'OM Viewer service is unavailable. Ask your administrator to check its deployment.':error.message});}};
 return {
  session:wrap(async req=>{
   const ctx=await context(req);
   if(!req.session.omViewerCsrf){req.session.omViewerCsrf=randomBytes(32).toString('hex');await new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));}
   return {ok:true,result:{client:'om-viewer',user:{id:ctx.user.id,email:ctx.user.email,display_name:ctx.user.display_name,role:ctx.user.role,church_id:ctx.user.church_id},permissions:ctx.permissions,churches:ctx.churches.map(c=>({id:c.id,name:c.name})),csrf: req.session.omViewerCsrf}};
  }),
  resource:wrap(async req=>{
   const expected=req.session?.omViewerCsrf,provided=req.get('X-OM-Viewer-CSRF');
   if(typeof expected!=='string'||typeof provided!=='string'||Buffer.byteLength(expected)!==Buffer.byteLength(provided)||!timingSafeEqual(Buffer.from(expected),Buffer.from(provided)))throw new ViewerError(403,'Refresh your viewer session before continuing.');
   const ctx=await context(req),body=req.body||{};
   const churchId=positiveId(body.churchId??ctx.user.church_id);
   const church=ctx.churches.find(c=>Number(c.id)===churchId);
   if(!church)throw new ViewerError(403,'You cannot access this church.');
   if(!['resources','browse','detail','save'].includes(body.action))throw new ViewerError(400,'Unsupported resource action.');
   if(body.action==='save'&&!ctx.permissions.can_edit)throw new ViewerError(403,'Your role has read-only access.');
   const query=body.query||{};
   if(typeof query!=='object'||Array.isArray(query))throw new ViewerError(400,'Invalid resource request.');
   const allowed={resources:[],browse:['table','search','page','sort'],detail:['table','row_id'],save:['table','row_id','values','note','request_id','fingerprint']}[body.action];
   const selected=Object.fromEntries(allowed.filter(k=>Object.hasOwn(query,k)).map(k=>[k,query[k]]));
   if(body.action==='save')selected.actor=`${String(ctx.user.display_name||ctx.user.email||'User').slice(0,100)} (#${ctx.user.id})`;
   const result=await runResource({churchId,database:church.database_name,action:body.action,query:selected});
   return {ok:true,result};
  })
 };
}
module.exports={createViewerHandlers,ViewerError};
