/**
 * What the Fun skin's course page, Learn list and lesson viewer show, worked out
 * from data the existing screens already load. Pure rules with no React, so the
 * screens stay thin and each rule is tested on its own.
 *
 * Nothing here decides access: drip locks, the completion threshold and resume
 * resolution are read from the existing code and passed in.
 */
import { coursePercentOf } from "@/lib/learner-state/course-progress";
import { distinctPartsFirst } from "@/components/design-system/fun/distinct-first";

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
  return { kind: "percent", percent: shownPercent(value) };
}

/**
 * A percent as the Fun lists print it, one whole number that both the words and
 * the tick read: 0 only when nothing has started, 100 only when it is finished.
 * Anything in between stays within 1-99, so 0.3% never reads "0% done" and
 * 99.6% never reads "100% done" without the tick.
 */
export function shownPercent(value: number | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 100) return 100;
  return Math.min(99, Math.max(1, Math.round(n)));
}

/**
 * A course row's percent on the Learn list: finished where the home tiles call it
 * finished (rounds to 100, enrolled-courses.ts), else shownPercent. So 99.6% shows
 * the tick and Review on both screens, and 99.4% reads "99% done" on both.
 */
export function listRowPercent(value: number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && Math.round(n) >= 100 ? 100 : shownPercent(n);
}

interface CourseInitProgress {
  course?: { percentage_completed?: number | null } | null;
  package_sessions?: ReadonlyArray<{ id?: string; percentage_completed?: number | null }> | null;
}

/**
 * The percent a course list row put in the link, when it can be trusted. The
 * In progress and Completed tabs list only courses the learner is in; the All
 * tab writes 0 for every course without progress, joined or not, so a 0 from
 * there says nothing (the Learn row shows no progress for it either).
 */
export function listSnapshotPercent(tab: string | null | undefined, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const enrolledTab = tab === "PROGRESS" || tab === "COMPLETED";
  return enrolledTab || value > 0 ? coursePercentOf(value) : null;
}

/**
 * The course page header's percent: this batch's own number, read on every entry
 * path (the default skin shows it only from the In progress tab). Same precedence
 * as the certificate hook: this batch, then the course-level number, then the
 * snapshot the list carried in the URL (pass it through listSnapshotPercent).
 * Null when none says, which hides the bar. A 0 for a course the learner has not
 * joined is not progress, so it hides the bar too.
 */
export function courseHeaderPercent(
  courseInit: unknown,
  packageSessionId: string | null | undefined,
  searchPercent?: number | null,
  enrolled = true,
): number | null {
  const data = (courseInit ?? null) as CourseInitProgress | null;
  const batches = data?.package_sessions ?? [];
  const hasPerBatch = batches.some((ps) => typeof ps.percentage_completed === "number");
  let value: number | null = null;
  const thisBatch =
    packageSessionId && hasPerBatch ? batches.find((ps) => ps.id === packageSessionId) : undefined;
  if (thisBatch) {
    value = coursePercentOf(thisBatch.percentage_completed ?? 0);
  } else {
    value = coursePercentOf(data?.course?.percentage_completed) ?? coursePercentOf(searchPercent);
  }
  if (value !== null && value <= 0 && !enrolled) return null;
  return value;
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
 * the course while that slide is unfinished and can be opened, else the first
 * slide, in outline order, that is not done and can be opened. Only loaded
 * chapters are looked at; null when nothing qualifies. A resume slide not found
 * yet is kept while some chapter is still loading, so the row does not jump.
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
  if (resumeSlideId) {
    let found = false;
    for (const chapterId of chapterOrder) {
      const slide = (slidesByChapter[chapterId] ?? []).find((item) => item.id === resumeSlideId);
      if (!slide) continue;
      found = true;
      if (Number(slide.percentage_completed ?? 0) < threshold && canOpen(slide, chapterId)) return resumeSlideId;
      break;
    }
    if (!found && chapterOrder.some((chapterId) => slidesByChapter[chapterId] === undefined)) return resumeSlideId;
  }
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

/** One row of a course list, as far as telling two rows apart goes. */
export interface CourseListRowNames {
  name?: string | null;
  level?: string | null;
  session?: string | null;
  /** The batch (package session) name, when the list carries it. */
  batch?: string | null;
}

/**
 * The line under each row of a course list. A course the learner is in through
 * two batches shows up twice under one name, so rows that share a name also
 * name their batch when the level and session alone would read the same.
 * Placeholder ("default") names are never shown, and a part is not repeated.
 * Among rows of one name, the part that differs comes first, so a narrow row that
 * cuts the line still shows it.
 */
export function courseListMetas(rows: ReadonlyArray<CourseListRowNames>): string[] {
  const key = (text: string | null | undefined) => (text ?? "").trim().toLocaleLowerCase();
  const byName = new Map<string, number>();
  rows.forEach((row) => byName.set(key(row.name), (byName.get(key(row.name)) ?? 0) + 1));
  const base = rows.map((row) => levelSessionLine(row.level, row.session));
  const baseCount = new Map<string, number>();
  rows.forEach((row, i) => {
    const k = `${key(row.name)}|${key(base[i])}`;
    baseCount.set(k, (baseCount.get(k) ?? 0) + 1);
  });
  const partsOf = (row: CourseListRowNames, i: number): string[] => {
    const sameLine = (baseCount.get(`${key(row.name)}|${key(base[i])}`) ?? 0) > 1;
    const parts: string[] = [];
    for (const part of sameLine ? [row.level, row.session, row.batch] : [row.level, row.session]) {
      if (isPlaceholderName(part)) continue;
      const text = part!.trim();
      if (!parts.some((p) => p.toLocaleLowerCase() === text.toLocaleLowerCase())) parts.push(text);
    }
    return parts;
  };
  const out = rows.map((_, i) => base[i]!);
  const groups = new Map<string, number[]>();
  rows.forEach((row, i) => {
    if ((byName.get(key(row.name)) ?? 0) < 2) return;
    groups.set(key(row.name), [...(groups.get(key(row.name)) ?? []), i]);
  });
  for (const indexes of groups.values()) {
    const ordered = distinctPartsFirst(indexes.map((i) => partsOf(rows[i]!, i)));
    indexes.forEach((rowIndex, at) => {
      out[rowIndex] = (ordered[at] ?? []).join(" · ");
    });
  }
  return out;
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
