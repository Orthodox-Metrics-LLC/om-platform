import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'public','ocr');
try {
  await fs.mkdir(path.join(out,'core'),{recursive:true});
  await fs.mkdir(path.join(out,'lang'),{recursive:true});
  await fs.rm(path.join(out,'ready.json'),{force:true});
  const tess=path.dirname(require.resolve('tesseract.js/package.json'));
  const core=path.dirname(createRequire(path.join(tess,'package.json')).resolve('tesseract.js-core/package.json'));
  for(const filename of ['worker.min.js','tesseract.min.js'])await fs.copyFile(path.join(tess,'dist',filename),path.join(out,filename));
  for(const filename of await fs.readdir(core))if(/\.wasm(?:\.js)?$/.test(filename))await fs.copyFile(path.join(core,filename),path.join(out,'core',filename));
  const model=path.join(out,'lang','eng.traineddata.gz');
  try{await fs.access(model);}catch{
    console.log('Downloading the English OCR model once. No book images are uploaded.');
    const url='https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz';
    const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error(`Model download failed: HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes[0]!==0x1f||bytes[1]!==0x8b)throw new Error('The downloaded model is not a gzip file.');
    await fs.writeFile(model,bytes);
  }
  const checksum=createHash('sha256').update(await fs.readFile(model)).digest('hex');
  await fs.writeFile(path.join(out,'ready.json'),JSON.stringify({engine:'tesseract.js 6.0.1',language:'eng',modelSha256:checksum},null,2));
  console.log('OCR is ready in public/ocr. Worker, core and model will be served locally.');
  console.log('Restart npm run dev, or run npm run build again to include these assets in dist.');
} catch(error) {
  console.error('OCR setup failed:',error.message);
  console.error('First run npm install. Model download needs internet access during setup. Reading and manual transcription still work without OCR.');
  process.exitCode=1;
}
