/**
 * Where a shopper was on each shop page (Back returns to the same
 * place in a listing). The hosted-site routes manage their own scrolling (src/lib/scroll-reset.ts
 * leaves them alone), so the shop does it: a new page opens at the top, Back and Forward
 * return to the remembered offset. Pure, with the storage passed in; ui/hooks.ts wires it.
 */

export const SCROLL_STORE_KEY = 'commerce-scroll';
const MAX_ENTRIES = 40;

export type ScrollPositions = Record<string, number>;

/** One position per address: the listing with its filters and the search text, not the language. */
export const scrollKey = (pathname: string, search: string): string => {
    const params = new URLSearchParams(search || '');
    params.delete('lang');
    for (const key of Array.from(params.keys())) if (key.startsWith('utm_')) params.delete(key);
    params.sort();
    const rest = params.toString();
    return `${pathname.replace(/\/+$/, '') || '/'}${rest ? `?${rest}` : ''}`;
};

/** Records a position, newest last, and forgets the oldest beyond the cap. */
export const rememberScroll = (positions: ScrollPositions, key: string, y: number): ScrollPositions => {
    const next: ScrollPositions = {};
    for (const [k, v] of Object.entries(positions)) if (k !== key) next[k] = v;
    next[key] = Math.max(0, Math.round(y));
    const keys = Object.keys(next);
    for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete next[stale];
    return next;
};

export const readScrollPositions = (storage: Pick<Storage, 'getItem'> | null | undefined): ScrollPositions => {
    try {
        const parsed = JSON.parse(storage?.getItem(SCROLL_STORE_KEY) || '{}') as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: ScrollPositions = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
        }
        return out;
    } catch {
        return {};
    }
};

export const writeScrollPositions = (storage: Pick<Storage, 'setItem'> | null | undefined, positions: ScrollPositions): void => {
    try {
        storage?.setItem(SCROLL_STORE_KEY, JSON.stringify(positions));
    } catch {
        // Private mode or a full store: Back simply opens at the top.
    }
};

export type NavigationKind = 'push' | 'pop' | 'replace' | 'load';

/**
 * What to do with the scroll offset when the shop page on screen changes.
 *  - a new page (a tap): top;
 *  - Back or Forward: the remembered offset of that address;
 *  - the same page with other filters, another variant or language (replace): stay.
 *  - the first page of a visit: leave the browser alone, except after a reload.
 */
export const scrollTarget = (input: {
    kind: NavigationKind;
    samePage: boolean;
    remembered: number | undefined;
}): number | null => {
    if (input.kind === 'pop') return input.remembered ?? 0;
    if (input.kind === 'load') return input.remembered ?? null;
    if (input.samePage) return null;
    return 0;
};
