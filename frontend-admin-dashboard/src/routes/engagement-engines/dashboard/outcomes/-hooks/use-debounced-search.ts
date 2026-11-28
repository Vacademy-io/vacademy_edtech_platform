import { useEffect, useRef, useState } from 'react';

/**
 * A search box that writes to the URL a moment after typing stops. `committed` is the value
 * the URL holds. The box follows the URL when something else changes it (a link, back, Clear
 * filters), but not when the change is the box's own, so a letter typed while the URL catches
 * up is never overwritten.
 */
export function useDebouncedSearch(
    committed: string,
    onCommit: (value: string) => void,
    delayMs = 400
) {
    const [input, setInput] = useState(committed);
    const lastCommitted = useRef(committed);
    const commit = useRef(onCommit);

    useEffect(() => {
        commit.current = onCommit;
    }, [onCommit]);

    useEffect(() => {
        if (committed !== lastCommitted.current) {
            lastCommitted.current = committed;
            setInput(committed);
        }
    }, [committed]);

    useEffect(() => {
        const next = input.trim();
        if (next === committed.trim()) return;
        const timer = setTimeout(() => {
            lastCommitted.current = next;
            commit.current(next);
        }, delayMs);
        return () => clearTimeout(timer);
    }, [input, committed, delayMs]);

    return [input, setInput] as const;
}
