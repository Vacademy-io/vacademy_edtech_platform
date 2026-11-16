/**
 * Reading `renditions` of a gallery entry, as the server writes it
 * (`CommerceRenditionState`): number keys are rendition widths with public
 * URLs, keys with a leading underscore are the rendition job's own state.
 */

export type RenditionStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

const STATUSES: readonly string[] = ['PENDING', 'PROCESSING', 'READY', 'FAILED'];

type Renditions = Record<string, unknown> | null | undefined;

/** Width → URL, narrowest first, without the job's keys. */
export function renditionUrls(renditions: Renditions): Array<{ width: number; url: string }> {
    return Object.entries(renditions ?? {})
        .filter(
            (entry): entry is [string, string] =>
                /^\d+$/.test(entry[0]) && typeof entry[1] === 'string' && entry[1].trim() !== ''
        )
        .map(([width, url]) => ({ width: Number(width), url }))
        .sort((a, b) => a.width - b.width);
}

/**
 * PENDING, PROCESSING, READY or FAILED. No state at all (the image was never
 * looked at) is PENDING; a state without a status is READY when it has URLs.
 */
export function renditionStatus(renditions: Renditions): RenditionStatus {
    if (!renditions) return 'PENDING';
    const status = renditions._status;
    if (typeof status === 'string' && STATUSES.includes(status)) return status as RenditionStatus;
    return renditionUrls(renditions).length > 0 ? 'READY' : 'PENDING';
}

/** True while the job still has work to do on the image. */
export const renditionInProgress = (renditions: Renditions): boolean => {
    const status = renditionStatus(renditions);
    return status === 'PENDING' || status === 'PROCESSING';
};

/** Why the job gave up, when it says. */
export const renditionError = (renditions: Renditions): string | null =>
    typeof renditions?._error === 'string' && renditions._error ? renditions._error : null;

/**
 * The rendition to draw in a box `wanted` pixels wide: the narrowest one that
 * is at least that wide, or the widest there is. Null when none is made yet.
 */
export function renditionFor(renditions: Renditions, wanted: number): string | null {
    const urls = renditionUrls(renditions);
    const fit = urls.find((entry) => entry.width >= wanted) ?? urls[urls.length - 1];
    return fit?.url ?? null;
}
