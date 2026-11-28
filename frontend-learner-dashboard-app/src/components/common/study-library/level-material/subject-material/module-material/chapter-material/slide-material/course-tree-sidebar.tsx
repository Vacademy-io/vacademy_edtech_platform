// Full course tree for the slide sidebar: Subject → Module → Chapter → Slide.
// Replaces the per-chapter flat slides list so the learner can jump to any
// slide anywhere in the course without leaving the viewer.
//
// Design notes:
//   • Lazy-load modules per subject on first expand (cached in component
//     state keyed by subjectId). Lazy-load slides per chapter the same way.
//   • Auto-expand the ancestor chain of the current slide on mount so the
//     learner lands with their current spot visible.
//   • "Default" pass-through: if a level has a single node literally named
//     "default" (case-insensitive), that node is skipped and its children
//     render at the parent level. Siblings disable this — a real "Default"
//     subject alongside others is preserved.
//   • Rows are single-line: slide titles are de-duplicated against their
//     ancestor names (teachers often stamp every slide with the module name
//     at one end or the other, which drowned the part that differs) and
//     truncate — the full title appears as a tooltip ONLY when the label is
//     actually clipped, so hovering a short row no longer pops a redundant
//     tooltip over its neighbours.
//   • One emphasis per view: the ancestors of the current slide are marked
//     with a left accent rail and coloured text, and the filled highlight is
//     reserved for the single active slide. (Tinting the whole path gave four
//     adjacent identical fills, so "you are here" was ambiguous.)
//   • Colour carries type and progress, never decoration. Each slide's icon
//     sits in a chip tinted by what the slide asks the learner to DO (watch /
//     read / answer / practise), from the same palette the flat per-chapter
//     sidebar uses, so a colour means the same thing in both sidebar modes.
//     Progress is a hairline along the bottom edge of a row — inside the row,
//     so it survives the sticky pin — at every level from module to slide.
//   • Counts follow one rule at every level — "children of mine completed" —
//     rendered as `total` while nothing is done, `done/total` in flight, and
//     a check once complete. The unit is named in the chip's tooltip, since
//     the numbers alone can't say whether they count chapters or slides.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import {
  CheckCircle,
  GraduationCap,
  LockSimple,
  Stack,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import {
  fetchModulesWithChapters,
  fetchModulesWithChaptersPublic,
} from "@/services/study-library/getModulesWithChapters";
import type {
  ModulesWithChapters,
  Chapter,
} from "@/stores/study-library/use-modules-with-chapters-store";
import { fetchSlidesByChapterId, type Slide } from "@/hooks/study-library/use-slides";
import { getSlideCompletionThreshold } from "@/constants/study-library";
import { isItemLocked } from "@/components/drip-conditions/helpers";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import {
  computeDisplayTitles,
  getSlideMeta,
  getSlideTitle,
  humanizeTitle,
} from "./slide-display-utils";
import { getSlideTypeColors, getSlideTypeIcon } from "./slide-type-colors";
import { useRevealWhenActive } from "./reveal-active-row";

type BreadcrumbSubject = {
  id: string;
  subject_name: string;
  subject_order?: number | null;
};

type Props = {
  courseId: string;
  /** Used only to spot a lone subject that just repeats the course name (a
   *  very common one-subject setup) — that row is then passed through rather
   *  than costing every descendant an indent level. */
  courseName?: string | null;
  sessionId: string; // treated as packageSessionId by the modules API
  subjects: BreadcrumbSubject[];
  currentSubjectId: string;
  currentModuleId: string;
  currentChapterId: string;
  currentSlideId: string;
  /** Modules already fetched for the current subject, if available. Avoids
   *  a redundant network round-trip when the learner arrives from the
   *  breadcrumb flow that already populated the modules store. */
  currentSubjectModules?: ModulesWithChapters[] | null;
  onSlideSelect: (args: {
    subjectId: string;
    moduleId: string;
    chapterId: string;
    slideId: string;
  }) => void;
};

/** Backends frequently wrap content in a "Default" placeholder when a
 *  conceptual level isn't really there (e.g. a 2-level module/chapter course
 *  is returned as a Default subject containing real modules). Any such node
 *  should be invisible — the breadcrumb hides the crumb and the tree
 *  pulls its children up one depth. */
const isDefaultName = (name: string | null | undefined): boolean =>
  (name || "").trim().toLowerCase() === "default";

