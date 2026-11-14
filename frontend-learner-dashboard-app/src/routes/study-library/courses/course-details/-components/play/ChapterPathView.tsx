/**
 * ChapterPathView — the Duolingo-style lesson path for play mode.
 *
 * Renders ONE module's chapters + slides as a winding vertical path of
 * circular nodes. Purely presentational over the same data the Outline
 * tree uses (subjects, subjectModulesMap, slidesMap, drip evaluations);
 * it never fetches — the parent passes data + callbacks.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CaretLeft,
  CaretRight,
  Check,
  Lock,
  Star,
} from "@phosphor-icons/react";
import { cn, toTitleCase } from "@/lib/utils";
import { playIllustrations } from "@/assets/play-illustrations";
import { getSlideCompletionThreshold } from "@/constants/study-library";
import {
  isItemLocked,
  shouldFilterItem,
} from "@/components/drip-conditions/helpers";
import type { DripConditionEvaluation } from "@/utils/drip-conditions";
import type { Slide } from "@/hooks/study-library/use-slides";
import type { SubjectType } from "@/stores/study-library/use-study-library-store";
import type {
  Chapter,
  ModuleWithChapters,
  SubjectModulesMap,
} from "../course-structure-details";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

type SlidesLoadingStatus = Record<
  string,
  "idle" | "loading" | "loaded" | "error"
>;

export interface ChapterPathViewProps {
  subjects: SubjectType[];
  subjectModulesMap: SubjectModulesMap;
  slidesMap: Record<string, Slide[]>;
  slidesLoadingStatus: SlidesLoadingStatus;
  chapterEvaluations: Record<string, DripConditionEvaluation>;
  slideEvaluations: Record<string, DripConditionEvaluation>;
  /** Chapter progress 0–100 (same helper the tree rows use). */
  getChapterProgress: (chapterId: string) => number;
  isModulesLoading: boolean;
  /** False on the ALL tab for unenrolled learners — every node is inert. */
  clickable: boolean;
  /** Module of the learner's latest resume point in this course, if any. */
  resumeModuleId?: string | null;
  onSlideClick: (
    subjectId: string,
    moduleId: string,
    chapterId: string,
    slideId: string
  ) => void;
  /** Lazily load a chapter's slides (no-ops while loading/loaded). */
  onEnsureChapterSlides: (chapterId: string) => void;
}

interface ModuleEntry {
  subject: SubjectType;
  mod: ModuleWithChapters;
}

type SlideNodeState = "completed" | "current" | "locked" | "upcoming";

type PathNode =
  | { kind: "chapter"; chapter: Chapter; complete: boolean }
  | {
      kind: "slide";
      chapter: Chapter;
      slide: Slide;
      state: SlideNodeState;
      lockMessage?: string | null;
    }
  | { kind: "chapter-loading"; chapterId: string }
  | { kind: "finish"; complete: boolean };

/** Winding offsets for slide nodes around the centered spine. */
const WIND_OFFSETS = [
  "translate-x-0",
  "translate-x-8",
  "translate-x-16",
  "translate-x-8",
  "translate-x-0",
  "-translate-x-8",
  "-translate-x-16",
  "-translate-x-8",
] as const;

function PathSkeleton(): JSX.Element {
  return (
    <div className="flex animate-pulse flex-col items-center gap-5 py-6">
      <div className="h-9 w-48 rounded-full bg-play-highlight" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "size-14 rounded-full bg-play-highlight",
            WIND_OFFSETS[i % WIND_OFFSETS.length]
          )}
        />
      ))}
    </div>
  );
}

