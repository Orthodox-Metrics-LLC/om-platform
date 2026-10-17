import { build } from 'esbuild';
import { mkdir,copyFile } from 'node:fs/promises';
await mkdir('build-server',{recursive:true});
// Remove Vite's development dependency from the production OCR module by selecting its runtime export.
await build({stdin:{contents:"export {createOCRMiddleware} from '../server/ocr';",resolveDir:'scripts',loader:'ts'},outfile:'build-server/ocr.mjs',bundle:true,platform:'node',format:'esm',external:['vite'],target:'node24'});
await build({stdin:{contents:"export {validateManifest} from '../src/lib/db';",resolveDir:'scripts',loader:'ts'},outfile:'build-server/manifest.mjs',bundle:true,platform:'node',format:'esm',target:'node24'});
await copyFile('server/schema.sql','build-server/schema.sql');

await build({entryPoints:['server/backend.mjs'],outfile:'build-server/backend.mjs',bundle:true,platform:'node',format:'esm',packages:'external',target:'node24'});
await copyFile('server/narration.mjs','build-server/narration.mjs');
