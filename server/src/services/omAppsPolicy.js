const {randomBytes,timingSafeEqual}=require('node:crypto');
const {ViewerError}=require('./omViewerPolicy');
function checkCsrf(req){
 const expected=req.session?.omAppsCsrf,provided=req.get('X-OM-Apps-CSRF');
 if(typeof expected!=='string'||typeof provided!=='string'||Buffer.byteLength(expected)!==Buffer.byteLength(provided)||!timingSafeEqual(Buffer.from(expected),Buffer.from(provided)))throw new ViewerError(403,'Refresh the application before continuing.');
}
async function appContext(req,policy){
 const ctx=await policy.context(req),id=Number(req.query.churchId??req.body?.churchId??req.session.omAppsChurch??ctx.user.church_id);
 const church=ctx.churches.find(c=>Number(c.id)===id);
 if(!church)throw new ViewerError(403,'Choose an authorized church from Applications.');
 return {...ctx,church};
}
async function sessionInfo(req,policy){
 const ctx=await policy.context(req);
 if(!req.session.omAppsCsrf){req.session.omAppsCsrf=randomBytes(32).toString('hex');await new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));}
 return {user:{id:ctx.user.id,name:ctx.user.display_name||ctx.user.email},churches:ctx.churches.map(c=>({id:c.id,name:c.name})),permissions:ctx.permissions,csrf:req.session.omAppsCsrf,churchId:req.session.omAppsChurch||ctx.user.church_id};
}
module.exports={checkCsrf,appContext,sessionInfo};
