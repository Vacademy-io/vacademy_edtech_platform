import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import {
    STUDENT_DISPLAY_SETTINGS_KEY,
    type StudentDisplaySettingsData,
    type StudentSidebarTabConfig,
    type StudentDashboardWidgetConfig,
    type StudentDashboardWidgetId,
    type StudentAllCoursesCustomTab,
    type StudentAllCoursesCustomTabProductPage,
    type StudentAllCoursesCustomTabType,
} from '@/types/student-display-settings';
import { DEFAULT_STUDENT_DISPLAY_SETTINGS } from '@/constants/display-settings/student-defaults';

const LS_KEY = `${STUDENT_DISPLAY_SETTINGS_KEY}_CACHE_V1`;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function readCache(): StudentDisplaySettingsData | null {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { ts: number; data: StudentDisplaySettingsData };
        if (!parsed?.ts || Date.now() - parsed.ts > ONE_DAY_MS) return null;
        return mergeWithDefaults(parsed.data);
    } catch {
        return null;
    }
}

function writeCache(data: StudentDisplaySettingsData): void {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch {
        // ignore
    }
}

function mergeArrayById<T extends { id: string }>(
    incoming: Array<Partial<T>> | undefined,
    defaults: Array<T>
): Array<T> {
    const byId = new Map<string, T>();
    defaults.forEach((d) => byId.set(d.id, { ...d }));
    (incoming || []).forEach((i) => {
        if (!i?.id) return;
        const def = byId.get(i.id);
        if (def) byId.set(i.id, { ...def, ...i } as T);
        else byId.set(i.id, i as T);
    });
    return Array.from(byId.values());
}

const CUSTOM_COURSE_TAB_TYPES: ReadonlyArray<StudentAllCoursesCustomTabType> = [
    'TAG',
    'COURSES',
    'FREE_COURSES',
    'LIVE_SESSIONS',
    'PRODUCT_PAGES',
];

const stringList = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string' && v.length > 0)
        : [];

/** Drops custom Courses-page tabs without an id and fills missing fields. */
function normalizeCustomCourseTabs(
    incoming: Array<Partial<StudentAllCoursesCustomTab>> | undefined
): StudentAllCoursesCustomTab[] {
    if (!Array.isArray(incoming)) return [];
    return incoming
        .filter((t) => typeof t?.id === 'string' && t.id.length > 0)
        .map((t) => ({
            id: t.id as string,
            label: typeof t.label === 'string' ? t.label : '',
            // Tabs saved before types existed are tag tabs.
            type: CUSTOM_COURSE_TAB_TYPES.includes(t.type as StudentAllCoursesCustomTabType)
                ? (t.type as StudentAllCoursesCustomTabType)
                : 'TAG',
            tags: stringList(t.tags),
            courseIds: stringList(t.courseIds),
            productPages: Array.isArray(t.productPages)
                ? t.productPages
                      .filter(
                          (p): p is StudentAllCoursesCustomTabProductPage =>
                              typeof p?.code === 'string' && p.code.length > 0
                      )
                      .map((p) => ({
                          code: p.code,
                          name: typeof p.name === 'string' ? p.name : p.code,
                      }))
                : [],
            order: typeof t.order === 'number' ? t.order : 0,
            visible: t.visible ?? true,
        }));
}

/**
 * Back-compat for the split-out commerce CTAs.
 *
 * "Explore Memberships" / "Explore Books" used to be gated by the myMembership
 * / myBooks WIDGET flags. Now they have their own ids, which default to
 * visible — so an institute that had deliberately hidden the membership widget
 * would suddenly get its CTA back (and this screen would show the toggle as on,
 * persisting that on the next save). When the saved settings predate the new
 * ids, inherit the old flag instead of the default. Only applies when the old
 * flag was explicitly saved and the new one was not; an explicit CTA entry wins.
 *
 * Mirrors the learner app's seedExploreCtaVisibility — keep the two in step.
 */
