import { describe, expect, it } from "vitest";
import { withSearchParams } from "../../../-utils/catalogue-url-state";
import { ALL_BADGES } from "../../../-utils/course-badges";
import { resolveCatalogDiscovery } from "./catalog-config";
import {
  countDiscoveryFilters,
  discoveryLinkScope,
  discoveryPatchToParams,
  formatPriceParam,
  parseDiscoveryParams,
  parsePriceParam,
  readDiscoveryParams,
  readStreamParams,
  samePrice,
  sanitizeDiscoveryState,
  searchToParam,
  sortFromToken,
  sortToToken,
  SORT_URL_TOKENS,
  type DiscoveryValidation,
} from "./catalog-url";
import { COURSE_CATALOG_SORT_OPTIONS } from "../../../-types/course-catalogue-types";

const STREAMS: DiscoveryValidation["streams"] = [
  { slug: "shiksha", categories: [{ slug: "vedic-maths" }, { slug: "sanskrit" }] },
  { slug: "kala", categories: [{ slug: "music" }] },
];

/** A section that offers every control. */
const V: DiscoveryValidation = {
  streams: STREAMS,
  languageCodes: ["en", "hi"],
  prices: "any",
  badges: [...ALL_BADGES],
};

describe("price param", () => {
  it("parses free, paid and max:<n>", () => {
    expect(parsePriceParam("free")).toEqual({ kind: "free" });
    expect(parsePriceParam(" PAID ")).toEqual({ kind: "paid" });
    expect(parsePriceParam("max:1000")).toEqual({ kind: "max", max: 1000 });
    expect(parsePriceParam("max:499.5")).toEqual({ kind: "max", max: 499.5 });
  });

  it("ignores anything else", () => {
    for (const bad of [null, "", "cheap", "max:", "max:abc", "max:0", "max:-5", "min:100"]) {
      expect(parsePriceParam(bad)).toBeNull();
    }
  });

  it("round-trips", () => {
    for (const raw of ["free", "paid", "max:1000"]) expect(formatPriceParam(parsePriceParam(raw))).toBe(raw);
    expect(formatPriceParam(null)).toBeNull();
    expect(samePrice({ kind: "max", max: 5 }, { kind: "max", max: 5 })).toBe(true);
    expect(samePrice({ kind: "free" }, null)).toBe(false);
  });
});

describe("sort tokens", () => {
  it("has one unique token per sort option", () => {
    const tokens = COURSE_CATALOG_SORT_OPTIONS.map((o) => SORT_URL_TOKENS[o]);
    expect(new Set(tokens).size).toBe(COURSE_CATALOG_SORT_OPTIONS.length);
    for (const option of COURSE_CATALOG_SORT_OPTIONS) expect(sortFromToken(SORT_URL_TOKENS[option])).toBe(option);
  });

  it("matches the documented URL vocabulary", () => {
    expect(sortFromToken("popular")).toBe("Popular");
    expect(sortFromToken("PRICE-ASC")).toBe("Price: Low to High");
    expect(sortFromToken("name-desc")).toBe("Name Z-A");
    expect(sortFromToken("bogus")).toBeNull();
    expect(sortFromToken(null)).toBeNull();
  });

  it("leaves the default sort out of the URL", () => {
    expect(sortToToken("Newest", "Newest")).toBeNull();
    expect(sortToToken("Popular", "Newest")).toBe("popular");
    expect(sortToToken("Newest", "Popular")).toBe("newest");
  });
});

