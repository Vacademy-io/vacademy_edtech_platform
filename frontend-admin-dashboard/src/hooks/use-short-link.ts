import { useQuery } from '@tanstack/react-query';
import { getOrCreateShortLink, toShortCodeHint } from '@/services/short-link';

interface UseShortLinkArgs {
    /** A `SHORT_LINK_SOURCE` value. */
    source: string;
    /** Identifies the entity within that source — together they key the link. */
    sourceId?: string;
    /** Where the code should send people. Only read when the link is first created. */
    destinationUrl?: string;
    /** Picks the institute's own short domain, when it has one. */
    instituteId?: string;
    /**
     * Gate the request. Defaults to `false` on purpose: shortening is a *write*
     * (it inserts a `short_links` row), so a list of cards must not mint a link
     * for every campaign the moment it renders — only when someone actually
     * asks to share one.
     */
    enabled?: boolean;
}

export interface UseShortLinkResult {
    /** The short URL, or `null` until one has been fetched. */
    shortUrl: string | null;
    isLoading: boolean;
    isError: boolean;
}

/**
 * Lazily get-or-create the short URL for an entity.
 *
 * Cached per set of arguments, so the card, the kebab menu and the share dialog
 * — which all ask for the same campaign with the same values — share one request
 * instead of firing three. Even when a key does change (the institute's portal
 * URL resolving a tick after first render, say) the extra call is harmless: the
 * server keys a link on `(source, sourceId)` alone, so it returns the code that
 * already exists rather than minting a second one.
 *
 * Never retries and never throws at the caller: shortening is a convenience, and
 * every consumer is expected to fall back to the long URL when `shortUrl` is
 * null. A dead shortener must not cost an admin the ability to share a form.
 */
export function useShortLink({
    source,
    sourceId,
    destinationUrl,
    instituteId,
    enabled = false,
}: UseShortLinkArgs): UseShortLinkResult {
    const query = useQuery({
        queryKey: ['short-link', source, sourceId, destinationUrl, instituteId],
        queryFn: () =>
            getOrCreateShortLink({
                source,
                sourceId: sourceId as string,
                destinationUrl: destinationUrl as string,
                instituteId,
                // Derived here, not passed in: the code is an implementation
                // detail of shortening, and letting callers supply it is how one
                // of them ends up handing over a live-watched form value that
                // changes the query key on every keystroke.
                shortCode: toShortCodeHint(sourceId as string),
            }),
        enabled: enabled && !!source && !!sourceId && !!destinationUrl,
        staleTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
        // Attempt the request even when the browser reports itself offline.
        // React Query's default 'online' mode would PAUSE the fetch instead:
        // isFetching stays false, no error is ever produced, and a caller
        // waiting on "either a URL or an error" hangs forever on a dead click.
        // Letting it fail fast gives every consumer the error path it expects.
        networkMode: 'always',
    });

    return {
        shortUrl: query.data?.absoluteUrl ?? null,
        isLoading: query.isFetching,
        isError: query.isError,
    };
}
