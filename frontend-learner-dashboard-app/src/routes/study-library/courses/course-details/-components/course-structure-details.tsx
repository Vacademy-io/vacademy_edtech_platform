import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { PullToRefreshWrapper } from "@/components/design-system/pull-to-refresh";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn, toTitleCase } from "@/lib/utils";
import { useDripConditions } from "@/hooks/use-drip-conditions";
import { LockedBadge, LockNotice } from "@/components/drip-conditions";
import { useDripConditionStore } from "@/stores/study-library/drip-conditions-store";
import { useCourseDripSchedule } from "@/hooks/use-course-drip-schedule";
import type { ContentCardImageFit } from "@/types/student-display-settings";
import { evaluateDripCondition } from "@/utils/drip-conditions";
import type {
  LearnerProgressData,
  DripConditionEvaluation,
} from "@/utils/drip-conditions";
import {
  isItemLocked,
  shouldFilterItem,
} from "@/components/drip-conditions/helpers";
import {
  CaretLeft,
  CaretRight,
  CheckCircle,
  Circle,
  CircleHalf,
  Folder,
  FolderOpen,
  Lock,
  PresentationChart,
} from "@phosphor-icons/react";
import { Steps } from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  fetchModulesWithChapters,
  fetchModulesWithChaptersPublic,
} from "@/services/study-library/getModulesWithChapters";
import { SubjectType } from "@/stores/study-library/use-study-library-store";
import { DownloadNodeButton } from "@/components/common/offline/download-node-button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchSlidesByChapterId,
  fetchSlidesByPackageSession,
  Slide,
} from "@/hooks/study-library/use-slides";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  TabType,
  tabs,
} from "@/components/common/study-library/level-material/subject-material/-constants/constant";
import { getSlideCompletionThreshold } from "@/constants/study-library";
import {
  getIcon,
  getSlideTypeDisplay,
} from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/chapter-sidebar-slides";
import { CourseDetailsFormValues } from "./course-details-schema";
import { getSubjectDetails } from "@/routes/courses/course-details/-utils/helper";
import { useRouter } from "@tanstack/react-router";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { Preferences } from "@capacitor/preferences";
// import { CODE_CIRCLE_INSTITUTE_ID } from "@/constants/urls";
// import { getInstituteId } from "@/constants/urls";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { getChatEnabled } from "@/services/chat/getChatEnabled";
import { DonationDialog } from "@/components/common/donation/DonationDialog";
import { useEnrollmentStatus } from "@/hooks/use-enrollment-status";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import type { StudentCourseDetailsTabId } from "@/types/student-display-settings";
import { BatchChatPanel } from "@/components/chat/BatchChatPanel";
import { CourseLeaderboard } from "./CourseLeaderboard";
import { getFilePublicUrlQuery } from "@/services/file-url-cache";
import { getLatestResume } from "@/services/resume-thread";
import { useTranslation } from "react-i18next";

// Course-structure data contract — shared with the other course-details view so
// the two cannot drift on the server payload. Re-exported because existing call
// sites import these types from this module.
import type {
  Chapter,
  ChapterMetadata,
  Module,
  ModuleWithChapters,
  SubjectModulesMap,
} from "@/types/course-structure";
export type {
  Chapter,
  ChapterMetadata,
  Module,
  ModuleWithChapters,
  SubjectModulesMap,
};

/** Minimal subject shape from course-init; used when form-based subjects aren't ready yet */
export type CourseInitSubject = {
  id: string;
  subject_name?: string;
  subject_code?: string;
  credit?: number;
  thumbnail_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  subject_order?: number;
};

/**
 * Column counts for the content-only drill-down grid. Exported so the page's
 * loading skeleton lays out identically — a skeleton that promises two columns
 * and resolves into one is worse than no skeleton.
 */
export const CONTENT_ONLY_CARD_GRID =
  "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

/**
 * Content Structure card chrome, matched to the admin dashboard.
 *
 * The admin card is a padded shell with the thumbnail inset and rounded on all
 * four sides; the learner grid used a full-bleed image running to the card
 * edge. Same content, two different-looking screens — so this follows the
 * admin, which is the one authors design against.
 */
const CONTENT_CARD_SHELL =
  "group h-full rounded-lg border-neutral-200 bg-card p-2 transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2";

/**
 * Inset thumbnail for a Content Structure card.
 *
 * A locked item gets the padlock centred ON the artwork behind a scrim, not a
 * small glyph tucked under the title: on a card whose image is the whole
 * visual, that is the only place the lock actually reads as "this is shut".
 *
 * No crossOrigin on these <img>s: nothing reads their pixels, and a CORS
 * request fails outright on a CDN copy cached without Access-Control-Allow-Origin
 * — the card showed a broken image while the admin's plain <img> loaded fine.
 */
const ContentCardThumb = ({
  url,
  fallback,
  locked,
  fit = "cover",
}: {
  url?: string;
  fallback: React.ReactNode;
  locked?: boolean;
  fit?: ContentCardImageFit;
}) => (
  <div className="relative mb-2 flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-neutral-50">
    {url ? (
      <img
        src={url}
        alt=""
        className={cn(
          "size-full",
          fit === "contain" ? "object-contain" : "object-cover",
        )}
        referrerPolicy="no-referrer"
        loading="eager"
      />
    ) : (
      fallback
    )}
    {locked && (
      <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/45">
        <span className="flex size-11 items-center justify-center rounded-full bg-white/95 shadow-sm">
          <Lock size={22} weight="fill" className="text-neutral-700" />
        </span>
      </div>
    )}
  </div>
);

