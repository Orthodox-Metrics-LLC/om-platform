import { startLocalOCR } from './ocrWorker';
import type { BookPage, WordBox } from '../types';
import { renderPage } from './images';
import { textDateCandidates } from './dates';
import { bookId } from './backend';
import { getDatabaseName } from './db';
export interface OCRProgress {
    status: string;
    progress: number;
}
export async function createOCREngine(onProgress: (p: OCRProgress) => void, cancellation?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    cancellation?.addEventListener('abort',abort,{once:true});
    if(cancellation?.aborted)controller.abort();
    const configResponse = await fetch('/api/ocr/config',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
    if (!configResponse.ok) throw new Error('OCR service is unavailable. Check the connection and try again.');
    const config = await configResponse.json();
    if (['llamaparse','google-vision'].includes(config.provider)) {
        if (!config.configured) throw new Error('Configure your OCR API key in Administration.');
        const label=config.provider==='google-vision'?'Google Cloud Vision':'LlamaParse';
        const parse = async (blob: Blob): Promise<{ text: string; words: WordBox[]; confidence?: number }> => {
            onProgress({ status: `Processing with ${label}`, progress: 0 });
            const response = await fetch('/api/ocr/parse', { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-OM-Reader':'1', 'X-OM-Book':bookId(getDatabaseName()) }, body: blob, signal: AbortSignal.any([controller.signal,AbortSignal.timeout(310000)]) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'LlamaParse processing failed.');
            onProgress({ status: `${label} complete`, progress: 1 });
            if(controller.signal.aborted)throw new Error('OCR cancelled.');
            return result;
        };
        return {
            async recognize(page: BookPage) { return parse((await renderPage(page, 3200)).blob); },
            async recognizeHeader(page: BookPage) {
                const image = await renderPage(page, 2800);
                const bitmap = await createImageBitmap(image.blob);
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(bitmap.width * .94); canvas.height = Math.round(bitmap.height * .235);
                    const context = canvas.getContext('2d');
                    if (!context) throw new Error('Header rendering is unavailable.');
                    context.drawImage(bitmap, bitmap.width * .025, bitmap.height * .025, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
                    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not render header.')), 'image/png'));
                    const result = await parse(blob);
                    const keys = [...new Set(textDateCandidates(result.text).map(c => c.key))];
                    // Cloud text has no engine confidence score; date evidence still requires one unique date.
                    return { key: keys.length === 1 ? keys[0] : '', raw: result.text, confidence: 0 };
                } finally { bitmap.close(); }
            },
            terminate: async () => { cancellation?.removeEventListener('abort',abort); controller.abort(); }
        };
    }
    if(config.provider!=='tesseract')throw new Error('Choose an OCR provider in Administration. Tesseract is optional and will not start automatically.');
    const base = new URL('ocr/', document.baseURI);
    const ready = await fetch(new URL('ready.json', base),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
    if (!ready.ok || !(ready.headers.get('content-type') || '').includes('json'))
        throw new Error('The OCR engine is not installed yet. In the project folder run: npm run setup:ocr. Then restart/rebuild the app.');
    await ready.json();
    const PSM={AUTO:'3',SPARSE_TEXT:'11'};
    const worker = await startLocalOCR({
        workerPath: new URL('worker.min.js', base).href,
        corePath: new URL('core/', base).href,
        langPath: new URL('lang', base).href,
        workerBlobURL: false,
    },m => onProgress({ status: m.status, progress: m.progress || 0 }),controller.signal);
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '300' });
    return {
        async recognizeHeader(page: BookPage) {
            const image = await renderPage(page, 2800);
            const bitmap = await createImageBitmap(image.blob);
            let blob: Blob;
            try {
                // Left-aligned month/day lives in the upper quarter of each LOGICAL page.
                // Respect its saved crop/rotation; never OCR both facing pages together.
                const sx = Math.round(bitmap.width*.025), sy = Math.round(bitmap.height*.025);
                const sw = Math.round(bitmap.width*.94), sh = Math.round(bitmap.height*.235);
                const scale = Math.max(1, Math.min(3, 1800/sw));
                const canvas = document.createElement('canvas');canvas.width=Math.round(sw*scale);canvas.height=Math.round(sh*scale);
                const context = canvas.getContext('2d');if(!context)throw new Error('Header rendering is unavailable.');
                context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
                context.drawImage(bitmap,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
                blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not prepare the printed header.')),'image/png'));
            } finally { bitmap.close(); }
            await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,user_defined_dpi:'300'});
            const {data}=await worker.recognize(blob,{}, {text:true,blocks:true});
            const candidates=textDateCandidates(data.text),keys=[...new Set(candidates.map(c=>c.key))];
            return {key:keys.length===1&&data.confidence>=45?keys[0]:'',raw:data.text.trim(),confidence:data.confidence};
        },
        async recognize(page: BookPage) {
            await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '300' });
            const image = await renderPage(page, 3200);
            const { data } = await worker.recognize(image.blob, {}, { text: true, blocks: true });
            let text = '';
            const words: WordBox[] = [];
            for (const block of data.blocks || []) {
                for (const paragraph of block.paragraphs || []) {
                    const rows = (paragraph.lines || []).flatMap((line:any) => line.words || []).filter((w:any) => w.text.trim());
                    if (!rows.length)
                        continue;
                    if (text)
                        text += '\n\n';
                    for (let i = 0; i < rows.length; i++) {
                        const word = rows[i];
                        if (i)
                            text += ' ';
                        const start = text.length;
                        text += word.text;
                        const b = word.bbox;
                        const x = Math.max(0, b.x0 / image.width), y = Math.max(0, b.y0 / image.height);
                        words.push({ text: word.text, start, end: text.length, x, y, w: Math.max(0, Math.min(1 - x, (b.x1 - b.x0) / image.width)), h: Math.max(0, Math.min(1 - y, (b.y1 - b.y0) / image.height)) });
                    }
                }
            }
            if (!text)
                text = data.text.trim();
            return { text, words, confidence: data.confidence };
        }, terminate: () => {cancellation?.removeEventListener('abort',abort);return worker.terminate();}
    };
}
