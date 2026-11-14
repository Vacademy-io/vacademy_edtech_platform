import { describe, expect, it } from "vitest";
import {
  chapterDoneCount,
  chapterMeanPercent,
  courseHeaderPercent,
  courseSizeCounts,
  isPlaceholderName,
  isTestKind,
  levelSessionLine,
  listSnapshotPercent,
  pickCurrentSlideId,
  plainText,
  serverProgress,
  shownPercent,
  listRowPercent,
  courseListMetas,
  slideKind,
  slideRowState,
  totalSlides,
} from "./course-outline";

describe("slideRowState", () => {
  it("buckets like the outline icon: done at the threshold, started above zero", () => {
    expect(slideRowState(undefined, 80)).toBe("notStarted");
    expect(slideRowState(null, 80)).toBe("notStarted");
    expect(slideRowState(0, 80)).toBe("notStarted");
    expect(slideRowState(1, 80)).toBe("inProgress");
    expect(slideRowState(79.9, 80)).toBe("inProgress");
    expect(slideRowState(80, 80)).toBe("done");
    expect(slideRowState(100, 80)).toBe("done");
    expect(slideRowState(50, 50)).toBe("done");
  });
});

describe("chapterDoneCount", () => {
  const s = (p: number) => ({ percentage_completed: p });
  it("is null until slides are loaded and one is done", () => {
    expect(chapterDoneCount(undefined, 80)).toBeNull();
    expect(chapterDoneCount([], 80)).toBeNull();
    expect(chapterDoneCount([s(10), s(79)], 80)).toBeNull();
  });
  it("counts slides at or past the threshold", () => {
    expect(chapterDoneCount([s(100), s(80), s(10), s(0), s(0)], 80)).toEqual({ done: 2, total: 5 });
    expect(chapterDoneCount([s(100)], 80)).toEqual({ done: 1, total: 1 });
  });
});

describe("serverProgress", () => {
  it("reads the rollup as not started, a percent or done", () => {
    expect(serverProgress(undefined)).toEqual({ kind: "notStarted" });
    expect(serverProgress(0)).toEqual({ kind: "notStarted" });
    expect(serverProgress(44.6)).toEqual({ kind: "percent", percent: 45 });
    expect(serverProgress(100)).toEqual({ kind: "done" });
    expect(serverProgress(140)).toEqual({ kind: "done" });
  });
});

describe("courseHeaderPercent", () => {
  const init = {
    course: { percentage_completed: 70 },
    package_sessions: [
      { id: "ps-a", percentage_completed: 30 },
      { id: "ps-b", percentage_completed: null },
    ],
  };
  it("takes this batch's own number", () => {
    expect(courseHeaderPercent(init, "ps-a")).toBe(30);
  });
  it("reads a batch with no stored rollup as no progress, not as another batch's number", () => {
    expect(courseHeaderPercent(init, "ps-b")).toBe(0);
  });
  it("falls back to the course number, then the list snapshot", () => {
    expect(courseHeaderPercent(init, "ps-other")).toBe(70);
    expect(courseHeaderPercent({ course: {} }, "ps-a", 40)).toBe(40);
    expect(courseHeaderPercent({ package_sessions: [{ id: "ps-a" }] }, "ps-a")).toBeNull();
  });
  it("is null when nothing says, so the bar hides instead of showing 0%", () => {
    expect(courseHeaderPercent(null, null)).toBeNull();
    expect(courseHeaderPercent({}, "ps-a", undefined)).toBeNull();
  });
  it("clamps odd values", () => {
    expect(courseHeaderPercent({ course: { percentage_completed: 180 } }, null)).toBe(100);
  });
  it("hides a 0 for a course the learner has not joined, but keeps real progress", () => {
    expect(courseHeaderPercent({ course: { percentage_completed: 0 } }, null, null, false)).toBeNull();
    expect(courseHeaderPercent({ package_sessions: [{ id: "ps-a", percentage_completed: 0 }] }, "ps-a", null, false)).toBeNull();
    expect(courseHeaderPercent({ course: { percentage_completed: 0 } }, null, null, true)).toBe(0);
    expect(courseHeaderPercent({ course: { percentage_completed: 25 } }, null, null, false)).toBe(25);
  });
  it("shows no bar when the server has no number and the link came from the All tab", () => {
    const none = { course: { percentage_completed: null }, package_sessions: [{ id: "ps-a", percentage_completed: null }] };
    expect(courseHeaderPercent(none, "ps-a", listSnapshotPercent("ALL", 0))).toBeNull();
    expect(courseHeaderPercent(none, "ps-a", listSnapshotPercent("PROGRESS", 0))).toBe(0);
  });
});

