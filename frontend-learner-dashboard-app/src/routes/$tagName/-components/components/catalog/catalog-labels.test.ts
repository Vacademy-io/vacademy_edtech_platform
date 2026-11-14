import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { badgeLabel } from "./catalog-labels";

// Echo "key|default" so both the key and the English fallback are checked.
const t = ((key: string, fallback: string) => `${key}|${fallback}`) as unknown as TFunction;

describe("badgeLabel", () => {
  it("names every badge with a coursePlayerB key and an English default", () => {
    expect(badgeLabel(t, "bestseller")).toBe("courseCatalog.badgeBestseller|Bestseller");
    expect(badgeLabel(t, "popular")).toBe("courseCatalog.badgePopular|Popular");
    expect(badgeLabel(t, "new")).toBe("courseCatalog.badgeNew|New");
    expect(badgeLabel(t, "free")).toBe("courseCatalog.badgeFree|Free");
  });
});
