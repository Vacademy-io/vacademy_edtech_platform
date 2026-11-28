import { describe, expect, it } from "vitest";
import { funAddsBottomBar, funBarLabel, funHeaderPageOf, funHidesAppBar, funLessonOwnsFoot } from "./fun-bottom-bar";

describe("funAddsBottomBar", () => {
  const auto = { showBottomBar: false, placement: "auto", device: "mobile" };
  it("adds the bar on a phone when the institute left navigation on auto", () => {
    expect(funAddsBottomBar(true, auto)).toBe(true);
  });
  it("never for another skin, an institute's own placement, or a bar already there", () => {
    expect(funAddsBottomBar(false, auto)).toBe(false);
    expect(funAddsBottomBar(true, { ...auto, placement: "sidebar" })).toBe(false);
    expect(funAddsBottomBar(true, { ...auto, device: "tablet" })).toBe(false);
    expect(funAddsBottomBar(true, { ...auto, showBottomBar: true })).toBe(false);
  });
});

describe("funLessonOwnsFoot", () => {
  it("is the lesson viewer route only", () => {
    expect(funLessonOwnsFoot("/study-library/courses/course-details/subjects/modules/chapters/slides")).toBe(true);
    expect(funLessonOwnsFoot("/study-library/courses/course-details/subjects/modules/chapters/slides/")).toBe(true);
    expect(funLessonOwnsFoot("/study-library/courses/course-details/subjects/modules/chapters")).toBe(false);
    expect(funLessonOwnsFoot("/study-library/courses/course-details")).toBe(false);
    expect(funLessonOwnsFoot("/dashboard")).toBe(false);
  });
});

describe("funBarLabel", () => {
  it("takes the bar's short name when there is one", () => {
    expect(funBarLabel("Assessment Centre", "Tests")).toBe("Tests");
  });
  it("keeps a translated title whole instead of cutting it after five code units", () => {
    expect(funBarLabel("उपस्थिति", null)).toBe("उपस्थिति");
    expect(funBarLabel("الرئيسية", undefined)).toBe("الرئيسية");
  });
});

describe("funHeaderPageOf", () => {
  it("names the Fun pages with their own header", () => {
    expect(funHeaderPageOf("/study-library/courses")).toBe("learn");
    expect(funHeaderPageOf("/study-library/courses/")).toBe("learn");
    expect(funHeaderPageOf("/study-library/courses/course-details")).toBe("course");
    expect(funHeaderPageOf("/study-library/courses/course-details/subjects/modules/chapters/slides")).toBe("lesson");
  });
  it("leaves every other route alone", () => {
    expect(funHeaderPageOf("/dashboard")).toBeNull();
    expect(funHeaderPageOf("/study-library/courses/course-details/subjects/modules/chapters")).toBeNull();
    expect(funHeaderPageOf("/assessment/examination")).toBeNull();
  });
});

describe("funHidesAppBar", () => {
  const lesson = "/study-library/courses/course-details/subjects/modules/chapters/slides";
  const on = { navElsewhere: true, lessonBarShown: true };
  it("never under another skin or on another route", () => {
    expect(funHidesAppBar(false, "/study-library/courses", on)).toBe(false);
    expect(funHidesAppBar(false, lesson, on)).toBe(false);
    expect(funHidesAppBar(true, "/dashboard", on)).toBe(false);
  });
  it("steps aside on the course list and course page only while navigation shows elsewhere", () => {
    expect(funHidesAppBar(true, "/study-library/courses", on)).toBe(true);
    expect(funHidesAppBar(true, "/study-library/courses/course-details", on)).toBe(true);
    expect(funHidesAppBar(true, "/study-library/courses", { ...on, navElsewhere: false })).toBe(false);
    expect(funHidesAppBar(true, "/study-library/courses/course-details", { ...on, navElsewhere: false })).toBe(false);
  });
  it("steps aside on the lesson viewer while its own bar shows", () => {
    expect(funHidesAppBar(true, lesson, { navElsewhere: false, lessonBarShown: true })).toBe(true);
    expect(funHidesAppBar(true, lesson, { navElsewhere: true, lessonBarShown: false })).toBe(false);
  });
});
