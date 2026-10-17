// Viewer uses the same authenticated portal APIs and their existing church/role guards.
// Client identity controls navigation; it never grants a role or a church membership.
function viewerClientScope(req,res,next){
 if(req.session?.client!=='om-viewer')return next();
 const path=req.path;
 if(path.startsWith('/api/'))return next();
 if(/^\/(portal|dashboard)(\/|$)/.test(path)||path.startsWith('/error/')||path==='/auth/login'||path==='/auth/viewer-complete'||path==='/auth-demo/centered/reset-password'||path.startsWith('/assets/')||path.startsWith('/logo/')||path.startsWith('/fonts/')||path==='/favicon.ico')return next();
 if(req.method==='GET'||req.method==='HEAD')return res.redirect(302,'/portal');
 return res.status(403).send('Return to the OM Viewer portal.');
}
module.exports={viewerClientScope};
