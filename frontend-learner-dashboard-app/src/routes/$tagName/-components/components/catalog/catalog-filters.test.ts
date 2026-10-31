import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE_LANGUAGES as LANGS } from "../../../-utils/course-variants";
import type { CourseBadge } from "../../../-utils/course-badges";
import { buildCatalogCards, type CatalogRowLike } from "./catalog-cards";
import {
  EMPTY_CRITERIA,
  applyFacetGroups,
  buildAppliedChips,
  buildFacetGroups,
  categoryOptions,
  countFacetOptions,
  GROUP_IDS,
  instructorOptions,
  languageOptions,
  levelOptions,
  presentLanguageCodes,
  priceOptions,
  rowInPriceRange,
  rowMatchesLevels,
  rowMatchesPrice,
  rowMatchesSearch,
  rowsMatchingGroups,
  sessionOptions,
  tagOptions,
  type CatalogCriteria,
  type CriteriaContext,
} from "./catalog-filters";
import type { CatalogCategory, CatalogStream } from "./catalog-streams";

const row = (over: Partial<CatalogRowLike> & Record<string, unknown>): CatalogRowLike & Record<string, unknown> => ({
  id: "c",
  title: "Course",
  description: "",
  price: 0,
  level: "Beginner",
  rating: 0,
  instructor: "Asha",
  ...over,
});

const SOON = { enabled: true };

// c1: EN ₹1200 + HI ₹800 (shiksha/vedic); c2: HI ₹0 (shiksha/sanskrit); c3: EN ₹500 (kala); c4: coming soon (kala)
const ROWS = [
  row({ id: "c1", title: "Vedic Maths", level: "English", level_name: "English", price: 1200, comma_separeted_tags: "shiksha,vedic-maths", sessionId: "s1", instructor: "Ravi" }),
  row({ id: "c2", title: "Sanskrit Basics", level: "Hindi", level_name: "Hindi", price: 0, comma_separeted_tags: "sanskrit", sessionId: "s1" }),
  row({ id: "c1", title: "Vedic Maths", level: "Hindi", level_name: "Hindi", price: 800, comma_separeted_tags: "shiksha,vedic-maths", sessionId: "s2", instructor: "Ravi" }),
  row({ id: "c3", title: "Music", level: "Beginner English", level_name: "Beginner English", price: 500, comma_separeted_tags: "kala", sessionId: "s2" }),
  row({ id: "c4", title: "Dance", level: "Beginner", level_name: "Beginner", price: 0, comma_separeted_tags: "kala", coming_soon: SOON }),
];

const cat = (slug: string, tags: string[]): CatalogCategory => ({ id: slug, slug, title: slug, subtitle: "", tags, comingSoon: false, audienceId: null });
const VEDIC = cat("vedic-maths", ["vedic-maths"]);
const SANSKRIT = cat("sanskrit", ["sanskrit"]);
const SHIKSHA: CatalogStream = {
  id: "shiksha", slug: "shiksha", title: "Shiksha", subtitle: "", tag: "shiksha",
  tags: ["shiksha", "vedic-maths", "sanskrit"], comingSoon: false, audienceId: null, categories: [VEDIC, SANSKRIT],
};

const ctx = (earned: Record<string, CourseBadge[]> = {}, translate = (s: string) => s): CriteriaContext => ({
  languages: LANGS,
  earnedBadges: new Map(Object.entries(earned)),
  translate,
});

const criteria = (over: Partial<CatalogCriteria>): CatalogCriteria => ({ ...EMPTY_CRITERIA, ...over });

const grouped = buildCatalogCards(ROWS, { grouping: true, languages: LANGS });
const flat = buildCatalogCards(ROWS, { grouping: false, languages: LANGS });

const ids = (cards: { courseId: string }[]) => cards.map((c) => c.courseId);
const run = (c: Partial<CatalogCriteria>, cards = grouped, context = ctx()) =>
  applyFacetGroups(cards, buildFacetGroups(criteria(c), context));

