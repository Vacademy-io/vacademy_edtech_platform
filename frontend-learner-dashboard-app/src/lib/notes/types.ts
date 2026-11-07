export type NoteKind = "HIGHLIGHT" | "AREA" | "BOOKMARK" | "NOTE";
export type NoteColor = "yellow" | "green" | "blue" | "pink";

export const NOTE_COLORS: NoteColor[] = ["yellow", "green", "blue", "pink"];

/** A box on a page, in percent of that page, so it holds at every zoom. */
export interface NoteRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoteAnchor {
  rects?: NoteRect[];
}

export interface LearnerNote {
  id: string;
  institute_id: string;
  slide_id: string;
  slide_type?: string | null;
  slide_title?: string | null;
  chapter_name?: string | null;
  course_name?: string | null;
  course_id?: string | null;
  level_id?: string | null;
  subject_id?: string | null;
  module_id?: string | null;
  chapter_id?: string | null;
  package_session_id?: string | null;
  kind: NoteKind;
  color?: NoteColor | null;
  page_index?: number | null;
  time_ms?: number | null;
  anchor_json?: string | null;
  quote_text?: string | null;
  note_text?: string | null;
  review_stage?: number;
  next_review_at?: string | null;
  last_reviewed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface NotebookPage {
  content: LearnerNote[];
  page_no: number;
  page_size: number;
  total_elements: number;
  last: boolean;
}

/** Where a new note belongs. Stored with it so the notebook can link back. */
export type LessonContext = Pick<
  LearnerNote,
  | "institute_id"
  | "slide_id"
  | "slide_type"
  | "slide_title"
  | "chapter_name"
  | "course_name"
  | "course_id"
  | "level_id"
  | "subject_id"
  | "module_id"
  | "chapter_id"
  | "package_session_id"
>;
