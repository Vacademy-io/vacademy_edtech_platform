import { describe, expect, it } from "vitest";
import type { EnrolledCourse } from "@/services/enrolled-courses";
import {
  foldCount,
  goalCardKind,
  funHeroKind,
  headerFirstName,
  initialsOf,
  nearlyDone,
  orderTodayCards,
  startCourseOf,
  tilesModeOf,
  heroOffersStartOf,
  heroBarPercent,
  sharedCourseNames,
  tileNotStarted,
  tileSublines,
  visibleTiles,
  withTileBatchNames,
  type FunHeroInput,
} from "./home-state";
import { courseIdOfResume } from "./resume-course";

const course = (id: string, percent: number, name = id): EnrolledCourse => ({
  id,
  packageSessionId: `ps-${id}`,
  name,
  levelName: "",
  previewImageId: "",
  percentComplete: percent,
  readTimeInMinutes: 60,
  state: percent >= 100 ? "COMPLETED" : percent > 0 ? "IN_PROGRESS" : "NOT_STARTED",
});

const base: FunHeroInput = {
  hasResume: false,
  resumeResolving: false,
  firstRunKnown: true,
  hasAnyProgress: true,
  dashboardLoading: false,
  dashboardAnswered: true,
  lessonsListed: true,
  standing: "unknown",
  courses: [course("a", 40), course("b", 0)],
  coursesPending: false,
  hideProgress: false,
};
const kind = (over: Partial<FunHeroInput>) => funHeroKind({ ...base, ...over });

describe("funHeroKind", () => {
  it("offers the checked lesson first, whatever else is still out", () => {
    expect(kind({ hasResume: true, resumeResolving: true, dashboardLoading: true, dashboardAnswered: false })).toBe("resume");
  });
  it("holds a skeleton while the resume answer or the first-run question is out", () => {
    expect(kind({ resumeResolving: true })).toBe("skeleton");
    expect(kind({ firstRunKnown: false })).toBe("skeleton");
    expect(kind({ dashboardLoading: true })).toBe("skeleton");
  });
  it("shows the error card when the dashboard failed, not the empty state", () => {
    expect(kind({ dashboardAnswered: false, standing: "noCourses", courses: [] })).toBe("error");
  });
  it("says there is no course when the standing or the list says so", () => {
    expect(kind({ standing: "noCourses", courses: null })).toBe("noCourses");
    expect(kind({ hasAnyProgress: false, courses: [] })).toBe("noCourses");
  });
  it("celebrates only when every course is finished and nothing is listed", () => {
    expect(kind({ standing: "finished", lessonsListed: false })).toBe("done");
    // A lesson still listed: nearly there, never finished.
    expect(kind({ standing: "finished", lessonsListed: true })).toBe("courses");
    // An institute that hides progress gets no finish in words either.
    expect(kind({ standing: "finished", lessonsListed: false, hideProgress: true })).toBe("caughtUp");
  });
  it("is caught up with progress and nothing in progress", () => {
    expect(kind({ lessonsListed: false })).toBe("caughtUp");
  });
  it("points to the courses when progress exists but no lesson could be offered", () => {
    expect(kind({ lessonsListed: true })).toBe("courses");
  });
  it("offers a new learner the first course not started", () => {
    expect(kind({ hasAnyProgress: false, lessonsListed: false })).toBe("start");
  });
  it("waits for the list a new learner's card needs, but not forever", () => {
    expect(kind({ hasAnyProgress: false, courses: null, coursesPending: true })).toBe("skeleton");
    expect(kind({ hasAnyProgress: false, courses: null, coursesPending: false })).toBe("courses");
  });
});

describe("startCourseOf", () => {
  it("takes the first not-started course in the list's own order", () => {
    expect(startCourseOf([course("a", 40), course("m", 0, "Maths"), course("c", 0, "Chemistry")])?.id).toBe("m");
    expect(startCourseOf([course("a", 100)])).toBeNull();
    expect(startCourseOf(null)).toBeNull();
  });
});