describe("filtering", () => {
  it("shows everything with no active filter", () => {
    expect(ids(run({}))).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("matches a stream by its own tag or any category tag below it", () => {
    expect(ids(run({ stream: SHIKSHA }))).toEqual(["c1", "c2"]);
  });

  it("ORs within a group and ANDs across groups", () => {
    expect(ids(run({ stream: SHIKSHA, categories: [VEDIC, SANSKRIT] }))).toEqual(["c1", "c2"]);
    expect(ids(run({ languages: ["hi"] }))).toEqual(["c1", "c2"]);
    expect(ids(run({ languages: ["hi"], price: { kind: "free" } }))).toEqual(["c2"]);
    expect(ids(run({ languages: ["en", "hi"], price: { kind: "paid" } }))).toEqual(["c1", "c3"]);
  });

  it("matches a grouped card when ANY version matches", () => {
    expect(ids(run({ price: { kind: "max", max: 1000 } }))).toEqual(["c1", "c2", "c3"]);
    expect(ids(run({ levels: ["English"] }))).toEqual(["c1"]);
    expect(ids(run({ sessions: ["s2"] }))).toEqual(["c1", "c3"]);
  });

  it("needs ONE version to pass every row filter (Hindi and Paid = a paid Hindi version)", () => {
    const mixed = buildCatalogCards(
      [
        row({ id: "m", packageSessionId: "m-hi", level: "Hindi", level_name: "Hindi", price: 0 }),
        row({ id: "m", packageSessionId: "m-en", level: "English", level_name: "English", price: 900 }),
      ],
      { grouping: true, languages: LANGS },
    );
    expect(ids(run({ languages: ["hi"], price: { kind: "paid" } }, mixed))).toEqual([]);
    expect(ids(run({ languages: ["en"], price: { kind: "paid" } }, mixed))).toEqual(["m"]);
    expect(ids(run({ languages: ["hi"], price: { kind: "free" } }, mixed))).toEqual(["m"]);
    const groups = buildFacetGroups(criteria({ languages: ["hi"] }), ctx());
    const prices = priceOptions([
      { value: "free", choice: { kind: "free" } },
      { value: "paid", choice: { kind: "paid" } },
    ]);
    expect(countFacetOptions(mixed, groups, GROUP_IDS.price, prices)).toEqual({ free: 1, paid: 0 });
  });

  it("filters rows individually when grouping is off", () => {
    const out = run({ languages: ["hi"] }, flat);
    expect(out.map((c) => c.primary.level)).toEqual(["Hindi", "Hindi"]);
    expect(out).toHaveLength(2);
  });

  it("keeps coming-soon courses out of every price choice", () => {
    expect(ids(run({ price: { kind: "free" } }))).toEqual(["c2"]);
  });

  it("filters by earned badge", () => {
    const context = ctx({ c3: ["new"], c1: ["bestseller", "new"] });
    expect(ids(run({ badges: ["bestseller"] }, grouped, context))).toEqual(["c1"]);
    expect(ids(run({ badges: ["new", "free"] }, grouped, context))).toEqual(["c1", "c3"]);
  });

  it("searches base and translated text", () => {
    const translate = (s: string) => (s === "Music" ? "संगीत" : s);
    expect(ids(run({ search: "music" }))).toEqual(["c3"]);
    expect(ids(run({ search: "संगीत" }, grouped, ctx({}, translate)))).toEqual(["c3"]);
    expect(ids(run({ search: "संगीत" }))).toEqual([]);
  });

  it("applies the price range only while its filter is shown", () => {
    expect(ids(run({ priceRange: { min: 600 }, priceRangeOn: false }))).toEqual(["c1", "c2", "c3", "c4"]);
    expect(ids(run({ priceRange: { min: 600 }, priceRangeOn: true }))).toEqual(["c1"]);
  });
});

describe("facet counts", () => {
  it("counts each option given every OTHER active group", () => {
    const c = criteria({ stream: SHIKSHA, languages: ["hi"] });
    const groups = buildFacetGroups(c, ctx());
    // Language counts ignore the language selection itself, but respect the stream.
    expect(countFacetOptions(grouped, groups, GROUP_IDS.language, languageOptions(["en", "hi"], LANGS))).toEqual({
      en: 1,
      hi: 2,
    });
    // Price counts respect stream AND language.
    const prices = priceOptions([
      { value: "free", choice: { kind: "free" } },
      { value: "paid", choice: { kind: "paid" } },
      { value: "max:1000", choice: { kind: "max", max: 1000 } },
    ]);
    expect(countFacetOptions(grouped, groups, GROUP_IDS.price, prices)).toEqual({ free: 1, paid: 1, "max:1000": 2 });
    // Category counts, inside the stream.
    expect(countFacetOptions(grouped, groups, GROUP_IDS.category, categoryOptions([VEDIC, SANSKRIT]))).toEqual({
      "vedic-maths": 1,
      sanskrit: 1,
    });
  });

  it("counts legacy groups too", () => {
    const groups = buildFacetGroups(criteria({ price: { kind: "paid" } }), ctx());
    expect(countFacetOptions(grouped, groups, GROUP_IDS.level, levelOptions(["English", "Hindi", "Beginner"]))).toEqual({
      English: 1,
      Hindi: 1,
      Beginner: 0,
    });
    expect(countFacetOptions(grouped, groups, GROUP_IDS.session, sessionOptions(["s1", "s2"]))).toEqual({ s1: 1, s2: 2 });
    expect(countFacetOptions(grouped, groups, GROUP_IDS.tags, tagOptions(["kala", "Kala"]))).toEqual({ kala: 1, Kala: 0 });
    expect(countFacetOptions(grouped, groups, GROUP_IDS.instructor, instructorOptions(["Ravi", "Asha"]))).toEqual({
      Ravi: 1,
      Asha: 1,
    });
  });

  it("lists only the languages the catalogue has", () => {
    expect(presentLanguageCodes(ROWS, LANGS)).toEqual(["en", "hi"]);
    expect(presentLanguageCodes([row({ level_name: "Beginner" })], LANGS)).toEqual([]);
  });

  it("runs each group's test once per card or row, however many options are counted", () => {
    let translations = 0;
    const translate = (s: string) => {
      translations += 1;
      return s;
    };
    // A search that matches nothing, so every row's title and description are translated.
    const groups = buildFacetGroups(criteria({ search: "zzz", languages: ["hi"] }), ctx({}, translate));
    applyFacetGroups(grouped, groups);
    const afterGrid = translations;
    expect(afterGrid).toBe(ROWS.length * 2);
    countFacetOptions(grouped, groups, GROUP_IDS.language, languageOptions(["en", "hi"], LANGS));
    countFacetOptions(
      grouped,
      groups,
      GROUP_IDS.price,
      priceOptions([
        { value: "free", choice: { kind: "free" } },
        { value: "paid", choice: { kind: "paid" } },
      ]),
    );
    countFacetOptions(grouped, groups, GROUP_IDS.level, levelOptions(["English", "Hindi", "Beginner"]));
    expect(translations).toBe(afterGrid);
  });
});

describe("rowsMatchingGroups", () => {
  const c1 = grouped[0]; // EN ₹1200 + HI ₹800

  it("returns every version when no version filter is active", () => {
    expect(rowsMatchingGroups(c1, buildFacetGroups(criteria({ stream: SHIKSHA }), ctx()))).toBe(c1.rows);
  });

  it("returns the versions passing every active version filter", () => {
    const hindi = rowsMatchingGroups(c1, buildFacetGroups(criteria({ languages: ["hi"] }), ctx()));
    expect(hindi.map((r) => r.price)).toEqual([800]);
    const paidUnder1000 = rowsMatchingGroups(c1, buildFacetGroups(criteria({ price: { kind: "max", max: 1000 }, levels: ["English"] }), ctx()));
    expect(paidUnder1000).toEqual([]);
  });
});

describe("legacy row tests", () => {
  it("keeps the original Level + Buy/Rent behaviour", () => {
    expect(rowMatchesLevels(row({ level: "Class 6" }), ["Class 6"])).toBe(true);
    expect(rowMatchesLevels(row({ level: "Class 6" }), ["class 6"])).toBe(false);
    expect(rowMatchesLevels(row({ level: "Beginner", type: "Rent" }), ["Rent"])).toBe(true);
    expect(rowMatchesLevels(row({ level: "Beginner", extra: "BUY" }), ["buy"])).toBe(true);
    expect(rowMatchesLevels(row({}), [])).toBe(true);
  });

  it("price helpers", () => {
    expect(rowMatchesPrice(row({ price: 1000 }), { kind: "max", max: 1000 })).toBe(true);
    expect(rowMatchesPrice(row({ price: 0, coming_soon: SOON }), { kind: "free" })).toBe(false);
    expect(rowInPriceRange(row({ price: 50 }), { max: 40 })).toBe(false);
    expect(rowMatchesSearch(row({ title: "Yoga" }), "YOG", (s) => s)).toBe(true);
  });
});

describe("buildAppliedChips", () => {
  it("lists one removable chip per applied value", () => {
    const chips = buildAppliedChips(
      criteria({
        categories: [VEDIC],
        languages: ["hi"],
        price: { kind: "max", max: 1000 },
        badges: ["new"],
        levels: ["Class 6"],
        tags: ["kala"],
        priceRange: { min: 10 },
        priceRangeOn: true,
        search: "  yoga ",
      }),
      {
        category: (s) => `cat:${s}`,
        language: (c) => `lang:${c}`,
        price: (p) => `price:${p.kind}`,
        badge: (b) => `badge:${b}`,
        level: (l) => `level:${l}`,
        session: (s) => s,
        instructor: (i) => i,
        priceRange: () => "range",
        search: (t) => `"${t}"`,
      },
    );
    expect(chips.map((c) => [c.group, c.value, c.label])).toEqual([
      ["category", "vedic-maths", "cat:vedic-maths"],
      ["language", "hi", "lang:hi"],
      ["price", "max:1000", "price:max"],
      ["badge", "new", "badge:new"],
      ["level", "Class 6", "level:Class 6"],
      ["tags", "kala", "kala"],
      ["priceRange", "range", "range"],
      ["search", "  yoga ", '"yoga"'],
    ]);
  });

  it("is empty with nothing applied", () => {
    expect(buildAppliedChips(EMPTY_CRITERIA, {} as never)).toEqual([]);
  });
});
