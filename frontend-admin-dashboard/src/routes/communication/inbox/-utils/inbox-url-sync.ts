/**
 * Keeping the open conversation and `?phone=` in step, in both directions, without the two
 * chasing each other.
 *
 * The pair is only stable if each side compares against what is true *now*. Reading a value that
 * was captured before the other direction ran makes a refresh with `?phone=` look like "the URL
 * says X but nothing is open", which clears the parameter, which then clears the selection, which
 * re-adds the parameter — the chat opening and closing on every render.
 */

export type Selection = string | null;

/** URL → store: adopt the conversation named in the URL when it is not the one already open. */
export function shouldAdoptUrlPhone(urlPhone: Selection, openPhone: Selection): boolean {
    return urlPhone !== openPhone;
}

/**
 * store → URL: the search object to navigate to, or `null` when the URL already names the open
 * conversation and navigating would be a no-op.
 *
 * `openPhone` must be read from the store at the moment this runs, not from the render that
 * scheduled it — see the note at the top of this file.
 */
export function urlSearchFor(openPhone: Selection, urlPhone: Selection): { phone?: string } | null {
    if (openPhone === urlPhone) return null;
    return openPhone ? { phone: openPhone } : {};
}
