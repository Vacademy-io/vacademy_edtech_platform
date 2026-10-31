import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE_LANGUAGES as LANGS } from "../../../-utils/course-variants";
import { storeSaleFrom } from "../../site-cart/store-sale";
import type { CatalogRowLike } from "./catalog-cards";
import {
  cardCartOffer,
  cartVersionOf,
  choosesLanguageOnly,
  inCartVersionText,
  isPurchasableRow,
  packageSessionOf,
  purchasableVersions,
  toSiteCartItem,
  versionChoiceLabel,
} from "./catalog-site-cart";

const row = (over: Partial<CatalogRowLike> & Record<string, unknown>): CatalogRowLike & Record<string, unknown> => ({
  id: "c1",
  title: "Yoga",
  description: "",
  price: 999,
  level: "Hindi",
  level_name: "Hindi",
  rating: 0,
  instructor: "",
  packageSessionId: "ps-hi",
  ...over,
});

describe("purchasable versions", () => {
  it("needs a package session, a price, an open window and no coming-soon", () => {
    expect(isPurchasableRow(row({}))).toBe(true);
    expect(isPurchasableRow(row({ packageSessionId: undefined, package_session_id: "ps-x" }))).toBe(true);
    expect(isPurchasableRow(row({ packageSessionId: undefined }))).toBe(false);
    expect(isPurchasableRow(row({ price: 0 }))).toBe(false);
    expect(isPurchasableRow(row({ enroll_invite_availability: "EXPIRED" }))).toBe(false);
    expect(isPurchasableRow(row({ coming_soon: { enabled: true } }))).toBe(false);
    expect(purchasableVersions([row({}), row({ price: 0, packageSessionId: "free" })]).map(packageSessionOf)).toEqual([
      "ps-hi",
    ]);
  });
});

describe("cardCartOffer", () => {
  const store = (...mapped: string[]) =>
    storeSaleFrom(true, { data: { mappings: mapped.map((id) => ({ package_session_id: id, status: "ACTIVE" })) }, isError: false });
  const en = row({ packageSessionId: "ps-en", level: "English", level_name: "English" });
  const hi = row({ packageSessionId: "ps-hi" });

  it("offers the cart only the versions the store sells as they are", () => {
    expect(cardCartOffer([en, hi], store("ps-en", "ps-hi"))).toEqual({
      route: "cart",
      versions: [en, hi],
      purchasable: [en, hi],
    });
    // The store sells English only: Hindi keeps the course page's own enrol flow.
    expect(cardCartOffer([en, hi], store("ps-en"))).toMatchObject({ route: "cart", versions: [en] });
    // Listed twice would charge it twice: not the cart's.
    expect(cardCartOffer([en, hi], store("ps-en", "ps-hi", "ps-hi"))).toMatchObject({ route: "cart", versions: [en] });
  });

  it("keeps every purchasable version of the card beside the ones the store sells", () => {
    // The card's chips and "from" price speak for both versions, so the chooser asks — and names
    // the version — against both, even when the store sells one.
    expect(cardCartOffer([en, hi], store("ps-en"))).toEqual({ route: "cart", versions: [en], purchasable: [en, hi] });
    expect(cardCartOffer([en, hi], store("ps-hi"))).toEqual({ route: "cart", versions: [hi], purchasable: [en, hi] });
    expect(cardCartOffer([en], store("ps-en"))).toEqual({ route: "cart", versions: [en], purchasable: [en] });
  });

  it("keeps the card's own CTA when the store sells none of its versions, or cannot be read", () => {
    expect(cardCartOffer([en, hi], store("another-course"))).toEqual({ route: "page" });
    expect(cardCartOffer([en], storeSaleFrom(true, { data: undefined, isError: true }))).toEqual({ route: "page" });
    expect(cardCartOffer([en], storeSaleFrom(false, { data: undefined, isError: false }))).toEqual({ route: "page" });
  });

  it("offers nothing while the store page loads — unless the card has nothing to sell", () => {
    const loading = storeSaleFrom(true, { data: undefined, isError: false });
    expect(cardCartOffer([en, hi], loading)).toEqual({ route: "pending" });
    // Free or closed versions never wait for the store: they go to the course page.
    expect(cardCartOffer([row({ price: 0 }), row({ enroll_invite_availability: "EXPIRED" })], loading)).toEqual({
      route: "page",
    });
    expect(cardCartOffer([], loading)).toEqual({ route: "page" });
  });

  it("puts only versions that can be bought now in the cart, whatever the store lists", () => {
    const free = row({ packageSessionId: "ps-free", price: 0 });
    // The free version enrols on the course page: the paid one is the card's only cart version.
    expect(cardCartOffer([free, en], store("ps-free", "ps-en"))).toEqual({ route: "cart", versions: [en], purchasable: [en] });
  });
});

