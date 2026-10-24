import { useEffect, useState } from 'react';

/**
 * Trailing-edge debounce for a value.
 *
 * Used by the Staff Coverage search box: the bridge endpoint scans every user in
 * the institute, so firing it per keystroke is both slow and pointless — only the
 * value the admin stopped typing on matters.
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);

    return debounced;
}
