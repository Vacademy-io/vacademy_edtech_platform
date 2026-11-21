import { getBackendErrorBody } from '@/lib/report-api-error';

/**
 * Codes a commerce guard failure starts its message with. The shared error body
 * has no code field, so the message reads `FEATURE_DISABLED: …`.
 */
export const COMMERCE_ERROR_CODES = [
    'ACCESS_DENIED',
    'FEATURE_DISABLED',
    'ROLE_NOT_ALLOWED',
    'LOCATION_NOT_ALLOWED',
    'PIN_INVALID',
    'PIN_LOCKED',
] as const;

export type CommerceErrorCode = (typeof COMMERCE_ERROR_CODES)[number];

export interface CommerceError {
    code: CommerceErrorCode | null;
    /** The server's sentence without the code prefix, or the fallback. */
    message: string;
}

const CODE_PREFIX = /^([A-Z_]+):\s*(.*)$/s;

/**
 * The text of the error body's `message` (else `ex`), trimmed. A field that is
 * not a string (an object, a number) counts as no sentence, so an unexpected
 * body never crashes the screen that reads it.
 */
export function serverSentence(error: unknown): string {
    const body = getBackendErrorBody(error) as { message?: unknown; ex?: unknown } | null | undefined;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    return (text(body?.message) || text(body?.ex)).trim();
}

/**
 * The server's own sentence for a failed commerce call (the UI shows the
 * server's message), split from its leading code when it has one.
 */
export function readCommerceError(error: unknown, fallback: string): CommerceError {
    const raw = serverSentence(error);
    if (!raw) return { code: null, message: fallback };
    const match = CODE_PREFIX.exec(raw);
    const code = match?.[1];
    if (match && code && (COMMERCE_ERROR_CODES as readonly string[]).includes(code)) {
        return { code: code as CommerceErrorCode, message: match[2]?.trim() || fallback };
    }
    return { code: null, message: raw };
}
