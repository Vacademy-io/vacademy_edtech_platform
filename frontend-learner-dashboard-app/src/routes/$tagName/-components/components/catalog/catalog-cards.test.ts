import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE_LANGUAGES as LANGS } from "../../../-utils/course-variants";
import {
  buildCatalogCards,
  cardPriceView,
  courseTagsOf,
  isBuyableNowRow,
  isComingSoonRow,
  isPureLanguageLevel,
  priceSummaryOf,
  rowLanguage,
  type CatalogRowLike,
} from "./catalog-cards";

const row = (over: Partial<CatalogRowLike> & Record<string, unknown>): CatalogRowLike & Record<string, unknown> => ({
  id: "c1",
  title: "Yoga",
  description: "Learn yoga",
  price: 0,
  level: "Beginner",
  rating: 0,
  instructor: "Asha",
  ...over,
});

const ROWS = [
  row({ id: "c1", packageSessionId: "c1-en", level: "English", level_name: "English", price: 1200, comma_separeted_tags: "shiksha, yoga" }),
  row({ id: "c2", packageSessionId: "c2-hi", level: "Hindi", level_name: "Hindi", price: 500, comma_separeted_tags: "kala" }),
  row({ id: "c1", packageSessionId: "c1-hi", level: "Hindi", level_name: "Hindi", price: 800, comma_separeted_tags: "Yoga,  hindi-medium" }),
  row({ id: "c3", packageSessionId: "c3-x", level: "Beginner", level_name: null, price: 300 }),
];

describe("buildCatalogCards", () => {
  it("keeps one card per row, in order, when grouping is off (the original grid)", () => {
    const cards = buildCatalogCards(ROWS, { grouping: false, languages: LANGS });
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.primary)).toEqual(ROWS);
    expect(cards.every((c) => c.rows.length === 1 && c.languages.length === 0)).toBe(true);
    expect(cards.map((c) => c.sortPrice)).toEqual([1200, 500, 800, 300]);
  });

  it("folds a course's versions into one card where its first row sat", () => {
    const cards = buildCatalogCards(ROWS, { grouping: true, languages: LANGS });
    expect(cards.map((c) => c.courseId)).toEqual(["c1", "c2", "c3"]);
    const c1 = cards[0];
    expect(c1.rows.map((r) => r.packageSessionId)).toEqual(["c1-en", "c1-hi"]);
    expect(c1.languages.map((l) => l.chip)).toEqual(["EN", "हिं"]);
    expect(c1.primary.packageSessionId).toBe("c1-en");
    expect([...c1.tagSet].sort()).toEqual(["hindi-medium", "level:english", "level:hindi", "shiksha", "yoga"]);
  });

  it("computes the 'from' price across versions", () => {
    const [c1, c2] = buildCatalogCards(ROWS, { grouping: true, languages: LANGS });
    expect(c1).toMatchObject({ minPrice: 800, maxPrice: 1200, priceVaries: true, sortPrice: 800 });
    expect(c2).toMatchObject({ minPrice: 500, maxPrice: 500, priceVaries: false });
  });

  it("opens the preferred language's version when the course has one", () => {
    const cards = buildCatalogCards(ROWS, { grouping: true, languages: LANGS, preferredLanguage: "hi" });
    expect(cards[0].primary.packageSessionId).toBe("c1-hi");
    expect(cards[2].primary.packageSessionId).toBe("c3-x");
  });

  it("leaves coming-soon versions out of the price summary", () => {
    const soon = { enabled: true, launch_date: "2099-01-01" };
    const [card] = buildCatalogCards(
      [row({ id: "c9", price: 0, coming_soon: soon }), row({ id: "c9", price: 0, coming_soon: soon, packageSessionId: "b" })],
      { grouping: true, languages: LANGS },
    );
    expect(card).toMatchObject({ minPrice: null, maxPrice: null, priceVaries: false, sortPrice: 0 });
  });

  it("leaves closed and not-yet-open versions out of the price summary and the price sort", () => {
    // Hindi ₹500 with enrolment closed, English ₹1000 open: no "from ₹500".
    const [card] = buildCatalogCards(
      [
        row({ id: "c5", packageSessionId: "hi", level: "Hindi", level_name: "Hindi", price: 500, enroll_invite_availability: "EXPIRED" }),
        row({ id: "c5", packageSessionId: "en", level: "English", level_name: "English", price: 1000 }),
        row({ id: "c5", packageSessionId: "x", level: "Beginner", price: 50, enroll_invite_availability: "NOT_STARTED" }),
      ],
      { grouping: true, languages: LANGS },
    );
    expect(card).toMatchObject({ minPrice: 1000, maxPrice: 1000, priceVaries: false, sortPrice: 1000 });
  });

  it("sorts a single row by its own price whatever its state (the original grid)", () => {
    const cards = buildCatalogCards(
      [row({ id: "a", price: 700, enroll_invite_availability: "INACTIVE" }), row({ id: "b", price: 0, coming_soon: { enabled: true } })],
      { grouping: false, languages: LANGS },
    );
    expect(cards.map((c) => c.sortPrice)).toEqual([700, 0]);
  });
});

describe("prices that can be paid now", () => {
  it("knows which versions can be bought now (missing availability = open)", () => {
    expect(isBuyableNowRow({})).toBe(true);
    expect(isBuyableNowRow({ enroll_invite_availability: "AVAILABLE" })).toBe(true);
    expect(isBuyableNowRow({ enroll_invite_availability: "EXPIRED" })).toBe(false);
    expect(isBuyableNowRow({ enroll_invite_availability: "NOT_STARTED" })).toBe(false);
    expect(isBuyableNowRow({ coming_soon: { enabled: true } })).toBe(false);
  });

  it("summarises only those versions", () => {
    expect(priceSummaryOf([row({ price: 0 }), row({ price: 900 })])).toEqual({ minPrice: 0, maxPrice: 900, priceVaries: true });
    expect(priceSummaryOf([row({ price: 0, enroll_invite_availability: "EXPIRED" }), row({ price: 900 })])).toEqual({
      minPrice: 900,
      maxPrice: 900,
      priceVaries: false,
    });
    expect(priceSummaryOf([])).toEqual({ minPrice: null, maxPrice: null, priceVaries: false });
  });
});