function seedExploreCtaVisibility(
    out: StudentDisplaySettingsData,
    incoming?: Partial<StudentDisplaySettingsData> | null
): void {
    const savedIds = new Set(
        (incoming?.dashboard?.widgets ?? [])
            .map((w) => w?.id)
            .filter((id): id is StudentDashboardWidgetId => Boolean(id))
    );
    const pairs: Array<[StudentDashboardWidgetId, StudentDashboardWidgetId]> = [
        ['exploreMemberships', 'myMembership'],
        ['exploreBooks', 'myBooks'],
    ];
    for (const [ctaId, widgetId] of pairs) {
        if (savedIds.has(ctaId) || !savedIds.has(widgetId)) continue;
        const source = out.dashboard.widgets.find((w) => w.id === widgetId);
        const cta = out.dashboard.widgets.find((w) => w.id === ctaId);
        if (source && cta) cta.visible = source.visible;
    }
}

function mergeWithDefaults(
    incoming?: Partial<StudentDisplaySettingsData> | null
): StudentDisplaySettingsData {
    const d = DEFAULT_STUDENT_DISPLAY_SETTINGS;
    const out: StudentDisplaySettingsData = {
        sidebar: {
            visible: incoming?.sidebar?.visible ?? d.sidebar.visible,
            tabs: mergeArrayById<StudentSidebarTabConfig>(
                incoming?.sidebar?.tabs,
                d.sidebar.tabs
            ).map((t) => ({
                id: t.id,
                label: t.label ?? d.sidebar.tabs.find((x) => x.id === t.id)?.label,
                route: t.route ?? d.sidebar.tabs.find((x) => x.id === t.id)?.route,
                order: t.order ?? d.sidebar.tabs.find((x) => x.id === t.id)?.order ?? 0,
                visible: t.visible ?? d.sidebar.tabs.find((x) => x.id === t.id)?.visible ?? true,
                isCustom: t.isCustom ?? false,
                subTabs: mergeArrayById(
                    incoming?.sidebar?.tabs?.find((x) => x?.id === t.id)?.subTabs,
                    d.sidebar.tabs.find((x) => x.id === t.id)?.subTabs || []
                ).map((s) => ({
                    id: s.id,
                    label:
                        s.label ??
                        d.sidebar.tabs
                            .find((x) => x.id === t.id)
                            ?.subTabs?.find((y) => y.id === s.id)?.label,
                    route:
                        s.route ??
                        d.sidebar.tabs
                            .find((x) => x.id === t.id)
                            ?.subTabs?.find((y) => y.id === s.id)?.route ??
                        '/',
                    order:
                        s.order ??
                        d.sidebar.tabs
                            .find((x) => x.id === t.id)
                            ?.subTabs?.find((y) => y.id === s.id)?.order ??
                        0,
                    visible:
                        s.visible ??
                        d.sidebar.tabs
                            .find((x) => x.id === t.id)
                            ?.subTabs?.find((y) => y.id === s.id)?.visible ??
                        true,
                })),
            })),
        },
        dashboard: {
            widgets: mergeArrayById<StudentDashboardWidgetConfig>(
                incoming?.dashboard?.widgets,
                d.dashboard.widgets
            ).map((w) => ({
                id: w.id,
                order: w.order ?? d.dashboard.widgets.find((x) => x.id === w.id)?.order ?? 0,
                visible:
                    w.visible ?? d.dashboard.widgets.find((x) => x.id === w.id)?.visible ?? true,
                isCustom: w.isCustom ?? false,
                title: w.title ?? d.dashboard.widgets.find((x) => x.id === w.id)?.title,
                subTitle: w.subTitle ?? d.dashboard.widgets.find((x) => x.id === w.id)?.subTitle,
                link: w.link ?? d.dashboard.widgets.find((x) => x.id === w.id)?.link,
            })),
        },
        ui: {
            type: incoming?.ui?.type ?? d.ui.type,
        },
        signup: {
            enabled: incoming?.signup?.enabled ?? d.signup.enabled,
            providers: {
                google: incoming?.signup?.providers?.google ?? d.signup.providers.google,
                github: incoming?.signup?.providers?.github ?? d.signup.providers.github,
                usernamePassword:
                    incoming?.signup?.providers?.usernamePassword ??
                    d.signup.providers.usernamePassword,
                emailOtp: incoming?.signup?.providers?.emailOtp ?? d.signup.providers.emailOtp,
                defaultProvider:
                    incoming?.signup?.providers?.defaultProvider ??
                    d.signup.providers.defaultProvider,
            },
            usernameStrategy: incoming?.signup?.usernameStrategy ?? d.signup.usernameStrategy,
            usernameCustomFieldId: incoming?.signup?.usernameCustomFieldId,
            usernamePrefix: incoming?.signup?.usernamePrefix,
            usernameApplyToAll: incoming?.signup?.usernameApplyToAll ?? false,
            usernameOverrideTyped: incoming?.signup?.usernameOverrideTyped ?? false,
            passwordStrategy: incoming?.signup?.passwordStrategy ?? d.signup.passwordStrategy,
            passwordDelivery: incoming?.signup?.passwordDelivery ?? d.signup.passwordDelivery,
            presentation: incoming?.signup?.presentation ?? d.signup.presentation,
        },
        permissions: {
            canViewProfile: incoming?.permissions?.canViewProfile ?? d.permissions.canViewProfile,
            canEditProfile: incoming?.permissions?.canEditProfile ?? d.permissions.canEditProfile,
            canDeleteProfile:
                incoming?.permissions?.canDeleteProfile ?? d.permissions.canDeleteProfile,
            canViewFiles: incoming?.permissions?.canViewFiles ?? d.permissions.canViewFiles,
            canViewReports: incoming?.permissions?.canViewReports ?? d.permissions.canViewReports,
        },
        profile: {
            showMembershipStatus:
                incoming?.profile?.showMembershipStatus ?? d.profile.showMembershipStatus,
        },
        courseDetails: {
            tabs: mergeArrayById(incoming?.courseDetails?.tabs, d.courseDetails.tabs).map((t) => ({
                id: t.id,
                label: t.label ?? d.courseDetails.tabs.find((x) => x.id === t.id)?.label,
                order: t.order ?? d.courseDetails.tabs.find((x) => x.id === t.id)?.order ?? 0,
                visible:
                    t.visible ?? d.courseDetails.tabs.find((x) => x.id === t.id)?.visible ?? true,
            })),
            defaultTab: incoming?.courseDetails?.defaultTab ?? d.courseDetails.defaultTab,
            outlineMode: incoming?.courseDetails?.outlineMode ?? d.courseDetails.outlineMode,
            ratingsAndReviewsVisible:
                incoming?.courseDetails?.ratingsAndReviewsVisible ??
                d.courseDetails.ratingsAndReviewsVisible,
            hideAuthorName:
                incoming?.courseDetails?.hideAuthorName ??
                d.courseDetails.hideAuthorName,
            showInstructors:
                incoming?.courseDetails?.showInstructors ??
                d.courseDetails.showInstructors,
            showCourseConfiguration:
                incoming?.courseDetails?.showCourseConfiguration ??
                d.courseDetails.showCourseConfiguration,
            hideTags: incoming?.courseDetails?.hideTags ?? d.courseDetails.hideTags,
            showCourseContentPrefixes:
                incoming?.courseDetails?.showCourseContentPrefixes ??
                d.courseDetails.showCourseContentPrefixes,
            courseOverview: {
                visible:
                    incoming?.courseDetails?.courseOverview?.visible ??
                    d.courseDetails.courseOverview.visible,
                showSlidesData:
                    incoming?.courseDetails?.courseOverview?.showSlidesData ??
                    d.courseDetails.courseOverview.showSlidesData,
            },
            slidesView: {
                showLearningPath:
                    incoming?.courseDetails?.slidesView?.showLearningPath ??
                    d.courseDetails.slidesView.showLearningPath,
                feedbackVisible:
                    incoming?.courseDetails?.slidesView?.feedbackVisible ??
                    d.courseDetails.slidesView.feedbackVisible,
                canAskDoubt:
                    incoming?.courseDetails?.slidesView?.canAskDoubt ??
                    d.courseDetails.slidesView.canAskDoubt,
                sidebarNavigation:
                    incoming?.courseDetails?.slidesView?.sidebarNavigation ??
                    d.courseDetails.slidesView.sidebarNavigation,
                // Deliberately no `?? default`: undefined is a real state here
                // ("follow the sidebar mode"), so defaulting it would collapse
                // the tri-state into a boolean and lose the inference.
                collapseSidebarOnOpen:
                    incoming?.courseDetails?.slidesView?.collapseSidebarOnOpen,
                // Same tri-state contract as collapseSidebarOnOpen above:
                // undefined means "follow the sidebar mode", not false.
                manualCompletion:
                    incoming?.courseDetails?.slidesView?.manualCompletion,
                // Tri-state like the two above — undefined means "follow the
                // sidebar mode", so neither may be defaulted here.
                chapterCompleteCta:
                    incoming?.courseDetails?.slidesView?.chapterCompleteCta,
                feedbackInSlideNav:
                    incoming?.courseDetails?.slidesView?.feedbackInSlideNav,
                // Plain enum with a real default — 'CHAPTER' is today's cadence.
                feedbackTrigger:
                    incoming?.courseDetails?.slidesView?.feedbackTrigger ?? 'CHAPTER',
            },
            enrolledLayout:
                incoming?.courseDetails?.enrolledLayout ?? d.courseDetails.enrolledLayout,
            contentCardImageFit:
                incoming?.courseDetails?.contentCardImageFit ??
                d.courseDetails.contentCardImageFit,
            // Tri-state — undefined means "follow enrolledLayout".
            chapterOpensFirstSlide: incoming?.courseDetails?.chapterOpensFirstSlide,
        },
        courseSettings: {
            quiz: {
                moveOnlyOnCorrectAnswer:
                    incoming?.courseSettings?.quiz?.moveOnlyOnCorrectAnswer ??
                    d.courseSettings.quiz.moveOnlyOnCorrectAnswer,
                celebrateOnQuizComplete:
                    incoming?.courseSettings?.quiz?.celebrateOnQuizComplete ??
                    d.courseSettings.quiz.celebrateOnQuizComplete,
                showReportAndCorrectAnswers:
                    incoming?.courseSettings?.quiz?.showReportAndCorrectAnswers ??
                    d.courseSettings.quiz.showReportAndCorrectAnswers,
            },
            assignment: {
                hideAttemptsAllowed:
                    incoming?.courseSettings?.assignment?.hideAttemptsAllowed ??
                    d.courseSettings.assignment.hideAttemptsAllowed,
                hideRepeatedTitle:
                    incoming?.courseSettings?.assignment?.hideRepeatedTitle ??
                    d.courseSettings.assignment.hideRepeatedTitle,
            },
        },
        allCourses: {
            tabs: mergeArrayById(incoming?.allCourses?.tabs, d.allCourses.tabs).map((t) => ({
                id: t.id,
                label: t.label ?? d.allCourses.tabs.find((x) => x.id === t.id)?.label,
                order: t.order ?? d.allCourses.tabs.find((x) => x.id === t.id)?.order ?? 0,
                visible: t.visible ?? d.allCourses.tabs.find((x) => x.id === t.id)?.visible ?? true,
            })),
            customTabs: normalizeCustomCourseTabs(incoming?.allCourses?.customTabs),
            defaultTab: incoming?.allCourses?.defaultTab ?? d.allCourses.defaultTab,
            hideInstructorName:
                incoming?.allCourses?.hideInstructorName ??
                d.allCourses.hideInstructorName,
            pageSize: incoming?.allCourses?.pageSize ?? d.allCourses.pageSize,
            showAllEnrolledOnDashboard:
                incoming?.allCourses?.showAllEnrolledOnDashboard ??
                d.allCourses.showAllEnrolledOnDashboard,
        },
        notifications: {
            allowSystemAlerts:
                incoming?.notifications?.allowSystemAlerts ?? d.notifications.allowSystemAlerts,
            allowDashboardPins:
                incoming?.notifications?.allowDashboardPins ?? d.notifications.allowDashboardPins,
            allowBatchStream:
                incoming?.notifications?.allowBatchStream ?? d.notifications.allowBatchStream,
            allowAppOverlays:
                incoming?.notifications?.allowAppOverlays ?? d.notifications.allowAppOverlays,
        },
        liveClasses: {
            showPastSessions:
                incoming?.liveClasses?.showPastSessions ?? d.liveClasses.showPastSessions,
            showRecordings:
                incoming?.liveClasses?.showRecordings ?? d.liveClasses.showRecordings,
            showAttendance:
                incoming?.liveClasses?.showAttendance ?? d.liveClasses.showAttendance,
            showActivityStats:
                incoming?.liveClasses?.showActivityStats ?? d.liveClasses.showActivityStats,
            showClassMaterials:
                incoming?.liveClasses?.showClassMaterials ?? d.liveClasses.showClassMaterials,
            showUnassignedPublicSessions:
                incoming?.liveClasses?.showUnassignedPublicSessions ??
                d.liveClasses.showUnassignedPublicSessions,
        },
        tutorials: {
            enabled: incoming?.tutorials?.enabled ?? d.tutorials.enabled,
            enabledTours: incoming?.tutorials?.enabledTours ?? d.tutorials.enabledTours,
            pdfGuideEnabled:
                incoming?.tutorials?.pdfGuideEnabled ?? d.tutorials.pdfGuideEnabled,
        },
        concentration: {
            enabled: incoming?.concentration?.enabled ?? d.concentration.enabled,
            frequency: {
                min_minutes:
                    incoming?.concentration?.frequency?.min_minutes ??
                    d.concentration.frequency.min_minutes,
                max_minutes:
                    incoming?.concentration?.frequency?.max_minutes ??
                    d.concentration.frequency.max_minutes,
            },
            behavior: {
                allow_skip:
                    incoming?.concentration?.behavior?.allow_skip ??
                    d.concentration.behavior.allow_skip,
                penalty_type:
                    incoming?.concentration?.behavior?.penalty_type ??
                    d.concentration.behavior.penalty_type,
            },
            appearance: {
                title:
                    incoming?.concentration?.appearance?.title ??
                    d.concentration.appearance.title,
                subtitle:
                    incoming?.concentration?.appearance?.subtitle ??
                    d.concentration.appearance.subtitle,
            },
        },
        postLoginRedirectRoute: incoming?.postLoginRedirectRoute ?? d.postLoginRedirectRoute,
    };

    // Sort
    seedExploreCtaVisibility(out, incoming);

    out.sidebar.tabs.sort((a, b) => (a.order || 0) - (b.order || 0));
    out.sidebar.tabs.forEach((t) => t.subTabs?.sort((a, b) => (a.order || 0) - (b.order || 0)));
    out.dashboard.widgets.sort((a, b) => (a.order || 0) - (b.order || 0));
    out.courseDetails.tabs.sort((a, b) => (a.order || 0) - (b.order || 0));
    out.allCourses.tabs.sort((a, b) => (a.order || 0) - (b.order || 0));

    return out;
}