describe("tilesModeOf", () => {
  it("looks back when every course is finished", () => {
    expect(tilesModeOf([course("a", 100), course("b", 100)])).toBe("lookBack");
  });
  it("lists the others when the hero offers a course to start", () => {
    expect(tilesModeOf([course("a", 0), course("b", 0)], false, false, true)).toBe("others");
    // A single course is the hero itself, so the tiles leave it out (no section).
    expect(tilesModeOf([course("a", 0)], false, false, true)).toBe("others");
  });
  it("lists every course when the learner has started, even with every course at 0%", () => {
    // Hero on Continue or "All caught up": each course shows once, none is dropped.
    expect(tilesModeOf([course("a", 0), course("b", 0), course("c", 0)], true)).toBe("all");
    expect(tilesModeOf([course("a", 0), course("b", 0), course("c", 0)])).toBe("all");
  });
  it("lists every course otherwise", () => {
    expect(tilesModeOf([course("a", 40), course("b", 0), course("c", 100)])).toBe("all");
  });
  it("does not look back while a lesson is still listed in progress (nearly there)", () => {
    expect(tilesModeOf([course("a", 100), course("b", 100)], true)).toBe("all");
  });
  it("does not look back when the institute hides progress", () => {
    expect(tilesModeOf([course("a", 100), course("b", 100)], false, true)).toBe("all");
    expect(tilesModeOf([course("a", 0), course("b", 0)], false, true, true)).toBe("others");
  });
});

describe("tileNotStarted", () => {
  it("is a course at 0% that nothing says was opened", () => {
    expect(tileNotStarted(course("a", 0), new Set(), false)).toBe(true);
  });
  it("is false once a lesson of it is listed in progress or it was resumed here", () => {
    expect(tileNotStarted(course("a", 0), new Set(["a"]), false)).toBe(false);
    expect(tileNotStarted(course("a", 0), new Set(), true)).toBe(false);
    expect(tileNotStarted(course("a", 40), new Set(), false)).toBe(false);
  });
});

describe("heroOffersStartOf", () => {
  it("is the start card, or its skeleton before anything says the learner began", () => {
    expect(heroOffersStartOf("start", { hasResume: false, hasAnyProgress: false })).toBe(true);
    expect(heroOffersStartOf("skeleton", { hasResume: false, hasAnyProgress: false })).toBe(true);
  });
  it("is false once there is a resume or any progress", () => {
    expect(heroOffersStartOf("resume", { hasResume: true, hasAnyProgress: false })).toBe(false);
    expect(heroOffersStartOf("skeleton", { hasResume: false, hasAnyProgress: true })).toBe(false);
    expect(heroOffersStartOf("caughtUp", { hasResume: false, hasAnyProgress: true })).toBe(false);
    expect(heroOffersStartOf("courses", { hasResume: false, hasAnyProgress: true })).toBe(false);
    expect(heroOffersStartOf("noCourses", { hasResume: false, hasAnyProgress: false })).toBe(false);
  });
});

describe("nearlyDone", () => {
  it("is a finished course that still has a listed lesson", () => {
    const listed = new Set(["a"]);
    expect(nearlyDone(course("a", 100), listed)).toBe(true);
    expect(nearlyDone(course("b", 100), listed)).toBe(false);
    expect(nearlyDone(course("a", 60), listed)).toBe(false);
  });
});

describe("visibleTiles", () => {
  it("shows four and the rest behind See all, unless the institute shows all", () => {
    const list = [1, 2, 3, 4, 5, 6];
    expect(visibleTiles(list, false)).toEqual([1, 2, 3, 4]);
    expect(visibleTiles(list, true)).toEqual(list);
  });
});

describe("header names", () => {
  it("drops a name that reads as a phone, an email or a code, or runs long", () => {
    expect(headerFirstName("tara")).toBe("Tara");
    expect(headerFirstName("9876543210")).toBe("");
    expect(headerFirstName("tara.sample@example.invalid")).toBe("");
    expect(headerFirstName("Venkatanarasimharajuvaripeta")).toBe("");
    expect(headerFirstName("प्रिया")).toBe("प्रिया");
  });
  it("takes initials from the first and last word", () => {
    expect(initialsOf("Tara Sample")).toBe("TS");
    expect(initialsOf("tara")).toBe("T");
    expect(initialsOf("Tara Devi Sample")).toBe("TS");
    expect(initialsOf("  ")).toBe("");
  });
});

