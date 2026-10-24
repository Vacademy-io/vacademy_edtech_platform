import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL, OPEN_STUDENT_DISPLAY_SETTINGS } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";
import {
  STUDENT_DISPLAY_SETTINGS_KEY,
  type StudentDisplaySettingsData,
  type StudentSidebarTabConfig,
  type StudentDashboardWidgetConfig,
  type StudentDashboardWidgetId,
  type StudentAllCoursesCustomTab,
  type StudentAllCoursesCustomTabProductPage,
  type StudentAllCoursesCustomTabType,
} from "@/types/student-display-settings";
import { DEFAULT_STUDENT_DISPLAY_SETTINGS } from "@/constants/display-settings/student-defaults";
import { resolveUiSkin } from "@/utils/institute-theme-roles";

const LS_KEY = `${STUDENT_DISPLAY_SETTINGS_KEY}_CACHE_V1`;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function mergeArrayById<T extends { id: string }>(
  incoming: Array<Partial<T>> | undefined,
  defaults: Array<T>
): Array<T> {
  const byId = new Map<string, T>();
  defaults.forEach((d) => byId.set(d.id, { ...d }));
  (incoming || []).forEach((i) => {
    if (!i?.id) return;
    const def = byId.get(i.id);
    byId.set(i.id, def ? ({ ...def, ...i } as T) : (i as T));
  });
  return Array.from(byId.values());
}

const CUSTOM_COURSE_TAB_TYPES: ReadonlyArray<StudentAllCoursesCustomTabType> = [
  "TAG",
  "COURSES",
  "FREE_COURSES",
  "LIVE_SESSIONS",
  "PRODUCT_PAGES",
];

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];

/** Drops custom Courses-page tabs without an id and fills missing fields. */
function normalizeCustomCourseTabs(
  incoming: Array<Partial<StudentAllCoursesCustomTab>> | undefined
): StudentAllCoursesCustomTab[] {
  if (!Array.isArray(incoming)) return [];
  return incoming
    .filter((t) => typeof t?.id === "string" && t.id.length > 0)
    .map((t) => ({
      id: t.id as string,
      label: typeof t.label === "string" ? t.label : "",
      // Tabs saved before types existed are tag tabs.
      type: CUSTOM_COURSE_TAB_TYPES.includes(t.type as StudentAllCoursesCustomTabType)
        ? (t.type as StudentAllCoursesCustomTabType)
        : "TAG",
      tags: stringList(t.tags),
      courseIds: stringList(t.courseIds),
      productPages: Array.isArray(t.productPages)
        ? t.productPages.filter(
            (p): p is StudentAllCoursesCustomTabProductPage =>
              typeof p?.code === "string" && p.code.length > 0
          ).map((p) => ({ code: p.code, name: typeof p.name === "string" ? p.name : p.code }))
        : [],
      order: typeof t.order === "number" ? t.order : 0,
      visible: t.visible ?? true,
    }));
}

