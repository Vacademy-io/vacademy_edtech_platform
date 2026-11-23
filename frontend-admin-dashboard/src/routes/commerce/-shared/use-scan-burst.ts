import { type KeyboardEvent, useCallback, useRef } from 'react';

/**
 * A label scanned into a length box (WP-44 W6). A keyboard-wedge scanner
 * types its code into whatever has the focus, then presses Enter; in a length
 * box "1" plus code "V12" would read as 112 m. A burst of keys each under
 * ~30 ms apart that ends in Enter, or text with a letter at Enter, is a scan:
 * it goes to the screen's scan handler and the box gets back what it held
 * before the burst. People type far slower than 30 ms a key.
 */
export const SCAN_KEY_GAP_MS = 30;
/** Shorter bursts are a fast typist, not a label. */
export const SCAN_MIN_KEYS = 3;

export interface KeyBurst {
    /** The box's text before the burst's first key. */
    before: string;
    keys: string;
    /** When the last key came (ms). */
    last: number;
}

/** Pure: is Enter now the end of a scan? The code and the text to put back, or null for a typed length. */
export function scanAtEnter(text: string, burst: KeyBurst | null, now: number): { code: string; restore: string } | null {
    if (burst && burst.keys.length >= SCAN_MIN_KEYS && now - burst.last <= SCAN_KEY_GAP_MS) {
        return { code: burst.keys.trim(), restore: burst.before };
    }
    // A slow scanner: a length never has letters.
    if (/\p{L}/u.test(text.replace(/[०-९]/g, ''))) return { code: text.trim(), restore: '' };
    return null;
}

/** Pure: the burst after one more key at `now`. */
export function nextBurst(burst: KeyBurst | null, key: string, before: string, now: number): KeyBurst {
    if (burst && now - burst.last <= SCAN_KEY_GAP_MS) return { ...burst, keys: burst.keys + key, last: now };
    return { before, keys: key, last: now };
}

/**
 * For a length box's `onKeyDown`: returns `{ restore }` when the key ended a
 * scan (Enter is then handled: the code went to `onScan`), else null and the
 * box goes on as usual.
 */
export function useScanBurst(onScan: (code: string) => void, clock: () => number = () => performance.now()) {
    const burst = useRef<KeyBurst | null>(null);
    const handler = useRef(onScan);
    handler.current = onScan;
    const now = useRef(clock);
    now.current = clock;

    return useCallback((event: KeyboardEvent<HTMLInputElement>): { restore: string } | null => {
        const at = now.current();
        const text = event.currentTarget.value;
        if (event.key === 'Enter') {
            const hit = scanAtEnter(text, burst.current, at);
            burst.current = null;
            if (!hit) return null;
            event.preventDefault();
            if (hit.code) handler.current(hit.code);
            return { restore: hit.restore };
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            burst.current = nextBurst(burst.current, event.key, text, at);
        } else if (event.key !== 'Shift') {
            // Backspace, arrows and the like are a person.
            burst.current = null;
        }
        return null;
    }, []);
}
