import { describe, expect, it } from "vitest";
import {
  allCategories,
  categoriesInScope,
  contrastOnWhite,
  fillCount,
  orderGroupIds,
  resolveCategoryFilterExtension,
  resolveFilterSidebar,
  splitScriptRuns,
} from "./catalog-sidebar-config";
import { resolveCatalogDiscovery } from "./catalog-config";
import { discoveryLinkScope, readDiscoveryParams } from "./catalog-url";
import type { CatalogCategory, CatalogStream } from "./catalog-streams";

const cat = (slug: string, extra: Partial<CatalogCategory> = {}): CatalogCategory => ({
  id: slug,
  slug,
  title: slug,
  subtitle: "",
  tags: [slug],
  comingSoon: false,
  audienceId: null,
  ...extra,
});
const stream = (slug: string, categories: CatalogCategory[]): CatalogStream => ({
  id: slug,
  slug,
  title: slug,
  subtitle: "",
  tag: slug,
  tags: [slug, ...categories.map((c) => c.slug)],
  comingSoon: false,
  audienceId: null,
  categories,
});
const STREAMS = [stream("shiksha", [cat("gurukul"), cat("vedic")]), stream("kala", [cat("mandir"), cat("Vedic")])];

describe("resolveFilterSidebar", () => {
  it("is null unless the variant is 'editorial'", () => {
    expect(resolveFilterSidebar(undefined)).toBeNull();
    expect(resolveFilterSidebar({})).toBeNull();
    expect(resolveFilterSidebar({ variant: "default", width: 300 })).toBeNull();
  });

  it("resolves the editorial defaults", () => {
    expect(resolveFilterSidebar({ variant: "editorial" })).toEqual({
      width: 280,
      sticky: false,
      collapsible: true,
      title: "",
      clearAllLabel: "",
      showMoreLabel: "",
      showLessLabel: "",
      order: [],
      dividerColor: null,
      checkboxColor: null,
      checkboxSoftColor: null,
      promo: null,
    });
  });

  it("clamps the width, keeps hex colours only and lower-cases the order", () => {
    const s = resolveFilterSidebar({
      variant: "editorial",
      width: 900,
      order: ["Price", "language", "price", ""],
      dividerColor: "#EFE6CC", // design-lint-ignore: test fixture colour
      checkboxColor: "red; background:url(x)",
    })!;
    expect(s.width).toBe(360);
    expect(resolveFilterSidebar({ variant: "editorial", width: 10 })!.width).toBe(220);
    expect(s.order).toEqual(["price", "language"]);
    expect(s.dividerColor).toBe("#EFE6CC"); // design-lint-ignore: test fixture colour
    expect(s.checkboxColor).toBeNull();
  });

  it("drops a checkbox colour too faint to see on the white box (< 3:1)", () => {
    const s = resolveFilterSidebar({
      variant: "editorial",
      checkboxColor: "#A08A5C", // design-lint-ignore: test fixture colour (3.34:1)
      checkboxSoftColor: "#CFC0A0", // design-lint-ignore: test fixture colour (1.79:1)
    })!;
    expect(s.checkboxColor).toBe("#A08A5C"); // design-lint-ignore: test fixture colour
    expect(s.checkboxSoftColor).toBeNull();
    expect(contrastOnWhite("#fff")).toBeCloseTo(1); // design-lint-ignore: test fixture colour
    expect(contrastOnWhite("#000000")).toBeCloseTo(21); // design-lint-ignore: test fixture colour
    expect(contrastOnWhite("#00000000")).toBeCloseTo(1); // design-lint-ignore: test fixture colour
  });

  it("resolves the promo only when enabled, with safe links and images", () => {
    expect(resolveFilterSidebar({ variant: "editorial", promo: { title: "x" } })!.promo).toBeNull();
    const promo = resolveFilterSidebar({
      variant: "editorial",
      promo: {
        enabled: true,
        image: "javascript:alert(1)",
        screenImage: "https://cdn.example.com/a.png",
        title: " Your learning ",
        button: { text: "Get the app", target: "/login" },
        eyebrowColor: "#E8A860", // design-lint-ignore: test fixture colour
      },
    })!.promo!;
    expect(promo.image).toBeNull();
    expect(promo.screenImage).toBe("https://cdn.example.com/a.png");
    expect(promo.title).toBe("Your learning");
    expect(promo.buttonTarget).toBe("/login");
    expect(promo.eyebrowColor).toBe("#E8A860"); // design-lint-ignore: test fixture colour
    const noLink = resolveFilterSidebar({ variant: "editorial", promo: { enabled: true, button: { text: "Go", target: "javascript:x" } } })!;
    expect(noLink.promo!.buttonTarget).toBeNull();
  });
});

