import { useEffect, useState } from 'react';

/** Matches the Tailwind `xl` breakpoint, where the editor shows its three panes side by side. */
export const XL_QUERY = '(min-width: 1280px)';

export function useMediaQuery(query: string): boolean {
    const read = () =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(query).matches
            : false;
    const [matches, setMatches] = useState(read);
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(query);
        const onChange = () => setMatches(mql.matches);
        onChange();
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, [query]);
    return matches;
}
