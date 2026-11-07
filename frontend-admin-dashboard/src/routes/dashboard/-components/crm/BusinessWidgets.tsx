import { useEffect, useMemo, useState } from 'react';
import {
    getActiveRoleDisplaySettingsKey,
    getCurrentInstituteId,
    getRolesForCurrentInstitute,
} from '@/lib/auth/instituteUtils';
import { useEntitlement } from '@/lib/capabilities/use-entitlement';
import { getDisplaySettings, getDisplaySettingsFromCache } from '@/services/display-settings';
import type { DashboardWidgetId, DisplaySettingsData } from '@/types/display-settings';
import { getUserId } from '@/utils/userDetails';
import { bundleForRoles } from '../../-config/dashboard-role-bundles';
import TrackedWidget from '../TrackedWidget';
import SuperAdminWidgetsRegion from '../SuperAdminWidgetsRegion';
import { LmsConnectionHealthWidget } from '../LmsConnectionHealthWidget';
import MyPendingActionsWidget from '../MyPendingActionsWidget';
import KpiBand from '../KpiBand';
import RecentTransactionsWidget from '../RecentTransactionsWidget';
import RevenueTrendsWidget from '../RevenueTrendsWidget';
import SubOrgOverviewWidget from '../SubOrgOverviewWidget';
import SubOrgGeographyWidget from '../SubOrgGeographyWidget';
import VLEInsightsWidget from '../VLEInsightsWidget';
import TopVlesWidget from '../TopVlesWidget';
import RecentNotificationsWidget from '../RecentNotificationsWidget';

/**
 * The role's Settings → Role Display → Dashboard widgets switches and the institute
 * plan, read the same way the existing dashboard reads them (`isWidgetVisible`: on
 * unless switched off; `explicit`: off unless switched on).
 */
export function useDashboardWidgetVisibility() {
    const entitlement = useEntitlement();
    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(() =>
        getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey())
    );
    useEffect(() => {
        if (roleDisplay) return;
        getDisplaySettings(getActiveRoleDisplaySettingsKey())
            .then(setRoleDisplay)
            .catch(() => setRoleDisplay(null));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const saved = (id: DashboardWidgetId) =>
        roleDisplay?.dashboard.widgets.find((w) => w.id === id)?.visible;
    return {
        visible: (id: DashboardWidgetId) => entitlement.isWidgetEntitled(id) && saved(id) !== false,
        explicit: (id: DashboardWidgetId) => entitlement.isWidgetEntitled(id) && saved(id) === true,
    };
}

/** Platform-managed cards (onboarding tracker / info cards): they top every home page. */
export function PlatformNotices() {
    return (
        <TrackedWidget widgetId="superAdminWidgets">
            <SuperAdminWidgetsRegion />
        </TrackedWidget>
    );
}

/** The LMS connection alert (opt-in): a broken LMS link silently breaks enrolment. */
export function LmsConnectionNotice() {
    const { explicit } = useDashboardWidgetVisibility();
    if (!explicit('lmsConnectionHealth')) return null;
    return (
        <TrackedWidget widgetId="lmsConnectionHealth">
            <LmsConnectionHealthWidget instituteId={getCurrentInstituteId() || ''} />
        </TrackedWidget>
    );
}

/** Admin of the current institute, and the role bundle that shapes the old home page. */
function useAdminContext() {
    const instituteId = getCurrentInstituteId() || '';
    const roles = useMemo(
        () => getRolesForCurrentInstitute(),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read on institute switch
        [instituteId]
    );
    const bundle = useMemo(() => bundleForRoles(roles), [roles]);
    return { instituteId, roles, bundle, isAdmin: roles.includes('ADMIN') };
}

/**
 * The key-number cards of the old home page (active learners, courses, team, fees,
 * live sessions today) — first on the LMS Dashboard. Same component and the same
 * Dashboard widgets switch (kpiBand) as before.
 */
export function KeyNumbers() {
    const { visible } = useDashboardWidgetVisibility();
    const { instituteId, roles, bundle } = useAdminContext();
    if (!bundle.showKpiBand || !visible('kpiBand')) return null;
    return (
        <TrackedWidget widgetId="kpiBand">
            <KpiBand instituteId={instituteId} roles={roles} />
        </TrackedWidget>
    );
}

/** Work waiting on this person (role-shaped), under the pendingActions switch. */
export function PendingWork() {
    const { visible } = useDashboardWidgetVisibility();
    const { instituteId, isAdmin } = useAdminContext();
    if (!visible('pendingActions')) return null;
    return (
        <TrackedWidget widgetId="pendingActions">
            <MyPendingActionsWidget
                instituteId={instituteId}
                userId={getUserId() || ''}
                isAdmin={isAdmin}
            />
        </TrackedWidget>
    );
}

/**
 * Admins: money (recent transactions, amount collected), notifications and the
 * institute's own partner network (sub-org widgets, named by the institute's own
 * terminology inside each widget). Each widget keeps its Dashboard widgets switch
 * and hides itself when it has nothing to show (e.g. no sub-orgs).
 */
export function AdminWidgets() {
    const { visible } = useDashboardWidgetVisibility();
    const { instituteId, isAdmin } = useAdminContext();
    if (!isAdmin) return null;
    return (
        <>
            <div className="grid gap-4 lg:grid-cols-2">
                {visible('recentTransactions') && (
                    <TrackedWidget widgetId="recentTransactions">
                        <RecentTransactionsWidget instituteId={instituteId} />
                    </TrackedWidget>
                )}
                {visible('recentNotifications') && (
                    <TrackedWidget widgetId="recentNotifications">
                        <RecentNotificationsWidget />
                    </TrackedWidget>
                )}
            </div>
            {visible('revenueTrends') && (
                <TrackedWidget widgetId="revenueTrends">
                    <RevenueTrendsWidget />
                </TrackedWidget>
            )}
            {visible('subOrgOverview') && (
                <TrackedWidget widgetId="subOrgOverview">
                    <SubOrgOverviewWidget />
                </TrackedWidget>
            )}
            {visible('subOrgGeography') && (
                <TrackedWidget widgetId="subOrgGeography">
                    <SubOrgGeographyWidget />
                </TrackedWidget>
            )}
            {visible('vleAnalytics') && (
                <TrackedWidget widgetId="vleAnalytics">
                    <VLEInsightsWidget />
                </TrackedWidget>
            )}
            {visible('topVles') && (
                <TrackedWidget widgetId="topVles">
                    <TopVlesWidget />
                </TrackedWidget>
            )}
        </>
    );
}
