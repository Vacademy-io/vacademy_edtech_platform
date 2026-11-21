import { describe, expect, it } from "vitest";
import { getAssessmentWindow, hasNoExpiry, toUtcDate } from "./assessment-window";

const SENTINEL = "9999-12-31T23:59:59.999+00:00";

/** A date as a learner's device reads it where the local year differs from the UTC one. */
class DateWithLocalYear extends Date {
  constructor(
    value: string,
    private readonly localYear: number,
  ) {
    super(value);
  }

  override getFullYear() {
    return this.localYear;
  }
}

describe("hasNoExpiry", () => {
  it("recognises the sentinel where the local year rolls over to 10000", () => {
    expect(hasNoExpiry(new DateWithLocalYear(SENTINEL, 10000))).toBe(true);
  });

  it("recognises the sentinel where the local year stays 9999", () => {
    expect(hasNoExpiry(new DateWithLocalYear(SENTINEL, 9999))).toBe(true);
  });

  it("recognises the sentinel written with no zone", () => {
    expect(hasNoExpiry(toUtcDate("9999-12-31 23:59:59"))).toBe(true);
  });

  it("does not take a real end date for the sentinel", () => {
    expect(hasNoExpiry(toUtcDate("2030-06-01T10:00:00.000+00:00"))).toBe(false);
    expect(hasNoExpiry(new DateWithLocalYear("2030-12-31T23:59:59.000+00:00", 2031))).toBe(false);
  });

  it("is false with no date", () => {
    expect(hasNoExpiry(null)).toBe(false);
  });
});

describe("getAssessmentWindow", () => {
  it("leaves a sentinel window open with no time to close", () => {
    const win = getAssessmentWindow({ bound_end_time: SENTINEL });
    expect(win.noExpiry).toBe(true);
    expect(win.msToEnd).toBeNull();
    expect(win.state).toBe("OPEN");
  });
});
