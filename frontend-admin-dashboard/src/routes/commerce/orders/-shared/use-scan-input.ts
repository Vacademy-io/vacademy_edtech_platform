import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keyboard-wedge scanning (contract §5.3.2). A USB or Bluetooth scanner types
 * into the focused input and presses Enter; a person on a phone types and taps
 * Add. `onScan` gets the trimmed code (1..100 characters), the box clears, and a
 * repeat of the same code within 400 ms (scanner bounce) is dropped. The input
 * takes the focus back after a scan, after a dialog closes and when the window
 * regains focus, unless another field has it.
 */
export const SCAN_BOUNCE_MS = 400;
export const SCAN_MAX_LENGTH = 100;

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
            const code = (raw ?? inputRef.current?.value ?? value).trim();
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
