import { createFileRoute, redirect } from '@tanstack/react-router';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getDisplaySettingsFromCache } from '@/services/display-settings';

/**
 * Filters travel as comma-separated scalars rather than repeated params: the ingress
 * rejects bracketed `categories[]=` array syntax with a 400 before the request reaches
 * the service.
 */
export interface LiveActivitySearchParams {
    category?: string;
    counsellorUserId?: string;
    from?: number;
    to?: number;
    needsAttention?: boolean;
}

export const Route = createFileRoute('/live-activity/')({
    // Opt-in per institute AND per role. The sidebar already hides the link when the
    // toggle is off, but direct URL navigation has to honour the same setting or an
    // institute that deliberately disabled it still exposes the page to anyone with
    // the URL.
    beforeLoad: () => {
        const settings = getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey());
        const tab = settings?.sidebar?.find((t) => t.id === 'live-activity');
        if (tab && tab.visible === false) {
            throw redirect({ to: '/dashboard' });
        }
    },
    validateSearch: (search): LiveActivitySearchParams => ({
        category: search.category as string | undefined,
        counsellorUserId: search.counsellorUserId as string | undefined,
        from: search.from as number | undefined,
        to: search.to as number | undefined,
        needsAttention: search.needsAttention as boolean | undefined,
    }),
});
