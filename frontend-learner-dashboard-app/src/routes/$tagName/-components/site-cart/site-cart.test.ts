import { describe, expect, it, vi } from "vitest";
import type { SiteCartItem } from "../../-utils/site-cart";
import { DEFAULT_COURSE_LANGUAGES } from "../../-utils/course-variants";
import {
  SITE_CART_MAX_ITEMS,
  capCartAdd,
  cartItemFromMapping,
  isMeaningfulLevel,
  isStoreCheckoutPath,
  levelBeyondLanguage,
  stripLanguageWords,
  versionLabel,
} from "./site-cart-items";
import {
  activeMappingCounts,
  canCheckOutDirectly,
  precheckSiteCart,
  readyAtStorePrices,
  reviewSummary,
  unavailableSessionIds,
} from "./site-cart-precheck";
import { CLOSED_DRAWER_THEME, nextDrawerTheme, readCatalogueTheme } from "./catalogue-theme-snapshot";

const item = (courseId: string, packageSessionId: string, extra: Partial<SiteCartItem> = {}): SiteCartItem => ({
  courseId,
  packageSessionId,
  title: courseId,
  ...extra,
});

const mapping = (packageSessionId: string, extra: Record<string, unknown> = {}) => ({
  package_session_id: packageSessionId,
  status: "ACTIVE",
  payment_plan: { actual_price: 100, currency: "INR" },
  ...extra,
});

describe("capCartAdd", () => {
  it("adds new courses and skips versions already in the cart", () => {
    const result = capCartAdd([item("c1", "c1-en")], [item("c1", "c1-en"), item("c2", "c2-hi")]);
    expect(result.next.map((i) => i.packageSessionId)).toEqual(["c1-en", "c2-hi"]);
    expect(result.accepted.map((i) => i.packageSessionId)).toEqual(["c2-hi"]);
    expect(result.alreadyIn.map((i) => i.packageSessionId)).toEqual(["c1-en"]);
    expect(result.rejected).toEqual([]);
  });

  it("swaps a course to another language version without growing the cart", () => {
    const result = capCartAdd([item("c1", "c1-en")], [item("c1", "c1-hi")]);
    expect(result.next.map((i) => i.packageSessionId)).toEqual(["c1-hi"]);
    expect(result.accepted).toHaveLength(1);
  });

  it("never grows past the cap, keeping the first items of a long path", () => {
    const current = [item("a", "a1"), item("b", "b1")];
    const result = capCartAdd(current, [item("c", "c1"), item("d", "d1"), item("a", "a2")], 3);
    expect(result.next.map((i) => i.packageSessionId)).toEqual(["b1", "c1", "a2"]);
    expect(result.accepted.map((i) => i.packageSessionId)).toEqual(["c1", "a2"]);
    expect(result.rejected.map((i) => i.packageSessionId)).toEqual(["d1"]);
  });

  it("caps at 40 by default", () => {
    const full = Array.from({ length: SITE_CART_MAX_ITEMS }, (_, n) => item(`c${n}`, `s${n}`));
    const result = capCartAdd(full, [item("new", "new-1")]);
    expect(result.next).toHaveLength(40);
    expect(result.rejected).toHaveLength(1);
    expect(result.next).toBe(full);
  });
});

describe("cartItemFromMapping", () => {
  it("builds an item from a by-code mapping, reading the language from the level", () => {
    const built = cartItemFromMapping(
      {
        package_session_id: "ps-1",
        package_id: "pkg-1",
        package_name: " Vedic Maths ",
        level_name: "Beginner Hindi",
        enroll_invite_id: "inv",
        course_preview_image_media_id: "media-1",
        payment_plan: { actual_price: 499, elevated_price: 999, currency: "INR" },
      },
      { source: { kind: "catalog" } },
    );
    expect(built).toEqual({
      packageSessionId: "ps-1",
      courseId: "pkg-1",
      title: "Vedic Maths",
      levelName: "Beginner Hindi",
      languageCode: "hi",
      price: 499,
      elevatedPrice: 999,
      currency: "INR",
      image: "media-1",
      enrollInviteId: "inv",
      source: { kind: "catalog" },
    });
  });

  it("keeps a mapping without a package id as its own course", () => {
    const built = cartItemFromMapping({ package_session_id: "ps-9", level_name: "default", payment_plan: null });
    expect(built.courseId).toBe("ps-9");
    expect(built.languageCode).toBeUndefined();
    expect(built.price).toBeUndefined();
  });
});

