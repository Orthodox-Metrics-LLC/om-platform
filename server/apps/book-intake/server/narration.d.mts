import type { IncomingMessage, ServerResponse } from 'node:http';
export function createNarrationMiddleware(env?: Record<string, string | undefined>, fetcher?: typeof fetch): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
export function narrationSSML(text: string, preset: string, rate: number): string;
export function xmlEscape(value: string): string;