describe("readDiscoveryParams", () => {
  it("reads a full mega-menu / shared link", () => {
    const s = readDiscoveryParams(
      "?stream=Shiksha&category=sanskrit,vedic-maths&language=hi&price=max:1000&badge=new,bestseller&utm_source=x",
      V,
    );
    expect(s).toEqual({
      stream: "shiksha",
      categories: ["sanskrit", "vedic-maths"],
      languages: ["hi"],
      price: { kind: "max", max: 1000 },
      badges: ["new", "bestseller"],
    });
  });

  it("ignores unknown and invalid values", () => {
    const s = readDiscoveryParams("?stream=nope&category=music&language=ta,HI,hi&price=cheap&badge=hot,FREE", V);
    expect(s).toEqual({ stream: null, categories: [], languages: ["hi"], price: null, badges: ["free"] });
  });

  it("only accepts categories of the selected stream", () => {
    expect(readStreamParams("?stream=kala&category=music,sanskrit", V)).toEqual({
      stream: "kala",
      categories: ["music"],
    });
    expect(readStreamParams("?category=music", V)).toEqual({ stream: null, categories: [] });
  });

  it("drops languages when the site has none", () => {
    expect(readDiscoveryParams("?language=hi", { ...V, languageCodes: [] }).languages).toEqual([]);
  });

  it("keeps only the prices and badges the section lists", () => {
    const limited = { ...V, prices: [{ kind: "free" as const }], badges: ["new" as const] };
    expect(readDiscoveryParams("?price=free&badge=new,bestseller", limited)).toMatchObject({
      price: { kind: "free" },
      badges: ["new"],
    });
    expect(readDiscoveryParams("?price=paid", limited).price).toBeNull();
    expect(readDiscoveryParams("?price=max:500", { ...V, prices: [{ kind: "max", max: 500 }] }).price).toEqual({
      kind: "max",
      max: 500,
    });
  });
});

describe("parse + sanitize", () => {
  it("parses syntax only", () => {
    expect(parseDiscoveryParams("?stream=Kala&category=Music,x&language=HI&price=bad&badge=NEW,hot")).toEqual({
      stream: "Kala",
      categories: ["Music", "x"],
      languages: ["HI"],
      price: null,
      badges: ["new"],
    });
  });

  it("sanitizes a local state the same way (canonical slugs, offered values only)", () => {
    const scope = { ...V, languageCodes: ["hi"], prices: [] as never[], badges: [] as never[] };
    expect(
      sanitizeDiscoveryState(
        { stream: "KALA", categories: ["MUSIC", "sanskrit"], languages: ["en", "hi"], price: { kind: "paid" }, badges: ["new"] },
        scope,
      ),
    ).toEqual({ stream: "kala", categories: ["music"], languages: ["hi"], price: null, badges: [] });
  });
});

