import { describe, expect, it } from "vitest";
import { case1, case2, case3 } from "./helper";

/**
 * A PUBLIC assessment may carry no registration window — the backend treats a
 * missing bound as "no limit on that side" (AssessmentPublicPageManager).
 *
 * These did a bare `Date.parse(null)` -> NaN, and every comparison with NaN is
 * false, so all three were false at once and the form never rendered. Verified
 * against the live bundle: can_register:true with both dates null produced a
 * page with zero inputs and no error screen.
 */
describe("registration window cases", () => {
  const now = Date.parse("2026-09-23T00:00:00Z");
  const iso = (days: number) =>
    new Date(now + days * 24 * 60 * 60 * 1000).toISOString();

  describe("no window at all (the post-fix PUBLIC default)", () => {
    it("is not waiting to open", () => {
      expect(case1(now, null)).toBe(false);
    });

    it("IS open for registration — this is the bug that blanked the page", () => {
      expect(case2(now, null, null)).toBe(true);
    });

    it("is not closed", () => {
      expect(case3(now, null)).toBe(false);
    });

    it("behaves the same for undefined and empty string", () => {
      expect(case2(now, undefined, undefined)).toBe(true);
      expect(case2(now, "", "")).toBe(true);
      expect(case1(now, undefined)).toBe(false);
      expect(case3(now, "")).toBe(false);
    });
  });

  describe("only one bound set", () => {
    it("an open date in the past with no close date stays open", () => {
      expect(case2(now, iso(-7), null)).toBe(true);
      expect(case3(now, null)).toBe(false);
    });

    it("an open date in the future still gates", () => {
      expect(case1(now, iso(7))).toBe(true);
      expect(case2(now, iso(7), null)).toBe(false);
    });

    it("a close date in the past still closes", () => {
      expect(case3(now, iso(-1))).toBe(true);
      expect(case2(now, null, iso(-1))).toBe(false);
    });
  });

  describe("both bounds set — unchanged behaviour", () => {
    it("inside the window registers", () => {
      expect(case1(now, iso(-1))).toBe(false);
      expect(case2(now, iso(-1), iso(1))).toBe(true);
      expect(case3(now, iso(1))).toBe(false);
    });

    it("before the window waits", () => {
      expect(case1(now, iso(1))).toBe(true);
      expect(case2(now, iso(1), iso(2))).toBe(false);
    });

    it("after the window closes", () => {
      expect(case2(now, iso(-2), iso(-1))).toBe(false);
      expect(case3(now, iso(-1))).toBe(true);
    });

    it("exactly on each boundary counts as inside", () => {
      expect(case2(now, new Date(now).toISOString(), iso(1))).toBe(true);
      expect(case2(now, iso(-1), new Date(now).toISOString())).toBe(true);
    });
  });

  it("never reports open and closed at the same time", () => {
    const windows: Array<[string | null, string | null]> = [
      [null, null],
      [iso(-1), null],
      [null, iso(1)],
      [iso(-1), iso(1)],
      [iso(1), iso(2)],
      [iso(-2), iso(-1)],
    ];
    for (const [start, end] of windows) {
      const states = [
        case1(now, start),
        case2(now, start, end),
        case3(now, end),
      ].filter(Boolean);
      expect(states.length).toBe(1);
    }
  });
});
