import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openInBrowser } from "@/lib/open-in-browser";
import { formatDate } from "@/lib/formatters";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { fetchStaticData } from "./-lib/utils";
import { Helmet } from "react-helmet";
import { useAnalytics } from "@/hooks/useAnalytics";
import {
  getPackageSessionId,
  getAllPackageSessionIds,
} from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import { getStudyLibraryQuery } from "@/services/study-library/getStudyLibraryDetails";
import { useStudyLibraryStore } from "@/stores/study-library/use-study-library-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DashbaordResponse,
  DashboardSlide,
} from "./-types/dashboard-data-types";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { PastLearningInsights } from "./-components/PastLearningInsights";
import { useInstituteFeatureStore } from "@/stores/insititute-feature-store";
import { useLiveSessions } from "../study-library/live-class/-hooks/useLiveSessions";
import { HOLISTIC_INSTITUTE_ID } from "@/constants/urls";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ModernCard } from "@/components/design-system/modern-card";
import {
  BookOpen,
  Users,
  Trophy,
  Calendar,
  Clock,
  Play,
  Bell,
  CheckCircle,
  XCircle,
  MinusCircle,
  Hourglass,
  CaretRight,
  Sparkle,
  VideoCamera,
} from "@phosphor-icons/react";
import { SessionDetails } from "../study-library/live-class/-types/types";
import { isBbbSession, openBbbJoinForLearner } from "@/lib/live-class/bbb-join";
import { useMarkAttendance } from "../study-library/live-class/-hooks/useMarkAttendance";
import { SessionStreamingServiceType } from "../register/live-class/-types/enum";
import { toast } from "sonner";
import {
  getTerminology,
  getTerminologyPlural,
  readEngagementPlanFlag,
  writeEngagementPlanFlag,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { useWeeklyAttendanceQuery } from "@/services/attendance/getWeeklyAttendance";
import type { StudentDashboardWidgetConfig } from "@/types/student-display-settings";
import { DEFAULT_STUDENT_DISPLAY_SETTINGS } from "@/constants/display-settings/student-defaults";
import { DashboardPinsPanel } from "@/components/announcements";
import { RaiseQueryCard } from "./-components/RaiseQueryCard";
import { useServerTime } from "@/hooks/use-server-time";
import {
  convertSessionTimeToUserTimezone,
  formatSessionTimeInUserTimezone,
} from "@/utils/timezone";
import { StatCard } from "./-components/DashboardStatCard";
import type { StatCardLayout } from "./-components/DashboardStatCard";
import { ContinueLearningCard } from "./-components/DashboardContinueLearningCard";
import { DashboardHero } from "./-components/DashboardHero";
import { PlayDashboardHero } from "./-components/play/PlayDashboardHero";
import { CleanerPlayDashboardHero } from "./-components/play/CleanerPlayDashboardHero";
import { cn } from "@/lib/utils";
import { getChatbotSettings } from "@/services/chatbot-settings";
import { MyMembershipWidget } from "./-components/MyMembershipWidget";
import { MyBooksWidget } from "./-components/MyBooksWidget";
import { MyOrdersWidget } from "./-components/MyOrdersWidget";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { UpcomingLiveClassesWidget } from "./-components/UpcomingLiveClassesWidget";
import { Preferences } from "@capacitor/preferences";
import { AttendanceWidget } from "./-components/AttendanceWidget";
import { MyMentorsWidget } from "./-components/MyMentorsWidget";
import { GetAppWidget } from "./-components/GetAppWidget";
import cleanerIconCourses from "@/assets/cleaner-play/icon-courses.webp";
import cleanerIconAssessments from "@/assets/cleaner-play/icon-assessments.webp";
import cleanerIconLive from "@/assets/cleaner-play/icon-live-sessions.webp";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import { usePlayGamificationStore } from "@/stores/play-gamification-store";
import {
  applyServerPoints,
  computeGamificationData,
  findNewlyUnlockedSince,
  readCelebrationBaseline,
  setCachedGamification,
  shouldCelebrateBadge,
  writeCelebrationBaseline,
} from "@/services/play-gamification";
import { getUserId } from "@/constants/getUserId";
import { celebrateMilestone } from "@/lib/play-celebration";
import { BadgeVisual } from "./-components/badge-icons";
import { syncBadgeUnlocks } from "@/services/badge-sync";
import {
  getBadgeConfig,
  configNeedsAssessmentScore,
  configNeedsLiveSession,
  getScoringConfig,
} from "@/services/badge-config";
import { fetchBestAssessmentScorePct } from "@/services/assessment-score";
import { fetchLiveAttendanceStats } from "@/services/live-attendance-stats";
import { fetchAwardedBadges } from "@/services/awarded-badges";
import { fetchLast7DaysProgress } from "./-lib/utils";
import { EnrolledCoursesWidget } from "./-components/EnrolledCoursesWidget";
import { StreakCounterWidget } from "./-components/play/StreakCounterWidget";
import { XpDisplayWidget } from "./-components/play/XpDisplayWidget";
import { AchievementBadgesWidget } from "./-components/play/AchievementBadgesWidget";
import { DashboardGamificationPanel } from "./-components/DashboardGamificationPanel";
import { EngagementTaskHostProvider } from "./-components/engagement/EngagementTaskHost";
import { TodayModule } from "./-components/engagement/TodayModule";
import { useEngagementFeed } from "./-components/engagement/use-engagement-feed";
import type { DailyTaskProgress } from "./-components/play/useDashboardHeroData";
import { useMediaQuery } from "@/hooks/use-media-query";
import { fetchPointsSummary, pointsMeKey, useCurrentInstituteId } from "@/services/points";
import { StudyCompanionsShelf } from "./-components/StudyCompanionsShelf";
import { TncModal } from "@/components/Dashboards/LearnerDashboard/TncModal";
import type { BatchForSessionType } from "@/stores/study-library/institute-schema";
import {
  ONBOARDING_INSTANCES_QUERY_KEY,
  OnboardingStepForm,
} from "../profile/onboarding/-components/onboarding-step-form";
import { OnboardingProgressList } from "../profile/onboarding/-components/onboarding-progress-list";
import {
  getCurrentStepInfo,
  getMyOnboardingInstances,
  type OnboardingInstanceDTO,
} from "../profile/onboarding/-services/onboarding-services";
import { getInstituteId } from "@/constants/helper";

export const Route = createFileRoute("/dashboard/")({
  component: () => {
    return (
      <LayoutContainer>
        <DashboardOnboardingGate />
      </LayoutContainer>
    );
  },
});

/**
 * Gates the dashboard on any pending onboarding step the caller can actually
 * act on: while one exists, the learner sees that step's form here instead of
 * the full dashboard. Once it's submitted (or there simply isn't one — no
 * onboarding started, already completed, or the only pending step needs an
 * admin), this frees up and mounts the real dashboard. The dashboard's own
 * (expensive) data fetches only start once this resolves, so a blocked
 * learner doesn't pay for dashboard queries they can't see yet.
 */
function DashboardOnboardingGate() {
  const { t } = useTranslation("dashboard");
  // Resolved the same way as the standalone /onboarding page (getInstituteId(), not the
  // domain-routing store): that store only gets populated once useDomainRouting's async
  // resolution completes, which can still be in flight on a fresh page load, and starts
  // `null` either way -- there is no way to tell "not yet known" from "genuinely absent"
  // from the store alone. Without an explicit resolving flag, the gate below would fall
  // through to <DashboardComponent /> during that window (its query stays disabled while
  // instituteId is null) and flash the real dashboard before the onboarding check can run.
  const [instituteId, setInstituteId] = useState<string | null>(null);
  const [isResolvingInstitute, setIsResolvingInstitute] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await getInstituteId();
      if (!cancelled) {
        setInstituteId(id ?? null);
        setIsResolvingInstitute(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { data: instances, isLoading } = useQuery({
    queryKey: [ONBOARDING_INSTANCES_QUERY_KEY, instituteId],
    queryFn: () => getMyOnboardingInstances(instituteId as string),
    enabled: Boolean(instituteId),
    staleTime: 30 * 1000,
  });

  const withCurrentStep = (instances ?? [])
    .map((instance) => ({ instance, current: getCurrentStepInfo(instance) }))
    .filter(
      (entry): entry is { instance: OnboardingInstanceDTO; current: NonNullable<ReturnType<typeof getCurrentStepInfo>> } =>
        entry.current !== null
    );
  const pending = withCurrentStep.find((entry) => entry.current.isActionable);
  // Nothing the learner can act on right now, but there IS a step in progress that needs
  // their admin -- surface that instead of just silently freeing straight into the full
  // dashboard, so it's clear WHY onboarding "disappeared" rather than looking abandoned.
  const waitingOnAdmin = !pending
    ? withCurrentStep.find((entry) => !entry.current.isActionable)
    : undefined;

  if (isResolvingInstitute || (Boolean(instituteId) && isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (pending) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-section px-1 py-6">
        <div>
          <h1 className="text-h3 font-semibold text-neutral-700">
            {pending.instance.subject_full_name
              ? t("onboardingGate.finishSetupWithName", { name: pending.instance.subject_full_name })
              : t("onboardingGate.finishSetupGeneric")}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {t("onboardingGate.completeStepsPrompt")}
          </p>
        </div>
        <OnboardingStepForm stepInstance={pending.current.step} onSubmitted={() => {}} />
        <ModernCard className="space-y-2" variant="outlined" padding="md" rounded="lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {t("onboardingGate.progressLabel")}
          </p>
          <OnboardingProgressList stepInstances={pending.instance.step_instances} />
        </ModernCard>
      </div>
    );
  }

  return (
    <>
      {waitingOnAdmin && (
        <div className="flex items-center justify-center gap-2 border-b border-warning-200 bg-warning-50 px-4 py-2.5 text-center text-sm text-warning-700">
          <Hourglass size={16} weight="fill" />
          <span>
            <strong>&ldquo;{waitingOnAdmin.current.step.step_name}&rdquo;</strong>{" "}
            {t("onboardingGate.waitingOnAdminSuffix")}
          </span>
        </div>
      )}
      <DashboardComponent />
    </>
  );
}

export function DashboardComponent() {
  const { t } = useTranslation("dashboard");
  const { t: tEngagement } = useTranslation("dashboardEngagement");
  const [username, setUsername] = useState<string | null>(null);
  const [testAssignedCount, setTestAssignedCount] = useState<number>(0);
  // Count kept in state only because fetchStaticData's signature requires the setter.
  const [, setHomeworkAssignedCount] = useState<number>(0);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [allBatchIds, setAllBatchIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { showForInstitutes } = useInstituteFeatureStore();
  const { mutateAsync: markAttendance } = useMarkAttendance();
  const { setNavHeading } = useNavHeadingStore();
  const navigate = useNavigate();
  const { setStudyLibraryData } = useStudyLibraryStore();
  const [data, setData] = useState<DashbaordResponse | null>(null);
  const { setActiveItem } = useContentStore();
  const { getUserTimezone } = useServerTime();
  const isPlayTheme = usePlayTheme();
  const isCleanerPlayTheme = useCleanerPlayTheme();
  const { setData: setGamificationData } = usePlayGamificationStore();
  const { instituteId } = useInstituteFeatureStore();
  const queryClient = useQueryClient();
  // Today module slot (D3/D4): lg and up = the rail, chosen from the screen
  // width and a remembered "has a plan" flag, never from the async feed, so
  // the main column does not reflow when the feed lands. `use-mobile` breaks
  // at 768, which is the wrong line here.
  const isLgScreen = useMediaQuery("(min-width: 1024px)");
  const [rememberedPlan, setRememberedPlan] = useState<boolean>(() =>
    readEngagementPlanFlag(instituteId)
  );

  // Fetch study library data with React Query (5-minute cache)
  const { data: studyLibraryData, fetchStatus: studyLibraryFetchStatus } = useQuery(
    getStudyLibraryQuery(batchId)
  );

  // Add weekly attendance query
  const { data: weeklyAttendance, isLoading: isLoadingAttendance } =
    useWeeklyAttendanceQuery();
  const {
    data: liveSessions,
    isLoading: isLoadingLiveSessions,
    refetch: refetchLiveSessions,
  } = useLiveSessions(allBatchIds, { size: 10 });

  // Initialize analytics tracking
  const { trackPageView, track, trackLessonStarted } = useAnalytics();
  const [widgetConfigs, setWidgetConfigs] = useState<
    StudentDashboardWidgetConfig[] | null
  >(null);

  // ── Derived view-model for the hero band and header ────────────────────────

  // Hero contract: pass live + upcoming merged; the heroes classify
  // live vs imminent internally — do not pre-filter here.
  const mergedLiveSessions = useMemo(
    () => [
      ...(liveSessions?.live_sessions ?? []),
      ...(liveSessions?.upcoming_sessions ?? []),
    ],
    [liveSessions]
  );

  // Sessions whose timezone-aware start falls on today's calendar date.
  const classesTodayCount = useMemo(() => {
    const now = new Date();
    return mergedLiveSessions.filter((session) => {
      try {
        const start = session.timezone
          ? convertSessionTimeToUserTimezone(
              session.meeting_date,
              session.start_time,
              session.timezone
            )
          : new Date(`${session.meeting_date}T${session.start_time}`);
        return (
          !Number.isNaN(start.getTime()) &&
          start.getFullYear() === now.getFullYear() &&
          start.getMonth() === now.getMonth() &&
          start.getDate() === now.getDate()
        );
      } catch {
        return false;
      }
    }).length;
  }, [mergedLiveSessions]);

  // Any course with progress > 0 — splits first-run from returning learners.
  const hasAnyProgress = useMemo(
    () =>
      (studyLibraryData ?? []).some(
        (subject) => (subject.percentage_completed ?? 0) > 0
      ),
    [studyLibraryData]
  );
  // Loaded when the query resolved OR when the page settled without a batch
  // (zero-enrollment learners must reach the first-run hero, not a forever-skeleton).
  const studyLibraryLoaded = Boolean(studyLibraryData) || !isLoading;

  const userInitials = useMemo(() => {
    const words = (username ?? "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "U";
    const first = words[0]?.charAt(0) ?? "";
    const last =
      words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : "";
    return (first + last).toUpperCase() || "U";
  }, [username]);

  const greetingText = useMemo(() => {
    const firstName = (username ?? "").trim().split(/\s+/)[0] ?? "";
    if (!firstName) return t("hero.greeting.welcomeBackFallback");
    const hour = new Date().getHours();
    const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    const capitalizedName = `${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}`;
    return t(`hero.greeting.${period}WithName`, { name: capitalizedName });
  }, [username, t]);

  // Update Zustand store when React Query data changes
  useEffect(() => {
    if (studyLibraryData) {
      setStudyLibraryData(studyLibraryData);
    }
  }, [studyLibraryData, setStudyLibraryData]);

  const handleResumeClick = async (slide: DashboardSlide) => {
    // Track lesson resumed
    trackLessonStarted(slide.slide_id, slide.slide_title, slide.subject_id);

    track("Resume Learning", {
      slideId: slide.slide_id,
      slideTitle: slide.slide_title,
      subjectId: slide.subject_id,
      moduleId: slide.module_id,
      chapterId: slide.chapter_id,
      sourceType: slide.source_type,
    });

    setActiveItem({
      id: slide.slide_id,
      source_id: "",
      source_type: slide.source_type,
      title: slide.slide_title,
      image_file_id: "",
      description: slide.slide_description,
      status: slide.status,
      slide_order: 0,
      is_loaded: false,
      new_slide: false,
      percentage_completed: 0,
      progress_marker: slide.progress_marker,
    });

    // The slides route needs both courseId (= package_id) and sessionId
    // (= package_session_id) to load the surrounding Subject/Module/Chapter
    // tree. The dashboard API returns package_id + level_id per slide; we
    // resolve the matching package_session_id from the institute's batch
    // list stored in Preferences. Without this, the slide viewer opens but
    // the sidebar tree can't hydrate.
    let sessionId = slide.package_session_id || "";
    if (!sessionId) {
      try {
        const instituteDetailsStr = await Preferences.get({ key: "InstituteDetails" });
        const institute = instituteDetailsStr.value ? JSON.parse(instituteDetailsStr.value) : null;
        const batches: BatchForSessionType[] | null = institute?.batches_for_sessions ?? null;
        const match = batches?.find(
          (b) => b.package_dto?.id === slide.package_id && b.level?.id === slide.level_id
        );
        sessionId = match?.id || "";
        if (!sessionId) {
          // Fall back to the currently selected batch — usually the right one
          // for single-batch learners.
          sessionId = (await getPackageSessionId()) || "";
        }
      } catch {
        sessionId = (await getPackageSessionId()) || "";
      }
    }

    navigate({
      to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
      search: {
        courseId: slide.package_id,
        levelId: slide.level_id,
        subjectId: slide.subject_id,
        moduleId: slide.module_id,
        chapterId: slide.chapter_id,
        slideId: slide.slide_id,
        sessionId,
      },
    });
  };

  useEffect(() => {
    // Student Display Settings: paint from cache, then correct from the server.
    //
    // The force-refresh result used to be discarded while a separate effect read
    // the 24h localStorage cache — so an admin's widget change only landed on the
    // learner's NEXT dashboard visit ("I turned the widget off but it's still
    // showing"). The forced call now owns widgetConfigs.
    //
    // The cached read stays, but only to fill the gap before the network
    // resolves: while widgetConfigs is null every widget counts as visible, so
    // going network-only would flash widgets the institute has hidden. The
    // `prev ?? ` guard means it can never clobber a forced result that already
    // landed, whichever order the two settle in.
    getStudentDisplaySettings(false)
      .then((s) =>
        setWidgetConfigs((prev) => prev ?? (s?.dashboard?.widgets || []))
      )
      .catch(() => { });
    getStudentDisplaySettings(true)
      .then((s) => setWidgetConfigs(s?.dashboard?.widgets || []))
      .catch(() => { });
    getChatbotSettings(true).catch(() => { });

    const fetchIds = async () => {
      try {
        const id = await getPackageSessionId();
        setBatchId(id);

        const ids = await getAllPackageSessionIds();
        setAllBatchIds(ids);
      } catch (error) {
        console.error("Error fetching IDs:", error);
      }
    };
    fetchIds();
  }, [trackPageView, setNavHeading]);

  const OPT_IN_WIDGETS: Set<StudentDashboardWidgetConfig["id"]> = new Set(["myOrders"]);

  const isWidgetVisible = (id: StudentDashboardWidgetConfig["id"]) => {
    const cfg = widgetConfigs?.find((w) => w.id === id);
    if (!cfg) return !OPT_IN_WIDGETS.has(id);
    return cfg.visible !== false;
  };

  const getWidgetOrder = (id: StudentDashboardWidgetConfig["id"]) => {
    const cfg = widgetConfigs?.find((w) => w.id === id);
    // An id missing from a saved config takes its code default (todayTasks
    // leads its column), not "last".
    return (
      cfg?.order ??
      DEFAULT_STUDENT_DISPLAY_SETTINGS.dashboard.widgets.find((w) => w.id === id)?.order ??
      Number.MAX_SAFE_INTEGER
    );
  };

  // Hoisted to a stable boolean because the gamification EFFECT below depends
  // on it (isWidgetVisible is re-created every render and can't go in deps).
  const showGamification = isWidgetVisible("gamification");

  const customWidget = widgetConfigs?.find(
    (w) => w.id === "custom" && w.visible !== false
  );

  // ── Today's daily tasks (engagement plan) ──────────────────────────────────
  const showTodayTasks =
    isWidgetVisible("todayTasks") && !showForInstitutes([HOLISTIC_INSTITUTE_ID]);
  // Same query (and key) the Today module reads, so this costs no extra call.
  const { feed: engagementFeed, status: engagementStatus } = useEngagementFeed({
    enabled: showTodayTasks,
  });
  const engagementInstituteId = useCurrentInstituteId();
  // Remember whether a plan runs (for the next visit's slot and the sidebar's
  // "Daily tasks" entry). A confirmed "no plan" also releases a rail that was
  // held only for the module.
  useEffect(() => {
    if (engagementFeed === undefined || !engagementInstituteId) return;
    writeEngagementPlanFlag(engagementInstituteId, engagementFeed !== null);
    if (engagementFeed === null) setRememberedPlan(false);
  }, [engagementFeed, engagementInstituteId]);
  // Hero daily goal = today's tasks done / scheduled while a plan runs.
  const dailyTaskProgress: DailyTaskProgress | null =
    engagementFeed && engagementFeed.scheduledToday > 0
      ? { done: engagementFeed.completedToday, scheduled: engagementFeed.scheduledToday }
      : null;
  // Rail slot when the rail exists anyway, or when a plan is remembered.
  // (These ids must match railWidgets below.)
  const railHasOtherWidgets = (
    ["upcomingLiveClasses", "thisWeekAttendance", "myMentors", "getApp"] as const
  ).some((id) => isWidgetVisible(id));
  const todayInRail = showTodayTasks && isLgScreen && (railHasOtherWidgets || rememberedPlan);
  // Mount the module (and so its skeleton / error card) only for a learner who
  // has, or last had, a plan. Most institutes run none: without this gate every
  // dashboard load flashed a skeleton that then collapsed, which below lg
  // shifted Continue Learning up (a main-column reflow). A first-ever plan
  // appears once when the feed lands; from then on the flag holds its slot.
  const todayMounted =
    showTodayTasks && (engagementFeed != null || (engagementStatus !== "ready" && rememberedPlan));

  useEffect(() => {
    if (batchId) {
      const interval = setInterval(() => {
        refetchLiveSessions();
      }, 60000);
      return () => clearInterval(interval);
    }
  }, [batchId, refetchLiveSessions]);

  // Its own effect with `t`: run once on mount, the title could be set before
  // the translations loaded and stay as the raw key.
  useEffect(() => {
    setNavHeading(t("dashboardPage.pageTitle"));
  }, [setNavHeading, t]);

  useEffect(() => {
    const initializeDashboard = async () => {
      setIsLoading(true);
      try {
        await Promise.all([
          fetchStaticData(
            setUsername,
            setTestAssignedCount,
            setHomeworkAssignedCount,
            setData
          ),
        ]);

        // Track dashboard page view
        trackPageView("Dashboard");
      } catch (error) {
        console.error("Error initializing dashboard:", error);
      } finally {
        setIsLoading(false);
      }
    };
    initializeDashboard();
  }, [setNavHeading, trackPageView]);

  // Refresh gamification data (badges / XP / streak) once dashboard data is ready.
  // Runs for EVERY theme: the Play theme renders the play widgets while all other
  // themes render DashboardGamificationPanel — both read from the same store.
  // Skipped entirely when the institute has hidden the block: the work below is
  // half a dozen requests (badge config, awarded badges, assessment score, live
  // attendance stats) feeding a store nothing would render.
  useEffect(() => {
    if (!data || !instituteId || !showGamification) return;

    const refreshGamification = async () => {
      try {
        // Fetch 30 days of activity for streak calculation
        const now = new Date();
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const userId = ""; // fetched inside fetchLast7DaysProgress from stored details
        const activities = await fetchLast7DaysProgress({
          user_id: userId,
          start_date: thirtyDaysAgo.toISOString().slice(0, 10),
          end_date: now.toISOString().slice(0, 10),
        });

        // Admin-configured badge definitions + awarded badges + points scoring.
        const [badgeConfig, awardedBadges, scoring] = await Promise.all([
          getBadgeConfig(),
          fetchAwardedBadges(),
          getScoringConfig(),
        ]);
        // Fetch the assessment score only when a badge OR the points scoring needs it.
        const needAssessment =
          configNeedsAssessmentScore(badgeConfig) || scoring.assessmentBestScore > 0;
        const bestAssessmentScorePct = needAssessment
          ? await fetchBestAssessmentScorePct()
          : null;

        // Live-class attendance is only needed when a live-session badge is configured.
        const liveStats = configNeedsLiveSession(badgeConfig)
          ? await fetchLiveAttendanceStats()
          : { count: 0, streak: 0 };

        // Celebrations compare against the baseline of the last COMPLETE run, never the
        // display cache: this effect re-runs as each input query lands, and an early run
        // without the course tree / attendance computes completion- and XP-based badges as
        // locked, which would otherwise read as "newly unlocked" on every fresh session.
        // "Settled" = the study-library query is not fetching (success, error or disabled)
        // and attendance has loaded.
        const inputsSettled = studyLibraryFetchStatus === "idle" && !isLoadingAttendance;
        const learnerId = await getUserId();
        const baseline = inputsSettled ? readCelebrationBaseline(instituteId, learnerId) : null;

        // points_ledger is the authoritative source for points AND the streak.
        // Fetched through the shared ['points','me'] query so the widgets and
        // the pill reuse it; null (offline, older server) falls back to the
        // browser-computed figures.
        // Keyed by the id usePointsSummary resolves (getInstituteId), so this
        // run and the widgets share ONE cache entry even before the feature
        // store has its instituteId.
        const pointsInstituteId = instituteId || (await getInstituteId()) || null;
        const serverPoints = await queryClient
          .fetchQuery({
            queryKey: pointsMeKey(pointsInstituteId),
            queryFn: () => fetchPointsSummary(pointsInstituteId),
            staleTime: 60_000,
          })
          .catch(() => null);
        const serverStreak =
          typeof serverPoints?.currentStreak === "number"
            ? {
                currentStreak: serverPoints.currentStreak,
                longestStreak: serverPoints.longestStreak ?? null,
              }
            : null;

        const computed = computeGamificationData({
          dashboard: data,
          activities,
          attendance: weeklyAttendance ?? null,
          instituteId,
          badgeConfig,
          studyLibrary: studyLibraryData ?? null,
          bestAssessmentScorePct,
          awardedBadges,
          scoring,
          liveSessionCount: liveStats.count,
          liveSessionStreak: liveStats.streak,
          // One streak everywhere (D9): the server's, so the streak points line
          // and the streak badge agree with every streak display.
          serverStreak,
        });

        // The figures above are computed in THIS browser, so they can never
        // agree with a leaderboard; overlay the server's totals, level,
        // breakdown and streak when it answered (D2).
        const gamificationData = applyServerPoints(computed, serverPoints);

        // Cache the FINAL figures (after the server overlay) for pages that read
        // the cache on a fresh load; compute no longer writes it (D2).
        setCachedGamification(instituteId, gamificationData);
        setGamificationData(gamificationData);

        // Celebration moment: confetti once + one toast per badge that unlocked
        // since the last complete run (guarded once per badge id per tab). Only a
        // settled run may celebrate or advance the baseline; no baseline = first load → quiet.
        const newlyUnlocked =
          inputsSettled && gamificationData.badgesEnabled
            ? findNewlyUnlockedSince(baseline, gamificationData).filter((b) =>
                shouldCelebrateBadge(b.id)
              )
            : [];
        if (inputsSettled) {
          writeCelebrationBaseline(instituteId, learnerId, gamificationData);
        }
        if (newlyUnlocked.length > 0) {
          celebrateMilestone();
          newlyUnlocked.forEach((badge) => {
            toast.custom(
              (toastId) => (
                <button
                  type="button"
                  onClick={() => toast.dismiss(toastId)}
                  className="flex w-full items-center gap-3 rounded-xl border border-primary-100 bg-card p-3 text-start shadow-lg [.ui-play_&]:rounded-play-card-sm [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-gold-soft [.ui-cleaner-play_&]:border-transparent [.ui-cleaner-play_&]:bg-cp-gold-tint"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-100 [.ui-play_&]:bg-play-gold [.ui-cleaner-play_&]:bg-cp-gold">
                    <BadgeVisual
                      icon={badge.icon}
                      fill
                      weight="fill"
                      size={26}
                      className="text-primary-500 [.ui-play_&]:text-white [.ui-cleaner-play_&]:text-white"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                      {badge.isAdminAwarded
                        ? t("badges.celebrateAwardedTitle")
                        : t("badges.celebrateTitle")}
                    </span>
                    <span className="block truncate text-body font-bold text-foreground">
                      {badge.name}
                    </span>
                    {badge.isAdminAwarded && badge.awardReason ? (
                      <span className="block truncate text-caption text-muted-foreground">
                        {badge.awardReason}
                      </span>
                    ) : null}
                  </span>
                </button>
              ),
              { duration: 6000 }
            );
          });
        }

        // Persist auto-unlocked badges server-side so they show on the leaderboards
        // (best-effort, throttled per institute inside the service).
        if (instituteId) {
          const toSync = gamificationData.badges
            .filter((b) => b.unlocked && !b.isAdminAwarded)
            .map((b) => ({
              badgeId: b.id,
              badgeName: b.name,
              badgeIcon: b.icon,
              badgeDescription: b.description,
            }));
          void syncBadgeUnlocks(instituteId, toSync);
        }
      } catch (error) {
        console.error("Failed to compute gamification data:", error);
      }
    };

    refreshGamification();
  }, [
    data,
    weeklyAttendance,
    isLoadingAttendance,
    instituteId,
    studyLibraryData,
    studyLibraryFetchStatus,
    setGamificationData,
    showGamification,
    queryClient,
    t,
  ]);

  const handleJoinSession = async (session: SessionDetails) => {
    // Track live session join attempt
    track("Live Session Join Attempted", {
      sessionId: session.session_id,
      sessionTitle: session.title,
      scheduleId: session.schedule_id,
      streamingType: session.session_streaming_service_type,
      meetingDate: session.meeting_date,
      startTime: session.start_time,
    });

    const now = new Date();
    const sessionDate = new Date(
      `${session.meeting_date}T${session.start_time}`
    );
    const waitingRoomStart = new Date(sessionDate);
    waitingRoomStart.setMinutes(
      waitingRoomStart.getMinutes() - session.waiting_room_time
    );

    let convertedSessionDate = sessionDate;
    try {
      if (session.timezone) {
        convertedSessionDate = convertSessionTimeToUserTimezone(
          session.meeting_date,
          session.start_time,
          session.timezone
        );
      }
    } catch (error) {
      console.error("Error converting session time for comparison:", error);
    }

    const isInWaitingRoom =
      now >= waitingRoomStart && now < convertedSessionDate;
    const isInMainSession = now >= convertedSessionDate;
    // PRE_JOINING sessions join the live class directly during the
    // waiting-room window instead of entering the waiting-room screen.
    const isPreJoining = session.waiting_room_type === "PRE_JOINING";

    if (isInWaitingRoom && !isPreJoining) {
      track("Live Session Waiting Room Entered", {
        sessionId: session.session_id,
        sessionTitle: session.title,
      });
      navigate({
        to: "/study-library/live-class/waiting-room",
        search: { sessionId: session.schedule_id },
      });
    } else if (isInMainSession || (isInWaitingRoom && isPreJoining)) {
      try {
        await markAttendance({
          sessionId: session.session_id,
          scheduleId: session.schedule_id,
          userSourceType: "USER",
          userSourceId: "",
          details: "Joined live class directly",
        });

        track("Live Session Joined Successfully", {
          sessionId: session.session_id,
          sessionTitle: session.title,
          streamingType: session.session_streaming_service_type,
          joinMethod:
            session.session_streaming_service_type ===
              SessionStreamingServiceType.EMBED
              ? "embed"
              : "external_link",
        });

        if (isBbbSession(session.link_type)) {
          // BBB: open the personalized join URL (real name + userId). Checked FIRST
          // so BBB never routes to the embed page (which can't resolve a BBB room →
          // "Unsupported session type") or the shared generic meeting_link.
          await openBbbJoinForLearner(session.schedule_id);
        } else if (
          session.session_streaming_service_type ===
          SessionStreamingServiceType.EMBED
        ) {
          navigate({
            to: "/study-library/live-class/embed",
            search: {
              sessionId: session.schedule_id,
              learnerButtonConfig: session.learner_button_config ?? undefined,
            },
          });
        } else {
          await openInBrowser(session.meeting_link);
        }
      } catch (error) {
        console.error("Failed to mark attendance:", error);
        toast.error(t("dashboardPage.toast.attendanceMarkFailed"));

        if (isBbbSession(session.link_type)) {
          // BBB: open the personalized join URL (real name + userId). Checked FIRST
          // so BBB never routes to the embed page (which can't resolve a BBB room →
          // "Unsupported session type") or the shared generic meeting_link.
          await openBbbJoinForLearner(session.schedule_id);
        } else if (
          session.session_streaming_service_type ===
          SessionStreamingServiceType.EMBED
        ) {
          navigate({
            to: "/study-library/live-class/embed",
            search: {
              sessionId: session.schedule_id,
              learnerButtonConfig: session.learner_button_config ?? undefined,
            },
          });
        } else {
          await openInBrowser(session.meeting_link);
        }
      }
    }
  };

  const liveClassSingular = getTerminology(
    ContentTerms.LiveSession,
    SystemTerms.LiveSession
  );
  const liveClassPlural = getTerminologyPlural(
    ContentTerms.LiveSession,
    SystemTerms.LiveSession
  );
  // This week's attended class days out of its class days (the attendance
  // "streak" is gone: the dashboard has one streak, the server's; D9).
  const weekClassDays = (weeklyAttendance?.days ?? []).filter(
    (d) => d.status !== "NO_CLASS"
  ).length;
  const weekPresentDays = (weeklyAttendance?.days ?? []).filter(
    (d) => d.status === "PRESENT"
  ).length;
  // One useful header fact: classes today, else this week's attendance, else none.
  const headerFact =
    classesTodayCount > 0
      ? t("dashboardPage.classesToday", {
          count: classesTodayCount,
          liveClass: (classesTodayCount === 1
            ? liveClassSingular
            : liveClassPlural
          ).toLowerCase(),
        })
      : weekPresentDays > 0
        ? tEngagement("attendanceWeek.summary", {
            present: weekPresentDays,
            count: weekClassDays,
            liveClass: (weekClassDays === 1
              ? liveClassSingular
              : liveClassPlural
            ).toLowerCase(),
          })
        : null;

  const heroProps = {
    userName: username,
    liveSessions: mergedLiveSessions,
    isLoadingLive: isLoadingLiveSessions,
    hasAnyProgress,
    studyLibraryLoaded,
    onJoinSession: handleJoinSession,
  };
  // Play / cleanerPlay heroes carry the streak and the daily-goal ring.
  const playHeroProps = {
    ...heroProps,
    showGamification,
    taskProgress: dailyTaskProgress,
  };

  // ── Curated 2/3 + 1/3 layout ────────────────────────────────────────────────
  // Column assignment is fixed by the redesign; institutes' saved widget
  // orders still sort widgets within their column.

  // `render` is a factory (not a prebuilt element) because the card's internal
  // layout depends on how many cards survive the institute's flags — which is
  // only known once this array has been filtered.
  const statCards: Array<{
    id: StudentDashboardWidgetConfig["id"];
    render: (layout: StatCardLayout) => JSX.Element;
  }> = [
    {
      id: "coursesStat" as const,
      render: (layout: StatCardLayout) => (
        <StatCard
          layout={layout}
          title={getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)}
          count={data?.courses}
          icon={BookOpen}
          onClick={() => {
            track("Dashboard Card Clicked", {
              cardType: "Courses",
              count: data?.courses || 0,
            });
            navigate({ to: "/study-library/courses" });
          }}
          isLoading={isLoading}
          emptyActionLabel={t("dashboardPage.statCard.coursesEmptyAction", {
            courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course),
          })}
          className="stat-card-courses [.ui-vibrant_&]:bg-primary-50 [.ui-vibrant_&]:border-primary-100 [.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300"
          iconClassName="[.ui-vibrant_&]:bg-primary-100 [.ui-vibrant_&]:text-primary-500 [.ui-play_&]:bg-white/70 [.ui-play_&]:text-play-info-soft-ink [.ui-play_&]:ring-0"
          cleanerIllustrationSrc={cleanerIconCourses}
        />
      ),
    },
    {
      id: "liveClasses" as const,
      render: (layout: StatCardLayout) => (
        <StatCard
          layout={layout}
          title={getTerminologyPlural(
            ContentTerms.LiveSession,
            SystemTerms.LiveSession
          )}
          count={liveSessions?.live_sessions?.length}
          icon={Play}
          onClick={() => navigate({ to: "/study-library/live-class" })}
          isLoading={isLoadingLiveSessions}
          emptyActionLabel={t("dashboardPage.statCard.liveClassesEmptyAction", {
            liveClasses: getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession),
          })}
          className="stat-card-live [.ui-vibrant_&]:bg-primary-50 [.ui-vibrant_&]:border-primary-100 [.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300"
          iconClassName="[.ui-vibrant_&]:bg-primary-100 [.ui-vibrant_&]:text-primary-500 [.ui-play_&]:bg-white/70 [.ui-play_&]:text-play-navy-soft-ink [.ui-play_&]:ring-0"
          cleanerIllustrationSrc={cleanerIconLive}
        />
      ),
    },
    {
      id: "evaluationStat" as const,
      render: (layout: StatCardLayout) => (
        <StatCard
          layout={layout}
          title={t("dashboardPage.statCard.assessmentsTitle")}
          count={testAssignedCount}
          icon={Trophy}
          onClick={() => {
            track("Dashboard Card Clicked", {
              cardType: "Evaluations",
              count: testAssignedCount,
            });
            navigate({ to: "/assessment/examination" });
          }}
          isLoading={isLoading}
          emptyActionLabel={t("dashboardPage.statCard.assessmentsEmptyAction")}
          className="stat-card-assessments [.ui-vibrant_&]:bg-primary-50 [.ui-vibrant_&]:border-primary-100 [.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300"
          iconClassName="[.ui-vibrant_&]:bg-primary-100 [.ui-vibrant_&]:text-primary-500 [.ui-play_&]:bg-white/70 [.ui-play_&]:text-play-accent-soft-ink [.ui-play_&]:ring-0"
          cleanerIllustrationSrc={cleanerIconAssessments}
        />
      ),
    },
  ]
    .filter((w) => isWidgetVisible(w.id))
    .sort((a, b) => getWidgetOrder(a.id) - getWidgetOrder(b.id));

  // The stats row tracks how many cards actually survived the institute's
  // widget flags. Hard-coding sm:grid-cols-3 left an institute that shows only
  // one stat (e.g. Live Sessions) with a third-width card and two empty
  // columns; a lone card becomes a full-width row instead.
  const statGridColsClass =
    statCards.length >= 3
      ? "sm:grid-cols-3"
      : statCards.length === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-1";
  const statCardLayout: StatCardLayout =
    statCards.length === 1 ? "row" : "stack";

  // The rail is "on screen" only when some rail widget is switched on AND one
  // of them actually rendered (most return null on a quiet day). Measured from
  // the DOM below; while it is empty the main column takes the full width.
  const railRef = useRef<HTMLDivElement>(null);
  const [railHasContent, setRailHasContent] = useState(true);

  // MAIN column (lg:col-span-2): continue learning, stats row, progress
  // insights, custom widget, commerce. Commerce is hidden for the play
  // (K-12) audience.
  const mainColumnWidgets = [
    {
      // Below lg (or with no rail at all): right under the hero, collapsed.
      id: "todayTasks" as const,
      order: getWidgetOrder("todayTasks"),
      visible: todayMounted && !todayInRail,
      render: <TodayModule slot="main" showGamification={showGamification} />,
    },
    {
      id: "continueLearning" as const,
      order: getWidgetOrder("continueLearning"),
      visible: isWidgetVisible("continueLearning"),
      render: (
        <ContinueLearningCard
          data={data}
          onResumeClick={handleResumeClick}
          isLoading={isLoading}
          hasAnyProgress={hasAnyProgress}
        />
      ),
    },
    {
      id: "enrolledCourses" as const,
      order: getWidgetOrder("enrolledCourses"),
      visible: isWidgetVisible("enrolledCourses"),
      render: <EnrolledCoursesWidget />,
    },
    {
      id: "statsRow" as const,
      order: statCards.length
        ? Math.min(...statCards.map((w) => getWidgetOrder(w.id)))
        : Number.MAX_SAFE_INTEGER,
      visible: statCards.length > 0,
      render: (
        <div
          className={cn(
            "grid grid-cols-1 gap-3 sm:gap-4",
            statGridColsClass,
            // Play skins pair the cards two-up on phones; with a single card
            // there is nothing to pair, so keep it one-up.
            statCards.length > 1 &&
              "max-sm:[.ui-cleaner-play_&]:grid-cols-2 max-sm:[.ui-play_&]:grid-cols-2 max-sm:[.ui-cleaner-play_&]:[&>*:last-child:nth-child(odd)]:col-span-2 max-sm:[.ui-play_&]:[&>*:last-child:nth-child(odd)]:col-span-2"
          )}
        >
          {statCards.map((w) => (
            <div key={w.id}>{w.render(statCardLayout)}</div>
          ))}
        </div>
      ),
    },
    {
      id: "learningAnalytics" as const,
      order: getWidgetOrder("learningAnalytics"),
      visible: isWidgetVisible("learningAnalytics"),
      render: <PastLearningInsights />,
    },
    {
      id: "custom" as const,
      order: getWidgetOrder("custom"),
      visible: Boolean(customWidget),
      render: customWidget ? (
        <Card
          className={cn(
            "transition-shadow",
            "[.ui-vibrant_&]:border-primary/20",
            "[.ui-vibrant_&]:bg-gradient-to-br [.ui-vibrant_&]:from-card [.ui-vibrant_&]:to-primary/5"
          )}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              {customWidget.title || t("dashboardPage.customWidgetFallbackTitle")}
            </CardTitle>
            {customWidget.subTitle && (
              <CardDescription>{customWidget.subTitle}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {customWidget.link && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const link = customWidget.link as string;
                  if (/^https?:\/\//.test(link)) {
                    window.open(link, "_blank");
                  } else {
                    navigate({ to: link as never });
                  }
                }}
                className="w-full justify-between"
              >
                {t("dashboardPage.openButton")} <CaretRight size={14} />
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null,
    },
    {
      id: "myMembership" as const,
      order: getWidgetOrder("myMembership"),
      visible: !isPlayTheme && isWidgetVisible("myMembership"),
      render: <MyMembershipWidget />,
    },
    {
      id: "myBooks" as const,
      order: getWidgetOrder("myBooks"),
      visible: !isPlayTheme && isWidgetVisible("myBooks"),
      render: <MyBooksWidget />,
    },
    {
      id: "myOrders" as const,
      order: getWidgetOrder("myOrders"),
      visible: !isPlayTheme && isWidgetVisible("myOrders"),
      render: <MyOrdersWidget />,
    },
  ]
    .filter((w) => w.visible && w.render)
    .sort((a, b) => a.order - b.order);

  // RAIL column (lg:col-span-1): pins panel renders first (always on),
  // then the configurable rail widgets.
  const railWidgets = [
    {
      // lg and up: first in the rail (default order 0.5).
      id: "todayTasks" as const,
      order: getWidgetOrder("todayTasks"),
      visible: todayMounted && todayInRail,
      render: <TodayModule slot="rail" showGamification={showGamification} />,
    },
    {
      id: "upcomingLiveClasses" as const,
      order: getWidgetOrder("upcomingLiveClasses"),
      visible: isWidgetVisible("upcomingLiveClasses"),
      render: (
        <UpcomingLiveClassesWidget
          liveSessions={liveSessions?.live_sessions || []}
          upcomingSessions={liveSessions?.upcoming_sessions || []}
          isLoading={isLoadingLiveSessions}
          onJoinSession={handleJoinSession}
        />
      ),
    },
    {
      id: "thisWeekAttendance" as const,
      order: getWidgetOrder("thisWeekAttendance"),
      visible: isWidgetVisible("thisWeekAttendance"),
      render: <AttendanceWidget />,
    },
    {
      id: "myMentors" as const,
      order: getWidgetOrder("myMentors"),
      visible: isWidgetVisible("myMentors"),
      render: <MyMentorsWidget />,
    },
    {
      id: "getApp" as const,
      order: getWidgetOrder("getApp"),
      visible: isWidgetVisible("getApp"),
      // Self-hides when the institute has no app link configured, so an
      // institute can leave this on without it ever showing an empty card.
      render: <GetAppWidget />,
    },
  ]
    .filter((w) => w.visible)
    .sort((a, b) => a.order - b.order);

  // With every rail widget switched off there is nothing to reserve a third of
  // the page for. The pins panel is not a reason to keep the column: it only
  // renders when the institute has live announcements, so it would strand an
  // empty rail on most days — it moves to the top of the main column instead.
  const hasRail = railWidgets.length > 0;
  const showRail = hasRail && railHasContent;
  // Re-checked whenever a rail widget mounts, loads or empties itself.
  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const check = () => setRailHasContent(Array.from(el.children).some((c) => c.childNodes.length > 0));
    check();
    const observer = new MutationObserver(check);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [hasRail]);

  return (
    // One task runner for the whole page, mounted ABOVE the Today module so a
    // resize that moves the module between slots never drops an open runner.
    <EngagementTaskHostProvider showGamification={showGamification}>
    <div className="min-h-screen bg-background relative overflow-hidden w-full dashboard-container smooth-scroll">
      <Helmet>
        <title>
          {typeof document !== "undefined" && document.title
            ? document.title
            : t("dashboardPage.pageTitle")}
        </title>
        <meta
          name="description"
          content={t("dashboardPage.metaDescription")}
        />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
      </Helmet>

      {/* Render T&C Modal if ask_for_tnc is true */}
      {data?.ask_for_tnc && data?.tnc_url && (
        <TncModal
          tncUrl={data.tnc_url}
          prefillName={data.tnc_prefill_name ?? false}
          onAccepted={() => {
            setData(prev => prev ? { ...prev, ask_for_tnc: false } : prev);
          }}
        />
      )}

      <div className="relative z-10 space-y-4 p-3 sm:p-4 lg:p-6 mx-auto w-full max-w-7xl animate-in fade-in duration-500">
        {/* Header — default/vibrant only; the play / cleaner-play hero carries its own greeting */}
        {!isPlayTheme && !isCleanerPlayTheme && (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center space-x-3">
              {/* Corporate drops the letter-avatar: the account avatar already
                  sits in the top bar, and a second big initial disc beside the
                  greeting is a consumer-app cue. */}
              <Avatar className="h-10 w-10 sm:h-12 sm:w-12 border-2 border-background shadow-sm [.ui-corporate_&]:hidden">
                <AvatarFallback className="bg-primary-100 text-lg font-semibold text-primary-500">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <h1 className="text-h2 sm:text-h1 tracking-tight text-foreground [.ui-corporate_&]:text-h3 [.ui-corporate_&]:sm:text-h2 [.ui-corporate_&]:font-semibold">
                  {isLoading ? (
                    <Skeleton className="h-8 w-48" />
                  ) : (
                    <span>{greetingText}</span>
                  )}
                </h1>
                {showForInstitutes([HOLISTIC_INSTITUTE_ID]) ? (
                  <p className="mt-1 flex items-center gap-2 text-muted-foreground">
                    <Sparkle size={16} className="text-primary" />
                    <span>{t("dashboardPage.yogaGreeting")}</span>
                  </p>
                ) : headerFact ? (
                  <p className="mt-1 text-caption text-muted-foreground">
                    {headerFact}
                  </p>
                ) : null}
              </div>
            </div>

            <p className="text-caption text-muted-foreground">
              {formatDate(new Date(), {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        )}

        {!showForInstitutes([HOLISTIC_INSTITUTE_ID]) && (
          <>
            {/* Hero — owns the live-class banner and resume / first-run band */}
            {isCleanerPlayTheme ? (
              <CleanerPlayDashboardHero {...playHeroProps} />
            ) : isPlayTheme ? (
              <PlayDashboardHero {...playHeroProps} />
            ) : (
              // Passed only here: the play / cleaner-play heroes have no
              // first-run checklist to suppress (they render a greeting band
              // regardless of progress), so the flag has nothing to act on there.
              <DashboardHero
                {...heroProps}
                showGettingStarted={isWidgetVisible("gettingStarted")}
              />
            )}

            {/* Main 2/3 + 1/3 layout. The rail's third is only reserved when
                the institute actually left rail widgets on — otherwise the
                main column runs full width instead of stranding an empty
                column beside it.

                Widget wrappers are `empty:hidden` because several widgets
                decide at runtime that they have nothing to show and return
                null (no sessions in the next 24h, no memberships, reader-mode
                commerce) — the `w.visible && w.render` filter can't see that,
                since `w.render` is a non-null element either way. The wrapper
                then survived as a zero-height div that still collected a
                space-y margin, leaving a phantom gap. `display: none`
                generates no box at all, so the margin stops applying. */}
            <div
              className={cn(
                "grid grid-cols-1 gap-4 lg:gap-6 items-start",
                showRail && "lg:grid-cols-3"
              )}
            >
              <div
                className={cn(
                  "space-y-4 lg:space-y-6",
                  showRail && "lg:col-span-2"
                )}
              >
                {/* Without a rail, announcements lead the main column */}
                {!hasRail && <DashboardPinsPanel maxPins={3} />}
                {/* Knowledge-base study companions. Renders null when the learner
                    has none, so the layout is unchanged for everyone else. */}
                <StudyCompanionsShelf />
                {mainColumnWidgets.map((w) => (
                  <div key={w.id} className="empty:hidden">
                    {w.render}
                  </div>
                ))}
              </div>

              {hasRail && (
                // Stays mounted while empty (hidden) so a widget that loads
                // something later brings the column back.
                <div
                  ref={railRef}
                  className={cn("space-y-4 lg:col-span-1 lg:space-y-6", !railHasContent && "hidden")}
                >
                  {/* Institute announcements pin to the top of the rail */}
                  <DashboardPinsPanel maxPins={3} />
                  {railWidgets.map((w) => (
                    <div key={w.id} className="empty:hidden">
                      {w.render}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Gamification (badges / XP / streak) — bottom of the main flow.
                Play theme keeps its vibrant play-token widgets; every other theme
                gets the standard design-token panel. Both sides sit behind the
                one "gamification" flag so hiding it is skin-independent. */}
            {showGamification &&
              (isPlayTheme ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
                  <StreakCounterWidget />
                  <XpDisplayWidget />
                  <AchievementBadgesWidget />
                </div>
              ) : (
                <DashboardGamificationPanel />
              ))}

            {/* General query intake — only when the institute enabled the dashboard card */}
            <RaiseQueryCard />

            {/* Developer Test Section - Only in development */}
            {process.env.NODE_ENV === "development" && (
              <Card className="border-dashed border-orange-300 bg-orange-50/50">
                <CardContent className="p-card flex items-center gap-4">
                  <div className="p-2 bg-orange-100 rounded-lg text-orange-600">
                    <Bell weight="duotone" size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-orange-900">
                      {t("dashboardPage.devTesting.title")}
                    </h3>
                    <p className="text-sm text-orange-700">
                      {t("dashboardPage.devTesting.description")}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Explore Buttons Section — commerce CTAs, hidden for the play
                (K-12) audience and in reader mode (iOS / reader-mode
                institutes, Apple 3.1.1).

                These have their OWN widget flags (exploreMemberships /
                exploreBooks) rather than riding myMembership / myBooks: an
                institute that wants the membership widget but not a
                "go buy more" CTA had no way to say so, and the row rendered
                its padding even when both buttons were hidden. */}
            {!isPlayTheme &&
              !shouldHidePaidPurchaseUI() &&
              (isWidgetVisible("exploreMemberships") ||
                isWidgetVisible("exploreBooks")) && (
                <div className="flex flex-wrap items-center justify-center gap-3 mt-4 pb-12 px-4">
                  {isWidgetVisible("exploreMemberships") && (
                    <Button
                      className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm flex items-center gap-2 py-2 px-6 h-9 text-xs font-bold"
                      onClick={() => {
                        sessionStorage.setItem("levelFilter", "rent");
                        navigate({ to: "/collections" as never });
                      }}
                    >
                      {t("dashboardPage.exploreMembershipsButton")}
                      <CaretRight size={14} />
                    </Button>
                  )}
                  {isWidgetVisible("exploreBooks") && (
                    <Button
                      className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm flex items-center gap-2 py-2 px-6 h-9 text-xs font-bold"
                      onClick={() => {
                        sessionStorage.setItem("levelFilter", "buy");
                        navigate({ to: "/collections" as never });
                      }}
                    >
                      {t("dashboardPage.exploreBooksButton")}
                      <CaretRight size={14} />
                    </Button>
                  )}
                </div>
              )}
          </>
        )}

        {showForInstitutes([HOLISTIC_INSTITUTE_ID]) && (
          <div className="space-y-6">
            {/* Institute announcements */}
            <DashboardPinsPanel maxPins={3} />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-section">
              {/* Hero Section */}
              <div className="lg:col-span-8">
                <Card className="h-full overflow-hidden border-0 shadow-sm relative bg-white">
                  <CardContent className="p-0 relative h-full flex items-center justify-center min-h-72">
                    <img
                      src="/yoga-dashboard.webp"
                      alt={t("dashboardPage.holistic.yogaIllustrationAlt")}
                      className="object-contain max-h-72"
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Attendance Section */}
              <div className="lg:col-span-4 space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-base">
                      <div className="flex items-center gap-2">
                        <CheckCircle
                          weight="duotone"
                          size={18}
                          className="text-primary"
                        />
                        <span>{t("dashboardPage.holistic.thisWeekTitle")}</span>
                      </div>
                      {weeklyAttendance?.weekRange && (
                        <span className="text-xs text-muted-foreground font-normal">
                          {weeklyAttendance.weekRange}
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-7 gap-1">
                      {isLoadingAttendance
                        ? [...Array(7)].map((_, i) => (
                          <div
                            key={i}
                            className="flex flex-col items-center gap-1 p-2 border rounded-md"
                          >
                            <Skeleton className="h-4 w-4 rounded-full" />
                            <Skeleton className="h-3 w-8" />
                          </div>
                        ))
                        : (weeklyAttendance?.days || []).map((dayData) => {
                          let Icon = Hourglass;
                          let colorClass = "text-muted-foreground";

                          switch (dayData.status) {
                            case "PRESENT":
                              Icon = CheckCircle;
                              colorClass = "text-green-500";
                              break;
                            case "ABSENT":
                              Icon = XCircle;
                              colorClass = "text-red-500";
                              break;
                            case "UNMARKED":
                              Icon = MinusCircle;
                              colorClass = "text-gray-400";
                              break;
                            case "PENDING":
                              Icon = Hourglass;
                              colorClass = "text-yellow-500";
                              break;
                            case "NO_CLASS":
                              Icon = Clock;
                              colorClass = "text-muted-foreground";
                              break;
                          }

                          return (
                            <div
                              key={dayData.day}
                              className={cn(
                                "flex flex-col items-center gap-1 p-2 border rounded-md text-center transition-colors",
                                dayData.status === "PENDING" ||
                                  dayData.status === "NO_CLASS"
                                  ? "opacity-60"
                                  : "bg-muted/10"
                              )}
                            >
                              <Icon
                                size={16}
                                className={colorClass}
                                weight="duotone"
                              />
                              <span className="text-caption font-medium text-muted-foreground truncate w-full">
                                {dayData.day}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-card flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                        <Users weight="duotone" size={20} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">
                          {t("dashboardPage.holistic.referFriendTitle")}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {t("dashboardPage.holistic.referFriendSubtitle")}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate({ to: "/referral" })}
                    >
                      {t("dashboardPage.holistic.inviteButton")}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Live Classes Section */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg text-green-600 dark:text-green-400">
                    <VideoCamera size={18} />
                  </div>
                  <div className="space-y-0.5">
                    <CardTitle className="text-base">{t("dashboardPage.holistic.myClassesTitle")}</CardTitle>
                    <CardDescription className="text-xs">
                      {getUserTimezone()}
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate({ to: "/study-library/live-class" })}
                >
                  {t("liveClasses.viewAll")} <CaretRight size={14} className="ms-1" />
                </Button>
              </CardHeader>
              <CardContent>
                {isLoadingLiveSessions ? (
                  <div className="space-y-3">
                    {[1, 2].map((i) => (
                      <div
                        key={i}
                        className="flex items-center gap-4 p-4 border rounded-lg"
                      >
                        <Skeleton className="h-10 w-10 rounded-lg" />
                        <div className="space-y-2 flex-1">
                          <Skeleton className="h-4 w-1/3" />
                          <Skeleton className="h-3 w-1/4" />
                        </div>
                        <Skeleton className="h-9 w-20" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {liveSessions?.live_sessions?.map((session, index) => (
                      <div
                        key={`live-${session.session_id}-${index}`}
                        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 border rounded-lg bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-900/50"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="p-2 bg-green-100 rounded-lg text-green-700">
                            <VideoCamera size={16} />
                          </div>
                          <div>
                            <h4 className="font-semibold text-sm truncate">
                              {session.title}
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              {formatSessionTimeInUserTimezone(
                                session.meeting_date,
                                session.start_time,
                                session.timezone
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                          <Badge
                            variant="default"
                            className="bg-green-600 hover:bg-green-700"
                          >
                            {t("dashboardPage.holistic.liveBadge")}
                          </Badge>
                          <Button
                            size="sm"
                            onClick={() => handleJoinSession(session)}
                          >
                            {t("dashboardPage.holistic.joinNowButton")}
                          </Button>
                        </div>
                      </div>
                    ))}

                    {liveSessions?.upcoming_sessions
                      ?.slice(0, 2)
                      .map((session, index) => (
                        <div
                          key={`upcoming-${session.session_id}-${index}`}
                          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 border rounded-lg"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="p-2 bg-blue-100 rounded-lg text-blue-700">
                              <Calendar weight="duotone" size={16} />
                            </div>
                            <div>
                              <h4 className="font-semibold text-sm truncate">
                                {session.title}
                              </h4>
                              <p className="text-xs text-muted-foreground">
                                {t("dashboardPage.holistic.dateAtTime", {
                                  date: formatDate(
                                    new Date(
                                      `${session.meeting_date}T${session.start_time}`
                                    ),
                                    {
                                      month: "short",
                                      day: "numeric",
                                    }
                                  ),
                                  time: formatSessionTimeInUserTimezone(
                                    session.meeting_date,
                                    session.start_time,
                                    session.timezone
                                  ),
                                })}
                              </p>
                            </div>
                          </div>
                          <Badge
                            variant="secondary"
                            className="bg-blue-100 text-blue-700 border-blue-200"
                          >
                            {t("liveClasses.upcomingBadge")}
                          </Badge>
                        </div>
                      ))}

                    {!liveSessions?.live_sessions?.length &&
                      !liveSessions?.upcoming_sessions?.length && (
                        <div className="text-center py-8">
                          <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-3">
                            <VideoCamera
                              size={20}
                              className="text-muted-foreground"
                            />
                          </div>
                          <h3 className="font-semibold text-sm">
                            {t("dashboardPage.holistic.noLiveClassesScheduled", {
                              liveClasses: getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession).toLowerCase(),
                            })}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1 mb-4">
                            {t("dashboardPage.holistic.checkBackLater")}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              navigate({ to: "/study-library/live-class" })
                            }
                          >
                            {t("dashboardPage.holistic.viewAllClassesButton")}
                          </Button>
                        </div>
                      )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* General query intake — only when the institute enabled the dashboard card */}
            <RaiseQueryCard />
          </div>
        )}
      </div>
    </div>
    </EngagementTaskHostProvider>
  );
}
