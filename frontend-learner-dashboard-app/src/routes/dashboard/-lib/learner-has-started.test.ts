import { describe, expect, it } from "vitest";
import { learnerHasStarted } from "./learner-has-started";

describe("learnerHasStarted", () => {
  it("is false when nothing has been recorded", () => {
    expect(learnerHasStarted({})).toBe(false);
    expect(
      learnerHasStarted({
        subjects: [{ percentage_completed: 0 }, {}],
        recentSlides: [],
        enrolledHasProgress: false,
      }),
    ).toBe(false);
  });

  it("is true for progress in the batch the study library read", () => {
    expect(learnerHasStarted({ subjects: [{ percentage_completed: 12 }] })).toBe(true);
  });

  it("is true for progress on another batch", () => {
    expect(
      learnerHasStarted({ subjects: [{ percentage_completed: 0 }], enrolledHasProgress: true }),
    ).toBe(true);
  });

  it("is true for a slide the learner has opened", () => {
    expect(learnerHasStarted({ subjects: [], recentSlides: [{}] })).toBe(true);
  });
});
