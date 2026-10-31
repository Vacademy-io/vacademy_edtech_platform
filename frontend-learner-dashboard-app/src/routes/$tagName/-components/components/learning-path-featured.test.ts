import { describe, expect, it, vi } from "vitest";

// folder-library-service builds its API base from the browser location.
vi.mock("@/constants/urls", () => ({ BASE_URL: "" }));

import {
  buildPathSteps,
  displayVariant,
  formatPathPrice,
  goalMatchesPath,
  mappingTags,
  mergePathSteps,
  pathLanguages,
  pathPill,
  pathStreams,
  pathTotalSummary,
  pickFeaturedEntry,
  withComingSoonSteps,
  type PathMapping,
} from "./learning-path-utils";

const LANGS = [
  { code: "en", label: "English", match: ["english", "en"] },
  { code: "hi", label: "Hindi", match: ["hindi", "hi"] },
];

const row = (id: string, price: number | null, tags = "", level = "default", currency = "INR"): PathMapping => ({
  package_session_id: `ps-${id}`,
  package_id: id,
  package_name: id,
  level_name: level,
  tags,
  payment_plan: price === null ? null : { actual_price: price, currency },
});
const steps = (rows: PathMapping[]) => buildPathSteps(rows, { groupVersions: true, languages: LANGS });

