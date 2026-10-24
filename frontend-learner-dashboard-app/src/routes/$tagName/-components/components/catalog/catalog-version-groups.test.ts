import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE_LANGUAGES as LANGS, groupCourseVariants, versionGroupIndex } from "../../../-utils/course-variants";
import { buildCatalogCards, type CatalogRowLike } from "./catalog-cards";
import { resolveCatalogDiscovery, resolveVersionGroups } from "./catalog-config";
import { bestRankedId, sortCatalogCards } from "./catalog-sort";

const row = (over: Partial<CatalogRowLike> & Record<string, unknown>): CatalogRowLike & Record<string, unknown> => ({
  id: "x",
  title: "T",
  description: "",
  price: 100,
  level: "eBook",
  level_name: "eBook",
  rating: 0,
  instructor: "",
  enroll_invite_availability: "AVAILABLE",
  ...over,
});

// BV: each language version is its own package, the language is a course tag.
const ROWS = [
  row({ id: "en1", package_id: "en1", title: "Vedic Parenting - eBook", comma_separeted_tags: "English", price: 251 }),
  row({ id: "x9", package_id: "x9", title: "Other", comma_separeted_tags: "Hindi" }),
  row({ id: "hi1", package_id: "hi1", title: "वैदिक पेरेंटिंग - ई पुस्तक", comma_separeted_tags: "Hindi", price: 201 }),
];

describe("cross-package language version groups (opt-in)", () => {
  it("without versionGroups the cards are exactly the previous ones (no courseIds field)", () => {
    const before = buildCatalogCards(ROWS, { grouping: true, languages: LANGS, preferredLanguage: "en" });
    const after = buildCatalogCards(ROWS, { grouping: true, languages: LANGS, preferredLanguage: "en", versionGroups: [] });
    expect(after).toEqual(before);
    expect(before.map((c) => c.courseId)).toEqual(["en1", "x9", "hi1"]);
    expect(before.every((c) => !("courseIds" in c))).toBe(true);
    expect(buildCatalogCards(ROWS, { grouping: false, languages: LANGS, versionGroups: [["en1", "hi1"]] })).toHaveLength(3);
  });

  it("one card for an EN + HI pair, where the first version sat; the preferred language opens", () => {
    const en = buildCatalogCards(ROWS, { grouping: true, languages: LANGS, preferredLanguage: "en", versionGroups: [["en1", "hi1"]] });
    expect(en.map((c) => c.courseId)).toEqual(["en1", "x9"]);
    expect(en[0].languages.map((l) => l.code)).toEqual(["en", "hi"]);
    expect(en[0].primary.id).toBe("en1");
    expect(en[0].courseIds).toEqual(["en1", "hi1"]);
    expect(en[0].priceVaries).toBe(true);
    const hi = buildCatalogCards(ROWS, { grouping: true, languages: LANGS, preferredLanguage: "hi", versionGroups: [["en1", "hi1"]] });
    expect(hi[0].primary.id).toBe("hi1");
  });

  it("groups are read only when grouping is on", () => {
    const rows = ROWS.map((r) => ({ package_id: String(r.package_id), package_session_id: `${r.id}-ps` }));
    expect(groupCourseVariants(rows, { enabled: false, languages: LANGS, versionGroups: [["en1", "hi1"]] })).toHaveLength(3);
    expect(versionGroupIndex([["a", "b"], ["b", "c"], "bad" as unknown as string[]])).toEqual(
      new Map([["a", "vg:0"], ["b", "vg:0"], ["c", "vg:1"]]),
    );
    expect(versionGroupIndex(undefined)).toBeNull();
  });

  it("Popular ranks a merged card by its best-ranked package", () => {
    const cards = buildCatalogCards(ROWS, { grouping: true, languages: LANGS, versionGroups: [["en1", "hi1"]] });
    const ranks = new Map([["hi1", 1], ["x9", 2]]);
    expect(bestRankedId(["en1", "hi1"], ranks)).toBe("hi1");
    expect(bestRankedId(["en1"], new Map())).toBe("en1");
    const sorted = sortCatalogCards(cards, "Popular", { ranks, titleOf: (c) => c.primary.title });
    expect(sorted.map((c) => c.courseId)).toEqual(["en1", "x9"]);
  });

  it("config: resolves only lists of 2+ distinct ids, and adds no key for sites without them", () => {
    expect(resolveVersionGroups([["a", "b"], ["c"], ["d", "d"], "x", [" e ", "f", ""]])).toEqual([["a", "b"], ["e", "f"]]);
    const plain = resolveCatalogDiscovery({ groupLanguageVersions: true }, { courseLanguages: { enabled: true } });
    expect("versionGroups" in plain).toBe(false);
    const withGroups = resolveCatalogDiscovery(
      { groupLanguageVersions: true },
      { courseLanguages: { enabled: true, versionGroups: [["en1", "hi1"]] } },
    );
    expect(withGroups.versionGroups).toEqual([["en1", "hi1"]]);
  });
});
