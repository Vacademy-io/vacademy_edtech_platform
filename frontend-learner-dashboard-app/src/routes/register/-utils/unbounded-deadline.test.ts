import { describe, expect, it } from "vitest";
import { isEffectivelyUnbounded } from "./helper";

/**
 * Assessments created without an explicit end are stored as 9999-12-31. Once the
 * registration window is backfilled from that bound, the register page rendered
 * "REGISTRATION CLOSES IN 2912177 DAYS" — observed live on code 308805.
 */
describe("isEffectivelyUnbounded", () => {
  const now = Date.parse("2026-09-23T00:00:00Z");
  const inDays = (n: number) =>
    new Date(now + n * 24 * 60 * 60 * 1000).toISOString();

  it("treats the 9999 sentinel as no deadline at all", () => {
    expect(isEffectivelyUnbounded(now, "9999-12-31T23:59:59.999+00:00")).toBe(true);
  });

  it("treats a missing close date as no deadline", () => {
    expect(isEffectivelyUnbounded(now, null)).toBe(true);
    expect(isEffectivelyUnbounded(now, undefined)).toBe(true);
    expect(isEffectivelyUnbounded(now, "")).toBe(true);
  });

  it("treats an unparseable date as no deadline rather than throwing", () => {
    expect(isEffectivelyUnbounded(now, "not-a-date")).toBe(true);
  });

  it("keeps the countdown for a real deadline a month out", () => {
    expect(isEffectivelyUnbounded(now, inDays(28))).toBe(false);
  });

  it("keeps the countdown for a deadline just inside a year", () => {
    expect(isEffectivelyUnbounded(now, inDays(365))).toBe(false);
  });

  it("drops the countdown past the one-year horizon", () => {
    expect(isEffectivelyUnbounded(now, inDays(400))).toBe(true);
  });

  it("keeps the countdown for a deadline already in the past", () => {
    // Expiry is handled elsewhere; this must not classify it as unbounded.
    expect(isEffectivelyUnbounded(now, inDays(-1))).toBe(false);
  });
});
