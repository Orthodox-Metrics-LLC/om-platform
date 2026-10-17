import { createNarrationMiddleware } from '../server/narration.mjs';
import { loadEnvFile } from 'node:process';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||5186);
const host=process.env.HOST || '0.0.0.0';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.wasm':'application/wasm','.gz':'application/gzip'};
try { loadEnvFile(path.join(root, '.env.local')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const narration = createNarrationMiddleware();
const server=http.createServer(async(req,res)=>{
  if ((req.url || '').startsWith('/api/narration/')) { await narration(req, res, () => { res.writeHead(404); res.end(); }); return; }
  try{
    const url=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(url.pathname);
    const publicRoute=pathname.startsWith('/ocr/')||pathname.startsWith('/book/')||pathname.startsWith('/brand/');
    const base=path.join(root,publicRoute?'public':'preview');
    const filename=path.resolve(base,'.'+(pathname==='/'?'/index.html':pathname));
    if(!filename.startsWith(base+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
    const data=await fs.readFile(filename);
    res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,host,()=>console.log(`OM Daily Reading v0.4 preview listening on ${host}:${port}. Open http://<SERVER-IP>:${port} (or http://localhost:${port} on this machine)\nKeep this terminal open. Ctrl+C stops the preview.\nThis packaged preview does not watch source changes; use npm run dev for development.`));
