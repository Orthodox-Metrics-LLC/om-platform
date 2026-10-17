import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let count = 0;
async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const src = path.join(dir, entry.name);
        if (entry.isDirectory()) { await walk(src); continue; }
        if (!/\.tsx?$/.test(src)) continue;
        let text = await fs.readFile(src, 'utf8');
        if (src.endsWith('.tsx') && !/import\s+(?:React\b|\*\s+as\s+React\b)/.test(text)) text = `import * as React from 'react';\n${text}`;
        const result = ts.transpileModule(text, { fileName: src, reportDiagnostics: true, compilerOptions: {
            target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, esModuleInterop: true
        } });
        const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
        if (errors.length) throw new Error(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
        let out = result.outputText.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, a, b, c) => a + (/\.[a-z]+$/i.test(b) ? b : b + '.js') + c)
            .replace(/import\s+['"][^'"]+\.css['"];?\s*/g, '');
        const dest = path.join(root, 'preview/app', path.relative(path.join(root, 'src'), src).replace(/\.tsx?$/, '.js'));
        await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, out); count++;
    }
}
await walk(path.join(root, 'src'));
await fs.copyFile(path.join(root, 'src/styles.css'), path.join(root, 'preview/app/styles.css'));
console.log(`Refreshed packaged preview: ${count} TypeScript modules transpiled. This is not a Vite production build.`);