/**
 * Back-compat for the split-out commerce CTAs.
 *
 * "Explore Memberships" / "Explore Books" used to be gated by the myMembership
 * / myBooks WIDGET flags. Now they have their own ids, which default to
 * visible — so an institute that had deliberately hidden the membership widget
 * would suddenly get its CTA back. When the saved settings predate the new ids,
 * inherit the old flag instead of the default. Only applies when the old flag
 * was explicitly saved and the new one was not; an explicit CTA entry always wins.
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
    ["exploreMemberships", "myMembership"],
    ["exploreBooks", "myBooks"],
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
    ui: {
      type: incoming?.ui?.type ?? d.ui.type,
    },
    sidebar: {
      visible: incoming?.sidebar?.visible ?? d.sidebar.visible,
      // Absent on every settings blob saved before the getApp widget shipped —
      // those institutes must keep the sidebar links they already had.
      appLinks: incoming?.sidebar?.appLinks ?? d.sidebar.appLinks,
      tabs: mergeArrayById<StudentSidebarTabConfig>(
        incoming?.sidebar?.tabs,
        d.sidebar.tabs
      ).map((t) => ({
        id: t.id,
        label: t.label ?? d.sidebar.tabs.find((x) => x.id === t.id)?.label,
        route: t.route ?? d.sidebar.tabs.find((x) => x.id === t.id)?.route,
        order: t.order ?? d.sidebar.tabs.find((x) => x.id === t.id)?.order ?? 0,
        visible:
          t.visible ??
          d.sidebar.tabs.find((x) => x.id === t.id)?.visible ??
          true,
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
            "/",
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
        order:
          w.order ?? d.dashboard.widgets.find((x) => x.id === w.id)?.order ?? 0,
        visible:
          w.visible ??
          d.dashboard.widgets.find((x) => x.id === w.id)?.visible ??
          true,
        isCustom: w.isCustom ?? false,
        title: w.title ?? d.dashboard.widgets.find((x) => x.id === w.id)?.title,
        subTitle:
          w.subTitle ??
          d.dashboard.widgets.find((x) => x.id === w.id)?.subTitle,
        link: w.link ?? d.dashboard.widgets.find((x) => x.id === w.id)?.link,
      })),
    },
    signup: {
      enabled: incoming?.signup?.enabled ?? d.signup.enabled,
      providers: {
        google:
          incoming?.signup?.providers?.google ?? d.signup.providers.google,
        github:
          incoming?.signup?.providers?.github ?? d.signup.providers.github,
        usernamePassword:
          incoming?.signup?.providers?.usernamePassword ??
          d.signup.providers.usernamePassword,
        emailOtp:
          incoming?.signup?.providers?.emailOtp ?? d.signup.providers.emailOtp,
        defaultProvider:
          incoming?.signup?.providers?.defaultProvider ??
          d.signup.providers.defaultProvider,
      },
      usernameStrategy:
        incoming?.signup?.usernameStrategy ?? d.signup.usernameStrategy,
      passwordStrategy:
        incoming?.signup?.passwordStrategy ?? d.signup.passwordStrategy,
      passwordDelivery:
        incoming?.signup?.passwordDelivery ?? d.signup.passwordDelivery,
      presentation:
        incoming?.signup?.presentation ?? d.signup.presentation,
    },
    permissions: {
      canViewProfile:
        incoming?.permissions?.canViewProfile ?? d.permissions.canViewProfile,
      canEditProfile:
        incoming?.permissions?.canEditProfile ?? d.permissions.canEditProfile,
      canDeleteProfile:
        incoming?.permissions?.canDeleteProfile ??
        d.permissions.canDeleteProfile,
      canViewFiles:
        incoming?.permissions?.canViewFiles ?? d.permissions.canViewFiles,
      canViewReports:
        incoming?.permissions?.canViewReports ?? d.permissions.canViewReports,
    },
    profile: {
      showMembershipStatus:
        incoming?.profile?.showMembershipStatus ??
        d.profile.showMembershipStatus,
    },
    courseDetails: {
      tabs: mergeArrayById(
        incoming?.courseDetails?.tabs,
        d.courseDetails.tabs
      ).map((t) => ({
        id: t.id,
        label:
          t.label ?? d.courseDetails.tabs.find((x) => x.id === t.id)?.label,
        order:
          t.order ??
          d.courseDetails.tabs.find((x) => x.id === t.id)?.order ??
          0,
        visible:
          t.visible ??
          d.courseDetails.tabs.find((x) => x.id === t.id)?.visible ??
          true,
      })),
      defaultTab:
        incoming?.courseDetails?.defaultTab ?? d.courseDetails.defaultTab,
      outlineMode:
        incoming?.courseDetails?.outlineMode ?? d.courseDetails.outlineMode,
      ratingsAndReviewsVisible:
        incoming?.courseDetails?.ratingsAndReviewsVisible ??
        d.courseDetails.ratingsAndReviewsVisible,
      hideAuthorName:
        incoming?.courseDetails?.hideAuthorName ??
        d.courseDetails.hideAuthorName,
      showInstructors:
        incoming?.courseDetails?.showInstructors ??
        d.courseDetails.showInstructors,
      // New flags with defaults
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
        // ("follow the sidebar mode"), so defaulting it would collapse the
        // tri-state into a boolean and lose the inference.
        collapseSidebarOnOpen:
          incoming?.courseDetails?.slidesView?.collapseSidebarOnOpen,
        // Same tri-state contract as collapseSidebarOnOpen above: undefined
        // means "follow the sidebar mode", so it must not be defaulted here.
        manualCompletion:
          incoming?.courseDetails?.slidesView?.manualCompletion,
        // Tri-state like the two above — undefined means "follow the sidebar
        // mode", so neither may be defaulted here.
        chapterCompleteCta:
          incoming?.courseDetails?.slidesView?.chapterCompleteCta,
        feedbackInSlideNav:
          incoming?.courseDetails?.slidesView?.feedbackInSlideNav,
        // Plain enum with a real default — "CHAPTER" is today's cadence.
        feedbackTrigger:
          incoming?.courseDetails?.slidesView?.feedbackTrigger ?? "CHAPTER",
      },
      enrolledLayout:
        incoming?.courseDetails?.enrolledLayout ??
        d.courseDetails.enrolledLayout,
      contentCardImageFit:
        incoming?.courseDetails?.contentCardImageFit ??
        d.courseDetails.contentCardImageFit,
      // Tri-state — undefined means "follow enrolledLayout".
      chapterOpensFirstSlide: incoming?.courseDetails?.chapterOpensFirstSlide,
    },
    allCourses: {
      tabs: mergeArrayById(incoming?.allCourses?.tabs, d.allCourses.tabs).map(
        (t) => ({
          id: t.id,
          label: t.label ?? d.allCourses.tabs.find((x) => x.id === t.id)?.label,
          order:
            t.order ?? d.allCourses.tabs.find((x) => x.id === t.id)?.order ?? 0,
          visible:
            t.visible ??
            d.allCourses.tabs.find((x) => x.id === t.id)?.visible ??
            true,
        })
      ),
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
        incoming?.notifications?.allowSystemAlerts ??
        d.notifications.allowSystemAlerts,
      allowDashboardPins:
        incoming?.notifications?.allowDashboardPins ??
        d.notifications.allowDashboardPins,
      allowBatchStream:
        incoming?.notifications?.allowBatchStream ??
        d.notifications.allowBatchStream,
      allowAppOverlays:
        incoming?.notifications?.allowAppOverlays ??
        d.notifications.allowAppOverlays,
    },
    tutorials: {
      enabled: incoming?.tutorials?.enabled ?? d.tutorials.enabled,
      enabledTours:
        incoming?.tutorials?.enabledTours ?? [...d.tutorials.enabledTours],
      pdfGuideEnabled:
        incoming?.tutorials?.pdfGuideEnabled ?? d.tutorials.pdfGuideEnabled,
    },
    courseSettings: {
      quiz: {
        moveOnlyOnCorrectAnswer:
          incoming?.courseSettings?.quiz?.moveOnlyOnCorrectAnswer ??
          d.courseSettings.quiz.moveOnlyOnCorrectAnswer,
        celebrateOnQuizComplete:
          incoming?.courseSettings?.quiz?.celebrateOnQuizComplete ??
          d.courseSettings.quiz.celebrateOnQuizComplete,
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
    concentration: {
      enabled:
        incoming?.concentration?.enabled ?? d.concentration.enabled,
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
    postLoginRedirectRoute:
      incoming?.postLoginRedirectRoute ?? d.postLoginRedirectRoute,
  };

  seedExploreCtaVisibility(out, incoming);

  out.sidebar.tabs.sort((a, b) => (a.order || 0) - (b.order || 0));
  out.sidebar.tabs.forEach((t) =>
    t.subTabs?.sort((a, b) => (a.order || 0) - (b.order || 0))
  );
  out.dashboard.widgets.sort((a, b) => (a.order || 0) - (b.order || 0));
  out.courseDetails.tabs.sort((a, b) => (a.order || 0) - (b.order || 0));
  out.allCourses.tabs.sort((a, b) => (a.order || 0) - (b.order || 0));
  return out;
}

function readCacheForInstitute(
  instituteId: string | null | undefined
): StudentDisplaySettingsData | null {
  if (!instituteId) return null;
  try {
    const raw = localStorage.getItem(`${LS_KEY}:${instituteId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      ts: number;
      data: StudentDisplaySettingsData;
    };
    return parsed?.ts && Date.now() - parsed.ts <= ONE_DAY_MS
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

async function writeCacheForInstitute(
  instituteId: string | null | undefined,
  data: StudentDisplaySettingsData
): Promise<void> {
  if (!instituteId) return;
  try {
    localStorage.setItem(
      `${LS_KEY}:${instituteId}`,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch {
    // noop
  }
}

/**
 * Re-apply the UI-skin class on <html> from a settings object. Mirrors
 * __root.tsx's applyUiType (which handles initial page load); this exported
 * variant exists so post-login forced refreshes can swap the skin without a
 * hard reload — otherwise an in-SPA logout → login into a different
 * institute keeps the previous institute's skin class until F5.
 * Honors the DEBUG_UI_TYPE localStorage override used for QA.
 */
