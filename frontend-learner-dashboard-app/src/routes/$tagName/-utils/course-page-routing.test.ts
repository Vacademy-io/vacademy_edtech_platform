import { describe, it, expect } from "vitest";
import { resolveCourseView, resolveCoursePageRoute } from "./course-page-routing";

const COURSE = "d955bc54-fed5-48d0-806b-441faad75840";
const SESSION = "4e2bdf13-7561-44b0-9fd9-1d3ceefd8bad";

const settings = (coursePages: unknown) => ({ coursePages });
const on = (courses: unknown) => settings({ enabled: true, courses });

describe("resolveCourseView", () => {
  it("keeps the details page for a catalogue that never configured this", () => {
    for (const gs of [{}, undefined, null]) {
      expect(resolveCourseView(gs, { courseId: COURSE })).toEqual({ mode: "DETAILS" });
    }
  });

  it("keeps the details page while the setting is switched off, config and all", () => {
    const gs = settings({ enabled: false, courses: { [COURSE]: { mode: "PAGE", route: "toddler" } } });
    expect(resolveCourseView(gs, { courseId: COURSE })).toEqual({ mode: "DETAILS" });
  });

  it("keeps the details page for a course with no entry", () => {
    const gs = on({ [COURSE]: { mode: "PAGE", route: "toddler" } });
    expect(resolveCourseView(gs, { courseId: "another-course" })).toEqual({ mode: "DETAILS" });
  });

  it("resolves each of the four modes", () => {
    expect(resolveCourseView(on({ [COURSE]: { mode: "PAGE", route: "toddler" } }), { courseId: COURSE }))
      .toEqual({ mode: "PAGE", route: "toddler" });
    expect(resolveCourseView(on({ [COURSE]: { mode: "OUTLINE" } }), { courseId: COURSE }))
      .toEqual({ mode: "OUTLINE" });
    expect(resolveCourseView(on({ [COURSE]: { mode: "TILES" } }), { courseId: COURSE }))
      .toEqual({ mode: "TILES" });
    expect(resolveCourseView(on({ [COURSE]: { mode: "DETAILS" } }), { courseId: COURSE }))
      .toEqual({ mode: "DETAILS" });
  });

  it("falls back to the details page when PAGE has no usable route", () => {
    for (const route of [undefined, "", "   ", "/"]) {
      const gs = on({ [COURSE]: { mode: "PAGE", route } });
      expect(resolveCourseView(gs, { courseId: COURSE })).toEqual({ mode: "DETAILS" });
    }
  });

  it("falls back to the details page rather than loop on an id-shaped route", () => {
    for (const route of [SESSION, "12345", COURSE]) {
      const gs = on({ [COURSE]: { mode: "PAGE", route } });
      expect(resolveCourseView(gs, { courseId: COURSE })).toEqual({ mode: "DETAILS" });
    }
  });

  it("matches on package session id when the course id has no entry", () => {
    const gs = on({ [SESSION]: { mode: "OUTLINE" } });
    expect(resolveCourseView(gs, { courseId: COURSE, packageSessionId: SESSION }))
      .toEqual({ mode: "OUTLINE" });
  });

  it("prefers the course id over the package session id", () => {
    const gs = on({
      [COURSE]: { mode: "PAGE", route: "by-course" },
      [SESSION]: { mode: "OUTLINE" },
    });
    expect(resolveCourseView(gs, { courseId: COURSE, packageSessionId: SESSION }))
      .toEqual({ mode: "PAGE", route: "by-course" });
  });

  it("normalizes what admins actually paste into a route", () => {
    const cases: Array<[string, string]> = [
      ["/toddler", "toddler"],
      ["toddler/", "toddler"],
      ["  toddler  ", "toddler"],
      // A pasted page URL carries the catalogue tag, which the caller adds
      // back — only the last segment is the route.
      ["https://7cs.vacademy.io/new-landing-page/toddler", "toddler"],
      ["https://7cs.vacademy.io/new-landing-page/toddler/", "toddler"],
    ];
    for (const [raw, route] of cases) {
      const gs = on({ [COURSE]: { mode: "PAGE", route: raw } });
      expect(resolveCourseView(gs, { courseId: COURSE })).toEqual({ mode: "PAGE", route });
    }
  });

  it("survives a malformed config without throwing", () => {
    expect(resolveCourseView(settings({ enabled: true }), { courseId: COURSE })).toEqual({ mode: "DETAILS" });
    expect(resolveCourseView(on("nope"), { courseId: COURSE })).toEqual({ mode: "DETAILS" });
    expect(resolveCourseView(on({}), {})).toEqual({ mode: "DETAILS" });
    expect(resolveCourseView(on({ [COURSE]: {} }), { courseId: COURSE })).toEqual({ mode: "DETAILS" });
  });

  // The shape saved before modes existed. Nothing has been published against
  // it, but a draft saved mid-build must not silently lose its mapping.
  it("still reads the pre-modes map as PAGE", () => {
    const gs = settings({ enabled: true, map: { [COURSE]: "toddler" } });
    expect(resolveCourseView(gs, { courseId: COURSE })).toEqual({ mode: "PAGE", route: "toddler" });
  });

  it("lets a modes entry win over a leftover legacy entry", () => {
    const gs = settings({
      enabled: true,
      courses: { [COURSE]: { mode: "OUTLINE" } },
      map: { [COURSE]: "toddler" },
    });
    expect(resolveCourseView(gs, { courseId: COURSE })).toEqual({ mode: "OUTLINE" });
  });
});

describe("resolveCoursePageRoute", () => {
  it("gives a route only for PAGE — the one mode that changes the URL", () => {
    expect(resolveCoursePageRoute(on({ [COURSE]: { mode: "PAGE", route: "toddler" } }), { courseId: COURSE }))
      .toBe("toddler");
    expect(resolveCoursePageRoute(on({ [COURSE]: { mode: "OUTLINE" } }), { courseId: COURSE })).toBeNull();
    expect(resolveCoursePageRoute(on({ [COURSE]: { mode: "TILES" } }), { courseId: COURSE })).toBeNull();
    expect(resolveCoursePageRoute(on({ [COURSE]: { mode: "DETAILS" } }), { courseId: COURSE })).toBeNull();
    expect(resolveCoursePageRoute({}, { courseId: COURSE })).toBeNull();
  });
});