describe("isStoreCheckoutPath", () => {
  it("recognises the store checkout (so a second checkout from it replaces the entry)", () => {
    expect(isStoreCheckoutPath("/product-pages/STORE", "STORE")).toBe(true);
    expect(isStoreCheckoutPath("/product-pages/STORE/", " STORE ")).toBe(true);
    expect(isStoreCheckoutPath("/product-pages/PATH1", "STORE")).toBe(false);
    expect(isStoreCheckoutPath("/site/courses", "STORE")).toBe(false);
    expect(isStoreCheckoutPath("/product-pages/%E0%A4", "STORE")).toBe(false);
    expect(isStoreCheckoutPath(undefined, "STORE")).toBe(false);
    expect(isStoreCheckoutPath("/product-pages/", "")).toBe(false);
  });
});

describe("versionLabel", () => {
  it("prefers the language chip, then a meaningful level", () => {
    expect(versionLabel({ languageCode: "hi" })).toEqual({ chip: "हिं", label: "Hindi" });
    expect(versionLabel({ levelName: "Batch 2" })).toEqual({ chip: "Batch 2", label: "Batch 2" });
    expect(versionLabel({ levelName: "DEFAULT" })).toBeNull();
    expect(isMeaningfulLevel(" none ")).toBe(false);
  });

  it("adds the level when it says more than the language (two levels in one language)", () => {
    expect(versionLabel({ languageCode: "hi", levelName: "Advanced Hindi" })).toEqual({
      chip: "हिं",
      label: "Hindi",
      level: "Advanced",
    });
    // A level that is only its language adds nothing.
    expect(versionLabel({ languageCode: "hi", levelName: "Hindi" })).toEqual({ chip: "हिं", label: "Hindi" });
    expect(versionLabel({ languageCode: "en", levelName: "English" })).toEqual({ chip: "EN", label: "English" });
  });

  it("translates the level before taking its language word out", () => {
    const hindi: Record<string, string> = { "Advanced Hindi": "उन्नत हिंदी" };
    const translate = (s: string) => hindi[s] ?? s;
    expect(versionLabel({ languageCode: "hi", levelName: "Advanced Hindi" }, undefined, translate)?.level).toBe("उन्नत");
  });
});

describe("level names without their language", () => {
  const EN = DEFAULT_COURSE_LANGUAGES[0]!;
  const HI = DEFAULT_COURSE_LANGUAGES[1]!;

  it("keeps the level as written and drops only the language words", () => {
    expect(stripLanguageWords("Advanced Hindi", HI)).toBe("Advanced");
    expect(stripLanguageWords("ADVANCED HINDI", HI)).toBe("ADVANCED");
    expect(stripLanguageWords("Beginner (English)", EN)).toBe("Beginner");
    expect(stripLanguageWords("Hindi - Batch 2", HI)).toBe("Batch 2");
    expect(stripLanguageWords("Beginner - Hindi - Batch 2", HI)).toBe("Beginner - Batch 2");
    expect(stripLanguageWords("Level 2 (Hindi, Live)", HI)).toBe("Level 2 (Live)");
    expect(stripLanguageWords("शुरुआती हिंदी", HI)).toBe("शुरुआती");
    expect(stripLanguageWords("Engineering English", EN)).toBe("Engineering");
  });

  it("leaves nothing when the level is only its language", () => {
    expect(stripLanguageWords("Hindi", HI)).toBe("");
    expect(stripLanguageWords("(English)", EN)).toBe("");
    expect(stripLanguageWords("हिन्दी", HI)).toBe("");
  });

  it("says what a level adds beyond its language, or the level when there is no language", () => {
    expect(levelBeyondLanguage("Advanced Hindi", HI)).toBe("Advanced");
    expect(levelBeyondLanguage("Hindi", HI)).toBe("");
    expect(levelBeyondLanguage("default", HI)).toBe("");
    expect(levelBeyondLanguage("Level 1", null)).toBe("Level 1");
    // An untranslated level still loses its language word.
    expect(levelBeyondLanguage("Advanced Hindi", HI, () => "Advanced Hindi")).toBe("Advanced");
  });
});

