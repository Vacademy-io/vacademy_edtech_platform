import { describe, expect, it, vi } from "vitest";
import type { ResumeEntry } from "@/services/resume-thread";
import type { DashboardSlide } from "../-types/dashboard-data-types";
import {
  countLessons,
  isTestLikeSlide,
  lessonClosedByDrip,
  liveChaptersFrom,
  serverLessons,
  verifyResume,
  verifyServerLessons,
  type DeviceResumeChecks,
  type EnrolledCourseRow,
  type LiveChapter,
  type LiveSlide,
  type ResumeDripRules,
} from "./resume-target";

const entry = (over: Partial<ResumeEntry> = {}): ResumeEntry => ({
  instituteId: "i",
  courseId: "c1",
  subjectId: "sub1",
  moduleId: "mod1",
  chapterId: "ch1",
  slideId: "s1",
  sessionId: "ps1",
  slideTitle: "Title when visited",
  updatedAt: 1,
  ...over,
});

const enrolled = (...courses: EnrolledCourseRow[]) => async () => ({ courses, complete: true });

const noDrip: ResumeDripRules = {
  conditionFor: () => null,
  courseCondition: () => null,
  rowLevelEnabled: false,
};

function checks(
  over: Partial<DeviceResumeChecks> = {},
): DeviceResumeChecks & { forget: ReturnType<typeof vi.fn> } {
  return {
    enrolledCourses: enrolled({ id: "c1", package_session_id: "ps1", percentage_completed: 20 }),
    liveChapters: async () => [{ chapterId: "ch1", moduleId: "mod1", open: true }],
    liveSlides: async () => [{ id: "s1", title: "Title now", source_type: "VIDEO" }],
    dripRules: async () => noDrip,
    ...over,
    forget: vi.fn(),
  };
}