export function applyUiSkinFromSettings(
  settings: StudentDisplaySettingsData | null | undefined
): void {
  try {
    const override = localStorage.getItem("DEBUG_UI_TYPE");
    if (
      override === "default" ||
      override === "vibrant" ||
      override === "play" ||
      override === "cleanerPlay" ||
      override === "corporate"
    ) {
      return; // QA override wins; __root's debug helpers manage it
    }
    // THEME_SETTING.roles.skin wins; ui.type is the pre-migration fallback.
    const t = resolveUiSkin(settings?.ui?.type ?? null);
    const root = document.documentElement;
    root.classList.remove(
      "ui-vibrant",
      "ui-play",
      "ui-cleaner-play",
      "ui-corporate"
    );
    if (t === "vibrant") root.classList.add("ui-vibrant");
    else if (t === "play") root.classList.add("ui-play");
    else if (t === "cleanerPlay") root.classList.add("ui-cleaner-play");
    else if (t === "corporate") root.classList.add("ui-corporate");
  } catch {
    // noop — never let skin application break a login flow
  }
}

// Course-details alone reads settings from three components at once; on a
// cold localStorage cache each would fire its own network GET. Share one
// in-flight request per institute (non-forced reads only).
const inFlightSettingsByInstitute = new Map<
  string,
  Promise<StudentDisplaySettingsData>
