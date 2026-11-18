import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keyboard-wedge scanning (contract §5.3.2). A USB or Bluetooth scanner types
 * into the focused input and presses Enter; a person on a phone types and taps
 * Add. `onScan` gets the trimmed code (1..100 characters; a label's QR link
 * becomes its code, see `normaliseScannedCode`), the box clears, and a
 * repeat of the same code within 400 ms (scanner bounce) is dropped. The input
 * takes the focus back after a scan, after a dialog closes and when the window
 * regains focus, unless another field has it.
 */
export const SCAN_BOUNCE_MS = 400;
export const SCAN_MAX_LENGTH = 100;

/** A shop label's QR holds `https://<shop>/q/<code>`; the code is the last path part. */
const LABEL_URL = /^https?:\/\/[^\s]+\/q\/([A-Za-z0-9_-]{1,64})\/?(?:[?#].*)?$/i;

/**
 * What a scanner typed, as the code the server looks up: the text trimmed, and
 * a label's QR link (`https://shop.example/q/PABCDEFGH2`) cut down to its code.
 * Anything else (a bare code, an SKU, a barcode, an order number) is left as it
 * is, so every existing scan reads the same as before.
 */
export function normaliseScannedCode(raw: string): string {
    const text = (raw ?? '').trim();
    const match = LABEL_URL.exec(text);
    return match?.[1] ?? text;
}

export function useScanInput(onScan: (code: string) => void, options: { autoFocus?: boolean; paused?: boolean } = {}) {
    const { autoFocus = true, paused = false } = options;
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [value, setValue] = useState('');
    const last = useRef<{ code: string; at: number } | null>(null);
    const handler = useRef(onScan);
    handler.current = onScan;

    const refocus = useCallback(() => {
        if (paused) return;
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        const busyElsewhere =
            active &&
            active !== inputRef.current &&
            (active instanceof HTMLInputElement ||
                active instanceof HTMLTextAreaElement ||
                active instanceof HTMLSelectElement ||
                (active as HTMLElement).isContentEditable);
        if (!busyElsewhere) inputRef.current?.focus();
    }, [paused]);

    const submit = useCallback(
        (raw?: string) => {
            const code = normaliseScannedCode(raw ?? inputRef.current?.value ?? value);
            setValue('');
            if (inputRef.current) inputRef.current.value = '';
            if (!code || code.length > SCAN_MAX_LENGTH) return;
            const now = Date.now();
            if (last.current && last.current.code === code && now - last.current.at < SCAN_BOUNCE_MS) return;
            last.current = { code, at: now };
            handler.current(code);
            inputRef.current?.focus();
        },
        [value]
    );

    const onKeyDown = useCallback(
        (event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submit(event.currentTarget.value);
            }
        },
        [submit]
    );

    useEffect(() => {
        if (autoFocus && !paused) refocus();
        const onWindowFocus = () => refocus();
        window.addEventListener('focus', onWindowFocus);
        return () => window.removeEventListener('focus', onWindowFocus);
    }, [autoFocus, paused, refocus]);

    return {
        inputRef,
        value,
        setValue,
        submit,
        refocus,
        inputProps: {
            ref: inputRef,
            value,
            onChange: (event: { target: { value: string } }) => setValue(event.target.value),
            onKeyDown,
            inputMode: 'text' as const,
            autoComplete: 'off',
            autoCapitalize: 'characters',
            spellCheck: false,
            enterKeyHint: 'go' as const,
            maxLength: SCAN_MAX_LENGTH,
        },
    };
}

/** A short buzz on a refused scan, where the device has one. */
export function buzz(): void {
    try {
        globalThis.navigator?.vibrate?.(150);
    } catch {
        // No vibration; the message on screen is enough.
    }
}
