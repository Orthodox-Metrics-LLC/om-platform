import 'fake-indexeddb/auto';
import fs from 'node:fs';
globalThis.window=globalThis;globalThis.BroadcastChannel=undefined;
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/sample-book.json'));
const files=JSON.parse(fs.readFileSync('tests/morning-images.json')).map(f=>({...f,data:fs.readFileSync(new URL('../'+f.path,import.meta.url)).toString('base64')}));
const result=await (async()=>{

const db=await import('../preview/app/lib/db.js'),cat=await import('../preview/app/lib/catalog.js'),pub=await import('../preview/app/lib/publication.js');
let checks=0;const check=(ok,label)=>{if(!ok)throw Error(label);checks++;};
// Legacy import has content but lacks initialization flag: sample must never overwrite it.
db.selectDatabase(db.LEGACY_DATABASE);const legacy={...fixture,book:{...fixture.book,title:'OM Daily Reading — 386 pages'},pages:Array.from({length:386},(_,i)=>({...fixture.pages[0],id:'legacy-'+i,order:i})),publication:{status:'published',publishedAt:new Date().toISOString()},annotations:[],bookmarks:[]};
legacy.annotations=[{...fixture.annotations[0],id:'note-legacy',pageId:'legacy-0'}];if(!fixture.annotations[0])legacy.annotations=[{id:'note-legacy',pageId:'legacy-0',kind:'note',color:'gold',note:'KEEP ME',createdAt:new Date().toISOString()}];
await db.replaceLibrary(legacy,fixture.sources.map(s=>({...s,blob:new Blob(['scan'],{type:s.mime})})));
await db.commit(['settings'],tx=>tx.objectStore('settings').delete('initialized'));
await db.initialize();check((await db.readLibrary()).pages.length===386,'sample overwrote legacy');await cat.ensureCatalog();
const entry=await cat.createBook('Morning Prayers');check(db.getDatabaseName()===db.LEGACY_DATABASE,'create switched active DB');
db.selectDatabase(entry.database);const sources=[];const pages=[];
for(let i=0;i<files.length;i++){const f=files[i],blob=new Blob([Uint8Array.from(atob(f.data),c=>c.charCodeAt(0))],{type:f.mime}),bitmap={width:f.width,height:f.height,close(){}};sources.push({id:'morning-source-'+i,name:f.name,mime:f.mime,width:bitmap.width,height:bitmap.height,blob});bitmap.close();pages.push({...fixture.pages[0],id:'morning-page-'+i,sourceId:'morning-source-'+i,sourceName:f.name,order:i,title:'Morning Prayers '+(i+1),text:'',words:[],reviewed:false});}
await db.replaceLibrary({...fixture,book:{...fixture.book,title:'Morning Prayers'},pages,sources:sources.map(({blob,...s})=>s),annotations:[],bookmarks:[],publication:{status:'draft'}},sources);
await pub.publishBook(await db.readLibrary(),{orderVerified:true,approveAvailable:true,acceptExceptions:true});await cat.syncCatalogBook(entry.id,await db.readLibrary());
check((await db.readLibrary(db.LEGACY_DATABASE)).pages.length===386,'legacy pages lost');check((await db.readLibrary(db.LEGACY_DATABASE)).annotations.length===1,'legacy annotation lost');
const backup=await db.readLibrary();await db.replaceLibrary({...fixture,...backup},sources);check((await db.readLibrary()).publication.status==='published','restore unpublishes');
const draft=await cat.createBook('Abandon me');await cat.abandonBook(draft.id);check((await cat.getCatalogBook(draft.id)).abandoned,'abandon failed');await cat.abandonBook(draft.id,false);check(!(await cat.getCatalogBook(draft.id)).abandoned,'resume failed');await cat.purgeBook(draft.id);await cat.ensureCatalog();check((await cat.getCatalogBook(draft.id)).purged,'purge resurrected');
check((await db.getAll('sources',draft.database)).length===0,'purge left originals');
await cat.ensureCatalog();
check((await cat.getCatalogBook(entry.id)).status==='published','reload repair lost publication');
check((await cat.getCatalogBook(entry.id)).pageCount===7,'wrong morning count');check((await cat.getCatalogBook('legacy')).pageCount===386,'wrong legacy count');
for (const source of await db.getAll('sources',entry.database)) check(Buffer.from(await source.blob.arrayBuffer()).equals(Buffer.from(files.find(f=>f.name===source.name).data,'base64')),'scan bytes changed');
let refused=false;try{await cat.purgeBook(entry.id)}catch{refused=true}check(refused,'published purge allowed');
return{checks,entry:entry.id};
})();console.log('PASS',result.checks,'IndexedDB lifecycle/isolation checks with seven supplied image blobs.');
