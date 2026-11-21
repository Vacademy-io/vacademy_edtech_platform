import { describe, expect, it } from "vitest";
import {
  MAX_HERO_POPULAR,
  fillCount,
  resolveCatalogHero,
  resolvePopularChip,
  safeBandColor,
} from "./catalog-hero-config";
import { localizeComponentProps } from "../../../-utils/catalogue-site-language";

describe("resolveCatalogHero", () => {
  it("is null for a section that sets no part of the hero", () => {
    expect(resolveCatalogHero(undefined)).toBeNull();
    expect(resolveCatalogHero(null)).toBeNull();
    expect(resolveCatalogHero("yes")).toBeNull();
    expect(resolveCatalogHero({})).toBeNull();
    expect(resolveCatalogHero({ enabled: false, title: "All courses" })).toBeNull();
    expect(resolveCatalogHero({ enabled: "true" })).toBeNull();
    expect(resolveCatalogHero({ resultsHeader: { enabled: false, countText: "x" } })).toBeNull();
    expect(resolveCatalogHero({ quickFilterBar: { variant: "tint" } })).toBeNull();
    expect(resolveCatalogHero({ quickFilterBar: { label: "  " } })).toBeNull();
  });

  it("resolves the band: trims text, keeps known stat kinds (max 3), drops empty crumbs", () => {
    const hero = resolveCatalogHero({
      enabled: true,
      title: " All courses ",
      lead: "Lead",
      breadcrumb: [{ label: "Home", route: "homepage" }, { label: "" }, null, { label: "Courses", route: " " }],
      stats: [
        { kind: "courses", label: "courses & resources" },
        { kind: "teachers", label: "x" },
        { kind: "streams" },
        { kind: "categories", label: "c" },
        { kind: "courses", label: "again" },
      ],
    })!;
    expect(hero.band).toMatchObject({
      title: "All courses",
      lead: "Lead",
      breadcrumb: [{ label: "Home", route: "homepage" }, { label: "Courses", route: undefined }],
      stats: [
        { kind: "courses", label: "courses & resources" },
        { kind: "streams", label: "" },
        { kind: "categories", label: "c" },
      ],
      search: null,
      popular: [],
      backgroundColor: null,
    });
    // No search → the toolbar card stays (no results header unless asked for).
    expect(hero.resultsHeader).toBeNull();
    expect(hero.quickFilterBar).toBeNull();
  });

  it("the hero search brings the results header with it (one search box per page)", () => {
    const hero = resolveCatalogHero({ enabled: true, search: { enabled: true, placeholder: "Find", buttonText: "" } })!;
    expect(hero.band!.search).toEqual({ placeholder: "Find", buttonText: "" });
    expect(hero.resultsHeader).toMatchObject({ countText: "", showStreamChip: true, streamChipMode: "title" });
  });

  it("results header and quick-filter bar work without the band", () => {
    const hero = resolveCatalogHero({
      resultsHeader: {
        enabled: true,
        countText: "Showing {count} courses",
        showStreamChip: false,
        streamChipMode: "subtitle",
        sortLabels: { popular: " Most popular ", bogus: "x", newest: "" },
      },
      quickFilterBar: { label: "Quick filters:", variant: "filled" },
    })!;
    expect(hero.band).toBeNull();
    expect(hero.resultsHeader).toEqual({
      countText: "Showing {count} courses",
      countTextOne: "Showing {count} courses",
      showStreamChip: false,
      allStreamsLabel: "",
      streamChipMode: "subtitle",
      sortPrefix: "",
      sortLabels: { popular: "Most popular" },
    });
    expect(hero.quickFilterBar).toEqual({ label: "Quick filters:", variant: "filled" });
    expect(resolveCatalogHero({ quickFilterBar: { variant: "filled" } })!.quickFilterBar).toEqual({
      label: "",
      variant: "filled",
    });
  });

  it("classifies popular chips by precedence and caps them", () => {
    expect(resolvePopularChip({ label: "A", searchValue: "gita", streamSlug: "s" })).toEqual({
      kind: "search",
      label: "A",
      value: "gita",
    });
    expect(resolvePopularChip({ label: "B", streamSlug: "dharma", categorySlug: "vedic-parenting", quickFilterId: "q" })).toEqual({
      kind: "stream",
      label: "B",
      streamSlug: "dharma",
      categorySlug: "vedic-parenting",
    });
    expect(resolvePopularChip({ label: "C", streamSlug: "dharma" })).toMatchObject({ categorySlug: null });
    expect(resolvePopularChip({ label: "D", quickFilterId: "qf-free", route: "x" })).toEqual({
      kind: "quick",
      label: "D",
      quickFilterId: "qf-free",
    });
    expect(resolvePopularChip({ label: "E", route: "about-us" })).toEqual({ kind: "route", label: "E", route: "about-us" });
    expect(resolvePopularChip({ label: "No action" })).toBeNull();
    expect(resolvePopularChip({ searchValue: "no label" })).toBeNull();
    expect(resolvePopularChip("x")).toBeNull();
    const many = Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, searchValue: `v${i}` }));
    expect(resolveCatalogHero({ enabled: true, popular: [{ label: "bad" }, ...many] })!.band!.popular).toHaveLength(
      MAX_HERO_POPULAR,
    );
  });

  it("accepts only colour values for the band fill", () => {
    expect(safeBandColor("#FDF6E8")).toBe("#FDF6E8"); // design-lint-ignore: test fixture colour
    expect(safeBandColor("rgb(253, 246, 232)")).toBe("rgb(253, 246, 232)");
    expect(safeBandColor("red; background: url(x)")).toBeNull();
    expect(safeBandColor(12)).toBeNull();
  });

  it("fills {count}", () => {
    expect(fillCount("Showing {count} courses", "22")).toBe("Showing 22 courses");
    expect(fillCount("{count} पाठ्यक्रम · {count}", "1")).toBe("1 पाठ्यक्रम · 1");
  });
});