const normalizeName = (name: string | null | undefined): string =>
  (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** A single subject whose name just repeats the course is the same kind of
 *  placeholder as a "Default" one: it can never be usefully collapsed (that
 *  would hide the whole course), it duplicates the course name already in the
 *  sidebar header, and it costs every module, chapter and slide beneath it a
 *  full indent level — which at 19rem is where the titles start truncating.
 *  Two or more subjects are real navigation and always render. */
const isRedundantLoneSubject = (
  subjects: BreadcrumbSubject[],
  courseName: string | null | undefined
): boolean => {
  if (subjects.length !== 1) return false;
  const subject = normalizeName(subjects[0]?.subject_name);
  const course = normalizeName(courseName);
  // A two-letter name would match by substring against almost anything, so
  // only an exact match counts for very short names.
  if (subject.length < 3 || course.length < 3) return subject === course && !!subject;
  return subject === course || course.includes(subject) || subject.includes(course);
};

// Fixed row height for the expandable levels. The sticky offsets below are
// derived from it, so a padding-only change here would silently leave gaps
// between the pinned rows.
const EXPANDER_ROW_H = 36;

/** Attach the full text as a native tooltip only when the label is actually
 *  clipped — or when `always` says the rendered label isn't a piece of the
 *  real title (a row shown by type because its own name only repeated its
 *  chapter), where the original is worth a hover even though it fits. Set
 *  imperatively so a fully-visible row never pops a tooltip that repeats
 *  what's already on screen and covers its neighbours. */
const titleWhenClipped =
  (text: string, always = false) =>
  (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.title = always || el.scrollWidth > el.clientWidth + 1 ? text : "";
  };

/** Right-hand progress chip shared by every expandable level. One rule:
 *  the number counts this row's direct children, `done/total` appears only
 *  once something is done, and a completed level collapses to a check.
 *
 *  Its colour tracks PROGRESS rather than whether the row is on the current
 *  path — grey while untouched, primary once the learner is under way, a
 *  green check when the level is finished. Where you are is already said by
 *  the accent rail and the row's text colour; what's left to do wasn't said
 *  anywhere, and it's the thing a learner scans a long course for. */
const CountChip = ({
  done,
  total,
  unitLabel,
}: {
  done: number | null;
  total: number;
  unitLabel: string;
}) => {
  const { t } = useTranslation("libraryCommonA");
  if (done != null && done >= total) {
    return (
      <CheckCircle
        className="w-4 h-4 flex-shrink-0 text-success-500"
        weight="fill"
        aria-label={t("courseTree.allCompletedAria", { total, unit: unitLabel })}
      />
    );
  }
  const started = !!done;
  return (
    <span
      title={
        done == null
          ? t("courseTree.totalUnitTooltip", { total, unit: unitLabel })
          : t("courseTree.doneOfTotalTooltip", { done, total, unit: unitLabel })
      }
      className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums [.ui-play_&]:font-black ${
        started
          ? "bg-primary-100 text-primary-500"
          : "bg-gray-100 text-gray-500"
      }`}
    >
      {started ? `${done}/${total}` : total}
    </span>
  );
};

/** Progress along the bottom edge of a row, the way a video scrubber marks a
 *  partly-watched item. It lives inside the row so a pinned (sticky) header
 *  keeps its own bar, and it costs no horizontal space at all — which a
 *  "42%" label would take straight out of the title. */
const ProgressEdge = ({
  pct,
  startPx,
}: {
  pct: number;
  startPx: number;
}) => {
  if (pct <= 0) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-gradient-to-r from-primary-300 to-primary-500"
      style={{
        // Dynamic: the row's own indent and its completion percentage.
        insetInlineStart: `${startPx}px`,
        width: `calc((100% - ${startPx + 12}px) * ${Math.min(pct, 100) / 100})`,
      }}
    />
  );
};

// ── Leaf: a slide row ───────────────────────────────────────────────────────
const SlideRow = ({
  slide,
  isActive,
  isLocked,
  lockMessage,
  depth,
  displayTitle,
  onClick,
}: {
  slide: Slide;
  isActive: boolean;
  /** Drip-gated: shown with a lock and not navigable, matching the flat
   *  per-chapter sidebar. Only known for slides the route has evaluated. */
  isLocked?: boolean;
  lockMessage?: string | null;
  depth: number;
  /** De-duplicated title from computeDisplayTitles (ancestor + sibling
   *  prefixes stripped); the full title stays in the clipped-only tooltip. */
  displayTitle: string;
  onClick: () => void;
}) => {
  const { t } = useTranslation("libraryCommonA");
  const Icon = getSlideTypeIcon(slide);
  const colors = getSlideTypeColors(slide);
  const title = getSlideTitle(slide);
  const label = humanizeTitle(displayTitle);
  // computeDisplayTitles falls back to a type label for slides named exactly
  // like their chapter; those aren't a substring of the real title, so keep
  // the original reachable on hover regardless of clipping.
  const labelIsExcerpt = title.toLowerCase().includes(displayTitle.toLowerCase());
  const meta = getSlideMeta(slide);
  const pct = Math.min(slide.percentage_completed ?? 0, 100);
  const isComplete = pct >= getSlideCompletionThreshold();
  const indent = depth * 14 + 12;

  // Auto-reveal the current slide. The ancestor chain is auto-expanded on
  // mount, but in a 20-chapter course that puts the active row well below the
  // fold — the learner opened the viewer to a sidebar that looked like it had
  // scrolled nowhere. Fires once per active row, so it never fights the
  // learner's own scrolling.
  const rowRef = useRevealWhenActive<HTMLButtonElement>(isActive);

  return (
    <button
      ref={rowRef}
      type="button"
      role="treeitem"
      aria-level={depth + 1}
      aria-current={isActive ? "true" : undefined}
      aria-disabled={isLocked || undefined}
      onClick={isLocked ? undefined : onClick}
      title={isLocked ? lockMessage || t("courseTree.lockedTooltip") : undefined}
      style={{ paddingLeft: `${indent}px` }}
      className={`relative w-full flex items-center gap-2 pe-3 py-2 text-start text-caption border-s-2 transition-colors ${
        isActive
          ? "border-primary-500 bg-primary-50 text-primary-700 font-semibold"
          : "border-transparent text-gray-700 hover:bg-gray-50"
      } ${isLocked ? "cursor-not-allowed opacity-60" : ""}`}
    >
      {/* The icon chip is the row's colour: tinted at rest, filled solid on
          the row the learner is on. Keeping it the TYPE's colour rather than
          the accent means the current row still says what it is, and the
          chip's hue survives whatever primary an institute has themed to. */}
      <span
        className={`flex w-5 h-5 flex-shrink-0 items-center justify-center rounded-md [.ui-play_&]:rounded-lg ${
          isLocked
            ? "bg-gray-100"
            : isActive
            ? colors.solid
            : colors.bg
        }`}
      >
        <Icon
          className={`w-3.5 h-3.5 ${
            isLocked
              ? "text-gray-400"
              : isActive
              ? "text-white"
              : colors.detailText
          }`}
          weight={isActive ? "fill" : "regular"}
        />
      </span>
      <span
        onMouseEnter={titleWhenClipped(title, !labelIsExcerpt)}
        className="min-w-0 flex-1 truncate leading-tight [.ui-play_&]:font-bold"
      >
        {label}
      </span>
      {meta && (
        <span
          className={`text-2xs tabular-nums flex-shrink-0 ${
            isActive ? "text-primary-500" : "text-gray-400"
          }`}
        >
          {meta}
        </span>
      )}
      {isLocked ? (
        <LockSimple className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" weight="fill" />
      ) : (
        isComplete && (
          <CheckCircle
            className="w-4 h-4 text-success-500 flex-shrink-0"
            weight="fill"
          />
        )
      )}
      {!isComplete && !isLocked && (
        <ProgressEdge pct={pct} startPx={indent} />
      )}
    </button>
  );
};

// ── Expandable row (subject/module/chapter) ─────────────────────────────────
// Subjects and modules carry a level icon so they read as containers even
// when scrolled mid-list. Chapters deliberately don't: the chevron, the
// indent and the smaller type already place them, and at a 19rem sidebar the
// 20px that icon took was 20px off every chapter title — which is where the
// truncation the learner actually notices was coming from.
const KIND_ICON: Record<"subject" | "module" | "chapter", PhosphorIcon | null> =
  {
    subject: GraduationCap,
    module: Stack,
    chapter: null,
  };

const ExpanderRow = ({
  label,
  kind,
  depth,
  isOpen,
  isOnCurrentPath,
  loading,
  done,
  total,
  unitLabel,
  progressPct,
  onToggle,
}: {
  label: string;
  kind: "subject" | "module" | "chapter";
  depth: number;
  isOpen: boolean;
  isOnCurrentPath: boolean;
  loading?: boolean;
  /** Direct children completed; null while that isn't known yet (children
   *  load lazily), which renders the size alone instead of a fake "0/". */
  done?: number | null;
  /** Direct children in total; 0/undefined hides the chip entirely. */
  total?: number | null;
  /** Plural noun for the chip's tooltip ("Chapters", "Slides") — the numbers
   *  alone can't say what they count. */
  unitLabel: string;
  /** 0–100 completion for this level, drawn as a hairline along the row's
   *  bottom edge. Gives a long course a visible sense of momentum without
   *  taking a pixel of title width. */
  progressPct?: number | null;
  onToggle: () => void;
}) => {
  const weightClass =
    kind === "chapter"
      ? "font-medium text-caption"
      : "font-semibold text-caption";
  const KindIcon = KIND_ICON[kind];

  // Sticky stacking — each level pins below the one above it while its
  // subtree is scrolled through, so the learner always sees the path they're
  // in without scrolling back up.
  //
  // Offsets are derived from the real row height and from `depth` (the actual
  // rendered depth) rather than `kind`, because pass-through levels are
  // skipped and their children render one level up. Beyond the third level we
  // stop pinning: four stacked headers would eat a third of the panel.
  const canStick = depth <= 2;
  const zClass = depth === 0 ? "z-30" : depth === 1 ? "z-20" : "z-10";

  // A finished level settles into a faint success wash. It's the one place a
  // fill is spent on something other than "you are here", and it reads
  // correctly next to it: green says done, the accent rail says current.
  const isComplete = done != null && !!total && done >= total;

  return (
    <button
      type="button"
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isOpen}
      onClick={onToggle}
      style={{
        paddingLeft: `${depth * 14 + 6}px`,
        top: canStick ? depth * EXPANDER_ROW_H : undefined,
      }}
      className={`relative w-full h-9 flex items-center gap-1.5 pe-2 text-start border-s-2 transition-colors ${
        isComplete
          ? "bg-success-50 hover:bg-success-100"
          : "bg-white hover:bg-gray-50"
      } ${canStick ? `sticky ${zClass}` : ""} ${
        isOnCurrentPath ? "border-primary-300" : "border-transparent"
      }`}
    >
      {isOpen ? (
        <ChevronDownIcon
          className={`w-3 h-3 flex-shrink-0 ${
            isOnCurrentPath ? "text-primary-500" : "text-gray-400"
          }`}
        />
      ) : (
        <ChevronRightIcon
          className={`w-3 h-3 flex-shrink-0 ${
            isOnCurrentPath ? "text-primary-500" : "text-gray-400"
          }`}
        />
      )}
      {KindIcon && (
        <KindIcon
          className={`w-3.5 h-3.5 flex-shrink-0 ${
            isOnCurrentPath ? "text-primary-500" : "text-gray-400"
          }`}
          weight={isOnCurrentPath ? "fill" : "regular"}
        />
      )}
      <span
        onMouseEnter={titleWhenClipped(humanizeTitle(label))}
        className={`${weightClass} min-w-0 flex-1 truncate leading-tight [.ui-play_&]:font-bold ${
          isOnCurrentPath ? "text-primary-700" : "text-gray-800"
        }`}
      >
        {humanizeTitle(label)}
      </span>
      {loading && (
        <div className="w-3 h-3 border-2 border-primary-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      )}
      {!loading && !!total && (
        <CountChip done={done ?? null} total={total} unitLabel={unitLabel} />
      )}
      <ProgressEdge pct={progressPct ?? 0} startPx={depth * 14 + 6} />
    </button>
  );
};

// `courseId` stays in Props for call-site clarity but isn't needed here —
// the modules/slides APIs key off subject, session and chapter ids alone.
export const CourseTreeSidebar = ({
  courseName,
  sessionId,
  subjects,
  currentSubjectId,
  currentModuleId,
  currentChapterId,
  currentSlideId,
  currentSubjectModules,
  onSlideSelect,
}: Props) => {
  const { t } = useTranslation("libraryCommonA");
  // Drip-condition verdicts for the slides the route has evaluated (the
  // current chapter). Anything not in here is left unlocked rather than
  // guessed at — see the note on SlideRow.isLocked.
  const slideEvaluations = useContentStore((state) => state.slideEvaluations);

  const passThroughSubject = useMemo(
    () => isRedundantLoneSubject(subjects, courseName),
    [subjects, courseName]
  );

  // Expansion state — Sets keyed by the node's full path (subjectId /
  // subjectId:moduleId / subjectId:moduleId:chapterId) rather than the
  // bare id, so a module or chapter that appears in multiple subjects
  // toggles independently per subject. Backends sometimes reuse module
  // or chapter ids across subjects; keying by id alone caused state bleed.
  const moduleKey = (subjectId: string, moduleId: string) =>
    `${subjectId}::${moduleId}`;
  const chapterKey = (subjectId: string, moduleId: string, chapterId: string) =>
    `${subjectId}::${moduleId}::${chapterId}`;
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(
    () => new Set(currentSubjectId ? [currentSubjectId] : [])
  );
  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    () =>
      new Set(
        currentSubjectId && currentModuleId
          ? [moduleKey(currentSubjectId, currentModuleId)]
          : []
      )
  );
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
    () =>
      new Set(
        currentSubjectId && currentModuleId && currentChapterId
          ? [chapterKey(currentSubjectId, currentModuleId, currentChapterId)]
          : []
      )
  );

  // Caches — populated on first expand, then reused on subsequent toggles.
  const [subjectModulesMap, setSubjectModulesMap] = useState<
    Record<string, ModulesWithChapters[]>
  >(() =>
    currentSubjectId && currentSubjectModules
      ? { [currentSubjectId]: currentSubjectModules }
      : {}
  );
  const [chapterSlidesMap, setChapterSlidesMap] = useState<
    Record<string, Slide[]>
  >({});

  // Loading flags so the expander chevron can show a spinner while fetching.
  const [loadingSubjects, setLoadingSubjects] = useState<Set<string>>(new Set());
  const [loadingChapters, setLoadingChapters] = useState<Set<string>>(new Set());

  const loadSubjectModules = useCallback(
    async (subjectId: string) => {
      if (!subjectId || subjectModulesMap[subjectId]) return;
      setLoadingSubjects((prev) => new Set(prev).add(subjectId));
      try {
        let modules: ModulesWithChapters[] = [];
        try {
          modules = await fetchModulesWithChapters(subjectId, sessionId || "");
        } catch {
          modules = await fetchModulesWithChaptersPublic(subjectId, sessionId || "");
        }
        setSubjectModulesMap((prev) => ({ ...prev, [subjectId]: modules || [] }));
      } catch {
        toast.error(t("courseTree.toast.loadModulesFailed"));
      } finally {
        setLoadingSubjects((prev) => {
          const next = new Set(prev);
          next.delete(subjectId);
          return next;
        });
      }
    },
    [sessionId, subjectModulesMap]
  );

  const loadChapterSlides = useCallback(
    async (chapterId: string) => {
      if (!chapterId || chapterSlidesMap[chapterId]) return;
      setLoadingChapters((prev) => new Set(prev).add(chapterId));
      try {
        const slides = await fetchSlidesByChapterId(chapterId);
        setChapterSlidesMap((prev) => ({ ...prev, [chapterId]: slides || [] }));
      } catch {
        toast.error(t("courseTree.toast.loadSlidesFailed"));
      } finally {
        setLoadingChapters((prev) => {
          const next = new Set(prev);
          next.delete(chapterId);
          return next;
        });
      }
    },
    [chapterSlidesMap]
  );

  // Auto-expand the current path on mount (and whenever IDs change due to
  // in-tree navigation). This is what gives the learner a "you are here"
  // without any manual clicks.
  useEffect(() => {
    if (currentSubjectId) {
      setExpandedSubjects((prev) => {
        if (prev.has(currentSubjectId)) return prev;
        const next = new Set(prev);
        next.add(currentSubjectId);
        return next;
      });
      loadSubjectModules(currentSubjectId);
    }
    if (currentSubjectId && currentModuleId) {
      const key = moduleKey(currentSubjectId, currentModuleId);
      setExpandedModules((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    }
    if (currentSubjectId && currentModuleId && currentChapterId) {
      const key = chapterKey(
        currentSubjectId,
        currentModuleId,
        currentChapterId
      );
      setExpandedChapters((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      loadChapterSlides(currentChapterId);
    }
  }, [
    currentSubjectId,
    currentModuleId,
    currentChapterId,
    loadSubjectModules,
    loadChapterSlides,
  ]);

  const toggleSubject = useCallback(
    (subjectId: string) => {
      setExpandedSubjects((prev) => {
        const next = new Set(prev);
        if (next.has(subjectId)) next.delete(subjectId);
        else {
          next.add(subjectId);
          loadSubjectModules(subjectId);
        }
        return next;
      });
    },
    [loadSubjectModules]
  );

  const toggleModule = useCallback((subjectId: string, moduleId: string) => {
    const key = moduleKey(subjectId, moduleId);
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleChapter = useCallback(
    (subjectId: string, moduleId: string, chapterId: string) => {
      const key = chapterKey(subjectId, moduleId, chapterId);
      setExpandedChapters((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else {
          next.add(key);
          loadChapterSlides(chapterId);
        }
        return next;
      });
    },
    [loadChapterSlides]
  );

  // Auto-load children of any "Default"-named subject so its modules appear
  // immediately even though the subject row itself is hidden.
  useEffect(() => {
    for (const s of subjects) {
      if (isDefaultName(s.subject_name) || passThroughSubject) {
        loadSubjectModules(s.id);
      }
    }
  }, [subjects, passThroughSubject, loadSubjectModules]);

  // Same idea for any "Default"-named chapter — load its slides up-front so
  // they render in place of the hidden chapter row.
  useEffect(() => {
    for (const subjectId of Object.keys(subjectModulesMap)) {
      for (const modData of subjectModulesMap[subjectId] || []) {
        for (const chapter of modData.chapters || []) {
          if (isDefaultName(chapter.chapter_name)) {
            loadChapterSlides(chapter.id);
          }
        }
      }
    }
  }, [subjectModulesMap, loadChapterSlides]);

  const renderChapter = useCallback(
    (
      subjectId: string,
      moduleId: string,
      chapter: Chapter,
      depth: number,
      ancestorNames: string[]
    ) => {
      const slides = chapterSlidesMap[chapter.id];
      const isLoading = loadingChapters.has(chapter.id);

      // "Default" chapter is a placeholder for "no chapter level here" —
      // hide the chapter row and render its slides at this depth instead.
      if (isDefaultName(chapter.chapter_name)) {
        return (
          <SkippedChapterSlides
            key={`${subjectId}::${moduleId}::${chapter.id}`}
            chapterId={chapter.id}
            depth={depth}
            moduleId={moduleId}
            subjectId={subjectId}
            currentSlideId={currentSlideId}
            slides={slides}
            isLoading={isLoading}
            ancestorNames={ancestorNames}
            ensureLoaded={() => loadChapterSlides(chapter.id)}
            onSlideSelect={onSlideSelect}
          />
        );
      }

      const isOnPath =
        chapter.id === currentChapterId &&
        moduleId === currentModuleId &&
        subjectId === currentSubjectId;
      const isOpen = expandedChapters.has(
        chapterKey(subjectId, moduleId, chapter.id)
      );

      // Count: direct children (slides). Before the slides are fetched, fall
      // back to the per-type counts the chapter object already carries so a
      // collapsed chapter still shows its size — with `done` unknown rather
      // than asserted as 0.
      const slidesTerm = getTerminologyPlural(
        ContentTerms.Slides,
        SystemTerms.Slides
      );
      const fallbackTotal =
        (chapter.video_count ?? 0) +
        (chapter.pdf_count ?? 0) +
        (chapter.doc_count ?? 0) +
        (chapter.question_slide_count ?? 0) +
        (chapter.assignment_slide_count ?? 0) +
        (chapter.unknown_count ?? 0);
      const doneCount = slides
        ? slides.filter(
            (sl) =>
              (sl.percentage_completed ?? 0) >= getSlideCompletionThreshold()
          ).length
        : null;
      const totalCount = slides ? slides.length : fallbackTotal;

      return (
        <div key={`${subjectId}::${moduleId}::${chapter.id}`}>
          <ExpanderRow
            kind="chapter"
            label={chapter.chapter_name}
            depth={depth}
            isOpen={isOpen}
            isOnCurrentPath={isOnPath}
            loading={isLoading}
            done={doneCount}
            total={totalCount}
            unitLabel={slidesTerm}
            progressPct={chapter.percentage_completed ?? 0}
            onToggle={() => toggleChapter(subjectId, moduleId, chapter.id)}
          />
          {isOpen && slides && slides.length > 0 && (() => {
            const displayTitles = computeDisplayTitles(slides, [
              ...ancestorNames,
              chapter.chapter_name,
            ]);
            return (
              <div className="relative" role="group">
                <span
                  aria-hidden
                  className="pointer-events-none absolute bottom-0 top-0 w-px bg-gray-100"
                  style={{ insetInlineStart: `${depth * 14 + 14}px` }}
                />
                {slides
                  .filter((sl) => sl.id !== "feedback-slide")
                  .map((slide) => {
                    const evaluation = slideEvaluations[slide.id];
                    return (
                      <SlideRow
                        key={slide.id}
                        slide={slide}
                        depth={depth + 1}
                        isActive={slide.id === currentSlideId}
                        isLocked={evaluation ? isItemLocked(evaluation) : false}
                        lockMessage={evaluation?.unlockMessage ?? null}
                        displayTitle={
                          displayTitles.get(slide.id) ?? getSlideTitle(slide)
                        }
                        onClick={() =>
                          onSlideSelect({
                            subjectId,
                            moduleId,
                            chapterId: chapter.id,
                            slideId: slide.id,
                          })
                        }
                      />
                    );
                  })}
              </div>
            );
          })()}
          {isOpen && slides && slides.length === 0 && !isLoading && (
            <div
              className="text-caption text-gray-500 py-1.5"
              style={{ paddingLeft: `${(depth + 1) * 14 + 12}px` }}
            >
              {t("courseTree.noUnit", { unit: slidesTerm })}
            </div>
          )}
        </div>
      );
    },
    [
      expandedChapters,
      chapterSlidesMap,
      loadingChapters,
      currentSubjectId,
      currentModuleId,
      currentChapterId,
      currentSlideId,
      slideEvaluations,
      toggleChapter,
      loadChapterSlides,
      onSlideSelect,
    ]
  );

  const renderModule = useCallback(
    (
      subjectId: string,
      modData: ModulesWithChapters,
      depth: number,
      ancestorNames: string[]
    ) => {
      const moduleId = modData.module.id;
      const chapters = modData.chapters || [];

      // "Default" module is a placeholder for "no module level here" — hide
      // the module row and render its chapters at this depth instead. Chapter
      // rendering will recurse and skip any default-named chapters too.
      if (isDefaultName(modData.module.module_name)) {
        return (
          <div key={`${subjectId}::${moduleId}`}>
            {chapters.map((ch) =>
              renderChapter(subjectId, moduleId, ch, depth, ancestorNames)
            )}
          </div>
        );
      }

      const isOnPath =
        moduleId === currentModuleId && subjectId === currentSubjectId;
      const isOpen = expandedModules.has(moduleKey(subjectId, moduleId));
      const chaptersTerm = getTerminologyPlural(
        ContentTerms.Chapters,
        SystemTerms.Chapters
      );
      const doneChapters = chapters.filter(
        (c) => (c.percentage_completed ?? 0) >= getSlideCompletionThreshold()
      ).length;
      const childAncestors = [...ancestorNames, modData.module.module_name];

      return (
        <div key={`${subjectId}::${moduleId}`}>
          <ExpanderRow
            kind="module"
            label={modData.module.module_name}
            depth={depth}
            isOpen={isOpen}
            isOnCurrentPath={isOnPath}
            done={doneChapters}
            total={chapters.length}
            unitLabel={chaptersTerm}
            progressPct={modData.percentage_completed ?? 0}
            onToggle={() => toggleModule(subjectId, moduleId)}
          />
          {/* No indent guide at this level — one guide beside the slide list
              is orientation; nested guides at every level read as stray
              marks at sidebar width. */}
          {isOpen && chapters.length > 0 && (
            <div role="group">
              {chapters.map((ch) =>
                renderChapter(subjectId, moduleId, ch, depth + 1, childAncestors)
              )}
            </div>
          )}
        </div>
      );
    },
    [
      expandedModules,
      currentSubjectId,
      currentModuleId,
      renderChapter,
      toggleModule,
    ]
  );

  const renderSubject = useCallback(
    (subject: BreadcrumbSubject, depth: number) => {
      const modules = subjectModulesMap[subject.id];
      const loading = loadingSubjects.has(subject.id);

      // "Default" subject is a placeholder for "no subject level here" — and
      // a lone subject named after the course is the same thing by another
      // name. Either way, hide the subject row and render its modules at
      // this depth instead. Modules are auto-loaded by the effect above so
      // the children appear without requiring a (now-hidden) toggle.
      if (isDefaultName(subject.subject_name) || passThroughSubject) {
        if (!modules && loading) {
          return (
            <div
              key={subject.id}
              className="text-caption text-gray-500 py-1.5"
              style={{ paddingLeft: `${depth * 14 + 12}px` }}
            >
              {t("courseTree.loading")}
            </div>
          );
        }
        return (
          <div key={subject.id}>
            {(modules || []).map((m) => renderModule(subject.id, m, depth, []))}
          </div>
        );
      }

      const isOnPath = subject.id === currentSubjectId;
      const isOpen = expandedSubjects.has(subject.id);
      const modulesTerm = getTerminologyPlural(
        ContentTerms.Modules,
        SystemTerms.Modules
      );
      const doneModules = modules
        ? modules.filter(
            (m) =>
              (m.percentage_completed ?? 0) >= getSlideCompletionThreshold()
          ).length
        : null;
      return (
        <div key={subject.id}>
          <ExpanderRow
            kind="subject"
            label={subject.subject_name}
            depth={depth}
            isOpen={isOpen}
            isOnCurrentPath={isOnPath}
            loading={loading}
            // Only once the modules are known — they load lazily on expand,
            // so a collapsed-subject chip appeared only for subjects the
            // learner happened to have opened before, which read as
            // inconsistent. (It also read "1 Modules": the old chip spelled
            // out an unconditionally-plural noun.)
            done={doneModules}
            total={modules ? modules.length : 0}
            unitLabel={modulesTerm}
            progressPct={
              modules && modules.length > 0
                ? modules.reduce(
                    (sum, m) => sum + Math.min(m.percentage_completed ?? 0, 100),
                    0
                  ) / modules.length
                : 0
            }
            onToggle={() => toggleSubject(subject.id)}
          />
          {isOpen && modules && modules.length > 0 && (
            <div role="group">
              {modules.map((m) =>
                renderModule(subject.id, m, depth + 1, [subject.subject_name])
              )}
            </div>
          )}
          {isOpen && modules && modules.length === 0 && !loading && (
            <div
              className="text-caption text-gray-500 py-1.5"
              style={{ paddingLeft: `${(depth + 1) * 14 + 12}px` }}
            >
              {t("courseTree.noUnit", { unit: modulesTerm })}
            </div>
          )}
        </div>
      );
    },
    [
      expandedSubjects,
      subjectModulesMap,
      loadingSubjects,
      currentSubjectId,
      passThroughSubject,
      renderModule,
      toggleSubject,
    ]
  );

  return (
    <div className="w-full" role="tree" aria-label={t("courseTree.treeAriaLabel", { course: getTerminology(ContentTerms.Course, SystemTerms.Course) })}>
      {subjects.map((s) => renderSubject(s, 0))}
    </div>
  );
};

// Inline helper used when a module has a single "Default" chapter — we want
// the chapter's slides to appear directly beneath the module expander. This
// component triggers the slide fetch lazily on render.
const SkippedChapterSlides = ({
  chapterId,
  depth,
  moduleId,
  subjectId,
  currentSlideId,
  slides,
  isLoading,
  ancestorNames,
  ensureLoaded,
  onSlideSelect,
}: {
  chapterId: string;
  depth: number;
  moduleId: string;
  subjectId: string;
  currentSlideId: string;
  slides: Slide[] | undefined;
  isLoading: boolean;
  ancestorNames: string[];
  ensureLoaded: () => void;
  onSlideSelect: Props["onSlideSelect"];
}) => {
  const { t } = useTranslation("libraryCommonA");
  const slideEvaluations = useContentStore((state) => state.slideEvaluations);
  useEffect(() => {
    if (!slides && !isLoading) ensureLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  if (isLoading) {
    return (
      <div
        className="text-caption text-gray-500 py-1.5"
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
      >
        {t("courseTree.loading")}
      </div>
    );
  }
  if (!slides || slides.length === 0) {
    const slidesTerm = getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides);
    return (
      <div
        className="text-caption text-gray-500 py-1.5"
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
      >
        {t("courseTree.noUnit", { unit: slidesTerm })}
      </div>
    );
  }
  const displayTitles = computeDisplayTitles(slides, ancestorNames);
  return (
    <div role="group">
      {slides
        .filter((sl) => sl.id !== "feedback-slide")
        .map((slide) => {
          const evaluation = slideEvaluations[slide.id];
          return (
            <SlideRow
              key={slide.id}
              slide={slide}
              depth={depth}
              isActive={slide.id === currentSlideId}
              isLocked={evaluation ? isItemLocked(evaluation) : false}
              lockMessage={evaluation?.unlockMessage ?? null}
              displayTitle={displayTitles.get(slide.id) ?? getSlideTitle(slide)}
              onClick={() =>
                onSlideSelect({
                  subjectId,
                  moduleId,
                  chapterId,
                  slideId: slide.id,
                })
              }
            />
          );
        })}
    </div>
  );
};