describe("listSnapshotPercent", () => {
  it("trusts the In progress and Completed tabs, which list joined courses only", () => {
    expect(listSnapshotPercent("PROGRESS", 0)).toBe(0);
    expect(listSnapshotPercent("COMPLETED", 100)).toBe(100);
  });
  it("ignores a 0 from the All tab or a custom tab, and keeps real progress from any tab", () => {
    expect(listSnapshotPercent("ALL", 0)).toBeNull();
    expect(listSnapshotPercent("tab-123", 0)).toBeNull();
    expect(listSnapshotPercent(undefined, 0)).toBeNull();
    expect(listSnapshotPercent("ALL", 35)).toBe(35);
  });
  it("is null for anything that is not a number", () => {
    expect(listSnapshotPercent("PROGRESS", undefined)).toBeNull();
    expect(listSnapshotPercent("PROGRESS", "40")).toBeNull();
    expect(listSnapshotPercent("PROGRESS", Number.NaN)).toBeNull();
  });
});

describe("courseSizeCounts", () => {
  it("shows every level a depth-5 course has", () => {
    expect(courseSizeCounts({ depth: 5, subjects: 3, modules: 6, chapters: 14, slides: 96 })).toEqual([
      { kind: "subjects", count: 3 },
      { kind: "modules", count: 6 },
      { kind: "chapters", count: 14 },
      { kind: "slides", count: 96 },
    ]);
  });
  it("hides a level's single placeholder below the depth that shows it", () => {
    expect(courseSizeCounts({ depth: 3, subjects: 1, modules: 1, chapters: 4, slides: 20 })).toEqual([
      { kind: "chapters", count: 4 },
      { kind: "slides", count: 20 },
    ]);
    expect(courseSizeCounts({ depth: 2, subjects: 1, modules: 1, chapters: 1, slides: 7 })).toEqual([
      { kind: "slides", count: 7 },
    ]);
  });
  it("keeps a level that really has several entries", () => {
    expect(courseSizeCounts({ depth: 3, subjects: 1, modules: 2, chapters: 5, slides: null })).toEqual([
      { kind: "modules", count: 2 },
      { kind: "chapters", count: 5 },
    ]);
  });
  it("never shows a zero", () => {
    expect(courseSizeCounts({ depth: 5, subjects: 0, modules: 0, chapters: 0, slides: 0 })).toEqual([]);
  });
});

describe("totalSlides", () => {
  it("sums the per-type rows and is null when there are none", () => {
    expect(totalSlides(null)).toBeNull();
    expect(totalSlides([])).toBeNull();
    expect(totalSlides([{ slide_count: 3 }, { slide_count: 4 }, { slide_count: null }])).toBe(7);
  });
});

describe("pickCurrentSlideId", () => {
  const slides = {
    c1: [
      { id: "a", percentage_completed: 100 },
      { id: "b", percentage_completed: 85 },
    ],
    c2: [
      { id: "c", percentage_completed: 40 },
      { id: "d", percentage_completed: 0 },
    ],
  };
  it("prefers this device's resume point", () => {
    expect(
      pickCurrentSlideId({ chapterOrder: ["c1", "c2"], slidesByChapter: slides, canOpen: () => true, threshold: 80, resumeSlideId: "d" }),
    ).toBe("d");
  });
  it("passes over a resume point that is already done, falling back to the first unfinished slide", () => {
    expect(
      pickCurrentSlideId({ chapterOrder: ["c1", "c2"], slidesByChapter: slides, canOpen: () => true, threshold: 80, resumeSlideId: "a" }),
    ).toBe("c");
  });
  it("passes over a resume point that cannot be opened", () => {
    expect(
      pickCurrentSlideId({
        chapterOrder: ["c1", "c2"],
        slidesByChapter: slides,
        canOpen: (slide) => slide.id !== "d",
        threshold: 80,
        resumeSlideId: "d",
      }),
    ).toBe("c");
  });
  it("keeps a resume point not found yet while a chapter is still loading, and drops it once all have loaded", () => {
    expect(
      pickCurrentSlideId({ chapterOrder: ["c1", "c2", "c3"], slidesByChapter: slides, canOpen: () => true, threshold: 80, resumeSlideId: "z" }),
    ).toBe("z");
    expect(
      pickCurrentSlideId({ chapterOrder: ["c1", "c2"], slidesByChapter: slides, canOpen: () => true, threshold: 80, resumeSlideId: "z" }),
    ).toBe("c");
  });
  it("falls back to the first unfinished slide that can be opened, in outline order", () => {
    expect(pickCurrentSlideId({ chapterOrder: ["c1", "c2"], slidesByChapter: slides, canOpen: () => true, threshold: 80 })).toBe("c");
    expect(
      pickCurrentSlideId({
        chapterOrder: ["c1", "c2"],
        slidesByChapter: slides,
        canOpen: (slide) => slide.id !== "c",
        threshold: 80,
      }),
    ).toBe("d");
  });
  it("uses the threshold it is given and skips chapters not loaded", () => {
    expect(pickCurrentSlideId({ chapterOrder: ["c0", "c1"], slidesByChapter: slides, canOpen: () => true, threshold: 90 })).toBe("b");
  });
  it("is null when everything is done or locked", () => {
    expect(pickCurrentSlideId({ chapterOrder: ["c1"], slidesByChapter: slides, canOpen: () => true, threshold: 80 })).toBeNull();
    expect(pickCurrentSlideId({ chapterOrder: ["c2"], slidesByChapter: slides, canOpen: () => false, threshold: 80 })).toBeNull();
  });
});

