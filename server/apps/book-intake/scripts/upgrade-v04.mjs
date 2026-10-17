#!/usr/bin/env node
/** Install this complete v0.4 release over an existing v0.3 project.
 * Never reads or changes browser storage. Original books, OCR models, .env files,
 * node_modules and local Vite configuration are deliberately outside this plan.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flags=new Set(process.argv.slice(2).filter(x=>x.startsWith('--')));
const input=process.argv.slice(2).find(x=>!x.startsWith('--'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const exists=async p=>{try{return await fs.lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function safePath(root,relative){
 if(!relative||relative.startsWith('/')||relative.split('/').some(p=>p==='..'||p===''||p==='.')||relative.includes('\\'))throw Error('Unsafe release path.');
 const full=path.resolve(root,relative);if(!full.startsWith(root+path.sep))throw Error('Path outside project.');
 let p=root;for(const part of relative.split('/')){p=path.join(p,part);const st=await exists(p);if(st?.isSymbolicLink())throw Error(`Refusing a symlink in update path: ${relative}`);}
 return full;
}
try{
 if(flags.has('--help')||!input){console.log('Usage: node /path/to/new/om-book-reader/scripts/upgrade-v04.mjs /path/to/existing/om-book-reader [--check]\nStop the server and export a full book backup first. --check validates without changing code.');process.exit(flags.has('--help')?0:1);}
 if([...flags].some(f=>f!=='--check'))throw Error('Unknown option. Use --check or --help.');
 const target=await fs.realpath(path.resolve(input));
 if(target===await fs.realpath(source))throw Error('Source and destination are the same folder. Run this installer against your existing v0.3 project, or start this new project directly.');
 const oldPackage=JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8'));
 if(oldPackage.name!=='om-book-reader'||!['0.4.0','0.4.1'].includes(oldPackage.version))throw Error('Expected an OM Book Reader v0.4.0 or v0.4.1 project. Older versions must first install the previous workspace/reading updates.');
 const release=JSON.parse(await fs.readFile(path.join(source,'release-v04.json'),'utf8'));
 if(release.version!=='0.4.1'||!Array.isArray(release.files))throw Error('Invalid release manifest.');
 const plan=[],conflicts=[];
 for(const entry of release.files){
  const src=await safePath(source,entry.path),dest=await safePath(target,entry.path);
  const bytes=await fs.readFile(src);if(sha(bytes)!==entry.sha256)throw Error(`Release source verification failed: ${entry.path}. Extract the ZIP again.`);
  const stat=await exists(dest);if(stat&&!stat.isFile())throw Error(`Destination is not a regular file: ${entry.path}`);
  const before=stat?await fs.readFile(dest):null;
  if(before&&sha(before)===entry.sha256)continue;
  if(before&&(!entry.previousSha256||sha(before)!==entry.previousSha256)){conflicts.push(entry.path);continue;}
  plan.push({path:entry.path,dest,bytes,before});
 }
 if(conflicts.length)throw Error('Local source changes were detected; nothing was replaced:\n'+conflicts.map(p=>'  '+p).join('\n')+'\nMerge those edits before upgrading. Do not delete or reset your browser data.');
 const newPackage=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
 const merged={...oldPackage,version:'0.4.1',description:newPackage.description,scripts:{...newPackage.scripts,...oldPackage.scripts}};
 // Dependencies and user-defined npm startup flags remain exactly as installed.
 const pkgPath=await safePath(target,'package.json');
 const pkgBefore=await fs.readFile(pkgPath);
 const pkgBytes=Buffer.from(JSON.stringify(merged,null,2)+'\n');
 if(sha(pkgBytes)!==sha(pkgBefore))plan.push({path:'package.json',dest:pkgPath,bytes:pkgBytes,before:pkgBefore});
 // Update lockfile root metadata only; never regenerate or upgrade its dependency graph.
 const lockPath=path.join(target,'package-lock.json');
 if(await exists(lockPath)){
  await safePath(target,'package-lock.json');const before=await fs.readFile(lockPath);const lock=JSON.parse(before.toString());
  lock.version='0.4.1';if(lock.packages?.[''])lock.packages[''].version='0.4.1';const bytes=Buffer.from(JSON.stringify(lock,null,2)+'\n');
  if(sha(bytes)!==sha(before))plan.push({path:'package-lock.json',dest:lockPath,bytes,before});
 }
 if(flags.has('--check')){console.log(`Preflight PASS: ${plan.length} files would change. No files or browser data were modified.`);process.exit(0);}
 if(!plan.length){console.log('v0.4.1 is already installed. No code changes required.');process.exit(0);}
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const backup=path.join(target,'.om-upgrade-backups','v04-'+stamp);await fs.mkdir(backup,{recursive:true});
 for(const item of plan)if(item.before!==null){const dest=path.join(backup,item.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,item.before);}
 await fs.writeFile(path.join(backup,'upgrade-report.json'),JSON.stringify({from:oldPackage.version,to:'0.4.1',at:new Date().toISOString(),files:plan.map(p=>({path:p.path,existed:p.before!==null}))},null,2));
 const written=[];
 try{
  for(const item of plan){await fs.mkdir(path.dirname(item.dest),{recursive:true});const temp=item.dest+'.om-v04-tmp';await fs.writeFile(temp,item.bytes);await fs.rename(temp,item.dest);written.push(item);}
 }catch(error){
  for(const item of written.reverse()){if(item.before===null)await fs.rm(item.dest,{force:true});else await fs.writeFile(item.dest,item.before);}
  throw Error('Code installation failed; replaced code files were rolled back. '+error.message);
 }
 console.log(`Installed OM Daily Reading v0.4.1 (${plan.length} code/assets/docs files).\nCode backup: ${backup}\nPreserved: .env files, public/book, public/ocr, node_modules, Vite host/port settings, and existing npm startup scripts.\nNext: npm run dev. Refresh the SAME browser profile and address. No reimport is needed.\nFor widespread old date errors: Book Preparation → Publication details → Repair dates & structure → Verify every printed header → Check all date headers.`);
}catch(error){console.error('UPGRADE STOPPED: '+(error instanceof Error?error.message:String(error)));process.exitCode=1;}
