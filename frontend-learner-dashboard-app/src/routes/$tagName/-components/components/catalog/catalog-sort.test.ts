import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { COURSE_CATALOG_SORT_OPTIONS } from "../../../-types/course-catalogue-types";
import { DEFAULT_COURSE_LANGUAGES as LANGS } from "../../../-utils/course-variants";
import { buildCatalogCards, type CatalogRowLike } from "./catalog-cards";
import { createdTime, sortCatalogCards, sortOptionLabel, withCreatedAt } from "./catalog-sort";

const row = (over: Partial<CatalogRowLike>): CatalogRowLike => ({
  id: "c",
  title: "Course",
  description: "",
  price: 0,
  level: "Beginner",
  rating: 0,
  instructor: "",
  ...over,
});

const ROWS = [
  row({ id: "a", title: "Banana", price: 300, rating: 4, createdAt: "2026-05-01T00:00:00Z" }),
  row({ id: "b", title: "apple", price: 100, rating: 5, createdAt: "2026-09-01T00:00:00Z" }),
  row({ id: "c", title: "Cherry", price: 200, rating: 3 }),
  row({ id: "d", title: "Date", price: 100, rating: 5, createdAt: "garbage" }),
];
const cards = buildCatalogCards(ROWS, { grouping: false, languages: LANGS });
const ids = (list: { courseId: string }[]) => list.map((c) => c.courseId);
const base = { ranks: new Map<string, number>(), titleOf: (c: (typeof cards)[number]) => c.primary.title };

describe("sortCatalogCards", () => {
  it("sorts by created_at, newest or oldest first (missing dates last / first)", () => {
    expect(ids(sortCatalogCards(cards, "Newest", base))).toEqual(["b", "a", "c", "d"]);
    expect(ids(sortCatalogCards(cards, "Oldest", base))).toEqual(["c", "d", "a", "b"]);
  });

  it("keeps catalogue order when no course has a date (the API before created_at)", () => {
    const undated = buildCatalogCards(ROWS.map((r) => ({ ...r, createdAt: undefined })), { grouping: false, languages: LANGS });
    expect(ids(sortCatalogCards(undated, "Newest", base))).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts by price, stable on ties", () => {
    expect(ids(sortCatalogCards(cards, "Price: Low to High", base))).toEqual(["b", "d", "c", "a"]);
    expect(ids(sortCatalogCards(cards, "Price: High to Low", base))).toEqual(["a", "c", "b", "d"]);
  });

  it("sorts by rating and by name (the displayed title)", () => {
    expect(ids(sortCatalogCards(cards, "Rating", base))).toEqual(["b", "d", "a", "c"]);
    expect(ids(sortCatalogCards(cards, "Name A-Z", base))).toEqual(["b", "a", "c", "d"]);
    expect(ids(sortCatalogCards(cards, "Name Z-A", base))).toEqual(["d", "c", "a", "b"]);
    const translated = { ...base, titleOf: (c: (typeof cards)[number]) => (c.courseId === "d" ? "Aardvark" : c.primary.title) };
    expect(ids(sortCatalogCards(cards, "Name A-Z", translated))[0]).toBe("d");
  });

  it("sorts Popular by rank, unranked courses after in their current order", () => {
    const ranks = new Map([
      ["c", 1],
      ["a", 2],
    ]);
    expect(ids(sortCatalogCards(cards, "Popular", { ...base, ranks }))).toEqual(["c", "a", "b", "d"]);
    expect(ids(sortCatalogCards(cards, "Popular", base))).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts grouped cards by their lowest version price", () => {
    const grouped = buildCatalogCards(
      [row({ id: "x", price: 900 }), row({ id: "y", price: 500 }), row({ id: "x", price: 100, packageSessionId: "x2" })],
      { grouping: true, languages: LANGS },
    );
    expect(ids(sortCatalogCards(grouped, "Price: Low to High", base))).toEqual(["x", "y"]);
  });

  it("sorts grouped cards by a price that can be paid now (a closed version does not count)", () => {
    const grouped = buildCatalogCards(
      [
        row({ id: "x", price: 900 }),
        row({ id: "y", price: 500 }),
        row({ id: "x", price: 100, packageSessionId: "x2", enroll_invite_availability: "EXPIRED" }),
      ],
      { grouping: true, languages: LANGS },
    );
    expect(ids(sortCatalogCards(grouped, "Price: Low to High", base))).toEqual(["y", "x"]);
  });

  it("sorts by the price a card shows when told (merged cards under filters)", () => {
    const shown = new Map([
      ["a", 50],
      ["d", 999],
    ]);
    const priceOf = (c: (typeof cards)[number]) => shown.get(c.courseId) ?? c.sortPrice;
    expect(ids(sortCatalogCards(cards, "Price: Low to High", { ...base, priceOf }))).toEqual(["a", "b", "c", "d"]);
    expect(ids(sortCatalogCards(cards, "Price: High to Low", { ...base, priceOf }))).toEqual(["d", "c", "b", "a"]);
  });

  it("does not mutate its input", () => {
    const copy = [...cards];
    sortCatalogCards(cards, "Name Z-A", base);
    expect(cards).toEqual(copy);
  });

  it("reads created_at defensively", () => {
    expect(createdTime(undefined)).toBe(0);
    expect(createdTime("nope")).toBe(0);
    expect(createdTime("2026-01-01T00:00:00Z")).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });
});

