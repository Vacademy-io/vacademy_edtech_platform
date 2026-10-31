import { describe, expect, it } from "vitest";
import {
  cardMatchesCustomOption,
  clearedCustomState,
  customValidation,
  resolveCustomFilters,
  selectedCustomOptions,
  withTagOptions,
} from "./catalog-custom-filters";
import { resolveCatalogDiscovery } from "./catalog-config";
import { buildFacetGroups, applyFacetGroups, buildAppliedChips, countFacetOptions, customOptions, EMPTY_CRITERIA } from "./catalog-filters";
import { buildCatalogCards } from "./catalog-cards";
import { cardFormatKeys, resolveCourseFormats } from "../../../-utils/course-format";
import { localizeDeep } from "../../../-utils/catalogue-i18n";
import {
  countDiscoveryFilters,
  discoveryLinkScope,
  discoveryPatchToParams,
  parseDiscoveryParams,
  readDiscoveryParams,
} from "./catalog-url";

const FORMATS = {
  courseFormats: {
    elearning: { label: "Interactive, self-paced E-learning" },
    ebook: { label: "E-books", levels: ["eBook"] },
    film: { label: "Short film / Animation", levels: ["Short Film"] },
    audiobook: { label: "Audio Book" },
  },
  courseFormatOrder: ["elearning", "ebook", "film", "audiobook"],
};

const FOR = {
  id: "for",
  label: "For",
  showCounts: false,
  visibleCount: 4,
  showAllLabel: "+ Show more",
  options: [
    { id: "parents", label: "Parents", tags: ["for-parents"] },
    { id: "students", label: "Students", tags: ["FOR-Students "] },
  ],
};

describe("resolveCustomFilters", () => {
  it("is [] without the prop (every other site)", () => {
    expect(resolveCustomFilters(undefined, {})).toEqual([]);
    expect(resolveCatalogDiscovery({}, {}).customFilters).toEqual([]);
    expect(resolveCatalogDiscovery({}, {}).active).toBe(false);
  });

  it("drops reserved, duplicate, disabled and empty groups and options without a matcher", () => {
    const out = resolveCustomFilters(
      [
        { id: "price", label: "Price", options: [{ id: "a", label: "A", tags: ["a"] }] },
        { id: "for", label: "For", options: [{ id: "x", label: "X" }] },
        FOR,
        { id: "For", label: "Again", options: [{ id: "a", label: "A", tags: ["a"] }] },
        { id: "off", label: "Off", enabled: false, options: [{ id: "a", label: "A", tags: ["a"] }] },
      ],
      {},
    );
    expect(out.map((g) => g.id)).toEqual(["for"]);
    expect(out[0].options).toEqual([
      { id: "parents", label: "Parents", tags: ["for-parents"], levels: [] },
      { id: "students", label: "Students", tags: ["for-students"], levels: [] },
    ]);
    expect(out[0]).toMatchObject({ showCounts: false, visibleCount: 4, showAllLabel: "+ Show more", labelFromSite: false });
  });

  it("takes a 'courseFormats' group's options from globalSettings in display order", () => {
    const [format] = resolveCustomFilters([{ id: "format", label: "Format", source: "courseFormats" }], FORMATS);
    expect(format.labelFromSite).toBe(true);
    expect(format.options.map((o) => o.id)).toEqual(["elearning", "ebook", "film", "audiobook"]);
    expect(format.options[1]).toEqual({ id: "ebook", label: "E-books", tags: ["format-ebook"], levels: ["ebook"] });
    // No formats authored → no group.
    expect(resolveCustomFilters([{ id: "format", label: "Format", source: "courseFormats" }], {})).toEqual([]);
  });

  it("joins the discovery config and switches it on", () => {
    const d = resolveCatalogDiscovery({ customFilters: [FOR] }, {});
    expect(d.active).toBe(true);
    expect(d.customFilters[0].id).toBe("for");
  });
});

const row = (id: string, extra: Record<string, unknown>) => ({
  id,
  title: id,
  description: "",
  level: String(extra.level_name ?? ""),
  rating: 0,
  instructor: "",
  price: 100,
  ...extra,
});
const ROWS = [
  row("a", { level_name: "eBook", comma_separeted_tags: "for-parents" }),
  row("b", { level_name: "default", comma_separeted_tags: "format-elearning,for-students" }),
  row("c", { level_name: "Short Film", comma_separeted_tags: "" }),
  row("d", { level_name: "default", comma_separeted_tags: "format-ebook", language: "hi" }),
];
const cards = buildCatalogCards(ROWS, { grouping: false, languages: [], preferredLanguage: null });

describe("custom group matching", () => {
  const [format] = resolveCustomFilters([{ id: "format", label: "Format", source: "courseFormats" }], FORMATS);
  const formats = resolveCourseFormats(FORMATS);

  it("matches exactly the cards whose shared format keys include the option", () => {
    for (const option of format.options) {
      for (const card of cards) {
        expect(cardMatchesCustomOption(card, option)).toBe(cardFormatKeys(card.rows, formats).includes(option.id));
      }
    }
  });

  it("filters OR inside a group, AND with other groups, and counts zero-count options", () => {
    const [forGroup] = resolveCustomFilters([FOR], {});
    const custom = selectedCustomOptions([format, forGroup], { format: ["ebook", "film"], for: [] });
    expect(custom.map((g) => g.id)).toEqual(["format"]);
    const ctx = { languages: [], earnedBadges: new Map(), translate: (s: string) => s };
    const groups = buildFacetGroups({ ...EMPTY_CRITERIA, custom }, ctx);
    expect(applyFacetGroups(cards, groups).map((c) => c.courseId)).toEqual(["a", "c", "d"]);

    const both = buildFacetGroups(
      { ...EMPTY_CRITERIA, custom: selectedCustomOptions([format, forGroup], { format: ["ebook"], for: ["parents"] }) },
      ctx,
    );
    expect(applyFacetGroups(cards, both).map((c) => c.courseId)).toEqual(["a"]);

    const counts = countFacetOptions(cards, groups, "custom:format", customOptions(format.options));
    expect(counts).toEqual({ elearning: 1, ebook: 2, film: 1, audiobook: 0 });
  });

  it("lists one removable chip per selected option", () => {
    const custom = selectedCustomOptions([format], { format: ["film"] });
    const chips = buildAppliedChips({ ...EMPTY_CRITERIA, custom }, {
      category: (s) => s,
      language: (s) => s,
      price: () => "",
      badge: (b) => b,
      level: (s) => s,
      session: (s) => s,
      instructor: (s) => s,
      priceRange: () => "",
      search: (s) => s,
    });
    expect(chips).toEqual([{ key: "custom:format:film", group: "custom", value: "format:film", label: "Short film / Animation" }]);
  });
});

