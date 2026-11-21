import { describe, expect, it } from "vitest";
import {
  formatNoteTime,
  groupNotes,
  notesForTutor,
  notesToMarkdown,
  notesToPrintHtml,
  recallHint,
  sortByPosition,
  type ExportLabels,
} from "./format";
import type { LearnerNote } from "./types";

const note = (over: Partial<LearnerNote>): LearnerNote => ({
  id: "1",
  institute_id: "i",
  slide_id: "s",
  kind: "HIGHLIGHT",
  ...over,
});

const labels: ExportLabels = {
  title: "My notes",
  fallbackCourse: "Course",
  fallbackLesson: "Lesson",
  markedArea: "Marked area",
  bookmark: "Bookmark",
  page: (p) => `Page ${p}`,
};

describe("formatNoteTime", () => {
  it("formats minutes and hours", () => {
    expect(formatNoteTime(187_000)).toBe("3:07");
    expect(formatNoteTime(3_787_000)).toBe("1:03:07");
  });
});

describe("sortByPosition", () => {
  it("orders by place, with unplaced notes last", () => {
    const sorted = sortByPosition([
      note({ id: "c" }),
      note({ id: "b", page_index: 4 }),
      note({ id: "a", page_index: 1 }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});

describe("groupNotes", () => {
  it("groups by course then lesson, keeping newest-first course order", () => {
    const groups = groupNotes(
      [
        note({ id: "1", course_id: "B", course_name: "Biology", slide_id: "s1", slide_title: "Cells" }),
        note({ id: "2", course_id: "A", course_name: "Art", slide_id: "s2" }),
        note({ id: "3", course_id: "B", course_name: "Biology", slide_id: "s1", slide_title: "Cells" }),
      ],
      "Course",
      "Lesson",
    );
    expect(groups.map((g) => g.title)).toEqual(["Biology", "Art"]);
    expect(groups[0]?.lessons[0]?.notes).toHaveLength(2);
    expect(groups[1]?.lessons[0]?.title).toBe("Lesson");
  });
});

describe("groupNotes without course names", () => {
  it("puts them in one group", () => {
    const groups = groupNotes(
      [note({ id: "1", course_id: "A", slide_id: "s1" }), note({ id: "2", slide_id: "s2" })],
      "Course",
      "Lesson",
    );
    expect(groups).toHaveLength(1);
  });
});

describe("export", () => {
  const notes = [
    note({ quote_text: "Light <b>matters</b>", note_text: "my words", page_index: 2, slide_title: "Cells" }),
    note({ id: "2", kind: "BOOKMARK", page_index: 5, slide_title: "Cells" }),
  ];
  it("writes markdown with positions and quotes", () => {
    const md = notesToMarkdown(notes, labels);
    expect(md).toContain("> [Page 3] Light <b>matters</b>");
    expect(md).toContain("my words");
    expect(md).toContain("[Page 6] Bookmark");
  });
  it("escapes everything from the learner in the print page", () => {
    const html = notesToPrintHtml(notes, labels);
    expect(html).toContain("Light &lt;b&gt;matters&lt;/b&gt;");
    expect(html).not.toContain("<b>matters");
  });
});

describe("notesForTutor", () => {
  it("skips empty marks and stops at the limit", () => {
    const text = notesForTutor(
      [note({ quote_text: "alpha" }), note({ kind: "BOOKMARK" }), note({ note_text: "x".repeat(50) })],
      20,
    );
    expect(text).toBe("- alpha");
  });
});

describe("recallHint", () => {
  it("gives only the start, and nothing for short text", () => {
    expect(recallHint("one two three four five six")).toBe("one two three four five…");
    expect(recallHint("one two")).toBe("");
  });
});