describe("goalCardKind", () => {
  const base = { planRunning: true, showGoal: true, hideProgress: false, showRing: true };
  it("shows the ring while a plan runs", () => {
    expect(goalCardKind(base)).toBe("ring");
  });
  it("names the next task instead where progress is hidden", () => {
    expect(goalCardKind({ ...base, hideProgress: true })).toBe("next");
  });
  it("keeps a way into the tasks with gamification off, without the ring", () => {
    expect(goalCardKind({ ...base, showRing: false })).toBe("next");
  });
  it("shows nothing without a plan, with the widget off, or while hide-progress is read", () => {
    expect(goalCardKind({ ...base, planRunning: false })).toBeNull();
    expect(goalCardKind({ ...base, showGoal: false })).toBeNull();
    expect(goalCardKind({ ...base, hideProgress: null })).toBeNull();
  });
});

describe("foldCount", () => {
  it("leaves the hero's lesson out when the list has it", () => {
    expect(foldCount(["a", "b", "c"], "b")).toBe(2);
  });
  it("counts every listed lesson when the hero's lesson is not listed", () => {
    expect(foldCount(["a", "b"], "device-only")).toBe(2);
  });
  it("counts every listed lesson when the hero offers none", () => {
    expect(foldCount(["a"], null)).toBe(1);
  });
  it("is zero when the hero's lesson is the only one listed", () => {
    expect(foldCount(["a"], "a")).toBe(0);
  });
});

describe("orderTodayCards", () => {
  it("keeps the boards' order on the default settings (class before tests)", () => {
    // evaluationStat (main column) is saved before upcomingLiveClasses (rail).
    expect(orderTodayCards([{ id: "tests", order: 4 }, { id: "class", order: 10 }, { id: "goal", order: 0.5 }])).toEqual(["goal", "class", "tests"]);
    expect(orderTodayCards([{ id: "tests", order: 4 }, { id: "class", order: 10 }])).toEqual(["class", "tests"]);
    expect(orderTodayCards([{ id: "tests", order: 0 }, { id: "class", order: 0 }, { id: "goal", order: 0 }])).toEqual(["goal", "class", "tests"]);
  });
  it("moves the goal card behind the cards an institute saved before it", () => {
    expect(orderTodayCards([{ id: "tests", order: 1 }, { id: "goal", order: 5 }, { id: "class", order: 3 }])).toEqual(["class", "tests", "goal"]);
    expect(orderTodayCards([{ id: "tests", order: 9 }, { id: "goal", order: 5 }, { id: "class", order: 3 }])).toEqual(["class", "goal", "tests"]);
    expect(orderTodayCards([{ id: "goal", order: 2 }])).toEqual(["goal"]);
  });
});

describe("courseIdOfResume", () => {
  const entry = { instituteId: "i", courseId: "pkg-a", subjectId: "s", moduleId: "m", chapterId: "c", slideId: "sl-1", sessionId: "ps", slideTitle: "t", updatedAt: 1 };
  const slide = { slide_id: "sl-2", package_id: "pkg-b" } as never;
  it("finds the course through this device's entry, then the listed lessons", () => {
    expect(courseIdOfResume("sl-1", [entry], [slide])).toBe("pkg-a");
    expect(courseIdOfResume("sl-2", [entry], [slide])).toBe("pkg-b");
    expect(courseIdOfResume("sl-3", [entry], [slide])).toBeUndefined();
    expect(courseIdOfResume(undefined, [entry], [slide])).toBeUndefined();
  });
});