describe("verifyResume", () => {
  it("offers nothing with no history, and asks the server nothing", async () => {
    const enrolledCourses = vi.fn(enrolled());
    expect(await verifyResume([], checks({ enrolledCourses }))).toBeNull();
    expect(enrolledCourses).not.toHaveBeenCalled();
  });

  it("offers a live lesson with the title the server has now", async () => {
    const result = await verifyResume([entry()], checks());
    expect(result?.slideId).toBe("s1");
    expect(result?.slideTitle).toBe("Title now");
  });

  it("drops a removed lesson and moves on to the next course", async () => {
    const c = checks({
      enrolledCourses: enrolled(
        { id: "c1", package_session_id: "ps1" },
        { id: "c2", package_session_id: "ps2" },
      ),
      liveChapters: async () => [
        { chapterId: "ch1", moduleId: "mod1", open: true },
        { chapterId: "ch2", moduleId: "mod2", open: true },
      ],
      liveSlides: async (chapterId) => (chapterId === "ch2" ? [{ id: "s2", title: "Two" }] : []),
    });
    const result = await verifyResume(
      [entry(), entry({ courseId: "c2", sessionId: "ps2", chapterId: "ch2", slideId: "s2" })],
      c,
    );
    expect(c.forget).toHaveBeenCalledWith("c1");
    expect(result?.slideId).toBe("s2");
  });

  it("drops a lesson whose chapter left the course", async () => {
    const c = checks({ liveChapters: async () => [] });
    expect(await verifyResume([entry()], c)).toBeNull();
    expect(c.forget).toHaveBeenCalledWith("c1");
  });

  it("drops a lesson opened moments ago whose chapter is not in the recorded batch", async () => {
    const c = checks({
      liveChapters: async () => [{ chapterId: "another-chapter", moduleId: "mod1", open: true }],
    });
    expect(await verifyResume([entry({ updatedAt: Date.now() })], c)).toBeNull();
    expect(c.forget).toHaveBeenCalledWith("c1");
  });

  it("drops a course the learner is no longer enrolled in", async () => {
    const c = checks({ enrolledCourses: enrolled({ id: "other", package_session_id: "p" }) });
    expect(await verifyResume([entry()], c)).toBeNull();
    expect(c.forget).toHaveBeenCalledWith("c1");
  });

  it("hides but keeps the entry when the enrolment list comes back empty", async () => {
    const c = checks({ enrolledCourses: enrolled() });
    expect(await verifyResume([entry()], c)).toBeNull();
    expect(c.forget).not.toHaveBeenCalled();
  });

  it("hides but keeps the entry when part of the enrolment lookup failed", async () => {
    const c = checks({
      enrolledCourses: async () => ({
        courses: [{ id: "other", package_session_id: "p" }],
        complete: false,
      }),
    });
    expect(await verifyResume([entry()], c)).toBeNull();
    expect(c.forget).not.toHaveBeenCalled();
  });

  it("still offers a lesson found in a partial enrolment list", async () => {
    const c = checks({
      enrolledCourses: async () => ({
        courses: [{ id: "c1", package_session_id: "ps1" }],
        complete: false,
      }),
    });
    expect((await verifyResume([entry()], c))?.slideId).toBe("s1");
  });

  it("does not offer a finished course, and keeps its entry", async () => {
    const c = checks({
      enrolledCourses: enrolled({ id: "c1", package_session_id: "ps1", percentage_completed: 100 }),
    });
    expect(await verifyResume([entry()], c)).toBeNull();
    expect(c.forget).not.toHaveBeenCalled();
  });

  it.each<[string, LiveSlide]>([
    ["a quiz", { id: "s1", source_type: "QUIZ" }],
    ["a hidden lesson", { id: "s1", is_hidden: true }],
    ["a locked lesson", { id: "s1", is_locked: true }],
  ])("skips %s without forgetting it", async (_name: string, slide: LiveSlide) => {
    const c = checks({ liveSlides: async () => [slide] });
    expect(await verifyResume([entry()], c)).toBeNull();
    expect(c.forget).not.toHaveBeenCalled();
  });

  it("skips a chapter closed to this learner without forgetting it", async () => {
    const c = checks({ liveChapters: async () => [{ chapterId: "ch1", moduleId: "mod1", open: false }] });
    expect(await verifyResume([entry()], c)).toBeNull();
    expect(c.forget).not.toHaveBeenCalled();
  });

  it("rejects without forgetting when a check fails", async () => {
    const c = checks({
      liveSlides: async () => {
        throw new Error("503");
      },
    });
    await expect(verifyResume([entry()], c)).rejects.toThrow("503");
    expect(c.forget).not.toHaveBeenCalled();
  });

  it("follows the learner to the batch and module the server has now", async () => {
    const c = checks({
      enrolledCourses: enrolled({ id: "c1", package_session_id: "ps-new" }),
      liveChapters: async () => [{ chapterId: "ch1", moduleId: "mod-new", open: true }],
    });
    const result = await verifyResume([entry()], c);
    expect(result?.sessionId).toBe("ps-new");
    expect(result?.moduleId).toBe("mod-new");
  });

  it("prefers the recorded batch when the learner holds several", async () => {
    const liveChapters = vi.fn(async () => [{ chapterId: "ch1", moduleId: "mod1", open: true }]);
    const c = checks({
      enrolledCourses: enrolled(
        { id: "c1", package_session_id: "ps0" },
        { id: "c1", package_session_id: "ps1" },
      ),
      liveChapters,
    });
    expect((await verifyResume([entry()], c))?.sessionId).toBe("ps1");
    expect(liveChapters).toHaveBeenCalledWith("sub1", "ps1");
  });

  it("names the course as the server has it now", async () => {
    const c = checks({
      enrolledCourses: enrolled({ id: "c1", package_session_id: "ps1", package_name: "Name now" }),
    });
    const result = await verifyResume([entry({ courseName: "Name when visited" })], c);
    expect(result?.courseName).toBe("Name now");
  });

  it("stops after a bounded number of candidates", async () => {
    const liveSlides = vi.fn(async () => []);
    const many = Array.from({ length: 6 }, (_, i) => entry({ slideId: `s${i}` }));
    await verifyResume(many, checks({ liveSlides }));
    expect(liveSlides).toHaveBeenCalledTimes(3);
  });
});

