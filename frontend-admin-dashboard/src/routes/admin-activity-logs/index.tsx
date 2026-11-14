import { createFileRoute, redirect } from '@tanstack/react-router';
import {
    getActiveRoleDisplaySettingsKey,
    getRolesForCurrentInstitute,
} from '@/lib/auth/instituteUtils';
import { getDisplaySettingsFromCache } from '@/services/display-settings';

/**
 * The three list filters are multi-select but travel as ONE comma-separated
 * value each (`?actorId=a,b`). Keeping them as scalars means every link that
 * was already shared with a single value still resolves, and it sidesteps the
 * ingress rejecting bracketed `actorId[]=` array params with a 400.
 */
export interface AdminActivityLogsSearchParams {
    page?: number;
    size?: number;
    entityType?: string;
    action?: string;
    actorId?: string;
    startDate?: number;
    endDate?: number;
}

export const Route = createFileRoute('/admin-activity-logs/')({
    // Audit logs are an opt-in feature per institute. The sidebar already hides
    // the link when the toggle is off, but direct URL navigation needs to
    // respect the same setting — otherwise institutes that explicitly disabled
    // it could still expose the page to anyone who knew the URL.
    beforeLoad: () => {
        // ADMIN only, judged as the sidebar judges it (filterSidebarByRole — roles in the
        // CURRENT institute) so the page never refuses an admin the sidebar shows the link
        // to. Redirects only when the roles are known: with no readable token there are
        // none, and an admin must not be bounced for that. The audit API checks ADMIN
        // regardless.
        const roles = getRolesForCurrentInstitute();
        if (roles.length > 0 && !roles.some((role) => role.toUpperCase() === 'ADMIN')) {
            throw redirect({ to: '/dashboard' });
        }
        const settings = getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey());
        const tab = settings?.sidebar?.find((t) => t.id === 'admin-activity-logs');
        if (tab && tab.visible === false) {
            throw redirect({ to: '/dashboard' });
        }
    },
    validateSearch: (search): AdminActivityLogsSearchParams => ({
        page: search.page as number | undefined,
        size: search.size as number | undefined,
        entityType: search.entityType as string | undefined,
        action: search.action as string | undefined,
        actorId: search.actorId as string | undefined,
        startDate: search.startDate as number | undefined,
        endDate: search.endDate as number | undefined,
    }),
});
