/**
 * Opening a different screen, by a tap or by Back and Forward, starts it at the
 * top. The router takes scroll restoration from the browser and nothing restores
 * a position yet, so without this Back would land wherever the last screen was.
 *
 * Search-param updates (tabs, filters, next lesson) keep their place. Screens
 * listed below manage their own scrolling, so nothing here runs when one of them
 * opens.
 */

const SELF_SCROLLING_ROUTES = [
    /^\/\$tagName(\/|$)/,
    /^\/assessment\/examination\/\$assessmentId(\/|$)/,
    /^\/study-library\/courses\/course-details\/subjects\/modules\/chapters\/slides(\/|$)/,
];

export interface ScrollResetInput {
    /** The location the app last settled on; absent on the first load. */
    fromPathname: string | undefined;
    toPathname: string;
    toHash: string;
    /** Route ids of the screen being opened. */
    routeIds: string[];
}

export function shouldResetScroll({
    fromPathname,
    toPathname,
    toHash,
    routeIds,
}: ScrollResetInput): boolean {
    if (fromPathname === undefined || fromPathname === toPathname) return false;
    if (toHash) return false;
    return !routeIds.some((id) =>
        SELF_SCROLLING_ROUTES.some((route) => route.test(id))
    );
}

interface ScrollResetRouter {
    subscribe: (
        event: "onBeforeRouteMount",
        listener: (event: {
            fromLocation?: { pathname: string };
            toLocation: { pathname: string; hash: string };
        }) => void
    ) => () => void;
    state: { matches: Array<{ routeId: string }> };
}

export function installScrollReset(router: ScrollResetRouter): void {
    // Fires in the layout phase of the commit that swaps the screen in, so the new
    // screen is never painted at the old position and the old one never jumps first.
    router.subscribe("onBeforeRouteMount", ({ fromLocation, toLocation }) => {
        const reset = shouldResetScroll({
            fromPathname: fromLocation?.pathname,
            toPathname: toLocation.pathname,
            toHash: toLocation.hash,
            routeIds: router.state.matches.map((match) => match.routeId),
        });
        if (reset) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    });
}
