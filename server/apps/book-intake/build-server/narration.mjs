/** Optional server-only Azure proxy. No key is ever embedded in frontend code. */
const VOICES = Object.freeze({ 'us-female':'en-US-JennyNeural', 'us-male':'en-US-GuyNeural', 'uk-female':'en-GB-SoniaNeural', 'uk-male':'en-GB-RyanNeural' });
export const xmlEscape = value => String(value).replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' })[c]);
export function narrationSSML(text, preset, rate) {
    const voice = Object.hasOwn(VOICES, preset) ? VOICES[preset] : null;
    if (!voice || typeof text !== 'string' || !text.trim() || text.length > 1400 || !Number.isFinite(rate) || rate < .65 || rate > 1.5) throw new Error('Invalid narration request.');
    const percent = Math.round((rate - 1) * 100);
    return `<speak version="1.0" xml:lang="${voice.slice(0,5)}" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${voice}"><prosody rate="${percent >= 0 ? '+' : ''}${percent}%">${xmlEscape(text)}</prosody></voice></speak>`;
}
export function createNarrationMiddleware(env = process.env, fetcher = globalThis.fetch) {
    const key = env.OM_AZURE_SPEECH_KEY, region = env.OM_AZURE_SPEECH_REGION;
    const configured = Boolean(key && region && /^[a-z0-9-]{1,50}$/.test(region));
    const limits = new Map();
    return async function narration(req, res, next) {
        const pathname = (req.url || '').split('?')[0];
        if (!['/api/narration/status','/api/narration/synthesize'].includes(pathname)) { next(); return; }
        const json = (status, data) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(data)); };
        if (pathname.endsWith('/status') && req.method === 'GET') { json(200, { configured }); return; }
        if (req.method !== 'POST') { json(405, { error:'Method not allowed.' }); return; }
        // Origin + non-simple custom header protect the optional paid LAN endpoint from browser CSRF.
        let sameOrigin = false;
        try { const origin = new URL(req.headers.origin || ''); sameOrigin = origin.host === req.headers.host && ['http:','https:'].includes(origin.protocol); } catch {}
        if (!sameOrigin || req.headers['x-om-reader'] !== '1' || !(req.headers['content-type'] || '').startsWith('application/json')) { json(403, { error:'Narration requests must come from this reader.' }); return; }
        if (!configured) { json(503, { error:'Neural narration is not configured. Add OM_AZURE_SPEECH_KEY and OM_AZURE_SPEECH_REGION to the server .env.local, then restart.' }); return; }
        const now = Date.now(), ip = req.socket.remoteAddress || 'local';
        for (const [client, item] of limits) if (now - item.started > 60_000) limits.delete(client);
        const limit = limits.get(ip) || { started:now, count:0 }; limits.set(ip, limit);
        if (++limit.count > 90) { json(429, { error:'Narration rate limit reached. Wait one minute and resume.' }); return; }
        let size = 0, chunks = [];
        try {
            for await (const chunk of req) { size += chunk.length; if (size > 16000) { json(413, { error:'Narration request is too large.' }); return; } chunks.push(chunk); }
            let payload, ssml;
            try { payload = req.body!==undefined?req.body:JSON.parse(Buffer.concat(chunks).toString('utf8')); if(Buffer.byteLength(JSON.stringify(payload))>16000)throw Error('Request too large.'); ssml = narrationSSML(payload.text, payload.preset, payload.rate); }
            catch { json(400, { error:'Invalid narration text, voice, or speed.' }); return; }
            const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 25000);
            const disconnected = () => { if (!res.writableEnded) abort.abort(); }; res.on('close', disconnected);
            try {
                const response = await fetcher(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
                    method:'POST', signal:abort.signal, headers:{ 'Ocp-Apim-Subscription-Key':key, 'Content-Type':'application/ssml+xml', 'X-Microsoft-OutputFormat':'audio-24khz-48kbitrate-mono-mp3', 'User-Agent':'OM-Book-Reader' }, body:ssml
                });
                if (!response.ok) { json(response.status === 429 ? 429 : 502, { error:`Azure narration returned ${response.status}. Check the server's region, key and Speech resource quota.` }); return; }
                const bytes = Buffer.from(await response.arrayBuffer());
                if (bytes.length > 5 * 1024 * 1024) { json(502, { error:'Unexpectedly large narration response.' }); return; }
                if (!res.destroyed) { res.writeHead(200, { 'Content-Type':'audio/mpeg', 'Cache-Control':'no-store', 'Content-Length':bytes.length, 'X-Content-Type-Options':'nosniff' }); res.end(bytes); }
            } finally { clearTimeout(timer); res.removeListener('close', disconnected); }
        } catch { json(502, { error:'The narration service could not be reached or timed out. Retry playback.' }); }
    };
}
