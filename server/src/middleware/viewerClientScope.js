// Viewer sessions never become website/portal sessions. Anonymous and normal web sessions are unchanged.
const AUTH_APIS=new Set(['/api/auth/login','/api/auth/check','/api/auth/logout','/api/auth/verify']);
function viewerClientScope(req,res,next){
 if(req.session?.client!=='om-viewer')return next();
 const path=req.path;
 if(path.startsWith('/api/om-viewer/')||AUTH_APIS.has(path))return next();
 if(path.startsWith('/api/'))return res.status(403).json({success:false,error:'This session is restricted to OM Viewer.',code:'VIEWER_ONLY_SESSION'});
 // Auth pages and static assets needed by the hosted sign-in application remain available.
 if(path==='/auth/login'||path==='/auth/viewer-complete'||path==='/auth-demo/centered/reset-password'||path.startsWith('/assets/')||path.startsWith('/logo/')||path.startsWith('/fonts/')||path==='/favicon.ico')return next();
 return res.status(403).send('This session is for OM Viewer. Return to the desktop app.');
}
module.exports={viewerClientScope};
