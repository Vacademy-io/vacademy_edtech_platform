import type { OrderableFile } from './order-files';

/**
 * Turning other intake shapes into the two passes a load needs.
 *
 * One folder: both passes landed in the same folder, numbered on. The pause
 * while the clerk turns the pile over leaves the biggest gap in modified times,
 * so the folder is split there, and only when that gap is exactly in the middle
 * (n/2 + n/2). Anything less clear is refused and the clerk uses two zones; the
 * clerk confirms an accepted split before upload either way.
 */

/** Below this the "turn the pile over" pause cannot be told from feed jitter. */
export const MIN_SPLIT_GAP_MS = 2000;

export type SplitRefusal = 'EMPTY' | 'ODD_COUNT' | 'NO_CLEAR_GAP';

export type SplitResult<T> =
    | { ok: true; first: T[]; second: T[]; splitAfterName: string; gapMs: number }
    | { ok: false; reason: SplitRefusal };

export const splitOneFolder = <T extends OrderableFile>(ordered: T[]): SplitResult<T> => {
    const n = ordered.length;
    if (n === 0) return { ok: false, reason: 'EMPTY' };
    if (n % 2 !== 0) return { ok: false, reason: 'ODD_COUNT' };
    let best = -1;
    let bestGap = -Infinity;
    let tie = false;
    for (let i = 0; i + 1 < n; i += 1) {
        const gap = ordered[i + 1]!.lastModified - ordered[i]!.lastModified;
        if (gap > bestGap) {
            bestGap = gap;
            best = i;
            tie = false;
        } else if (gap === bestGap) {
            tie = true;
        }
    }
    const middle = n / 2 - 1;
    if (best !== middle || tie || bestGap < MIN_SPLIT_GAP_MS) {
        return { ok: false, reason: 'NO_CLEAR_GAP' };
    }
    return {
        ok: true,
        first: ordered.slice(0, n / 2),
        second: ordered.slice(n / 2),
        splitAfterName: ordered[middle]!.name,
        gapMs: bestGap,
    };
};

/**
 * A duplex scanner saves front, back, front, back…: the 1st, 3rd, 5th… pages are
 * the first pass and the 2nd, 4th, 6th… the second. An odd count is left for the
 * page-count check to refuse.
 */
export const deinterleaveDuplex = <T>(ordered: T[]): { first: T[]; second: T[] } => ({
    first: ordered.filter((_, i) => i % 2 === 0),
    second: ordered.filter((_, i) => i % 2 === 1),
});