export const getStudentDisplaySettingsFromCache = (): StudentDisplaySettingsData | null => {
    return readCache();
};

/**
 * Server copy for the settings editor. Unlike getStudentDisplaySettings it
 * never answers from the 24h cache and THROWS instead of falling back to
 * defaults — the editor saves the whole blob back, so either fallback would
 * let one Save overwrite the institute's real settings.
 */
export async function fetchStudentDisplaySettingsForEdit(): Promise<StudentDisplaySettingsData> {
    const instituteId = getInstituteId();
    if (!instituteId) throw new Error('No institute selected');
    const res = await authenticatedAxiosInstance.get<{
        data: StudentDisplaySettingsData | null;
    }>(`${BASE_URL}/admin-core-service/institute/setting/v1/get`, {
        params: { instituteId, settingKey: STUDENT_DISPLAY_SETTINGS_KEY },
    });
    const serverData = res.data?.data;
    const merged = mergeWithDefaults(
        serverData && Object.keys(serverData).length ? serverData : DEFAULT_STUDENT_DISPLAY_SETTINGS
    );
    writeCache(merged);
    return merged;
}

export async function getStudentDisplaySettings(
    forceRefresh = false
): Promise<StudentDisplaySettingsData> {
    const instituteId = getInstituteId();
    if (!instituteId) return DEFAULT_STUDENT_DISPLAY_SETTINGS;
    if (!forceRefresh) {
        const cached = readCache();
        if (cached) return cached;
    }
    try {
        const res = await authenticatedAxiosInstance.get<{
            data: StudentDisplaySettingsData | null;
        }>(`${BASE_URL}/admin-core-service/institute/setting/v1/get`, {
            params: { instituteId, settingKey: STUDENT_DISPLAY_SETTINGS_KEY },
        });
        const serverData = res.data?.data;
        const merged = mergeWithDefaults(
            serverData && Object.keys(serverData).length
                ? serverData
                : DEFAULT_STUDENT_DISPLAY_SETTINGS
        );
        writeCache(merged);
        return merged;
    } catch (error) {
        const defaults = DEFAULT_STUDENT_DISPLAY_SETTINGS;
        writeCache(defaults);
        return defaults;
    }
}

