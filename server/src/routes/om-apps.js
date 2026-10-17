const express=require('express');
const path=require('node:path');
const fs=require('node:fs/promises');
const {pathToFileURL}=require('node:url');
const {randomUUID,createHash}=require('node:crypto');
const multer=require('multer');
const {getAppPool}=require('../config/db-compat');
const roles=require('../utils/roles');
const {createViewerHandlers,ViewerError}=require('../services/omViewerPolicy');
const {appContext,checkCsrf,sessionInfo}=require('../services/omAppsPolicy');
const {runEngine,tenantSettings}=require('../services/omAppsEngine');
const router=express.Router(),root=path.resolve(__dirname,'../../apps');
const policy=createViewerHandlers({pool:getAppPool(),allowBrowser:true});
const dataRoot=path.resolve(process.env.OM_APPS_DATA_DIR||path.join(root,'data'));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024,files:1,fields:0}});
const libraries=new Map(),consumedReviews=new Map();
const wrap=fn=>async(req,res,next)=>{try{res.set('Cache-Control','no-store');await fn(req,res,next);}catch(e){if(res.headersSent)return next(e);const status=e instanceof ViewerError?e.status:e.code==='LIMIT_FILE_SIZE'?413:e.code==='ENOENT'?404:503;res.status(status).json({ok:false,error:status===503?'Application operation failed. Check server deployment and operation logs.':status===404?'Uploaded source is unavailable. Upload it again.':e.message});}};
const actor=ctx=>`${ctx.user.display_name||ctx.user.email} (#${ctx.user.id})`;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
router.get('/api/om-apps/session',wrap(async(req,res)=>res.json({ok:true,result:await sessionInfo(req,policy)})));
router.post('/api/om-apps/church',wrap(async(req,res)=>{checkCsrf(req);const ctx=await appContext(req,policy);req.session.omAppsChurch=ctx.church.id;await new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));res.json({ok:true});}));
router.use('/apps',wrap(async(req,res,next)=>{try{await policy.context(req);}catch(e){if(e.status===401&&['GET','HEAD'].includes(req.method)&&!req.path.includes('/api/'))return res.redirect('/auth/login');throw e;}next();}));
router.get('/apps/launcher.js',(req,res)=>res.sendFile(path.join(root,'launcher.js')));
router.get(['/apps','/apps/'],(req,res)=>res.sendFile(path.join(root,'index.html')));
// Every page and API request is re-authorized against the current account and church registry.
router.use('/apps/importer',wrap(async(req,res,next)=>{const ctx=await appContext(req,policy);if(!ctx.permissions.can_edit)throw new ViewerError(403,'Your role cannot prepare or import resources.');req.omApps=ctx;next();}));
router.post('/apps/importer/api/source',wrap(async(req,res,next)=>{
 checkCsrf(req);
 await new Promise((resolve,reject)=>upload.single('source')(req,res,e=>e?reject(e):resolve()));
 const file=req.file;if(!file||!['.xlsx','.docx'].includes(path.extname(file.originalname).toLowerCase()))throw new ViewerError(400,'Choose an XLSX or DOCX document.');
 const ctx=req.omApps,token=randomUUID(),directory=path.join(dataRoot,'sources',String(ctx.user.id));await fs.mkdir(directory,{recursive:true,mode:0o700});
 const sourceDirectory=path.join(directory,token);await fs.mkdir(sourceDirectory,{mode:0o700});
 const originalName=path.basename(file.originalname.replace(/\\/g,'/'));
 const filename=path.join(sourceDirectory,originalName);await fs.writeFile(filename,file.buffer,{flag:'wx',mode:0o600});
 try{const result=await runEngine({operation:'inspect',source:filename},{database:ctx.church.database_name});result.filename=path.basename(file.originalname);res.json({ok:true,result:{...result,token}});}catch(e){await fs.unlink(filename);throw e;}
}));
router.post('/apps/importer/api/operation',wrap(async(req,res)=>{
 checkCsrf(req);const ctx=req.omApps,b=req.body||{},operation=b.operation;
 const allowed=['inspect','extract','configure','correct','edit_json','decide_flags','approve','open_package','validate','sql_preview','import_preflight','execute_import','resource'];
 if(!allowed.includes(operation))throw new ViewerError(400,'Unsupported importer operation.');
 const request={operation};
 // Reject arbitrary engine settings, filesystem paths and client audit identities.
 const keys={inspect:['selection'],extract:['configuration'],configure:['package','configuration'],correct:['package','record_id','changes','note'],edit_json:['package','edited','note'],decide_flags:['package','issue_ids','decision','note'],approve:['package','note','confirmed'],open_package:['package'],validate:['package'],sql_preview:['package'],import_preflight:['package'],execute_import:['package'],resource:['action','query']}[operation];
 for(const key of keys)if(Object.hasOwn(b,key))request[key]=b[key];
 request.actor=actor(ctx);
 if(['inspect','extract'].includes(operation)){
  if(typeof b.token!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(b.token))throw new ViewerError(400,'Upload a source document first.');
  const directory=path.join(dataRoot,'sources',String(ctx.user.id),b.token),files=await fs.readdir(directory);
  if(files.length!==1)throw new ViewerError(400,'Uploaded source is unavailable.');
  request.source=path.join(directory,files[0]);
 }
 const settings=tenantSettings(ctx.church.id,ctx.church.database_name);
 if(['import_preflight','execute_import','resource'].includes(operation))request.settings=settings;
 if(operation==='resource'){
  if(!['resources','browse','detail','save'].includes(request.action))throw new ViewerError(400,'Unsupported resource action.');
  request.query={...request.query,actor:actor(ctx)};
 }
 if(operation==='execute_import'){
  const review=req.session.omAppsReview;delete req.session.omAppsReview;
  // Persist consumption before starting a write, so concurrent replay cannot reuse this review.
  await new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
  for(const [token,expires] of consumedReviews)if(expires<Date.now())consumedReviews.delete(token);
  if(!review||consumedReviews.has(review.token)||review.expires<Date.now()||review.binding!==digest({package:b.package,churchId:ctx.church.id})||review.token!==b.reviewToken||b.table!==review.table)throw new ViewerError(409,'Generate a new import review and type its exact table name.');
  consumedReviews.set(review.token,review.expires);
  request.review_sha256=review.sha;request.confirmed=true;
 }
 const result=await runEngine(request,{database:ctx.church.database_name,settings});
 if(operation==='import_preflight'){
  const token=randomUUID();req.session.omAppsReview={token,binding:digest({package:b.package,churchId:ctx.church.id}),table:result.plan.target.table,sha:result.plan.review_sha256,expires:Date.now()+600000};
  await new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));result.token=token;
 }
 res.json({ok:true,result});
}));
router.use('/apps/importer',express.static(path.join(root,'importer/public'),{index:'index.html',dotfiles:'deny'}));
router.use('/apps/books/api',wrap(async(req,res,next)=>{
 const ctx=await appContext(req,policy);if(!['GET','HEAD'].includes(req.method))checkCsrf(req);
 // Local accounts and installation replacement cannot override website identities.
 if(/^\/(auth\/(setup|login|logout)|admin\/restore)(\/|$)/.test(req.path)||(/^\/admin\/users(\/|$)/.test(req.path)&&!['GET','HEAD'].includes(req.method)))throw new ViewerError(403,'Manage accounts through the website.');
 req.omHostedIdentity={id:ctx.user.id,displayName:ctx.user.display_name||ctx.user.email,role:roles.canManageChurchSettings(ctx.user)?'administrator':ctx.permissions.can_edit?'preparer':'reader'};
 const id=ctx.church.id;
 if(!libraries.has(id)){
  const promise=(async()=>{
   const [{createBackend},{createOCRMiddleware},{createNarrationMiddleware},{validateManifest}]=await Promise.all(['backend.mjs','ocr.mjs','narration.mjs','manifest.mjs'].map(name=>import(pathToFileURL(path.join(root,'book-intake/build-server',name)).href)));
   const settings={...process.env};const ocr=createOCRMiddleware(settings),narration=createNarrationMiddleware(settings);
   const backend=createBackend({dataDir:path.join(dataRoot,'books',String(id)),settings,validateManifest,externalIdentity:req=>req.omHostedIdentity,onSettingsChange:config=>Object.assign(settings,config)});
   return {backend,ocr,narration};
  })();libraries.set(id,promise);promise.catch(()=>libraries.delete(id));
 }
 const {backend,ocr,narration}=await libraries.get(id);
 const previous=req.url;req.url='/api'+req.url;
 await backend.middleware(req,res,()=>ocr(req,res,()=>narration(req,res,()=>res.status(404).json({error:'Unknown book API.'}))));
 req.url=previous;
}));
router.use('/apps/books',express.static(path.join(root,'book-intake/dist'),{index:'index.html',dotfiles:'deny'}));
router.use('/apps',(_req,res)=>res.status(404).send('Application page not found.'));
module.exports=router;
