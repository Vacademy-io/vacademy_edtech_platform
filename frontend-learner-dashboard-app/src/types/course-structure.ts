/**
 * Shared course-structure data contract.
 *
 * Both course-details views render this same `/modules-with-chapters` payload:
 *
 *   routes/courses/course-details/...              public browse (unenrolled)
 *   routes/study-library/courses/course-details/…  enrolled learner view
 *
 * They are NOT a forked screen — one is a catalogue page and the other is the
 * learning surface, so they legitimately differ in what they render. What they
 * must never differ on is the shape of the data, and until now each declared
 * its own copy of these interfaces. The browse copy simply omitted the
 * progress/drip fields, so the two definitions had already drifted: a change to
 * the server payload had to be mirrored by hand in two places, and nothing
 * caught it if you only did one.
 *
 * The definitions below are the superset (the enrolled view's), which the
 * browse view's were a strict subset of — every field it declared is here,
 * unchanged. The extra fields are optional, so the browse view compiles and
 * behaves exactly as before; it just ignores them.
 */

export interface Chapter {
  id: string;
  chapter_name: string;
  status: string;
  description: string;
  file_id: string | null;
  chapter_order: number;
  // Server-computed rollup from /modules-with-chapters. Always present in the
  // payload; typed optional only because a few local placeholder objects
  // construct a Chapter without it.
  percentage_completed?: number;
  drip_condition_json?: string | null;
  drip_condition?: string | null; // JSON string from API
}

export interface ChapterMetadata {
  chapter: Chapter;
  slides_count: {
    video_count: number;
    pdf_count: number;
    doc_count: number;
    unknown_count: number;
  };
  chapter_in_package_sessions: string[];
}

export interface Module {
  id: string;
  module_name: string;
  status: string;
  description: string;
  thumbnail_id: string;
}

export interface ModuleWithChapters {
  module: Module;
  module_order: number | null;
  // Server-computed module rollup from /modules-with-chapters. Null when the
  // module has no learner-visible content at all, which is why the subject
  // average skips it instead of scoring it 0.
  percentage_completed?: number | null;
  chapters: Chapter[];
}

export type SubjectModulesMap = { [subjectId: string]: ModuleWithChapters[] };