describe("toSiteCartItem", () => {
  it("builds a cart line in the base language with the version's language", () => {
    expect(
      toSiteCartItem(
        row({ elevatedPrice: 1499, currency: "INR", thumbnail: "media-1", enrollInviteId: "inv-1" }),
        "c1",
        LANGS,
      ),
    ).toEqual({
      packageSessionId: "ps-hi",
      courseId: "c1",
      title: "Yoga",
      levelName: "Hindi",
      languageCode: "hi",
      price: 999,
      elevatedPrice: 1499,
      currency: "INR",
      image: "media-1",
      enrollInviteId: "inv-1",
      source: { kind: "catalog" },
    });
  });

  it("leaves out placeholders and unknown languages", () => {
    const item = toSiteCartItem(row({ level_name: "Beginner", level: "Beginner", thumbnail: "/api/placeholder/300/200" }), "c1", LANGS);
    expect(item.languageCode).toBeUndefined();
    expect(item.image).toBeUndefined();
  });

  it("finds the version of a course that is already in the cart", () => {
    const versions = [row({ packageSessionId: "ps-en" }), row({ packageSessionId: "ps-hi" })];
    expect(cartVersionOf(versions, new Set(["ps-hi", "other"]))?.packageSessionId).toBe("ps-hi");
    expect(cartVersionOf(versions, new Set())).toBeUndefined();
  });
});

describe("telling a card's versions apart", () => {
  const same = (s: string) => s;
  const version = (ps: string, level: string, price: number) =>
    row({ packageSessionId: ps, level, level_name: level, price });
  // The spec's naming: two levels, each in two languages.
  const beginnerHi = version("b-hi", "Beginner Hindi", 499);
  const advancedHi = version("a-hi", "Advanced Hindi", 999);
  const beginnerEn = version("b-en", "Beginner English", 499);
  const advancedEn = version("a-en", "Advanced English", 999);
  const fourLevels = [beginnerHi, advancedHi, beginnerEn, advancedEn];

  it("names versions by language while every language appears once", () => {
    const languagesOnly = [version("hi", "Hindi", 499), version("en", "English", 499)];
    expect(languagesOnly.map((v) => versionChoiceLabel(v, languagesOnly, LANGS, same))).toEqual(["Hindi", "English"]);
    expect(choosesLanguageOnly(languagesOnly, LANGS)).toBe(true);
  });

  it("names two levels in one language by their level (the chip says the language)", () => {
    expect(fourLevels.map((v) => versionChoiceLabel(v, fourLevels, LANGS, same))).toEqual([
      "Beginner",
      "Advanced",
      "Beginner",
      "Advanced",
    ]);
    expect(choosesLanguageOnly(fourLevels, LANGS)).toBe(false);
    // Only the language that is shared needs its level.
    const mixed = [beginnerHi, advancedHi, version("en", "English", 499)];
    expect(mixed.map((v) => versionChoiceLabel(v, mixed, LANGS, same))).toEqual(["Beginner", "Advanced", "English"]);
  });

  it("keeps the whole level name for a language without a chip, and the level for a version without a language", () => {
    const noChip = [{ code: "ta", label: "Tamil", match: ["tamil"] }];
    const tamil = [version("t1", "Beginner Tamil", 1), version("t2", "Advanced Tamil", 2)];
    expect(tamil.map((v) => versionChoiceLabel(v, tamil, noChip, same))).toEqual(["Beginner Tamil", "Advanced Tamil"]);
    const unlabelled = [version("l1", "Level 1", 1), version("l2", "Level 2", 2)];
    expect(unlabelled.map((v) => versionChoiceLabel(v, unlabelled, LANGS, same))).toEqual(["Level 1", "Level 2"]);
    expect(choosesLanguageOnly(unlabelled, LANGS)).toBe(false);
  });

  it("shows the visitor's language: translated, then the language word taken out", () => {
    const hindi: Record<string, string> = { "Advanced Hindi": "उन्नत हिंदी", Hindi: "हिंदी" };
    const translate = (s: string) => hindi[s] ?? s;
    expect(versionChoiceLabel(advancedHi, fourLevels, LANGS, translate)).toBe("उन्नत");
    const languagesOnly = [version("hi", "Hindi", 499), version("en", "English", 499)];
    expect(versionChoiceLabel(languagesOnly[0]!, languagesOnly, LANGS, translate)).toBe("हिंदी");
  });

  it("says which version is in the cart: the chip, with the level when it says more", () => {
    expect(inCartVersionText(version("hi", "Hindi", 499), LANGS, same)).toBe("हिं");
    expect(inCartVersionText(advancedHi, LANGS, same)).toBe("Advanced · हिं");
    expect(inCartVersionText(beginnerEn, LANGS, same)).toBe("Beginner · EN");
    expect(inCartVersionText(version("l2", "Level 2", 2), LANGS, same)).toBe("Level 2");
    expect(inCartVersionText(version("x", "default", 2), LANGS, same)).toBe("");
  });
});