describe("the course percent on a verified resume", () => {
  const withPercent = (percentage_completed: EnrolledCourseRow["percentage_completed"]) =>
    checks({ enrolledCourses: enrolled({ id: "c1", package_session_id: "ps1", percentage_completed }) });

  it("comes from the enrolment row, not the chapter", async () => {
    expect((await verifyResume([entry()], withPercent(40)))?.coursePercent).toBe(40);
  });
  it("is clamped, and null where the row cannot be read", async () => {
    expect((await verifyResume([entry()], withPercent(null)))?.coursePercent).toBeNull();
    expect((await verifyResume([entry()], withPercent("null")))?.coursePercent).toBeNull();
    expect((await verifyResume([entry()], withPercent("-3")))?.coursePercent).toBe(0);
  });
  it("reads a row of the batch being resumed when there are two", async () => {
    const c = checks({
      enrolledCourses: enrolled(
        { id: "c1", package_session_id: "ps9", percentage_completed: 90 },
        { id: "c1", package_session_id: "ps1", percentage_completed: 15 },
      ),
    });
    expect((await verifyResume([entry()], c))?.coursePercent).toBe(15);
  });
  it("never draws a finished batch while another batch of the course is unfinished", async () => {
    const c = checks({
      enrolledCourses: enrolled(
        { id: "c1", package_session_id: "ps1", percentage_completed: 100 },
        { id: "c1", package_session_id: "ps2", percentage_completed: 20 },
        { id: "c1", package_session_id: "ps3", percentage_completed: "null" },
      ),
    });
    const result = await verifyResume([entry()], c);
    expect(result?.coursePercent).toBe(20);
    // The lesson still opens in the batch it was recorded in.
    expect(result?.sessionId).toBe("ps1");
  });
  it("claims nothing when the unfinished batch's percent cannot be read", async () => {
    const c = checks({
      enrolledCourses: enrolled(
        { id: "c1", package_session_id: "ps1", percentage_completed: 100 },
        { id: "c1", package_session_id: "ps2", percentage_completed: "null" },
      ),
    });
    expect((await verifyResume([entry()], c))?.coursePercent).toBeNull();
  });
  it("still treats a finished row as finished, however it is held", async () => {
    expect(await verifyResume([entry()], withPercent(119000))).toBeNull();
    expect(await verifyResume([entry()], withPercent("100"))).toBeNull();
  });
});

describe("liveChaptersFrom", () => {
  it("reads chapter fields on the row", () => {
    const rows = [{ module: { id: "m" }, chapters: [{ id: "a" }, { id: "b", is_hidden: true }] }];
    expect(liveChaptersFrom(rows)).toMatchObject([
      { chapterId: "a", moduleId: "m", open: true },
      { chapterId: "b", moduleId: "m", open: false },
    ]);
  });
  it("reads chapter fields under `chapter`", () => {
    const rows = [{ module: { id: "m" }, chapters: [{ chapter: { id: "a", is_locked: true } }] }];
    expect(liveChaptersFrom(rows)).toMatchObject([{ chapterId: "a", moduleId: "m", open: false }]);
  });
  it("carries each chapter's progress, its module's and its own drip condition", () => {
    const rows = [
      {
        module: { id: "m" },
        percentage_completed: 30,
        chapters: [{ id: "a", percentage_completed: 10, drip_condition: "{}" }],
      },
    ];
    expect(liveChaptersFrom(rows)).toEqual([
      { chapterId: "a", moduleId: "m", open: true, percentage: 10, modulePercentage: 30, dripCondition: "{}" },
    ]);
  });
  it("treats a module with no chapters as nothing live", () => {
    expect(liveChaptersFrom([{ module: { id: "m" }, chapters: null }])).toEqual([]);
    expect(liveChaptersFrom([])).toEqual([]);
  });
  it.each([
    ["an object", { data: [] }],
    ["a row with no chapter id", [{ module: { id: "m" }, chapters: [{ name: "x" }] }]],
    ["a row with no module id", [{ chapters: [{ id: "a" }] }]],
  ])("refuses %s", (_name: string, value: unknown) => {
    expect(() => liveChaptersFrom(value)).toThrow();
  });
});