describe("site dictionary on hero props (localizeComponentProps)", () => {
  it("translates the prose keys and leaves the data keys as authored", () => {
    const dict = {
      "All courses": "सभी पाठ्यक्रम",
      Home: "मुख्य पृष्ठ",
      "courses & resources": "पाठ्यक्रम और संसाधन",
      Search: "खोजें",
      "Popular:": "लोकप्रिय:",
      "Holistic Parenting": "वैदिक पेरेंटिंग",
      Gita: "गीता",
      "Showing {count} courses": "{count} पाठ्यक्रम दिखाए जा रहे हैं",
      "Most popular": "सबसे लोकप्रिय",
      "Sort:": "क्रम:",
      "Quick filters:": "त्वरित फ़िल्टर:",
      courses: "पाठ्यक्रम",
      filled: "भरा",
      subtitle: "उपशीर्षक",
      homepage: "मुखपृष्ठ",
    };
    const out = localizeComponentProps(
      {
        hero: {
          enabled: true,
          title: "All courses",
          breadcrumb: [{ label: "Home", route: "homepage" }],
          stats: [{ kind: "courses", label: "courses & resources" }],
          search: { enabled: true, buttonText: "Search" },
          popularLabel: "Popular:",
          popular: [
            { label: "Holistic Parenting", streamSlug: "dharma", categorySlug: "vedic-parenting" },
            { label: "Gita", searchValue: "Gita" },
          ],
          resultsHeader: {
            enabled: true,
            countText: "Showing {count} courses",
            sortPrefix: "Sort:",
            sortLabels: { popular: "Most popular" },
            streamChipMode: "subtitle",
          },
          quickFilterBar: { label: "Quick filters:", variant: "filled" },
        },
      },
      dict,
    );
    const hero = out.hero;
    expect(hero.title).toBe("सभी पाठ्यक्रम");
    expect(hero.breadcrumb[0]).toEqual({ label: "मुख्य पृष्ठ", route: "homepage" });
    expect(hero.stats[0]).toEqual({ kind: "courses", label: "पाठ्यक्रम और संसाधन" });
    expect(hero.search.buttonText).toBe("खोजें");
    expect(hero.popularLabel).toBe("लोकप्रिय:");
    expect(hero.popular[0]).toEqual({ label: "वैदिक पेरेंटिंग", streamSlug: "dharma", categorySlug: "vedic-parenting" });
    // The search value stays raw (search already matches translated titles).
    expect(hero.popular[1]).toEqual({ label: "गीता", searchValue: "Gita" });
    expect(hero.resultsHeader.countText).toBe("{count} पाठ्यक्रम दिखाए जा रहे हैं");
    expect(hero.resultsHeader.sortPrefix).toBe("क्रम:");
    expect(hero.resultsHeader.sortLabels.popular).toBe("सबसे लोकप्रिय");
    expect(hero.resultsHeader.streamChipMode).toBe("subtitle");
    expect(hero.quickFilterBar).toEqual({ label: "त्वरित फ़िल्टर:", variant: "filled" });
  });
});
