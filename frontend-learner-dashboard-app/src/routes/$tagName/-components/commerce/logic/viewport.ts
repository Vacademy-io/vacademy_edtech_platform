/**
 * Pinch-zoom on shop pages. The learner app's document asks for maximum-scale=1 and
 * user-scalable=no (an app-like feel for the course player); a shopper must be able to zoom
 * into a photo to see the weave. The shop's pages take those two out while they are on
 * screen and put the document's own value back when they leave.
 */

/** The viewport content without maximum-scale and user-scalable (the rest kept in order). */
export const zoomableViewport = (content: string): string =>
    content
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part && !/^(maximum-scale|user-scalable)\s*=/i.test(part))
        .join(', ');

let holders = 0;
let original: string | null = null;

/**
 * Called by each shop root while it is mounted; returns its release. The document's own
 * value comes back when the last one releases, so a learner page reached from the shop
 * (a course, the login) keeps the app's setting.
 */
export const holdZoomableViewport = (doc: Document | undefined = typeof document === 'undefined' ? undefined : document): (() => void) => {
    const meta = doc?.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return () => undefined;
    if (holders === 0) {
        original = meta.getAttribute('content') || '';
        const next = zoomableViewport(original);
        if (next !== original) meta.setAttribute('content', next);
    }
    holders += 1;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        holders = Math.max(0, holders - 1);
        if (holders === 0 && original !== null) {
            meta.setAttribute('content', original);
            original = null;
        }
    };
};
