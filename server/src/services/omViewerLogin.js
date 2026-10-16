const roles=require('../utils/roles');
function isViewerLogin(req){return req.body?.client==='om-viewer'||req.session?.client==='om-viewer';}
async function establishViewerSession(req,user){
 if(!req.session)throw Error('Session service is unavailable.');
 if(user.must_change_password)throw Error('Complete your password change on the website before using OM Viewer.');
 if(user.account_expires_at && new Date(user.account_expires_at).getTime()<=Date.now())throw Error('This account has expired.');
 if(!roles.canViewDashboard(user))throw Error('Your role cannot use OM Viewer.');
 await new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
 req.session.client='om-viewer';
 req.session.user={id:user.id,email:user.email,display_name:user.display_name||null,role:user.role,church_id:user.church_id,account_expires_at:user.account_expires_at||null};
 req.session.userId=user.id;req.session.loginTime=new Date();req.session.lastActivity=new Date();
 await new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
 return {...req.session.user,must_change_password:false};
}
module.exports={isViewerLogin,establishViewerSession};