describe("serverLessons", () => {
  const row = (slide_id: string, source_type = "VIDEO") => ({ slide_id, source_type }) as DashboardSlide;
  it("passes over quizzes", () => {
    expect(serverLessons([row("q", "QUIZ"), row("v"), row("q2", "quiz")]).map((s) => s.slide_id)).toEqual(["v"]);
  });
  it("is empty on a first run", () => {
    expect(serverLessons([])).toEqual([]);
    expect(serverLessons(undefined)).toEqual([]);
  });
});

describe("verifyServerLessons", () => {
  const lesson = (over: Partial<DashboardSlide> = {}) =>
    ({
      slide_id: "s1",
      slide_title: "Title in the list",
      source_type: "VIDEO",
      package_id: "c1",
      package_session_id: "ps1",
      level_id: "l1",
      subject_id: "sub1",
      module_id: "mod-listed",
      chapter_id: "ch1",
      ...over,
    }) as DashboardSlide;
  const course = { id: "c1", package_session_id: "ps1", package_name: "Course one", percentage_completed: 20 };
  const serverChecks = (over: Partial<DeviceResumeChecks> = {}) =>
    checks({ enrolledCourses: enrolled(course), ...over });

  it("asks the server nothing when there are no rows", async () => {
    const enrolledCourses = vi.fn(enrolled(course));
    expect(await verifyServerLessons([], serverChecks({ enrolledCourses }))).toBeNull();
    expect(enrolledCourses).not.toHaveBeenCalled();
  });

  it("offers a row whose course, batch, chapter and lesson all hold, as the server has them now", async () => {
    const result = await verifyServerLessons([lesson()], serverChecks());
    expect(result?.slide.slide_id).toBe("s1");
    expect(result?.slide.slide_title).toBe("Title now");
    expect(result?.slide.module_id).toBe("mod1");
    expect(result?.courseName).toBe("Course one");
    expect(result?.coursePercent).toBe(20);
  });

  it("passes over a course the learner does not hold in this institute", async () => {
    const liveSlides = vi.fn(async () => []);
    const c = serverChecks({ enrolledCourses: enrolled({ id: "c2", package_session_id: "ps2" }), liveSlides });
    expect(await verifyServerLessons([lesson()], c)).toBeNull();
    expect(liveSlides).not.toHaveBeenCalled();
  });

  it("passes over a batch the learner does not hold, even in a course they do", async () => {
    const c = serverChecks();
    expect(await verifyServerLessons([lesson({ package_session_id: "ps-other" })], c)).toBeNull();
    expect(await verifyServerLessons([lesson({ package_session_id: undefined })], c)).toBeNull();
  });

  it("passes over a row whose chapter is not in the batch it names, and takes the next", async () => {
    const liveChapters = vi.fn(async (_subject: string, batch: string) =>
      batch === "ps2" ? [{ chapterId: "ch2", moduleId: "mod2", open: true }] : [],
    );
    const c = serverChecks({
      enrolledCourses: enrolled(course, { id: "c2", package_session_id: "ps2", package_name: "Course two" }),
      liveChapters,
      liveSlides: async () => [
        { id: "s1", title: "One" },
        { id: "s2", title: "Two" },
      ],
    });
    const result = await verifyServerLessons(
      [lesson(), lesson({ slide_id: "s2", package_id: "c2", package_session_id: "ps2", chapter_id: "ch2" })],
      c,
    );
    expect(result?.slide.slide_id).toBe("s2");
    expect(result?.courseName).toBe("Course two");
  });

  it.each<[string, Partial<DeviceResumeChecks>]>([
    ["a finished course", { enrolledCourses: enrolled({ ...course, percentage_completed: 100 }) }],
    ["a missing lesson", { liveSlides: async () => [] }],
    ["a hidden lesson", { liveSlides: async () => [{ id: "s1", is_hidden: true }] }],
    ["a closed chapter", { liveChapters: async () => [{ chapterId: "ch1", moduleId: "mod1", open: false }] }],
  ])("passes over %s", async (_name: string, over: Partial<DeviceResumeChecks>) => {
    expect(await verifyServerLessons([lesson()], serverChecks(over))).toBeNull();
  });

  it("rejects when a check fails, and forgets nothing", async () => {
    const c = serverChecks({
      liveChapters: async () => {
        throw new Error("503");
      },
    });
    await expect(verifyServerLessons([lesson()], c)).rejects.toThrow("503");
    expect(c.forget).not.toHaveBeenCalled();
  });

  it("forgets nothing when a row fails", async () => {
    const c = serverChecks({ liveChapters: async () => [] });
    expect(await verifyServerLessons([lesson()], c)).toBeNull();
    expect(c.forget).not.toHaveBeenCalled();
  });

  it("stops after a bounded number of lookups", async () => {
    const liveSlides = vi.fn(async () => []);
    const rows = Array.from({ length: 5 }, (_, i) => lesson({ slide_id: `s${i}` }));
    await verifyServerLessons(rows, serverChecks({ liveSlides }));
    expect(liveSlides).toHaveBeenCalledTimes(3);
  });
});