>();

export async function getStudentDisplaySettings(
  forceRefresh = false,
  instituteId?: string
): Promise<StudentDisplaySettingsData> {
  const id = await getInstituteId();
  if (!instituteId) instituteId = id ?? "";
  // Try institute-aware cache first
  if (!forceRefresh) {
    const cached = readCacheForInstitute(instituteId);
    // Force add concentration defaults if missing in cache (migration)
    if (cached && !cached.concentration) {
      cached.concentration = DEFAULT_STUDENT_DISPLAY_SETTINGS.concentration;
      // Update cache immediately
      writeCacheForInstitute(instituteId, cached);
    }
    if (cached) return mergeWithDefaults(cached);

    const inFlight = inFlightSettingsByInstitute.get(instituteId);
    if (inFlight) return inFlight;
    const request = fetchAndCacheStudentDisplaySettings(
      instituteId,
      forceRefresh
    );
    inFlightSettingsByInstitute.set(instituteId, request);
    request.finally(() => {
      if (inFlightSettingsByInstitute.get(instituteId!) === request) {
        inFlightSettingsByInstitute.delete(instituteId!);
      }
    });
    return request;
  }
  return fetchAndCacheStudentDisplaySettings(instituteId, forceRefresh);
}

// Session memo + in-flight dedupe for the unauthenticated read.
const publicSettingsByInstitute = new Map<string, StudentDisplaySettingsData>();
const inFlightPublicSettingsByInstitute = new Map<
  string,
  Promise<StudentDisplaySettingsData>
>();

/**
 * Pre-login read of an institute's student display settings.
 *
 * `getStudentDisplaySettings()` resolves the institute through `getInstituteId()`,
 * which needs an access token — so on public screens (course catalogue) it
 * silently falls back to DEFAULTS and every toggle reads as its default value.
 * This variant takes the institute explicitly and goes through the `/open/**`
 * endpoint, so a gate like `signup.enabled: false` actually takes effect before
 * anyone has logged in.
 *
 * Memoised per institute for the session, deduped while in flight, and the
 * endpoint itself is `@ClientCacheable(300s, PUBLIC)`. Results are written to
 * the shared per-institute cache so the authenticated reader benefits too.
 * Any failure yields defaults — a public page must never break because a
 * settings read did.
 */
