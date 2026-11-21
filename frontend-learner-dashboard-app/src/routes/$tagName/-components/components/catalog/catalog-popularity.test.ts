import { describe, expect, it } from "vitest";
import { parsePopularityRanks } from "./catalog-popularity";

describe("parsePopularityRanks", () => {
  it("maps package ids to ranks", () => {
    const ranks = parsePopularityRanks({
      institute_id: "inst",
      ranks: [
        { package_id: "a", rank: 1 },
        { package_id: "b", rank: 2 },
      ],
    });
    expect([...ranks]).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("drops malformed entries and keeps a duplicate's best rank", () => {
    const ranks = parsePopularityRanks({
      ranks: [
        { package_id: "a", rank: 3 },
        { package_id: "a", rank: 1 },
        { package_id: "", rank: 2 },
        { package_id: "b", rank: 0 },
        { package_id: "c", rank: "1" },
        { package_id: 7, rank: 1 },
        null,
        { package_id: " d ", rank: 2.7 },
      ],
    });
    expect([...ranks]).toEqual([
      ["a", 1],
      ["d", 2],
    ]);
  });

  it("returns an empty map for anything that is not a ranks payload", () => {
    for (const bad of [null, undefined, "x", 1, [], { ranks: "no" }, { counts: [] }]) {
      expect(parsePopularityRanks(bad).size).toBe(0);
    }
  });
});