describe("custom groups in the URL", () => {
  const filters = resolveCustomFilters([{ id: "format", label: "Format", source: "courseFormats" }, FOR], FORMATS);
  const config = resolveCatalogDiscovery({ customFilters: [{ id: "format", label: "Format", source: "courseFormats" }, FOR] }, FORMATS);
  const scope = (filtersShown: boolean) =>
    discoveryLinkScope(config, { streams: [], filtersShown, presentLanguages: [] });

  it("reads ?format=ebook,bogus&for=parents for a section with those groups", () => {
    const state = readDiscoveryParams("?format=ebook,Bogus&for=PARENTS", scope(true));
    expect(state.custom).toEqual({ format: ["ebook"], for: ["parents"] });
    expect(countDiscoveryFilters(state)).toBe(2);
  });

  it("ignores the params on a section without the groups or without a filter panel", () => {
    expect(readDiscoveryParams("?format=ebook", discoveryLinkScope(resolveCatalogDiscovery({}, {}), { streams: [], filtersShown: true, presentLanguages: [] }))).not.toHaveProperty("custom");
    expect(readDiscoveryParams("?format=ebook", scope(false))).not.toHaveProperty("custom");
    expect(parseDiscoveryParams("?format=ebook")).not.toHaveProperty("custom");
  });

  it("writes and clears one parameter per group", () => {
    expect(discoveryPatchToParams({ custom: { format: ["ebook", "film"], for: [] } })).toEqual({
      format: ["ebook", "film"],
      for: null,
    });
    expect(discoveryPatchToParams({ custom: clearedCustomState(filters) })).toEqual({ format: null, for: null });
    expect(discoveryPatchToParams({ categories: [] })).toEqual({ category: null });
    expect(customValidation(filters).for).toEqual(["parents", "students"]);
  });
});

describe("i18n: option level names stay raw", () => {
  it("translates labels but never `levels`", () => {
    const dict = { eBook: "ई-पुस्तक", "E-books": "ई-पुस्तकें", Format: "प्रारूप" };
    const props = { customFilters: [{ id: "format", label: "Format", options: [{ id: "ebook", label: "E-books", levels: ["eBook"] }] }] };
    expect(localizeDeep(props, dict)).toEqual({
      customFilters: [{ id: "format", label: "प्रारूप", options: [{ id: "ebook", label: "ई-पुस्तकें", levels: ["eBook"] }] }],
    });
  });
});

describe("source 'tags' groups", () => {
  const rows = [
    { comma_separeted_tags: "hindi,ebook,for parents" },
    { comma_separeted_tags: "english,for parents,for Students" },
    { comma_separeted_tags: "for everyone,for-teachers" },
    { comma_separeted_tags: "for women's health" },
  ];
  const raw = [
    { id: "for", label: "For", source: "tags", prefix: "for", exclude: ["everyone"],
      options: [{ id: "womens-health", label: "Women's health", tags: ["for-womens-health"] }] },
  ];

  it("keeps the group before the courses load, then lists the prefixed tags after the authored options", () => {
    const [group] = resolveCustomFilters(raw, null);
    expect(group.fromTags).toEqual({ prefix: "for", exclude: ["everyone"] });
    const [filled] = withTagOptions([group], rows);
    expect(filled.options.map((o) => [o.id, o.label])).toEqual([
      ["womens-health", "Women's health"],
      ["parents", "Parents"],
      ["students", "Students"],
      ["teachers", "Teachers"],
    ]);
    expect(cardMatchesCustomOption({ rows: [{ comma_separeted_tags: "For-Parents" }] }, filled.options[1])).toBe(true);
    expect(cardMatchesCustomOption({ rows: [rows[3]] }, filled.options[0])).toBe(true);
  });

  it("drops a tags group no course fills, and leaves other groups alone", () => {
    const groups = resolveCustomFilters([...raw.map((g) => ({ ...g, options: [] })), { id: "x", label: "X", options: [{ id: "a", label: "A", tags: ["a"] }] }], null);
    expect(withTagOptions(groups, [{ comma_separeted_tags: "hindi" }]).map((g) => g.id)).toEqual(["x"]);
    const plain = resolveCustomFilters([{ id: "x", label: "X", options: [{ id: "a", label: "A", tags: ["a"] }] }], null);
    expect(withTagOptions(plain, rows)).toBe(plain);
  });

  it("an authored option tag matches however the course spells it", () => {
    const [group] = resolveCustomFilters([{ id: "for", label: "For", options: [{ id: "parents", label: "Parents", tags: ["for-parents"] }] }], null);
    expect(cardMatchesCustomOption({ rows: [{ comma_separeted_tags: "for parents" }] }, group.options[0])).toBe(true);
  });
});