describe("isTestLikeSlide", () => {
  it.each(["QUIZ", "quiz", "ASSESSMENT", "assessment", "QUESTION"])("treats %s as test-like", (type) => {
    expect(isTestLikeSlide(type)).toBe(true);
  });
  it.each(["VIDEO", "DOCUMENT", "ASSIGNMENT", "PDF", "", undefined, null])("treats %s as a lesson", (type) => {
    expect(isTestLikeSlide(type)).toBe(false);
  });
});

describe("test-like lessons on the first screen", () => {
  const row = (source_type: string) =>
    ({
      slide_id: `s-${source_type}`,
      source_type,
      package_id: "c1",
      package_session_id: "ps1",
      subject_id: "sub1",
      module_id: "mod1",
      chapter_id: "ch1",
    }) as DashboardSlide;

  it.each(["QUIZ", "ASSESSMENT", "QUESTION"])("leaves a %s row off the server list", (type) => {
    expect(serverLessons([row(type), row("VIDEO")]).map((s) => s.source_type)).toEqual(["VIDEO"]);
  });

  it.each(["QUIZ", "ASSESSMENT", "QUESTION"])("does not offer a device entry on a %s, and keeps it", async (type) => {
    const c = checks({ liveSlides: async () => [{ id: "s1", title: "T", source_type: type }] });
    expect(await verifyResume([entry()], c)).toBeNull();
    expect(c.forget).not.toHaveBeenCalled();
  });

  it("passes a row whose live lesson has become test-like, whatever the list says", async () => {
    const c = checks({ liveSlides: async () => [{ id: "s-VIDEO", title: "T", source_type: "ASSESSMENT" }] });
    expect(await verifyServerLessons([row("VIDEO")], c)).toBeNull();
  });
});

