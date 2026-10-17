import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const electron=fileURLToPath(new URL('../node_modules/electron/dist/'+(process.platform==='win32'?'electron.exe':'electron'),import.meta.url));const child=spawn(electron,['electron/admin-main.mjs'],{stdio:'inherit',windowsHide:true,env:process.env});child.on('exit',code=>process.exit(code??1));