/**
 * Rows as the v2 search sends them (created_at, snake_case), in the server's
 * order B, C, A — the order every older grid has always shown.
 */
type ApiRow = CatalogRowLike & { created_at?: string };
const SERVER_ORDER: ApiRow[] = [
  row({ id: "b", title: "B", created_at: "2026-05-01T00:00:00Z" } as Partial<ApiRow>),
  row({ id: "c", title: "C", created_at: "2025-01-01T00:00:00Z" } as Partial<ApiRow>),
  row({ id: "a", title: "A", created_at: "2026-09-01T00:00:00Z" } as Partial<ApiRow>),
];
const order = (rows: ApiRow[], sort: "Newest" | "Oldest") =>
  ids(sortCatalogCards(buildCatalogCards(rows, { grouping: false, languages: LANGS }), sort, base));

describe("withCreatedAt", () => {
  it("leaves an older grid's rows untouched, so Newest and Oldest keep the server order", () => {
    const rows = withCreatedAt(SERVER_ORDER, false);
    expect(rows).toBe(SERVER_ORDER);
    expect(rows.every((r) => r.createdAt === undefined)).toBe(true);
    expect(order(rows, "Newest")).toEqual(["b", "c", "a"]);
    expect(order(rows, "Oldest")).toEqual(["b", "c", "a"]);
  });

  it("dates a discovery section's rows, so Newest and Oldest sort by created_at", () => {
    const rows = withCreatedAt(SERVER_ORDER, true);
    expect(rows.map((r) => r.createdAt)).toEqual(SERVER_ORDER.map((r) => r.created_at));
    expect(order(rows, "Newest")).toEqual(["a", "b", "c"]);
    expect(order(rows, "Oldest")).toEqual(["c", "b", "a"]);
    // The API rows themselves are not changed.
    expect(SERVER_ORDER.every((r) => r.createdAt === undefined)).toBe(true);
  });

  it("keeps a row without a usable created_at as it is", () => {
    const undated = row({ id: "u" }) as ApiRow;
    const blank = row({ id: "v", created_at: "" } as Partial<ApiRow>) as ApiRow;
    const [u, v] = withCreatedAt([undated, blank], true);
    expect(u).toBe(undated);
    expect(v).toBe(blank);
  });
});

describe("sortOptionLabel", () => {
  // Echo "key|default" so both the key and the English fallback are checked.
  const t = ((key: string, fallback: string) => `${key}|${fallback}`) as unknown as TFunction;

  it("names every sort with a coursePlayerB key (its ?sort= token) and the option as the default", () => {
    expect(COURSE_CATALOG_SORT_OPTIONS.map((option) => sortOptionLabel(t, option))).toEqual([
      "courseCatalog.sort.newest|Newest",
      "courseCatalog.sort.oldest|Oldest",
      "courseCatalog.sort.price-asc|Price: Low to High",
      "courseCatalog.sort.price-desc|Price: High to Low",
      "courseCatalog.sort.rating|Rating",
      "courseCatalog.sort.name-asc|Name A-Z",
      "courseCatalog.sort.name-desc|Name Z-A",
      "courseCatalog.sort.popular|Popular",
    ]);
  });
});
