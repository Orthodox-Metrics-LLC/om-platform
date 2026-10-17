import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookPage, Preferences } from '../types';
import { NARRATORS, narrationQueue, resolveBrowserVoice, type SpeechChunk } from '../lib/narration';

type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'error';
interface Playback { status: Status; index: number; total: number; pageId: string; title: string; start: number; message: string; }
const INITIAL: Playback = { status:'idle', index:0, total:0, pageId:'', title:'', start:-1, message:'' };
export function useNarration(prefs: Preferences, onPage: (id: string) => void) {
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]), [cloudReady, setCloudReady] = useState(false);
    const [playback, setPlayback] = useState<Playback>(INITIAL);
    const data = useRef({ prefs, onPage, voices }); data.current = { prefs, onPage, voices };
    const queue = useRef<SpeechChunk[]>([]), index = useRef(0), generation = useRef(0), alive = useRef(true);
    const audio = useRef<HTMLAudioElement | null>(null), url = useRef(''), request = useRef<AbortController | null>(null);
    const utterance = useRef<SpeechSynthesisUtterance | null>(null), paused = useRef(false), currentPage = useRef('');
    const activePrefs = useRef(prefs);
    const set = (patch: Partial<Playback>) => { if (alive.current) setPlayback(old => ({ ...old, ...patch })); };
    const release = () => {
        request.current?.abort(); request.current = null;
        if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); utterance.current = null;
        if (audio.current) { audio.current.onended = null; audio.current.onerror = null; audio.current.pause(); audio.current.src = ''; audio.current = null; }
        if (url.current) { URL.revokeObjectURL(url.current); url.current = ''; }
    };
    const stop = useCallback(() => { generation.current++; paused.current = false; release(); queue.current = []; currentPage.current = ''; setPlayback(INITIAL); }, []);
    const playChunk = async (at: number, token: number) => {
        if (token !== generation.current || !alive.current) return;
        if (at >= queue.current.length) { release(); set({ status:'finished', message:'Reading complete.' }); return; }
        index.current = at;
        const chunk = queue.current[at], options = activePrefs.current;
        set({ status: paused.current ? 'paused' : 'loading', index:at, total:queue.current.length, pageId:chunk.pageId, title:chunk.title, start:chunk.start, message:'' });
        if (chunk.pageId !== currentPage.current) {
            currentPage.current = chunk.pageId;
            if (options.narrationFollow !== false && chunk.pageId !== 'voice-preview') data.current.onPage(chunk.pageId);
        }
        const end = () => { if (token === generation.current && !paused.current) void playChunk(at + 1, token); };
        const fail = (message: string) => { if (token === generation.current) set({ status:'error', message }); };
        try {
            if (options.narrationEngine === 'azure') {
                if (!options.narrationCloudConsent) throw new Error('Enable neural narration consent before sending reading text to Azure.');
                if (url.current) { URL.revokeObjectURL(url.current); url.current = ''; }
                request.current = new AbortController();
                const response = await fetch(new URL('api/narration/synthesize', document.baseURI), {
                    method:'POST', headers:{ 'Content-Type':'application/json', 'X-OM-Reader':'1' }, signal:request.current.signal,
                    body:JSON.stringify({ text:chunk.text, preset:options.narrationPreset || 'us-female', rate:options.narrationRate || .95 })
                });
                if (!response.ok) { const problem = await response.json().catch(() => ({})); throw new Error(problem.error || `Narration service returned ${response.status}.`); }
                const blob = await response.blob();
                if (token !== generation.current) return;
                url.current = URL.createObjectURL(blob);
                const player = new Audio(url.current); audio.current = player;
                player.onended = end; player.onerror = () => fail('Audio could not play. Check your output device and try again.');
                if (!paused.current) {
                    try { await player.play(); if (token === generation.current) set({ status:'playing' }); }
                    catch { paused.current = true; set({ status:'paused', message:'Your browser requires a click. Press Resume to start the voice.' }); }
                }
            } else {
                if (typeof speechSynthesis === 'undefined') throw new Error('Speech synthesis is unavailable in this browser.');
                const voice = resolveBrowserVoice(data.current.voices, options.narrationPreset || 'us-female', options.narrationVoiceURI);
                if (!voice) throw new Error('This voice is not installed. Choose an available device voice, or configure the four neural narrators.');
                const item = new SpeechSynthesisUtterance(chunk.text); utterance.current = item;
                item.voice = voice; item.lang = voice.lang; item.rate = options.narrationRate || .95;
                item.onstart = () => { if (token === generation.current) set({ status:'playing' }); };
                item.onboundary = e => { if (token === generation.current && chunk.start >= 0) set({ start:chunk.start + e.charIndex }); };
                item.onend = end;
                item.onerror = e => { if (e.error !== 'canceled' && e.error !== 'interrupted') fail(`Voice playback failed (${e.error}). Choose another voice and try again.`); };
                if (!paused.current) speechSynthesis.speak(item);
            }
        } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) fail(e instanceof Error ? e.message : String(e)); }
    };
    const begin = (chunks: SpeechChunk[], message = '') => {
        generation.current++; release(); paused.current = false; currentPage.current = ''; queue.current = chunks; activePrefs.current = { ...data.current.prefs };
        if (!chunks.length) { set({ ...INITIAL, status:'error', message:'No reading text is available for these pages. The original scans remain available.' }); return; }
        void playChunk(0, generation.current); if (message) set({ message });
    };
    const start = (pages: BookPage[]) => begin(narrationQueue(pages), pages.some(p => !p.text.trim()) ? 'Scan-only pages are skipped; only existing text is spoken.' : '');
    const pause = () => {
        paused.current = true;
        if (activePrefs.current.narrationEngine === 'azure') audio.current?.pause();
        else if (typeof speechSynthesis !== 'undefined') speechSynthesis.pause();
        set({ status:'paused' });
    };
    const resume = () => {
        if (!queue.current.length) return;
        paused.current = false;
        if (activePrefs.current.narrationEngine === 'azure' && audio.current) {
            void audio.current.play().then(() => set({ status:'playing', message:'' })).catch(() => set({ status:'error', message:'Audio could not resume. Try Play again.' }));
        } else if (activePrefs.current.narrationEngine !== 'azure') {
            // Resume by repeating the current short phrase; works on devices whose speech pause/resume is unreliable.
            generation.current++; release(); void playChunk(index.current, generation.current);
        } else { generation.current++; release(); void playChunk(index.current, generation.current); }
    };
    const skip = (direction: -1 | 1) => {
        if (!queue.current.length) return;
        generation.current++; release(); paused.current = false;
        void playChunk(Math.max(0, index.current + direction), generation.current);
    };
    const preview = () => begin([{ pageId:'voice-preview', title:'Voice preview', start:-1, end:-1, text:'Welcome to your reading room. Take a quiet moment, and let us continue with the book.' }]);
    useEffect(() => {
        alive.current = true;
        let active = true;
        const load = () => { if (typeof speechSynthesis !== 'undefined') setVoices(speechSynthesis.getVoices()); };
        load(); if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener('voiceschanged', load);
        const retry = setInterval(load, 1500);
        void fetch(new URL('api/narration/status', document.baseURI)).then(r => r.ok ? r.json() : null).then(s => active && setCloudReady(s?.configured === true)).catch(() => {});
        return () => { active = false; alive.current = false; generation.current++; release(); clearInterval(retry); if (typeof speechSynthesis !== 'undefined') speechSynthesis.removeEventListener('voiceschanged', load); };
    }, []);
    const narrator = NARRATORS.find(n => n.id === (prefs.narrationPreset || 'us-female')) || NARRATORS[0];
    const voice = resolveBrowserVoice(voices, narrator.id, prefs.narrationVoiceURI);
    return { playback, voices, cloudReady, voice, narrator, start, pause, resume, stop, skip, preview,
        available: prefs.narrationEngine === 'azure' ? cloudReady && !!prefs.narrationCloudConsent : !!voice,
        active: ['loading','playing','paused'].includes(playback.status) };
}
export type NarrationController = ReturnType<typeof useNarration>;
