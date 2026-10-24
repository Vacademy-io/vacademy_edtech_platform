// "Lesson list" sidebar for the slide viewer — a flat, thumbnail-led syllabus
// in place of a tree. Where the course-tree sidebar answers "where does this
// slide sit in the course structure?", this one answers "what am I working
// through, and how much is left?" — the reading a learner actually does when
// the course is a linear programme rather than a reference library.
//
// How it differs from the tree, deliberately:
//   • Nothing collapses. Chapters are headings, not toggles, so the whole
//     syllabus reads as one scroll and no click is needed to see what's next.
//   • Rows carry a thumbnail, a two-line title and a duration instead of a
//     single clipped line, so a lesson is recognisable at a glance. Real
//     cover images are used where the content has one; everything else gets a
//     tile in its type's colour, which reads as deliberate rather than as a
//     missing image.
//   • One course-wide progress line at the top, because the question this
//     layout exists to answer is "how far through am I?".
//
// The cost of a flat list is that it wants every chapter's slides at once,
// which for a 22-chapter course is 22 requests. So sections fetch their slides
// when they first scroll into view, and stand in a skeleton of the right
// height until then (the chapter payload already carries its slide count).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretRight, CheckCircle, LockSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import {
  fetchModulesWithChapters,
  fetchModulesWithChaptersPublic,
} from "@/services/study-library/getModulesWithChapters";
import type {
  Chapter,
  ModulesWithChapters,
} from "@/stores/study-library/use-modules-with-chapters-store";
import {
  fetchSlidesByChapterId,
  type Slide,
} from "@/hooks/study-library/use-slides";
import { getSlideCompletionThreshold } from "@/constants/study-library";
import { isItemLocked } from "@/components/drip-conditions/helpers";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { getPublicUrls } from "@/services/upload_file";
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
  sessionId: string; // treated as packageSessionId by the modules API
  subjects: BreadcrumbSubject[];
  currentSubjectId: string;
  currentChapterId: string;
  currentSlideId: string;
  /** Modules already fetched for the current subject, if available. */
  currentSubjectModules?: ModulesWithChapters[] | null;
  onSlideSelect: (args: {
    subjectId: string;
    moduleId: string;
    chapterId: string;
    slideId: string;
  }) => void;
};

const isDefaultName = (name: string | null | undefined): boolean =>
  (name || "").trim().toLowerCase() === "default";

/** Slides a chapter holds, from the counts the chapter payload already carries.
 *  Used for the course total and for sizing a section's skeleton before its
 *  slides are fetched. */
const chapterSlideCount = (chapter: Chapter): number =>
  (chapter.video_count ?? 0) +
  (chapter.pdf_count ?? 0) +
  (chapter.doc_count ?? 0) +
  (chapter.question_slide_count ?? 0) +
  (chapter.assignment_slide_count ?? 0) +
  (chapter.unknown_count ?? 0);

/** Roughly one lesson row: 12px padding, a 40px thumbnail, 12px padding and a
 *  hairline. Titles wrap to two lines, so real rows vary by a few pixels — this
 *  is for reserving a not-yet-fetched section's space, not for laying it out. */
const APPROX_ROW_H = 68;

/** Animated placeholder rows drawn for the section currently fetching. Beyond
 *  this the space is simply reserved — nobody reads the twentieth shimmer. */
const SKELETON_ROWS = 6;

/** Cover ids per lookup. They travel in the query string, so an unbounded
 *  batch is a URL long enough for the gateway to reject. */
const MAX_COVER_BATCH = 40;

/** A slide's cover image, if the content carries one. Checked in order of how
 *  specific it is to this slide. */
const coverFileId = (slide: Slide): string | null =>
  slide.image_file_id ||
  slide.document_slide?.cover_file_id ||
  slide.audio_slide?.thumbnail_file_id ||
  slide.audioSlide?.thumbnail_file_id ||
  null;

