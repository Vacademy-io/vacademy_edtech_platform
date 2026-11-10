/**
 * What the Fun skin's course page, Learn list and lesson viewer show, worked out
 * from data the existing screens already load. Pure rules with no React, so the
 * screens stay thin and each rule is tested on its own.
 *
 * Nothing here decides access: drip locks, the completion threshold and resume
 * resolution are read from the existing code and passed in.
 */
import { coursePercentOf } from "@/lib/learner-state/course-progress";

/** A slide row's state on the course page. */
export type SlideRowState = "done" | "inProgress" | "notStarted";

/** Same buckets as the outline's status icon: done at the threshold, started above 0. */
export function slideRowState(percent: number | null | undefined, threshold: number): SlideRowState {
  const value = Number(percent ?? 0);
  if (!(value > 0)) return "notStarted";
  return value >= threshold ? "done" : "inProgress";
}

/**
 * "X of Y done" under an open chapter. Only once its slides have loaded and at
 * least one is done; before that the card says what the server says.
 */
export function chapterDoneCount(
  slides: ReadonlyArray<{ percentage_completed?: number | null }> | undefined,
  threshold: number,
): { done: number; total: number } | null {
  if (!slides || slides.length === 0) return null;
  const done = slides.filter((slide) => Number(slide.percentage_completed ?? 0) >= threshold).length;
  return done >= 1 ? { done, total: slides.length } : null;
}

/** A level's server rollup in words: not started, a percent, or done. */
export type ServerProgress = { kind: "notStarted" } | { kind: "percent"; percent: number } | { kind: "done" };

export function serverProgress(percent: number | null | undefined): ServerProgress {
  const value = coursePercentOf(percent);
  if (value === null || value <= 0) return { kind: "notStarted" };
  if (value >= 100) return { kind: "done" };
  return { kind: "percent", percent: Math.round(value) };
}

interface CourseInitProgress {
  course?: { percentage_completed?: number | null } | null;
  package_sessions?: ReadonlyArray<{ id?: string; percentage_completed?: number | null }> | null;
}

/**
 * The course page header's percent: this batch's own number, read on every entry
 * path (the default skin shows it only from the In progress tab). Same precedence
 * as the certificate hook: this batch, then the course-level number, then the
 * snapshot the list carried in the URL. Null when none says, which hides the bar.
 */
export function courseHeaderPercent(
  courseInit: unknown,
  packageSessionId: string | null | undefined,
  searchPercent?: number | null,
): number | null {
  const data = (courseInit ?? null) as CourseInitProgress | null;
  const batches = data?.package_sessions ?? [];
  const hasPerBatch = batches.some((ps) => typeof ps.percentage_completed === "number");
  if (packageSessionId && hasPerBatch) {
    const thisBatch = batches.find((ps) => ps.id === packageSessionId);
    if (thisBatch) return coursePercentOf(thisBatch.percentage_completed ?? 0);
  }
  const fromCourse = coursePercentOf(data?.course?.percentage_completed);
  if (fromCourse !== null) return fromCourse;
  return coursePercentOf(searchPercent);
}

export type CountKind = "subjects" | "modules" | "chapters" | "slides";

/**
 * The count chips in the header band. A course below the depth that shows a level
 * still keeps one seeded placeholder at that level, so a level is counted only when
 * the depth shows it or there is more than one (the sidebar's rule).
 */
export function courseSizeCounts({
  depth,
  subjects,
  modules,
  chapters,
  slides,
}: {
  depth: number;
  subjects: number;
  modules: number;
  chapters: number;
  slides: number | null;
}): Array<{ kind: CountKind; count: number }> {
  const out: Array<{ kind: CountKind; count: number }> = [];
  if (depth >= 5 && subjects > 0) out.push({ kind: "subjects", count: subjects });
  if ((depth >= 4 || modules > 1) && modules > 0) out.push({ kind: "modules", count: modules });
  if ((depth >= 3 || chapters > 1) && chapters > 0) out.push({ kind: "chapters", count: chapters });
  if (slides !== null && slides > 0) out.push({ kind: "slides", count: slides });
  return out;
}

