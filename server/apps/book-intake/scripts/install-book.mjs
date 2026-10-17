import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),JSZip=require('jszip');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const input=process.argv[2];
if(!input){console.error('Usage: npm run book:install -- /path/to/book-publication.ombook.zip');process.exit(1);}
try{
  const zip=await JSZip.loadAsync(await fs.readFile(path.resolve(input)));
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  if(manifest.format!=='om-book'||manifest.version!==1||manifest.kind!=='publication')throw new Error('Use an exported book-only publication file, not a private backup.');
  if(!Array.isArray(manifest.sources)||!Array.isArray(manifest.pages))throw new Error('Invalid book manifest.');
  if((manifest.annotations||[]).length||(manifest.bookmarks||[]).length)throw new Error('Publication file contains private annotations. Re-export a book-only copy.');
  const stage=path.join(root,'public',`book-staging-${Date.now()}`);await fs.mkdir(path.join(stage,'sources'),{recursive:true});
  for(const source of manifest.sources){if(!/^[a-zA-Z0-9_-]{1,128}$/.test(source.id))throw new Error('Unsafe source identifier.');const entry=zip.file(`sources/${source.id}`);if(!entry)throw new Error(`Missing image: ${source.name}`);await fs.writeFile(path.join(stage,'sources',source.id),await entry.async('nodebuffer'));}
  await fs.writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2));
  const destination=path.join(root,'public','book');const backup=path.join(root,`book-previous-${Date.now()}`);
  try{await fs.rename(destination,backup);}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.rename(stage,destination);
  console.log('Book content installed under public/book. Run npm run build.');
  console.log('The previous bundled book is preserved at:',backup);
  console.log('Existing browser libraries are not overwritten. Test a new browser profile or restore the publication through Manage book.');
}catch(error){console.error('Book installation failed:',error.message);process.exitCode=1;}
