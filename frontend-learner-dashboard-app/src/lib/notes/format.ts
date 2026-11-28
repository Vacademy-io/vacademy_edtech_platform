import type { LearnerNote, NoteKind } from "./types";

/** Seconds → "3:07" / "1:03:07". */
export function formatNoteTime(timeMs: number): string {
  const total = Math.max(0, Math.floor(timeMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export interface PositionLabels {
  page: (page: number) => string;
}

/** "Page 3" (1-based for people), "3:07", or nothing. */
export function notePosition(note: LearnerNote, labels: PositionLabels): string | null {
  if (note.page_index !== null && note.page_index !== undefined) {
    return labels.page(note.page_index + 1);
  }
  if (note.time_ms !== null && note.time_ms !== undefined) return formatNoteTime(note.time_ms);
  return null;
}

/** Reading order inside one lesson: by page or moment, then by when it was made. */
export function sortByPosition(notes: LearnerNote[]): LearnerNote[] {
  const place = (n: LearnerNote) => n.page_index ?? n.time_ms ?? Number.MAX_SAFE_INTEGER;
  return [...notes].sort(
    (a, b) => place(a) - place(b) || (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  );
}

export interface LessonGroup {
  slideId: string;
  title: string;
  chapter: string | null;
  notes: LearnerNote[];
}

export interface CourseGroup {
  key: string;
  title: string;
  lessons: LessonGroup[];
}

/**
 * Notebook order: courses and lessons by their newest note, notes in reading
 * order inside a lesson. `fallbackCourse`/`fallbackLesson` name what the note
 * did not record.
 */
export function groupNotes(
  notes: LearnerNote[],
  fallbackCourse: string,
  fallbackLesson: string,
): CourseGroup[] {
  const courses = new Map<string, CourseGroup>();
  const lessons = new Map<string, LessonGroup>();
  for (const note of notes) {
    // Notes without a recorded course name share one group, whatever their id.
    const courseKey = note.course_name ? note.course_id || note.course_name : "_";
    let course = courses.get(courseKey);
    if (!course) {
      course = { key: courseKey, title: note.course_name || fallbackCourse, lessons: [] };
      courses.set(courseKey, course);
    }
    if (note.course_name && course.title === fallbackCourse) course.title = note.course_name;
    const lessonKey = `${courseKey}|${note.slide_id}`;
    let lesson = lessons.get(lessonKey);
    if (!lesson) {
      lesson = {
        slideId: note.slide_id,
        title: note.slide_title || fallbackLesson,
        chapter: note.chapter_name ?? null,
        notes: [],
      };
      lessons.set(lessonKey, lesson);
      course.lessons.push(lesson);
    }
    lesson.notes.push(note);
  }
  for (const lesson of lessons.values()) lesson.notes = sortByPosition(lesson.notes);
  return Array.from(courses.values());
}

export interface ExportLabels extends PositionLabels {
  title: string;
  fallbackCourse: string;
  fallbackLesson: string;
  markedArea: string;
  bookmark: string;
}

function noteLines(note: LearnerNote, labels: ExportLabels) {
  const position = notePosition(note, labels);
  const quote = note.quote_text?.trim() || null;
  const text = note.note_text?.trim() || null;
  const marker: Partial<Record<NoteKind, string>> = {
    AREA: labels.markedArea,
    BOOKMARK: labels.bookmark,
  };
  return { position, quote, text, marker: quote || text ? null : (marker[note.kind] ?? null) };
}

/** The learner's own words and quotes as Markdown. No page images, ever. */
export function notesToMarkdown(notes: LearnerNote[], labels: ExportLabels): string {
  const lines = [`# ${labels.title}`, ""];
  for (const course of groupNotes(notes, labels.fallbackCourse, labels.fallbackLesson)) {
    lines.push(`## ${course.title}`, "");
    for (const lesson of course.lessons) {
      lines.push(`### ${lesson.chapter ? `${lesson.chapter} / ` : ""}${lesson.title}`, "");
      for (const note of lesson.notes) {
        const { position, quote, text, marker } = noteLines(note, labels);
        const prefix = position ? `[${position}] ` : "";
        if (quote) lines.push(`> ${prefix}${quote.replace(/\n+/g, " ")}`);
        if (text) lines.push(quote ? text : `${prefix}${text}`);
        if (marker) lines.push(`${prefix}${marker}`);
        lines.push("");
      }
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * A plain page for the browser's print dialog, which also handles Hindi and
 * other scripts correctly when saved as PDF. Everything from the learner is
 * escaped. `dir` keeps Arabic right-to-left.
 */
export function notesToPrintHtml(notes: LearnerNote[], labels: ExportLabels, dir = "ltr"): string {
  const body = groupNotes(notes, labels.fallbackCourse, labels.fallbackLesson)
    .map((course) => {
      const lessons = course.lessons
        .map((lesson) => {
          const items = lesson.notes
            .map((note) => {
              const { position, quote, text, marker } = noteLines(note, labels);
              return `<div class="note">${position ? `<div class="pos">${escapeHtml(position)}</div>` : ""}${
                quote ? `<blockquote>${escapeHtml(quote)}</blockquote>` : ""
              }${text ? `<p>${escapeHtml(text)}</p>` : ""}${marker ? `<p class="pos">${escapeHtml(marker)}</p>` : ""}</div>`;
            })
            .join("");
          const heading = `${lesson.chapter ? `${lesson.chapter} / ` : ""}${lesson.title}`;
          return `<h3>${escapeHtml(heading)}</h3>${items}`;
        })
        .join("");
      return `<h2>${escapeHtml(course.title)}</h2>${lessons}`;
    })
    .join("");
  return `<!doctype html><html dir="${dir === "rtl" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${escapeHtml(labels.title)}</title><style>
body{font-family:system-ui,sans-serif;color:black;line-height:1.5;margin:32px;font-size:14px}
h1{font-size:22px}h2{font-size:18px;margin-top:28px;border-bottom:1px solid silver;padding-bottom:4px}h3{font-size:15px;margin:18px 0 8px}
.note{margin:0 0 12px;break-inside:avoid}.pos{font-size:12px;color:dimgray}
blockquote{margin:2px 0;padding:2px 10px;border-inline-start:3px solid goldenrod;background:lemonchiffon}p{margin:4px 0;white-space:pre-wrap}
</style></head><body><h1>${escapeHtml(labels.title)}</h1>${body}</body></html>`;
}

/** Up to `maxChars` of the learner's marks, for a request to the tutor. */
export function notesForTutor(notes: LearnerNote[], maxChars = 2400): string {
  const parts: string[] = [];
  let used = 0;
  for (const note of notes) {
    const piece = [note.quote_text?.trim(), note.note_text?.trim()].filter(Boolean).join(" — ");
    if (!piece) continue;
    const line = `- ${piece.replace(/\s+/g, " ")}`;
    if (used + line.length > maxChars) break;
    parts.push(line);
    used += line.length;
  }
  return parts.join("\n");
}

/** The first few words, as a nudge that does not give the whole thing away. */
export function recallHint(text: string, words = 5): string {
  const all = text.trim().split(/\s+/);
  return all.length <= words ? "" : `${all.slice(0, words).join(" ")}…`;
}
