import { describe, it, expect } from "vitest";
import { resolveLearnerStructureVariant } from "./learner-course-details-settings";

/**
 * The logged-out course page has to land on the same layout the institute
 * gave its logged-in learners — that is the whole point of reading this
 * record — and it must never break when the settings are missing or odd,
 * because it renders for anonymous visitors before anything is known.
 */
describe("resolveLearnerStructureVariant", () => {
  it("falls back to the outline when there are no settings", () => {
    for (const s of [null, undefined, {}]) {
      expect(resolveLearnerStructureVariant(s)).toBe("outline");
    }
  });

  // The 7Cs institute's real configuration: its learners get the content card
  // grid as the whole page, so a visitor must see cards too.
  it("uses tiles when the learner layout is contentOnly", () => {
    expect(
      resolveLearnerStructureVariant({
        enrolledLayout: "contentOnly",
        defaultTab: "OUTLINE",
        tabs: [
          { id: "OUTLINE", order: 1, visible: true },
          { id: "CONTENT_STRUCTURE", order: 2, visible: true },
        ],
      }),
    ).toBe("tiles");
  });

  it("otherwise follows the opening tab", () => {
    const tabs = [
      { id: "OUTLINE", order: 1, visible: true },
      { id: "CONTENT_STRUCTURE", order: 2, visible: true },
    ];
    expect(resolveLearnerStructureVariant({ defaultTab: "OUTLINE", tabs })).toBe("outline");
    expect(
      resolveLearnerStructureVariant({ defaultTab: "CONTENT_STRUCTURE", tabs }),
    ).toBe("tiles");
  });

  it("ignores a defaultTab pointing at a hidden tab", () => {
    // The learner's own page cannot open a tab that is not rendered, so the
    // public page must not either — it falls to the first visible tab.
    expect(
      resolveLearnerStructureVariant({
        defaultTab: "OUTLINE",
        tabs: [
          { id: "OUTLINE", order: 1, visible: false },
          { id: "CONTENT_STRUCTURE", order: 2, visible: true },
        ],
      }),
    ).toBe("tiles");
  });

  it("uses the lowest-order visible tab when no defaultTab is set", () => {
    expect(
      resolveLearnerStructureVariant({
        tabs: [
          { id: "CONTENT_STRUCTURE", order: 2, visible: true },
          { id: "TEACHERS", order: 1, visible: true },
        ],
      }),
    ).toBe("outline");
    expect(
      resolveLearnerStructureVariant({
        tabs: [
          { id: "CONTENT_STRUCTURE", order: 1, visible: true },
          { id: "OUTLINE", order: 2, visible: true },
        ],
      }),
    ).toBe("tiles");
  });

  it("treats a tab with no explicit visible flag as visible", () => {
    expect(
      resolveLearnerStructureVariant({
        defaultTab: "CONTENT_STRUCTURE",
        tabs: [{ id: "CONTENT_STRUCTURE", order: 1 }],
      }),
    ).toBe("tiles");
  });

  it("falls back to the outline when every tab is hidden", () => {
    expect(
      resolveLearnerStructureVariant({
        defaultTab: "CONTENT_STRUCTURE",
        tabs: [{ id: "CONTENT_STRUCTURE", order: 1, visible: false }],
      }),
    ).toBe("outline");
  });
});
