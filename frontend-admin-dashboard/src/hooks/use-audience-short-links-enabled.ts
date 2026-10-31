import { useQuery } from '@tanstack/react-query';
import { fetchAudienceFormSettings } from '@/services/audience-post-submit-settings';
import { AUDIENCE_FORM_SETTINGS_QUERY_KEY } from '@/routes/settings/-components/AudienceFormSettings';

export interface AudienceShortLinksSwitch {
    /**
     * Whether to SHOW the short-link controls. Optimistically `true` while the
     * setting is still loading — the switch ships enabled and almost no institute
     * has ever touched it, so the controls appear immediately instead of popping
     * in a beat late. Only an explicit `false` hides them.
     */
    enabled: boolean;
    /**
     * Whether the institute's actual preference is now known.
     *
     * Separate from `enabled` because the two answer different questions, and
     * conflating them writes to the database. Showing a control speculatively is
     * free; *shortening* is not — it INSERTs a `short_links` row. If the fetch
     * gate used the optimistic value, an institute that had explicitly opted out
     * would still get a row written whenever a share surface was reached before
     * this request resolved. Gate anything that can write on this flag; gate only
     * rendering on `enabled`.
     */
    isResolved: boolean;
}

/**
 * The institute's "Short links" switch (`AUDIENCE_FORM_SETTING.shortLinksEnabled`).
 *
 * Reads through the SAME react-query key the settings page uses, so all four share
 * surfaces resolve from one cached request no matter how many campaign cards are on
 * screen — and saving in Settings invalidates that key, so a flip is reflected here
 * without a reload.
 */
export function useAudienceShortLinksEnabled(): AudienceShortLinksSwitch {
    const { data, isSuccess, isError } = useQuery({
        queryKey: AUDIENCE_FORM_SETTINGS_QUERY_KEY,
        queryFn: fetchAudienceFormSettings,
        staleTime: 5 * 60 * 1000,
    });

    return {
        enabled: data?.shortLinksEnabled !== false,
        // `fetchAudienceFormSettings` already swallows failures and returns the
        // defaults, so isError is near-unreachable — but treat it as resolved
        // anyway: a settings outage must not permanently block shortening.
        isResolved: isSuccess || isError,
    };
}
