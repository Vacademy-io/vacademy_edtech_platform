/**
 * A one-shot request to reopen the Course Finder on the catalogue.
 *
 * The finder is a once-ever dialog: completing or skipping it writes
 * `courseFinderSeen_<institute>_<tag>` to localStorage and it never returns.
 * That is right for a first visit, but "Back to courses" from the cart is a
 * visitor deliberately going back to CHOOSE — the one moment the picker is
 * most useful and precisely when the seen flag suppresses it.
 *
 * A sessionStorage handoff rather than a query param: the catalogue route
 * declares no search schema, and a flag that clears itself on read cannot
 * linger in a URL the visitor might share or reload into.
 */
const KEY = "catalogueReopenFinder";

/** Ask the catalogue to open its finder on the next render of `tagName`. */
export function requestCourseFinder(tagName: string): void {
    if (typeof window === "undefined" || !tagName) return;
    try {
        window.sessionStorage.setItem(KEY, tagName);
    } catch {
        // Private mode: the finder simply will not reopen, which is today's
        // behaviour rather than a broken one.
    }
}

/** True once, for this tag, if a reopen was requested. Clears the request. */
export function consumeCourseFinderRequest(tagName: string | undefined): boolean {
    if (typeof window === "undefined" || !tagName) return false;
    try {
        if (window.sessionStorage.getItem(KEY) !== tagName) return false;
        window.sessionStorage.removeItem(KEY);
        return true;
    } catch {
        return false;
    }
}
