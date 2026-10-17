import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tmp=await fs.mkdtemp(path.join(os.tmpdir(),'om-reader-tests-'));
let passed=0;
try{
  for(const name of ['backend','dates','text','db']){const source=await fs.readFile(path.join(root,'src/lib',name+'.ts'),'utf8');const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});await fs.writeFile(path.join(tmp,name+'.mjs'),result.outputText.replace(/from (['"])\.\/([^'"]+)\1/g,(_,q,n)=>`from ${q}./${n}.mjs${q}`));}
  const text=await import(pathToFileURL(path.join(tmp,'text.mjs'))),db=await import(pathToFileURL(path.join(tmp,'db.mjs')));
  const test=(name,fn)=>{fn();passed++;console.log('PASS',name);};
  test('exact text anchor',()=>assert.deepEqual(text.makeAnchor('alpha beta gamma',6,10),{start:6,end:10,quote:'beta',prefix:'alpha ',suffix:' gamma'}));
  test('highlight follows an inserted prefix',()=>{const a=text.makeAnchor('alpha beta gamma',6,10);assert.equal(text.reanchor(a,'new alpha beta gamma').start,10);});
  test('removed quotation is retained as detached',()=>assert.equal(text.reanchor(text.makeAnchor('alpha beta gamma',6,10),'alpha gamma').detached,true));
  test('ambiguous repeated quotation is not guessed',()=>assert.equal(text.reanchor({start:0,end:4,quote:'word',prefix:'',suffix:''},'word word').detached,true));
  test('context resolves a repeated quotation',()=>assert.equal(text.reanchor({start:0,end:4,quote:'word',prefix:'other ',suffix:' end'},'word and other word end').start,15));
  test('paragraph offsets preserve original text',()=>assert.deepEqual(text.paragraphs('One.\n\nTwo.').map(p=>p.start),[0,6]));
  test('split excludes the binding without losing originals',()=>{const c=text.splitCrops(.5,.1);assert.equal(c[0].w,.45);assert.equal(c[1].x,.55);});
  test('invalid split is rejected',()=>assert.throws(()=>text.splitCrops(.5,1)));
  test('crop bounds are enforced',()=>assert.equal(text.validCrop({x:.6,y:0,w:.5,h:1}),false));
  test('accent-insensitive search maps to original characters',()=>assert.deepEqual(text.searchRanges('Éphraim','eph'),[{start:0,end:3}]));
  test('printed date is detected without assigning a year',()=>assert.equal(text.guessDate('THURSDAY January 1'),'01-01'));
  test('invalid printed date is not accepted',()=>assert.equal(text.guessDate('February 31'),''));
  const manifest=JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/sample-book.json'),'utf8'));
  test('bundled book passes schema checks',()=>assert.equal(db.validateManifest(manifest).pages.length,4));
  test('text search finds a passage',()=>assert.equal(text.searchPages(manifest.pages,'Eugendus').some(r=>r.page.id==='january-01'),true));
  test('multiword search requires every word',()=>assert.equal(text.searchPages(manifest.pages,'Eugendus nonexistentterm').length,0));
  test('metadata such as scripture references is searchable',()=>assert.equal(text.searchPages(manifest.pages,'Colossians').length,1));
  test('unsafe archive paths are rejected',()=>{const invalid=structuredClone(manifest);invalid.sources[0].id='../escape';assert.throws(()=>db.validateManifest(invalid));});
  test('orphaned page assets are rejected',()=>{const invalid=structuredClone(manifest);invalid.pages[0].sourceId='missing';assert.throws(()=>db.validateManifest(invalid));});
  test('invalid crop archives are rejected',()=>{const invalid=structuredClone(manifest);invalid.pages[0].crop.w=4;assert.throws(()=>db.validateManifest(invalid));});
  test('unknown format version is rejected',()=>assert.throws(()=>db.validateManifest({...manifest,version:999})));
  console.log(`\n${passed} tests passed.`);
}finally{await fs.rm(tmp,{recursive:true,force:true});}
