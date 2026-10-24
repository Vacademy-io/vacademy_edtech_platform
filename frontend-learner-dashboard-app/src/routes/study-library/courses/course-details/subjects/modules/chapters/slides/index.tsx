import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { useTranslation } from "react-i18next";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { toTitleCase } from "@/lib/utils";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import {
  CaretLeft,
  GraduationCap,
  CaretRight,
  CheckCircle,
  ArrowsIn,
  ArrowsOut,
  X,
} from "@phosphor-icons/react";
import { SlideMaterial } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/slide-material";
import {
  ChapterSidebarSlides,
  calculateOverallCompletion,
} from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/chapter-sidebar-slides";
import { CourseTreeSidebar } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/course-tree-sidebar";
import { LessonListSidebar } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/lesson-list-sidebar";
import {
  computeDisplayTitles,
  getSlideMeta,
  getSlideTitle,
} from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/slide-display-utils";
import { getModuleName } from "@/utils/study-library/get-name-by-id/getModuleNameById";
import { getSubjectName } from "@/utils/study-library/get-name-by-id/getSubjectNameById";
import { getChapterName } from "@/utils/study-library/get-name-by-id/getChapterById";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import useSidebarBranding from "@/components/common/layout-container/sidebar/useSidebar";
import { InitStudyLibraryProvider } from "@/providers/study-library/init-study-library-provider";
import { ModulesWithChaptersProvider } from "@/providers/study-library/modules-with-chapters-provider";
import { useSlides, Slide } from "@/hooks/study-library/use-slides";
import { useStudyLibraryStore } from "@/stores/study-library/use-study-library-store";
import { useModulesWithChaptersStore, ModulesWithChapters } from "@/stores/study-library/use-modules-with-chapters-store";
import { useDripConditionStore } from "@/stores/study-library/drip-conditions-store";
import { useCourseDripSchedule } from "@/hooks/use-course-drip-schedule";
import { useDripConditions } from "@/hooks/use-drip-conditions";
import {
  evaluateDripCondition,
  type LearnerProgressData,
} from "@/utils/drip-conditions";
import {
  shouldFilterItem,
  isItemLocked,
} from "@/components/drip-conditions/helpers";
import { useQuery } from "@tanstack/react-query";
import { GET_COURSE_DETAILS } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { handleGetCourseInit } from "@/routes/study-library/courses/course-details/-services/get-course-details";
import { getInstituteId } from "@/constants/helper";
import { fetchModulesWithChapters, fetchModulesWithChaptersPublic } from "@/services/study-library/getModulesWithChapters";
import { toast } from "sonner";
import FeedbackPage from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/FeedbackPage";
import { PencilSimple } from "@phosphor-icons/react";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import type { FeedbackTrigger } from "@/types/student-display-settings";
import { Preferences } from "@capacitor/preferences";
import { BatchForSessionType } from "@/stores/study-library/institute-schema";
import { getPublicUrl } from "@/services/upload_file";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getSlideCompletionThreshold } from "@/constants/study-library";
import { recordSlideVisit } from "@/services/resume-thread";
import { usePlayTheme } from "@/hooks/use-play-theme";
import {
  celebrateCompletion,
  celebrateMilestone,
  isStreakMilestone,
  shouldCelebrateSlide,
} from "@/lib/play-celebration";
import { usePlayGamificationStore } from "@/stores/play-gamification-store";
import { playIllustrations } from "@/assets/play-illustrations";

// sessionStorage key for the viewer's focus mode (per-tab persistence).
const SLIDES_FOCUS_MODE_KEY = "slides-viewer-focus-mode";

/**
 * QA override, mirroring DEBUG_UI_TYPE. Student Display Settings are cached in
 * localStorage for 24h per institute, so a change in the admin does not reach a
 * warm cache — and previewing a navigation mode should not require editing a
 * live institute's settings. Set `DEBUG_SLIDES_SIDEBAR_NAV` to "hidden",
 * "breadcrumb", "ancestors" or "lessons" and reload; remove the key to go back
 * to the institute's own configuration.
 */
type SidebarNavMode = "ancestors" | "breadcrumb" | "lessons" | "hidden";
const SIDEBAR_NAV_MODES: SidebarNavMode[] = [
  "ancestors",
  "breadcrumb",
  "lessons",
  "hidden",
];
function readDebugSidebarNav(): SidebarNavMode | null {
  try {
    const v = localStorage.getItem("DEBUG_SLIDES_SIDEBAR_NAV");
    return SIDEBAR_NAV_MODES.includes(v as SidebarNavMode)
      ? (v as SidebarNavMode)
      : null;
  } catch {
    return null;
  }
}

// ── Play celebration guards ──────────────────────────────────────────────────
// Once-per-chapter guard mirroring shouldCelebrateSlide, so the chapter volley
// fires only the first time a chapter completes in this tab (query refetches
// can briefly re-cross the threshold).
const CELEBRATED_CHAPTERS_KEY = "vacademy.celebratedChapters.v1";
const shouldCelebrateChapter = (chapterId: string): boolean => {
  if (!chapterId) return false;
  try {
    const seen: string[] = JSON.parse(
      sessionStorage.getItem(CELEBRATED_CHAPTERS_KEY) ?? "[]"
    );
    if (seen.includes(chapterId)) return false;
    sessionStorage.setItem(
      CELEBRATED_CHAPTERS_KEY,
      JSON.stringify([...seen.slice(-49), chapterId])
    );
    return true;
  } catch {
    return true;
  }
};

// Last streak value this tab has seen — lets the streak effect distinguish
// "streak just incremented to a milestone" from "streak was already there
// when the viewer opened" (only the former earns a volley).
const LAST_SEEN_STREAK_KEY = "vacademy.viewer.lastSeenStreak.v1";

// XP awarded per completed slide in the play gamification model — mirrors
// computeXp() in services/play-gamification.ts (slides viewed × 10).
const SLIDE_XP = 10;

interface ChapterSearchParams {
  courseId: string;
  levelId?: string;
  subjectId: string;
  moduleId: string;
  chapterId: string;
  slideId: string;
  sessionId: string;
  // Citation deep links from the chat: open a PDF at this page (1-based) or a
  // video / audio at this second. Applied once, then cleared from the URL.
  page?: number;
  t?: number;
}

// A deep-link number param: finite and positive, else dropped. Accepts the
// numeric strings a hand-edited URL can carry as well as parsed numbers.
const positiveNumberParam = (value: unknown): number | undefined => {
  const n =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
};

export const Route = createFileRoute(
  "/study-library/courses/course-details/subjects/modules/chapters/slides/"
)({
  component: Slides,
  validateSearch: (search: Record<string, unknown>): ChapterSearchParams => {
    const page = positiveNumberParam(search.page);
    const t = positiveNumberParam(search.t);
    return {
      courseId: search.courseId as string,
      levelId: search.levelId as string | undefined,
      subjectId: search.subjectId as string,
      moduleId: search.moduleId as string,
      chapterId: search.chapterId as string,
      slideId: search.slideId as string,
      sessionId: search.sessionId as string,
      // Pages are whole; a fractional page (2.5) means its page (2).
      ...(page !== undefined && page >= 1 && { page: Math.floor(page) }),
      ...(t !== undefined && { t }),
    };
  },
});