describe("precheckSiteCart", () => {
  it("passes a cart the store can sell exactly once per item", () => {
    const result = precheckSiteCart([item("c1", "a"), item("c2", "b")], [mapping("a"), mapping("b")]);
    expect(result.ok).toBe(true);
    expect(result.ready.map((i) => i.packageSessionId)).toEqual(["a", "b"]);
    expect(result.flagged).toEqual([]);
  });

  it("flags versions the store has no ACTIVE mapping for, never dropping them silently", () => {
    const result = precheckSiteCart(
      [item("c1", "a"), item("c2", "b"), item("c3", "c")],
      [mapping("a"), mapping("b", { status: "DELETED" })],
    );
    expect(result.ok).toBe(false);
    expect(result.ready.map((i) => i.packageSessionId)).toEqual(["a"]);
    expect(result.flagged.map((f) => [f.item.packageSessionId, f.issue])).toEqual([
      ["b", "notInStore"],
      ["c", "notInStore"],
    ]);
    expect(unavailableSessionIds(result)).toEqual(["b", "c"]);
  });

  it("flags a version the store lists twice (it would be charged twice)", () => {
    const result = precheckSiteCart([item("c1", "a")], [mapping("a"), mapping("a"), mapping("a", { status: "INACTIVE" })]);
    expect(result.flagged).toEqual([{ item: expect.objectContaining({ packageSessionId: "a" }), issue: "listedTwice" }]);
    expect(result.ready).toEqual([]);
    expect(unavailableSessionIds(result)).toEqual(["a"]);
  });

  it("flags a second copy of a course in the cart and keeps the first", () => {
    const first = item("c1", "a");
    const sameCourse = item("c1", "b");
    const sameVersion = item("c2", "c");
    const result = precheckSiteCart(
      [first, sameCourse, sameVersion, { ...sameVersion }],
      [mapping("a"), mapping("b"), mapping("c")],
    );
    expect(result.ready).toEqual([first, sameVersion]);
    expect(result.flagged.map((f) => f.issue)).toEqual(["duplicateInCart", "duplicateInCart"]);
    // Duplicates are left to the visitor: removing by id could take both copies.
    expect(unavailableSessionIds(result)).toEqual([]);
  });

  it("notes store prices that differ from what the cart showed", () => {
    const result = precheckSiteCart(
      [item("c1", "a", { price: 100 }), item("c2", "b", { price: 50 })],
      [mapping("a"), mapping("b", { payment_plan: { actual_price: 80, currency: "INR" } })],
    );
    expect(result.ok).toBe(true);
    expect(result.priceChanges).toEqual([
      { item: expect.objectContaining({ packageSessionId: "b" }), storePrice: 80, currency: "INR" },
    ]);
  });

  it("never goes straight to checkout over a changed price (a promo price the store does not sell)", () => {
    // Added from a promo link at 2,500; the store charges its plan's 4,999.
    const promo = item("c1", "a", { price: 2500, currency: "INR", enrollInviteId: "DIWALI50" });
    const result = precheckSiteCart([promo], [mapping("a", { payment_plan: { actual_price: 4999, currency: "INR" } })]);
    expect(result.ok).toBe(true);
    expect(canCheckOutDirectly(result, { pricesShown: true })).toBe(false);
    expect(reviewSummary(result)).toEqual({ blocked: [], otherCurrency: [], priceOnly: true });
    // Where no price is ever shown there is nothing to confirm.
    expect(canCheckOutDirectly(result, { pricesShown: false })).toBe(true);
    // A cart at the store's prices goes straight on.
    const same = precheckSiteCart([item("c1", "a", { price: 100 })], [mapping("a")]);
    expect(canCheckOutDirectly(same, { pricesShown: true })).toBe(true);
  });

  it("counts a currency change as a price change", () => {
    const result = precheckSiteCart(
      [item("c1", "a", { price: 499, currency: "INR" })],
      [mapping("a", { payment_plan: { actual_price: 499, currency: "USD" } })],
    );
    expect(result.priceChanges).toEqual([
      { item: expect.objectContaining({ packageSessionId: "a" }), storePrice: 499, currency: "USD" },
    ]);
  });

  it("checks out one currency at a time: items in another currency than the first are set aside", () => {
    const rupees = item("c1", "a", { price: 499, currency: "INR" });
    const dollars = item("c2", "b", { price: 299, currency: "USD" });
    const moreRupees = item("c3", "c", { price: 999, currency: "INR" });
    const result = precheckSiteCart(
      [rupees, dollars, moreRupees],
      [
        mapping("a", { payment_plan: { actual_price: 499, currency: "INR" } }),
        mapping("b", { payment_plan: { actual_price: 299, currency: "usd" } }),
        mapping("c", { payment_plan: { actual_price: 999, currency: "INR" } }),
      ],
    );
    expect(result.ready).toEqual([rupees, moreRupees]);
    expect(result.flagged).toEqual([{ item: dollars, issue: "otherCurrency" }]);
    expect(result.ok).toBe(false);
    expect(canCheckOutDirectly(result, { pricesShown: false })).toBe(false);
    // Not unavailable — it can be bought in an order of its own, so it stays in the cart.
    expect(unavailableSessionIds(result)).toEqual([]);
    expect(reviewSummary(result)).toEqual({
      blocked: [],
      otherCurrency: [{ item: dollars, issue: "otherCurrency" }],
      priceOnly: false,
    });
  });

  it("never lets a free item set or split the order's currency (the server charges priced lines only)", () => {
    // An AUD store that also lists free courses labelled INR.
    const paidAud = item("c1", "ps-paid", { price: 499, currency: "AUD" });
    const freeInr = item("c2", "ps-free", { price: 0, currency: "INR" });
    const store = [
      mapping("ps-paid", { payment_plan: { actual_price: 499, currency: "AUD" } }),
      mapping("ps-free", { payment_plan: { actual_price: 0, currency: "INR" } }),
    ];
    for (const cart of [
      [paidAud, freeInr],
      // Added first, the free course used to set the order's currency and hold the paid one back.
      [freeInr, paidAud],
    ]) {
      const result = precheckSiteCart(cart, store);
      expect(result.ok).toBe(true);
      expect(result.ready).toEqual(cart);
      expect(result.flagged).toEqual([]);
      expect(canCheckOutDirectly(result, { pricesShown: true })).toBe(true);
    }
    // Two priced currencies still split, with a free item anywhere in the cart.
    const paidInr = item("c3", "ps-inr", { price: 999, currency: "INR" });
    const split = precheckSiteCart(
      [freeInr, paidAud, paidInr],
      [...store, mapping("ps-inr", { payment_plan: { actual_price: 999, currency: "INR" } })],
    );
    expect(split.ready).toEqual([freeInr, paidAud]);
    expect(split.flagged).toEqual([{ item: paidInr, issue: "otherCurrency" }]);
  });

  it("decides free or priced by the store's plan price, else by the price the cart showed", () => {
    const paidAud = item("c1", "ps-paid", { price: 499, currency: "AUD" });
    const aud = mapping("ps-paid", { payment_plan: { actual_price: 499, currency: "AUD" } });
    // Shown at a price, but the store's plan is free now: free.
    const nowFree = precheckSiteCart(
      [paidAud, item("c2", "ps-x", { price: 300, currency: "INR" })],
      [aud, mapping("ps-x", { payment_plan: { actual_price: 0, currency: "INR" } })],
    );
    expect(nowFree.flagged).toEqual([]);
    expect(nowFree.ready.map((i) => i.packageSessionId)).toEqual(["ps-paid", "ps-x"]);
    // Shown free, but the store's plan charges: priced, in its own currency.
    const nowPriced = precheckSiteCart(
      [paidAud, item("c2", "ps-x", { price: 0, currency: "INR" })],
      [aud, mapping("ps-x", { payment_plan: { actual_price: 300, currency: "INR" } })],
    );
    expect(nowPriced.flagged.map((f) => [f.item.packageSessionId, f.issue])).toEqual([["ps-x", "otherCurrency"]]);
    // No plan price: the cart's own price decides.
    const noPlan = [mapping("ps-paid", { payment_plan: null }), mapping("ps-x", { payment_plan: null })];
    expect(
      precheckSiteCart([paidAud, item("c2", "ps-x", { price: 0, currency: "INR" })], noPlan).flagged,
    ).toEqual([]);
    expect(precheckSiteCart([paidAud, item("c2", "ps-x", { currency: "INR" })], noPlan).flagged).toEqual([]);
    expect(
      precheckSiteCart([paidAud, item("c2", "ps-x", { price: 300, currency: "INR" })], noPlan).flagged.map(
        (f) => f.issue,
      ),
    ).toEqual(["otherCurrency"]);
  });

  it("reads the currency from the store's plan, else the cart line, and never flags an unknown one", () => {
    const result = precheckSiteCart(
      [item("c1", "a"), item("c2", "b", { currency: "USD" }), item("c3", "c"), item("c4", "d")],
      [
        mapping("a", { payment_plan: { actual_price: 100, currency: "INR" } }),
        mapping("b", { payment_plan: { actual_price: 100, currency: null } }),
        mapping("c", { payment_plan: null }),
        mapping("d", { payment_plan: { actual_price: 100, currency: " inr " } }),
      ],
    );
    expect(result.ready.map((i) => i.packageSessionId)).toEqual(["a", "c", "d"]);
    expect(result.flagged.map((f) => [f.item.packageSessionId, f.issue])).toEqual([["b", "otherCurrency"]]);
  });

  it("tells the price review apart from items that cannot be sold", () => {
    const result = precheckSiteCart(
      [item("c1", "a", { price: 100 }), item("c2", "missing")],
      [mapping("a", { payment_plan: { actual_price: 120, currency: "INR" } })],
    );
    const summary = reviewSummary(result);
    expect(summary.priceOnly).toBe(false);
    expect(summary.blocked.map((f) => f.issue)).toEqual(["notInStore"]);
  });

  it("prices the review's total at what checkout charges", () => {
    const changed = item("c1", "a", { price: 2500, elevatedPrice: 5000, currency: "INR" });
    const kept = item("c2", "b", { price: 100, currency: "INR" });
    const result = precheckSiteCart(
      [changed, kept],
      [mapping("a", { payment_plan: { actual_price: 4999, currency: "INR" } }), mapping("b")],
    );
    const atStore = readyAtStorePrices(result);
    expect(atStore[0]).toEqual({ ...changed, price: 4999, currency: "INR", elevatedPrice: undefined });
    expect(atStore[0]).not.toHaveProperty("elevatedPrice");
    expect(atStore[1]).toBe(kept);
  });

  it("refuses more than one order's worth of items", () => {
    const items = Array.from({ length: 3 }, (_, n) => item(`c${n}`, `s${n}`));
    const result = precheckSiteCart(items, items.map((i) => mapping(i.packageSessionId)), { max: 2 });
    expect(result.overLimit).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("treats a store page with no mappings as selling nothing", () => {
    const result = precheckSiteCart([item("c1", "a")], undefined);
    expect(result.ready).toEqual([]);
    expect(result.flagged[0]?.issue).toBe("notInStore");
  });
});

describe("activeMappingCounts", () => {
  it("counts each version's ACTIVE mappings (one sells as it is, two would charge it twice)", () => {
    const counts = activeMappingCounts([
      mapping("one"),
      mapping("twice"),
      mapping("twice"),
      mapping("gone", { status: "DELETED" }),
      mapping("revived", { status: "INACTIVE" }),
      mapping("revived"),
      { package_session_id: null, status: "ACTIVE" },
    ]);
    expect(Object.fromEntries(counts)).toEqual({ one: 1, twice: 2, revived: 1 });
    expect(activeMappingCounts(null).size).toBe(0);
  });
});

describe("readCatalogueTheme", () => {
  const host = {
    getAttribute: (name: string) =>
      ({ "data-catalogue-theme": "ocean", "data-catalogue-radius": "pill" } as Record<string, string>)[name] ?? null,
    classList: { contains: (token: string) => token === "dark" },
    style: {
      length: 2,
      item: (i: number) => ["--primary-500", "color"][i]!,
      getPropertyValue: (name: string) => (name === "--primary-500" ? " 210 80% 50% " : "red"),
    },
  };

  it("copies the wrapper's theme attributes and inline custom properties", () => {
    const snapshot = readCatalogueTheme({ closest: () => host });
    expect(snapshot).toEqual({
      attrs: { "data-catalogue-theme": "ocean", "data-catalogue-radius": "pill" },
      vars: { "--primary-500": "210 80% 50%" },
      dark: true,
    });
  });

  it("returns null outside a catalogue", () => {
    expect(readCatalogueTheme({ closest: () => null })).toBeNull();
    expect(readCatalogueTheme(null)).toBeNull();
  });
});

describe("nextDrawerTheme", () => {
  const ocean = { attrs: { "data-catalogue-theme": "ocean" }, vars: {}, dark: true };
  const forest = { attrs: { "data-catalogue-theme": "forest" }, vars: {}, dark: false };

  it("reads the theme when the drawer opens and KEEPS it while it closes", () => {
    let palette = ocean;
    const read = vi.fn(() => palette);
    const anchor = { id: "header-button" };

    const closed = nextDrawerTheme(CLOSED_DRAWER_THEME, false, anchor, read);
    expect(closed).toBe(CLOSED_DRAWER_THEME);
    expect(read).not.toHaveBeenCalled();

    const opened = nextDrawerTheme(closed, true, anchor, read);
    expect(opened.theme).toBe(ocean);
    // Re-rendering while open does not read again.
    expect(nextDrawerTheme(opened, true, anchor, read)).toBe(opened);
    expect(read).toHaveBeenCalledTimes(1);

    // Closing (the sheet's exit animation) still wears the palette.
    const closing = nextDrawerTheme(opened, false, anchor, read);
    expect(closing.theme).toBe(ocean);
    expect(closing.open).toBe(false);
    expect(nextDrawerTheme(closing, false, anchor, read)).toBe(closing);

    // A new visit reads afresh: the page's palette may have changed.
    palette = forest;
    expect(nextDrawerTheme(closing, true, anchor, read).theme).toBe(forest);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("re-reads when the anchor changes while open", () => {
    const read = vi.fn(() => ocean);
    const opened = nextDrawerTheme(CLOSED_DRAWER_THEME, true, { id: "a" }, read);
    nextDrawerTheme(opened, true, { id: "b" }, read);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
