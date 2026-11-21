import { describe, expect, it } from "vitest";
import {
  countWorthShowing,
  coursePercentOf,
  everythingFinished,
  furthestUnfinishedPercent,
  NEARLY_DONE_PERCENT,
  shownCoursePercent,
  standingOf,
} from "./course-progress";

describe("standingOf", () => {
  it("knows nothing until the lists have answered", () => {
    expect(standingOf(null)).toBe("unknown");
    expect(standingOf(undefined)).toBe("unknown");
  });
  it("tells no courses from courses with no lessons", () => {
    expect(standingOf([])).toBe("noCourses");
    expect(standingOf([{ percentage_completed: 0, read_time_in_minutes: 0 }])).toBe("noLessons");
  });
  it("reads a course with reading time as something to study", () => {
    expect(standingOf([{ percentage_completed: 0, read_time_in_minutes: 120 }])).toBe("unknown");
  });
  it("does not read a missing reading time as none", () => {
    expect(standingOf([{ percentage_completed: 0 }])).toBe("unknown");
  });
  it("needs every course at 100 to call it finished", () => {
    expect(standingOf([{ percentage_completed: 100 }])).toBe("finished");
    expect(standingOf([{ percentage_completed: "100" }])).toBe("finished");
    expect(standingOf([{ percentage_completed: 100 }, { percentage_completed: 40 }])).toBe("unknown");
  });
});

describe("coursePercentOf", () => {
  it("reads a number, and a number held as text", () => {
    expect(coursePercentOf(40)).toBe(40);
    expect(coursePercentOf("40.5")).toBe(40.5);
    expect(coursePercentOf(0)).toBe(0);
  });
  it("clamps what old rows hold", () => {
    expect(coursePercentOf(119000)).toBe(100);
    expect(coursePercentOf("119000")).toBe(100);
    expect(coursePercentOf(-5)).toBe(0);
  });
  it("calls anything unreadable unknown, not zero", () => {
    for (const value of ["null", "", "  ", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}, true]) {
      expect(coursePercentOf(value)).toBeNull();
    }
  });
});

describe("furthestUnfinishedPercent", () => {
  it("takes the unfinished course furthest along", () => {
    expect(
      furthestUnfinishedPercent([
        { percentage_completed: 8 },
        { percentage_completed: 30 },
        { percentage_completed: 100 },
      ]),
    ).toBe(30);
  });
  it("passes over rows it cannot read, and says so when none can", () => {
    expect(furthestUnfinishedPercent([{ percentage_completed: "null" }, { percentage_completed: 5 }])).toBe(5);
    expect(furthestUnfinishedPercent([{ percentage_completed: "null" }])).toBeNull();
    expect(furthestUnfinishedPercent([{ percentage_completed: 119000 }])).toBeNull();
    expect(furthestUnfinishedPercent([])).toBeNull();
    expect(furthestUnfinishedPercent(null)).toBeNull();
  });
  it("reads a started course at nothing yet as zero", () => {
    expect(furthestUnfinishedPercent([{ percentage_completed: 0 }])).toBe(0);
  });
});

describe("countWorthShowing", () => {
  it("has nothing to count in a single lesson", () => {
    expect(countWorthShowing({ done: 0, total: 1, partOfCourse: false })).toBe(false);
    expect(countWorthShowing({ done: 1, total: 2, partOfCourse: false })).toBe(true);
    expect(countWorthShowing(undefined)).toBe(false);
    expect(countWorthShowing(null)).toBe(false);
  });
  it("waits for the chapter's first lesson done", () => {
    expect(countWorthShowing({ done: 0, total: 6, partOfCourse: true })).toBe(false);
    expect(countWorthShowing({ done: 3, total: 6, partOfCourse: true })).toBe(true);
  });
});

describe("shownCoursePercent", () => {
  const base = {
    hasResume: false,
    coursePercent: undefined,
    hasAnyProgress: true,
    furthestPercent: 30,
    standing: "unknown" as const,
    lessonsListed: false,
  };
  it("shows the resume course, else the unfinished course furthest along", () => {
    expect(shownCoursePercent({ ...base, hasResume: true, coursePercent: 60 })).toBe(60);
    expect(shownCoursePercent({ ...base, hasResume: true, coursePercent: null })).toBeNull();
    expect(shownCoursePercent(base)).toBe(30);
    expect(shownCoursePercent({ ...base, hasAnyProgress: false })).toBe(0);
  });
  it("shows everything finished with a lesson still listed as nearly done, never 100", () => {
    expect(shownCoursePercent({ ...base, standing: "finished", furthestPercent: null, lessonsListed: true })).toBe(
      NEARLY_DONE_PERCENT,
    );
    expect(shownCoursePercent({ ...base, standing: "finished", furthestPercent: null })).toBeNull();
  });
});

describe("everythingFinished", () => {
  const base = {
    hasResume: false,
    resumeResolving: false,
    firstRunKnown: true,
    standing: "finished" as const,
    lessonsListed: false,
  };
  it("is true only with every course finished and nothing left to offer", () => {
    expect(everythingFinished(base)).toBe(true);
    expect(everythingFinished({ ...base, hasResume: true })).toBe(false);
    expect(everythingFinished({ ...base, resumeResolving: true })).toBe(false);
    expect(everythingFinished({ ...base, firstRunKnown: false })).toBe(false);
    expect(everythingFinished({ ...base, lessonsListed: true })).toBe(false);
    expect(everythingFinished({ ...base, standing: "unknown" })).toBe(false);
  });
  it("is never true where the institute hides progress", () => {
    expect(everythingFinished({ ...base, hideProgress: true })).toBe(false);
    expect(everythingFinished({ ...base, hideProgress: null })).toBe(true);
    expect(everythingFinished({ ...base, hideProgress: false })).toBe(true);
  });
});