describe("drip on an offered lesson", () => {
  const FUTURE = { type: "date_based", params: { unlock_date: "2099-01-01T00:00:00.000Z" } };
  const PAST = { type: "date_based", params: { unlock_date: "2020-01-01T00:00:00.000Z" } };
  const cond = (rule: unknown, behavior = "lock") => ({ behavior, rules: [rule] }) as never;
  const lesson = { subjectId: "sub1", chapterId: "ch1", slideId: "s2" };
  const chapters: LiveChapter[] = [
    { chapterId: "ch0", moduleId: "mod0", open: true, percentage: 100, modulePercentage: 100 },
    { chapterId: "ch1", moduleId: "mod1", open: true, percentage: 10, modulePercentage: 10 },
  ];
  const slides: LiveSlide[] = [
    { id: "s1", percentage_completed: 40 },
    { id: "s2", percentage_completed: 0 },
  ];
  const on = (level: string, id: string, condition: unknown): ResumeDripRules => ({
    ...noDrip,
    conditionFor: (l, i) => (l === level && i === id ? (condition as never) : null),
  });
  const closed = (rules: ResumeDripRules, list = slides) =>
    lessonClosedByDrip(lesson, chapters, list, rules);

  it("leaves a lesson open with no rules", () => {
    expect(closed(noDrip)).toBe(false);
  });

  it.each([
    ["slide", "s2"],
    ["chapter", "ch1"],
    ["module", "mod1"],
    ["subject", "sub1"],
  ])("closes a lesson under a configured %s date rule", (level, id) => {
    expect(closed(on(level, id, cond(FUTURE)))).toBe(true);
  });

  it("closes a lesson hidden by a configured rule", () => {
    expect(closed(on("slide", "s2", cond(FUTURE, "hide")))).toBe(true);
  });

  it("ignores rules on other items and rules already passed", () => {
    expect(closed(on("slide", "s1", cond(FUTURE)))).toBe(false);
    expect(closed(on("chapter", "ch0", cond(FUTURE)))).toBe(false);
    expect(closed(on("slide", "s2", cond(PAST)))).toBe(false);
  });

  it("reads a progress rule against the lesson before it, as the lesson page does", () => {
    const sequential = cond({ type: "sequential", params: { requires_previous: true, threshold: 100 } });
    expect(closed(on("slide", "s2", sequential))).toBe(true);
    expect(closed(on("slide", "s1", sequential))).toBe(false);
    const done = [{ id: "s1", percentage_completed: 100 }, slides[1]!];
    expect(closed(on("slide", "s2", sequential), done)).toBe(false);
  });

  it("honours a rule on the row only while the row-level switch is on", () => {
    const stamped = [slides[0]!, { ...slides[1]!, drip_condition_json: JSON.stringify(cond(FUTURE)) }];
    expect(closed(noDrip, stamped)).toBe(false);
    expect(closed({ ...noDrip, rowLevelEnabled: true }, stamped)).toBe(true);
  });

  it("honours a course-wide condition under the row-level switch", () => {
    const rules = { ...noDrip, rowLevelEnabled: true, courseCondition: () => cond(FUTURE) };
    expect(closed(rules)).toBe(true);
  });

  it("counts a day-wise rule from the anchor it is given, and opens with none", () => {
    const dayFive = cond({ type: "relative_date", params: { unlock_on_day: 5 } });
    const today = new Date().toISOString();
    expect(closed({ ...on("slide", "s2", dayFive), enrollmentDate: today })).toBe(true);
    expect(closed(on("slide", "s2", dayFive))).toBe(false);
  });

  const closedChecks = (rules: ResumeDripRules) =>
    checks({
      liveChapters: async () => [{ chapterId: "ch1", moduleId: "mod1", open: true }],
      liveSlides: async () => [{ id: "s1", title: "T", source_type: "VIDEO" }],
      dripRules: async () => rules,
    });

  it("does not offer a device entry drip has closed, and keeps it", async () => {
    const c = closedChecks(on("slide", "s1", cond(FUTURE)));
    expect(await verifyResume([entry()], c)).toBeNull();
    expect(c.forget).not.toHaveBeenCalled();
  });

  it("moves on to the next device entry past one drip has closed", async () => {
    const c = checks({
      enrolledCourses: enrolled(
        { id: "c1", package_session_id: "ps1" },
        { id: "c2", package_session_id: "ps2" },
      ),
      liveChapters: async (subject) => [
        { chapterId: subject === "sub2" ? "ch2" : "ch1", moduleId: "m", open: true },
      ],
      liveSlides: async (chapter) => [{ id: chapter === "ch2" ? "s9" : "s1", title: "T" }],
      dripRules: async () => on("slide", "s1", cond(FUTURE)),
    });
    const found = await verifyResume(
      [entry(), entry({ courseId: "c2", subjectId: "sub2", chapterId: "ch2", slideId: "s9", sessionId: "ps2" })],
      c,
    );
    expect(found?.slideId).toBe("s9");
  });

  it("does not offer a server row drip has closed", async () => {
    const c = closedChecks(on("slide", "s1", cond(FUTURE)));
    const row = {
      slide_id: "s1",
      package_id: "c1",
      package_session_id: "ps1",
      subject_id: "sub1",
      module_id: "mod1",
      chapter_id: "ch1",
    } as DashboardSlide;
    expect(await verifyServerLessons([row], c)).toBeNull();
  });

  it("asks for the rules for the course and batch being checked", async () => {
    const dripRules = vi.fn(async () => noDrip);
    await verifyResume([entry()], checks({ dripRules }));
    expect(dripRules).toHaveBeenCalledWith("c1", "ps1");
  });
});