describe("group order", () => {
  it("puts listed ids first and keeps the rest in their original order", () => {
    const available = ["category", "language", "price", "format", "for", "level"];
    expect(orderGroupIds(available, ["price", "language", "format", "category", "for", "bogus"])).toEqual([
      "price",
      "language",
      "format",
      "category",
      "for",
      "level",
    ]);
    expect(orderGroupIds(available, [])).toEqual(available);
    // Ids keep their casing; the (lower-cased) authored order still matches them.
    expect(orderGroupIds(["price", "level", "priceRange"], resolveFilterSidebar({ variant: "editorial", order: ["priceRange"] })!.order)).toEqual(["priceRange", "price", "level"]);
  });
});

describe("categoryFilter extensions", () => {
  it("adds nothing for a section that sets none (existing configs unchanged)", () => {
    expect(resolveCategoryFilterExtension({ enabled: true, label: "Category" })).toEqual({});
    expect(resolveCatalogDiscovery({ categoryFilter: { enabled: true, label: "C" } }, {}).categoryFilter).toEqual({
      enabled: false,
      label: "C",
    });
    expect(resolveCatalogDiscovery({ priceFilter: { enabled: true } }, {}).priceFilter).toEqual({
      enabled: true,
      label: "",
      showFree: true,
      maxOptions: [],
    });
  });

  it("resolves the authored fields", () => {
    expect(
      resolveCategoryFilterExtension({
        scope: "all",
        labelMode: "both",
        sort: "count",
        hideComingSoon: true,
        visibleCount: 6,
        showAllLabel: "+ Show all {count} categories",
      }),
    ).toEqual({ scope: "all", labelMode: "both", sort: "count", hideComingSoon: true, visibleCount: 6, showAllLabel: "+ Show all {count} categories" });
    expect(resolveCatalogDiscovery({ priceFilter: { enabled: true, control: "checkbox" } }, {}).priceFilter.control).toBe(
      "checkbox",
    );
  });

  it("lists every stream's categories on 'All' only with scope 'all'", () => {
    expect(allCategories(STREAMS).map((c) => c.slug)).toEqual(["gurukul", "vedic", "mandir"]);
    expect(categoriesInScope({}, STREAMS, null)).toEqual([]);
    expect(categoriesInScope({ scope: "all" }, STREAMS, null).length).toBe(3);
    expect(categoriesInScope({ scope: "all" }, STREAMS, STREAMS[1]).map((c) => c.slug)).toEqual(["mandir", "Vedic"]);
  });

  it("keeps ?category= without a stream only with scope 'all'", () => {
    const streams = STREAMS.map((s) => ({ slug: s.slug, categories: s.categories.map((c) => ({ slug: c.slug })) }));
    const config = (scope?: string) =>
      resolveCatalogDiscovery(
        { streams: { enabled: true, source: "folderLibrary", libraryId: "l" }, categoryFilter: { enabled: true, scope } },
        {},
      );
    const all = discoveryLinkScope(config("all"), { streams, filtersShown: true, presentLanguages: [] });
    expect(readDiscoveryParams("?category=Mandir,nope", all).categories).toEqual(["mandir"]);
    const plain = discoveryLinkScope(config(), { streams, filtersShown: true, presentLanguages: [] });
    expect(plain).not.toHaveProperty("rootCategories");
    expect(readDiscoveryParams("?category=mandir", plain).categories).toEqual([]);
    // Under a stream, only that stream's categories (as before).
    expect(readDiscoveryParams("?stream=shiksha&category=mandir,gurukul", all).categories).toEqual(["gurukul"]);
  });
});

describe("text helpers", () => {
  it("splits Devanagari from Latin runs (punctuation joins the run before it)", () => {
    expect(splitScriptRuns("Category  ·  श्रेणी")).toEqual([
      { text: "Category  ·  ", devanagari: false },
      { text: "श्रेणी", devanagari: true },
    ]);
    expect(splitScriptRuns("Format")).toEqual([{ text: "Format", devanagari: false }]);
  });

  it("fills {count} and {{count}}", () => {
    expect(fillCount("+ Show all {count} categories", 11)).toBe("+ Show all 11 categories");
    expect(fillCount("+ सभी {{count}} श्रेणियाँ देखें", 3)).toBe("+ सभी 3 श्रेणियाँ देखें");
  });
});
