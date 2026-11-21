import { useCallback, useRef } from 'react';

/**
 * `client_request_id` for every order desk write: 8..64 of `[A-Za-z0-9_-]`
 * (CommerceRequestGuard). The server replays an answer for a key it has seen
 * with the same body and refuses the same key with another body
 * (409 IDEMPOTENCY_MISMATCH).
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

const randomBase36 = (length: number): string => {
    const out: string[] = [];
    const bytes = new Uint8Array(length);
    try {
        globalThis.crypto.getRandomValues(bytes);
    } catch {
        for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes.forEach((byte) => out.push(ALPHABET[byte % 36] as string));
    return out.join('');
};

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** `w-<time>-<12 random>`: at most 64 characters, safe alphabet. */
export function newRequestId(prefix = 'w'): string {
    const safe = prefix.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'w';
    return `${safe}-${Date.now().toString(36)}-${randomBase36(12)}`;
}

/** Bulk key prefix: the server appends a per-item suffix, so the prefix stays ≤ 27. */
export function newBulkPrefix(): string {
    return `b-${randomBase36(20)}`;
}

/**
 * One request id per body while a dialog is open: a double tap or a retry of
 * the same body sends the same id (the server replays), an edited body gets a
 * new id (so it never hits IDEMPOTENCY_MISMATCH). `reset()` when the dialog
 * closes or after IDEMPOTENCY_MISMATCH.
 */
export function useRequestId(prefix = 'w') {
    const last = useRef<{ body: string; id: string } | null>(null);
    const idFor = useCallback(
        (body: unknown): string => {
            const key = JSON.stringify(body ?? null);
            if (last.current && last.current.body === key) return last.current.id;
            const id = newRequestId(prefix);
            last.current = { body: key, id };
            return id;
        },
        [prefix]
    );
    const reset = useCallback(() => {
        last.current = null;
    }, []);
    return { idFor, reset };
}