// ── Module Accordion Item ────────────────────────────────────────────────────
// Used inside the Module Switcher popover so each module manages its own
// expanded/collapsed state independently (hooks cannot be called in a .map()).
const ModuleAccordionItem = ({
  modData,
  isInitiallyExpanded,
  currentChapterId,
  onChapterSelect,
}: {
  modData: ModulesWithChapters;
  isInitiallyExpanded: boolean;
  currentChapterId: string;
  onChapterSelect: (moduleId: string, chapterId: string) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(isInitiallyExpanded);
  const completedChapters = modData.chapters.filter(
    (c) => c.percentage_completed >= getSlideCompletionThreshold()
  ).length;

  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* Module header — tap to expand/collapse */}
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className={`w-full flex items-center justify-between px-3 py-2.5 text-start transition-colors ${
          isInitiallyExpanded ? "bg-primary-50/40" : "hover:bg-gray-50"
        }`}
      >
        <div className="min-w-0 flex-1">
          <span
            className={`text-caption font-semibold leading-tight line-clamp-1 ${
              isInitiallyExpanded ? "text-primary-700" : "text-gray-700"
            }`}
          >
            {toTitleCase(modData.module.module_name)}
          </span>
          {modData.chapters.length > 0 && (
            <span className="text-caption text-gray-400 mt-0.5 block">
              {completedChapters}/{modData.chapters.length} {getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLowerCase()}
            </span>
          )}
        </div>
        <ChevronRightIcon
          className={`w-3 h-3 flex-shrink-0 ms-2 transition-transform duration-200 ${
            isExpanded ? "rotate-90 text-primary-500" : "text-gray-400"
          }`}
        />
      </button>

      {/* Chapter list */}
      {isExpanded && modData.chapters.length > 0 && (
        <div className="pb-1">
          {modData.chapters.map((chapter) => {
            const isCurrent = chapter.id === currentChapterId;
            const isDone = chapter.percentage_completed >= getSlideCompletionThreshold();
            return (
              <button
                key={chapter.id}
                onClick={() => onChapterSelect(modData.module.id, chapter.id)}
                className={`w-full text-start px-5 py-1.5 text-caption transition-colors flex items-center gap-2 ${
                  isCurrent
                    ? "bg-primary-50 text-primary-700 font-semibold"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                }`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    isCurrent
                      ? "bg-primary-500"
                      : isDone
                      ? "bg-success-400"
                      : "bg-gray-300"
                  }`}
                />
                <span className="truncate flex-1">
                  {toTitleCase(chapter.chapter_name)}
                </span>
                {isDone && !isCurrent && (
                  <CheckCircle
                    className="w-3 h-3 text-success-500 flex-shrink-0"
                    weight="fill"
                  />
                )}
                {isCurrent && (
                  <span className="text-caption font-bold text-primary-500 uppercase tracking-wide flex-shrink-0">
                    Now
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
// ────────────────────────────────────────────────────────────────────────────

function Slides() {
  const {
    courseId,
    levelId,
    subjectId,
    moduleId,
    chapterId,
    slideId,
    sessionId,
    page: deepLinkPage,
    t: deepLinkTime,
  } = Route.useSearch();

  const { setOpen: setAppSidebarOpen } = useSidebar();
  const navigate = useNavigate();

  // Citation deep link (?page / ?t) for the slide named in the URL. The viewer
  // applies it once when that slide is on screen; the params are then dropped
  // with a replace navigation so a refresh resumes from saved progress.
  const slideStartAt = useMemo(
    () =>
      slideId && (deepLinkPage !== undefined || deepLinkTime !== undefined)
        ? { slideId, page: deepLinkPage, t: deepLinkTime }
        : undefined,
    [slideId, deepLinkPage, deepLinkTime]
  );
  const handleSlideStartApplied = useCallback(() => {
    navigate({
      to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
      search: {
        courseId,
        levelId,
        subjectId,
        moduleId,
        chapterId,
        slideId,
        sessionId,
      },
      replace: true,
    });
  }, [navigate, courseId, levelId, subjectId, moduleId, chapterId, slideId, sessionId]);

  // Tracks the URL slideId the slide-selection effect last resolved against, so
  // a re-run can tell "the learner navigated (slideId changed)" apart from "the
  // slides cache just refreshed (slideId unchanged)". Prev/Next move the active
  // slide through the store WITHOUT touching the URL, so on a plain refetch the
  // effect must keep the store's slide instead of snapping back to the stale
  // URL slideId. Seeded to a sentinel so the very first run always resolves.
  const lastResolvedSlideIdRef = useRef<string | undefined>(undefined);
  const hasResolvedOnceRef = useRef(false);

  // Mirror the active slide into the URL when the learner uses Prev/Next, so the
  // course-tree sidebar (highlights by URL slideId) and a browser refresh track
  // the current slide. The search updater preserves every other param; replace
  // keeps slide stepping out of the back-button history.
  const handleNavigateToSlide = useCallback(
    (newSlideId: string) => {
      navigate({
        to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
        search: {
          courseId,
          levelId,
          subjectId,
          moduleId,
          chapterId,
          slideId: newSlideId,
          sessionId,
        },
        replace: true,
      });
    },
    [navigate, courseId, levelId, subjectId, moduleId, chapterId, sessionId]
  );

  const { data: packageSessionIdFromStore } = useQuery({
    queryKey: ["packageSessionId"],
    queryFn: async () => {
      const { getPackageSessionId } = await import("@/utils/study-library/get-list-from-stores/getPackageSessionId");
      return getPackageSessionId();
    },
  });
  const resolvedSessionId = sessionId || packageSessionIdFromStore || "";
  const {
    setItems,
    setActiveItem,
    activeItem,
    setSlideEvaluations,
    setCurrentPackageSessionId,
  } = useContentStore();

  // Keep the content store in sync with the course currently being viewed so
  // that doubts are raised/filtered against THIS course's package session
  // (the URL's sessionId), not the learner's default first enrollment.
  useEffect(() => {
    setCurrentPackageSessionId(resolvedSessionId || null);
  }, [resolvedSessionId, setCurrentPackageSessionId]);

  const { slides } = useSlides(chapterId || "");
  const { studyLibraryData } = useStudyLibraryStore();
  const { modulesWithChaptersData, setModulesWithChaptersData } = useModulesWithChaptersStore();

  // Get drip conditions from store or fetch from API
  const {
    getDripCondition,
    setDripCondition,
    clearDripCondition,
    isDrippingEnable,
  } = useDripConditionStore();

  const storedDripCondition = courseId ? getDripCondition(courseId) : null;

  // Fetch drip condition from API if not in store
  const { data: courseDetails } = useQuery({
    queryKey: ["course-details", courseId],
    queryFn: async () => {
      const response = await authenticatedAxiosInstance({
        method: "GET",
        url: GET_COURSE_DETAILS,
        params: {
          packageId: courseId,
        },
      });
      return response.data;
    },
    enabled: !!courseId && !storedDripCondition, // Only fetch if not in store
    staleTime: 3600000, // 1 hour
  });

  // Course-init response (same endpoint the outer course page uses) so the
  // breadcrumb subject picker reads from the authoritative sessions →
  // levelDetails → subjects tree. Resolves instituteId asynchronously.
  const [instituteId, setInstituteId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getInstituteId().then((id) => {
      if (!cancelled) setInstituteId(id || null);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const { data: courseInitData } = useQuery(
    handleGetCourseInit({
      courseId: courseId || "",
      instituteId: instituteId || "",
    })
  );

  // Save fetched drip condition to store
  useEffect(() => {
    if (courseDetails?.drip_condition_json && courseId) {
      const dripCondition =
        courseDetails.drip_condition_json ||
        courseDetails.dripConditionJson ||
        courseDetails.drip_condition ||
        courseDetails.dripCondition;

      if (dripCondition) {
        clearDripCondition(courseId); // Clear before setting
        setDripCondition(courseId, dripCondition);
      }
    }
  }, [courseDetails, courseId, setDripCondition, clearDripCondition]);

  // Use stored or fetched drip condition
  const dripConditionJson =
    storedDripCondition ||
    courseDetails?.drip_condition_json ||
    courseDetails?.dripConditionJson ||
    courseDetails?.drip_condition ||
    courseDetails?.dripCondition ||
    null;

  // Conditions the admin configured live in the institute's course settings,
  // not on the slide rows — same source the course page reads.
  const dripSchedule = useCourseDripSchedule(courseId, resolvedSessionId);
  const { conditionFor: dripConditionFor, now: dripNow } = dripSchedule;
  // Day-1 anchors for day-wise rules, spread into every LearnerProgressData
  // below.
  const dripAnchors = useMemo(
    () => ({
      enrollmentDate: dripSchedule.enrollmentDate,
      sessionStartDate: dripSchedule.sessionStartDate,
    }),
    [dripSchedule.enrollmentDate, dripSchedule.sessionStartDate],
  );

  const { condition: slideCondition } = useDripConditions(
    dripConditionJson,
    "slide"
  );

  const [showLearningPath, setShowLearningPath] = useState(true);
  const [feedbackVisible, setFeedbackVisible] = useState(true);
  // undefined = "follow the sidebar mode" (see collapseSidebarOnOpen in
  // student-display-settings). Resolved against sidebarNavigation below.
  const [collapseSidebarSetting, setCollapseSidebarSetting] = useState<
    boolean | undefined
  >(undefined);
  // undefined = "follow the sidebar mode" (see manualCompletion in
  // student-display-settings). Resolved against sidebarNavigation below.
  const [manualCompletionSetting, setManualCompletionSetting] = useState<
    boolean | undefined
  >(undefined);
  // Both tri-state, both resolved against the sidebar mode further down.
  const [chapterCompleteCtaSetting, setChapterCompleteCtaSetting] = useState<
    boolean | undefined
  >(undefined);
  const [feedbackInSlideNavSetting, setFeedbackInSlideNavSetting] = useState<
    boolean | undefined
  >(undefined);
  // When the feedback slide is offered. "CHAPTER" is today's cadence.
  const [feedbackTrigger, setFeedbackTrigger] =
    useState<FeedbackTrigger>("CHAPTER");
  // Loads the studyContent catalog for the chapter hand-off strings and
  // re-renders this route once it arrives.
  const { t } = useTranslation("studyContent");
  // "breadcrumb" = legacy per-chapter slide list; cross-module navigation
  // happens via the popovers in the breadcrumb. This is the default to keep
  // existing learners on familiar terrain — admins can opt into the richer
  // "ancestors" tree from Student Display Settings.
  const [sidebarNavigation, setSidebarNavigation] = useState<SidebarNavMode>(
    () => readDebugSidebarNav() ?? "breadcrumb"
  );
  // "hidden": no viewer sidebar at all — the learner moves through the course
  // with the Prev/Next controls in the slide header alone.
  const hideSlidesSidebar = sidebarNavigation === "hidden";

  // Whether the "Give Feedback" slide sits in the Prev/Next sequence. Unset
  // follows the sidebar mode: the sidebar-less viewer leaves it out so Next
  // rolls into the next chapter rather than a form the learner has no context
  // for, every other mode keeps today's behaviour.
  const feedbackInSlideNav = feedbackInSlideNavSetting ?? !hideSlidesSidebar;

  /**
   * Has the learner just crossed the boundary the institute wants feedback at?
   *
   * Every scope requires the current chapter to be finished; the wider ones
   * additionally require everything else in that scope to be done, so the ask
   * lands once per module / subject / course instead of once per chapter.
   *
   * The current chapter is treated as complete rather than read from the store:
   * modulesWithChaptersData is fetched separately and lags the completion we
   * have just computed from this chapter's own slides.
   */
  const feedbackBoundaryReached = useCallback(
    (chapterCompletion: number): boolean => {
      if (!feedbackVisible || feedbackTrigger === "NEVER") return false;
      // Never auto-open a form the learner cannot leave. With no sidebar AND
      // the feedback slide kept out of Prev/Next there is no control on screen
      // that moves off it — the buttons resolve against a list it isn't in.
      if (hideSlidesSidebar && !feedbackInSlideNav) return false;
      if (chapterCompletion !== 100) return false;
      if (feedbackTrigger === "CHAPTER") return true;

      const threshold = getSlideCompletionThreshold();
      const chapterDone = (c: { id: string; percentage_completed?: number }) =>
        c.id === chapterId || (c.percentage_completed || 0) >= threshold;
      const moduleDone = (m: ModulesWithChapters) =>
        (m.chapters?.length ?? 0) > 0 && (m.chapters ?? []).every(chapterDone);

      const modules = modulesWithChaptersData ?? [];
      if (feedbackTrigger === "MODULE") {
        const current = modules.find((m) => m.module.id === moduleId);
        return !!current && moduleDone(current);
      }

      // modulesWithChaptersData is scoped to the subject in the URL, so "every
      // module done" is exactly "this subject done".
      const subjectDone = modules.length > 0 && modules.every(moduleDone);
      if (feedbackTrigger === "SUBJECT") return subjectDone;

      // COURSE: this subject finished and every other subject already was.
      return (
        subjectDone &&
        (studyLibraryData ?? []).every(
          (sub) =>
            sub.id === subjectId || (sub.percentage_completed || 0) >= threshold
        )
      );
    },
    [
      feedbackVisible,
      feedbackTrigger,
      hideSlidesSidebar,
      feedbackInSlideNav,
      modulesWithChaptersData,
      studyLibraryData,
      chapterId,
      moduleId,
      subjectId,
    ]
  );

  /** One key per scope, so "ask once" means once per module / subject / course
   *  rather than once per chapter when a wider scope is configured. */
  const feedbackSeenKey = useCallback((): string => {
    switch (feedbackTrigger) {
      case "MODULE":
        return `feedback_seen_${courseId}_module_${moduleId}`;
      case "SUBJECT":
        return `feedback_seen_${courseId}_subject_${subjectId}`;
      case "COURSE":
        return `feedback_seen_${courseId}_course`;
      default:
        return `feedback_seen_${courseId}_${chapterId}`;
    }
  }, [feedbackTrigger, courseId, moduleId, subjectId, chapterId]);

  useEffect(() => {
    if (slides?.length) {
      const feedbackSlide: Slide = {
        id: "feedback-slide",
        title: "Give Feedback",
        source_type: "FEEDBACK",
        source_id: "",
        image_file_id: "",
        description: `Provide feedback for this ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLocaleLowerCase()}`,
        status: "ACTIVE",
        slide_order: slides.length + 1,
        percentage_completed: 0,
        is_loaded: true,
        new_slide: false,
        progress_marker: 0,
      };

      // Apply drip conditions to filter slides
      let accessibleSlides = slides;
      const evaluations: Record<
        string,
        { isLocked: boolean; isHidden: boolean; unlockMessage: string | null }
      > = {};

      // Build comprehensive prerequisite completions map with BOTH chapters and slides
      const prerequisiteCompletions: Record<string, number> = {};

      // 1. Add all chapters and their progress
      if (modulesWithChaptersData) {
        modulesWithChaptersData.forEach((module) => {
          module.chapters.forEach((chapter) => {
            // Calculate chapter progress from its slides (if available in current context)
            // For now, use 0 as default - will be updated when we have slide data loaded
            prerequisiteCompletions[chapter.id] = 0;
          });
        });
      }

      // 2. Add all slides from current chapter and their progress
      slides.forEach((slide: Slide) => {
        prerequisiteCompletions[slide.id] = slide.percentage_completed || 0;
      });

      // 3. Calculate chapter progress for current chapter based on its slides
      if (chapterId) {
        const chapterProgress = calculateOverallCompletion(slides);
        prerequisiteCompletions[chapterId] = chapterProgress;
      }

      // Evaluate drip conditions for each slide
      accessibleSlides = slides.filter((slide: Slide, index: number) => {
        const previousSlide = index > 0 ? slides[index - 1] : null;
        const progressData: LearnerProgressData = {
          percentageCompleted: slide.percentage_completed || 0,
          previousItemId: previousSlide?.id,
          previousItemCompletion: previousSlide?.percentage_completed || 0,
          itemIndex: index,
          prerequisiteCompletions,
          // Completion of every slide before this one, in slide_order.
          recentScores: slides
            .slice(0, index)
            .map((s: Slide) => s.percentage_completed || 0),
          ...dripAnchors,
        };

        // Check if this slide has its own drip condition (check both fields)
        let slideDripCondition = null;
        const dripConditionData =
          slide.drip_condition || slide.drip_condition_json;

        if (dripConditionData) {
          try {
            const parsed =
              typeof dripConditionData === "string"
                ? JSON.parse(dripConditionData)
                : dripConditionData;

            // Handle array of conditions - filter for enabled slide conditions
            if (Array.isArray(parsed)) {
              slideDripCondition =
                parsed.find(
                  (cond) =>
                    (cond.target === "slide" || !cond.target) &&
                    cond.is_enabled !== false
                ) || null;
            } else if (parsed && typeof parsed === "object") {
              // Single condition - check if enabled and for slides
              if (
                (parsed.target === "slide" || !parsed.target) &&
                parsed.is_enabled !== false
              ) {
                slideDripCondition = parsed;
              }
            }
          } catch (e) {
            console.error("Failed to parse slide drip condition:", e);
          }
        }

        // Admin-configured conditions win over anything stamped on the row.
        const configuredCondition = dripConditionFor("slide", slide.id);
        const conditionToUse =
          configuredCondition || slideDripCondition || slideCondition;
        const hasCondition =
          !!configuredCondition || !!slideDripCondition || !!slideCondition;

        // `isDrippingEnable` owns the original row-level path; a configured
        // condition has already cleared the new path's opt-in in conditionFor.
        const shouldEvaluate =
          (isDrippingEnable || !!configuredCondition) &&
          hasCondition &&
          conditionToUse?.is_enabled !== false;

        const evaluation =
          shouldEvaluate && conditionToUse
            ? evaluateDripCondition(
                conditionToUse,
                progressData,
                dripNow ? new Date(dripNow) : new Date(),
              )
            : {
              isLocked: false,
              isHidden: false,
              unlockMessage: null,
            };
        evaluations[slide.id] = evaluation; // Store evaluation for this slide
        const shouldHide = shouldFilterItem(evaluation);

        return !shouldHide; // Keep slide if not hidden
      });

      // Store evaluations for all accessible slides
      setSlideEvaluations(evaluations);

      // The "Give Feedback" slide is synthesised here, not returned by the
      // API. feedbackVisible used to hide only the sidebar BUTTON while the
      // slide stayed in `items` — so Prev/Next still walked into the feedback
      // form, and the completion auto-open below still fired. With the viewer
      // sidebar off that was the whole failure: Next from a one-slide chapter
      // landed on a feedback page instead of the next chapter.
      // Annotated: as a ternary this no longer infers from the feedbackSlide
      // literal the way the old spread did, and the widened element type left
      // every downstream .some()/.find() callback param implicitly any.
      const slidesWithFeedback: Slide[] = feedbackVisible && feedbackInSlideNav
        ? [...accessibleSlides, feedbackSlide]
        : accessibleSlides;
      setItems(slidesWithFeedback);

      const completion = calculateOverallCompletion(accessibleSlides);

      // Did this run start because the learner navigated (URL slideId changed)
      // or because the slides cache just refreshed (slideId unchanged)? Compare
      // against the last resolved value, then record the current one for the
      // next run. The first run for this component always counts as "changed".
      const slideIdChanged =
        !hasResolvedOnceRef.current || lastResolvedSlideIdRef.current !== slideId;
      hasResolvedOnceRef.current = true;
      lastResolvedSlideIdRef.current = slideId;

      // Priority 1: First-time chapter completion auto-opens the feedback slide
      // exactly once. This is the only auto-route allowed to override the slide
      // the learner is currently on. Returning visitors (feedback already seen)
      // intentionally fall through to the preserve-current-slide guard below
      // instead of being reset to the first slide on every refetch. The
      // !slideId gate keeps explicit deep links / sidebar navigation in control.
      if (!slideId && feedbackBoundaryReached(completion)) {
        const seenKey = feedbackSeenKey();
        const hasSeenFeedback = localStorage.getItem(seenKey);

        if (!hasSeenFeedback) {
          // First time this scope completes — offer feedback once.
          localStorage.setItem(seenKey, "true");
          setActiveItem(feedbackSlide);
          return;
        }
      }

      // Preserve the learner's current position across slides-cache refreshes.
      // When the URL slideId did NOT change, this run was triggered by a slides
      // refetch (progress heartbeats write to ["slides", chapterId] every few
      // seconds), NOT by navigation. Prev/Next and the default sidebar move the
      // active slide through the store without updating the URL, so re-resolving
      // here would snap the learner back to the stale URL slideId — the
      // bounce-back. If they already have a valid, unlocked slide selected, keep
      // it. When slideId DID change (deep link, play-theme sidebar), fall
      // through so Priority 2 honors the explicit navigation.
      if (!slideIdChanged) {
        const currentItem = useContentStore.getState().activeItem;
        if (currentItem) {
          // The feedback slide is synthetic and may deliberately be absent from
          // the list (feedbackInSlideNav off) while still being the open item,
          // so it counts as present or the next refetch would kick the learner
          // off the form mid-answer.
          const stillPresent =
            currentItem.id === "feedback-slide" ||
            slidesWithFeedback.some((s) => s.id === currentItem.id);
          const currentLocked =
            !!evaluations[currentItem.id] &&
            isItemLocked(evaluations[currentItem.id]);
          if (stillPresent && !currentLocked) return;
        }
      }

      // Priority 2: If user explicitly navigated to a specific slide via URL
      if (slideId) {
        const targetSlide = slidesWithFeedback.find((s) => s.id === slideId);
        if (targetSlide) {
          // Reuse the evaluation computed above rather than re-deriving it —
          // recomputing here indexed into the post-hide-filter list, which
          // skewed itemIndex whenever an earlier slide was hidden. The
          // synthesized feedback slide has no evaluation and is never locked.
          const evaluation = evaluations[targetSlide.id];

          if (evaluation && isItemLocked(evaluation)) {
            setActiveItem(slidesWithFeedback[0] ?? null);
            return;
          }

          setActiveItem(targetSlide);
          return;
        }
      }

      // Default: first slide. Reached on initial load / chapter change, or when
      // the previously active slide is no longer in the list. The preserve-
      // current-slide guard above already short-circuits plain cache refreshes.
      setActiveItem(slidesWithFeedback[0] ?? null);
    }
  }, [
    slides,
    slideId,
    setActiveItem,
    setItems,
    courseId,
    chapterId,
    slideCondition,
    setSlideEvaluations,
    isDrippingEnable,
    modulesWithChaptersData,
    feedbackVisible,
    feedbackInSlideNav,
    feedbackBoundaryReached,
    feedbackSeenKey,
    dripConditionFor,
    dripAnchors,
    dripNow,
  ]);

  const [moduleName, setModuleName] = useState("");
  const [chapterName, setChapterName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [courseName, setCourseName] = useState("");
  const [levelName, setLevelName] = useState("");
  const [instituteLogoUrl, setInstituteLogoUrl] = useState<string>("");
  // Identity for the panel header — the app sidebar's own header is suppressed
  // while this panel is mounted, so this is where the institute name now
  // appears. `hideInstituteName` is an operator branding switch, honoured here
  // exactly as it is there.
  //
  // Subscribed field by field ON PURPOSE. A bare `useStore()` subscribes to
  // the whole store, and every write to it allocates a new state object — so
  // this route would re-render, rebuild `SidebarComponent`, and re-trigger
  // LayoutContainer's hasCustomSidebar effect, forever.
  const instituteName = useSidebarBranding((state) => state.instituteName);
  const hideInstituteName = useSidebarBranding(
    (state) => state.hideInstituteName
  );
  // A sub-org learner is white-labelled: their own name and logo replace the
  // parent institute's. The app sidebar header did this and it went with it.
  const subOrgName = useSidebarBranding((state) => state.subOrgName);
  const subOrgLogoUrl = useSidebarBranding((state) => state.subOrgLogoUrl);
  const [homeIconClickRoute, setHomeIconClickRoute] = useState<string | null>(
    null
  );

  // Subjects for the breadcrumb picker. Reads from both known shapes of the
  // course payload (`level_with_details` from package-detail, `levelDetails`
  // from course-init) and falls back to `studyLibraryData` or the current
  // subject so the crumb always populates.
  const courseSubjects = useMemo<Array<{ id: string; subject_name: string; subject_order?: number | null }>>(() => {
    type BreadcrumbSubject = { id: string; subject_name: string; subject_order?: number | null };
    type LoosenedLevel = { id?: string; subjects?: BreadcrumbSubject[] };
    type LoosenedSession = { level_with_details?: LoosenedLevel[]; levelDetails?: LoosenedLevel[] };
    const sources: Array<{ sessions?: LoosenedSession[] } | null | undefined> = [
      courseInitData as { sessions?: LoosenedSession[] } | null | undefined,
      courseDetails as { sessions?: LoosenedSession[] } | null | undefined,
    ];
    for (const src of sources) {
      const sessions = src?.sessions;
      if (!sessions?.length) continue;
      for (const sess of sessions) {
        const levels = sess.level_with_details ?? sess.levelDetails ?? [];
        for (const level of levels) {
          // If levelId matches, return its subjects immediately
          if (levelId && level.id === levelId && level.subjects) {
            return level.subjects;
          }
          if (!levelId && level.subjects?.some((s) => s.id === subjectId)) {
            return level.subjects || [];
          }
        }
      }
      const firstSession = sessions[0];
      const firstLevelSubjects = (firstSession?.level_with_details ?? firstSession?.levelDetails ?? [])[0]?.subjects;
      if (firstLevelSubjects?.length) return firstLevelSubjects;
    }
    if (studyLibraryData?.length) {
      return studyLibraryData.map((s) => ({
        id: s.id,
        subject_name: s.subject_name,
        subject_order: s.subject_order,
      }));
    }
    if (subjectId && subjectName) {
      return [{ id: subjectId, subject_name: subjectName }];
    }
    return [];
  }, [courseInitData, courseDetails, subjectId, studyLibraryData, subjectName, levelId]);

  // Switch to a different subject: fetch that subject's modules/chapters
  // and drop the learner on the first chapter's slides view. If the target
  // subject has no content yet (or the fetch fails), route to the modules
  // landing as a graceful fallback so the learner still arrives at the
  // right place instead of a dead-end. `sessionId` from the URL is the
  // same value the API calls "packageSessionId".
  const [switchingSubjectId, setSwitchingSubjectId] = useState<string | null>(null);
  const handleSubjectSelect = useCallback(
    async (targetSubjectId: string) => {
      if (!targetSubjectId || targetSubjectId === subjectId) return;
      setSwitchingSubjectId(targetSubjectId);
      try {
        const pkgSessionId = resolvedSessionId;
        // Try authenticated fetch first; the public variant is a fallback
        // for unenrolled/public browsing contexts.
        let modules: ModulesWithChapters[] | null = null;
        try {
          modules = await fetchModulesWithChapters(targetSubjectId, pkgSessionId);
        } catch {
          modules = await fetchModulesWithChaptersPublic(targetSubjectId, pkgSessionId);
        }
        const firstModule = (modules || []).find((m) => (m.chapters || []).length > 0) || modules?.[0];
        const firstChapter = firstModule?.chapters?.[0];
        if (firstModule && firstChapter) {
          // Prime the store with the target subject's modules BEFORE
          // navigating so the module popover doesn't briefly show the
          // previous subject's list during the route transition.
          if (modules) setModulesWithChaptersData(modules);
          navigate({
            to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
            search: {
              courseId,
              subjectId: targetSubjectId,
              moduleId: firstModule.module.id,
              chapterId: firstChapter.id,
              slideId: "",
              sessionId,
            },
          });
          return;
        }
      } catch {
        toast.error("Couldn't open that subject. Please try again.");
      } finally {
        setSwitchingSubjectId(null);
      }
      navigate({
        to: "/study-library/courses/course-details/subjects/modules",
        search: { courseId, subjectId: targetSubjectId, moduleId: "" },
      });
    },
    [
      subjectId,
      sessionId,
      resolvedSessionId,
      courseId,
      navigate,
      setModulesWithChaptersData,
    ]
  );

  // truncatedChapterName removed (unused)
  const handleInstituteLogoClick = useCallback(() => {
    if (homeIconClickRoute) {
      window.location.href = homeIconClickRoute;
    }
  }, [homeIconClickRoute]);

  useEffect(() => {
    setModuleName(getModuleName(moduleId, modulesWithChaptersData));
    setChapterName(getChapterName(chapterId, modulesWithChaptersData) || "");
    const nameFromStore = getSubjectName(subjectId, studyLibraryData);
    const nameFromCourse = courseSubjects.find((s) => s.id === subjectId)?.subject_name;
    setSubjectName(nameFromStore || nameFromCourse || "");
  }, [
    chapterId,
    moduleId,
    subjectId,
    modulesWithChaptersData,
    studyLibraryData,
    courseSubjects,
  ]);

  // Get course and level names, and institute logo
  useEffect(() => {
    const getCourseAndLevelInfo = async () => {
      try {
        // Get institute details first for logo
        const instituteData = await Preferences.get({
          key: "InstituteDetails",
        });
        if (instituteData.value) {
          const institute = JSON.parse(instituteData.value);

          setHomeIconClickRoute(
            institute.home_icon_click_route ??
            institute.homeIconClickRoute ??
            null
          );

          // Get institute logo
          if (institute.institute_logo_file_id) {
            try {
              const logoUrl = await getPublicUrl(
                institute.institute_logo_file_id
              );
              if (logoUrl) {
                setInstituteLogoUrl(logoUrl);
              }
            } catch {
              // Silently handle logo loading error
            }
          }

          // Try to find course info in institute batches_for_sessions
          let batches = institute.batches_for_sessions || [];

          // If no batches in cache, try fetching from API
          if ((!batches || batches.length === 0) && courseId) {
             try {
                const { fetchBatchesForCourse } = await import("@/services/courseBatches");
                batches = await fetchBatchesForCourse(courseId);
             } catch (e) {
                console.error("Failed to fetch batches dynamically", e);
             }
          }

          if (
            batches &&
            Array.isArray(batches)
          ) {
            // Try multiple matching strategies
            let matchingBatch = batches.find(
              (batch: BatchForSessionType) => batch.id === sessionId
            );

            if (!matchingBatch) {
              matchingBatch = batches.find(
                (batch: BatchForSessionType) =>
                  batch.package_dto?.id === courseId
              );
            }

            // If still no match, use the first available batch
            if (!matchingBatch && batches.length > 0) {
              matchingBatch = batches[0];
            }

            if (matchingBatch) {
              const courseNameFromBatch =
                matchingBatch.package_dto?.package_name || "";
              const levelNameFromBatch = matchingBatch.level?.level_name || "";
              setCourseName(courseNameFromBatch);
              setLevelName(levelNameFromBatch);
            }
          }
        }
      } catch {
        // Silently handle errors
        console.error("Error loading institute or course data");
      }
    };

    getCourseAndLevelInfo();
  }, [sessionId, courseId, courseName, levelName]);

  // ── Resume thread (write) ─────────────────────────────────────────────────
  // Record the slide actually being viewed so other surfaces can offer a
  // one-click "Continue". Keyed on the ACTIVE slide id (not just the URL's
  // slideId, which is empty when the route defaults to the first slide), so
  // once-per-slide writes happen for every slide a learner lands on. Display
  // names may resolve a tick later; the effect harmlessly re-records the same
  // entry with the richer names when they do.
  const activeSlideId = activeItem?.id || "";
  const activeSlideTitle = activeItem?.title || "";
  useEffect(() => {
    if (!courseId || !subjectId || !moduleId || !chapterId || !resolvedSessionId) return;
    if (!activeSlideId || activeSlideId === "feedback-slide") return;
    // During route transitions activeItem can briefly point at the previous
    // chapter's slide; only record once it belongs to the current chapter.
    if (!slides?.some((s: Slide) => s.id === activeSlideId)) return;
    recordSlideVisit({
      courseId,
      levelId,
      subjectId,
      moduleId,
      chapterId,
      slideId: activeSlideId,
      sessionId: resolvedSessionId,
      slideTitle: activeSlideTitle,
      chapterName: chapterName || undefined,
      courseName: courseName || undefined,
    });
  }, [
    courseId,
    levelId,
    subjectId,
    moduleId,
    chapterId,
    activeSlideId,
    activeSlideTitle,
    resolvedSessionId,
    slides,
    chapterName,
    courseName,
  ]);

  // ── Play celebrations ─────────────────────────────────────────────────────
  // Confetti + an XP-pop toast when a slide CROSSES the completion threshold
  // during this session, a bigger volley when that crossing completes the
  // chapter, and a milestone volley when the streak increments to a milestone.
  // All user-visible celebration is gated on the play skin.
  const isPlay = usePlayTheme();
  const playStreak = usePlayGamificationStore((s) => s.data?.currentStreak);

  // Last-seen completion per slide id. Seeded on first observation so slides
  // that were ALREADY complete on load never celebrate — only a below→above
  // transition observed in this mount counts as a crossing. Quiz/assessment
  // completions land here instantly (setQueryData on ["slides", chapterId]);
  // video/doc progress arrives on the next slides refetch. The map persists
  // across chapter navigation (slide ids are globally unique).
  const slidePercentsRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!slides?.length) return;
    const prevPercents = slidePercentsRef.current;
    const crossedNow: string[] = [];
    let allCompleteNow = true;
    for (const slide of slides as Slide[]) {
      const pct = slide.percentage_completed ?? 0;
      const before = prevPercents.get(slide.id);
      if (
        before !== undefined &&
        before < getSlideCompletionThreshold() &&
        pct >= getSlideCompletionThreshold()
      ) {
        crossedNow.push(slide.id);
      }
      if (pct < getSlideCompletionThreshold()) allCompleteNow = false;
      prevPercents.set(slide.id, pct);
    }

    // Snapshot bookkeeping always runs (even outside play) so switching the
    // skin mid-session can't retroactively celebrate earlier crossings.
    if (!isPlay || crossedNow.length === 0) return;

    // Chapter completion outranks the per-slide moment: two-sided volley plus
    // a bigger toast. Consume the per-slide guards too so a cache flap can't
    // re-fire the smaller moment for the same slides later.
    if (allCompleteNow && chapterId && shouldCelebrateChapter(chapterId)) {
      crossedNow.forEach((id) => shouldCelebrateSlide(id));
      celebrateMilestone();
      toast.custom(
        (t) => (
          <button
            type="button"
            onClick={() => toast.dismiss(t)}
            className="flex items-center gap-3 rounded-play-btn bg-play-success px-5 py-4 shadow-play-2d-success active:translate-y-0.5 active:shadow-none"
          >
            <playIllustrations.Winners className="h-12 w-auto shrink-0 text-white" />
            <span className="text-start">
              <span className="block text-base font-black text-play-ink">
                {getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}{" "}
                complete!
              </span>
              <span className="block text-xs font-bold text-play-ink/80">
                Every{" "}
                {getTerminology(
                  ContentTerms.Slides,
                  SystemTerms.Slides
                ).toLowerCase()}{" "}
                done. Keep it rolling!
              </span>
            </span>
          </button>
        ),
        { duration: 5000 }
      );
      return;
    }

    // Per-slide moment: quick burst + XP-pop chip. One toast per update even
    // if several slides land at once (find consumes the once-per-slide guard).
    const celebratedId = crossedNow.find((id) => shouldCelebrateSlide(id));
    if (!celebratedId) return;
    celebrateCompletion();
    toast.custom(
      (t) => (
        <button
          type="button"
          onClick={() => toast.dismiss(t)}
          className="flex items-center gap-3 rounded-play-btn bg-play-success px-4 py-3 shadow-play-2d-success active:translate-y-0.5 active:shadow-none"
        >
          <playIllustrations.Completed className="h-10 w-auto shrink-0 text-white" />
          <span className="text-sm font-black text-play-ink">
            Nice! {getTerminology(ContentTerms.Slides, SystemTerms.Slides)}{" "}
            complete
          </span>
          <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-black text-play-ink">
            +{SLIDE_XP} XP
          </span>
        </button>
      ),
      { duration: 3500 }
    );
  }, [slides, isPlay, chapterId]);

  // Streak milestone: fire only when the streak INCREMENTS to a milestone
  // while this tab is open. The sessionStorage marker seeds on the first
  // observation, so a streak already at 7 when the viewer opens stays quiet;
  // the marker also updates outside play so toggling the skin mid-session
  // can't retroactively celebrate an earlier increment.
  useEffect(() => {
    if (playStreak == null) return;
    let lastSeen: number | null = null;
    try {
      const raw = sessionStorage.getItem(LAST_SEEN_STREAK_KEY);
      lastSeen = raw == null ? null : Number(raw);
    } catch {
      lastSeen = null;
    }
    try {
      sessionStorage.setItem(LAST_SEEN_STREAK_KEY, String(playStreak));
    } catch {
      // sessionStorage unavailable (private mode); the milestone just won't fire
    }
    if (!isPlay) return;
    if (lastSeen == null || Number.isNaN(lastSeen)) return;
    if (playStreak > lastSeen && isStreakMilestone(playStreak)) {
      celebrateMilestone();
    }
  }, [playStreak, isPlay]);

  // Load Student Display Settings for slides view
  useEffect(() => {
    getStudentDisplaySettings(false).then((s) => {
      setShowLearningPath(
        s?.courseDetails?.slidesView?.showLearningPath ?? true
      );
      setFeedbackVisible(s?.courseDetails?.slidesView?.feedbackVisible ?? true);
      setCollapseSidebarSetting(
        s?.courseDetails?.slidesView?.collapseSidebarOnOpen
      );
      setManualCompletionSetting(
        s?.courseDetails?.slidesView?.manualCompletion
      );
      setChapterCompleteCtaSetting(
        s?.courseDetails?.slidesView?.chapterCompleteCta
      );
      setFeedbackInSlideNavSetting(
        s?.courseDetails?.slidesView?.feedbackInSlideNav
      );
      setFeedbackTrigger(
        s?.courseDetails?.slidesView?.feedbackTrigger ?? "CHAPTER"
      );
      setSidebarNavigation(
        readDebugSidebarNav() ??
          s?.courseDetails?.slidesView?.sidebarNavigation ??
          "breadcrumb"
      );
    });
  }, []);

  // ── Focus mode ────────────────────────────────────────────────────────────
  // Collapses the chapter sidebar and tightens the content margins so the
  // slide gets the full reading width. State is local to this route and
  // persisted per-tab in sessionStorage so it survives slide-to-slide and
  // chapter-to-chapter navigation within a study session.
  const [focusMode, setFocusMode] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SLIDES_FOCUS_MODE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(SLIDES_FOCUS_MODE_KEY, next ? "1" : "0");
      } catch {
        // sessionStorage unavailable (private mode); state still toggles
      }
      return next;
    });
  }, []);

  // Drive the app sidebar from focus mode. setOpen's identity changes with
  // the sidebar's open state (shadcn useCallback dep), so route it through a
  // ref and key the effect on focusMode only — otherwise manual sidebar
  // toggles from the navbar would re-trigger this effect and fight the user.
  //
  // Focus mode's only entry point is a button in the viewer sidebar. With the
  // sidebar off there is nothing to collapse and no way back out, so a value
  // left over in sessionStorage must not keep driving the layout.
  const effectiveFocusMode = focusMode && !hideSlidesSidebar;

  // Whether the APP sidebar (the global nav rail) should be collapsed while the
  // viewer is open. Focus mode is the manual way in; the institute setting is
  // the automatic one. An explicit setting wins; unset follows the sidebar
  // mode, so the sidebar-less viewer collapses the rail and the modes with
  // their own sidebar are left exactly as they were. Restored on the way out
  // so the rest of the app never inherits a collapsed rail.
  const collapseSidebarOnOpen = collapseSidebarSetting ?? hideSlidesSidebar;
  const collapseAppSidebar = effectiveFocusMode || collapseSidebarOnOpen;

  // "Mark as complete" defaults to the sidebar-less viewer only. That mode has
  // no tick list and no progress readout, so it is the one place the learner
  // otherwise gets no completion feedback at all; the breadcrumb and tree modes
  // already show both, and adding a button there would change the default
  // viewer for every institute. An explicit setting overrides either way.
  const manualCompletion = manualCompletionSetting ?? hideSlidesSidebar;

  // Chapter hand-off bar. Unset follows the sidebar mode: the sidebar-less
  // viewer shows it (it is the one that dead-ends at chapter end), the sidebar
  // modes already list chapters and let the learner choose.
  const chapterCompleteCta = chapterCompleteCtaSetting ?? hideSlidesSidebar;

  const setAppSidebarOpenRef = useRef(setAppSidebarOpen);
  useEffect(() => {
    setAppSidebarOpenRef.current = setAppSidebarOpen;
  }, [setAppSidebarOpen]);
  useEffect(() => {
    setAppSidebarOpenRef.current(!collapseAppSidebar);
  }, [collapseAppSidebar]);
  // Restore the sidebar when leaving the route while focus mode is on, so
  // the rest of the app doesn't inherit a collapsed sidebar.
  const focusModeRef = useRef(collapseAppSidebar);
  useEffect(() => {
    focusModeRef.current = collapseAppSidebar;
  }, [collapseAppSidebar]);
  useEffect(
    () => () => {
      if (focusModeRef.current) setAppSidebarOpenRef.current(true);
    },
    []
  );

  const nextChapter = useMemo(() => {
    if (!modulesWithChaptersData?.length) return null;

    const currentModIndex = modulesWithChaptersData.findIndex(
      (m) => m.module.id === moduleId
    );
    if (currentModIndex === -1) return null;

    const currentMod = modulesWithChaptersData[currentModIndex];
    if (!currentMod?.chapters) return null;

    const currentChapIndex = currentMod.chapters.findIndex(
      (c) => c.id === chapterId
    );
    if (currentChapIndex === -1) return null;

    // Check next in same module
    if (currentChapIndex + 1 < currentMod.chapters.length) {
      return {
        module: currentMod.module,
        chapter: currentMod.chapters[currentChapIndex + 1],
      };
    }

    // Check start of next module
    if (currentModIndex + 1 < modulesWithChaptersData.length) {
      const nextMod = modulesWithChaptersData[currentModIndex + 1];
      if (nextMod.chapters?.length > 0) {
        return {
          module: nextMod.module,
          chapter: nextMod.chapters[0],
        };
      }
    }

    return null;
  }, [modulesWithChaptersData, moduleId, chapterId]);

  const handleNextChapter = useCallback(() => {
    if (nextChapter) {
      navigate({
        to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
        search: {
          courseId,
          subjectId,
          moduleId: nextChapter.module.id,
          chapterId: nextChapter.chapter.id,
          slideId: "", // Default to first slide
          sessionId,
        },
      });
    }
  }, [nextChapter, navigate, courseId, subjectId, sessionId]);

  // The next unviewed slide within the current chapter. This — not the next
  // chapter — is what "Up next" should point at mid-chapter: the old pill
  // showed the next chapter while slides were still unwatched here, which
  // read as "next thing to play" and steered learners past them. The next
  // chapter only takes over on the chapter's last slide.
  const nextSlide = useMemo(() => {
    if (!slides || slides.length === 0) return null;
    const currentId = activeItem?.id || slideId || "";
    if (!currentId || currentId === "feedback-slide") return null;
    const list = slides.filter((s) => s.id !== "feedback-slide");
    const idx = list.findIndex((s) => s.id === currentId);
    if (idx === -1 || idx + 1 >= list.length) return null;
    return list[idx + 1] ?? null;
  }, [slides, activeItem?.id, slideId]);

  const handleNextSlide = useCallback(() => {
    if (!nextSlide) return;
    navigate({
      to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
      search: {
        courseId,
        subjectId,
        moduleId,
        chapterId,
        slideId: nextSlide.id,
        sessionId,
      },
    });
  }, [nextSlide, navigate, courseId, subjectId, moduleId, chapterId, sessionId]);

  // ── Market-standard chapter hand-off ──────────────────────────────────────
  // Mainstream course players end a section with an explicit "you're done —
  // here's what's next" moment rather than a dead stop. That matters most in
  // the sidebar-less viewer: there is no chapter list there to tell the learner
  // they finished, and no way to pick what comes next except guessing at Next.
  // Which modes show it is settings-driven (chapterCompleteCta), defaulting to
  // the sidebar-less viewer since the sidebar modes already show chapter
  // progress and let the learner choose.
  const chapterComplete = useMemo(() => {
    const real = (slides || []).filter(
      (sl: Slide) => sl.id !== "feedback-slide"
    );
    if (!real.length) return false;
    const threshold = getSlideCompletionThreshold();
    return real.every(
      (sl: Slide) => (sl.percentage_completed || 0) >= threshold
    );
  }, [slides]);

  const [chapterCtaDismissed, setChapterCtaDismissed] = useState(false);
  // A new chapter deserves its own hand-off, so the dismissal does not carry.
  useEffect(() => {
    setChapterCtaDismissed(false);
  }, [chapterId]);

  const previousChapter = useMemo(() => {
    if (!modulesWithChaptersData?.length) return null;

    const currentModIndex = modulesWithChaptersData.findIndex(
      (m) => m.module.id === moduleId
    );
    if (currentModIndex === -1) return null;

    const currentMod = modulesWithChaptersData[currentModIndex];
    if (!currentMod?.chapters) return null;

    const currentChapIndex = currentMod.chapters.findIndex(
      (c) => c.id === chapterId
    );
    if (currentChapIndex === -1) return null;

    // Check previous in same module
    if (currentChapIndex - 1 >= 0) {
      return {
        module: currentMod.module,
        chapter: currentMod.chapters[currentChapIndex - 1],
      };
    }

    // Check last chapter of previous module
    if (currentModIndex - 1 >= 0) {
      const prevMod = modulesWithChaptersData[currentModIndex - 1];
      if (prevMod.chapters?.length > 0) {
        return {
          module: prevMod.module,
          chapter: prevMod.chapters[prevMod.chapters.length - 1],
        };
      }
    }

    return null;
  }, [modulesWithChaptersData, moduleId, chapterId]);

  const handlePreviousChapter = useCallback(() => {
    if (previousChapter) {
      navigate({
        to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
        search: {
          courseId,
          subjectId,
          moduleId: previousChapter.module.id,
          chapterId: previousChapter.chapter.id,
          slideId: "", // Default to first slide
          sessionId,
        },
      });
    }
  }, [previousChapter, navigate, courseId, subjectId, sessionId]);

  // "Institute · Level" on one line. The level is dropped when it's absent,
  // a "default" placeholder, or already spelled out inside the course name.
  const sidebarEyebrow = useMemo(() => {
    const showLevel =
      !!levelName &&
      levelName.trim().toLowerCase() !== "default" &&
      !(
        courseName &&
        courseName.toLowerCase().includes(levelName.trim().toLowerCase())
      );
    // Sub-org branding wins over the parent's, and is never suppressed by
    // `hideInstituteName` — that switch is about the PARENT's name.
    const owner = subOrgName || (hideInstituteName ? null : instituteName);
    return [owner, showLevel ? toTitleCase(levelName) : null]
      .filter(Boolean)
      .join(" · ");
  }, [
    instituteName,
    hideInstituteName,
    subOrgName,
    levelName,
    courseName,
  ]);

  const SidebarComponent = (
    <div className="flex flex-col h-full bg-white border-e border-gray-100">
      {/* --- Header Section: Identity & Breadcrumbs ---
          One header, not two. This panel now replaces the app sidebar's own
          institute header (see mySidebar), so it carries both names: the
          institute as a small eyebrow and the course as the title, beside a
          single logo. The level joins the eyebrow rather than taking a third
          line, and is dropped when the course name already contains it — batch
          names routinely embed the level ("Class 8 | MGP | B 3" under level
          "Class 8"), which said the same thing twice. Between this and the
          removed duplicate header the panel gets ~110px back. */}
      <div className="flex-none px-3 py-2 space-y-1.5 border-b border-gray-100 bg-white z-10">
        {/* Course Info Row */}
        <div className="flex items-center gap-2.5">
          {/* The affordance is the whole tile, not just the image: the logo id
              can be missing or fail to resolve, and the fallback icon used to
              be dead where the image was clickable. A real button when it
              navigates, a plain tile when it doesn't. */}
          {(() => {
            const logoUrl = subOrgLogoUrl || instituteLogoUrl;
            const inner = logoUrl ? (
              <img
                src={logoUrl}
                alt={subOrgName || "Institute"}
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <GraduationCap size={16} weight="duotone" />
            );
            const tile =
              "flex-shrink-0 w-7 h-7 rounded-md border border-gray-150 bg-white flex items-center justify-center text-primary-500";
            return homeIconClickRoute ? (
              <button
                type="button"
                onClick={handleInstituteLogoClick}
                aria-label="Go to home"
                className={`${tile} cursor-pointer transition-colors hover:border-gray-300`}
              >
                {inner}
              </button>
            ) : (
              <div className={tile}>{inner}</div>
            );
          })()}
          <div className="min-w-0 flex-1">
            {sidebarEyebrow && (
              <p
                className="text-2xs font-medium tracking-wide text-gray-500 truncate"
                title={sidebarEyebrow}
              >
                {sidebarEyebrow}
              </p>
            )}
            <h3
              className="text-caption font-semibold text-gray-900 leading-tight truncate"
              title={courseName ? toTitleCase(courseName) : undefined}
            >
              {courseName ? toTitleCase(courseName) : `${getTerminology(ContentTerms.Course, SystemTerms.Course)} Details`}
            </h3>
          </div>
          {/* Focus mode: hides this sidebar + tightens content margins.
              Desktop only — on mobile the sidebar is already an offcanvas
              sheet, so the toggle would only add noise. The matching exit
              control floats bottom-left while focus mode is active. */}
          <button
            onClick={toggleFocusMode}
            title="Focus mode"
            aria-label="Enter focus mode"
            className="hidden sm:flex size-7 flex-shrink-0 items-center justify-center rounded-md border border-gray-150 bg-white text-gray-400 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700 [.ui-play_&]:rounded-lg [.ui-play_&]:border-2"
          >
            <ArrowsOut size={14} weight="bold" />
          </button>
        </div>

        {/* Breadcrumb: [Subject >] Module Switcher > Current Chapter.
            Rendered in every mode. It was gated to "breadcrumb" mode on the
            reasoning that the tree already shows the path — but the tree shows
            it only where the learner happens to be scrolled, and the crumb is
            the one line that says where you are without having to look for it.
            It also stays the fastest way to jump a module. Subject crumb is
            only rendered when the course structure actually has subjects
            (`subjectId` set + studyLibraryData populated) — otherwise the
            crumb collapses to Module > Chapter as before. */}
        {showLearningPath && (() => {
          // Backends frequently emit a "Default"-named subject / module /
          // chapter as a placeholder when that level isn't really part of
          // the course. Those crumbs aren't useful navigation context — hide
          // them so the breadcrumb only shows real ancestors.
          const isDefaultName = (n: string | null | undefined) =>
            (n || "").trim().toLowerCase() === "default";
          const showSubjectCrumb =
            !!subjectId &&
            courseSubjects.length > 0 &&
            !isDefaultName(subjectName);
          const showModuleCrumb = !isDefaultName(moduleName);
          const showChapterCrumb = !isDefaultName(chapterName);
          return (
          <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium min-w-0">
            {/* Subject — tapping opens a picker listing all subjects in the
                course. Selecting one routes to that subject's modules view
                (we don't know its first chapter yet, so we drop the learner
                at the modules list per HIG's "show the landing, don't guess"). */}
            {showSubjectCrumb && (
              <>
                <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="flex items-center gap-0.5 min-w-0 shrink hover:text-primary-600 transition-colors group"
                        title={subjectName || getTerminology(ContentTerms.Subjects, SystemTerms.Subjects)}
                      >
                        <span className="truncate max-w-24 sm:max-w-32">
                          {toTitleCase(subjectName || getTerminology(ContentTerms.Subjects, SystemTerms.Subjects))}
                        </span>
                        <ChevronDownIcon className="w-3 h-3 flex-shrink-0 text-gray-400 group-hover:text-primary-400 transition-colors" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-64 p-0 shadow-md border border-gray-200 rounded-lg overflow-hidden"
                      align="start"
                      sideOffset={6}
                    >
                      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/80">
                        <p className="text-caption font-bold text-gray-500 uppercase tracking-wider">
                          {getTerminology(ContentTerms.Subjects, SystemTerms.Subjects)}s
                        </p>
                      </div>
                      <div className="max-h-72 overflow-y-auto custom-scrollbar">
                        {courseSubjects.map((s) => {
                          const isCurrent = s.id === subjectId;
                          const isSwitching = switchingSubjectId === s.id;
                          return (
                            <button
                              key={s.id}
                              disabled={!!switchingSubjectId && !isSwitching}
                              onClick={() => handleSubjectSelect(s.id)}
                              className={`w-full text-start px-3 py-2 text-caption transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                                isCurrent
                                  ? "bg-primary-50 text-primary-700 font-semibold"
                                  : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                              }`}
                            >
                              <div
                                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                  isCurrent ? "bg-primary-500" : "bg-gray-300"
                                }`}
                              />
                              <span className="truncate flex-1">
                                {toTitleCase(s.subject_name)}
                              </span>
                              {isSwitching ? (
                                <div className="w-3 h-3 border-2 border-primary-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                              ) : isCurrent ? (
                                <span className="text-caption font-bold text-primary-500 uppercase tracking-wide flex-shrink-0">
                                  Now
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                </Popover>

                {(showModuleCrumb || showChapterCrumb) && (
                  <ChevronRightIcon className="w-3 h-3 text-gray-300 flex-shrink-0" />
                )}
              </>
            )}

            {/* Module — a popover that lists all modules (tap to jump). */}
            {showModuleCrumb && (
              <>
                <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="flex items-center gap-0.5 min-w-0 shrink hover:text-primary-600 transition-colors group"
                        title={moduleName || getTerminology(ContentTerms.Modules, SystemTerms.Modules)}
                      >
                        <span className="truncate max-w-24 sm:max-w-32">
                          {toTitleCase(moduleName || getTerminology(ContentTerms.Modules, SystemTerms.Modules))}
                        </span>
                        <ChevronDownIcon className="w-3 h-3 flex-shrink-0 text-gray-400 group-hover:text-primary-400 transition-colors" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-72 p-0 shadow-md border border-gray-200 rounded-lg overflow-hidden"
                      align="start"
                      sideOffset={6}
                    >
                      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/80">
                        <p className="text-caption font-bold text-gray-500 uppercase tracking-wider">
                          {subjectName && !isDefaultName(subjectName)
                            ? `${toTitleCase(subjectName)} · ${getTerminology(ContentTerms.Modules, SystemTerms.Modules)}s`
                            : `${getTerminology(ContentTerms.Course, SystemTerms.Course)} Content`}
                        </p>
                      </div>
                      <div className="max-h-72 overflow-y-auto custom-scrollbar">
                        {modulesWithChaptersData?.map((modData) => (
                          <ModuleAccordionItem
                            key={modData.module.id}
                            modData={modData}
                            isInitiallyExpanded={modData.module.id === moduleId}
                            currentChapterId={chapterId}
                            onChapterSelect={(targetModuleId, targetChapterId) => {
                              navigate({
                                to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
                                search: {
                                  courseId,
                                  subjectId,
                                  moduleId: targetModuleId,
                                  chapterId: targetChapterId,
                                  slideId: "",
                                  sessionId,
                                },
                              });
                            }}
                          />
                        ))}
                      </div>
                    </PopoverContent>
                </Popover>

                {showChapterCrumb && (
                  <ChevronRightIcon className="w-3 h-3 text-gray-300 flex-shrink-0" />
                )}
              </>
            )}

            {/* Chapter — current location; per HIG the active crumb is a label,
                not a link. The native `title` attribute provides the full name
                on hover without requiring an extra tooltip component. */}
            {showChapterCrumb && (
              <span
                className="text-gray-900 font-semibold truncate"
                title={chapterName || getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}
              >
                {toTitleCase(chapterName || getTerminology(ContentTerms.Chapters, SystemTerms.Chapters))}
              </span>
            )}
          </div>
          );
        })()}
      </div>

      {/* --- Scrollable Content ---
          Admin-chosen via Student Display Settings → courseDetails.slidesView.
          • "ancestors" renders the full Subject → Module → Chapter → Slide
            tree so learners can jump anywhere from the sidebar.
          • "breadcrumb" renders the legacy per-chapter flat slide list;
            cross-module navigation happens via the breadcrumb popovers. */}
      <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
        {sidebarNavigation === "lessons" ? (
          <LessonListSidebar
            courseId={courseId || ""}
            sessionId={resolvedSessionId}
            subjects={courseSubjects}
            currentSubjectId={subjectId || ""}
            currentChapterId={chapterId || ""}
            currentSlideId={slideId || ""}
            currentSubjectModules={modulesWithChaptersData}
            onSlideSelect={({
              subjectId: targetSubjectId,
              moduleId: targetModuleId,
              chapterId: targetChapterId,
              slideId: targetSlideId,
            }) => {
              navigate({
                to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
                search: {
                  courseId,
                  subjectId: targetSubjectId,
                  moduleId: targetModuleId,
                  chapterId: targetChapterId,
                  slideId: targetSlideId,
                  sessionId,
                },
              });
            }}
          />
        ) : sidebarNavigation === "ancestors" ? (
          <div className="py-1">
            <CourseTreeSidebar
              courseId={courseId || ""}
              courseName={courseName}
              sessionId={resolvedSessionId}
              subjects={courseSubjects}
              currentSubjectId={subjectId || ""}
              currentModuleId={moduleId || ""}
              currentChapterId={chapterId || ""}
              currentSlideId={slideId || ""}
              currentSubjectModules={modulesWithChaptersData}
              onSlideSelect={({ subjectId: targetSubjectId, moduleId: targetModuleId, chapterId: targetChapterId, slideId: targetSlideId }) => {
                navigate({
                  to: "/study-library/courses/course-details/subjects/modules/chapters/slides",
                  search: {
                    courseId,
                    subjectId: targetSubjectId,
                    moduleId: targetModuleId,
                    chapterId: targetChapterId,
                    slideId: targetSlideId,
                    sessionId,
                  },
                });
              }}
            />
          </div>
        ) : (
          <div className="p-2">
            <ChapterSidebarSlides />
          </div>
        )}
      </div>

      {/* --- Footer: Progress & Actions ---
          Prev / Up-next collapsed to single-line pills so the tree above
          gets the screen real estate. The full chapter name still appears
          inline (truncated with a native tooltip) so the learner doesn't
          lose the context the larger cards used to provide. */}
      {slides && slides.length > 0 && (
        <div className="flex-none px-3 py-2 border-t border-gray-100 bg-white space-y-1.5 z-10">
          {previousChapter && (
            <button
              onClick={handlePreviousChapter}
              title={`Previous: ${toTitleCase(previousChapter.chapter.chapter_name)}`}
              className="w-full flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 hover:bg-neutral-100 hover:border-neutral-300 transition-colors group/prev text-start [.ui-play_&]:rounded-lg [.ui-play_&]:border-2"
            >
              <CaretLeft
                size={12}
                className="text-neutral-500 shrink-0 transition-transform group-hover/prev:-translate-x-0.5"
                weight="bold"
              />
              <span className="text-caption font-bold text-neutral-500 uppercase tracking-wider shrink-0">
                Prev
              </span>
              <span className="text-caption font-semibold text-neutral-700 truncate leading-tight min-w-0">
                {toTitleCase(previousChapter.chapter.chapter_name)}
              </span>
            </button>
          )}

          {nextSlide ? (
            (() => {
              const nextSlideTitle = toTitleCase(
                computeDisplayTitles(slides || [], [
                  subjectName || "",
                  moduleName || "",
                  chapterName || "",
                ]).get(nextSlide.id) ?? getSlideTitle(nextSlide)
              );
              const nextSlideMeta = getSlideMeta(nextSlide);
              return (
                <button
                  onClick={handleNextSlide}
                  title={`Up next: ${toTitleCase(getSlideTitle(nextSlide))}`}
                  className="w-full flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-2 py-1.5 hover:bg-primary-100 hover:border-primary-300 transition-colors group/next text-start [.ui-play_&]:rounded-lg [.ui-play_&]:border-2"
                >
                  <span className="text-caption font-bold text-primary-500 uppercase tracking-wider shrink-0">
                    Up next
                  </span>
                  <span className="text-caption font-bold text-primary-700 truncate leading-tight min-w-0 flex-1">
                    {nextSlideTitle}
                  </span>
                  {nextSlideMeta && (
                    <span className="text-caption text-primary-500 tabular-nums shrink-0">
                      {nextSlideMeta}
                    </span>
                  )}
                  <CaretRight
                    size={12}
                    className="text-primary-500 shrink-0 transition-transform group-hover/next:translate-x-0.5"
                    weight="bold"
                  />
                </button>
              );
            })()
          ) : nextChapter ? (
            <button
              onClick={handleNextChapter}
              title={`Next ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}: ${toTitleCase(nextChapter.chapter.chapter_name)}`}
              className="w-full flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-2 py-1.5 hover:bg-primary-100 hover:border-primary-300 transition-colors group/next text-start [.ui-play_&]:rounded-lg [.ui-play_&]:border-2"
            >
              {/* "Next Chapter", not "Up next" — this pill jumps out of the
                  current chapter, and labeling that jump "Up next" mid-chapter
                  misread as the next thing to play. */}
              <span className="text-caption font-bold text-primary-500 uppercase tracking-wider shrink-0">
                Next {getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}
              </span>
              <span className="text-caption font-bold text-primary-700 truncate leading-tight min-w-0 flex-1">
                {toTitleCase(nextChapter.chapter.chapter_name)}
              </span>
              <CaretRight
                size={12}
                className="text-primary-500 shrink-0 transition-transform group-hover/next:translate-x-0.5"
                weight="bold"
              />
            </button>
          ) : null}

          {/* Progress Bar — labeled so the bar is never an anonymous strip:
              "Chapter progress · 40%" (terminology-aware chapter term).
              Breadcrumb mode only: the tree shows progress inline on the
              current chapter's row, so repeating it here duplicated the
              chip and detached the number from the chapter it describes. */}
          {sidebarNavigation === "breadcrumb" && (
            <div className="space-y-1">
              <p className="text-caption font-semibold text-gray-500 uppercase tracking-wider [.ui-play_&]:font-black [.ui-play_&]:uppercase [.ui-play_&]:tracking-wide">
                {getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}{" "}
                progress{" · "}
                <span className="text-gray-800 normal-case tracking-normal tabular-nums [.ui-play_&]:font-black">
                  {Math.min(calculateOverallCompletion(slides), 100)}%
                </span>
              </p>
              <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden [.ui-play_&]:rounded-full [.ui-play_&]:h-3">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all duration-500 ease-out [.ui-play_&]:rounded-full [.ui-play_&]:h-3"
                  style={{
                    width: `${Math.min(
                      calculateOverallCompletion(slides),
                      100
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Feedback Button (Ghost) */}
          {feedbackVisible && (
            <button
              onClick={() => {
                const feedbackSlide: Slide = {
                  id: "feedback-slide",
                  title: "Feedback",
                  source_type: "FEEDBACK",
                  source_id: "",
                  image_file_id: "",
                  description: `Provide feedback for this ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLocaleLowerCase()}`,
                  status: "ACTIVE",
                  slide_order: slides?.length ? slides.length + 1 : 1,
                  percentage_completed: 0,
                  is_loaded: true,
                  new_slide: false,
                  progress_marker: 0,
                };
                setActiveItem(feedbackSlide);
              }}
              className={`
                w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-caption font-medium
                transition-all duration-150
                ${activeItem?.id === "feedback-slide"
                  ? "bg-primary-50 text-primary-700 border border-primary-200"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                }
              `}
            >
              <PencilSimple className="w-3 h-3" />
              <span>Feedback</span>
            </button>
          )}
        </div>
      )}
    </div>
  );

  const { setNavHeading } = useNavHeadingStore();

  // Top bar carries only the current chapter as a plain title. The single
  // breadcrumb trail (Subject > Module > Chapter, with pickers) lives in the
  // chapter sidebar header — keeping a second Subject/Module/Chapter trail
  // here duplicated it.
  useEffect(() => {
    setNavHeading(
      <span className="truncate">
        {toTitleCase(
          chapterName ||
            `${getTerminology(ContentTerms.Course, SystemTerms.Course)} Details`
        )}
      </span>
    );
  }, [setNavHeading, chapterName]);

  return (
    <LayoutContainer
      fullWidth
      // No sidebar prop at all in "hidden" mode — passing an empty node would
      // still reserve the rail. LayoutContainer then falls back to the app's
      // own sidebar, so the learner keeps a way out of the viewer.
      {...(hideSlidesSidebar
        ? {}
        : {
            sidebarComponent: SidebarComponent,
            // This panel's own header carries the institute name, so the app
            // sidebar's branding header would be a second copy.
            hideBrandingHeader: true,
          })}
      className={
        effectiveFocusMode || hideSlidesSidebar
          ? "m-0 md:m-1"
          : "md:my-0 md:mx-2 lg:mx-3"
      }
    >
      <InitStudyLibraryProvider>
        <ModulesWithChaptersProvider
          subjectId={subjectId}
          packageSessionId={resolvedSessionId || undefined}
        >
          <SidebarProvider defaultOpen={false}>
            {activeItem?.id === "feedback-slide" ? (
              <FeedbackPage />
            ) : (
              <SlideMaterial
                onNavigateToSlide={handleNavigateToSlide}
                startAt={slideStartAt}
                onStartAtApplied={handleSlideStartApplied}
                standaloneNav={hideSlidesSidebar}
                manualCompletion={manualCompletion}
                completionContext={{
                  chapterId,
                  moduleId,
                  subjectId,
                  packageSessionId: resolvedSessionId || undefined,
                }}
                // Only in "hidden" mode: with a sidebar on screen the learner
                // already has a way across chapters, and making Next jump
                // chapters there would change long-standing behaviour.
                onPastLastSlide={
                  hideSlidesSidebar && nextChapter
                    ? handleNextChapter
                    : undefined
                }
                onBeforeFirstSlide={
                  hideSlidesSidebar && previousChapter
                    ? handlePreviousChapter
                    : undefined
                }
              />
            )}
          </SidebarProvider>
        </ModulesWithChaptersProvider>
      </InitStudyLibraryProvider>
      {/* Exit handle for focus mode — floats bottom-left (the sidebar it
          replaced lived on the left; bottom-right belongs to the chatbot
          button and the doubt sidebar). Rendered only while focused, so it
          never overlaps the open sidebar's footer. */}
      {/* Chapter hand-off. Dismissible, and only appears once every slide in
          the chapter has crossed the completion threshold AND there is
          somewhere to go. Visibility itself is settings-driven. */}
      {chapterCompleteCta &&
        chapterComplete &&
        nextChapter &&
        !chapterCtaDismissed && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-success-200 bg-success-50 px-4 py-3">
            <div className="mx-auto flex max-w-screen-lg items-center gap-3">
              <CheckCircle
                size={20}
                weight="fill"
                className="shrink-0 text-success-600"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-neutral-900">
                  {toTitleCase(
                    getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)
                  )}{" "}
                  complete
                </p>
                <p className="truncate text-caption text-neutral-600">
                  {toTitleCase(nextChapter.chapter.chapter_name)}
                </p>
              </div>
              <button
                onClick={handleNextChapter}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-primary-400 [.ui-play_&]:rounded-xl [.ui-play_&]:font-bold"
              >
                <span>{t("slideNav.next")}</span>
                <CaretRight size={14} weight="bold" />
              </button>
              <button
                onClick={() => setChapterCtaDismissed(true)}
                aria-label="Dismiss"
                className="shrink-0 rounded-md p-1 text-neutral-500 transition-colors hover:bg-success-100 hover:text-neutral-800"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

      {effectiveFocusMode && (
        <button
          onClick={toggleFocusMode}
          aria-label="Exit focus mode"
          className="fixed bottom-6 start-4 z-30 hidden sm:flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 shadow-md transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 [.ui-play_&]:border-2 [.ui-play_&]:font-bold"
        >
          <ArrowsIn size={14} weight="bold" />
          <span>Exit focus</span>
        </button>
      )}
    </LayoutContainer>
  );
}