export async function getPublicStudentDisplaySettings(
  instituteId: string | null | undefined
): Promise<StudentDisplaySettingsData> {
  if (!instituteId) return DEFAULT_STUDENT_DISPLAY_SETTINGS;

  const memo = publicSettingsByInstitute.get(instituteId);
  if (memo) return memo;

  const cached = readCacheForInstitute(instituteId);
  if (cached) return mergeWithDefaults(cached);

  const inFlight = inFlightPublicSettingsByInstitute.get(instituteId);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const res = await authenticatedAxiosInstance.get<
        StudentDisplaySettingsData | null
      >(OPEN_STUDENT_DISPLAY_SETTINGS, { params: { instituteId } });
      // The open endpoint returns the setting's `data` object directly (null
      // when the institute never configured it), not the `{ data }` envelope
      // the authenticated endpoint uses.
      const serverData = res.data;
      const merged = mergeWithDefaults(
        serverData && Object.keys(serverData).length
          ? serverData
          : DEFAULT_STUDENT_DISPLAY_SETTINGS
      );
      await writeCacheForInstitute(instituteId, merged);
      publicSettingsByInstitute.set(instituteId, merged);
      return merged;
    } catch {
      return DEFAULT_STUDENT_DISPLAY_SETTINGS;
    }
  })();

  inFlightPublicSettingsByInstitute.set(instituteId, request);
  request.finally(() => {
    if (inFlightPublicSettingsByInstitute.get(instituteId) === request) {
      inFlightPublicSettingsByInstitute.delete(instituteId);
    }
  });
  return request;
}

async function fetchAndCacheStudentDisplaySettings(
  instituteId: string,
  forceRefresh: boolean
): Promise<StudentDisplaySettingsData> {
  if (!instituteId) {
    const defaults = DEFAULT_STUDENT_DISPLAY_SETTINGS;
    await writeCacheForInstitute(null, defaults);
    return defaults;
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
    await writeCacheForInstitute(instituteId, merged);
    // Forced refreshes are the post-login path (all 8 call sites) — swap the
    // skin class right away so a new institute's skin applies without F5.
    if (forceRefresh) applyUiSkinFromSettings(merged);
    return merged;
  } catch {
    const defaults = DEFAULT_STUDENT_DISPLAY_SETTINGS;
    await writeCacheForInstitute(instituteId, defaults);
    if (forceRefresh) applyUiSkinFromSettings(defaults);
    return defaults;
  }
}

export async function saveStudentDisplaySettings(
  settings: StudentDisplaySettingsData
): Promise<void> {
  const instituteId = await getInstituteId();
  if (!instituteId) return;
  const requestData = {
    setting_name: "Student Display Settings",
    setting_data: settings,
  };
  await authenticatedAxiosInstance.post(
    `${BASE_URL}/admin-core-service/institute/setting/v1/save-setting`,
    requestData,
    {
      params: { instituteId, settingKey: STUDENT_DISPLAY_SETTINGS_KEY },
      headers: { "Content-Type": "application/json" },
    }
  );
  // Immediately refresh to ensure cache reflects any backend-side transformations
  try {
    const res = await authenticatedAxiosInstance.get<{
      data: StudentDisplaySettingsData | null;
    }>(`${BASE_URL}/admin-core-service/institute/setting/v1/get`, {
      params: { instituteId, settingKey: STUDENT_DISPLAY_SETTINGS_KEY },
    });
    const merged = mergeWithDefaults(res.data?.data || settings);
    await writeCacheForInstitute(instituteId, merged);
  } catch {
    await writeCacheForInstitute(instituteId, settings);
  }
}

export function clearStudentDisplaySettingsCache(): void {
  try {
    // Clear all institute-specific keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${LS_KEY}:`)) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (error) {
    console.error("Error clearing student display settings cache:", error);
  }
}

export async function getAuthSettings({ details }: { details: string }) {
  const studentDisplaySettings = getStudentDisplaySettingsFromInsitituteDetails(
    details || "{}"
  );
  if (!studentDisplaySettings) return { google: false, github: false };
  const providers = studentDisplaySettings.signup.providers;
  return providers;
}

function getStudentDisplaySettingsFromInsitituteDetails(
  settings: string
  /* eslint-disable-next-line */
): any | null {
  try {
    const data = JSON.parse(settings);

    // Access STUDENT_DISPLAY_SETTINGS safely with optional chaining
    return data?.setting?.STUDENT_DISPLAY_SETTINGS.data ?? null;
  } catch (error) {
    console.error("Invalid JSON:", error);
    return null;
  }
}

export { mergeWithDefaults };