// ── One lesson ──────────────────────────────────────────────────────────────
const LessonRow = ({
  slide,
  displayTitle,
  thumbUrl,
  isActive,
  isLocked,
  lockMessage,
  onClick,
}: {
  slide: Slide;
  displayTitle: string;
  thumbUrl?: string;
  isActive: boolean;
  isLocked: boolean;
  lockMessage?: string | null;
  onClick: () => void;
}) => {
  const { t } = useTranslation("libraryCommonB");
  const Icon = getSlideTypeIcon(slide);
  const colors = getSlideTypeColors(slide);
  const meta = getSlideMeta(slide);
  const pct = Math.min(slide.percentage_completed ?? 0, 100);
  const isComplete = pct >= getSlideCompletionThreshold();
  // Bring the lesson in progress into view on arrival. A 49-lesson list opens
  // well past the fold otherwise. The hook retries across frames because this
  // row can mount before the list has grown tall enough to scroll at all.
  const rowRef = useRevealWhenActive<HTMLButtonElement>(isActive);

  return (
    <button
      ref={rowRef}
      type="button"
      onClick={isLocked ? undefined : onClick}
      aria-current={isActive ? "true" : undefined}
      aria-disabled={isLocked || undefined}
      title={isLocked ? lockMessage || t("lessonListSidebar.locked") : undefined}
      className={`group/lesson relative flex w-full items-start gap-3 border-s-2 border-b border-b-gray-100 px-3 py-3 text-start transition-colors ${
        isActive
          ? "border-s-primary-500 bg-primary-50"
          : "border-s-transparent hover:bg-gray-50"
      } ${isLocked ? "cursor-not-allowed opacity-60" : ""}`}
    >
      {/* Thumbnail: the real cover where the content has one, otherwise a tile
          in the type's colour. A generic grey placeholder would read as a
          broken image; a coloured tile reads as the lesson's kind. */}
      <span
        className={`relative flex h-10 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-md [.ui-play_&]:rounded-lg ${
          thumbUrl ? "bg-gray-100" : colors.bg
        }`}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <Icon className={`h-5 w-5 ${colors.detailText}`} weight="duotone" />
        )}
        {isComplete && (
          <span className="absolute inset-0 flex items-center justify-center bg-success-500/85">
            <CheckCircle className="h-5 w-5 text-white" weight="fill" />
          </span>
        )}
        {isLocked && !isComplete && (
          <span className="absolute inset-0 flex items-center justify-center bg-gray-900/45">
            <LockSimple className="h-4 w-4 text-white" weight="fill" />
          </span>
        )}
        {/* Part-watched: the scrubber line, on the thumbnail where a video
            player would put it. */}
        {!isComplete && !isLocked && pct > 0 && (
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-1 bg-gray-900/25"
          >
            <span
              className="block h-full bg-primary-500"
              // Dynamic: this slide's completion.
              style={{ width: `${pct}%` }}
            />
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block text-caption leading-snug line-clamp-2 [.ui-play_&]:font-bold ${
            isActive
              ? "font-semibold text-primary-700"
              : isComplete
              ? "font-medium text-gray-500"
              : "font-medium text-gray-900"
          }`}
        >
          {humanizeTitle(displayTitle)}
        </span>
        {meta && (
          <span className="mt-0.5 block text-2xs tabular-nums text-gray-500">
            {meta}
          </span>
        )}
      </span>

      <CaretRight
        className={`mt-1 h-3.5 w-3.5 flex-shrink-0 transition-transform ${
          isActive
            ? "text-primary-500"
            : "text-gray-300 group-hover/lesson:translate-x-0.5 group-hover/lesson:text-gray-400"
        }`}
        weight="bold"
      />
    </button>
  );
};

// ── One chapter's worth of lessons ──────────────────────────────────────────
const LessonSection = ({
  chapter,
  moduleId,
  subjectId,
  ancestorNames,
  slides,
  isLoading,
  currentSlideId,
  slidesTerm,
  thumbUrls,
  onVisible,
  onSlideSelect,
}: {
  chapter: Chapter;
  moduleId: string;
  subjectId: string;
  ancestorNames: string[];
  slides: Slide[] | undefined;
  isLoading: boolean;
  currentSlideId: string;
  slidesTerm: string;
  thumbUrls: Record<string, string>;
  onVisible: () => void;
  onSlideSelect: Props["onSlideSelect"];
}) => {
  const { t } = useTranslation("libraryCommonB");
  const slideEvaluations = useContentStore((state) => state.slideEvaluations);
  const sectionRef = useRef<HTMLDivElement>(null);
  // `onVisible` is a fresh closure each render; holding it in a ref keeps the
  // observer effect below keyed on the section's own state alone.
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;
  const total = slides ? slides.length : chapterSlideCount(chapter);
  const done = slides
    ? slides.filter(
        (s) => (s.percentage_completed ?? 0) >= getSlideCompletionThreshold()
      ).length
    : null;

  // Fetch this section's slides the first time it comes near the viewport.
  // rootMargin gives it a screen of runway so the rows are there by the time
  // the learner scrolls to them.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || slides || isLoading) return;
    if (typeof IntersectionObserver === "undefined") {
      onVisibleRef.current();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onVisibleRef.current();
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [slides, isLoading]);

  const displayTitles = useMemo(
    () =>
      slides
        ? computeDisplayTitles(slides, [...ancestorNames, chapter.chapter_name])
        : new Map<string, string>(),
    [slides, ancestorNames, chapter.chapter_name]
  );

  const visible = (slides ?? []).filter((s) => s.id !== "feedback-slide");

  return (
    <div ref={sectionRef}>
      {/* Heading, not a toggle: nothing here collapses, so it carries no
          chevron and no hover state. */}
      <div className="px-3 pb-1.5 pt-5">
        <h4 className="text-subtitle font-semibold leading-tight text-gray-900 [.ui-play_&]:font-black">
          {humanizeTitle(chapter.chapter_name)}
        </h4>
        {total > 0 && (
          <p className="mt-0.5 text-2xs text-gray-500 tabular-nums">
            {done == null
              ? t("lessonListSidebar.slideCount", { count: total, term: slidesTerm })
              : t("lessonListSidebar.progressCompleted", { done, total })}
          </p>
        )}
      </div>

      {visible.map((slide) => {
        const evaluation = slideEvaluations[slide.id];
        return (
          <LessonRow
            key={slide.id}
            slide={slide}
            displayTitle={displayTitles.get(slide.id) ?? getSlideTitle(slide)}
            thumbUrl={thumbUrls[slide.id]}
            isActive={slide.id === currentSlideId}
            isLocked={evaluation ? isItemLocked(evaluation) : false}
            lockMessage={evaluation?.unlockMessage ?? null}
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

      {/* An unloaded section still has to occupy its eventual height, or the
          scrollbar jumps as sections stream in behind the learner. But drawing
          one animated skeleton row per slide meant a large course mounted with
          hundreds of pulsing nodes for chapters nobody had scrolled to. So:
          animated rows only for the section actually fetching (a couple at a
          time, capped), and a single reserved-space div for the rest. */}
      {!slides &&
        (isLoading ? (
          <>
            {Array.from({
              length: Math.max(1, Math.min(total, SKELETON_ROWS)),
            }).map((_, i) => (
              <div
                key={i}
                className="flex items-start gap-3 border-b border-gray-100 px-3 py-3"
              >
                <div className="h-10 w-14 flex-shrink-0 animate-pulse rounded-md bg-gray-100" />
                <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                  <div className="h-2.5 w-4/5 animate-pulse rounded bg-gray-100" />
                  <div className="h-2 w-1/3 animate-pulse rounded bg-gray-100" />
                </div>
              </div>
            ))}
            {total > SKELETON_ROWS && (
              <div
                aria-hidden
                // Dynamic: the space the rows still to arrive will occupy.
                style={{ height: (total - SKELETON_ROWS) * APPROX_ROW_H }}
              />
            )}
          </>
        ) : (
          <div
            aria-hidden
            // Dynamic: the space this section will occupy once fetched.
            style={{ height: Math.max(1, total) * APPROX_ROW_H }}
          />
        ))}

      {slides && visible.length === 0 && (
        <p className="px-3 pb-2 text-caption text-gray-500">
          {t("lessonListSidebar.noSlides", { term: slidesTerm })}
        </p>
      )}
    </div>
  );
};

export const LessonListSidebar = ({
  sessionId,
  subjects,
  currentSubjectId,
  currentChapterId,
  currentSlideId,
  currentSubjectModules,
  onSlideSelect,
}: Props) => {
  const { t } = useTranslation("libraryCommonB");
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
  const [loadingChapters, setLoadingChapters] = useState<Set<string>>(
    new Set()
  );
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});

  const slidesTerm = getTerminologyPlural(
    ContentTerms.Slides,
    SystemTerms.Slides
  );
  const modulesTerm = getTerminologyPlural(
    ContentTerms.Modules,
    SystemTerms.Modules
  );

  // Seeded with the subject whose outline arrived as a prop, so the stable
  // loader below doesn't re-fetch what we were handed.
  const requestedSubjects = useRef<Set<string>>(
    new Set(currentSubjectId && currentSubjectModules ? [currentSubjectId] : [])
  );
  const loadSubjectModules = useCallback(
    async (subjectId: string) => {
      if (!subjectId || requestedSubjects.current.has(subjectId)) return;
      requestedSubjects.current.add(subjectId);
      try {
        let modules: ModulesWithChapters[] = [];
        try {
          modules = await fetchModulesWithChapters(subjectId, sessionId || "");
        } catch {
          modules = await fetchModulesWithChaptersPublic(
            subjectId,
            sessionId || ""
          );
        }
        setSubjectModulesMap((prev) => ({
          ...prev,
          [subjectId]: modules || [],
        }));
      } catch {
        requestedSubjects.current.delete(subjectId);
        toast.error(t("lessonListSidebar.loadOutlineFailed"));
      }
    },
    [sessionId]
  );

  // Requested-chapter bookkeeping lives in a ref so this callback can be
  // stable. Deriving the guard from `chapterSlidesMap` instead would give the
  // callback a new identity every time any section landed, which tears down
  // and rebuilds the IntersectionObserver of every other section on the page.
  const requestedChapters = useRef<Set<string>>(new Set());
  const loadChapterSlides = useCallback(async (chapterId: string) => {
    if (!chapterId || requestedChapters.current.has(chapterId)) return;
    requestedChapters.current.add(chapterId);
    setLoadingChapters((prev) => new Set(prev).add(chapterId));
    try {
      const slides = await fetchSlidesByChapterId(chapterId);
      setChapterSlidesMap((prev) => ({ ...prev, [chapterId]: slides || [] }));
    } catch {
      // One section failing shouldn't toast once per chapter on a bad
      // connection. It renders empty; allow a later attempt to retry it.
      requestedChapters.current.delete(chapterId);
      setChapterSlidesMap((prev) => ({ ...prev, [chapterId]: [] }));
    } finally {
      setLoadingChapters((prev) => {
        const next = new Set(prev);
        next.delete(chapterId);
        return next;
      });
    }
  }, []);

  // Every subject's outline, up front: the list is flat, so there is no
  // expand step during which to fetch it. Chapters within it still stream.
  useEffect(() => {
    for (const s of subjects) loadSubjectModules(s.id);
  }, [subjects, loadSubjectModules]);

  // The current chapter first, regardless of where it sits in the scroll.
  useEffect(() => {
    if (currentChapterId) loadChapterSlides(currentChapterId);
  }, [currentChapterId, loadChapterSlides]);

  // Resolve cover images in one batched request per arriving chapter rather
  // than one per slide.
  useEffect(() => {
    const pending = Object.values(chapterSlidesMap)
      .flat()
      // `in`, not truthiness: a slide whose cover can't be resolved is
      // recorded as "" below, and `!""` would put it straight back into
      // `pending` — the effect writes thumbUrls, so it re-runs, re-requests,
      // and never stops. An entry existing at all means "already asked".
      .filter((slide) => !(slide.id in thumbUrls))
      .map((slide) => ({ slideId: slide.id, fileId: coverFileId(slide) }))
      .filter(
        (entry): entry is { slideId: string; fileId: string } => !!entry.fileId
      );
    if (pending.length === 0) return;

    let cancelled = false;
    // media-service takes the ids in the query string, so a chapter with a
    // hundred covers would build a URL long enough to be rejected. Ask for a
    // batch at a time; the rest come back on the next pass, since anything
    // still missing an entry stays in `pending`.
    const uniqueIds = Array.from(new Set(pending.map((p) => p.fileId))).slice(
      0,
      MAX_COVER_BATCH
    );
    const requested = new Set(uniqueIds);
    getPublicUrls(uniqueIds.join(","))
      .then((files: unknown) => {
        if (cancelled) return;
        const urlById = new Map<string, string>(
          (Array.isArray(files) ? files : [])
            .filter(
              (file: { id?: string; url?: string }) => !!file?.id && !!file?.url
            )
            .map((file: { id: string; url: string }) => [file.id, file.url])
        );
        setThumbUrls((prev) => {
          const next = { ...prev };
          for (const { slideId, fileId } of pending) {
            if (!requested.has(fileId)) continue; // left for the next batch
            // Misses are recorded as "" so they aren't asked for again.
            next[slideId] = urlById.get(fileId) ?? "";
          }
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setThumbUrls((prev) => {
          const next = { ...prev };
          for (const { slideId, fileId } of pending) {
            if (requested.has(fileId)) next[slideId] = "";
          }
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [chapterSlidesMap, thumbUrls]);

  // ── Course-wide progress ──────────────────────────────────────────────────
  // Total comes from the chapter counts, which are known without fetching a
  // single slide. Completed is each chapter's own percentage applied to its
  // count and floored, so a part-finished chapter never rounds itself up into
  // a lesson the learner hasn't finished.
  const { totalLessons, doneLessons } = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const subject of subjects) {
      for (const modData of subjectModulesMap[subject.id] ?? []) {
        for (const chapter of modData.chapters ?? []) {
          const loaded = chapterSlidesMap[chapter.id];
          if (loaded) {
            total += loaded.filter((s) => s.id !== "feedback-slide").length;
            done += loaded.filter(
              (s) =>
                (s.percentage_completed ?? 0) >= getSlideCompletionThreshold()
            ).length;
          } else {
            const count = chapterSlideCount(chapter);
            total += count;
            done += Math.floor(
              (Math.min(chapter.percentage_completed ?? 0, 100) / 100) * count
            );
          }
        }
      }
    }
    return { totalLessons: total, doneLessons: Math.min(done, total) };
  }, [subjects, subjectModulesMap, chapterSlidesMap]);

  const coursePct =
    totalLessons > 0 ? Math.round((doneLessons / totalLessons) * 100) : 0;

  return (
    <div className="w-full pb-2">
      {/* One course-wide progress line — the question this layout exists to
          answer. Sticky, so it stays readable however far down the syllabus
          the learner has scrolled. */}
      <div className="sticky top-0 z-20 border-b border-gray-100 bg-gray-50 px-3 py-2.5">
        <p className="text-caption font-medium text-gray-700 tabular-nums">
          {totalLessons > 0
            ? t("lessonListSidebar.courseProgress", {
                done: doneLessons,
                total: totalLessons,
                term: slidesTerm,
              })
            : slidesTerm}
        </p>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 [.ui-play_&]:h-2">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary-400 to-primary-500 transition-all duration-500 ease-out"
            // Dynamic: course completion.
            style={{ width: `${coursePct}%` }}
          />
        </div>
      </div>

      {subjects.map((subject) => {
        const modules = subjectModulesMap[subject.id] ?? [];
        const showSubjectName =
          !isDefaultName(subject.subject_name) && subjects.length > 1;
        return (
          <div key={subject.id}>
            {showSubjectName && (
              <p className="border-b border-gray-100 bg-gray-50/70 px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-gray-500">
                {humanizeTitle(subject.subject_name)}
              </p>
            )}
            {modules.map((modData) => {
              const moduleId = modData.module.id;
              const chapters = modData.chapters ?? [];
              // A single module named like a placeholder is scaffolding, not a
              // part of the syllabus — its chapters are the real sections.
              const showModuleName =
                !isDefaultName(modData.module.module_name) &&
                (modules.length > 1 || chapters.length > 6);
              const ancestorNames = [
                subject.subject_name,
                modData.module.module_name,
              ];
              return (
                <div key={`${subject.id}::${moduleId}`}>
                  {showModuleName && (
                    <p className="mt-4 border-y border-gray-100 bg-gray-50/70 px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-gray-500">
                      {humanizeTitle(modData.module.module_name)}
                      <span className="ms-1.5 font-normal normal-case tracking-normal text-gray-400 tabular-nums">
                        {chapters.length}{" "}
                        {getTerminologyPlural(
                          ContentTerms.Chapters,
                          SystemTerms.Chapters
                        )}
                      </span>
                    </p>
                  )}
                  {chapters.map((chapter) => (
                    <LessonSection
                      key={`${moduleId}::${chapter.id}`}
                      chapter={chapter}
                      moduleId={moduleId}
                      subjectId={subject.id}
                      ancestorNames={ancestorNames}
                      slides={chapterSlidesMap[chapter.id]}
                      isLoading={loadingChapters.has(chapter.id)}
                      currentSlideId={currentSlideId}
                      slidesTerm={slidesTerm}
                      thumbUrls={thumbUrls}
                      onVisible={() => loadChapterSlides(chapter.id)}
                      onSlideSelect={onSlideSelect}
                    />
                  ))}
                </div>
              );
            })}
            {modules.length === 0 && (
              <p className="px-3 py-4 text-caption text-gray-500">
                {t("lessonListSidebar.noModulesYet", { term: modulesTerm })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