export const CourseStructureDetails = ({
  selectedSession,
  selectedLevel,
  courseStructure,
  courseData,
  packageSessionId,
  selectedTab,
  isEnrolledInCourse,
  contentOnly,
  chapterOpensFirstSlide,
  contentCardImageFit = "cover",
  onLoadingChange,
  updateModuleStats,
  paymentType,
  dripConditionJson,
  courseInitSubjects,
}: {
  selectedSession: string;
  selectedLevel: string;
  courseStructure: number;
  courseData: CourseDetailsFormValues;
  packageSessionId: string;
  selectedTab: string;
  isEnrolledInCourse?: boolean;
  /** "contentOnly" course-details layout: this card is the whole page, so the
   *  tab strip collapses to Content Structure regardless of what the tab
   *  settings say. See EnrolledCourseLayout in student-display-settings. */
  contentOnly?: boolean;
  /** Tapping a chapter card opens its first available slide in the viewer
   *  instead of listing the chapter's slides. Resolved by the page from
   *  courseDetails.chapterOpensFirstSlide. */
  chapterOpensFirstSlide?: boolean;
  /** How Content Structure card thumbnails fit their frame. Default "cover",
   *  which crops to fill and matches the admin dashboard. */
  contentCardImageFit?: ContentCardImageFit;
  onLoadingChange?: (loading: boolean) => void;
  updateModuleStats?: (
    modulesData: Record<string, Array<{ chapters?: Array<unknown> }>>,
  ) => void;
  paymentType?: string | null;
  dripConditionJson?: string | null;
  /** Subjects from course-init (first session/level); used to call modules-with-chapters when form data isn't ready */
  courseInitSubjects?: CourseInitSubject[] | null;
}) => {
  const router = useRouter();
  const searchParams = router.state.location.search;
  const navigateTo = (
    pathname: string,
    searchParamsObj: Record<string, string | undefined>,
  ) => router.navigate({ to: pathname, search: searchParamsObj });
  const { setNavHeading } = useNavHeadingStore();

  const [studyLibraryData, setStudyLibraryData] = useState<SubjectType[]>([]);
  const [showContentPrefixes, setShowContentPrefixes] = useState<boolean>(true);
  // Helper: format video duration from millis to h:mm:ss or m:ss
  // Outline meta shows rounded minutes ("48 min", "1h 22m") — second
  // precision is noise in a course outline and the old "47:36 mins" read as
  // a mislabeled clock time.
  const formatDuration = useCallback((millis?: number | null): string => {
    if (!millis || millis <= 0) return "";
    const totalMinutes = Math.max(1, Math.round(millis / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    return `${totalMinutes} min`;
  }, []);

  // Helper: compute short meta text for a slide
  const getSlideMetaText = useCallback(
    (slide: Slide): string => {
      // Prefer document/video/question/assignment specifics
      if (slide.document_slide) {
        const pages: number | undefined =
          (slide.document_slide as { published_document_total_pages?: number })
            .published_document_total_pages ?? slide.document_slide.total_pages;
        if (typeof pages === "number" && pages > 0) return `${pages} pages`;
      }
      if (slide.video_slide) {
        const ms: number | undefined =
          (slide.video_slide as { published_video_length_in_millis?: number })
            .published_video_length_in_millis ??
          slide.video_slide.video_length_in_millis;
        const text = formatDuration(ms);
        if (text) return text;
      }
      if (slide.question_slide) {
        const qType = slide.question_slide.question_type;
        if (qType) return qType;
      }
      if (slide.assignment_slide) {
        const end = slide.assignment_slide.end_date;
        if (end) {
          // Backend now returns LocalDateTime (e.g. "2026-03-25T23:59:00"),
          // with legacy date-only ("2026-03-25") still possible. Normalize.
          try {
            const normalized = end.length <= 10 ? `${end}T00:00:00` : end;
            // Short form keeps the meta cluster inline on mobile; the exact
            // time lives on the slide page itself.
            return `Due ${format(parseISO(normalized), "MMM d")}`;
          } catch {
            return `Due ${end}`;
          }
        }
      }
      return "";
    },
    [formatDuration],
  );

  // Module progress: the server's rollup, rendered as-is.
  //
  // Previously this re-averaged the chapters we had loaded, which quietly
  // reimplemented the backend's rule — and got it wrong in two ways at once:
  // chapters whose slides hadn't been fetched counted as 0%, and chapters with
  // no learner-visible slides at all counted as 0% forever (the reason a course
  // could sit at 67% with every reachable chapter finished).
  const calculateModuleProgress = (mod: ModuleWithChapters): number =>
    Math.round(mod?.percentage_completed ?? 0);

  // Subject progress = mean of its MODULE percentages, skipping modules the
  // server scored as null.
  //
  // Null means "no learner-visible content in here at all" (no chapters, or
  // every chapter empty), which is different from 0%. Averaging it in as 0
  // would let an empty module drag the subject down with work the learner
  // cannot do, the same bug the module denominator has one level lower.
  const calculateSubjectProgress = (subjectId: string): number => {
    const modules = subjectModulesMap[subjectId] ?? [];
    const countedModules = modules.filter(
      (mod) => mod.percentage_completed !== null && mod.percentage_completed !== undefined,
    );
    if (countedModules.length === 0) return 0;

    const totalProgress = countedModules.reduce(
      (sum, mod) => sum + (mod.percentage_completed ?? 0),
      0,
    );

    return Math.round(totalProgress / countedModules.length);
  };

  // Helper: render progress bar
  const renderProgressBar = (percentage: number, size: "sm" | "md" = "sm") => {
    const height = size === "sm" ? "h-1" : "h-2";
    const radius = size === "sm" ? "rounded-full" : "rounded";

    return (
      <div className={`w-full ${height} bg-muted ${radius} overflow-hidden`}>
        <div
          className={`${height} bg-primary-500 [.ui-play_&]:bg-play-success ${radius} transition-all duration-300 ease-in-out`}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>
    );
  };

  // Single status rail: one left icon per row tells the whole story
  // (complete / in progress / not started / locked).
  const renderStatusIcon = (
    percentage: number,
    options?: { locked?: boolean; size?: number; hideEmpty?: boolean },
  ) => {
    const size = options?.size ?? 16;
    if (options?.locked) {
      return <Lock size={size} className="shrink-0 text-muted-foreground" />;
    }
    if (percentage >= getSlideCompletionThreshold()) {
      return (
        <CheckCircle
          size={size}
          weight="fill"
          className="shrink-0 text-success-500"
        />
      );
    }
    if (percentage > 0) {
      return (
        <CircleHalf
          size={size}
          weight="fill"
          className="shrink-0 text-primary-500"
        />
      );
    }
    // Not started: status is only shown once earned. hideEmpty renders
    // nothing (slide meta cluster); otherwise an invisible spacer keeps
    // titles column-aligned between started/unstarted sibling rows.
    if (options?.hideEmpty) return null;
    return <Circle size={size} aria-hidden className="shrink-0 opacity-0" />;
  };

  // Helper: quiet completion text (status itself lives in the left icon).
  // Play contrast rule: ink on light surfaces, white on dark (navy) surfaces.
  const renderCompletionBadge = (
    percentage: number,
    options?: { onDark?: boolean },
  ) => {
    if (percentage === 0) return null;

    return (
      <span
        className={cn(
          "shrink-0 text-xs font-medium tabular-nums text-muted-foreground",
          options?.onDark
            ? "[.ui-play_&]:text-white/90"
            : "[.ui-play_&]:text-play-ink",
        )}
      >
        {Math.round(percentage)}%
      </span>
    );
  };
  // (removed) renderSlideSkeletonRow - unused helper

  // getSlideTypeDisplay (slide-type chips) reads the studyContent catalog via
  // raw i18n.t(); without this subscription the namespace never lazy-loads on
  // this page and the chips render literal keys ("slideType.video"). The hook
  // both loads the catalog and re-renders this component when it arrives.
  useTranslation("studyContent");

  type LocalTab = { label: string; value: string };
  const [filteredTabs, setFilteredTabs] = useState<LocalTab[]>([]);

  const [selectedStructureTab, setSelectedStructureTab] = useState<string>(
    TabType.OUTLINE,
  );
  // const [showCourseDiscussion, setShowCourseDiscussion] = useState(false);
  const handleTabChange = (value: string) => setSelectedStructureTab(value);
  // Enforce Course Details tabs (visibility/order/default) from settings
  useEffect(() => {
    const mapSettingIdToValue = (
      id: StudentCourseDetailsTabId,
    ): (typeof TabType)[keyof typeof TabType] => {
      switch (id) {
        case "OUTLINE":
          return TabType.OUTLINE;
        case "CONTENT_STRUCTURE":
          return TabType.CONTENT_STRUCTURE;
        case "TEACHERS":
          return TabType.TEACHERS;
        case "ASSESSMENTS":
          return TabType.ASSESSMENT;
        default:
          return TabType.OUTLINE;
      }
    };

    // Tabs whose content is still a "coming soon" placeholder. Keep them out
    // of the tab list until they render real content (their tabContent
    // entries below are intentionally retained for when they go live).
    const placeholderTabs: string[] = [TabType.TEACHERS, TabType.ASSESSMENT];

    getStudentDisplaySettings(false).then(async (settings) => {
      const tabsSetting = settings?.courseDetails?.tabs || [];
      const ordered = tabsSetting
        .filter((t) => t.visible !== false)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((t) => ({
          label:
            t.label ||
            tabs.find((x) => x.value === mapSettingIdToValue(t.id))?.label ||
            t.id,
          value: mapSettingIdToValue(t.id),
        }))
        .filter((t) => !placeholderTabs.includes(t.value));

      // The Course Discussion tab is gated on chat being enabled for the
      // institute (chat is OFF by default; getChatEnabled fails closed when
      // the flag is unknown/loading/errored). chat.enabled is now the
      // authoritative gate — the legacy notifications.allowBatchStream flag no
      // longer controls this tab.
      const chatEnabled = await getChatEnabled();
      const shouldShowCourseDiscussion = chatEnabled === true;
      // setShowCourseDiscussion(shouldShowCourseDiscussion);

      // Fallback: ensure CONTENT_STRUCTURE appears if visible in settings but mapping missed
      const hasContentStructureSetting = tabsSetting.some(
        (t) => t.id === "CONTENT_STRUCTURE" && t.visible !== false,
      );
      const hasContentStructureMapped = ordered.some(
        (t) => t.value === TabType.CONTENT_STRUCTURE,
      );
      const finalTabs = [...ordered];
      if (hasContentStructureSetting && !hasContentStructureMapped) {
        finalTabs.push({
          label: "Content Structure",
          value: TabType.CONTENT_STRUCTURE,
        });
      }

      // Add course discussion tab if enabled
      if (shouldShowCourseDiscussion) {
        finalTabs.push({
          label: `${getTerminology(ContentTerms.Course, SystemTerms.Course)} Discussion`,
          value: TabType.COURSE_DISCUSSION,
        });
      }

      if (finalTabs.length) setFilteredTabs(finalTabs as typeof tabs);

      // New: respect content prefix visibility
      const resolvedShowPrefixes =
        settings?.courseDetails?.showCourseContentPrefixes !== false;

      setShowContentPrefixes(resolvedShowPrefixes);

      const defaultTabId = settings?.courseDetails?.defaultTab || "OUTLINE";
      const defaultValue = mapSettingIdToValue(defaultTabId);
      const isDefaultVisible = ordered.some((t) => t.value === defaultValue);
      const firstVisible = (ordered[0]?.value as string) || TabType.OUTLINE;
      const resolvedDefault = isDefaultVisible
        ? (defaultValue as string)
        : firstVisible;

      setSelectedStructureTab(resolvedDefault);
    });
  }, []);

  const renderTabs = useMemo(() => {
    // Content-only layout: one tab, so the strip hides itself (the render
    // below only draws it for 2+). Keep the settings label if the institute
    // renamed the tab, since the terminology carries over to the card header.
    if (contentOnly) {
      const configured = filteredTabs.find(
        (t) => t.value === TabType.CONTENT_STRUCTURE,
      );
      return [
        {
          label: configured?.label || "Content Structure",
          value: TabType.CONTENT_STRUCTURE as string,
        },
      ];
    }

    const priorityOrder = [
      TabType.OUTLINE,
      TabType.CONTENT_STRUCTURE,
      TabType.COURSE_DISCUSSION,
    ];
    const byValue = new Map(filteredTabs.map((t) => [t.value, t]));
    const prioritized = priorityOrder
      .filter((v) => byValue.has(v))
      .map((v) => byValue.get(v)!) as { label: string; value: string }[];
    const rest = filteredTabs.filter(
      (t) => !priorityOrder.includes(t.value as TabType),
    );
    const finalArr = [...prioritized, ...rest];

    return finalArr;
  }, [filteredTabs, contentOnly]);

  // With one tab and no strip to change it from, the settings-driven default
  // (usually OUTLINE) would leave the card rendering the wrong view forever.
  const activeStructureTab = contentOnly
    ? (TabType.CONTENT_STRUCTURE as string)
    : selectedStructureTab;

  // Card grid for the Content Structure drill-down. The default layout squeezes
  // this card into two thirds of the page, so it packs two cards per row even on
  // a phone. In the content-only layout the grid IS the page — full width and
  // the learner's only way into the course — so the cards get room to breathe:
  // one per row on phones, and no drop back to two columns at lg.
  const contentGridClass = cn(
    "grid gap-4",
    contentOnly
      ? CONTENT_ONLY_CARD_GRID
      : "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
  );

  const [subjectModulesMap, setSubjectModulesMap] = useState<SubjectModulesMap>(
    {},
  );
  const [slidesMap, setSlidesMap] = useState<Record<string, Slide[]>>({});
  const [slidesLoadingStatus, setSlidesLoadingStatus] = useState<
    Record<string, "idle" | "loading" | "loaded" | "error">
  >({});
  const [isModulesLoading, setIsModulesLoading] = useState<boolean>(false);
  const queryClient = useQueryClient();

  // Chapter id -> server-computed percentage, flattened from the loaded modules.
  const chapterPercentById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const modules of Object.values(subjectModulesMap)) {
      for (const mod of modules) {
        for (const chapter of mod.chapters ?? []) {
          map[chapter.id] = chapter.percentage_completed ?? 0;
        }
      }
    }
    return map;
  }, [subjectModulesMap]);

  // Chapter progress comes from the server, not from re-averaging the slides
  // we happen to have fetched.
  //
  // This tree used to compute its own chapter/module/subject percentages from
  // slidesMap. That made it a second, parallel implementation of a rule the
  // backend already owns, and the two drifted: the tree counted chapters it
  // hadn't loaded as 0%, applied a different completion rule, and rendered a
  // number that contradicted the course card on the same screen. Both of the
  // bugs this change set fixes were that drift showing through.
  //
  // Staleness is handled by invalidation, not by recomputing: the rollup
  // cascade runs @Async, and refreshProgressAfterSubmit re-invalidates this
  // page's query (MODULES_WITH_CHAPTERS_RESOLVED) across several backoff waves
  // after any slide submit.
  const calculateChapterProgress = useCallback(
    (chapterId: string): number => chapterPercentById[chapterId] ?? 0,
    [chapterPercentById],
  );

  // Get drip condition from store as fallback if not provided via props
  const getDripCondition = useDripConditionStore(
    (state) => state.getDripCondition,
  );
  const isDrippingEnable = useDripConditionStore(
    (state) => state.isDrippingEnable,
  );
  const effectiveDripConditionJson =
    dripConditionJson ||
    (searchParams.courseId ? getDripCondition(searchParams.courseId) : null);

  const { condition: chapterCondition, hasConditions: hasChapterConditions } =
    useDripConditions(effectiveDripConditionJson, "chapter");
  const { condition: slideCondition, hasConditions: hasSlideConditions } =
    useDripConditions(effectiveDripConditionJson, "slide");

  // Conditions the admin actually configured (they are saved into the
  // institute's course settings, not onto the content rows), plus the
  // learner's own day-1 anchor for day-wise schedules.
  const dripSchedule = useCourseDripSchedule(
    searchParams.courseId,
    packageSessionId,
  );
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

  // Drill-down state for Content Structure tab
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(
    null,
  );
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    null,
  );
  const [thumbUrlById, setThumbUrlById] = useState<Record<string, string>>({});

  // Donation dialog state
  const [donationDialogOpen, setDonationDialogOpen] = useState(false);
  const [targetSlideDetails, setTargetSlideDetails] = useState<{
    courseId: string;
    subjectId: string;
    moduleId: string;
    chapterId: string;
    slideId: string;
  } | null>(null);
  const [instituteId, setInstituteId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string>("");

  // Use enrollment status hook
  const { userHasDonated } = useEnrollmentStatus(instituteId);

  // Log enrollment status changes
  useEffect(() => {}, [instituteId, userHasDonated, isEnrolledInCourse]);
  // const [thumbUrlById, setThumbUrlById] = useState<Record<string, string>>({});

  // course_depth decides which levels a course exposes: 5 shows
  // subject -> module -> chapter -> slide, 4 drops the subject, 3 also drops
  // the module, and 2 is slides only. The hidden levels still exist in the
  // data — a course created below depth 5 gets a seeded subject/module/chapter
  // named "DEFAULT" to hang content off — which is why a 2-level course used
  // to render three "Default" rows above every slide.
  //
  // Depth alone is NOT enough to hide a level, though: a level is only safe to
  // drop when it collapses to that single placeholder. Some older depth-3
  // courses really do carry several subjects/modules, and there the crumbs are
  // the learner's only route to the siblings the preselect effect skipped —
  // hiding them would strand that content.
  const allModulesFlat = useMemo(
    () => Object.values(subjectModulesMap).flat(),
    [subjectModulesMap],
  );
  const allChaptersFlat = useMemo(
    () => allModulesFlat.flatMap((mod) => mod.chapters ?? []),
    [allModulesFlat],
  );
  const isPlaceholderName = (name?: string | null) =>
    (name || "").trim().toLowerCase() === "default";

  const showsSubjectLevel = !(
    courseStructure < 5 &&
    studyLibraryData.length === 1 &&
    isPlaceholderName(studyLibraryData[0]?.subject_name)
  );
  const showsModuleLevel = !(
    courseStructure < 4 &&
    allModulesFlat.length === 1 &&
    isPlaceholderName(allModulesFlat[0]?.module.module_name)
  );
  const chapterLevelIsPlaceholder =
    courseStructure < 3 &&
    allChaptersFlat.length === 1 &&
    isPlaceholderName(allChaptersFlat[0]?.chapter_name);
  const showsChapterLevel = !chapterLevelIsPlaceholder;

  // Evaluate drip conditions for chapters
  const chapterEvaluations = useMemo(() => {
    // Build progress data for all chapters
    const allChapters = Object.values(subjectModulesMap)
      .flatMap((modules) => modules)
      .flatMap((mod) => mod.chapters);

    // Build prerequisite completions map for chapters
    const prerequisiteCompletions: Record<string, number> = {};
    allChapters.forEach((chapter) => {
      const progress = calculateChapterProgress(chapter.id);
      prerequisiteCompletions[chapter.id] = progress;
    });

    const progressDataByChapterId: Record<string, LearnerProgressData> = {};
    allChapters.forEach((chapter, index) => {
      const previousChapter = index > 0 ? allChapters[index - 1] : null;
      const progress = calculateChapterProgress(chapter.id);
      progressDataByChapterId[chapter.id] = {
        percentageCompleted: progress,
        previousItemId: previousChapter?.id,
        previousItemCompletion: previousChapter
          ? calculateChapterProgress(previousChapter.id)
          : 0,
        itemIndex: index, // Add index for count-based exception logic
        prerequisiteCompletions, // Add prerequisite completions map
        // Progress of every chapter before this one, in course order.
        recentScores: allChapters
          .slice(0, index)
          .map((prev) => calculateChapterProgress(prev.id)),
        ...dripAnchors,
      };
    });

    // Evaluate drip conditions - check per-chapter conditions first
    const evaluations: Record<string, DripConditionEvaluation> = {};

    for (const chapter of allChapters) {
      const progressData = progressDataByChapterId[chapter.id];

      // Check if this chapter has its own drip condition (check both fields)
      let chapterDripCondition = null;
      const dripConditionData = chapter.drip_condition;

      if (dripConditionData) {
        try {
          const parsed =
            typeof dripConditionData === "string"
              ? JSON.parse(dripConditionData)
              : dripConditionData;

          // Handle array of conditions - filter for enabled chapter conditions
          if (Array.isArray(parsed)) {
            chapterDripCondition =
              parsed.find(
                (cond) =>
                  (cond.target === "chapter" || !cond.target) &&
                  cond.is_enabled !== false,
              ) || null;
          } else if (parsed && typeof parsed === "object") {
            // Single condition - check if enabled and for chapters
            if (
              (parsed.target === "chapter" || !parsed.target) &&
              parsed.is_enabled !== false
            ) {
              chapterDripCondition = parsed;
            }
          }
        } catch (e) {
          console.error("Failed to parse chapter drip condition:", e);
        }
      }

      // What the admin configured wins: those conditions live in the institute's
      // course settings, which is the only place the dashboard writes them.
      // The row's own drip_condition and the package-level fallback are kept
      // for anything saved before that path existed.
      const configuredCondition = dripConditionFor("chapter", chapter.id);
      const conditionToUse =
        configuredCondition || chapterDripCondition || chapterCondition;
      const hasCondition =
        !!configuredCondition || !!chapterDripCondition || hasChapterConditions;

      // Two independent switches, deliberately not merged: `isDrippingEnable`
      // owns the original row-level path, while a configured condition has
      // already passed the new path's own opt-in inside conditionFor.
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
      evaluations[chapter.id] = evaluation;
    }
    return evaluations;
  }, [
    hasChapterConditions,
    chapterCondition,
    subjectModulesMap,
    calculateChapterProgress,
    isDrippingEnable,
    dripConditionFor,
    dripAnchors,
    dripNow,
  ]);

  // Evaluate drip conditions for slides
  const slideEvaluations = useMemo(() => {
    const evaluations: Record<string, DripConditionEvaluation> = {};

    // Build comprehensive prerequisite completions map with BOTH chapters and slides
    const prerequisiteCompletions: Record<string, number> = {};

    // 1. Add all chapters and their progress
    const allChapters = Object.values(subjectModulesMap)
      .flatMap((modules) => modules)
      .flatMap((mod) => mod.chapters);

    allChapters.forEach((chapter) => {
      const progress = calculateChapterProgress(chapter.id);
      prerequisiteCompletions[chapter.id] = progress;
    });

    // 2. Add all slides and their progress
    for (const slides of Object.values(slidesMap)) {
      slides.forEach((slide) => {
        prerequisiteCompletions[slide.id] = slide.percentage_completed || 0;
      });
    }

    for (const slides of Object.values(slidesMap)) {
      slides.forEach((slide, index) => {
        const previousSlide = index > 0 ? slides[index - 1] : null;
        const progressData: LearnerProgressData = {
          percentageCompleted: slide.percentage_completed || 0,
          previousItemId: previousSlide?.id,
          previousItemCompletion: previousSlide?.percentage_completed || 0,
          itemIndex: index, // Add index for count-based exception logic
          prerequisiteCompletions, // Add prerequisite completions map
          // Completion of every slide before this one within the chapter.
          recentScores: slides
            .slice(0, index)
            .map((s) => s.percentage_completed || 0),
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
                    cond.is_enabled !== false,
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

        // Admin-configured conditions win over anything stamped on the row —
        // see the chapter evaluation above for why.
        const configuredCondition = dripConditionFor("slide", slide.id);
        const conditionToUse =
          configuredCondition || slideDripCondition || slideCondition;
        const hasCondition =
          !!configuredCondition || !!slideDripCondition || hasSlideConditions;

        // See the chapter evaluation above for why these stay separate.
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

        evaluations[slide.id] = evaluation;
      });
    }
    return evaluations;
  }, [
    hasSlideConditions,
    slideCondition,
    slidesMap,
    isDrippingEnable,
    subjectModulesMap,
    calculateChapterProgress,
    dripConditionFor,
    dripAnchors,
    dripNow,
  ]);

  /**
   * Locks for the two levels above a chapter.
   *
   * Subjects and modules carry no progress of their own, so their rules are
   * evaluated against the rolled-up percentage the cards already show. Ordering
   * is course order, which is what a "one module per day" schedule counts in.
   */
  const buildContainerEvaluations = useCallback(
    (
      level: "subject" | "module",
      items: Array<{ id: string; percentage: number }>,
    ): Record<string, DripConditionEvaluation> => {
      const evaluations: Record<string, DripConditionEvaluation> = {};
      const prerequisiteCompletions: Record<string, number> = {};
      items.forEach((item) => {
        prerequisiteCompletions[item.id] = item.percentage;
      });

      items.forEach((item, index) => {
        // Subject and module locking exists only on the new path, so
        // conditionFor's opt-in is the whole gate — the old row-level switch
        // never governed these levels and must not be consulted here.
        const condition = dripConditionFor(level, item.id);
        if (!condition || condition.is_enabled === false) {
          evaluations[item.id] = {
            isLocked: false,
            isHidden: false,
            unlockMessage: null,
          };
          return;
        }
        evaluations[item.id] = evaluateDripCondition(
          condition,
          {
          percentageCompleted: item.percentage,
          previousItemId: index > 0 ? items[index - 1]?.id : undefined,
          previousItemCompletion:
            index > 0 ? (items[index - 1]?.percentage ?? 0) : 0,
          itemIndex: index,
          prerequisiteCompletions,
          recentScores: items.slice(0, index).map((prev) => prev.percentage),
          ...dripAnchors,
          },
          dripNow ? new Date(dripNow) : new Date(),
        );
      });
      return evaluations;
    },
    [dripConditionFor, dripAnchors, dripNow],
  );

  const subjectEvaluations = useMemo(
    () =>
      buildContainerEvaluations(
        "subject",
        (studyLibraryData ?? []).map((subject) => ({
          id: subject.id,
          percentage: calculateSubjectProgress(subject.id),
        })),
      ),
    // calculateSubjectProgress reads subjectModulesMap, so that map is the
    // real input here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildContainerEvaluations, studyLibraryData, subjectModulesMap],
  );

  const moduleEvaluations = useMemo(
    () =>
      buildContainerEvaluations(
        "module",
        Object.values(subjectModulesMap)
          .flatMap((modules) => modules)
          .map((mod) => ({
            id: mod.module.id,
            percentage: calculateModuleProgress(mod),
          })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildContainerEvaluations, subjectModulesMap],
  );

  // Helpers to safely extract optional thumbnail IDs without using any
  const getSubjectThumbnailId = (subject: SubjectType): string | undefined => {
    return (
      (subject as unknown as { thumbnail_id?: string | null }).thumbnail_id ||
      undefined
    );
  };
  const getModuleThumbnailId = (mod: Module): string | undefined => {
    return (
      (mod as unknown as { thumbnail_id?: string | null }).thumbnail_id ||
      undefined
    );
  };

  // Fetch institute ID and auth token
  useEffect(() => {
    const fetchInstituteAndAuth = async () => {
      try {
        // Get institute ID from preferences
        const instituteResult = await Preferences.get({ key: "InstituteId" });
        setInstituteId(instituteResult.value || null);

        // Get auth token
        const token = await getTokenFromStorage(TokenKey.accessToken);
        setAuthToken(token || "");
      } catch {
        // Silent error handling
      }
    };

    fetchInstituteAndAuth();
  }, []);

  // Ensure subject thumbnails are fetched for Content Structure top level
  useEffect(() => {
    const prefetchTopLevelSubjects = async () => {
      if (selectedSubjectId) return; // already drilled down
      const subjects = studyLibraryData ?? [];
      if (subjects.length === 0) return;

      const pending = subjects
        .map((s) => ({
          key: `subject:${s.id}`,
          fileId: getSubjectThumbnailId(s),
        }))
        .filter(
          ({ key, fileId }) => Boolean(fileId) && !thumbUrlById[key],
        ) as Array<{ key: string; fileId: string }>;
      if (pending.length === 0) return;

      const results = await Promise.all(
        pending.map(async ({ key, fileId }) => {
          try {
            const url = await queryClient.fetchQuery(
              getFilePublicUrlQuery(fileId),
            );

            return { key, url } as const;
          } catch {
            return { key, url: "" } as const;
          }
        }),
      );
      const updates: Record<string, string> = {};
      for (const { key, url } of results) if (url) updates[key] = url;
      if (Object.keys(updates).length > 0)
        setThumbUrlById((prev) => ({ ...prev, ...updates }));
    };
    prefetchTopLevelSubjects();
  }, [selectedSubjectId, studyLibraryData, thumbUrlById]);

  const handleSlideNavigation = async (
    subjectId: string,
    moduleId: string,
    chapterId: string,
    slideId: string,
  ) => {
    // Allow navigation if user is enrolled in the course OR if it's PROGRESS/COMPLETED tabs
    if (
      isEnrolledInCourse ||
      selectedTab === "PROGRESS" ||
      selectedTab === "COMPLETED"
    ) {
      // Default behavior: Direct navigation for enrolled users
      // Only show donation dialog if payment type is specifically "DONATION"
      if (
        paymentType &&
        paymentType.toLowerCase() === "donation" &&
        isEnrolledInCourse
      ) {
        // For donation type, check donation status
        if (userHasDonated === false) {
          // Show donation dialog for slide access
          setTargetSlideDetails({
            courseId: searchParams.courseId || "",
            subjectId,
            moduleId,
            chapterId,
            slideId,
          });
          setDonationDialogOpen(true);
          return;
        }
      }

      // Default: Navigate directly to slide (for all non-donation types or when payment type is not loaded)

      navigateTo(
        `/study-library/courses/course-details/subjects/modules/chapters/slides`,
        {
          courseId: searchParams.courseId,
          subjectId,
          moduleId,
          chapterId,
          slideId,
          sessionId: packageSessionId || "",
        },
      );
    }
    // For ALL tab when not enrolled, do nothing (view-only mode)
  };

  // Helper function to determine if slides should be clickable
  const isSlideClickable = () => {
    // If user is enrolled, slides are clickable in ALL tabs
    // If not enrolled, slides are only clickable in PROGRESS/COMPLETED tabs
    return (
      isEnrolledInCourse ||
      selectedTab === "PROGRESS" ||
      selectedTab === "COMPLETED"
    );
  };

  // Helper function to get slide styling based on clickability
  const getSlideStyling = () => {
    if (isSlideClickable()) {
      return "group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/60";
    } else {
      return "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground";
    }
  };

  // Track in-flight requests to prevent duplicate API calls
  const slidesRequestsRef = useRef<Set<string>>(new Set());

  const getSlidesWithChapterId = useCallback(
    async (chapterId: string) => {
      const key = String(chapterId);
      setSlidesLoadingStatus((prevStatus) => {
        if (prevStatus[key] === "loaded" || prevStatus[key] === "loading") {
          return prevStatus;
        }
        return { ...prevStatus, [key]: "loading" };
      });

      if (slidesRequestsRef.current.has(key)) {
        return;
      }
      slidesRequestsRef.current.add(key);

      try {
        const raw = await queryClient.fetchQuery({
          queryKey: ["slides", chapterId],
          queryFn: () => fetchSlidesByChapterId(chapterId),
          staleTime: 15_000,
        });
        // Normalize both response shapes (bare array | { data: [...] }) to Slide[]
        const slides: Slide[] = Array.isArray(raw)
          ? (raw as Slide[])
          : ((raw as { data?: Slide[] } | null | undefined)?.data ?? []);
        setSlidesMap((prev) => ({ ...prev, [key]: slides }));
        setSlidesLoadingStatus((prev) => ({ ...prev, [key]: "loaded" }));
      } catch {
        setSlidesLoadingStatus((prev) => ({ ...prev, [key]: "error" }));
      } finally {
        slidesRequestsRef.current.delete(key);
      }
    },
    [queryClient],
  );

  /**
   * Content-only layout: a chapter card opens the first slide in the viewer
   * instead of drilling into a slide list. That list was a dead stop in this
   * layout — the viewer's own Prev/Next already walks the chapter, so the
   * extra screen only added a tap between the learner and the content.
   *
   * Returns false when it could not resolve a slide to open (nothing loaded,
   * empty chapter, or everything drip-locked); the caller then falls back to
   * the slide list, which is the only surface that can explain why.
   */
  const openFirstSlideInChapter = useCallback(
    async (
      subjectId: string,
      moduleId: string,
      chapterId: string
    ): Promise<boolean> => {
      let slides = slidesMap[chapterId];
      if (!slides) {
        try {
          const raw = await queryClient.fetchQuery({
            queryKey: ["slides", chapterId],
            queryFn: () => fetchSlidesByChapterId(chapterId),
            staleTime: 15_000,
          });
          slides = Array.isArray(raw)
            ? (raw as Slide[])
            : ((raw as { data?: Slide[] } | null | undefined)?.data ?? []);
          // Seed the map so the fallback list has data if we bail out below.
          const loaded = slides;
          setSlidesMap((prev) => ({ ...prev, [chapterId]: loaded }));
          setSlidesLoadingStatus((prev) => ({ ...prev, [chapterId]: "loaded" }));
        } catch {
          return false;
        }
      }

      const target = (slides || []).find((sl) => {
        const evaluation = slideEvaluations[sl.id];
        return !evaluation?.isHidden && !evaluation?.isLocked;
      });
      if (!target) return false;

      await handleSlideNavigation(subjectId, moduleId, chapterId, target.id);
      return true;
    },
    // handleSlideNavigation is re-created every render (it closes over dialog
    // state); referencing it here would defeat the memo, and it is stable in
    // behaviour, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slidesMap, slideEvaluations, queryClient]
  );

  const loadAllSlidesBulk = useCallback(
    async (chapterIds: string[]): Promise<boolean> => {
      if (!packageSessionId) return false;
      // Mark requested chapters as loading so the open-chapter effect doesn't
      // start parallel per-chapter fetches while the bulk request is in flight.
      setSlidesLoadingStatus((prev) => {
        const next = { ...prev };
        chapterIds.forEach((id) => {
          if (next[id] !== "loaded") next[id] = "loading";
        });
        return next;
      });
      try {
        const chapters = await queryClient.fetchQuery({
          queryKey: ["slides", "by-package-session", packageSessionId],
          queryFn: () => fetchSlidesByPackageSession(packageSessionId),
          staleTime: 0,
        });
        const mapUpdates: Record<string, Slide[]> = {};
        // Chapters missing from the response simply have no slides — same as
        // the per-chapter endpoint returning [].
        chapterIds.forEach((id) => {
          mapUpdates[id] = [];
        });
        chapters.forEach((entry) => {
          if (!entry?.chapter_id) return;
          mapUpdates[entry.chapter_id] = Array.isArray(entry.slides)
            ? entry.slides
            : [];
        });
        Object.entries(mapUpdates).forEach(([id, slides]) => {
          queryClient.setQueryData(["slides", id], slides);
        });
        setSlidesMap((prev) => ({ ...prev, ...mapUpdates }));
        setSlidesLoadingStatus((prev) => {
          const next = { ...prev };
          Object.keys(mapUpdates).forEach((id) => {
            next[id] = "loaded";
          });
          return next;
        });
        return true;
      } catch {
        // Roll the loading marks back so the per-chapter fallback (and the
        // open-chapter effect) can fetch normally.
        setSlidesLoadingStatus((prev) => {
          const next = { ...prev };
          chapterIds.forEach((id) => {
            if (next[id] === "loading") next[id] = "idle";
          });
          return next;
        });
        return false;
      }
    },
    [packageSessionId, queryClient],
  );

  const loadAllSlidesBulkRef = useRef(loadAllSlidesBulk);
  useEffect(() => {
    loadAllSlidesBulkRef.current = loadAllSlidesBulk;
  }, [loadAllSlidesBulk]);

  const useModulesMutation = () => {
    return useMutation({
      mutationFn: async ({
        subjects: currentSubjects,
      }: {
        subjects: SubjectType[];
      }) => {
        // Ensure packageSessionId is available for all course depths
        if (!packageSessionId) {
          throw new Error(
            "Package session ID is required for fetching modules",
          );
        }

        const results = await Promise.all(
          currentSubjects?.map(async (subject) => {
            // Cache the RESOLVED result (private + public fallback) per
            // subject/packageSession: the selection effects can legitimately
            // run this twice while session/level settle (course-init subjects
            // first, form subjects after reset), and without a cache each
            // round re-fires every request. Own key namespace — the shared
            // GET_MODULES_WITH_CHAPTERS query's queryFn writes to a zustand
            // store as a side effect, which serving from cache would skip.
            const res = await queryClient.fetchQuery({
              queryKey: [
                "MODULES_WITH_CHAPTERS_RESOLVED",
                subject.id,
                packageSessionId,
              ],
              queryFn: async () => {
                // For depth 5 courses, try using the public endpoint first
                let r = await fetchModulesWithChapters(
                  subject.id,
                  packageSessionId,
                );
                // Fallback: if private returns empty, try public once (for ALL tab/unenrolled visibility)
                if (Array.isArray(r) && r.length === 0) {
                  try {
                    const alt = await fetchModulesWithChaptersPublic(
                      subject.id,
                      packageSessionId,
                    );
                    if (Array.isArray(alt) && alt.length > 0) {
                      r = alt;
                    }
                  } catch {
                    // ignore
                  }
                }
                return r;
              },
              staleTime: 60_000,
            });

            return { subjectId: subject.id, modules: res };
          }),
        );

        const modulesMap: SubjectModulesMap = {};
        results.forEach(({ subjectId, modules }) => {
          modulesMap[subjectId] = modules;
        });

        return modulesMap;
      },
    });
  };

  const { mutateAsync: fetchModules } = useModulesMutation();

  // Memoized callback for loading state changes
  const handleLoadingChange = useCallback(
    (loading: boolean) => {
      if (onLoadingChange) {
        onLoadingChange(loading);
      }
    },
    [onLoadingChange],
  );

  const refreshData = async () => {
    if (!packageSessionId) {
      return;
    }
    // Explicit user refresh (pull-to-refresh): drop the cached modules/slides
    // so the reload below actually hits the network.
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["MODULES_WITH_CHAPTERS_RESOLVED"],
      }),
      queryClient.invalidateQueries({ queryKey: ["slides"] }),
    ]);
    // Refresh by reloading modules
    try {
      setIsModulesLoading(true);
      const modulesMap = await fetchModules({
        subjects: getSubjectDetails(courseData, selectedSession, selectedLevel),
      });
      setSubjectModulesMap(modulesMap);

      // Update module stats for parent component
      if (updateModuleStats) {
        updateModuleStats(modulesMap);
      }
    } catch {
      // Silent error handling
    } finally {
      setIsModulesLoading(false);
    }
  };

  const [openSubjects, setOpenSubjects] = useState<Set<string>>(new Set());
  const [openModules, setOpenModules] = useState<Set<string>>(new Set());
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [onlyIncomplete, setOnlyIncomplete] = useState<boolean>(false);

  // Resume thread: when the learner's latest resume point is in this course,
  // auto-expand the chain to "you are here" and mark that slide row.
  const resumeEntry = useMemo(() => {
    const latest = getLatestResume();
    if (
      !latest ||
      !searchParams.courseId ||
      latest.courseId !== searchParams.courseId
    ) {
      return null;
    }
    return latest;
  }, [searchParams.courseId]);
  const resumeEntryRef = useRef(resumeEntry);
  useEffect(() => {
    resumeEntryRef.current = resumeEntry;
  }, [resumeEntry]);

  // Quiet "Continue" chip on the resume slide row
  const renderContinueChip = (slideId: string) => {
    if (!resumeEntry || resumeEntry.slideId !== slideId) return null;
    return (
      <span className="ms-1 shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-500">
        Continue
      </span>
    );
  };

  const filterSlides = useCallback(
    (slides: Slide[]): Slide[] => {
      const q = searchQuery.trim().toLowerCase();
      return (slides || []).filter((sl) => {
        if (
          onlyIncomplete &&
          (sl.percentage_completed || 0) >= getSlideCompletionThreshold()
        )
          return false;
        if (!q) return true;
        const title = (sl.title || "").toLowerCase();
        const typeLabel = (getSlideTypeDisplay(sl) || "").toLowerCase();
        const meta = (getSlideMetaText(sl) || "").toLowerCase();
        return title.includes(q) || typeLabel.includes(q) || meta.includes(q);
      });
    },
    [searchQuery, onlyIncomplete, getSlideMetaText],
  );

  const toggleOpenState = (
    id: string,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  ) => {
    setter((prev) => {
      const updated = new Set(prev);
      if (updated.has(id)) {
        updated.delete(id);
      } else {
        updated.add(id);
      }
      return new Set(updated); // ensure a new Set reference
    });
  };

  const toggleSubject = (id: string) => toggleOpenState(id, setOpenSubjects);
  const toggleModule = (id: string) => toggleOpenState(id, setOpenModules);
  const toggleChapter = (id: string) => toggleOpenState(id, setOpenChapters);

  // Expand all functionality
  const expandAll = () => {
    if (!studyLibraryData) return;

    const allSubjectIds = new Set<string>(
      studyLibraryData.map((s: SubjectType) => s.id),
    );
    const allModuleIds = new Set<string>();
    const allChapterIds = new Set<string>();

    Object.values(subjectModulesMap).forEach((modules) => {
      modules.forEach((mod) => {
        allModuleIds.add(mod.module.id);
        mod.chapters.forEach((ch) => {
          allChapterIds.add(ch.id);
        });
      });
    });

    setOpenSubjects(allSubjectIds);
    setOpenModules(allModuleIds);
    setOpenChapters(allChapterIds);

    // Eager-load slides for all chapters so slide list shows when expanded.
    // Skip chapters the bulk load already covered or is covering — without
    // this, tapping Expand All while the bulk request is in flight refires
    // the per-chapter storm the bulk endpoint exists to prevent.
    allChapterIds.forEach((chapterId) => {
      const status = slidesLoadingStatus[chapterId] ?? "idle";
      if (status !== "loading" && status !== "loaded") {
        getSlidesWithChapterId(chapterId);
      }
    });
  };

  const collapseAll = () => {
    setOpenSubjects(new Set());
    setOpenModules(new Set());
    setOpenChapters(new Set());
  };

  const isAllExpanded =
    studyLibraryData?.every((subject: SubjectType) =>
      openSubjects.has(subject.id),
    ) &&
    Object.values(subjectModulesMap).every((modules) =>
      modules.every(
        (mod) =>
          openModules.has(mod.module.id) &&
          mod.chapters.every((ch) => openChapters.has(ch.id)),
      ),
    );

  const tabContent: Record<TabType, React.ReactNode> = {
    // All modes share ONE outline structure (owner decision 2026-06-11:
    // no mode-specific core views — play differs by color only). The
    // Duolingo path experiment lives unused in ./play/ChapterPathView.tsx.
    [TabType.OUTLINE]: (
      <div className="space-y-3">
        {/* Expand/Collapse Controls */}
        <div className="flex items-center justify-between border-b border-neutral-200 pb-2 gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Steps size={18} className="text-primary-500 shrink-0" />
            <span className="text-sm font-medium text-neutral-700 truncate">
              {getTerminology(ContentTerms.Course, SystemTerms.Course)}{" "}
              Structure
            </span>
            {/* Whole-course download. Its node is the package session itself,
                so it rolls up from the subjects below and reaches DOWNLOADED
                only once every savable slide in the course is stored. */}
            <DownloadNodeButton
              nodeId={packageSessionId ?? ""}
              nodeType="COURSE"
              packageSessionId={packageSessionId}
              compact
            />
          </div>
          <div className="flex items-center gap-2 ms-auto w-full md:w-auto">
            <div className="hidden md:flex items-center gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides)}…`}
                className="h-8 w-48"
              />
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <Switch
                  id="only-incomplete"
                  checked={onlyIncomplete}
                  onCheckedChange={setOnlyIncomplete}
                />
                <label htmlFor="only-incomplete" className="cursor-pointer">
                  Only incomplete
                </label>
              </div>
            </div>
            {/* Hidden only when the outline really is a flat slide list —
                the depth-2 courses that fall back to the chapter view still
                have collapsibles to expand. */}
            <Button
              variant="outline"
              size="sm"
              onClick={isAllExpanded ? collapseAll : expandAll}
              className={cn(
                "h-7 px-3 text-xs border-neutral-300 hover:border-primary-300 hover:bg-primary-50/50",
                courseStructure === 2 && chapterLevelIsPlaceholder && "hidden",
              )}
            >
              {isAllExpanded ? (
                <>
                  <FolderOpen size={14} className="me-1.5" />
                  Collapse All
                </>
              ) : (
                <>
                  <Folder size={14} className="me-1.5" />
                  Expand All
                </>
              )}
            </Button>
          </div>
          <div className="md:hidden w-full flex items-center gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides)}…`}
              className="h-9 flex-1 min-w-0"
            />
            <div className="flex items-center gap-2 text-xs text-neutral-600 shrink-0">
              <Switch
                id="only-incomplete-sm"
                checked={onlyIncomplete}
                onCheckedChange={setOnlyIncomplete}
              />
              <label htmlFor="only-incomplete-sm" className="cursor-pointer">
                Only incomplete
              </label>
            </div>
          </div>
        </div>
        <div className="w-full space-y-1.5">
          {isModulesLoading && (
            <div className="py-2 space-y-2">
              {/* Simple outline skeleton */}
              <div className="flex items-center gap-2">
                <Skeleton className="w-6 h-6 rounded" />
                <Skeleton className="h-4 w-40" />
              </div>
              <div className="ms-8 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="w-5 h-5 rounded" />
                    <Skeleton className="h-4 w-32" />
                    <div className="ms-auto w-24">
                      <Skeleton className="h-2 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isModulesLoading &&
            courseStructure === 5 &&
            studyLibraryData?.map((subject: SubjectType, idx: number) => {
              const isSubjectOpen = openSubjects.has(subject.id);
              const subjectContentIndent = "ps-1 sm:ps-6";
              const subjectEval = subjectEvaluations[subject.id];
              if (shouldFilterItem(subjectEval)) return null;
              const isSubjectLocked = isItemLocked(subjectEval);
              return (
                <Collapsible
                  key={subject.id}
                  open={isSubjectOpen && !isSubjectLocked}
                  onOpenChange={() => {
                    if (isSubjectLocked) return;
                    toggleSubject(subject.id);
                  }}
                >
                  <CollapsibleTrigger
                    disabled={isSubjectLocked}
                    className={cn(
                      "group flex w-full items-center justify-between rounded-lg border bg-card px-4 py-3 text-start text-sm font-semibold shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                      isSubjectLocked
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-muted/60",
                      // Vibrant Styles
                      "[.ui-vibrant_&]:bg-gradient-to-r [.ui-vibrant_&]:from-card [.ui-vibrant_&]:to-primary/5",
                      "[.ui-vibrant_&]:border-primary/20 [.ui-vibrant_&]:hover:border-primary/40",
                      // Play Styles — solid, bold, Duolingo-style
                      "[.ui-play_&]:bg-play-navy-soft [.ui-play_&]:border-border [.ui-play_&]:text-play-navy-soft-ink [.ui-play_&]:font-extrabold [.ui-play_&]:rounded-xl",
                      "[.ui-play_&]:shadow-none [.ui-play_&]:hover:bg-play-navy-soft [.ui-play_&]:hover:text-play-navy-soft-ink",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <CaretRight
                        size={18}
                        weight="bold"
                        className="shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90 [.ui-play_&]:text-white/90"
                      />
                      {renderStatusIcon(calculateSubjectProgress(subject.id), {
                        size: 18,
                        locked: isSubjectLocked,
                      })}
                      {thumbUrlById[`subject:${subject.id}`] && (
                        <img
                          src={thumbUrlById[`subject:${subject.id}`]}
                          alt={toTitleCase(subject.subject_name)}
                          className="w-6 h-6 rounded-sm object-cover border border-border"
                          referrerPolicy="no-referrer"
                          loading="eager"
                        />
                      )}
                      {showContentPrefixes && (
                        <span className="w-7 shrink-0 text-center text-caption font-medium tabular-nums text-muted-foreground">
                          S{idx + 1}
                        </span>
                      )}
                      <span
                        className="min-w-0 flex-1 break-words"
                        title={toTitleCase(subject.subject_name)}
                      >
                        {toTitleCase(subject.subject_name)}
                      </span>
                      {/* Subject keeps the ONLY progress bar in its branch.
                          onDark: the subject row sits on the navy surface in
                          the Play theme. */}
                      <div className="flex items-center gap-2 ms-auto shrink-0">
                        {(() => {
                          const progress = calculateSubjectProgress(subject.id);
                          return (
                            <>
                              <div className="w-16 hidden sm:block">
                                {renderProgressBar(progress, "sm")}
                              </div>
                              {renderCompletionBadge(progress, {
                                onDark: true,
                              })}
                            </>
                          );
                        })()}
                        {isSubjectLocked ? (
                          <LockedBadge
                            size="sm"
                            showText={false}
                            unlockMessage={subjectEval?.unlockMessage}
                          />
                        ) : (
                          /* Download the whole subject. The structure page offered offline
                             controls only at chapter and slide level, so "save this subject"
                             meant tapping every chapter inside it. */
                          <DownloadNodeButton
                            nodeId={subject.id}
                            nodeType="SUBJECT"
                            packageSessionId={packageSessionId}
                            compact
                          />
                        )}
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent
                    className={`pb-1 pt-2 ${subjectContentIndent}`}
                  >
                    <div className="space-y-1 border-s border-border ps-1 sm:ps-3 relative">
                      {(subjectModulesMap[subject.id] ?? []).map(
                        (mod, modIdx) => {
                          const isModuleOpen = openModules.has(mod.module.id);
                          const moduleContentIndent = `ps-1 sm:ps-5`;
                          const moduleEval = moduleEvaluations[mod.module.id];
                          if (shouldFilterItem(moduleEval)) return null;
                          const isModuleLocked = isItemLocked(moduleEval);
                          return (
                            <Collapsible
                              key={mod.module.id}
                              open={isModuleOpen && !isModuleLocked}
                              onOpenChange={() => {
                                if (isModuleLocked) return;
                                toggleModule(mod.module.id);
                              }}
                            >
                              <CollapsibleTrigger
                                disabled={isModuleLocked}
                                className={cn(
                                  "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm font-medium transition-colors data-[state=open]:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                                  isModuleLocked
                                    ? "cursor-not-allowed opacity-60"
                                    : "hover:bg-muted/60",
                                  // Vibrant Styles
                                  !isModuleLocked &&
                                    "[.ui-vibrant_&]:hover:bg-primary/5 [.ui-vibrant_&]:hover:text-primary",
                                  // Play Styles — quiet hover, ink text
                                  "[.ui-play_&]:rounded-xl [.ui-play_&]:font-bold [.ui-play_&]:hover:bg-play-highlight [.ui-play_&]:hover:text-play-ink",
                                )}
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  <CaretRight
                                    size={16}
                                    weight="bold"
                                    className="shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90"
                                  />
                                  {renderStatusIcon(
                                    calculateModuleProgress(mod),
                                    { locked: isModuleLocked },
                                  )}
                                  {thumbUrlById[`module:${mod.module.id}`] && (
                                    <img
                                      src={
                                        thumbUrlById[`module:${mod.module.id}`]
                                      }
                                      alt={mod.module.module_name}
                                      className="w-5 h-5 rounded-sm object-cover border border-border"
                                      referrerPolicy="no-referrer"
                                      loading="eager"
                                    />
                                  )}
                                  {showContentPrefixes && (
                                    <span className="w-6 shrink-0 text-center text-caption font-medium tabular-nums text-muted-foreground">
                                      M{modIdx + 1}
                                    </span>
                                  )}
                                  <span
                                    className="min-w-0 flex-1 break-words text-sm font-medium text-foreground"
                                    title={mod.module.module_name}
                                  >
                                    {mod.module.module_name}
                                  </span>
                                  {/* Module progress: % text only (bar lives on the branch top level) */}
                                  <span className="ms-auto flex shrink-0 items-center gap-2">
                                    {renderCompletionBadge(
                                      calculateModuleProgress(mod),
                                    )}
                                    {isModuleLocked ? (
                                      <LockedBadge
                                        size="sm"
                                        showText={false}
                                        unlockMessage={moduleEval?.unlockMessage}
                                      />
                                    ) : (
                                      /* Download the whole module — same reasoning as the
                                         subject control above. */
                                      <DownloadNodeButton
                                        nodeId={mod.module.id}
                                        nodeType="MODULE"
                                        packageSessionId={packageSessionId}
                                        compact
                                      />
                                    )}
                                  </span>
                                </div>
                              </CollapsibleTrigger>

                              <CollapsibleContent
                                className={`py-1 ${moduleContentIndent}`}
                              >
                                <div className="space-y-0.5 border-s border-border ps-1 sm:ps-2.5 relative">
                                  {(mod.chapters ?? []).map((ch, chIdx) => {
                                    const isChapterOpen = openChapters.has(
                                      ch.id,
                                    );

                                    // Apply drip conditions

                                    const chapterEval =
                                      chapterEvaluations[ch.id];
                                    const shouldHideChapter =
                                      chapterEval &&
                                      shouldFilterItem(chapterEval);
                                    const isChapterLocked =
                                      chapterEval && isItemLocked(chapterEval);

                                    // Hide chapter if drip condition says so
                                    if (shouldHideChapter) {
                                      return null;
                                    }

                                    return (
                                      <Collapsible
                                        key={ch.id}
                                        open={isChapterOpen}
                                        onOpenChange={() => {
                                          if (isChapterLocked) return;
                                          toggleChapter(ch.id);
                                          getSlidesWithChapterId(ch.id);
                                        }}
                                      >
                                        <CollapsibleTrigger
                                          disabled={isChapterLocked}
                                          className={cn(
                                            `group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                                              isChapterLocked
                                                ? "cursor-not-allowed opacity-60"
                                                : "hover:bg-muted/60 cursor-pointer data-[state=open]:bg-muted/40"
                                            }`,
                                            // Vibrant Styles
                                            !isChapterLocked &&
                                              "[.ui-vibrant_&]:hover:bg-primary/5 [.ui-vibrant_&]:hover:text-primary",
                                            // Play Styles — calm navy-soft surface, no border jump
                                            !isChapterLocked &&
                                              "[.ui-play_&]:rounded-xl [.ui-play_&]:font-bold [.ui-play_&]:hover:bg-play-navy-soft [.ui-play_&]:hover:text-play-navy-soft-ink [.ui-play_&]:data-[state=open]:bg-play-navy-soft [.ui-play_&]:data-[state=open]:text-play-navy-soft-ink",
                                          )}
                                        >
                                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                            <CaretRight
                                              size={14}
                                              weight="bold"
                                              className="shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90"
                                            />
                                            {renderStatusIcon(
                                              calculateChapterProgress(ch.id),
                                              { locked: isChapterLocked },
                                            )}
                                            {thumbUrlById[
                                              `chapter:${ch.id}`
                                            ] && (
                                              <img
                                                src={
                                                  thumbUrlById[
                                                    `chapter:${ch.id}`
                                                  ]
                                                }
                                                alt={toTitleCase(
                                                  ch.chapter_name,
                                                )}
                                                className="w-4 h-4 rounded-sm object-cover border border-border"
                                                referrerPolicy="no-referrer"
                                                loading="eager"
                                              />
                                            )}
                                            {showContentPrefixes && (
                                              <span className="w-5 shrink-0 text-center text-caption tabular-nums text-muted-foreground">
                                                C{chIdx + 1}
                                              </span>
                                            )}
                                            <span
                                              className="min-w-0 flex-1 break-words text-sm font-medium text-foreground"
                                              title={toTitleCase(
                                                ch.chapter_name,
                                              )}
                                            >
                                              {toTitleCase(ch.chapter_name)}
                                            </span>
                                            {/* Show locked badge if chapter is locked */}
                                            {isChapterLocked && (
                                              <LockedBadge
                                                size="sm"
                                                unlockMessage={
                                                  chapterEval?.unlockMessage
                                                }
                                              />
                                            )}
                                            {/* Earned-only slide count */}
                                            <span className="ms-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                                              {(() => {
                                                const slidesForChapter =
                                                  slidesMap[ch.id] || [];
                                                const completedSlides =
                                                  slidesForChapter.filter(
                                                    (slide) =>
                                                      (slide.percentage_completed ||
                                                        0) >=
                                                      getSlideCompletionThreshold(),
                                                  ).length;
                                                const totalSlides =
                                                  slidesForChapter.length;

                                                return (
                                                  slidesMap[ch.id] !==
                                                    undefined &&
                                                  totalSlides > 0 &&
                                                  completedSlides > 0 && (
                                                    <span
                                                      className={cn(
                                                        "min-w-8 text-end text-caption tabular-nums",
                                                        completedSlides ===
                                                          totalSlides
                                                          ? "text-success-500"
                                                          : "text-muted-foreground",
                                                        "[.ui-play_&]:text-play-navy-soft-ink",
                                                      )}
                                                    >
                                                      {completedSlides}/
                                                      {totalSlides}
                                                    </span>
                                                  )
                                                );
                                              })()}
                                              {/* Offline download for the whole chapter (plan B7). Renders
                                                  nothing on unsupported platforms; stops propagation itself
                                                  so it never toggles the collapsible. Hidden while the
                                                  chapter is drip-locked — downloading it would hand over
                                                  exactly the content the lock is withholding. */}
                                              {!isChapterLocked && (
                                                <DownloadNodeButton
                                                  nodeId={ch.id}
                                                  nodeType="CHAPTER"
                                                  packageSessionId={packageSessionId}
                                                  compact
                                                />
                                              )}
                                            </span>
                                          </div>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent>
                                          <div
                                            className={`space-y-px ms-5 border-s border-border py-1 ps-2 relative `}
                                          >
                                            {(() => {
                                              const slidesForChapter =
                                                slidesMap[ch.id] ?? [];
                                              const filteredSlides =
                                                filterSlides(slidesForChapter);

                                              // Apply drip conditions to filter out hidden slides
                                              const visibleSlides =
                                                filteredSlides.filter(
                                                  (slide) => {
                                                    const slideEval =
                                                      slideEvaluations[
                                                        slide.id
                                                      ];
                                                    const shouldHideSlide =
                                                      slideEval &&
                                                      shouldFilterItem(
                                                        slideEval,
                                                      );
                                                    return !shouldHideSlide;
                                                  },
                                                );

                                              const status =
                                                slidesLoadingStatus[ch.id] ||
                                                "idle";
                                              if (status === "loading") {
                                                return (
                                                  <div className="pe-2">
                                                    {Array.from({
                                                      length: 3,
                                                    }).map((_, i) => (
                                                      <div
                                                        key={i}
                                                        className="flex items-center gap-2 px-2 py-1"
                                                      >
                                                        <Skeleton className="w-5 h-5 rounded" />
                                                        <Skeleton className="h-4 w-32" />
                                                        <div className="ms-auto flex items-center gap-2">
                                                          <Skeleton className="h-3 w-16" />
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                );
                                              }
                                              if (
                                                status === "loaded" &&
                                                visibleSlides.length === 0
                                              ) {
                                                return (
                                                  <div className="text-xs px-2 py-1 text-neutral-400 italic bg-neutral-50/50 rounded">
                                                    No{" "}
                                                    {getTerminologyPlural(
                                                      ContentTerms.Slides,
                                                      SystemTerms.Slides,
                                                    )}
                                                  </div>
                                                );
                                              }
                                              return visibleSlides.map(
                                                (slide, sIdx) => {
                                                  // Check if slide is locked
                                                  const slideEval =
                                                    slideEvaluations[slide.id];
                                                  const isSlideLocked =
                                                    slideEval &&
                                                    isItemLocked(slideEval);

                                                  return (
                                                    <div
                                                      key={slide.id}
                                                      className={cn(
                                                        getSlideStyling(),
                                                        // Vibrant Styles
                                                        "[.ui-vibrant_&]:hover:bg-primary/5",
                                                        // Play Styles — solid, bold, Duolingo-style
                                                        "[.ui-play_&]:rounded-xl [.ui-play_&]:font-bold [.ui-play_&]:hover:bg-play-highlight [.ui-play_&]:hover:text-play-ink [.ui-play_&]:transition-colors",
                                                      )}
                                                      onClick={
                                                        isSlideClickable() &&
                                                        !isSlideLocked
                                                          ? () => {
                                                              handleSlideNavigation(
                                                                subject.id,
                                                                mod.module.id,
                                                                ch.id,
                                                                slide.id,
                                                              );
                                                            }
                                                          : undefined
                                                      }
                                                    >
                                                      {showContentPrefixes && (
                                                        <span className="w-5 shrink-0 text-end text-caption tabular-nums text-muted-foreground">
                                                          {sIdx + 1}
                                                        </span>
                                                      )}
                                                      <span
                                                        className="shrink-0"
                                                        title={
                                                          getSlideTypeDisplay(
                                                            slide,
                                                          ) || undefined
                                                        }
                                                      >
                                                        {getIcon(slide, "4")}
                                                      </span>
                                                      <span
                                                        className="min-w-0 flex-1 truncate text-sm text-foreground"
                                                        title={slide.title}
                                                      >
                                                        {slide.title}
                                                      </span>
                                                      {renderContinueChip(
                                                        slide.id,
                                                      )}
                                                      {/* Show locked badge if slide is locked */}
                                                      {isSlideLocked && (
                                                        <LockedBadge
                                                          size="sm"
                                                          unlockMessage={
                                                            slideEval?.unlockMessage
                                                          }
                                                        />
                                                      )}
                                                      {/* Meta: one quiet fact + earned-only status */}
                                                      <span className="ms-auto flex shrink-0 items-center gap-1.5 ps-2 text-caption tabular-nums text-muted-foreground whitespace-nowrap">
                                                        {getSlideMetaText(
                                                          slide,
                                                        ) && (
                                                          <span>
                                                            {getSlideMetaText(
                                                              slide,
                                                            )}
                                                          </span>
                                                        )}
                                                        {renderStatusIcon(
                                                          slide.percentage_completed ||
                                                            0,
                                                          {
                                                            size: 14,
                                                            hideEmpty: true,
                                                          },
                                                        )}
                                                        {/* Offline download for this single slide, mirroring the chapter
                                                            control above. Renders nothing on unsupported platforms or when
                                                            the admin hasn't allowed this slide offline; stops propagation
                                                            itself so tapping it never navigates into the slide. */}
                                                        <DownloadNodeButton
                                                          nodeId={slide.id}
                                                          nodeType="SLIDE"
                                                          packageSessionId={packageSessionId}
                                                          compact
                                                        />
                                                      </span>
                                                    </div>
                                                  );
                                                },
                                              );
                                            })()}
                                          </div>
                                        </CollapsibleContent>
                                      </Collapsible>
                                    );
                                  })}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        },
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          {/* Depth 4: modules at top level (no subject shown) */}
          {courseStructure === 4 &&
            (() => {
              // Collect all modules from all (default) subjects into a flat list
              const allModules: {
                subject: SubjectType;
                mod: ModuleWithChapters;
                globalIdx: number;
              }[] = [];
              studyLibraryData?.forEach((subject: SubjectType) => {
                (subjectModulesMap[subject.id] ?? []).forEach((mod) => {
                  allModules.push({
                    subject,
                    mod,
                    globalIdx: allModules.length,
                  });
                });
              });
              return allModules.map(({ subject, mod, globalIdx }) => {
                const isModuleOpen = openModules.has(mod.module.id);
                return (
                  <Collapsible
                    key={mod.module.id}
                    open={isModuleOpen}
                    onOpenChange={() => toggleModule(mod.module.id)}
                  >
                    <CollapsibleTrigger
                      className={cn(
                        "group flex w-full items-center justify-between rounded-lg border bg-card px-4 py-3 text-start text-sm font-semibold shadow-sm transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        "[.ui-vibrant_&]:hover:bg-primary/5 [.ui-vibrant_&]:border-primary/20",
                        "[.ui-play_&]:bg-play-navy-soft [.ui-play_&]:border-border [.ui-play_&]:text-play-navy-soft-ink [.ui-play_&]:font-extrabold [.ui-play_&]:rounded-xl",
                        "[.ui-play_&]:shadow-none [.ui-play_&]:hover:bg-play-navy-soft [.ui-play_&]:hover:text-play-navy-soft-ink",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <CaretRight
                          size={18}
                          weight="bold"
                          className="shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90 [.ui-play_&]:text-white/90"
                        />
                        {renderStatusIcon(
                          calculateModuleProgress(mod),
                          { size: 18 },
                        )}
                        {showContentPrefixes && (
                          <span className="w-7 shrink-0 text-center text-caption font-medium tabular-nums text-muted-foreground">
                            M{globalIdx + 1}
                          </span>
                        )}
                        <span
                          className="min-w-0 flex-1 break-words"
                          title={toTitleCase(mod.module.module_name)}
                        >
                          {toTitleCase(mod.module.module_name)}
                        </span>
                        {/* Top-level module keeps the branch bar */}
                        <div className="flex items-center gap-2 ms-auto shrink-0">
                          {(() => {
                            const progress = calculateModuleProgress(mod);
                            return (
                              <>
                                <div className="w-16 hidden sm:block">
                                  {renderProgressBar(progress, "sm")}
                                </div>
                                {renderCompletionBadge(progress, {
                                  onDark: true,
                                })}
                              </>
                            );
                          })()}
                          {/* Download the whole module — same reasoning as the subject
                              control. */}
                          <DownloadNodeButton
                            nodeId={mod.module.id}
                            nodeType="MODULE"
                            packageSessionId={packageSessionId}
                            compact
                          />
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pb-1 pt-2">
                      <div className="space-y-0.5 relative ps-3 border-s border-border">
                        {(mod.chapters ?? []).map((ch, chIdx) => {
                          const isChapterOpen = openChapters.has(ch.id);
                          const chapterEval = chapterEvaluations[ch.id];
                          const shouldHideChapter =
                            chapterEval && shouldFilterItem(chapterEval);
                          const isChapterLocked =
                            chapterEval && isItemLocked(chapterEval);
                          if (shouldHideChapter) return null;
                          return (
                            <Collapsible
                              key={ch.id}
                              open={isChapterOpen}
                              onOpenChange={() => {
                                if (isChapterLocked) return;
                                toggleChapter(ch.id);
                                getSlidesWithChapterId(ch.id);
                              }}
                            >
                              <CollapsibleTrigger
                                disabled={isChapterLocked}
                                className={cn(
                                  `group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                                    isChapterLocked
                                      ? "cursor-not-allowed opacity-60"
                                      : "hover:bg-muted/60 cursor-pointer data-[state=open]:bg-muted/40"
                                  }`,
                                  !isChapterLocked &&
                                    "[.ui-play_&]:rounded-xl [.ui-play_&]:font-bold [.ui-play_&]:hover:bg-play-navy-soft [.ui-play_&]:hover:text-play-navy-soft-ink [.ui-play_&]:data-[state=open]:bg-play-navy-soft [.ui-play_&]:data-[state=open]:text-play-navy-soft-ink",
                                )}
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                  <CaretRight
                                    size={14}
                                    weight="bold"
                                    className="shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90"
                                  />
                                  {renderStatusIcon(
                                    calculateChapterProgress(ch.id),
                                    {
                                      locked: !!isChapterLocked,
                                    },
                                  )}
                                  {showContentPrefixes && (
                                    <span className="w-5 shrink-0 text-center text-caption tabular-nums text-muted-foreground">
                                      C{chIdx + 1}
                                    </span>
                                  )}
                                  <span
                                    className="min-w-0 flex-1 break-words text-sm font-medium text-foreground"
                                    title={toTitleCase(ch.chapter_name)}
                                  >
                                    {toTitleCase(ch.chapter_name)}
                                  </span>
                                  {isChapterLocked && (
                                    <LockedBadge
                                      size="sm"
                                      unlockMessage={chapterEval?.unlockMessage}
                                    />
                                  )}
                                  <span className="ms-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                                    {(() => {
                                      const slidesForChapter =
                                        slidesMap[ch.id] || [];
                                      const completedSlides =
                                        slidesForChapter.filter(
                                          (slide) =>
                                            (slide.percentage_completed || 0) >=
                                            getSlideCompletionThreshold(),
                                        ).length;
                                      const totalSlides =
                                        slidesForChapter.length;
                                      return (
                                        slidesMap[ch.id] !== undefined &&
                                        totalSlides > 0 &&
                                        completedSlides > 0 && (
                                          <span
                                            className={cn(
                                              "min-w-8 text-end text-caption tabular-nums",
                                              completedSlides === totalSlides
                                                ? "text-success-500"
                                                : "text-muted-foreground",
                                              "[.ui-play_&]:text-play-navy-soft-ink",
                                            )}
                                          >
                                            {completedSlides}/{totalSlides}
                                          </span>
                                        )
                                      );
                                    })()}
                                    <DownloadNodeButton
                                      nodeId={ch.id}
                                      nodeType="CHAPTER"
                                      packageSessionId={packageSessionId}
                                      compact
                                    />
                                  </span>
                                </div>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="space-y-px ms-1 sm:ms-5 border-s border-border py-1 ps-1 sm:ps-2 relative">
                                  {(() => {
                                    const status =
                                      slidesLoadingStatus[ch.id] || "idle";
                                    const filtered = filterSlides(
                                      slidesMap[ch.id] ?? [],
                                    );
                                    if (status === "loading") {
                                      return (
                                        <div className="pe-2">
                                          {Array.from({ length: 3 }).map(
                                            (_, i) => (
                                              <div
                                                key={i}
                                                className="flex items-center gap-2 px-2 py-1"
                                              >
                                                <Skeleton className="w-5 h-5 rounded" />
                                                <Skeleton className="h-4 w-32" />
                                                <div className="ms-auto flex items-center gap-2">
                                                  <Skeleton className="h-3 w-16" />
                                                </div>
                                              </div>
                                            ),
                                          )}
                                        </div>
                                      );
                                    }
                                    if (
                                      status === "loaded" &&
                                      filtered.length === 0
                                    ) {
                                      return (
                                        <div className="text-xs px-2 py-1 text-neutral-400 italic bg-neutral-50/50 rounded">
                                          No{" "}
                                          {getTerminologyPlural(
                                            ContentTerms.Slides,
                                            SystemTerms.Slides,
                                          )}
                                        </div>
                                      );
                                    }
                                    return filtered.map((slide, sIdx) => (
                                      <div
                                        key={slide.id}
                                        className={cn(
                                          getSlideStyling(),
                                          "[.ui-play_&]:rounded-xl [.ui-play_&]:font-bold [.ui-play_&]:hover:bg-play-highlight [.ui-play_&]:hover:text-play-ink [.ui-play_&]:transition-colors",
                                        )}
                                        onClick={
                                          isSlideClickable()
                                            ? () => {
                                                handleSlideNavigation(
                                                  subject.id,
                                                  mod.module.id,
                                                  ch.id,
                                                  slide.id,
                                                );
                                              }
                                            : undefined
                                        }
                                      >
                                        {showContentPrefixes && (
                                          <span className="w-5 shrink-0 text-end text-caption tabular-nums text-muted-foreground">
                                            {sIdx + 1}
                                          </span>
                                        )}
                                        <span
                                          className="shrink-0"
                                          title={
                                            getSlideTypeDisplay(slide) ||
                                            undefined
                                          }
                                        >
                                          {getIcon(slide, "4")}
                                        </span>
                                        <span
                                          className="min-w-0 flex-1 truncate text-sm text-foreground"
                                          title={slide.title}
                                        >
                                          {slide.title}
                                        </span>
                                        {renderContinueChip(slide.id)}
                                        <span className="ms-auto flex shrink-0 items-center gap-1.5 ps-2 text-caption tabular-nums text-muted-foreground whitespace-nowrap">
                                          {getSlideMetaText(slide) && (
                                            <span>
                                              {getSlideMetaText(slide)}
                                            </span>
                                          )}
                                          {renderStatusIcon(
                                            slide.percentage_completed || 0,
                                            { size: 14, hideEmpty: true },
                                          )}
                                          {/* Offline download for this single slide, mirroring the chapter
                                              control above. Renders nothing on unsupported platforms or when
                                              the admin hasn't allowed this slide offline; stops propagation
                                              itself so tapping it never navigates into the slide. */}
                                          <DownloadNodeButton
                                            nodeId={slide.id}
                                            nodeType="SLIDE"
                                            packageSessionId={packageSessionId}
                                            compact
                                          />
                                        </span>
                                      </div>
                                    ));
                                  })()}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              });
            })()}
          {/* Depth 3: chapters only (no subject, no module). Also the fallback
              for the handful of depth-2 courses that carry more than the one
              seeded chapter — flattening those to a bare slide list would drop
              the only grouping they have. */}
          {(courseStructure === 3 ||
            (courseStructure === 2 && !chapterLevelIsPlaceholder)) && (
            <div className="space-y-0.5">
              {(() => {
                const chaptersWithContext: Array<{
                  subject: SubjectType;
                  mod: ModuleWithChapters;
                  ch: Chapter;
                  chIdx: number;
                }> = [];
                studyLibraryData?.forEach((subject: SubjectType) => {
                  (subjectModulesMap[subject.id] ?? []).forEach((mod) => {
                    (mod.chapters ?? []).forEach((ch, chIdx) => {
                      chaptersWithContext.push({ subject, mod, ch, chIdx });
                    });
                  });
                });
                return chaptersWithContext.map(
                  ({ subject, mod, ch, chIdx }) => {
                    const isChapterOpen = openChapters.has(ch.id);

                    // Apply drip conditions

                    const chapterEval = chapterEvaluations[ch.id];
                    const shouldHideChapter =
                      chapterEval && shouldFilterItem(chapterEval);
                    const isChapterLocked =
                      chapterEval && isItemLocked(chapterEval);

                    // Hide chapter if drip condition says so
                    if (shouldHideChapter) {
                      return null;
                    }

                    return (
                      <Collapsible
                        key={ch.id}
                        open={isChapterOpen}
                        onOpenChange={() => {
                          if (isChapterLocked) return;
                          toggleChapter(ch.id);
                          getSlidesWithChapterId(ch.id);
                        }}
                      >
                        <CollapsibleTrigger
                          disabled={isChapterLocked}
                          className={cn(
                            "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                            isChapterLocked
                              ? "cursor-not-allowed opacity-60"
                              : "hover:bg-muted/60 cursor-pointer data-[state=open]:bg-muted/40",
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                            <CaretRight
                              size={14}
                              weight="bold"
                              className="shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90"
                            />
                            {renderStatusIcon(calculateChapterProgress(ch.id), {
                              locked: !!isChapterLocked,
                            })}
                            {showContentPrefixes && (
                              <span className="w-5 shrink-0 text-center text-caption tabular-nums text-muted-foreground">
                                C{chIdx + 1}
                              </span>
                            )}
                            <span
                              className="min-w-0 flex-1 break-words text-sm font-medium text-foreground"
                              title={toTitleCase(ch.chapter_name)}
                            >
                              {toTitleCase(ch.chapter_name)}
                            </span>
                            {/* Show locked badge if chapter is locked */}
                            {isChapterLocked && (
                              <LockedBadge
                                size="sm"
                                unlockMessage={chapterEval?.unlockMessage}
                              />
                            )}
                            {/* Chapters are the top level at this depth: keep the branch bar */}
                            <span className="ms-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                              {(() => {
                                const progress = calculateChapterProgress(
                                  ch.id,
                                );
                                const slidesForChapter = slidesMap[ch.id] || [];
                                const completedSlides = slidesForChapter.filter(
                                  (slide) =>
                                    (slide.percentage_completed || 0) >=
                                    getSlideCompletionThreshold(),
                                ).length;
                                const totalSlides = slidesForChapter.length;

                                return (
                                  <>
                                    <div className="w-16 hidden sm:block">
                                      {renderProgressBar(progress, "sm")}
                                    </div>
                                    {slidesMap[ch.id] !== undefined &&
                                      totalSlides > 0 &&
                                      completedSlides > 0 && (
                                        <span
                                          className={cn(
                                            "min-w-8 text-end text-caption tabular-nums",
                                            completedSlides === totalSlides
                                              ? "text-success-500"
                                              : "text-muted-foreground",
                                            "[.ui-play_&]:text-play-navy-soft-ink",
                                          )}
                                        >
                                          {completedSlides}/{totalSlides}
                                        </span>
                                      )}
                                    {renderCompletionBadge(progress)}
                                    <DownloadNodeButton
                                      nodeId={ch.id}
                                      nodeType="CHAPTER"
                                      packageSessionId={packageSessionId}
                                      compact
                                    />
                                  </>
                                );
                              })()}
                            </span>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-px ms-5 border-s border-border py-1 ps-2 relative">
                            {(() => {
                              const status =
                                slidesLoadingStatus[ch.id] || "idle";
                              const filtered = filterSlides(
                                slidesMap[ch.id] ?? [],
                              );
                              if (status === "loading") {
                                return (
                                  <div className="pe-2">
                                    {Array.from({
                                      length: 3,
                                    }).map((_, i) => (
                                      <div
                                        key={i}
                                        className="flex items-center gap-2 px-2 py-1"
                                      >
                                        <Skeleton className="w-5 h-5 rounded" />
                                        <Skeleton className="h-4 w-32" />
                                        <div className="ms-auto flex items-center gap-2">
                                          <Skeleton className="h-3 w-16" />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              if (
                                status === "loaded" &&
                                filtered.length === 0
                              ) {
                                return (
                                  <div className="text-xs px-2 py-1 text-neutral-400 italic bg-neutral-50/50 rounded">
                                    No{" "}
                                    {getTerminologyPlural(
                                      ContentTerms.Slides,
                                      SystemTerms.Slides,
                                    )}
                                  </div>
                                );
                              }
                              return filtered.map((slide, sIdx) => (
                                <div
                                  key={slide.id}
                                  className={getSlideStyling()}
                                  onClick={
                                    isSlideClickable()
                                      ? () => {
                                          handleSlideNavigation(
                                            subject.id,
                                            mod.module.id,
                                            ch.id,
                                            slide.id,
                                          );
                                        }
                                      : undefined
                                  }
                                >
                                  {showContentPrefixes && (
                                    <span className="w-5 shrink-0 text-end text-caption tabular-nums text-muted-foreground">
                                      {sIdx + 1}
                                    </span>
                                  )}
                                  <span
                                    className="shrink-0"
                                    title={
                                      getSlideTypeDisplay(slide) || undefined
                                    }
                                  >
                                    {getIcon(slide, "4")}
                                  </span>
                                  <span
                                    className="min-w-0 flex-1 truncate text-sm text-foreground"
                                    title={slide.title}
                                  >
                                    {slide.title}
                                  </span>
                                  {renderContinueChip(slide.id)}
                                  {/* Slide Meta */}
                                  <span className="ms-auto flex shrink-0 items-center gap-1.5 ps-2 text-caption tabular-nums text-muted-foreground whitespace-nowrap">
                                    {getSlideMetaText(slide) && (
                                      <span>{getSlideMetaText(slide)}</span>
                                    )}
                                    {renderStatusIcon(
                                      slide.percentage_completed || 0,
                                      {
                                        size: 14,
                                        hideEmpty: true,
                                      },
                                    )}
                                    {/* Offline download for this single slide, mirroring the chapter
                                        control above. Renders nothing on unsupported platforms or when
                                        the admin hasn't allowed this slide offline; stops propagation
                                        itself so tapping it never navigates into the slide. */}
                                    <DownloadNodeButton
                                      nodeId={slide.id}
                                      nodeType="SLIDE"
                                      packageSessionId={packageSessionId}
                                      compact
                                    />
                                  </span>
                                </div>
                              ));
                            })()}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  },
                );
              })()}
            </div>
          )}

          {/* Depth 2: slides only — no subject, module or chapter row.
              A 2-level course still stores its slides under a seeded
              subject/module/chapter all literally named "DEFAULT" (see
              add-course-form on the admin side); rendering those placeholder
              rows is what made a 2-level course read as a 5-level one, with
              three "Default" headers above every slide. */}
          {!isModulesLoading && courseStructure === 2 && chapterLevelIsPlaceholder && (
            <div className="space-y-px">
              {(() => {
                const slidesWithContext: Array<{
                  subject: SubjectType;
                  mod: ModuleWithChapters;
                  ch: Chapter;
                  slide: Slide;
                  chapterLocked: boolean;
                  chapterUnlockMessage?: string;
                }> = [];
                const chapterIds: string[] = [];
                studyLibraryData?.forEach((subject: SubjectType) => {
                  (subjectModulesMap[subject.id] ?? []).forEach((mod) => {
                    (mod.chapters ?? []).forEach((ch) => {
                      const chapterEval = chapterEvaluations[ch.id];
                      if (chapterEval && shouldFilterItem(chapterEval)) return;
                      // There is no chapter row left to carry a drip lock at
                      // this depth, so it moves onto the slides themselves —
                      // dropping them instead would leave the learner staring
                      // at "No slides" with nothing explaining why.
                      const chapterLocked = !!(
                        chapterEval && isItemLocked(chapterEval)
                      );
                      chapterIds.push(ch.id);
                      filterSlides(slidesMap[ch.id] ?? []).forEach((slide) => {
                        const slideEval = slideEvaluations[slide.id];
                        if (slideEval && shouldFilterItem(slideEval)) return;
                        slidesWithContext.push({
                          subject,
                          mod,
                          ch,
                          slide,
                          chapterLocked,
                          ...(chapterEval?.unlockMessage && {
                            chapterUnlockMessage: chapterEval.unlockMessage,
                          }),
                        });
                      });
                    });
                  });
                });

                const stillLoading = chapterIds.some((id) => {
                  const status = slidesLoadingStatus[id] ?? "idle";
                  return status === "idle" || status === "loading";
                });

                if (slidesWithContext.length === 0 && stillLoading) {
                  return (
                    <div className="pe-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-2 py-1"
                        >
                          <Skeleton className="w-5 h-5 rounded" />
                          <Skeleton className="h-4 w-32" />
                          <div className="ms-auto flex items-center gap-2">
                            <Skeleton className="h-3 w-16" />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                }

                if (slidesWithContext.length === 0) {
                  return (
                    <div className="text-xs px-2 py-1 text-neutral-400 italic bg-neutral-50/50 rounded">
                      No{" "}
                      {getTerminologyPlural(
                        ContentTerms.Slides,
                        SystemTerms.Slides,
                      )}
                    </div>
                  );
                }

                return slidesWithContext.map(
                  (
                    {
                      subject,
                      mod,
                      ch,
                      slide,
                      chapterLocked,
                      chapterUnlockMessage,
                    },
                    sIdx,
                  ) => {
                    const slideEval = slideEvaluations[slide.id];
                    const isSlideLocked =
                      chapterLocked || !!(slideEval && isItemLocked(slideEval));

                    return (
                      <div
                        key={slide.id}
                        className={cn(
                          getSlideStyling(),
                          // Vibrant Styles
                          "[.ui-vibrant_&]:hover:bg-primary/5",
                          // Play Styles — solid, bold, Duolingo-style
                          "[.ui-play_&]:rounded-xl [.ui-play_&]:font-bold [.ui-play_&]:hover:bg-play-highlight [.ui-play_&]:hover:text-play-ink [.ui-play_&]:transition-colors",
                        )}
                        onClick={
                          isSlideClickable() && !isSlideLocked
                            ? () => {
                                handleSlideNavigation(
                                  subject.id,
                                  mod.module.id,
                                  ch.id,
                                  slide.id,
                                );
                              }
                            : undefined
                        }
                      >
                        {showContentPrefixes && (
                          <span className="w-5 shrink-0 text-end text-caption tabular-nums text-muted-foreground">
                            {sIdx + 1}
                          </span>
                        )}
                        <span
                          className="shrink-0"
                          title={getSlideTypeDisplay(slide) || undefined}
                        >
                          {getIcon(slide, "4")}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-sm text-foreground"
                          title={slide.title}
                        >
                          {slide.title}
                        </span>
                        {renderContinueChip(slide.id)}
                        {isSlideLocked && (
                          <LockedBadge
                            size="sm"
                            unlockMessage={
                              slideEval?.unlockMessage ?? chapterUnlockMessage
                            }
                          />
                        )}
                        {/* Meta: one quiet fact + earned-only status */}
                        <span className="ms-auto flex shrink-0 items-center gap-1.5 ps-2 text-caption tabular-nums text-muted-foreground whitespace-nowrap">
                          {getSlideMetaText(slide) && (
                            <span>{getSlideMetaText(slide)}</span>
                          )}
                          {renderStatusIcon(slide.percentage_completed || 0, {
                            size: 14,
                            hideEmpty: true,
                          })}
                          {/* Offline download for this single slide. Renders
                              nothing on unsupported platforms; stops
                              propagation itself so tapping it never
                              navigates into the slide. */}
                          <DownloadNodeButton
                            nodeId={slide.id}
                            nodeType="SLIDE"
                            packageSessionId={packageSessionId}
                            compact
                          />
                        </span>
                      </div>
                    );
                  },
                );
              })()}
            </div>
          )}
        </div>
      </div>
    ),
    [TabType.CONTENT_STRUCTURE]: (
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
          <div className="flex items-center gap-3">
            <PresentationChart size={24} className="text-primary-600" />
            <span className="text-lg font-semibold text-neutral-800">
              Content Structure
            </span>
            {/* Whole-course download, matching the Outline tab's header
                control so both views offer the same reach. */}
            <DownloadNodeButton
              nodeId={packageSessionId ?? ""}
              nodeType="COURSE"
              packageSessionId={packageSessionId}
              compact
            />
          </div>
        </div>

        {/* Content-only replaces the breadcrumb trail with one Back control.
            The trail was pure chrome here: at the top level it rendered a lone
            "Subjects" pill pointing at the screen you were already on. It is
            not dropped outright, though — it was also the ONLY way back up the
            drill-down, so removing it with nothing in its place would strand a
            learner one level deep in a course. This shows only when there is
            somewhere to go back to. */}
        {contentOnly && !isModulesLoading && (selectedSubjectId || selectedModuleId) && (
          <button
            type="button"
            className="mb-4 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            onClick={() => {
              if (selectedModuleId) setSelectedModuleId(null);
              else setSelectedSubjectId(null);
              setSelectedChapterId(null);
            }}
          >
            <CaretLeft size={14} />
            <span>Back</span>
          </button>
        )}

        {/* Breadcrumbs — only for the levels this course actually exposes.
            The full subject > module > chapter trail on a shallower course put
            the seeded "DEFAULT" levels back in front of the learner: the crumbs
            claimed a hierarchy that isn't theirs, and clicking one dropped them
            into a grid holding a single card called "Default". A flat 2-level
            course has no trail left, so the bar goes away entirely; the last
            condition keeps it from rendering as an empty strip. */}
        {!contentOnly &&
          !isModulesLoading &&
          showsChapterLevel &&
          (showsSubjectLevel ||
            (showsModuleLevel && selectedSubjectId) ||
            selectedModuleId ||
            selectedChapterId) && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600 mb-6 bg-neutral-50/50 p-2.5 rounded-lg border border-neutral-100">
            {showsSubjectLevel && (
              <button
                type="button"
                className={`px-3 py-1.5 rounded-md transition-all duration-200 text-sm ${
                  !selectedSubjectId && !selectedModuleId && !selectedChapterId
                    ? "bg-white shadow-sm font-semibold text-primary-700 ring-1 ring-black/5"
                    : "hover:bg-neutral-200/60 hover:text-neutral-900"
                }`}
                onClick={() => {
                  setSelectedSubjectId(null);
                  setSelectedModuleId(null);
                  setSelectedChapterId(null);
                }}
              >
                {getTerminologyPlural(
                  ContentTerms.Subjects,
                  SystemTerms.Subjects,
                )}
              </button>
            )}

            {showsSubjectLevel && showsModuleLevel && selectedSubjectId && (
              <CaretRight size={14} className="text-neutral-400" />
            )}

            {showsModuleLevel && selectedSubjectId && (
              <button
                type="button"
                className={`px-3 py-1.5 rounded-md transition-all duration-200 text-sm ${
                  selectedSubjectId && !selectedModuleId
                    ? "bg-white shadow-sm font-semibold text-primary-700 ring-1 ring-black/5"
                    : "hover:bg-neutral-200/60 hover:text-neutral-900"
                }`}
                onClick={() => {
                  setSelectedModuleId(null);
                  setSelectedChapterId(null);
                }}
              >
                {getTerminologyPlural(
                  ContentTerms.Modules,
                  SystemTerms.Modules,
                )}
              </button>
            )}

            {showsModuleLevel && selectedModuleId && (
              <CaretRight size={14} className="text-neutral-400" />
            )}

            {selectedModuleId && (
              <button
                type="button"
                className={`px-3 py-1.5 rounded-md transition-all duration-200 text-sm ${
                  selectedModuleId && !selectedChapterId
                    ? "bg-white shadow-sm font-semibold text-primary-700 ring-1 ring-black/5"
                    : "hover:bg-neutral-200/60 hover:text-neutral-900"
                }`}
                onClick={() => {
                  setSelectedChapterId(null);
                }}
              >
                {getTerminologyPlural(
                  ContentTerms.Chapters,
                  SystemTerms.Chapters,
                )}
              </button>
            )}

            {selectedChapterId && (
              <CaretRight size={14} className="text-neutral-400" />
            )}

            {selectedChapterId && (
              <span className="px-3 py-1.5 rounded-md bg-white shadow-sm font-semibold text-primary-700 ring-1 ring-black/5 text-sm">
                {getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides)}
              </span>
            )}
          </div>
        )}

        {/* Card-grid shimmer while modules load — mirrors the Outline tab's
            skeleton; every drill-down grid below is gated on !isModulesLoading,
            so without this the section renders empty during the fetch. */}
        {isModulesLoading && (
          <div className={contentGridClass}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Card
                key={i}
                className="h-full rounded-lg border-neutral-200 bg-card p-2"
              >
                <CardContent className="p-0 flex flex-col h-full gap-2">
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Starting depth adapts to courseStructure; if preselected IDs exist, skips to that depth.
            Each grid is also gated on its level being visible at this depth,
            so the seeded "DEFAULT" subject/module/chapter can never surface
            as a card — not even for the frame before the preselect effect
            runs. */}
        {!isModulesLoading && showsSubjectLevel && !selectedSubjectId && (
          <div className={contentGridClass}>
            {studyLibraryData
              ?.filter((subject) => !subjectEvaluations[subject.id]?.isHidden)
              .map((subject, idx) => {
              const subjectEval = subjectEvaluations[subject.id];
              const isSubjectLocked = isItemLocked(subjectEval);
              return (
              <Card
                key={subject.id}
                role="button"
                tabIndex={isSubjectLocked ? -1 : 0}
                aria-label={
                  toTitleCase(subject.subject_name) +
                  (isSubjectLocked ? " (locked)" : "")
                }
                aria-disabled={isSubjectLocked}
                className={cn(
                  CONTENT_CARD_SHELL,
                  isSubjectLocked
                    ? "cursor-not-allowed"
                    : "cursor-pointer hover:shadow-md",
                )}
                onClick={() => {
                  if (isSubjectLocked) return;
                  setSelectedSubjectId(subject.id);
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === "Enter" || e.key === " ") &&
                    !isSubjectLocked
                  ) {
                    e.preventDefault();
                    setSelectedSubjectId(subject.id);
                  }
                }}
              >
                <CardContent className="p-0 flex flex-col h-full">
                  <ContentCardThumb
                    url={thumbUrlById[`subject:${subject.id}`]}
                    locked={isSubjectLocked}
                    fit={contentCardImageFit}
                    fallback={
                      <Folder
                        size={40}
                        weight="duotone"
                        className="text-primary-500"
                      />
                    }
                  />
                  <div className="flex flex-1 flex-col gap-1">
                    <h3
                      className="truncate text-sm font-medium text-neutral-800"
                      title={toTitleCase(subject.subject_name)}
                    >
                      {toTitleCase(subject.subject_name)}
                    </h3>
                    {showContentPrefixes && (
                      <p className="text-caption text-muted-foreground">
                        {getTerminology(
                          ContentTerms.Subjects,
                          SystemTerms.Subjects,
                        )}{" "}
                        {idx + 1}
                      </p>
                    )}
                    {isSubjectLocked && (
                      <LockNotice message={subjectEval?.unlockMessage} />
                    )}
                    {/* Download the whole subject. This tab drills down
                        subject -> module -> chapter -> slide as cards, so each
                        level needs its own control; without it the only way to
                        save a subject was to open every chapter in it. */}
                    {!isSubjectLocked && (
                      <div className="flex items-center gap-1.5">
                        <DownloadNodeButton
                          nodeId={subject.id}
                          nodeType="SUBJECT"
                          packageSessionId={packageSessionId}
                        />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}

        {/* Modules */}
        {!isModulesLoading && showsModuleLevel && selectedSubjectId && !selectedModuleId && (
          <div className={contentGridClass}>
            {(subjectModulesMap[selectedSubjectId] || [])
              .filter((m) => !moduleEvaluations[m.module.id]?.isHidden)
              .map((m, idx) => {
              const moduleEval = moduleEvaluations[m.module.id];
              const isModuleLocked = isItemLocked(moduleEval);
              return (
              <Card
                key={m.module.id}
                role="button"
                tabIndex={isModuleLocked ? -1 : 0}
                aria-label={
                  toTitleCase(m.module.module_name) +
                  (isModuleLocked ? " (locked)" : "")
                }
                aria-disabled={isModuleLocked}
                className={cn(
                  CONTENT_CARD_SHELL,
                  isModuleLocked
                    ? "cursor-not-allowed"
                    : "cursor-pointer hover:shadow-md",
                )}
                onClick={() => {
                  if (isModuleLocked) return;
                  setSelectedModuleId(m.module.id);
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !isModuleLocked) {
                    e.preventDefault();
                    setSelectedModuleId(m.module.id);
                  }
                }}
              >
                <CardContent className="p-0 flex flex-col h-full">
                  <ContentCardThumb
                    url={thumbUrlById[`module:${m.module.id}`]}
                    locked={isModuleLocked}
                    fit={contentCardImageFit}
                    fallback={
                      <Folder
                        size={40}
                        weight="duotone"
                        className="text-primary-500"
                      />
                    }
                  />
                  <div className="flex flex-1 flex-col gap-1">
                    <h3
                      className="truncate text-sm font-medium text-neutral-800"
                      title={toTitleCase(m.module.module_name)}
                    >
                      {toTitleCase(m.module.module_name)}
                    </h3>
                    {showContentPrefixes && (
                      <p className="text-caption text-muted-foreground">
                        {getTerminology(
                          ContentTerms.Modules,
                          SystemTerms.Modules,
                        )}{" "}
                        {idx + 1}
                      </p>
                    )}
                    {isModuleLocked && (
                      <LockNotice message={moduleEval?.unlockMessage} />
                    )}
                    {/* Download the whole module — same reasoning as the
                        subject card. */}
                    {!isModuleLocked && (
                      <div className="flex items-center gap-1.5">
                        <DownloadNodeButton
                          nodeId={m.module.id}
                          nodeType="MODULE"
                          packageSessionId={packageSessionId}
                        />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}

        {/* Chapters */}
        {!isModulesLoading &&
          showsChapterLevel &&
          selectedSubjectId &&
          selectedModuleId &&
          !selectedChapterId && (
            <div className={contentGridClass}>
              {(subjectModulesMap[selectedSubjectId] || [])
                .filter((m) => m.module.id === selectedModuleId)
                .flatMap((m) => m.chapters)
                .filter((ch) => {
                  const evaluation = chapterEvaluations[ch.id];
                  return !evaluation?.isHidden;
                })
                .map((ch, idx) => {
                  const evaluation = chapterEvaluations[ch.id];
                  const isChapterLocked = evaluation?.isLocked ?? false;
                  // When the institute has opted in, a chapter card sends the
                  // learner straight into the viewer; the slide list only
                  // appears as a fallback when no slide can be opened (empty
                  // chapter, or every slide drip-locked), because that screen
                  // is what explains the reason.
                  const openChapter = async (chapterId: string) => {
                    if (chapterOpensFirstSlide && isSlideClickable()) {
                      const opened = await openFirstSlideInChapter(
                        selectedSubjectId || "",
                        selectedModuleId || "",
                        chapterId,
                      );
                      if (opened) return;
                    }
                    setSelectedChapterId(chapterId);
                    await getSlidesWithChapterId(chapterId);
                  };
                  return (
                    <Card
                      key={ch.id}
                      role="button"
                      tabIndex={isChapterLocked ? -1 : 0}
                      aria-label={
                        toTitleCase(ch.chapter_name) +
                        (isChapterLocked ? " (locked)" : "")
                      }
                      aria-disabled={isChapterLocked}
                      className={cn(
                        CONTENT_CARD_SHELL,
                        isChapterLocked
                          ? "cursor-not-allowed"
                          : "cursor-pointer hover:shadow-md",
                      )}
                      onClick={async () => {
                        if (isChapterLocked) return;
                        await openChapter(ch.id);
                      }}
                      onKeyDown={async (e) => {
                        if (
                          (e.key === "Enter" || e.key === " ") &&
                          !isChapterLocked
                        ) {
                          e.preventDefault();
                          await openChapter(ch.id);
                        }
                      }}
                    >
                      <CardContent className="p-0 flex flex-col h-full">
                        <ContentCardThumb
                          url={thumbUrlById[`chapter:${ch.id}`]}
                          locked={isChapterLocked}
                          fit={contentCardImageFit}
                          fallback={
                            <PresentationChart
                              size={40}
                              weight="duotone"
                              className="text-primary-500"
                            />
                          }
                        />
                        <div className="flex flex-1 flex-col gap-1">
                          <h3
                            className="truncate text-sm font-medium text-neutral-800"
                            title={toTitleCase(ch.chapter_name)}
                          >
                            {toTitleCase(ch.chapter_name)}
                          </h3>
                          {showContentPrefixes && (
                            <p className="text-caption text-muted-foreground">
                              {getTerminology(
                                ContentTerms.Chapters,
                                SystemTerms.Chapters,
                              )}{" "}
                              {idx + 1}
                            </p>
                          )}
                          {isChapterLocked ? (
                            <LockNotice message={evaluation?.unlockMessage} />
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <DownloadNodeButton
                                nodeId={ch.id}
                                nodeType="CHAPTER"
                                packageSessionId={packageSessionId}
                              />
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}

        {/* Slides */}
        {selectedChapterId && (
          <div className="space-y-4">
            {(() => {
              const status = slidesLoadingStatus[selectedChapterId] || "idle";
              if (status === "loading") {
                return (
                  <div className="grid gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-4 px-4 py-3 rounded-lg border border-neutral-200 bg-white"
                      >
                        <Skeleton className="w-10 h-10 rounded-md" />
                        <div className="space-y-2 flex-1">
                          <Skeleton className="h-4 w-1/3" />
                          <Skeleton className="h-3 w-1/4" />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }
              const chapterSlides = slidesMap[selectedChapterId] || [];
              const visibleSlides = chapterSlides.filter((sl) => {
                const evaluation = slideEvaluations[sl.id];
                return !evaluation?.isHidden;
              });
              if (status === "loaded" && visibleSlides.length === 0) {
                return (
                  <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center">
                    <p className="text-neutral-500 italic">
                      No content available in this {getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLocaleLowerCase()}.
                    </p>
                  </div>
                );
              }
              return (
                <div className="grid gap-3">
                  {visibleSlides.map((sl, index) => {
                    const evaluation = slideEvaluations[sl.id];
                    const isSlideLocked = evaluation?.isLocked ?? false;
                    return (
                      <Card
                        key={sl.id}
                        className={cn(
                          "group transition-all duration-200 border-neutral-200 overflow-hidden",
                          isSlideLocked
                            ? "opacity-60 bg-neutral-50"
                            : isSlideClickable()
                              ? "hover:shadow-md cursor-pointer hover:border-primary-300/50 bg-white"
                              : "bg-white",
                        )}
                        onClick={() => {
                          if (isSlideLocked) return;
                          if (isSlideClickable()) {
                            handleSlideNavigation(
                              selectedSubjectId || "",
                              selectedModuleId || "",
                              selectedChapterId,
                              sl.id,
                            );
                          }
                        }}
                      >
                        <CardContent className="p-3 sm:p-card flex items-start gap-3 sm:gap-4">
                          <div className="flex-shrink-0 flex w-10 h-10 items-center justify-center rounded-lg bg-neutral-100/80 text-sm font-bold text-neutral-500 group-hover:bg-primary-50 group-hover:text-primary-600 transition-colors">
                            {index + 1}
                          </div>

                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-start justify-between gap-4">
                              <h4 className="text-base font-medium text-neutral-800 break-words leading-tight group-hover:text-primary-700 transition-colors">
                                {sl.title}
                              </h4>
                              <div className="shrink-0 text-neutral-400 group-hover:text-primary-500 transition-colors">
                                {getIcon(sl, "5")}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <Badge
                                variant="secondary"
                                className="bg-neutral-100 text-neutral-500 font-normal hover:bg-neutral-200 text-xs"
                              >
                                {getSlideTypeDisplay(sl) ||
                                  getTerminology(
                                    ContentTerms.Slides,
                                    SystemTerms.Slides,
                                  )}
                              </Badge>

                              {isSlideLocked && <LockedBadge size="sm" />}
                              {/* Offline download for this slide. The card-style
                                  drill-down renders slides here rather than as
                                  rows, so it needs its own control — the chapter
                                  card above already has one. */}
                              <DownloadNodeButton
                                nodeId={sl.id}
                                nodeType="SLIDE"
                                packageSessionId={packageSessionId}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* Every drill-down above is gated on both the selection state and the
            level being visible at this depth, so a course whose content was
            never created (a 2-level course with no chapter, say) would land on
            all four gates closed and render a blank tab. */}
        {!isModulesLoading &&
          !selectedChapterId &&
          !(showsSubjectLevel && !selectedSubjectId) &&
          !(showsModuleLevel && selectedSubjectId && !selectedModuleId) &&
          !(showsChapterLevel && selectedSubjectId && selectedModuleId) && (
            <div className="text-sm px-2 py-6 text-center text-neutral-400 italic">
              No{" "}
              {getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides)}
            </div>
          )}
      </div>
    ),
    [TabType.TEACHERS]: (
      <div className="rounded-md bg-card border border-neutral-200 p-5 text-sm text-neutral-600 space-y-stack">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">T</span>
          </div>
          <span className="font-medium text-neutral-700">
            {getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher)}
          </span>
        </div>
        <p className="text-neutral-500">
          {getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher)} content
          coming soon.
        </p>
      </div>
    ),
    [TabType.ASSESSMENT]: (
      <div className="rounded-md bg-card border border-neutral-200 p-5 text-sm text-neutral-600 space-y-stack">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
            <span className="text-white text-xs font-bold">A</span>
          </div>
          <span className="font-medium text-neutral-700">Assessments</span>
        </div>
        <p className="text-neutral-500">Assessment content coming soon.</p>
      </div>
    ),
    [TabType.COURSE_DISCUSSION]: (
      <div className="space-y-4">
        {packageSessionId ? (
          <>
            <CourseLeaderboard packageSessionId={packageSessionId} />
            <BatchChatPanel packageSessionId={packageSessionId} />
          </>
        ) : (
          <div className="rounded-md bg-card border border-neutral-200 p-5 text-sm text-neutral-600 space-y-stack">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center">
                <span className="text-white text-xs font-bold">D</span>
              </div>
              <span className="font-medium text-neutral-700">
                {getTerminology(ContentTerms.Batch, SystemTerms.Batch)}{" "}
                Discussion
              </span>
            </div>
            <p className="text-neutral-500">
              Select a{" "}
              {getTerminology(
                ContentTerms.Batch,
                SystemTerms.Batch,
              ).toLowerCase()}{" "}
              to view its discussion.
            </p>
          </div>
        )}
      </div>
    ),
  };

  // Ref to track the last fetched key to avoid redundant fetches
  const lastFetchedKeyRef = useRef<string | null>(null);

  // Refs to hold unstable function references
  const fetchModulesRef = useRef(fetchModules);
  const getSlidesWithChapterIdRef = useRef(getSlidesWithChapterId);
  const handleLoadingChangeRef = useRef(handleLoadingChange);
  const updateModuleStatsRef = useRef(updateModuleStats);

  // Keep refs up to date
  useEffect(() => {
    fetchModulesRef.current = fetchModules;
  }, [fetchModules]);

  useEffect(() => {
    getSlidesWithChapterIdRef.current = getSlidesWithChapterId;
  }, [getSlidesWithChapterId]);

  // When any chapter is open and its slides are not yet loaded (or failed), load them
  useEffect(() => {
    openChapters.forEach((chapterId) => {
      const status = slidesLoadingStatus[chapterId] ?? "idle";
      if (status !== "loading" && status !== "loaded") {
        getSlidesWithChapterId(chapterId);
      }
    });
  }, [openChapters, slidesLoadingStatus, getSlidesWithChapterId]);

  // A 2-level outline is a flat slide list, so no chapter ever opens and the
  // effect above never fires. The bulk load in fetchModules normally covers
  // every chapter already; this is the fallback for when it didn't, without
  // which the list would sit empty.
  useEffect(() => {
    if (courseStructure !== 2) return;
    Object.values(subjectModulesMap).forEach((modules) => {
      modules.forEach((mod) => {
        (mod.chapters ?? []).forEach((ch) => {
          const status = slidesLoadingStatus[ch.id] ?? "idle";
          if (status === "idle") {
            getSlidesWithChapterId(ch.id);
          }
        });
      });
    });
  }, [
    courseStructure,
    subjectModulesMap,
    slidesLoadingStatus,
    getSlidesWithChapterId,
  ]);

  useEffect(() => {
    handleLoadingChangeRef.current = handleLoadingChange;
  }, [handleLoadingChange]);

  useEffect(() => {
    updateModuleStatsRef.current = updateModuleStats;
  }, [updateModuleStats]);

  // Ref to hold current courseData without triggering re-renders
  const courseDataRef = useRef(courseData);
  useEffect(() => {
    courseDataRef.current = courseData;
  }, [courseData]);

  // Map course-init subjects to SubjectType for use in fetch and UI
  const courseInitSubjectsAsSubjectType = useMemo((): SubjectType[] => {
    if (!courseInitSubjects?.length) return [];
    return courseInitSubjects.map((s, index) => ({
      id: s.id,
      subject_name: s.subject_name ?? "",
      subject_code: s.subject_code ?? "",
      credit: s.credit ?? 0,
      thumbnail_id: s.thumbnail_id ?? null,
      created_at: s.created_at ?? null,
      updated_at: s.updated_at ?? null,
      subject_order: s.subject_order ?? index,
      percentage_completed: 0,
    }));
  }, [courseInitSubjects]);

  // Subjects to use: from form (getSubjectDetails) or fallback to course-init when form not ready
  // Don't fallback to course-init subjects until level is selected (avoids fetching wrong level's modules)
  const effectiveSubjects = useMemo(() => {
    const fromForm = getSubjectDetails(
      courseData,
      selectedSession,
      selectedLevel,
    );
    if (fromForm.length > 0) return fromForm;
    if (selectedLevel) return courseInitSubjectsAsSubjectType;
    return [];
  }, [
    courseData,
    selectedSession,
    selectedLevel,
    courseInitSubjectsAsSubjectType,
  ]);

  // Key that changes when subjects for current session/level become available (form or course-init).
  const subjectsKeyForCurrentSelection = useMemo(
    () => effectiveSubjects.map((s) => s.id).join(","),
    [effectiveSubjects],
  );

  // Trigger module loading when session, level, or courseData (subjects) changes
  // Use a counter ref to discard stale fetches (e.g. when level changes mid-flight)
  const fetchGenerationRef = useRef(0);

  useEffect(() => {
    // Use effectiveSubjects (form or course-init) so we call modules-with-chapters as soon as we have packageSessionId + subjects
    const subjects = effectiveSubjects;
    const fetchKey = `${packageSessionId}:${subjects.map((s) => s.id).join(",")}`;

    // Skip if level not selected, no packageSessionId, or already fetched this exact combo
    if (
      !selectedLevel ||
      !packageSessionId ||
      !subjects.length ||
      fetchKey === lastFetchedKeyRef.current
    ) {
      return;
    }

    // Increment generation so any in-flight fetch becomes stale
    const generation = ++fetchGenerationRef.current;

    const loadModules = async () => {
      handleLoadingChangeRef.current(true);
      setIsModulesLoading(true);
      try {
        const modulesMap = await fetchModulesRef.current({ subjects });

        // Discard result if a newer fetch was started while this one was in-flight
        if (generation !== fetchGenerationRef.current) return;

        setSubjectModulesMap(modulesMap);
        lastFetchedKeyRef.current = fetchKey;

        // Auto-expand to "you are here": when the latest resume point lives
        // in this course, open the subject/module/chapter chain holding it.
        // Otherwise fall back to expanding the first item in each level.
        const resume = resumeEntryRef.current;
        const resumeModule = resume
          ? (modulesMap[resume.subjectId] || []).find(
              (m) => m.module.id === resume.moduleId,
            )
          : undefined;
        const resumeChapterExists =
          !!resume &&
          !!resumeModule?.chapters?.some((ch) => ch.id === resume.chapterId);

        if (resume && resumeModule && resumeChapterExists) {
          setOpenSubjects(new Set<string>([resume.subjectId]));
          setOpenModules(new Set<string>([resume.moduleId]));
          setOpenChapters(new Set<string>([resume.chapterId]));
        } else {
          const firstSubjectId = subjects[0]?.id;

          if (firstSubjectId) {
            const firstSubjectModules = modulesMap[firstSubjectId] || [];
            const firstModuleId = firstSubjectModules[0]?.module.id;
            const firstChapterId = firstSubjectModules[0]?.chapters[0]?.id;

            const openSubjectsSet = new Set<string>([firstSubjectId]);
            const openModulesSet = new Set<string>();
            const openChaptersSet = new Set<string>();

            if (firstModuleId) {
              openModulesSet.add(firstModuleId);
            }
            if (firstChapterId) {
              openChaptersSet.add(firstChapterId);
            }

            setOpenSubjects(openSubjectsSet);
            setOpenModules(openModulesSet);
            setOpenChapters(openChaptersSet);
          }
        }

        // Load slides for ALL chapters so the slide list shows when any chapter is expanded (course-details page).
        // Bulk endpoint first (one request for the whole package session);
        // per-chapter fallback when it's unavailable. Fire-and-forget so the
        // modules loading gate doesn't wait on slide data.
        const allChapterIds: string[] = [];
        Object.values(modulesMap).forEach((mods) => {
          mods.forEach((m) => {
            (m.chapters ?? []).forEach((ch) => {
              if (ch?.id) allChapterIds.push(ch.id);
            });
          });
        });
        void (async () => {
          const bulkLoaded = await loadAllSlidesBulkRef.current(allChapterIds);
          if (!bulkLoaded) {
            allChapterIds.forEach((chapterId) => {
              getSlidesWithChapterIdRef.current(chapterId);
            });
          }
        })();

        // Update module stats for parent component
        if (updateModuleStatsRef.current) {
          updateModuleStatsRef.current(modulesMap);
        }
      } catch {
        if (generation === fetchGenerationRef.current) {
          setSubjectModulesMap({});
        }
      } finally {
        if (generation === fetchGenerationRef.current) {
          handleLoadingChangeRef.current(false);
          setIsModulesLoading(false);
        }
      }
    };
    loadModules();
  }, [
    packageSessionId,
    selectedSession,
    selectedLevel,
    subjectsKeyForCurrentSelection,
    effectiveSubjects,
  ]);

  // Keep studyLibraryData in sync with effective subjects (form or course-init) so UI shows the list
  useEffect(() => {
    setStudyLibraryData(effectiveSubjects);
  }, [effectiveSubjects]);

  // Prefetch thumbnails for modules/chapters when at their depth
  useEffect(() => {
    const prefetch = async () => {
      if (selectedSubjectId && !selectedModuleId) {
        const mods = subjectModulesMap[selectedSubjectId] || [];
        for (const m of mods) {
          let fileId: string | undefined;
          if (
            m &&
            m.module &&
            typeof m.module === "object" &&
            "thumbnail_id" in m.module
          ) {
            fileId = (m.module as { thumbnail_id?: string }).thumbnail_id;
          }
          const key = `module:${m.module.id}`;
          if (fileId && !thumbUrlById[key]) {
            try {
              const url = await queryClient.fetchQuery(
                getFilePublicUrlQuery(fileId),
              );
              setThumbUrlById((prev) => ({ ...prev, [key]: url }));
            } catch {
              // Silent error handling
            }
          }
        }
      }
      if (selectedSubjectId && selectedModuleId && !selectedChapterId) {
        const mods = subjectModulesMap[selectedSubjectId] || [];
        const mod = mods.find((mm) => mm.module.id === selectedModuleId);
        for (const ch of mod?.chapters || []) {
          const fileId = ch.file_id as string | undefined;
          const key = `chapter:${ch.id}`;
          if (fileId && !thumbUrlById[key]) {
            try {
              const url = await queryClient.fetchQuery(
                getFilePublicUrlQuery(fileId),
              );
              setThumbUrlById((prev) => ({ ...prev, [key]: url }));
            } catch {
              // Silent error handling
            }
          }
        }
      }
    };
    prefetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedSubjectId,
    selectedModuleId,
    selectedChapterId,
    subjectModulesMap,
  ]);

  // Mount/unmount logs to verify which component is active

  // Global prefetch thumbnails for all subjects/modules/chapters
  useEffect(() => {
    const prefetchAll = async () => {
      try {
        const subjectsArr = studyLibraryData ?? [];
        const moduleMapKeys = Object.keys(subjectModulesMap || {});
        const hasSubjects = subjectsArr.length > 0;
        const hasModules = moduleMapKeys.length > 0;
        // Avoid work/logs when nothing to prefetch yet
        if (!hasSubjects && !hasModules) return;

        const pending: Array<{ key: string; fileId: string }> = [];

        // subjects
        for (const s of subjectsArr) {
          const key = `subject:${s.id}`;
          const fileId = getSubjectThumbnailId(s);
          if (fileId && !thumbUrlById[key]) {
            pending.push({ key, fileId });
          }
        }

        // modules + chapters
        Object.values(subjectModulesMap || {}).forEach((mods) => {
          for (const m of mods || []) {
            const moduleKey = `module:${m.module.id}`;
            const moduleFileId = getModuleThumbnailId(m.module);
            if (moduleFileId && !thumbUrlById[moduleKey]) {
              pending.push({ key: moduleKey, fileId: moduleFileId });
            }

            for (const ch of m.chapters || []) {
              const chapterKey = `chapter:${ch.id}`;
              const chapterFileId = ch.file_id ?? undefined;
              if (chapterFileId && !thumbUrlById[chapterKey]) {
                pending.push({ key: chapterKey, fileId: chapterFileId });
              }
            }
          }
        });

        if (pending.length === 0) return;
        // dedupe
        const seen = new Set<string>();
        const unique = pending.filter(({ key }) =>
          seen.has(key) ? false : (seen.add(key), true),
        );
        const results = await Promise.all(
          unique.map(async ({ key, fileId }) => {
            try {
              const url = await queryClient.fetchQuery(
                getFilePublicUrlQuery(fileId),
              );

              return { key, url } as const;
            } catch {
              return { key, url: "" } as const;
            }
          }),
        );

        const updates: Record<string, string> = {};
        for (const { key, url } of results) if (url) updates[key] = url;
        if (Object.keys(updates).length > 0) {
          setThumbUrlById((prev) => ({ ...prev, ...updates }));
        }
      } catch {
        // ignore prefetch errors
      }
    };
    prefetchAll();
  }, [studyLibraryData, subjectModulesMap]);

  // Ensure Content Structure starts at correct depth based on courseStructure once data is ready
  useEffect(() => {
    // Do not override if user already drilled in
    if (selectedSubjectId || selectedModuleId || selectedChapterId) return;
    const subjects = studyLibraryData || [];
    if (subjects.length === 0) return;

    // Helper to pick first module/chapters safely
    const firstSubjectId = subjects[0]?.id;
    const modules = firstSubjectId
      ? subjectModulesMap[firstSubjectId] || []
      : [];
    const firstModuleId = modules[0]?.module.id;
    const firstChapterId = modules[0]?.chapters[0]?.id;

    if (courseStructure >= 5) {
      // subjects at top level - nothing to preselect
      return;
    }
    if (courseStructure === 4 && firstSubjectId) {
      setSelectedSubjectId(firstSubjectId);
      return;
    }
    if (courseStructure === 3 && firstSubjectId && firstModuleId) {
      setSelectedSubjectId(firstSubjectId);
      setSelectedModuleId(firstModuleId);
      return;
    }
    if (
      courseStructure === 2 &&
      firstSubjectId &&
      firstModuleId &&
      firstChapterId
    ) {
      setSelectedSubjectId(firstSubjectId);
      setSelectedModuleId(firstModuleId);
      setSelectedChapterId(firstChapterId);
      getSlidesWithChapterId(firstChapterId);
    }
  }, [
    courseStructure,
    studyLibraryData,
    subjectModulesMap,
    selectedSubjectId,
    selectedModuleId,
    selectedChapterId,
    getSlidesWithChapterId,
  ]);

  useEffect(() => {
    setNavHeading(
      <div className="flex items-center gap-2">
        <div>{getTerminology(ContentTerms.Course, SystemTerms.Course)} Details</div>
      </div>,
    );
  }, [setNavHeading]);

  // Debug logging for render

  return (
    <>
      {/* Donation Dialog for Slide Access */}
      {donationDialogOpen && targetSlideDetails && (
        <DonationDialog
          open={donationDialogOpen}
          onOpenChange={setDonationDialogOpen}
          packageSessionId={packageSessionId}
          instituteId={instituteId || ""}
          token={authToken}
          courseTitle={
            courseData?.courseData?.title ??
            getTerminology(ContentTerms.Course, SystemTerms.Course)
          }
          inviteCode="default"
          mode="slide-access"
          isUserEnrolled={isEnrolledInCourse} // Pass enrollment status
          targetSlideDetails={targetSlideDetails}
          onSlideAccessSuccess={(
            courseId,
            subjectId,
            moduleId,
            chapterId,
            slideId,
          ) => {
            // Navigate to slides after successful donation or skip
            navigateTo(
              `/study-library/courses/course-details/subjects/modules/chapters/slides`,
              {
                courseId,
                subjectId,
                moduleId,
                chapterId,
                slideId,
                sessionId: packageSessionId || "",
              },
            );
            setDonationDialogOpen(false);
            setTargetSlideDetails(null);
          }}
        />
      )}

      <PullToRefreshWrapper onRefresh={refreshData}>
        <div className="flex size-full flex-col gap-stack rounded-lg bg-card pt-0 pb-3 text-neutral-700">
          <Tabs
            value={activeStructureTab}
            onValueChange={handleTabChange}
            className="w-full"
          >
            {renderTabs.length > 1 && (
              <TabsList className="h-auto border-b border-neutral-200/80 bg-transparent p-0 flex flex-row flex-wrap items-center justify-start gap-2 w-full">
                {renderTabs.map((tab: { label: string; value: string }) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className={cn(
                      `inline-flex items-center data-[state=active]:text-primary data-[state=active]:border-primary hover:text-primary -mb-px px-3 whitespace-nowrap
                                    py-2 text-sm font-medium transition-all duration-200
                                    hover:bg-primary-50/60 focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1
                                    data-[state=active]:rounded-t-lg data-[state=active]:border-b-2 data-[state=active]:bg-primary-50/30 data-[state=inactive]:text-neutral-500 data-[state=inactive]:hover:rounded-t-lg`,
                      // Play Styles — self-sufficient: navy active tab (white text),
                      // quiet highlight hover on inactive tabs
                      "[.ui-play_&]:rounded-xl [.ui-play_&]:font-bold",
                      "[.ui-play_&]:data-[state=inactive]:hover:bg-play-highlight [.ui-play_&]:data-[state=inactive]:hover:text-play-ink",
                      "[.ui-play_&]:data-[state=active]:bg-play-navy [.ui-play_&]:data-[state=active]:text-white [.ui-play_&]:data-[state=active]:border-play-navy",
                    )}
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            )}
            <TabsContent
              key={activeStructureTab}
              value={activeStructureTab}
              className={`${
                renderTabs.length > 1 ? "mt-3" : ""
              } rounded-lg bg-white border border-neutral-200/60 p-3 md:p-4`}
            >
              {tabContent[activeStructureTab as TabType]}
            </TabsContent>
          </Tabs>
        </div>
      </PullToRefreshWrapper>
    </>
  );
};