describe("cardPriceView (what a merged card's price shows)", () => {
  const hiFree = row({ id: "m", packageSessionId: "hi", level: "Hindi", level_name: "Hindi", price: 0 });
  const enPaid = row({ id: "m", packageSessionId: "en", level: "English", level_name: "English", price: 1000, elevatedPrice: 1500 });
  const enCheap = row({ id: "m", packageSessionId: "en2", level: "English 2", level_name: "English 2", price: 1000 });
  const closed = row({ id: "m", packageSessionId: "old", price: 200, enroll_invite_availability: "EXPIRED" });

  it("says 'from' the cheapest when the versions on offer differ (Free included)", () => {
    expect(cardPriceView({ primary: enPaid }, [hiFree, enPaid])).toEqual({ row: hiFree, minPrice: 0, from: true });
  });

  it("follows the active filters: a 'Paid' filter shows the paid version's price, not Free", () => {
    expect(cardPriceView({ primary: hiFree }, [enPaid])).toEqual({ row: enPaid, minPrice: 1000, from: false });
  });

  it("ignores versions that cannot be bought now", () => {
    expect(cardPriceView({ primary: closed }, [closed, enPaid])).toEqual({ row: enPaid, minPrice: 1000, from: false });
    expect(cardPriceView({ primary: closed }, [closed])).toBeNull();
  });

  it("prefers the card's own version among equally cheap ones", () => {
    expect(cardPriceView({ primary: enCheap }, [enPaid, enCheap])?.row).toBe(enCheap);
    expect(cardPriceView({ primary: hiFree }, [enPaid, enCheap])?.row).toBe(enPaid);
  });
});

describe("row helpers", () => {
  it("reads course tags from the v2 field and an array", () => {
    expect(courseTagsOf({ comma_separeted_tags: " a, ,b " })).toEqual(["a", "b"]);
    expect(courseTagsOf({ comma_separeted_tags: null, tags: ["x", 3, " y "] })).toEqual(["x", "y"]);
  });

  it("spots pure-language levels only", () => {
    expect(isPureLanguageLevel("Hindi", LANGS)).toBe(true);
    expect(isPureLanguageLevel(" english ", LANGS)).toBe(true);
    expect(isPureLanguageLevel("हिन्दी", LANGS)).toBe(true);
    expect(isPureLanguageLevel("Beginner Hindi", LANGS)).toBe(false);
    expect(isPureLanguageLevel("Hindi - Batch 2", LANGS)).toBe(false);
    expect(isPureLanguageLevel("Engineering", LANGS)).toBe(false);
    expect(isPureLanguageLevel(null, LANGS)).toBe(false);
  });

  it("reads a row's language from its level name", () => {
    expect(rowLanguage({ level_name: "Advanced Hindi" }, LANGS)?.code).toBe("hi");
    expect(rowLanguage({ level_name: null, level: "Beginner" }, LANGS)).toBeNull();
  });

  it("remembers a row's language per language list", () => {
    const r = { level_name: "Hindi" };
    expect(rowLanguage(r, LANGS)?.code).toBe("hi");
    expect(rowLanguage(r, LANGS)?.code).toBe("hi");
    const none = { level_name: "Beginner" };
    expect(rowLanguage(none, LANGS)).toBeNull();
    expect(rowLanguage(none, LANGS)).toBeNull();
    // Another language list is its own lookup.
    expect(rowLanguage(r, [{ code: "x", label: "Other", match: ["hindi"] }])?.code).toBe("x");
  });

  it("recognises coming-soon rows", () => {
    expect(isComingSoonRow({ coming_soon: { enabled: true } })).toBe(true);
    expect(isComingSoonRow({ coming_soon: null })).toBe(false);
  });
});

describe("language from a course tag (levels that are formats, language versions as separate courses)", () => {
  const ebookHindi = row({ id: "p-hi", packageSessionId: "ps-hi", level: "eBook", level_name: "eBook", comma_separeted_tags: "shiksha, Hindi" });
  const filmEnglish = row({ id: "p-en", packageSessionId: "ps-en", level: "Short Film", level_name: "Short Film", comma_separeted_tags: "English" });
  const untagged = row({ id: "p-x", packageSessionId: "ps-x", level: "default", level_name: "default", comma_separeted_tags: "English literature" });

  it("takes the language from a tag that is exactly a language when the level names none", () => {
    expect(rowLanguage(ebookHindi, LANGS)?.code).toBe("hi");
    expect(rowLanguage(filmEnglish, LANGS)?.code).toBe("en");
  });

  it("never reads a language out of a longer tag", () => {
    expect(rowLanguage(untagged, LANGS)).toBeNull();
  });

  it("lets the level name win over a tag", () => {
    const r = row({ id: "p-l", packageSessionId: "ps-l", level: "Hindi", level_name: "Hindi", comma_separeted_tags: "English" });
    expect(rowLanguage(r, LANGS)?.code).toBe("hi");
  });

  it("gives grouped cards their language chip from the tag", () => {
    const cards = buildCatalogCards([ebookHindi, filmEnglish, untagged], { grouping: true, languages: LANGS });
    expect(cards.map((c) => c.languages.map((l) => l.code))).toEqual([["hi"], ["en"], []]);
  });
});