export async function saveStudentDisplaySettings(
    settings: StudentDisplaySettingsData
): Promise<void> {
    const instituteId = getInstituteId();
    if (!instituteId) return;
    const requestData = {
        setting_name: 'Student Display Settings',
        setting_data: settings,
    };
    await authenticatedAxiosInstance.post(
        `${BASE_URL}/admin-core-service/institute/setting/v1/save-setting`,
        requestData,
        {
            params: { instituteId, settingKey: STUDENT_DISPLAY_SETTINGS_KEY },
            headers: { 'Content-Type': 'application/json' },
        }
    );
    writeCache(settings);
}

/**
 * The institute's learner-username rule for admin add forms (Settings → Login &
 * Signup). `applies`: the strategy also covers admin adds. `overridesTyped`: it
 * replaces a username the admin types, so forms lock that field. Reads the server
 * copy (not the 24h cache) so a just-changed setting shows.
 */
export const useLearnerUsernamePolicy = () => {
    const { data } = useQuery({
        queryKey: ['student-display-settings', 'username-policy', getInstituteId()],
        queryFn: () => getStudentDisplaySettings(true),
        staleTime: 5 * 60 * 1000,
    });
    const signup = data?.signup;
    const strategy = signup?.usernameStrategy;
    const applies = !!signup?.usernameApplyToAll && strategy !== 'manual';
    return {
        strategy,
        applies,
        overridesTyped: applies && !!signup?.usernameOverrideTyped && strategy !== 'random',
    };
};

export function clearStudentDisplaySettingsCache(): void {
    try {
        localStorage.removeItem(LS_KEY);
    } catch {
        // ignore
    }
}
