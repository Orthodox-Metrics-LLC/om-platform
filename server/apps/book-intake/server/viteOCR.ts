import {loadEnv,type Plugin} from 'vite';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createOCRMiddleware} from './ocr';
export function ocrPlugin(): Plugin {
    let settings: Record<string,string|undefined>={};
    const middleware=(req:IncomingMessage,res:ServerResponse,next:()=>void)=>createOCRMiddleware({...settings,...process.env})(req,res,next);
    return { name: 'om-private-cloud-ocr',
        configResolved(config) { settings = { ...loadEnv(config.mode, config.envDir, ''), ...process.env }; },
        configureServer(server) { server.middlewares.use(middleware); },
        configurePreviewServer(server) { server.middlewares.use(middleware); }
    };
}