export function ChapterPathView({
  subjects,
  subjectModulesMap,
  slidesMap,
  slidesLoadingStatus,
  chapterEvaluations,
  slideEvaluations,
  getChapterProgress,
  isModulesLoading,
  clickable,
  resumeModuleId,
  onSlideClick,
  onEnsureChapterSlides,
}: ChapterPathViewProps): JSX.Element {
  const { t } = useTranslation("courseDetailsB");
  const moduleTerm = getTerminology(ContentTerms.Modules, SystemTerms.Modules);
  const chapterTerm = getTerminology(
    ContentTerms.Chapters,
    SystemTerms.Chapters
  );

  // Flatten subject → module pairs in course order (same order as the tree).
  const entries = useMemo((): ModuleEntry[] => {
    const list: ModuleEntry[] = [];
    (subjects ?? []).forEach((subject) => {
      (subjectModulesMap[subject.id] ?? []).forEach((mod) => {
        list.push({ subject, mod });
      });
    });
    return list;
  }, [subjects, subjectModulesMap]);

  // Default module: resume entry's module, else first incomplete, else first.
  const autoIndex = useMemo(() => {
    if (entries.length === 0) return 0;
    if (resumeModuleId) {
      const i = entries.findIndex((e) => e.mod.module.id === resumeModuleId);
      if (i >= 0) return i;
    }
    const firstIncomplete = entries.findIndex((e) =>
      (e.mod.chapters ?? []).some((ch) => {
        const evaluation = chapterEvaluations[ch.id];
        if (evaluation && shouldFilterItem(evaluation)) return false;
        return getChapterProgress(ch.id) < getSlideCompletionThreshold();
      })
    );
    return firstIncomplete >= 0 ? firstIncomplete : 0;
  }, [entries, resumeModuleId, chapterEvaluations, getChapterProgress]);

  // Auto-selection stays reactive until the learner picks a module herself.
  const [pickedModuleId, setPickedModuleId] = useState<string | null>(null);
  const pickedIndex = pickedModuleId
    ? entries.findIndex((e) => e.mod.module.id === pickedModuleId)
    : -1;
  const currentIndex = pickedIndex >= 0 ? pickedIndex : autoIndex;
  const current: ModuleEntry | undefined = entries[currentIndex];

  // Make sure the selected module's slides are loaded (parent dedupes).
  useEffect(() => {
    if (!current) return;
    (current.mod.chapters ?? []).forEach((ch) => {
      const status = slidesLoadingStatus[ch.id] ?? "idle";
      if (status === "idle" || status === "error") {
        onEnsureChapterSlides(ch.id);
      }
    });
  }, [current, slidesLoadingStatus, onEnsureChapterSlides]);

  // Build the node list for the selected module only (performance scope).
  const { nodes, hasAnySlide } = useMemo(() => {
    const built: PathNode[] = [];
    let anySlide = false;
    let currentAssigned = false;
    if (!current) return { nodes: built, hasAnySlide: false };

    const visibleChapters = (current.mod.chapters ?? []).filter((ch) => {
      const evaluation = chapterEvaluations[ch.id];
      return !(evaluation && shouldFilterItem(evaluation));
    });

    let allComplete = visibleChapters.length > 0;

    visibleChapters.forEach((ch) => {
      const chapterEval = chapterEvaluations[ch.id];
      const chapterLocked = !!(chapterEval && isItemLocked(chapterEval));
      const chapterComplete =
        getChapterProgress(ch.id) >= getSlideCompletionThreshold();
      built.push({ kind: "chapter", chapter: ch, complete: chapterComplete });

      const status = slidesLoadingStatus[ch.id] ?? "idle";
      if (status !== "loaded") {
        built.push({ kind: "chapter-loading", chapterId: ch.id });
        allComplete = false;
        return;
      }

      const visibleSlides = (slidesMap[ch.id] ?? []).filter((slide) => {
        const evaluation = slideEvaluations[slide.id];
        return !(evaluation && shouldFilterItem(evaluation));
      });

      visibleSlides.forEach((slide) => {
        anySlide = true;
        const slideEval = slideEvaluations[slide.id];
        const slideLocked =
          chapterLocked || !!(slideEval && isItemLocked(slideEval));
        const completed =
          (slide.percentage_completed || 0) >= getSlideCompletionThreshold();
        if (!completed) allComplete = false;

        let state: SlideNodeState;
        if (completed) {
          state = "completed";
        } else if (slideLocked) {
          state = "locked";
        } else if (!currentAssigned) {
          state = "current";
          currentAssigned = true;
        } else {
          state = "upcoming";
        }
        built.push({
          kind: "slide",
          chapter: ch,
          slide,
          state,
          lockMessage: slideLocked
            ? slideEval?.unlockMessage || chapterEval?.unlockMessage
            : null,
        });
      });
    });

    if (anySlide) {
      built.push({ kind: "finish", complete: allComplete });
    }
    return { nodes: built, hasAnySlide: anySlide };
  }, [
    current,
    chapterEvaluations,
    slideEvaluations,
    slidesMap,
    slidesLoadingStatus,
    getChapterProgress,
  ]);

  if (isModulesLoading) {
    return <PathSkeleton />;
  }

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <playIllustrations.BookLover
          className="h-32 w-auto text-play-muted"
          aria-hidden="true"
        />
        <p className="text-body font-bold text-play-ink">
          {t("chapterPath.emptyModule")}
        </p>
      </div>
    );
  }

  const moduleName = toTitleCase(current.mod.module.module_name);
  const showSubjectCaption = (subjects?.length ?? 0) > 1;

  // Node renderers ---------------------------------------------------------

  const renderSlideNode = (
    node: Extract<PathNode, { kind: "slide" }>,
    windClass: string
  ) => {
    const { slide, chapter, state } = node;
    const inert = !clickable || state === "locked";
    const stateLabel =
      state === "completed"
        ? t("chapterPath.slideState.completed")
        : state === "current"
          ? t("chapterPath.slideState.current")
          : state === "locked"
            ? t("chapterPath.slideState.locked")
            : t("chapterPath.slideState.upcoming");
    const title = !clickable
      ? t("chapterPath.enrollToStart")
      : state === "locked"
        ? node.lockMessage || t("chapterPath.locked")
        : slide.title;

    return (
      <div
        key={slide.id}
        className={cn("relative flex flex-col items-center", windClass)}
      >
        <button
          type="button"
          aria-label={t("chapterPath.slideAriaLabel", {
            title: slide.title,
            state: stateLabel,
          })}
          aria-disabled={inert}
          title={title}
          onClick={
            inert
              ? undefined
              : () =>
                  onSlideClick(
                    current.subject.id,
                    current.mod.module.id,
                    chapter.id,
                    slide.id
                  )
          }
          className={cn(
            "flex items-center justify-center rounded-full transition-transform",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-play-ink/20",
            state === "completed" &&
              "size-14 bg-play-success shadow-play-2d-success",
            state === "current" &&
              "play-pulse size-20 bg-play-gold shadow-play-4d-gold",
            state === "locked" &&
              "size-14 cursor-not-allowed bg-play-surface",
            state === "upcoming" &&
              "size-14 border-2 border-play-surface bg-white",
            !inert && "active:translate-y-0.5 active:shadow-none",
            inert && state !== "locked" && "cursor-not-allowed"
          )}
        >
          {state === "completed" && (
            <Check weight="bold" size={26} className="text-white" />
          )}
          {state === "current" && (
            <Star weight="fill" size={36} className="text-play-ink" />
          )}
          {state === "locked" && (
            <Lock weight="fill" size={22} className="text-play-ink" />
          )}
          {state === "upcoming" && (
            <Star weight="fill" size={22} className="text-play-surface" />
          )}
        </button>
        {state === "current" && (
          <span className="mt-1.5 rounded-full border-2 border-play-surface bg-white px-3 py-0.5 text-caption font-black uppercase tracking-wide text-play-ink shadow-play-badge">
            {t("chapterPath.start")}
          </span>
        )}
      </div>
    );
  };

  const renderChapterMilestone = (
    node: Extract<PathNode, { kind: "chapter" }>
  ) => (
    <div
      key={`chapter-${node.chapter.id}`}
      className="relative flex w-full items-center justify-center gap-3 py-1"
    >
      <span
        className="inline-flex max-w-xs items-center gap-2 truncate rounded-full border-2 border-play-surface bg-white px-4 py-1.5 text-body font-black text-play-ink shadow-play-badge"
        title={t("chapterPath.chapterTitle", {
          chapter: chapterTerm,
          name: toTitleCase(node.chapter.chapter_name),
        })}
      >
        {node.complete && (
          <Check weight="bold" size={16} className="shrink-0 text-play-success" />
        )}
        <span className="truncate">
          {toTitleCase(node.chapter.chapter_name)}
        </span>
      </span>
      {node.complete && (
        <playIllustrations.Treasure
          className="h-10 w-auto shrink-0 text-play-gold"
          aria-hidden="true"
        />
      )}
    </div>
  );

  const renderFinishMilestone = (
    node: Extract<PathNode, { kind: "finish" }>
  ) => (
    <div
      key="finish"
      className="relative flex flex-col items-center gap-2 pt-2"
    >
      <playIllustrations.Winners
        className={cn(
          "h-16 w-auto",
          node.complete ? "text-play-gold" : "text-play-surface"
        )}
        aria-hidden="true"
      />
      <span className="rounded-full border-2 border-play-surface bg-white px-4 py-1 text-caption font-black uppercase tracking-wide text-play-ink shadow-play-badge">
        {node.complete
          ? t("chapterPath.moduleComplete", { module: moduleTerm })
          : t("chapterPath.finishLine")}
      </span>
    </div>
  );

  // Path -------------------------------------------------------------------

  let windCounter = 0;

  return (
    <div className="flex flex-col gap-stack">
      {/* Module switcher (quiet prev/next chips around the module name) */}
      {entries.length > 1 && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label={t("chapterPath.previousModule", { module: moduleTerm })}
            disabled={currentIndex === 0}
            onClick={() =>
              setPickedModuleId(
                entries[currentIndex - 1]?.mod.module.id ?? null
              )
            }
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-play-surface bg-white text-play-ink",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-play-ink/20",
              currentIndex === 0
                ? "cursor-not-allowed opacity-40"
                : "active:translate-y-0.5"
            )}
          >
            <CaretLeft weight="bold" size={18} />
          </button>
          <div className="min-w-0 text-center">
            {showSubjectCaption && (
              <p className="truncate text-caption font-bold text-play-ink/70">
                {toTitleCase(current.subject.subject_name)}
              </p>
            )}
            <p className="truncate text-body font-black text-play-ink">
              {moduleName}
            </p>
            <p className="text-caption font-bold text-play-ink/70">
              {t("chapterPath.moduleProgress", {
                module: moduleTerm,
                current: currentIndex + 1,
                total: entries.length,
              })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("chapterPath.nextModule", { module: moduleTerm })}
            disabled={currentIndex >= entries.length - 1}
            onClick={() =>
              setPickedModuleId(
                entries[currentIndex + 1]?.mod.module.id ?? null
              )
            }
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-play-surface bg-white text-play-ink",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-play-ink/20",
              currentIndex >= entries.length - 1
                ? "cursor-not-allowed opacity-40"
                : "active:translate-y-0.5"
            )}
          >
            <CaretRight weight="bold" size={18} />
          </button>
        </div>
      )}

      {/* The winding path */}
      <div className="relative flex flex-col items-center gap-5 py-4">
        {/* Centered vertical spine */}
        <div
          className="absolute bottom-6 start-1/2 top-6 w-1 -translate-x-1/2 rounded-full bg-play-surface"
          aria-hidden="true"
        />
        {nodes.map((node) => {
          if (node.kind === "chapter") return renderChapterMilestone(node);
          if (node.kind === "finish") return renderFinishMilestone(node);
          if (node.kind === "chapter-loading") {
            return (
              <div
                key={`loading-${node.chapterId}`}
                className="relative flex flex-col items-center gap-5"
              >
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "size-14 animate-pulse rounded-full bg-play-highlight",
                      WIND_OFFSETS[(windCounter + i) % WIND_OFFSETS.length]
                    )}
                  />
                ))}
              </div>
            );
          }
          const windClass = WIND_OFFSETS[windCounter % WIND_OFFSETS.length]!;
          windCounter += 1;
          return renderSlideNode(node, windClass);
        })}
        {!hasAnySlide &&
          nodes.every((n) => n.kind !== "chapter-loading") && (
            <div className="relative flex flex-col items-center gap-stack py-6 text-center">
              <playIllustrations.BookLover
                className="h-28 w-auto text-play-muted"
                aria-hidden="true"
              />
              <p className="text-body font-bold text-play-ink">
                {t("chapterPath.noSlidesYet", {
                  module: moduleTerm.toLowerCase(),
                  slides: getTerminologyPlural(
                    ContentTerms.Slides,
                    SystemTerms.Slides
                  ).toLowerCase(),
                })}
              </p>
            </div>
          )}
      </div>
    </div>
  );
}
