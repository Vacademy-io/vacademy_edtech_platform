import { useEffect, useMemo, useState } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    ChalkboardTeacher,
    ChartBar,
    ClipboardText,
    Pulse,
    type Icon,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { getModuleFlags } from '@/components/common/layout-container/sidebar/helper';
import { HOLISTIC_INSTITUTE_ID } from '@/constants/urls';
import { useEntitlement } from '@/lib/capabilities/use-entitlement';
import {
    getActiveRoleDisplaySettingsKey,
    getRolesForCurrentInstitute,
} from '@/lib/auth/instituteUtils';
import { getDisplaySettings, getDisplaySettingsFromCache } from '@/services/display-settings';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type { DashboardWidgetId, DisplaySettingsData } from '@/types/display-settings';
import { useDashboardUpcomingSessions } from '@/routes/dashboard/-hooks/useDashboardSources';
import MentorshipStatsWidget from '@/routes/dashboard/-components/MentorshipStatsWidget';
import DailyActivityTrendWidget from '@/routes/dashboard/-components/analytics-widgets/DailyActivityTrendWidget';
import { UnresolvedDoubtsWidget } from '@/routes/dashboard/-components/UnresolvedDoubtsWidget';
import { CrmLink } from '@/routes/dashboard/-components/crm/crm-cards';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import {
    AdminWidgets,
    KeyNumbers,
    LmsConnectionNotice,
    PendingWork,
} from '@/routes/dashboard/-components/crm/BusinessWidgets';

export const Route = createLazyFileRoute('/lms-dashboard/')({
    component: LmsDashboardPage,
});

/**
 * LMS Dashboard — the cards that used to sit on the home page (upcoming live
 * sessions as a count on the Live class dashboard card, unresolved doubts, mentorship, learner activity, and for admins the institute &
 * business widgets) for people whose home is the CRM Dashboard. Each card keeps its own visibility switch under
 * Settings → Role Display → Dashboard widgets and the same plan checks as before.
 */
function LmsDashboardPage() {
    const { t } = useTranslation('crmDashboard');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="font-medium">{t('lms.title')}</h1>);
    }, [setNavHeading, t]);

    const { data: institute } = useSuspenseQuery(useInstituteQuery());
    const instituteId = institute?.id || '';
    const subModules = getModuleFlags(institute?.sub_modules);
    const { showForInstitutes } = useInstituteDetailsStore();
    const entitlement = useEntitlement();
    const isAdmin = useMemo(
        () => getRolesForCurrentInstitute().includes('ADMIN'),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read on institute switch
        [instituteId]
    );

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
    const visible = (id: DashboardWidgetId) =>
        entitlement.isWidgetEntitled(id) &&
        roleDisplay?.dashboard.widgets.find((w) => w.id === id)?.visible !== false;

    // Upcoming live sessions as a count on the Live class dashboard card (the full list
    // lives on that dashboard). Same query as the KPI band, so it is fetched once.
    const { t: tLive } = useTranslation('dashboardLiveClassesWidget');
    const showLiveCount = visible('liveClasses');
    const { data: upcoming } = useDashboardUpcomingSessions(instituteId, showLiveCount);
    const upcomingCount = upcoming?.reduce((n, day) => n + day.sessions.length, 0);
    const liveCaption =
        !showLiveCount || upcomingCount === undefined
            ? undefined
            : upcomingCount > 0
              ? tLive('header.upcomingSessionsCount', { count: upcomingCount })
              : tLive('header.noUpcomingSessions');

    const links: Array<[string, Icon, string]> = [
        ['pulse', Pulse, '/institute-pulse'],
        ['liveDashboard', ChalkboardTeacher, '/study-library/live-session/dashboard'],
        ['reports', ChartBar, '/study-library/reports'],
        ['assessments', ClipboardText, '/assessment/assessment-list'],
    ];

    return (
        <LayoutContainer>
            <div className="flex flex-col gap-5">
                <div>
                    <h1 className="font-semibold text-neutral-900">
                        <span className="text-h2">{t('lms.title')}</span>
                    </h1>
                    <p className="text-neutral-500">
                        <span className="text-body">
                            {t('lms.subtitle', {
                                learners: instituteTerms().learners.toLowerCase(),
                            })}
                        </span>
                    </p>
                </div>
                {/* Key numbers first: active learners, courses, team, fees, live sessions. */}
                <KeyNumbers />
                <LmsConnectionNotice />
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {links.map(([key, I, href]) => (
                        <CrmLink
                            key={key}
                            href={href}
                            className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:border-primary-300 hover:shadow-md"
                        >
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                                <I size={18} weight="duotone" />
                            </span>
                            <span className="min-w-0">
                                <span className="block font-medium text-neutral-800">
                                    <span className="text-body">{t(`lms.links.${key}`)}</span>
                                </span>
                                {key === 'liveDashboard' && liveCaption && (
                                    <span className="block truncate text-neutral-500">
                                        <span className="text-caption">{liveCaption}</span>
                                    </span>
                                )}
                            </span>
                        </CrmLink>
                    ))}
                </div>
                <PendingWork />
                <div className="grid gap-4 lg:grid-cols-2">
                    {(subModules.lms || subModules.assess) &&
                        !showForInstitutes([HOLISTIC_INSTITUTE_ID]) &&
                        visible('unresolvedDoubts') && (
                            <UnresolvedDoubtsWidget instituteId={instituteId} />
                        )}
                    {isAdmin && visible('mentorshipStats') && <MentorshipStatsWidget />}
                </div>
                {visible('dailyActivityTrend') && (
                    <DailyActivityTrendWidget instituteId={instituteId} />
                )}
                {/* Admins: money, notifications and the partner network, under the same
                    Dashboard widgets switches as on the old home page. */}
                <AdminWidgets />
            </div>
        </LayoutContainer>
    );
}
