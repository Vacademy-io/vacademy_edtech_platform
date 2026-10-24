import { normalizeCard, type SiteAssistantCard } from './cards';

/**
 * A minimal text/event-stream parser for fetch + ReadableStream (EventSource
 * cannot send the session token). Frames are separated by a blank line; a
 * frame's `event:` names it (default "message") and its `data:` lines are
 * joined with "\n". Comments (": keepalive") and unknown fields are ignored.
 */
export function createSseParser(onFrame: (event: string, data: string) => void) {
    let buffer = '';
    let eventName = '';
    let dataLines: string[] = [];

    const dispatch = () => {
        if (dataLines.length > 0) onFrame(eventName || 'message', dataLines.join('\n'));
        eventName = '';
        dataLines = [];
    };

    const line = (raw: string) => {
        const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (text === '') return dispatch();
        if (text.startsWith(':')) return;
        const colon = text.indexOf(':');
        const field = colon < 0 ? text : text.slice(0, colon);
        let value = colon < 0 ? '' : text.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') eventName = value;
        else if (field === 'data') dataLines.push(value);
    };

    return {
        push(chunk: string) {
            buffer += chunk;
            let idx: number;
            while ((idx = buffer.indexOf('\n')) >= 0) {
                line(buffer.slice(0, idx));
                buffer = buffer.slice(idx + 1);
            }
        },
        /** End of stream: a last frame without its trailing blank line still counts. */
        flush() {
            if (buffer) line(buffer);
            buffer = '';
            dispatch();
        },
    };
}

export type SiteAssistantErrorCode =
    | 'rate_limited'
    | 'daily_cap'
    | 'no_credits'
    | 'disabled'
    | 'invalid'
    | 'internal';

/** The message stream's events (SPEC §4.1). */
export type SiteAssistantStreamEvent =
    | { type: 'token'; text: string }
    | { type: 'card'; card: SiteAssistantCard }
    | { type: 'done'; messageId: string | null; answered: boolean; billed: boolean }
    | { type: 'error'; code: SiteAssistantErrorCode; message: string };

const ERROR_CODES: SiteAssistantErrorCode[] = [
    'rate_limited',
    'daily_cap',
    'no_credits',
    'disabled',
    'invalid',
    'internal',
];

/** One SSE frame → a typed event, or null for anything unknown or malformed. */
export function toStreamEvent(event: string, data: string): SiteAssistantStreamEvent | null {
    let json: unknown;
    try {
        json = JSON.parse(data);
    } catch {
        return null;
    }
    const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
    switch (event) {
        case 'token':
            return typeof obj.text === 'string' ? { type: 'token', text: obj.text } : null;
        case 'card': {
            const card = normalizeCard(obj.card ?? obj);
            return card ? { type: 'card', card } : null;
        }
        case 'done':
            return {
                type: 'done',
                messageId:
                    obj.message_id === undefined || obj.message_id === null
                        ? null
                        : String(obj.message_id),
                answered: obj.answered !== false,
                billed: obj.billed === true,
            };
        case 'error': {
            const code = ERROR_CODES.find((c) => c === obj.code) ?? 'internal';
            return {
                type: 'error',
                code,
                message: typeof obj.message === 'string' ? obj.message : '',
            };
        }
        default:
            return null;
    }
}

/** Reads a fetch Response body as SSE and hands every typed event to `onEvent`. */
export async function readSiteAssistantStream(
    body: ReadableStream<Uint8Array>,
    onEvent: (event: SiteAssistantStreamEvent) => void
): Promise<void> {
    const parser = createSseParser((name, data) => {
        const ev = toStreamEvent(name, data);
        if (ev) onEvent(ev);
    });
    const reader = body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.flush();
}