describe("sharedCourseNames / tileSublines", () => {
  const batch = (ps: string, levelName: string, sessionName: string, name = "Ai/ML"): EnrolledCourse => ({
    ...course("pkg-aiml", 0, name),
    packageSessionId: ps,
    levelName,
    sessionName,
  });
  const line = (list: EnrolledCourse[], i: number) => tileSublines(list).get(list[i]!);
  it("finds names two courses share, ignoring case and spaces", () => {
    const shared = sharedCourseNames([batch("a", "", ""), batch("b", "", "", " ai/ml "), course("c", 10, "Chemistry")]);
    expect([...shared]).toEqual(["ai/ml"]);
  });
  it("adds level and session to a shared name, whatever the progress setting", () => {
    const list = [batch("a", "Beginner", "2025-26"), batch("b", "Advanced", "2026-27")];
    expect(line(list, 0)).toEqual({ text: "Beginner · 2025-26", disambiguates: true });
    expect(line(list, 1)).toEqual({ text: "Advanced · 2026-27", disambiguates: true });
  });
  it("puts the session first when the level is the same, so a cut line still differs", () => {
    const list = [batch("a", "Class 12 Science", "2025-26"), batch("b", "Class 12 Science", "2026-27"), course("c", 10, "Chemistry")];
    expect(line(list, 0)).toEqual({ text: "2025-26 · Class 12 Science", disambiguates: true });
    expect(line(list, 1)).toEqual({ text: "2026-27 · Class 12 Science", disambiguates: true });
  });
  it("falls back to the session when the level is a placeholder", () => {
    const list = [batch("a", "", "Morning batch"), batch("b", "", "Evening batch")];
    expect(line(list, 0)?.text).toBe("Morning batch");
  });
  it("says nothing extra for a unique name, and only the level there", () => {
    const one = { ...course("c", 10, "Chemistry"), levelName: "Class 12", sessionName: "2026" };
    expect(line([one], 0)).toEqual({ text: "Class 12", disambiguates: false });
  });
  it("cannot tell two batches apart with no level, session or batch name", () => {
    const list = [batch("a", "", ""), batch("b", "", "")];
    expect(line(list, 0)).toEqual({ text: "", disambiguates: false });
  });
  it("adds the batch name when level and session read the same", () => {
    const list = [
      { ...batch("a", "Class 12", "2026-27"), batchName: "Weekend" },
      { ...batch("b", "Class 12", "2026-27"), batchName: "Evening" },
    ];
    expect(tileSublines(list).get(list[0]!)?.text).toBe("Weekend · Class 12");
    expect(tileSublines(list).get(list[1]!)?.text).toBe("Evening · Class 12");
    const noLevel = [
      { ...batch("a", "", "2026-27"), batchName: "Weekend" },
      { ...batch("b", "", "2026-27"), batchName: "Evening" },
    ];
    expect(tileSublines(noLevel).get(noLevel[0]!)?.text).toBe("Weekend");
  });
});

describe("withTileBatchNames", () => {
  const names = new Map([["ps-a", { level: "Class 12", session: "2025-26", batch: "" }]]);
  it("fills the session the enrolment list does not send, from the batch's names", () => {
    const real = { ...course("pkg-aiml", 47, "Ai/ML"), packageSessionId: "ps-a", levelName: "", sessionName: "" };
    expect(withTileBatchNames(real, names)).toMatchObject({ levelName: "Class 12", sessionName: "2025-26", batchName: "" });
  });
  it("keeps what the course has, and the same object when its batch is unknown", () => {
    const own = { ...course("pkg-aiml", 47, "Ai/ML"), packageSessionId: "ps-a", levelName: "Beginner", sessionName: "Term 1" };
    expect(withTileBatchNames(own, names)).toMatchObject({ levelName: "Beginner", sessionName: "Term 1" });
    const other = { ...own, packageSessionId: "ps-z" };
    expect(withTileBatchNames(other, names)).toBe(other);
  });
});

describe("heroBarPercent", () => {
  it("never draws a 0% bar", () => {
    expect(heroBarPercent(0, false)).toBeNull();
    expect(heroBarPercent(0.4, false)).toBeNull();
    expect(heroBarPercent(null, false)).toBeNull();
    expect(heroBarPercent(undefined, false)).toBeNull();
  });
  it("rounds a real percent and caps it", () => {
    expect(heroBarPercent(0.6, false)).toBe(1);
    expect(heroBarPercent(47.4, false)).toBe(47);
    expect(heroBarPercent(120, false)).toBe(100);
  });
  it("draws nothing while progress is hidden or still being read", () => {
    expect(heroBarPercent(50, true)).toBeNull();
    expect(heroBarPercent(50, null)).toBeNull();
  });
});
