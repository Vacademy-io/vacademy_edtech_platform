import { describe, expect, it } from "vitest";
import { badgesNeedRanks, normaliseLanguages, resolveCatalogDiscovery, toSlug } from "./catalog-config";

const LANG_ON = { courseLanguages: { enabled: true } };

describe("resolveCatalogDiscovery", () => {
  it("is inactive for a section without discovery props (the original grid)", () => {
    const c = resolveCatalogDiscovery({ title: "Courses", showFilters: true, defaultSort: "Newest" }, {});
    expect(c.active).toBe(false);
    expect(c.streams).toBeNull();
    expect(c.syncUrl).toBe(false);
    expect(c.badges).toBeNull();
    expect(c.quickFilters).toEqual([]);
    expect(c.grouping).toBe(false);
  });

  it("treats explicitly disabled features as inactive", () => {
    const c = resolveCatalogDiscovery(
      { streams: { enabled: false }, badges: { enabled: false }, priceFilter: { enabled: false }, quickFilters: [] },
      {},
    );
    expect(c.active).toBe(false);
  });

  it("turns syncUrl on by default only when streams are on", () => {
    expect(resolveCatalogDiscovery({ streams: { enabled: true } }, {}).syncUrl).toBe(true);
    expect(resolveCatalogDiscovery({ streams: { enabled: true }, syncUrl: false }, {}).syncUrl).toBe(false);
    expect(resolveCatalogDiscovery({ showFilterCounts: true }, {}).syncUrl).toBe(false);
    const explicit = resolveCatalogDiscovery({ syncUrl: true }, {});
    expect(explicit.syncUrl).toBe(true);
    expect(explicit.active).toBe(true);
  });

  it("reads streams with safe defaults and drops bad tag items", () => {
    const c = resolveCatalogDiscovery(
      {
        streams: {
          enabled: true,
          source: "tags",
          labelMode: "weird",
          items: [
            { label: "Shiksha", slug: "Shiksha!", tag: "shiksha" },
            { label: "Kala", tag: "kala" },
            { label: "Dup", slug: "shiksha", tag: "x" },
            { label: "शिक्षा" },
            "junk",
          ],
        },
      },
      {},
    );
    expect(c.streams).toMatchObject({ source: "tags", sticky: true, labelMode: "title", allLabel: "" });
    expect(c.streams?.items).toEqual([
      { label: "Shiksha", slug: "shiksha", tag: "shiksha" },
      { label: "Kala", slug: "kala", tag: "kala" },
    ]);
  });

  it("defaults the source to the folder library and ignores items there", () => {
    const c = resolveCatalogDiscovery(
      { streams: { enabled: true, libraryId: " lib-1 ", items: [{ label: "A", tag: "a" }], sticky: false } },
      {},
    );
    expect(c.streams).toMatchObject({ source: "folderLibrary", libraryId: "lib-1", items: [], sticky: false });
  });

  it("needs site course languages for the language filter, grouping and language quick filters", () => {
    const props = {
      languageFilter: { enabled: true, label: "Bhasha" },
      groupLanguageVersions: true,
      quickFilters: [{ id: "hi", label: "Hindi", kind: "language", value: "HI" }],
    };
    const off = resolveCatalogDiscovery(props, {});
    expect(off.languageFilter.enabled).toBe(false);
    expect(off.grouping).toBe(false);
    expect(off.quickFilters).toEqual([]);
    expect(off.active).toBe(true);

    const on = resolveCatalogDiscovery(props, LANG_ON);
    expect(on.languageFilter).toEqual({ enabled: true, label: "Bhasha" });
    expect(on.grouping).toBe(true);
    expect(on.quickFilters).toEqual([{ id: "hi", label: "Hindi", kind: "language", value: "hi" }]);
  });

  it("validates quick filters: kinds, values and unique ids", () => {
    const c = resolveCatalogDiscovery(
      {
        quickFilters: [
          { id: "a", label: "Popular", kind: "popular" },
          { id: "a", label: "New", kind: "new" },
          { label: "Under 1000", kind: "priceMax", value: "1000" },
          { id: "bad", label: "Cheap", kind: "priceMax", value: -5 },
          { id: "ta", label: "Tamil", kind: "language", value: "ta" },
          { id: "x", label: "X", kind: "trending" },
        ],
      },
      LANG_ON,
    );
    expect(c.quickFilters.map((q) => [q.id, q.kind, q.value])).toEqual([
      ["a", "popular", undefined],
      ["a-1", "new", undefined],
      ["priceMax-2", "priceMax", 1000],
    ]);
  });

  it("sanitises badge rules and price options", () => {
    const c = resolveCatalogDiscovery(
      {
        badges: { enabled: true, types: ["new", "bogus", "new", "free"], newDays: "30", max: 0 },
        priceFilter: { enabled: true, maxOptions: [1000, "500", -1, 1000, "abc"], showFree: false },
      },
      {},
    );
    expect(c.badges).toEqual({ enabled: true, types: ["new", "free"], newDays: 30, bestsellerTop: undefined, max: undefined });
    expect(c.priceFilter).toEqual({ enabled: true, label: "", showFree: false, maxOptions: [500, 1000] });
    expect(resolveCatalogDiscovery({ badges: { enabled: true } }, {}).badges?.types).toEqual([
      "bestseller",
      "popular",
      "new",
      "free",
    ]);
  });

  it("treats a badge type list with nothing valid in it as badges off (every box unticked)", () => {
    const none = resolveCatalogDiscovery({ badges: { enabled: true, types: [] } }, {});
    expect(none.badges).toBeNull();
    expect(none.active).toBe(false);
    expect(resolveCatalogDiscovery({ badges: { enabled: true, types: ["bogus"] } }, {}).badges).toBeNull();
    // No type list at all still means every badge.
    expect(resolveCatalogDiscovery({ badges: { enabled: true, types: "new" } }, {}).badges?.types).toEqual([
      "bestseller",
      "popular",
      "new",
      "free",
    ]);
  });

  it("only enables the category filter for folder-library streams", () => {
    expect(resolveCatalogDiscovery({ categoryFilter: { enabled: true } }, {}).categoryFilter.enabled).toBe(false);
    expect(
      resolveCatalogDiscovery({ categoryFilter: { enabled: true }, streams: { enabled: true, source: "tags" } }, {})
        .categoryFilter.enabled,
    ).toBe(false);
    expect(
      resolveCatalogDiscovery({ categoryFilter: { enabled: true }, streams: { enabled: true } }, {}).categoryFilter
        .enabled,
    ).toBe(true);
  });

  it("survives garbage input", () => {
    expect(resolveCatalogDiscovery(null, null).active).toBe(false);
    expect(resolveCatalogDiscovery({ streams: "yes", badges: [], quickFilters: {} } as never, 42).active).toBe(false);
  });
});

describe("helpers", () => {
  it("slugs text into URL keys", () => {
    expect(toSlug("  Vedic Maths & Sanskrit ")).toBe("vedic-maths-sanskrit");
    expect(toSlug("Śikṣā")).toBe("siksa");
    expect(toSlug("शिक्षा")).toBe("");
    expect(toSlug("a".repeat(130)).length).toBe(120);
  });

  it("normalises language codes and falls back to the defaults", () => {
    expect(normaliseLanguages({ languages: [{ code: " HI ", label: "Hindi" }, { code: "hi", label: "Dup" }, { code: "", label: "x" }] }))
      .toEqual([{ code: "hi", label: "Hindi" }]);
    expect(normaliseLanguages(undefined).map((l) => l.code)).toEqual(["en", "hi"]);
  });

  it("knows which badges need enrolment ranks", () => {
    expect(badgesNeedRanks(["new", "free"])).toBe(false);
    expect(badgesNeedRanks(["new", "bestseller"])).toBe(true);
    expect(badgesNeedRanks(["popular"])).toBe(true);
  });
});
