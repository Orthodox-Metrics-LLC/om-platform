(() => {
 const churchId=new URL(location.href).searchParams.get('churchId');
 let workspaceName='',actorName='';
 let current=null,source=null,dirty=false,lastImport=null,review=null;
 const session=fetch('/api/om-apps/session').then(async r=>{if(r.status===401){location.href='/auth/login';throw Error('Sign in required.');}const d=await r.json();if(!r.ok)throw Error(d.error);return d.result;});
 async function request(path,body){const s=await session,headers={'X-OM-Apps-CSRF':s.csrf};if(!(body instanceof FormData))headers['Content-Type']='application/json';const r=await fetch('api/'+path+(churchId?'?churchId='+encodeURIComponent(churchId):''),{method:'POST',headers,body:body instanceof FormData?body:JSON.stringify(body)});if(r.status===401)location.href='/auth/login';const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Operation failed.');return d.result;}
 async function op(operation,payload={}){return request('operation',{operation,package:current,token:source?.token,...payload});}
 async function update(operation,payload){current=await op(operation,payload);dirty=true;review=null;return current;}
 function pick(accept){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.onchange=()=>resolve(input.files[0]||null);input.oncancel=()=>resolve(null);input.click();});}
 function download(value,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);return {filename};}
 const discard=()=>!dirty||confirm('Discard the unsaved JSON revision?');
 window.omImporter={
  get workspaceName(){return workspaceName;},
  get actorName(){return actorName;},
  getCurrent:async()=>{const s=await session;actorName=s.user.name+' (#'+s.user.id+')';workspaceName=s.churches.find(c=>Number(c.id)===Number(churchId||s.churchId))?.name||'Church import workspace';return {package:current,source,dirty,lastImport};},
  chooseSource:async()=>{if(!discard())return null;const file=await pick('.xlsx,.docx');if(!file)return null;const form=new FormData();form.append('source',file);source=await request('source',form);current=null;dirty=false;review=null;return source;},
  inspect:async selection=>{source={...await op('inspect',{selection}),token:source.token};return source;},
  extract:configuration=>update('extract',{configuration}),configure:configuration=>update('configure',{configuration}),
  correct:(record_id,changes,_actor,note)=>update('correct',{record_id,changes,note}),
  editJson:(text,_actor,note)=>update('edit_json',{edited:JSON.parse(text),note}),
  decideFlags:(issue_ids,decision,_actor,note)=>update('decide_flags',{issue_ids,decision,note}),
  approve:(_actor,note,confirmed)=>update('approve',{note,confirmed}),
  openPackage:async()=>{if(!discard())return null;const file=await pick('.json');if(!file)return null;if(file.size>30000000)throw Error('Package exceeds 30 MB.');const result=await op('open_package',{package:JSON.parse(await file.text())});current=result.package;source=null;dirty=result.migrated;review=null;return result;},
  save:async()=>{await op('validate');const result=download(current,`import-r${current.revision}.json`);dirty=false;return result;},
  sqlPreview:()=>op('sql_preview'),exportSqlPreview:async()=>download(await op('sql_preview'),'sql-preview.json'),
  reviewImport:async()=>{review=await op('import_preflight');return review;},
  confirmImport:async(token,table)=>{if(!confirm('Create the reviewed table and import approved records into the selected church database?'))return null;lastImport=await op('execute_import',{reviewToken:token,table});download(lastImport,'import-receipt-'+lastImport.table+'.json');lastImport.receipt_warning='Import receipt download started. Keep it with the approved JSON package.';review=null;return lastImport;},
  resource:(action,query={})=>op('resource',{action,query}),
  getConnection:async()=>({hosted:true}),saveConnection:async()=>({hosted:true}),testConnection:async()=>({hosted:true}),forgetConnection:async()=>({hosted:true})
 };
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});

})();
