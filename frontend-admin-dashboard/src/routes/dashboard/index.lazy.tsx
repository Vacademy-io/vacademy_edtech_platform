import {
    getActiveRoleDisplaySettingsKey,
    getRolesForCurrentInstitute,
} from '@/lib/auth/instituteUtils';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect, useState, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import {
    ArrowSquareOut,
    Sparkle,
    FilePdf,
    LightbulbFilament,
    Lightning,
    BookOpen,
    Eye,
    X,
} from '@phosphor-icons/react';
import { CompletionStatusComponent } from './-components/CompletionStatusComponent';
import { IntroKey } from '@/constants/storage/introKey';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useInstituteDashboardCounts } from './-hooks/useDashboardSources';
import { resolveDashboardRoleLabel } from './-utils/role-label';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { HOLISTIC_INSTITUTE_ID, SSDC_INSTITUTE_ID } from '@/constants/urls';
import { amplitudeEvents, trackPageView, trackEvent } from '@/lib/amplitude';
import { Helmet } from 'react-helmet';
import { getModuleFlags } from '@/components/common/layout-container/sidebar/helper';
import useLocalStorage from '@/hooks/use-local-storage';
import EditDashboardProfileComponent from './-components/EditDashboardProfileComponent';
import { handleGetAdminDetails } from '@/services/student-list-section/getAdminDetails';
import { motion } from 'framer-motion';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { UnresolvedDoubtsWidget } from './-components/UnresolvedDoubtsWidget';
import LiveClassesWidget from './-components/LiveClassesWidget';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '../settings/-components/NamingSettings';

import { Badge } from '@/components/ui/badge';
import RecentNotificationsWidget from './-components/RecentNotificationsWidget';
import {
    Dialog as BaseDialog,
    DialogContent as BaseDialogContent,
    DialogTitle as BaseDialogTitle,
} from '@/components/ui/dialog';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getUserId } from '@/utils/userDetails';
import { fetchSystemAlerts } from '@/services/notifications/system-alerts';
import { ClearAllAlertsButton } from '@/components/common/notifications/ClearAllAlertsButton';
import { DismissAlertButton } from '@/components/common/notifications/DismissAlertButton';
import SuperAdminWidgetsRegion from './-components/SuperAdminWidgetsRegion';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { type DisplaySettingsData, type DashboardWidgetId } from '@/types/display-settings';
import { getDisplaySettings, getDisplaySettingsFromCache } from '@/services/display-settings';
import { getCustomFieldSettings } from '@/services/custom-field-settings';

// Analytics Widgets
// import RealTimeActiveUsersWidget from './-components/analytics-widgets/RealTimeActiveUsersWidget';
// import CurrentlyActiveUsersWidget from './-components/analytics-widgets/CurrentlyActiveUsersWidget';
import DailyActivityTrendWidget from './-components/analytics-widgets/DailyActivityTrendWidget';

// Dashboard Widgets
import MyPendingActionsWidget from './-components/MyPendingActionsWidget';
import QuickActionsStrip from './-components/QuickActionsStrip';
import { AssistantLaunchBar } from '@/components/vacademy-assistant/AssistantLaunchBar';
import KpiBand from './-components/KpiBand';
import FinanceSummaryWidget from './-components/FinanceSummaryWidget';
import SubOrgOverviewWidget from './-components/SubOrgOverviewWidget';
import MentorshipStatsWidget from './-components/MentorshipStatsWidget';
import SubOrgSelfStatsWidget from './-components/SubOrgSelfStatsWidget';
import SubOrgGeographyWidget from './-components/SubOrgGeographyWidget';
import RevenueTrendsWidget from './-components/RevenueTrendsWidget';
import VLEInsightsWidget from './-components/VLEInsightsWidget';
import TopVlesWidget from './-components/TopVlesWidget';
import SubOrgSeatCoursesWidget from './-components/SubOrgSeatCoursesWidget';
import SubOrgActivityDuesWidget from './-components/SubOrgActivityDuesWidget';
import {
    isCallerSubOrgAdmin,
    getValidSelectedSubOrgId,
    getFacultyAccessData,
} from '@/lib/auth/facultyAccessUtils';
import RecentTransactionsWidget from './-components/RecentTransactionsWidget';
import FreshInstituteEmptyState from './-components/FreshInstituteEmptyState';
import TrackedWidget from './-components/TrackedWidget';
import { LmsConnectionHealthWidget } from './-components/LmsConnectionHealthWidget';
import { bundleForRoles } from './-config/dashboard-role-bundles';
import RoleTypeComponent from './-components/RoleTypeComponent';
import { LearnerTab } from './-components/LearnerTab';
import { SettingsTabs } from '../settings/-constants/terms';
import { useEntitlement } from '@/lib/capabilities/use-entitlement';
import { hasEntitledSetupStep, welcomeTextKey } from './-config/dashboard-entitlements';
import { DashboardSwitch } from './-components/crm/DashboardSwitch';

// Define the lazy Route
export const Route = createLazyFileRoute('/dashboard/')({
    component: DashboardPage,
});