/** Total slides from the per-type counts (the sidebar's processed rows). */
export function totalSlides(rows: ReadonlyArray<{ slide_count?: number | null }> | null | undefined): number | null {
  if (!rows || rows.length === 0) return null;
  return rows.reduce((sum, row) => sum + Math.max(0, Number(row.slide_count ?? 0) || 0), 0);
}

/**
 * The row drawn as "current" (filled, with a lip): this device's resume point in
 * the course, else the first slide, in outline order, that is not done and can be
 * opened. Only loaded chapters are looked at; null when nothing qualifies.
 */
export function pickCurrentSlideId<S extends { id: string; percentage_completed?: number | null }>({
  chapterOrder,
  slidesByChapter,
  canOpen,
  threshold,
  resumeSlideId,
}: {
  chapterOrder: readonly string[];
  slidesByChapter: Readonly<Record<string, readonly S[] | undefined>>;
  canOpen: (slide: S, chapterId: string) => boolean;
  threshold: number;
  resumeSlideId?: string | null;
}): string | null {
  if (resumeSlideId) return resumeSlideId;
  for (const chapterId of chapterOrder) {
    for (const slide of slidesByChapter[chapterId] ?? []) {
      if (Number(slide.percentage_completed ?? 0) < threshold && canOpen(slide, chapterId)) return slide.id;
    }
  }
  return null;
}

/** The kinds the Fun rows draw an icon for. */
export type SlideKind =
  | "video"
  | "pdf"
  | "doc"
  | "presentation"
  | "code"
  | "quiz"
  | "assessment"
  | "question"
  | "assignment"
  | "audio"
  | "htmlVideo"
  | "scorm"
  | "feedback"
  | "other";

export function slideKind(slide: { source_type?: string | null; document_slide?: { type?: string | null } | null }): SlideKind {
  switch ((slide.source_type ?? "").toUpperCase()) {
    case "VIDEO":
      return "video";
    case "QUIZ":
      return "quiz";
    case "ASSESSMENT":
      return "assessment";
    case "QUESTION":
      return "question";
    case "ASSIGNMENT":
      return "assignment";
    case "AUDIO":
      return "audio";
    case "HTML_VIDEO":
      return "htmlVideo";
    case "SCORM":
      return "scorm";
    case "FEEDBACK":
      return "feedback";
    case "DOCUMENT":
      switch ((slide.document_slide?.type ?? "").toUpperCase()) {
        case "PDF":
          return "pdf";
        case "PRESENTATION":
          return "presentation";
        case "CODE":
        case "JUPYTER":
        case "SCRATCH":
          return "code";
        default:
          return "doc";
      }
    default:
      return "other";
  }
}

/** Quiz and assessment rows carry the quiz colour and their icon instead of a number. */
export const isTestKind = (kind: SlideKind): boolean => kind === "quiz" || kind === "assessment";

/** A level name the institute never meant to show ("DEFAULT" placeholders, "default" levels, blanks). */
export const isPlaceholderName = (name: string | null | undefined): boolean => {
  const text = (name ?? "").trim();
  return text === "" || text.toLowerCase() === "default";
};

/** "Class 12 · 2026-27": the level and session labels a learner would recognise. */
export function levelSessionLine(level?: string | null, session?: string | null): string {
  return [level, session]
    .filter((part): part is string => !isPlaceholderName(part))
    .map((part) => part.trim())
    .join(" · ");
}

/** A chapter's progress as the viewer computes it: the mean of its slides, each capped at 100. */
export function chapterMeanPercent(slides: ReadonlyArray<{ percentage_completed?: number | null }>): number {
  if (!slides.length) return 0;
  const sum = slides.reduce((acc, slide) => acc + Math.min(Number(slide.percentage_completed ?? 0) || 0, 100), 0);
  return Math.min(Math.round(sum / slides.length), 100);
}

/** Plain text of a rich description, for a two-line summary. */
export function plainText(html: string | null | undefined): string {
  if (!html) return "";
  const withoutTags = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  const decoded = withoutTags
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return decoded.replace(/\s+/g, " ").trim();
}
