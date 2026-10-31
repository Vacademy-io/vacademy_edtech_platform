/**
 * Pinned (locked) filters for a leads route.
 *
 * The sidebar sub-tabs an institute builds are nothing more than this page's URL with
 * filters baked in — "Untouched Leads List" is
 * `/audience-manager/recent-leads?range=ALL&called=NOT_CALLED`. Without a way to mark
 * those two params as belonging to the TAB rather than to the user, clearing any filter
 * wiped them and the tab silently turned into "all leads".
 *
 * A `lock` param names the filters the route owns:
 *
 *   /audience-manager/recent-leads?range=ALL&called=NOT_CALLED&lock=range,called
 *
 * Those keep their value, survive "Clear all", render with a lock instead of a remove
 * cross, and their controls are read-only. Everything else behaves exactly as before, so
 * a URL with no `lock` is unchanged.
 */

/** Search-param names that may be pinned. Anything else in `lock` is ignored. */
export const LOCKABLE_PARAMS = [
    // Follow-ups: which bucket tile the sub-tab opens on, and stays on.
    'bucket',
    'range',
    'from',
    'to',
    'status',
    'statusExclude',
    'tier',
    'sla',
    'counsellor',
    'audience',
    'campaignType',
    'source',
    'called',
    'calledCount',
    'calledWithin',
    'workedWithin',
    'search',
] as const;

export type LockableParam = (typeof LOCKABLE_PARAMS)[number];

const LOCKABLE = new Set<string>(LOCKABLE_PARAMS);

/**
 * Parse the `lock` param into the set of pinned filter names. Unknown names are dropped
 * rather than trusted — the value comes from a hand-editable URL.
 */
export function parseLockedParams(lock: string | undefined | null): Set<LockableParam> {
    if (!lock) return new Set();
    const out = new Set<LockableParam>();
    for (const raw of lock.split(',')) {
        const name = raw.trim();
        if (LOCKABLE.has(name)) out.add(name as LockableParam);
    }
    return out;
}

/**
 * Stable signature of a search object, used to tell an EXTERNAL navigation (the user
 * clicked another sub-tab) apart from this page writing its own filters back to the URL.
 * Empty and undefined values are dropped because the router drops them too, so the
 * signature of what we asked for matches the signature of what we get back.
 */
export function searchSignature(search: Record<string, unknown> | undefined): string {
    if (!search) return '';
    const entries = Object.entries(search)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [k, String(v)] as const)
        .sort((a, b) => a[0].localeCompare(b[0]));
    return JSON.stringify(entries);
}