describe("slideKind", () => {
  it("maps source types, including the new quiz, assessment, audio and HTML video icons", () => {
    expect(slideKind({ source_type: "VIDEO" })).toBe("video");
    expect(slideKind({ source_type: "QUIZ" })).toBe("quiz");
    expect(slideKind({ source_type: "ASSESSMENT" })).toBe("assessment");
    expect(slideKind({ source_type: "AUDIO" })).toBe("audio");
    expect(slideKind({ source_type: "HTML_VIDEO" })).toBe("htmlVideo");
    expect(slideKind({ source_type: "QUESTION" })).toBe("question");
    expect(slideKind({ source_type: "ASSIGNMENT" })).toBe("assignment");
    expect(slideKind({ source_type: "SCORM" })).toBe("scorm");
    expect(slideKind({ source_type: "FEEDBACK" })).toBe("feedback");
    expect(slideKind({ source_type: "DOCUMENT", document_slide: { type: "PDF" } })).toBe("pdf");
    expect(slideKind({ source_type: "DOCUMENT", document_slide: { type: "PRESENTATION" } })).toBe("presentation");
    expect(slideKind({ source_type: "DOCUMENT", document_slide: { type: "JUPYTER" } })).toBe("code");
    expect(slideKind({ source_type: "DOCUMENT", document_slide: { type: "DOC" } })).toBe("doc");
    expect(slideKind({ source_type: "DOCUMENT" })).toBe("doc");
    expect(slideKind({ source_type: "SOMETHING_NEW" })).toBe("other");
    expect(slideKind({})).toBe("other");
  });
  it("marks quiz and assessment as tests", () => {
    expect(isTestKind("quiz")).toBe(true);
    expect(isTestKind("assessment")).toBe(true);
    expect(isTestKind("video")).toBe(false);
  });
});

describe("names", () => {
  it("treats DEFAULT and blanks as placeholders", () => {
    expect(isPlaceholderName("DEFAULT")).toBe(true);
    expect(isPlaceholderName(" default ")).toBe(true);
    expect(isPlaceholderName("")).toBe(true);
    expect(isPlaceholderName(null)).toBe(true);
    expect(isPlaceholderName("Defaults")).toBe(false);
  });
  it("joins level and session, dropping placeholders", () => {
    expect(levelSessionLine("Class 12", "2026-27")).toBe("Class 12 · 2026-27");
    expect(levelSessionLine("default", "2026-27")).toBe("2026-27");
    expect(levelSessionLine("DEFAULT", "")).toBe("");
    expect(levelSessionLine(undefined, undefined)).toBe("");
  });
});

describe("chapterMeanPercent", () => {
  it("matches the viewer's chapter progress: mean, each slide capped at 100", () => {
    expect(chapterMeanPercent([])).toBe(0);
    expect(chapterMeanPercent([{ percentage_completed: 100 }, { percentage_completed: 0 }])).toBe(50);
    expect(chapterMeanPercent([{ percentage_completed: 150 }, { percentage_completed: null }, { percentage_completed: 20 }])).toBe(40);
  });
});