describe("countLessons", () => {
  const chapters = (n: number): LiveChapter[] =>
    Array.from({ length: n }, (_, i) => ({ chapterId: `ch${i}`, moduleId: "m", open: true }));
  const slide = (id: string, pct: unknown, over: Partial<LiveSlide> = {}) =>
    ({ id, percentage_completed: pct, ...over }) as LiveSlide;
  const count = (slides: LiveSlide[], rules: ResumeDripRules | null = noDrip, nChapters = 1) =>
    countLessons("ch0", chapters(nChapters), slides, rules, 80);

  it("counts by each lesson's state, so a gap changes nothing", () => {
    const inOrder = [slide("a", 100), slide("b", 100), slide("c", 0), slide("d", 0)];
    const gaps = [slide("a", 0), slide("b", 100), slide("c", 0), slide("d", 100)];
    expect(count(inOrder)).toEqual(count(gaps));
    expect(count(gaps)).toMatchObject({ done: 2, total: 4 });
  });

  it("uses the institute's finished line, not 100", () => {
    expect(count([slide("a", 80), slide("b", 79)])).toMatchObject({ done: 1, total: 2 });
  });

  it("reads dirty old values as not finished, and huge ones as finished", () => {
    const dirty = [slide("a", "null"), slide("b", null), slide("c", undefined), slide("d", 119000)];
    expect(count(dirty)).toMatchObject({ done: 1, total: 4 });
  });

  it("leaves hidden lessons out and keeps locked ones in", () => {
    const list = [slide("a", 100, { is_hidden: true }), slide("b", 0, { is_locked: true }), slide("c", 0)];
    expect(count(list)).toMatchObject({ done: 0, total: 2 });
  });

  it("leaves out a lesson drip hides, and counts one drip only locks", () => {
    const rule = (behavior: string) =>
      ({
        target: "slide",
        behavior,
        is_enabled: true,
        rules: [{ type: "date_based", params: { unlock_date: "2999-01-01T00:00:00Z" } }],
      }) as never;
    const withRule = (behavior: string): ResumeDripRules => ({
      ...noDrip,
      conditionFor: (_level, id) => (id === "b" ? rule(behavior) : null),
    });
    expect(count([slide("a", 0), slide("b", 0)], withRule("hide"))).toMatchObject({ total: 1 });
    expect(count([slide("a", 0), slide("b", 0)], withRule("lock"))).toMatchObject({ total: 2 });
  });

  it("handles an empty chapter and a very long one", () => {
    expect(count([])).toMatchObject({ done: 0, total: 0 });
    const long = Array.from({ length: 951 }, (_, i) => slide(`s${i}`, i < 10 ? 100 : 0));
    expect(count(long)).toMatchObject({ done: 10, total: 951 });
  });

  it("says when the chapter is only part of the course", () => {
    expect(count([slide("a", 0)], noDrip, 1).partOfCourse).toBe(false);
    expect(count([slide("a", 0)], noDrip, 2).partOfCourse).toBe(true);
  });
});

describe("the count reaches the answer", () => {
  it("comes back on a verified device entry", async () => {
    const c = checks({ completionThreshold: () => 80 });
    expect((await verifyResume([entry()], c))?.count?.total).toBeGreaterThan(0);
  });
  it("cannot cost the resume answer when it fails", async () => {
    const c = checks({
      completionThreshold: () => {
        throw new Error("settings unreadable");
      },
    });
    const result = await verifyResume([entry()], c);
    expect(result?.slideId).toBe("s1");
    expect(result?.count).toBeUndefined();
  });
  it("is absent without a threshold, and the answer stays the same", async () => {
    const result = await verifyResume([entry()], checks());
    expect(result?.slideId).toBe("s1");
    expect(result?.count).toBeUndefined();
  });
});
