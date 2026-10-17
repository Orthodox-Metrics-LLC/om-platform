import { loadEnv, type Plugin } from 'vite';
import { createNarrationMiddleware } from './narration.mjs';
/** Optional plugin works in Vite dev AND preview. Nothing is added to client env definitions. */
export function narrationPlugin(): Plugin {
    let settings: Record<string,string | undefined> = {};
    return { name:'om-private-narration',
        configResolved(config) { settings = { ...loadEnv(config.mode, config.envDir, ''), ...process.env }; },
        configureServer(server) { server.middlewares.use(createNarrationMiddleware(settings)); },
        configurePreviewServer(server) { server.middlewares.use(createNarrationMiddleware(settings)); }
    };
}
