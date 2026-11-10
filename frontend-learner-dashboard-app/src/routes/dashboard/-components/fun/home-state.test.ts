import { describe, expect, it } from "vitest";
import type { EnrolledCourse } from "@/services/enrolled-courses";
import {
  funHeroKind,
  headerFirstName,
  initialsOf,
  orderTodayCards,
  startCourseOf,
  tilesModeOf,
  visibleTiles,
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
  it("lists the others when none has started", () => {
    expect(tilesModeOf([course("a", 0), course("b", 0)])).toBe("others");
    expect(tilesModeOf([course("a", 0)])).toBe("all");
  });
  it("lists every course otherwise", () => {
    expect(tilesModeOf([course("a", 40), course("b", 0), course("c", 100)])).toBe("all");
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

describe("orderTodayCards", () => {
  it("follows the saved widget order, ties in the board's order", () => {
    expect(orderTodayCards([{ id: "tests", order: 1 }, { id: "goal", order: 5 }, { id: "class", order: 3 }])).toEqual(["tests", "class", "goal"]);
    expect(orderTodayCards([{ id: "tests", order: 0 }, { id: "class", order: 0 }, { id: "goal", order: 0 }])).toEqual(["goal", "class", "tests"]);
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
