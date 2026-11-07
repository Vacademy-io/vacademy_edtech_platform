import { describe, expect, it } from "vitest";
import {
  DEFAULT_COURSE_LANGUAGES as LANGS,
  groupCourseVariants,
  languageOfLevel,
  preferredCourseLanguage,
  rowMatchesLanguages,
  variantForLanguage,
} from "./course-variants";
import { comparePopularity, computeCourseBadges } from "./course-badges";
import { evaluateVisibleWhen, fillLinkPattern, linkWithParams, readListParam, readSearchParam, withSearchParams } from "./catalogue-url-state";
import { cartTotals, partitionByStore, storeCheckoutTarget, upsertCartItem, upsertCartItems } from "./site-cart";

describe("languageOfLevel", () => {
  it("reads the language from plain and compound level names", () => {
    expect(languageOfLevel("Hindi", LANGS)?.code).toBe("hi");
    expect(languageOfLevel("Beginner Hindi", LANGS)?.code).toBe("hi");
    expect(languageOfLevel("advanced english - batch 2", LANGS)?.code).toBe("en");
    expect(languageOfLevel("हिन्दी", LANGS)?.code).toBe("hi");
  });

  it("does not match inside other words or unrelated levels", () => {
    expect(languageOfLevel("Engineering", LANGS)).toBeNull();
    expect(languageOfLevel("default", LANGS)).toBeNull();
    expect(languageOfLevel("", LANGS)).toBeNull();
  });
});

describe("groupCourseVariants", () => {
  const rows = [
    { package_id: "c1", package_session_id: "c1-en", level_name: "English" },
    { package_id: "c2", package_session_id: "c2-hi", level_name: "Hindi" },
    { package_id: "c1", package_session_id: "c1-hi", level_name: "Hindi" },
  ];

  it("folds a course's levels into one group, in first-seen order", () => {
    const groups = groupCourseVariants(rows, { enabled: true, languages: LANGS });
    expect(groups.map((g) => g.courseId)).toEqual(["c1", "c2"]);
    expect(groups[0].variants.map((v) => v.package_session_id)).toEqual(["c1-en", "c1-hi"]);
    expect(groups[0].languages.map((l) => l.code)).toEqual(["en", "hi"]);
    expect(groups[0].primary.package_session_id).toBe("c1-en");
  });

  it("shows the preferred language first when the course has it", () => {
    const groups = groupCourseVariants(rows, { enabled: true, languages: LANGS, preferredLanguage: "hi" });
    expect(groups[0].primary.package_session_id).toBe("c1-hi");
    expect(variantForLanguage(groups[0], "en", LANGS)?.package_session_id).toBe("c1-en");
  });

  it("keeps one card per row when grouping is off (existing behaviour)", () => {
    const groups = groupCourseVariants(rows, { enabled: false, languages: LANGS });
    expect(groups).toHaveLength(3);
  });

  it("filters rows by selected languages", () => {
    expect(rowMatchesLanguages(rows[0], ["hi"], LANGS)).toBe(false);
    expect(rowMatchesLanguages(rows[1], ["hi"], LANGS)).toBe(true);
    expect(rowMatchesLanguages(rows[1], [], LANGS)).toBe(true);
    expect(preferredCourseLanguage("hi", LANGS)).toBe("hi");
    expect(preferredCourseLanguage("ta", LANGS)).toBeNull();
  });
});

describe("computeCourseBadges", () => {
  const now = Date.parse("2026-10-09T00:00:00Z");
  const courses = [
    { courseId: "a", price: 999, tags: ["shiksha"], createdAt: "2026-01-01T00:00:00Z" },
    { courseId: "b", price: 499, tags: ["kala"], createdAt: "2026-09-20T00:00:00Z" },
    { courseId: "c", price: 0, tags: ["shiksha"], createdAt: "2025-01-01T00:00:00Z" },
    { courseId: "d", price: 1999, tags: ["kala"], createdAt: "2025-01-01T00:00:00Z" },
    { courseId: "e", price: 1499, tags: ["shiksha"], createdAt: "2025-01-01T00:00:00Z" },
  ];
  const ranks = new Map([
    ["c", 1],
    ["a", 2],
    ["d", 3],
    ["e", 4],
    ["b", 5],
  ]);

  it("gives Bestseller to the top paid courses, Popular per stream, New and Free", () => {
    const badges = computeCourseBadges(courses, {
      ranks,
      streamTags: ["shiksha", "kala"],
      now,
      rules: { bestsellerTop: 2, max: 4 },
    });
    expect(badges.get("a")).toEqual(["bestseller"]);
    expect(badges.get("d")).toEqual(["bestseller", "popular"]);
    expect(badges.get("c")).toEqual(["popular", "free"]);
    expect(badges.get("b")).toEqual(["new"]);
    expect(badges.get("e")).toBeUndefined();
  });

  it("respects the badge list and the per-card cap", () => {
    const badges = computeCourseBadges(courses, { ranks, streamTags: ["shiksha", "kala"], now, rules: { types: ["free", "new"], max: 1 } });
    expect(badges.get("c")).toEqual(["free"]);
    expect(badges.get("a")).toBeUndefined();
  });

  it("sorts ranked courses first", () => {
    expect(["e", "x", "c", "a"].sort(comparePopularity(ranks))).toEqual(["c", "a", "e", "x"]);
  });
});

