import { readingDocument } from './readingDocument';
import type { BookPage, NarrationPreset } from '../types';
export const NARRATORS: { id: NarrationPreset; label: string; locale: string; azureVoice: string; name: string; browserNames: RegExp }[] = [
    { id: 'us-female', label: 'US · Female', locale: 'en-US', azureVoice: 'en-US-JennyNeural', name: 'Jenny', browserNames: /\b(Jenny|Aria|Samantha|Zira|Ava|Joanna)\b/i },
    { id: 'us-male', label: 'US · Male', locale: 'en-US', azureVoice: 'en-US-GuyNeural', name: 'Guy', browserNames: /\b(Guy|David|Alex|Aaron|Matthew)\b/i },
    { id: 'uk-female', label: 'UK · Female', locale: 'en-GB', azureVoice: 'en-GB-SoniaNeural', name: 'Sonia', browserNames: /\b(Sonia|Libby|Serena|Kate|Hazel|Stephanie)\b|Google UK English Female/i },
    { id: 'uk-male', label: 'UK · Male', locale: 'en-GB', azureVoice: 'en-GB-RyanNeural', name: 'Ryan', browserNames: /\b(Ryan|Daniel|George|Arthur|Oliver)\b|Google UK English Male/i }
];
export interface VoiceInfo { name: string; lang: string; voiceURI: string; localService: boolean; default?: boolean; }
export function resolveBrowserVoice<T extends VoiceInfo>(voices: T[], preset: NarrationPreset, explicitURI?: string): T | undefined {
    if (explicitURI) return voices.find(v => v.voiceURI === explicitURI);
    const narrator = NARRATORS.find(n => n.id === preset) || NARRATORS[0];
    // Web Speech exposes locale/name, not gender. Only recognizable named voices are mapped to a preset.
    // An unknown voice is never silently labeled female/male or given a fabricated accent.
    return voices.filter(v => v.lang.replace('_','-').toLowerCase() === narrator.locale.toLowerCase() && narrator.browserNames.test(v.name))
        .sort((a,b) => Number(/Natural|Neural|Premium|Enhanced/i.test(b.name)) - Number(/Natural|Neural|Premium|Enhanced/i.test(a.name)))[0];
}
export interface SpeechChunk { pageId: string; title: string; text: string; start: number; end: number; }
/** Short, sequential utterances avoid browser long-utterance stalls. Exact offsets are retained. */
export function splitSpeech(text: string, maxLength = 240): { text: string; start: number; end: number }[] {
    const chunks: { text: string; start: number; end: number }[] = [];
    let start = 0;
    while (start < text.length) {
        while (start < text.length && /\s/.test(text[start])) start++;
        if (start >= text.length) break;
        const limit = Math.min(text.length, start + Math.max(40, maxLength));
        let end = limit;
        if (limit < text.length) {
            const slice = text.slice(start, limit);
            const boundaries = [...slice.matchAll(/[.!?;]\s+|\n/g)].map(m => m.index! + m[0].length);
            const last = boundaries.filter(n => n >= 40).at(-1);
            if (last) end = start + last;
            else { const space = slice.lastIndexOf(' '); if (space > 20) end = start + space; }
            // Do not cut a UTF-16 surrogate pair in half.
            if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end--;
        }
        let cleanEnd = end;
        while (cleanEnd > start && /\s/.test(text[cleanEnd - 1])) cleanEnd--;
        if (cleanEnd > start) chunks.push({ text: text.slice(start, cleanEnd), start, end: cleanEnd });
        start = end;
    }
    return chunks;
}
export function narrationQueue(pages: BookPage[]): SpeechChunk[] {
    return pages.flatMap(page => {
        if (!page.text.trim()) return [];
        const content = readingDocument(page);
        const headings = [content.title, content.weekday, content.feast, content.fasting, content.readings].filter(Boolean);
        return [
            ...headings.flatMap(text => splitSpeech(text).map(c => ({ pageId:page.id, title:content.title, text:c.text, start:-1, end:-1 }))),
            ...content.parts.flatMap(part => splitSpeech(page.text.slice(part.start,part.end)).map(chunk => ({...chunk,start:chunk.start+part.start,end:chunk.end+part.start,pageId:page.id,title:content.title})))
        ];
    });
}