describe("featured learning paths: pure helpers", () => {
  it("reads mapping tags from a comma string or an array", () => {
    expect(mappingTags({ tags: " English, Swasthya ,," })).toEqual(["english", "swasthya"]);
    expect(mappingTags({ tags: ["A", "b,c"] })).toEqual(["a", "b", "c"]);
    expect(mappingTags({})).toEqual([]);
  });

  it("merges language packages into one step, preferring the visitor's language", () => {
    const base = steps([row("hi1", 151, "hindi"), row("en1", 151, "english"), row("x", 10, "english")]);
    expect(base).toHaveLength(3);
    const merged = mergePathSteps(base, [[1, 2]], LANGS, "en");
    expect(merged).toHaveLength(2);
    expect(merged[0]!.variants.map((v) => v.package_id)).toEqual(["hi1", "en1"]);
    expect(merged[0]!.primary.package_id).toBe("en1");
    expect(merged[0]!.languages.map((l) => l.code)).toEqual(["en", "hi"]);
    expect(merged[1]!.primary.package_id).toBe("x");
    // Hindi visitor; and invalid groups change nothing.
    expect(mergePathSteps(base, [[2, 1]], LANGS, "hi")[0]!.primary.package_id).toBe("hi1");
    expect(mergePathSteps(base, [[1], [9, 10], "x"], LANGS)).toBe(base);
    expect(mergePathSteps(base, undefined, LANGS)).toBe(base);
  });

  it("shows a step in the visitor's language by level or tag", () => {
    const [step] = mergePathSteps(steps([row("hi1", 1, "hindi"), row("en1", 1, "english")]), [[1, 2]], LANGS);
    expect(displayVariant(step!, LANGS, "hi").package_id).toBe("hi1");
    expect(displayVariant(step!, LANGS, "en").package_id).toBe("en1");
    expect(displayVariant(step!, LANGS, null).package_id).toBe("hi1");
  });

  it("finds a path's streams from its versions' tags in step order, else its own stream", () => {
    const swasthya = { id: "s", tags: ["swasthya", "rajaswala"] };
    const dharma = { id: "d", tags: ["dharma"] };
    const bharat = { id: "b", tags: ["bharat"] };
    const rows = [row("a", 1, "english,rajaswala"), row("b", 1, "swasthya"), row("c", 1, "dharma,unknown")];
    expect(pathStreams(rows, [dharma, swasthya, bharat], bharat)).toEqual([swasthya, dharma]);
    expect(pathStreams([row("z", 1, "nothing")], [dharma], bharat)).toEqual([bharat]);
    expect(pathStreams([], [dharma], null)).toEqual([]);
  });

  it("orders a path's languages by how many versions use them, ties in site order", () => {
    expect(pathLanguages([row("a", 0, "english"), row("b", 0, "hindi"), row("c", 0, "hindi")], LANGS).map((l) => l.code)).toEqual(["hi", "en"]);
    expect(pathLanguages([row("a", 0, "hindi"), row("b", 0, "english")], LANGS).map((l) => l.code)).toEqual(["en", "hi"]);
    expect(pathLanguages([row("a", 0, "", "Hindi")], LANGS).map((l) => l.code)).toEqual(["hi"]);
    expect(pathLanguages([row("a", 0)], LANGS)).toEqual([]);
  });

  it("inserts coming-soon steps at their position (or the end) and numbers every row", () => {
    const real = steps([row("a", 1), row("b", 2)]);
    const items = withComingSoonSteps(real, [
      { title: "Soon end", audienceId: " aud " },
      { title: "Soon first", position: 1 },
      { title: "  " },
      { title: "Out of range", position: 99 },
    ]);
    expect(items.map((i) => (i.kind === "soon" ? i.title : i.step.primary.package_id))).toEqual([
      "Soon first",
      "a",
      "b",
      "Soon end",
      "Out of range",
    ]);
    expect(items.map((i) => i.index)).toEqual([0, 1, 2, 3, 4]);
    expect(items[3]).toMatchObject({ kind: "soon", audienceId: "aud" });
    expect(items[0]).toMatchObject({ kind: "soon", audienceId: null });
    expect(withComingSoonSteps(real, null)).toHaveLength(2);
  });

  it("picks the pill: all free, first free, or none", () => {
    expect(pathPill([0, 0, 0])).toBe("allFree");
    expect(pathPill([0, 51, 0])).toBe("firstFree");
    expect(pathPill([51, 0])).toBeNull();
    expect(pathPill([])).toBeNull();
    // A coming-soon step shown as step 1: the free real step is step 2.
    expect(pathPill([0, 51], true)).toBeNull();
    expect(pathPill([0, 0], true)).toBe("allFree");
  });

  it("totals the shown versions and picks the note", () => {
    expect(pathTotalSummary([row("a", 1001), row("b", 251), row("c", 251)], 0)).toEqual({
      total: 1503,
      currency: "INR",
      note: "all",
      count: 3,
      freeSteps: [],
    });
    expect(pathTotalSummary([row("a", 0), row("b", 0)], 0)).toMatchObject({ total: 0, note: "allFree", freeSteps: [0, 1] });
    expect(pathTotalSummary([row("a", 151)], 1)).toMatchObject({ total: 151, note: "available", count: 1 });
    expect(pathTotalSummary([row("a", 0)], 1)).toMatchObject({ total: 0, note: "available" });
    // A missing price or mixed currencies: no total.
    expect(pathTotalSummary([row("a", 1), row("b", null)], 0).total).toBeNull();
    expect(pathTotalSummary([row("a", 1), row("b", 1, "", "default", "USD")], 0).total).toBeNull();
  });

  it("matches goals by stream tags or an authored goal tag", () => {
    expect(goalMatchesPath({ key: "health", tags: ["Swasthya"] }, { tags: ["swasthya", "rajaswala"] })).toBe(true);
    expect(goalMatchesPath({ key: "child", tags: ["dharma"] }, { tags: ["swasthya"] })).toBe(false);
    expect(goalMatchesPath({ key: "child" }, { tags: [], goalTags: ["Child"] })).toBe(true);
    expect(goalMatchesPath({ key: "", tags: [] }, { tags: ["x"] })).toBe(false);
  });

  it("features the authored path when listed, else the first", () => {
    const entries = [{ code: "a" }, { code: "b" }];
    expect(pickFeaturedEntry(entries, " b ")).toBe(entries[1]);
    expect(pickFeaturedEntry(entries, "zzz")).toBe(entries[0]);
    expect(pickFeaturedEntry(entries, undefined)).toBe(entries[0]);
    expect(pickFeaturedEntry([], "a")).toBeNull();
  });

  it("formats prices the way the design writes them", () => {
    expect(formatPathPrice(251, "INR")).toBe("₹251");
    expect(formatPathPrice(2106, "INR")).toBe("₹2,106");
    expect(formatPathPrice(150000, null)).toBe("₹1,50,000");
    expect(formatPathPrice(99.5, "INR")).toBe("₹99.50");
  });
});
