import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'om-publication-tests-'));let count=0;
try {
  for(const name of ['backend','dates','text','db','review','publication']){
    const {outputText}=ts.transpileModule(await fs.readFile(path.join(root,'src/lib',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
    await fs.writeFile(path.join(tmp,name+'.mjs'),outputText.replace(/from (['"])\.\/([^'"]+)\1/g,(_,q,n)=>`from ${q}./${n}.mjs${q}`));
  }
  const {checkPublish,preparationStats,contentFingerprint}=await import(pathToFileURL(path.join(tmp,'publication.mjs')));
  const {validateManifest}=await import(pathToFileURL(path.join(tmp,'db.mjs')));
  const fixture=JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/sample-book.json'),'utf8'));
  const p={...fixture.pages[0],reviewed:false,review:undefined,ocrError:undefined};
  const o={orderVerified:true,approveAvailable:true,acceptExceptions:false};
  const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
  test('an empty book cannot be published',()=>assert.throws(()=>checkPublish([],o),/at least one page/));
  test('one order confirmation is required per book',()=>assert.throws(()=>checkPublish([p],{...o,orderVerified:false}),/page order/));
  test('386 pages can be accepted in one publication action',()=>assert.equal(checkPublish(Array.from({length:386},(_,i)=>({...p,id:'p'+i})),o).unapproved,386));
  test('unreviewed text requires bulk consent',()=>assert.throws(()=>checkPublish([p],{...o,approveAvailable:false}),/bulk/));
  test('approved text does not need repeated approval',()=>assert.equal(checkPublish([{...p,reviewed:true}],{...o,approveAvailable:false}).unapproved,0));
  test('scan-only page requires explicit exception acknowledgement',()=>assert.throws(()=>checkPublish([{...p,text:''}],o),/Acknowledge/));
  test('scan-only publication is permitted when acknowledged',()=>assert.equal(checkPublish([{...p,text:''}],{...o,acceptExceptions:true}).exceptions,1));
  test('OCR failure with old text still requires acknowledgement',()=>assert.throws(()=>checkPublish([{...p,ocrError:'failed retry'}],o),/Acknowledge/));
  test('OCR failure is not reported as eligible for bulk approval',()=>assert.equal(preparationStats([{...p,ocrError:'failed retry'}]).unapproved,0));
  test('whitespace text is not searchable',()=>assert.equal(preparationStats([{...p,text:' \n\t '}]).searchable,0));
  test('two pages of one scan count as one source',()=>assert.equal(preparationStats([p,{...p,id:'other'}]).sources,1));
  test('text coverage is separate from review status',()=>assert.equal(preparationStats([p]).searchable,1));
  test('reading progress does not invalidate an editorial snapshot',()=>assert.equal(contentFingerprint([p]),contentFingerprint([{...p,read:!p.read}])));
  test('approval changes do not invalidate an editorial snapshot',()=>assert.equal(contentFingerprint([p]),contentFingerprint([{...p,reviewed:true}])));
  for(const [field,value]of Object.entries({text:'Changed',title:'Different page',detail:'Edited detail',order:99,sourceId:'different-source',rotation:90,textVersion:p.textVersion+1,cropVersion:p.cropVersion+1,ocrError:'new failure'}))
    test(`snapshot detects changed ${field}`,()=>assert.notEqual(contentFingerprint([p]),contentFingerprint([{...p,[field]:value}])));
  test('snapshot detects changed crop',()=>assert.notEqual(contentFingerprint([p]),contentFingerprint([{...p,crop:{...p.crop,x:.02}}])));
  test('snapshot comparison is stable across storage record order',()=>{const q={...p,id:'second',order:p.order+1};assert.equal(contentFingerprint([p,q]),contentFingerprint([q,p]));});
  test('legacy manifest without new metadata remains compatible',()=>assert.equal(validateManifest(fixture).version,1));
  test('optional author and cover page are accepted',()=>{const f=structuredClone(fixture);f.book.author='Institution';f.book.coverPageId=p.id;assert.equal(validateManifest(f).book.author,'Institution');});
  test('invalid cover page identifier is rejected',()=>{const f=structuredClone(fixture);f.book.coverPageId='../unsafe';assert.throws(()=>validateManifest(f));});
  test('invalid publication marker is rejected',()=>{const f=structuredClone(fixture);f.publication={status:'invalid'};assert.throws(()=>validateManifest(f));});
  test('invalid publication timestamp is rejected',()=>{const f=structuredClone(fixture);f.publication={status:'published',publishedAt:'bad-date'};assert.throws(()=>validateManifest(f));});
  test('negative accepted exception count is rejected',()=>{const f=structuredClone(fixture);f.publication={status:'published',acceptedExceptions:-1};assert.throws(()=>validateManifest(f));});
  console.log(`\n${count} publication tests passed.`);
}finally{await fs.rm(tmp,{recursive:true,force:true});}