function DashboardPage() {
    const { t } = useTranslation('dashboardIndex');
    const navigate = useNavigate();
    const location = useLocation();
    const [isVoltSubdomain, setIsVoltSubdomain] = useState(false);
    const [showLearnerTab, setShowLearnerTab] = useState(false);
    const [showAllAlerts, setShowAllAlerts] = useState(false);
    const userId = getUserId();
    // Only feeds the "all alerts" dialog, so it waits until that dialog opens. Unread counts
    // (navbar bell, Pending Actions) come from the 5-item preview query, not this one.
    const infiniteAlerts = useInfiniteQuery({
        queryKey: ['SYSTEM_ALERTS_INFINITE', userId, 20] as const,
        queryFn: ({ pageParam = 0 }) =>
            fetchSystemAlerts({ userId, page: Number(pageParam) || 0, size: 20 }),
        getNextPageParam: (lastPage) => (lastPage.last ? undefined : lastPage.number + 1),
        initialPageParam: 0,
        staleTime: 30_000,
        enabled: showAllAlerts,
    });

    // Check if learner tab should be shown
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const shouldShowLearnerTab = urlParams.get('showLearnerTab') === 'true';
        setShowLearnerTab(shouldShowLearnerTab);
    }, [location.search]);

    useEffect(() => {
        const subdomain =
            typeof window !== 'undefined' ? window.location.hostname.split('.')[0] : '';
        const isVolt = subdomain === 'volt';
        setIsVoltSubdomain(isVolt);

        if (!isVolt) return;

        const timer = setTimeout(() => {
            navigate({ to: '/study-library/volt' });
        }, 2500);

        return () => clearTimeout(timer);
    }, [navigate]);

    if (isVoltSubdomain) {
        return (
            <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-900 text-white">
                <motion.div
                    initial={{ opacity: 0, y: -40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="text-center"
                >
                    <Lightning size={80} className="mx-auto text-orange-400" weight="fill" />
                    <h1 className="mt-6 text-5xl font-bold tracking-tight text-white">
                        {t('volt.title')}
                    </h1>
                    <p className="mt-2 text-lg text-slate-300">{t('volt.subtitle')}</p>
                </motion.div>
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1, duration: 0.5 }}
                    className="absolute bottom-10 text-sm text-slate-400"
                >
                    {t('volt.redirecting')}
                </motion.p>
            </div>
        );
    }

    return (
        <LayoutContainer>
            <DashboardSwitch
                legacy={<DashboardComponent onOpenAllAlerts={() => setShowAllAlerts(true)} />}
            />
            <BaseDialog open={showAllAlerts} onOpenChange={setShowAllAlerts}>
                <BaseDialogContent className="max-w-lg p-0">
                    <div className="flex items-center justify-between gap-2 px-4 py-3">
                        <BaseDialogTitle className="text-base">
                            {t('alertsDialog.title')}
                        </BaseDialogTitle>
                        <ClearAllAlertsButton
                            userId={userId}
                            hasAlerts={
                                !!infiniteAlerts.data?.pages?.flatMap((p) => p.content).length
                            }
                            className="!min-w-0 !px-1"
                            onCleared={() => setShowAllAlerts(false)}
                        />
                    </div>
                    <Separator />
                    <ScrollArea className="max-h-[70vh]"> {/* design-lint-ignore: viewport-relative popover scroll area, no dialog token fits (not a DialogContent) */}
                        <div className="p-3">
                            {infiniteAlerts.data?.pages?.flatMap((p) => p.content).length ? (
                                <div className="space-y-3">
                                    {infiniteAlerts.data?.pages?.map((page) =>
                                        page.content.map((item) => (
                                            <div
                                                key={item.messageId}
                                                className="rounded-md border border-neutral-200 bg-white p-3"
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="text-sm font-semibold text-neutral-800">
                                                        {item.title}
                                                    </div>
                                                    <DismissAlertButton
                                                        userId={userId}
                                                        messageId={item.messageId}
                                                    />
                                                </div>
                                                <div className="mt-1 text-body text-neutral-700">
                                                    {item.content?.type === 'html' ? (
                                                        <div
                                                            className="prose prose-sm max-w-none"
                                                            dangerouslySetInnerHTML={{
                                                                __html: item.content?.content,
                                                            }}
                                                        />
                                                    ) : (
                                                        <span>{item.content?.content}</span>
                                                    )}
                                                </div>
                                                <div className="mt-2 text-2xs text-neutral-500">
                                                    {new Date(item.createdAt).toLocaleString()}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                    {infiniteAlerts.hasNextPage && (
                                        <div className="flex justify-center pt-2">
                                            <button
                                                disabled={infiniteAlerts.isFetchingNextPage}
                                                className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                onClick={() => infiniteAlerts.fetchNextPage()}
                                            >
                                                {infiniteAlerts.isFetchingNextPage
                                                    ? t('alertsDialog.loading')
                                                    : t('alertsDialog.loadMore')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ) : infiniteAlerts.isLoading ? (
                                <div className="space-y-2">
                                    {[...Array(6)].map((_, i) => (
                                        <div key={i} className="space-y-1">
                                            <Skeleton className="h-3 w-1/2" />
                                            <Skeleton className="h-3 w-5/6" />
                                            <Skeleton className="h-3 w-2/3" />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="py-8 text-center text-xs text-neutral-500">
                                    {t('alertsDialog.empty')}
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </BaseDialogContent>
            </BaseDialog>
        </LayoutContainer>
    );
}

// My Courses Widget Component for Non-Admin Users
function MyCoursesWidget() {
    const { t } = useTranslation('dashboardIndex');
    const navigate = useNavigate();
    const [courseCounts, setCourseCounts] = useState({
        authored: 0,
        inReview: 0,
        loading: true,
        error: false,
    });

    // Import the getMyCourses function
    const { getMyCourses } = useMemo(() => {
        return {
            getMyCourses: async () => {
                try {
                    const { getMyCourses } = await import(
                        '../study-library/courses/-services/approval-services'
                    );
                    return await getMyCourses();
                } catch (error) {
                    console.error('Failed to fetch courses:', error);
                    throw error;
                }
            },
        };
    }, []);

    // Fetch course data on component mount
    useEffect(() => {
        const fetchCourseData = async () => {
            try {
                setCourseCounts((prev) => ({ ...prev, loading: true, error: false }));
                const response = await getMyCourses();

                // Handle V2 paginated response - use totalElements for counts
                if (response && response.content) {
                    const courses = response.content;
                    const totalAuthored = response.totalElements || courses.length;
                    const inReview = courses.filter(
                        (course: any) => course.courseStatus === 'IN_REVIEW'
                    ).length;

                    setCourseCounts({
                        authored: totalAuthored,
                        inReview: inReview,
                        loading: false,
                        error: false,
                    });
                } else {
                    // Handle case where response might be null or undefined
                    setCourseCounts({
                        authored: 0,
                        inReview: 0,
                        loading: false,
                        error: false,
                    });
                }
            } catch (error) {
                console.error('Error fetching course data:', error);
                setCourseCounts((prev) => ({
                    ...prev,
                    loading: false,
                    error: true,
                }));
            }
        };

        fetchCourseData();
    }, [getMyCourses]);

    const handleViewAllCourses = () => {
        navigate({ to: '/study-library/courses' });
    };

    const handleViewInReview = () => {
        navigate({ to: '/study-library/courses' });
    };

    return (
        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-none">
            <CardHeader className="p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <BookOpen size={20} className="text-blue-600" weight="duotone" />
                        <CardTitle className="text-sm font-semibold text-blue-900">
                            {t('myCourses.title')}
                        </CardTitle>
                    </div>
                    <MyButton
                        buttonType="secondary"
                        onClick={handleViewAllCourses}
                        className="text-xs"
                        disabled={courseCounts.loading}
                    >
                        <Eye size={14} className="mr-1" />
                        {t('myCourses.viewAll')}
                    </MyButton>
                </div>
                <CardDescription className="text-xs text-blue-700">
                    {t('myCourses.description')}
                </CardDescription>
            </CardHeader>
            <div className="px-4 pb-4">
                <div className="grid grid-cols-2 gap-3">
                    <div
                        className="cursor-pointer rounded-lg bg-white/70 p-3 shadow-sm transition-colors hover:bg-white/90"
                        onClick={handleViewAllCourses}
                    >
                        <div className="text-lg font-semibold text-blue-600">
                            {courseCounts.loading ? (
                                <div className="h-6 w-8 animate-pulse rounded bg-blue-200"></div>
                            ) : courseCounts.error ? (
                                '?'
                            ) : (
                                courseCounts.authored
                            )}
                        </div>
                        <div className="text-xs text-blue-700">{t('myCourses.authored')}</div>
                    </div>
                    <div
                        className="cursor-pointer rounded-lg bg-white/70 p-3 shadow-sm transition-colors hover:bg-white/90"
                        onClick={handleViewInReview}
                    >
                        <div className="text-lg font-semibold text-orange-600">
                            {courseCounts.loading ? (
                                <div className="h-6 w-8 animate-pulse rounded bg-orange-200"></div>
                            ) : courseCounts.error ? (
                                '?'
                            ) : (
                                courseCounts.inReview
                            )}
                        </div>
                        <div className="text-xs text-orange-700">{t('myCourses.inReview')}</div>
                    </div>
                </div>
                {courseCounts.error && (
                    <div className="mt-2 text-center">
                        <p className="text-xs text-red-600">{t('myCourses.loadError')}</p>
                    </div>
                )}
            </div>
        </Card>
    );
}

// Known backend role enums -> terminology-aware display labels. Anything not
// in this map (custom roles) is title-cased by resolveDashboardRoleLabel
// ("COUNSELLOR" -> "Counsellor") rather than shown as a raw enum.
const ROLE_DISPLAY_LABEL: Record<string, () => string> = {
    ADMIN: () => getTerminology(RoleTerms.Admin, SystemTerms.Admin),
    TEACHER: () => getTerminology(RoleTerms.Teacher, SystemTerms.Teacher),
    'CONTENT CREATOR': () => getTerminology(RoleTerms.CourseCreator, SystemTerms.CourseCreator),
    'ASSESSMENT CREATOR': () =>
        getTerminology(RoleTerms.AssessmentCreator, SystemTerms.AssessmentCreator),
    EVALUATOR: () => getTerminology(RoleTerms.Evaluator, SystemTerms.Evaluator),
};

export function DashboardComponent({ onOpenAllAlerts }: { onOpenAllAlerts?: () => void }) {
    const { t, i18n } = useTranslation('dashboardIndex');
    const location = useLocation();
    const { getValue, setValue } = useLocalStorage<boolean>(IntroKey.dashboardWelcomeVideo, true);
    const profileCardDismissed = useLocalStorage<boolean>('dashboardProfileCardDismissed', false);
    const namingCardDismissed = useLocalStorage<boolean>('dashboardNamingCardDismissed', false);
    const aiCardDismissed = useLocalStorage<boolean>('dashboardAiCardDismissed', false);
    const { data: instituteDetails, isLoading: isInstituteLoading } =
        useSuspenseQuery(useInstituteQuery());
    const { data: adminDetails } = useSuspenseQuery(handleGetAdminDetails());
    const { showForInstitutes } = useInstituteDetailsStore();
    const subModules = getModuleFlags(instituteDetails?.sub_modules);
    const router = useRouter();

    // Role detection — roles in the CURRENT institute only. The token carries every
    // institute's roles; flattening them gave an ADMIN of institute A the admin dashboard
    // (and fee widgets) while working in institute B as a teacher or counsellor.
    const userRoles = useMemo(
        () => getRolesForCurrentInstitute(),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read on institute switch
        [instituteDetails?.id]
    );
    const isAdmin = userRoles.includes('ADMIN');
    // Sub-org admins also hold ADMIN on the parent institute, so the ADMIN role
    // alone can't distinguish them — the FSPSSM-derived faculty-access data is the
    // canonical fingerprint. Drives which sub-org card they see (own scope vs network).
    const isSubOrgAdmin = isCallerSubOrgAdmin();
    // The sub-org this admin belongs to — prefer the validated selected id, else
    // fall back to their first faculty-access sub-org (the selected id is cleared
    // on login, so it's often null for a freshly-logged-in sub-org admin).
    const callerSubOrgId =
        getValidSelectedSubOrgId() ?? getFacultyAccessData()?.subOrgs?.[0]?.subOrgId ?? null;

    // Non-blocking: each widget that depends on `data` handles its own
    // loading/empty state. Previously this was `useSuspenseQuery`, which
    // blocked the whole page on this single network call. Shared with the KPI band.
    const { data, isSuccess: isCountsLoaded } = useInstituteDashboardCounts(instituteDetails?.id);

    const roleBundle = useMemo(() => bundleForRoles(userRoles), [userRoles]);
    // Institute plan (MANAGED only — FULL_ENTITLEMENT, i.e. no filtering, otherwise).
    const entitlement = useEntitlement();
    // Only a SUCCESSFUL load with all-zero counts is a fresh institute. While loading (counts
    // still undefined) or after an error it is not — otherwise every admin saw the empty-state
    // flash and lost the KPI/finance rows whenever get-dashboard was slow or failed.
    // A plan with no LMS setup step (CRM-only) is never "fresh": it gets the normal
    // dashboard rather than an LMS checklist with the KPI/finance rows hidden.
    const isFreshTenant =
        isAdmin &&
        hasEntitledSetupStep(entitlement) &&
        isCountsLoaded &&
        !!data &&
        (data.student_count || 0) === 0 &&
        (data.batch_count || 0) === 0 &&
        (data.course_count || 0) === 0 &&
        (data.level_count || 0) === 0;
    const roleLabel = resolveDashboardRoleLabel(userRoles, ROLE_DISPLAY_LABEL);

    const [roleTypeCount, setRoleTypeCount] = useState({
        ADMIN: 0,
        'CONTENT CREATOR': 0,
        'ASSESSMENT CREATOR': 0,
        EVALUATOR: 0,
        TEACHER: 0,
    });
    const navigate = useNavigate();
    const { setNavHeading } = useNavHeadingStore();

    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(null);
    useEffect(() => {
        const roleKey = getActiveRoleDisplaySettingsKey();
        const cached = getDisplaySettingsFromCache(roleKey);
        if (cached) {
            setRoleDisplay(cached);
        } else {
            getDisplaySettings(roleKey)
                .then(setRoleDisplay)
                .catch(() => setRoleDisplay(null));
        }
    }, []);

    const isWidgetVisible = (id: DashboardWidgetId): boolean => {
        if (!entitlement.isWidgetEntitled(id)) return false; // outside the plan (MANAGED)
        const vis = roleDisplay?.dashboard.widgets.find((w) => w.id === id)?.visible;
        return vis !== false; // default to true
    };

    /**
     * Strict variant of isWidgetVisible: hidden unless settings EXPLICITLY say visible.
     *
     * isWidgetVisible fails open (`vis !== false`), which is right for widgets that have always
     * shipped on — a settings-load failure shouldn't blank the dashboard. But an opt-in widget
     * must not switch itself on that way, and this one starts polling the customer's LMS the
     * moment it renders.
     */
    const isWidgetExplicitlyVisible = (id: DashboardWidgetId): boolean =>
        entitlement.isWidgetEntitled(id) &&
        roleDisplay?.dashboard.widgets.find((w) => w.id === id)?.visible === true;

    const orderOf = (id: DashboardWidgetId): number => {
        return roleDisplay?.dashboard.widgets.find((w) => w.id === id)?.order ?? 0;
    };

    const handleAICenterNavigation = () => {
        // Track AI Center access
        amplitudeEvents.useFeature('ai_center', { source: 'dashboard' });
        trackEvent('AI Center Accessed', {
            source: 'dashboard_navigation',
            timestamp: new Date().toISOString(),
        });

        router.navigate({
            to: '/ai-center',
        });
    };

    useEffect(() => {
        // Slightly more compact nav heading
        setNavHeading(<h1 className="font-medium">{t('page.title')}</h1>);

        // Track dashboard page view
        trackPageView('Dashboard', {
            user_role: adminDetails?.roles?.join(',') || 'unknown',
            institute_id: instituteDetails?.id,
            timestamp: new Date().toISOString(),
        });

        amplitudeEvents.navigateToPage('dashboard');
    }, [setNavHeading, adminDetails?.roles, instituteDetails?.id, t]);

    useEffect(() => {
        if (location.pathname !== '/dashboard') {
            setValue(false);
        }
    }, [location.pathname, setValue]);

    // Warm custom-field-settings cache on dashboard mount (cache-respecting).
    // The service handles TTL internally; passing forceRefresh=true on every
    // dashboard load defeats the cache and silently fails for any user without
    // permission to read institute settings.
    useEffect(() => {
        getCustomFieldSettings().catch(() => {
            // Silently fail - don't block dashboard rendering
        });
    }, []);

    // Only block on the auth-identity query. Per-widget loading is handled
    // inside each widget so the page shell renders immediately.
    if (isInstituteLoading) return <DashboardLoader />;

    return (
        <>
            <Helmet>
                <title>{t('page.title')}</title>
                <meta name="description" content={t('page.metaDescription')} />
            </Helmet>
            <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
                <div className="flex flex-col gap-0.5">
                    <h1 className="text-xl font-semibold sm:text-2xl">
                        {(() => {
                            const hour = new Date().getHours();
                            const greetingKey =
                                hour < 12
                                    ? 'greeting.morning'
                                    : hour < 17
                                      ? 'greeting.afternoon'
                                      : 'greeting.evening';
                            const firstName =
                                adminDetails?.full_name?.split(' ')?.[0] || adminDetails?.full_name;
                            return (
                                <Trans
                                    t={t}
                                    i18nKey={greetingKey}
                                    values={{ name: firstName }}
                                    components={{
                                        strong: <span className="text-primary-500" />,
                                    }}
                                />
                            );
                        })()}
                    </h1>
                    <p className="text-xs text-neutral-600 sm:text-sm">
                        {isAdmin
                            ? t('subtitle.admin', {
                                  instituteName:
                                      instituteDetails?.institute_name ||
                                      t('subtitle.adminFallbackInstitute'),
                              })
                            : t('subtitle.nonAdmin')}
                    </p>
                </div>
                <span className="hidden text-2xs text-neutral-400 sm:inline-block sm:text-xs">
                    {roleLabel ?? t('header.roleFallback')} ·{' '}
                    {new Date().toLocaleDateString(i18n.resolvedLanguage || i18n.language, {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                    })}
                </span>
            </div>
            {isWidgetVisible('assistantLaunchBar') && <AssistantLaunchBar />}
            {/* Familiar shortcuts remain one click away below the assistant. */}
            {roleBundle.showQuickActions && isWidgetVisible('quickActions') && (
                <TrackedWidget widgetId="quickActions">
                    <div className="mt-4">
                        <QuickActionsStrip roles={userRoles} />
                    </div>
                </TrackedWidget>
            )}
            {getValue() && (
                <>
                    <p className="mt-0.5 text-2xs text-neutral-600 sm:text-xs">
                        {t(welcomeTextKey(entitlement))}
                    </p>
                    {/* {!showForInstitutes([HOLISTIC_INSTITUTE_ID, SSDC_INSTITUTE_ID]) && (
                        <iframe
                            className="m-auto mt-4 h-[35vh] w-full rounded-lg md:h-[60vh] md:w-[65%]" // design-lint-ignore: dead code (commented out), viewport-relative video sizing
                            src="https://www.youtube.com/embed/s2z1xbCWwRE?si=cgJvdMCJ8xg32lZ7"
                            title="YouTube video player"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                        />
                    )} */}
                </>
            )}
            {/* Main content */}
            <div className="mt-5 flex w-full flex-col gap-4">
                {/* LMS connection health — first, and full-bleed. A broken LMS connection
                    silently breaks enrolment for every course wired to it, so it outranks
                    anything else on the page. Direct child of this w-full flex column, so it
                    spans the screen rather than sharing a row. Self-hides when nothing was
                    actually probed, and ships hidden by default. */}
                {isWidgetExplicitlyVisible('lmsConnectionHealth') && (
                    <TrackedWidget widgetId="lmsConnectionHealth">
                        <LmsConnectionHealthWidget instituteId={instituteDetails?.id || ''} />
                    </TrackedWidget>
                )}
                {/* Super-admin-managed widgets (onboarding tracker / info cards) — additive, renders
                    nothing when none are configured. Role filtering is enforced server-side. */}
                <TrackedWidget widgetId="superAdminWidgets">
                    <SuperAdminWidgetsRegion />
                </TrackedWidget>
                {/* Pending Actions - role-shaped inbox of work-to-do */}
                {isWidgetVisible('pendingActions') && (
                    <TrackedWidget widgetId="pendingActions">
                        <MyPendingActionsWidget
                            instituteId={instituteDetails?.id || ''}
                            userId={getUserId() || ''}
                            isAdmin={isAdmin}
                            onOpenAllAlerts={onOpenAllAlerts}
                        />
                    </TrackedWidget>
                )}
                {roleBundle.showKpiBand && isWidgetVisible('kpiBand') && !isFreshTenant && (
                    <TrackedWidget widgetId="kpiBand">
                        <KpiBand instituteId={instituteDetails?.id || ''} roles={userRoles} />
                    </TrackedWidget>
                )}
                {/* Finance row - snapshot + recent transactions side-by-side for admin */}
                {isAdmin && !isFreshTenant && (
                    <div className="grid gap-4 lg:grid-cols-2">
                        {roleBundle.showFinanceSummary && isWidgetVisible('financeSummary') && (
                            <TrackedWidget widgetId="financeSummary">
                                <FinanceSummaryWidget instituteId={instituteDetails?.id || ''} />
                            </TrackedWidget>
                        )}
                        {isWidgetVisible('recentTransactions') && (
                            <TrackedWidget widgetId="recentTransactions">
                                <RecentTransactionsWidget
                                    instituteId={instituteDetails?.id || ''}
                                />
                            </TrackedWidget>
                        )}
                    </div>
                )}
                {/* Institute-wide amount collected with a 3d/7d/24d/All time filter.
                    Parent admin only (sub-org admins get their own scoped version below);
                    toggle id: revenueTrends. */}
                {isAdmin && !isSubOrgAdmin && !isFreshTenant && isWidgetVisible('revenueTrends') && (
                    <TrackedWidget widgetId="revenueTrends">
                        <RevenueTrendsWidget />
                    </TrackedWidget>
                )}
                {/* Sub-org (VLE) NETWORK snapshot — for the PARENT admin. Hidden for sub-org
                    admins (they'd otherwise see the whole parent network, wrong scope); they
                    get their own scoped card below instead. Per-role toggle:
                    Settings → Display Settings → Dashboard Widgets (id: subOrgOverview);
                    the widget itself also hides for institutes with no sub-orgs. */}
                {!isFreshTenant && !isSubOrgAdmin && isWidgetVisible('subOrgOverview') && (
                    <TrackedWidget widgetId="subOrgOverview">
                        <SubOrgOverviewWidget />
                    </TrackedWidget>
                )}
                {/* Where the parent institute's sub-orgs are located (state/city/pincode).
                    Parent admin only; self-hides when there are no sub-orgs. Toggle id:
                    subOrgGeography. */}
                {!isFreshTenant && !isSubOrgAdmin && isWidgetVisible('subOrgGeography') && (
                    <TrackedWidget widgetId="subOrgGeography">
                        <SubOrgGeographyWidget />
                    </TrackedWidget>
                )}
                {/* VLE network analytics (plans/seats/growth) — parent admin. Toggle id: vleAnalytics. */}
                {!isFreshTenant && !isSubOrgAdmin && isWidgetVisible('vleAnalytics') && (
                    <TrackedWidget widgetId="vleAnalytics">
                        <VLEInsightsWidget />
                    </TrackedWidget>
                )}
                {/* Top VLEs by seats used — parent admin. Toggle id: topVles. */}
                {!isFreshTenant && !isSubOrgAdmin && isWidgetVisible('topVles') && (
                    <TrackedWidget widgetId="topVles">
                        <TopVlesWidget />
                    </TrackedWidget>
                )}
                {/* Sub-org admin's OWN stats (learners / seats / courses / outstanding),
                    scoped to the sub-org they're in. Only ever for a sub-org admin; toggle
                    id: subOrgSelfStats. */}
                {!isFreshTenant && isSubOrgAdmin && isWidgetVisible('subOrgSelfStats') && (
                    <TrackedWidget widgetId="subOrgSelfStats">
                        <SubOrgSelfStatsWidget />
                    </TrackedWidget>
                )}
                {/* Sub-org admin's OWN amount collected with a 3d/7d/24d/All time filter,
                    scoped to their sub-org. Only for a sub-org admin; toggle id:
                    subOrgRevenueTrends. */}
                {!isFreshTenant && isSubOrgAdmin && callerSubOrgId && isWidgetVisible('subOrgRevenueTrends') && (
                    <TrackedWidget widgetId="subOrgRevenueTrends">
                        <RevenueTrendsWidget
                            subOrgId={callerSubOrgId}
                            title={t('revenueTrends.subOrgTitle')}
                        />
                    </TrackedWidget>
                )}
                {/* Sub-org admin: seat utilization + course catalogue. Toggle id: subOrgSeatCourses. */}
                {!isFreshTenant && isSubOrgAdmin && callerSubOrgId && isWidgetVisible('subOrgSeatCourses') && (
                    <TrackedWidget widgetId="subOrgSeatCourses">
                        <SubOrgSeatCoursesWidget />
                    </TrackedWidget>
                )}
                {/* Sub-org admin: recent enrollments + plan/dues. Toggle id: subOrgActivityDues. */}
                {!isFreshTenant && isSubOrgAdmin && callerSubOrgId && isWidgetVisible('subOrgActivityDues') && (
                    <TrackedWidget widgetId="subOrgActivityDues">
                        <SubOrgActivityDuesWidget />
                    </TrackedWidget>
                )}
                {/* My Courses Widget - Only for Non-Admin Users */}
                {!isAdmin && isWidgetVisible('myCourses') && <MyCoursesWidget />}
                {isAdmin && isWidgetVisible('mentorshipStats') && <MentorshipStatsWidget />}
                {/* Unresolved Doubts Widget */}
                {(subModules.lms || subModules.assess) &&
                    !showForInstitutes([HOLISTIC_INSTITUTE_ID]) &&
                    isWidgetVisible('unresolvedDoubts') && (
                        <UnresolvedDoubtsWidget instituteId={instituteDetails?.id || ''} />
                    )}
                {/* Admin Only Widgets */}
                {isAdmin && (
                    <>
                        {isFreshTenant ? (
                            <TrackedWidget widgetId="freshInstituteEmptyState">
                                <FreshInstituteEmptyState
                                    studentCount={data?.student_count || 0}
                                    batchCount={data?.batch_count || 0}
                                    courseCount={data?.course_count || 0}
                                    levelCount={data?.level_count || 0}
                                    profileCompletionPercentage={
                                        data?.profile_completion_percentage || 0
                                    }
                                />
                            </TrackedWidget>
                        ) : (
                            (() => {
                                const profileCompletion = data?.profile_completion_percentage || 0;
                                const showProfileSection =
                                    !profileCardDismissed.getValue() && profileCompletion < 100;
                                const showNamingSection =
                                    !namingCardDismissed.getValue() &&
                                    !showForInstitutes([HOLISTIC_INSTITUTE_ID]);
                                if (!showProfileSection && !showNamingSection) return null;
                                return (
                                    <Card className="grow bg-neutral-50 shadow-none">
                                        {showProfileSection && (
                                            <CardHeader className="p-4">
                                                <div className="flex items-center justify-between">
                                                    <CardTitle className="text-sm font-semibold">
                                                        {t('profileCard.title')}
                                                    </CardTitle>
                                                    <div className="flex items-center gap-1">
                                                        <EditDashboardProfileComponent
                                                            isEdit={false}
                                                        />
                                                        <button
                                                            type="button"
                                                            aria-label={t(
                                                                'profileCard.dismissAriaLabel'
                                                            )}
                                                            onClick={() =>
                                                                profileCardDismissed.setValue(true)
                                                            }
                                                            className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                                <CardDescription className="mt-1 flex items-center gap-1.5 text-xs">
                                                    <CompletionStatusComponent
                                                        profileCompletionPercentage={
                                                            profileCompletion
                                                        }
                                                    />
                                                    <span>
                                                        {t('profileCard.percentComplete', {
                                                            percent: profileCompletion,
                                                        })}
                                                    </span>
                                                </CardDescription>
                                            </CardHeader>
                                        )}

                                        {showNamingSection && (
                                            <CardHeader className="p-4">
                                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                    <div className="flex flex-col">
                                                        <CardTitle className="text-sm font-semibold">
                                                            {t('namingCard.title')}
                                                        </CardTitle>
                                                        <CardDescription className="text-xs">
                                                            {t('namingCard.description')}
                                                        </CardDescription>
                                                    </div>
                                                    <div className="flex items-center gap-1 sm:self-start">
                                                        <MyButton
                                                            type="button"
                                                            scale="medium"
                                                            buttonType="secondary"
                                                            layoutVariant="default"
                                                            className="mt-2 w-full text-sm sm:mt-0 sm:w-auto"
                                                            onClick={() =>
                                                                navigate({
                                                                    to: '/settings',
                                                                    search: {
                                                                        selectedTab:
                                                                            SettingsTabs.Naming,
                                                                    },
                                                                })
                                                            }
                                                        >
                                                            {t('namingCard.button')}
                                                        </MyButton>
                                                        <button
                                                            type="button"
                                                            aria-label={t(
                                                                'namingCard.dismissAriaLabel'
                                                            )}
                                                            onClick={() =>
                                                                namingCardDismissed.setValue(true)
                                                            }
                                                            className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </CardHeader>
                                        )}
                                    </Card>
                                );
                            })()
                        )}

                        {/* Analytics Widgets - Admin Only */}
                        {!showForInstitutes([HOLISTIC_INSTITUTE_ID]) && (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
                                {[
                                    {
                                        id: 'recentNotifications' as const,
                                        node: (
                                            <RecentNotificationsWidget onSeeAll={onOpenAllAlerts} />
                                        ),
                                    },
                                    // {
                                    //     id: 'realTimeActiveUsers' as const,
                                    //     node: (
                                    //         <RealTimeActiveUsersWidget
                                    //             instituteId={instituteDetails?.id || ''}
                                    //         />
                                    //     ),
                                    // },
                                    // {
                                    //     id: 'currentlyActiveUsers' as const,
                                    //     node: (
                                    //         <CurrentlyActiveUsersWidget
                                    //             instituteId={instituteDetails?.id || ''}
                                    //         />
                                    //     ),
                                    // },
                                    {
                                        id: 'dailyActivityTrend' as const,
                                        node: (
                                            <DailyActivityTrendWidget
                                                instituteId={instituteDetails?.id || ''}
                                            />
                                        ),
                                    },
                                ]
                                    .filter((w) => isWidgetVisible(w.id))
                                    .sort((a, b) => orderOf(a.id) - orderOf(b.id))
                                    .map((w, i) => (
                                        <div key={i}>{w.node}</div>
                                    ))}
                            </div>
                        )}
                    </>
                )}
                <div
                    className={`flex flex-col ${subModules.assess ? 'lg:flex-col' : 'lg:flex-row'} gap-4`} // Reduced gap
                >
                    <div
                        className={`flex flex-1 flex-col ${
                            subModules.assess ? 'md:flex-row' : 'md:flex-col'
                        } gap-4`} // Reduced gap
                    >
                        {isWidgetVisible('roleTypeUsers') && (
                            <Card className="flex-1 bg-neutral-50 shadow-none">
                                <CardHeader className="p-4">
                                    {' '}
                                    {/* Reduced padding */}
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-sm font-semibold">
                                            {t('roleTypeCard.title')}
                                        </CardTitle>{' '}
                                        {/* Smaller title */}
                                        <RoleTypeComponent setRoleTypeCount={setRoleTypeCount} />
                                    </div>
                                    <div className="mt-2 flex flex-col items-start gap-1.5">
                                        {' '}
                                        {/* Reduced margin-top and gap */}
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                            {' '}
                                            {/* Reduced gap */}
                                            {[
                                                {
                                                    label: getTerminology(
                                                        RoleTerms.Admin,
                                                        SystemTerms.Admin
                                                    ),
                                                    count: roleTypeCount.ADMIN,
                                                    bg: 'bg-blue-50',
                                                    textCol: 'text-blue-700',
                                                    borderCol: 'border-blue-200',
                                                },

                                                {
                                                    label: getTerminology(
                                                        RoleTerms.CourseCreator,
                                                        SystemTerms.CourseCreator
                                                    ),
                                                    count: roleTypeCount['CONTENT CREATOR'],
                                                    bg: 'bg-green-50',
                                                    textCol: 'text-green-700',
                                                    borderCol: 'border-green-200',
                                                },
                                                {
                                                    label: getTerminology(
                                                        RoleTerms.AssessmentCreator,
                                                        SystemTerms.AssessmentCreator
                                                    ),
                                                    count: roleTypeCount['ASSESSMENT CREATOR'],
                                                    bg: 'bg-red-50',
                                                    textCol: 'text-red-700',
                                                    borderCol: 'border-red-200',
                                                },
                                            ].map((role) => (
                                                <div
                                                    key={role.label}
                                                    className="flex items-center gap-1"
                                                >
                                                    <Badge
                                                        className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-2xs font-normal shadow-none ${role.bg} ${role.textCol} ${role.borderCol}`}
                                                    >
                                                        {role.label}
                                                    </Badge>
                                                    <span className="text-xs font-medium text-primary-500">
                                                        {role.count}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                            {' '}
                                            {/* Reduced gap */}
                                            {[
                                                {
                                                    label: getTerminology(
                                                        RoleTerms.Teacher,
                                                        SystemTerms.Teacher
                                                    ),
                                                    count: roleTypeCount['TEACHER'],
                                                    bg: 'bg-red-50',
                                                    textCol: 'text-red-700',
                                                    borderCol: 'border-red-200',
                                                }, // Example color, adjust as needed
                                                {
                                                    label: getTerminology(
                                                        RoleTerms.Evaluator,
                                                        SystemTerms.Evaluator
                                                    ),
                                                    count: roleTypeCount.EVALUATOR,
                                                    bg: 'bg-purple-50',
                                                    textCol: 'text-purple-700',
                                                    borderCol: 'border-purple-200',
                                                },
                                            ].map((role) => (
                                                <div
                                                    key={role.label}
                                                    className="flex items-center gap-1"
                                                >
                                                    <Badge
                                                        className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-2xs font-normal shadow-none ${role.bg} ${role.textCol} ${role.borderCol}`}
                                                    >
                                                        {role.label}
                                                    </Badge>
                                                    <span className="text-xs font-medium text-primary-500">
                                                        {role.count}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </CardHeader>
                            </Card>
                        )}
                    </div>
                    <div className="flex flex-1 flex-col gap-4 md:flex-row">
                        {isWidgetVisible('liveClasses') && (
                            <LiveClassesWidget instituteId={instituteDetails?.id || ''} />
                        )}
                    </div>
                </div>
                {/* AI Features Card - Demoted to bottom, dismissible */}
                {isWidgetVisible('aiFeaturesCard') && !aiCardDismissed.getValue() && (
                    <Card
                        className="group relative grow cursor-pointer bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-lg transition-all hover:scale-[1.01] hover:shadow-md"
                        onClick={handleAICenterNavigation}
                    >
                        <button
                            type="button"
                            aria-label={t('aiCard.dismissAriaLabel')}
                            onClick={(e) => {
                                e.stopPropagation();
                                aiCardDismissed.setValue(true);
                            }}
                            className="absolute right-2 top-2 z-10 rounded p-1 text-purple-100 hover:bg-white/20"
                        >
                            <X size={14} />
                        </button>
                        <CardHeader className="p-4 sm:p-5">
                            <div className="flex items-center justify-between pr-6">
                                <CardTitle className="mb-0.5 flex items-center gap-1.5 text-base font-semibold">
                                    <Sparkle size={22} weight="fill" />
                                    {t('aiCard.title')}
                                </CardTitle>
                                <ArrowSquareOut size={18} className="text-purple-200" />
                            </div>
                            <CardDescription className="text-xs text-purple-100">
                                {t('aiCard.description')}
                            </CardDescription>
                            <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:justify-start sm:gap-2.5 sm:overflow-visible sm:px-0">
                                {[
                                    { icon: FilePdf, text: t('aiCard.features.pdf') },
                                    {
                                        icon: LightbulbFilament,
                                        text: t('aiCard.features.lectureAudio'),
                                    },
                                    {
                                        icon: LightbulbFilament,
                                        text: t('aiCard.features.sortTopicWise'),
                                    },
                                    { icon: LightbulbFilament, text: t('aiCard.features.image') },
                                    {
                                        icon: LightbulbFilament,
                                        text: t('aiCard.features.lectureFeedback'),
                                    },
                                    {
                                        icon: LightbulbFilament,
                                        text: t('aiCard.features.planLecture'),
                                    },
                                ].map((item, index) => (
                                    <div
                                        key={index}
                                        className="flex h-auto min-h-10 w-32 flex-col items-center justify-center rounded-md border border-purple-300/70 bg-white/10 p-1.5 text-center shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 sm:w-32"
                                    >
                                        <item.icon size={18} className="mb-0.5 text-purple-200" />
                                        <span className="text-2xs font-normal leading-tight text-white">
                                            {item.text}
                                        </span>
                                    </div>
                                ))}
                                <div className="flex h-auto min-h-10 w-32 flex-col items-center justify-center rounded-md border border-purple-300/70 bg-white/10 p-1.5 text-center shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 sm:w-32">
                                    <span className="text-2xs font-normal leading-tight text-white">
                                        {t('aiCard.manyMore')}
                                    </span>
                                </div>
                            </div>
                        </CardHeader>
                    </Card>
                )}
            </div>
        </>
    );
}

export default DashboardPage;