describe("URL state", () => {
  it("reads single and list parameters", () => {
    expect(readSearchParam("?stream=shiksha&utm_source=x", "stream")).toBe("shiksha");
    expect(readSearchParam("?stream=", "stream")).toBeNull();
    expect(readListParam("?language=hi,en", "language")).toEqual(["hi", "en"]);
  });

  it("updates only the keys it owns", () => {
    expect(withSearchParams("?utm_source=x&lang=hi", { stream: "shiksha", category: null })).toBe(
      "?utm_source=x&lang=hi&stream=shiksha",
    );
    expect(withSearchParams("?stream=shiksha", { stream: null })).toBe("");
    expect(withSearchParams("", { language: ["hi", "en"] })).toBe("?language=hi%2Cen");
  });

  it("evaluates visibleWhen rules, defaulting to visible", () => {
    expect(evaluateVisibleWhen([{ param: "stream", op: "empty" }], "")).toBe(true);
    expect(evaluateVisibleWhen([{ param: "stream", op: "empty" }], "?stream=shiksha")).toBe(false);
    expect(evaluateVisibleWhen([{ param: "stream", op: "equals", value: "Shiksha" }], "?stream=shiksha")).toBe(true);
    expect(evaluateVisibleWhen([{ param: "stream", op: "notEmpty" }, { param: "q", op: "empty" }], "?stream=x&q=y")).toBe(false);
    expect(evaluateVisibleWhen(undefined, "?stream=x")).toBe(true);
    expect(evaluateVisibleWhen([{ op: "empty" }], "?stream=x")).toBe(true);
  });

  it("builds links from patterns", () => {
    expect(fillLinkPattern("/courses?stream={stream}&category={category}", { stream: "shiksha", category: "gurukul" })).toBe(
      "/courses?stream=shiksha&category=gurukul",
    );
    expect(linkWithParams("/courses?sort=popular", { stream: "kala" })).toBe("/courses?sort=popular&stream=kala");
  });
});

describe("site cart helpers", () => {
  const en = { packageSessionId: "c1-en", courseId: "c1", title: "Gurukul", price: 999, currency: "INR" };
  const hi = { packageSessionId: "c1-hi", courseId: "c1", title: "Gurukul", price: 899, currency: "INR" };
  const other = { packageSessionId: "c2-hi", courseId: "c2", title: "Ayurveda", price: 500, elevatedPrice: 800, currency: "INR" };

  it("keeps one version per course and ignores duplicates", () => {
    let items = upsertCartItem([], en);
    items = upsertCartItem(items, en);
    expect(items).toHaveLength(1);
    items = upsertCartItem(items, hi);
    expect(items.map((i) => i.packageSessionId)).toEqual(["c1-hi"]);
    items = upsertCartItems(items, [other, en]);
    expect(items.map((i) => i.packageSessionId).sort()).toEqual(["c1-en", "c2-hi"]);
  });

  it("totals one currency and refuses to add mixed currencies", () => {
    expect(cartTotals([en, other])).toEqual({ count: 2, total: 1499, elevatedTotal: 1799, currency: "INR" });
    expect(cartTotals([en, { ...other, currency: "USD" }]).total).toBeNull();
  });

  it("totals the priced items' currency: a free item's label never makes it 'shown at checkout'", () => {
    const paidAud = { packageSessionId: "c3-en", courseId: "c3", title: "Business English", price: 499, elevatedPrice: 599, currency: "AUD" };
    const freeInr = { packageSessionId: "c4-en", courseId: "c4", title: "Orientation", price: 0, elevatedPrice: 999, currency: "INR" };
    // Either order: the free INR line costs nothing, and its list price stays out of the AUD total.
    expect(cartTotals([paidAud, freeInr])).toEqual({ count: 2, total: 499, elevatedTotal: 599, currency: "AUD" });
    expect(cartTotals([freeInr, paidAud])).toEqual({ count: 2, total: 499, elevatedTotal: 599, currency: "AUD" });
    // A line with no price yet does not name the currency either.
    expect(cartTotals([{ ...freeInr, price: undefined, elevatedPrice: undefined }, paidAud]).currency).toBe("AUD");
    // Priced items in two currencies still have no single honest total.
    expect(cartTotals([paidAud, freeInr, en]).total).toBeNull();
    // A cart of free items only keeps its own currency (and its list prices).
    expect(cartTotals([freeInr])).toEqual({ count: 1, total: 0, elevatedTotal: 999, currency: "INR" });
    expect(cartTotals([freeInr, { ...freeInr, packageSessionId: "c5-en", courseId: "c5", currency: "USD" }]).total).toBeNull();
  });

  it("splits by what the store page sells and builds the checkout target", () => {
    const { available, unavailable } = partitionByStore([en, other], new Set(["c1-en"]));
    expect(available.map((i) => i.packageSessionId)).toEqual(["c1-en"]);
    expect(unavailable.map((i) => i.packageSessionId)).toEqual(["c2-hi"]);
    const target = storeCheckoutTarget("STORE1", [en, other], { instituteId: "inst", tagName: "site" });
    expect(target.params).toEqual({ productPageCode: "STORE1" });
    expect(target.search).toEqual({ courseIds: "c1-en,c2-hi", defaultTab: "CART", instituteId: "inst", tagName: "site" });
  });
});