describe("plainText", () => {
  it("strips tags and entities for a summary line", () => {
    expect(plainText("<p>Optics &amp; <b>light</b></p><script>x()</script>")).toBe("Optics & light");
    expect(plainText(null)).toBe("");
    expect(plainText("&lt;b&gt; tag &nbsp; spaced")).toBe("<b> tag spaced");
  });
});

describe("shownPercent", () => {
  it("prints 0 only before anything starts and 100 only when finished", () => {
    expect(shownPercent(undefined)).toBe(0);
    expect(shownPercent(null)).toBe(0);
    expect(shownPercent(0)).toBe(0);
    expect(shownPercent(-3)).toBe(0);
    expect(shownPercent(0.3)).toBe(1);
    expect(shownPercent(44.6)).toBe(45);
    expect(shownPercent(99.4)).toBe(99);
    expect(shownPercent(99.6)).toBe(99);
    expect(shownPercent(100)).toBe(100);
    expect(shownPercent(140)).toBe(100);
    expect(shownPercent(Number.NaN)).toBe(0);
  });

  it("is what the server rollup prints between the two ends", () => {
    expect(serverProgress(0.3)).toEqual({ kind: "percent", percent: 1 });
    expect(serverProgress(99.6)).toEqual({ kind: "percent", percent: 99 });
  });
});

describe("courseListMetas", () => {
  it("is the level and session line for rows with their own name", () => {
    expect(
      courseListMetas([
        { name: "Physics", level: "Class 12", session: "2026-27", batch: "Morning" },
        { name: "Biology", level: "default", session: "2026-27" },
      ]),
    ).toEqual(["Class 12 · 2026-27", "2026-27"]);
  });

  it("names the batch when two rows share a name and would read the same", () => {
    expect(
      courseListMetas([
        { name: "AI/ML", level: "default", session: "default", batch: "Weekend batch" },
        { name: "ai/ml ", level: "default", session: "default", batch: "Evening batch" },
      ]),
    ).toEqual(["Weekend batch", "Evening batch"]);
  });

  it("keeps the plain line when two rows of one name already differ", () => {
    expect(
      courseListMetas([
        { name: "AI/ML", level: "Beginner", session: "2026", batch: "A" },
        { name: "AI/ML", level: "Advanced", session: "2026", batch: "B" },
      ]),
    ).toEqual(["Beginner · 2026", "Advanced · 2026"]);
  });

  it("puts the part that differs first when two rows share a name", () => {
    expect(
      courseListMetas([
        { name: "Ai/ML", level: "Class 12 Science", session: "2025-26" },
        { name: "Ai/ML", level: "Class 12 Science", session: "2026-27" },
        { name: "Chemistry", level: "Class 12 Science", session: "2026-27" },
      ]),
    ).toEqual(["2025-26 · Class 12 Science", "2026-27 · Class 12 Science", "Class 12 Science · 2026-27"]);
    expect(
      courseListMetas([
        { name: "Ai/ML", level: "Class 12", session: "2026-27", batch: "Weekend" },
        { name: "Ai/ML", level: "Class 12", session: "2026-27", batch: "Evening" },
      ]),
    ).toEqual(["Weekend · Class 12 · 2026-27", "Evening · Class 12 · 2026-27"]);
  });

  it("never repeats a part or shows a placeholder", () => {
    expect(
      courseListMetas([
        { name: "Chem", level: "Class 12", session: "2026-27", batch: "class 12" },
        { name: "Chem", level: "Class 12", session: "2026-27", batch: "DEFAULT" },
      ]),
    ).toEqual(["Class 12 · 2026-27", "Class 12 · 2026-27"]);
  });
});

describe("listRowPercent", () => {
  it("is finished where the home tiles call a course finished (rounds to 100)", () => {
    expect(listRowPercent(99.5)).toBe(100);
    expect(listRowPercent(99.6)).toBe(100);
    expect(listRowPercent(100)).toBe(100);
    expect(listRowPercent(140)).toBe(100);
  });
  it("is shownPercent below that", () => {
    expect(listRowPercent(99.4)).toBe(99);
    expect(listRowPercent(0.3)).toBe(1);
    expect(listRowPercent(0)).toBe(0);
    expect(listRowPercent(null)).toBe(0);
    expect(listRowPercent(Number.NaN)).toBe(0);
  });
});