describe("discoveryLinkScope: a link only applies what the section can show and undo", () => {
  const LANG_ON = { courseLanguages: { enabled: true } };
  const scope = (props: Record<string, unknown>, gs: unknown = LANG_ON, ctx: Partial<Parameters<typeof discoveryLinkScope>[1]> = {}) =>
    discoveryLinkScope(resolveCatalogDiscovery(props, gs), {
      streams: STREAMS,
      filtersShown: true,
      presentLanguages: ["en", "hi"],
      ...ctx,
    });
  const ALL = "?stream=shiksha&category=vedic-maths&language=hi&price=free&badge=new";

  it("stream tabs alone: the mega-menu category link opens the whole stream", () => {
    const v = scope({ streams: { enabled: true } });
    expect(readDiscoveryParams(ALL, v)).toEqual({
      stream: "shiksha",
      categories: [],
      languages: [],
      price: null,
      badges: [],
    });
  });

  it("applies a category only with the category filter showing", () => {
    const props = { streams: { enabled: true }, categoryFilter: { enabled: true } };
    expect(readDiscoveryParams(ALL, scope(props)).categories).toEqual(["vedic-maths"]);
    expect(readDiscoveryParams(ALL, scope(props, LANG_ON, { filtersShown: false })).categories).toEqual([]);
  });

  it("with applied-filter chips every valid value applies (each shows as a removable chip)", () => {
    const v = scope({ streams: { enabled: true }, showAppliedChips: true });
    expect(readDiscoveryParams(ALL.replace("badge=new", "badge=new,popular"), v)).toEqual({
      stream: "shiksha",
      categories: ["vedic-maths"],
      languages: ["hi"],
      price: { kind: "free" },
      badges: ["new", "popular"],
    });
    // …but never a course language the site does not have switched on.
    expect(readDiscoveryParams(ALL, scope({ showAppliedChips: true }, {})).languages).toEqual([]);
  });

  it("languages: the sidebar group's present languages, or language quick filters", () => {
    expect(readDiscoveryParams("?language=en,hi", scope({ languageFilter: { enabled: true } })).languages).toEqual([
      "en",
      "hi",
    ]);
    expect(
      readDiscoveryParams("?language=en,hi", scope({ languageFilter: { enabled: true } }, LANG_ON, { presentLanguages: ["hi"] }))
        .languages,
    ).toEqual(["hi"]);
    const quick = scope({ quickFilters: [{ id: "hi", label: "", kind: "language", value: "hi" }] });
    expect(readDiscoveryParams("?language=en,hi", quick).languages).toEqual(["hi"]);
    expect(readDiscoveryParams("?language=hi", scope({ languageFilter: { enabled: true } }, LANG_ON, { filtersShown: false })).languages).toEqual([]);
  });

  it("prices: any with the price filter showing, else exactly the quick filters' choices", () => {
    expect(scope({ priceFilter: { enabled: true } }).prices).toBe("any");
    expect(scope({ priceFilter: { enabled: true } }, LANG_ON, { filtersShown: false }).prices).toEqual([]);
    const quick = scope({
      quickFilters: [
        { id: "f", label: "", kind: "free" },
        { id: "u", label: "", kind: "priceMax", value: 1000 },
      ],
    });
    expect(quick.prices).toEqual([{ kind: "free" }, { kind: "max", max: 1000 }]);
    expect(readDiscoveryParams("?price=max:1000", quick).price).toEqual({ kind: "max", max: 1000 });
    expect(readDiscoveryParams("?price=max:500", quick).price).toBeNull();
    expect(readDiscoveryParams("?price=paid", quick).price).toBeNull();
  });

  it("badges: only New / Bestseller quick filters are badge controls", () => {
    const v = scope({
      quickFilters: [
        { id: "n", label: "", kind: "new" },
        { id: "p", label: "", kind: "popular" },
        { id: "f", label: "", kind: "free" },
      ],
    });
    expect(v.badges).toEqual(["new"]);
    expect(readDiscoveryParams("?badge=new,popular,free,bestseller", v).badges).toEqual(["new"]);
  });
});

describe("discoveryPatchToParams", () => {
  it("writes only the keys in the patch, removing empty ones", () => {
    expect(discoveryPatchToParams({ stream: "kala", categories: [] })).toEqual({ stream: "kala", category: null });
    expect(discoveryPatchToParams({ price: { kind: "max", max: 500 }, badges: ["new"] })).toEqual({
      price: "max:500",
      badge: ["new"],
    });
    expect(discoveryPatchToParams({ languages: [], price: null, stream: null })).toEqual({
      language: null,
      price: null,
      stream: null,
    });
  });

  it("round-trips through the query string and keeps unrelated params", () => {
    const state = {
      stream: "shiksha",
      categories: ["vedic-maths"],
      languages: ["en", "hi"],
      price: { kind: "free" as const },
      badges: ["popular" as const],
    };
    const qs = withSearchParams("?lang=hi&utm=1", discoveryPatchToParams(state));
    expect(qs).toContain("lang=hi");
    expect(qs).toContain("utm=1");
    expect(readDiscoveryParams(qs, V)).toEqual(state);
  });
});

describe("misc", () => {
  it("trims and bounds the search param", () => {
    expect(searchToParam("  yoga ")).toBe("yoga");
    expect(searchToParam("   ")).toBeNull();
    expect(searchToParam("x".repeat(500))?.length).toBe(200);
  });

  it("counts applied discovery filters (not the stream)", () => {
    expect(
      countDiscoveryFilters({ stream: "kala", categories: ["a"], languages: ["hi", "en"], price: { kind: "paid" }, badges: [] }),
    ).toBe(4);
  });
});
