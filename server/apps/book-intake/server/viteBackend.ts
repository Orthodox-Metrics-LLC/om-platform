import { loadEnv, type Plugin } from 'vite';
import { createBackend } from './backend.mjs';
import { validateManifest } from '../src/lib/db';
export function backendPlugin():Plugin {
    let backend:ReturnType<typeof createBackend>;
    let settings:Record<string,string|undefined>={};
    const initialize=()=>{backend=createBackend({dataDir:settings.OM_DATA_DIR,settings,onSettingsChange:(config:Record<string,string>)=>Object.assign(process.env,config),validateManifest});Object.assign(process.env,settings);};
    return {name:'om-shared-library',configResolved(config){settings={...loadEnv(config.mode,config.envDir,''),...process.env};},configureServer(server){initialize();server.middlewares.use(backend.middleware);server.httpServer?.once('close',()=>backend.close());},configurePreviewServer(server){initialize();server.middlewares.use(backend.middleware);server.httpServer?.once('close',()=>backend.close());}};
}
