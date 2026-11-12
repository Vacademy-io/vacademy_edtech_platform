import { describe, expect, it } from "vitest";
import { collectFilterItems, filterOptionCounts, findFilterHost, itemMatchesSelection, resolveFilterGroups, resolveSelectedTags } from "./tag-filter";

describe("tag filter groups", () => {
  const groups = resolveFilterGroups(
    [{ label: "Age", tags: ["2+ year", "nope", "3+ YEAR"] }, { label: "Category", tags: ["Storybooks", "2+ year"] }, { label: "", tags: [] }],
    ["Storybooks", "2+ year", "3+ year", "English"],
    "Tags",
  );
  it("keeps page tags only, one group per tag, leftovers last", () => {
    expect(groups).toEqual([
      { label: "Age", tags: ["2+ year", "3+ year"] },
      { label: "Category", tags: ["Storybooks"] },
      { label: "Tags", tags: ["English"] },
    ]);
  });
  it("OR inside a group, AND across; untagged items only without picks", () => {
    expect(itemMatchesSelection(["Storybooks", "3+ year"], ["2+ year", "3+ year"], groups)).toBe(true);
    expect(itemMatchesSelection(["Storybooks", "3+ year"], ["2+ year", "Storybooks"], groups)).toBe(false);
    expect(itemMatchesSelection([], [], groups)).toBe(true);
    expect(itemMatchesSelection([], ["English"], groups)).toBe(false);
  });
  it("URL picks resolve case-insensitively and drop unknown tags", () => {
    expect(resolveSelectedTags(["storybooks", "x", "STORYBOOKS"], ["Storybooks"])).toEqual(["Storybooks"]);
  });
  it("counts keep the other groups' picks", () => {
    const items = [
      { layoutId: "a", slotIndex: 0, tags: ["Storybooks", "2+ year"], children: [] },
      { layoutId: "a", slotIndex: 1, tags: ["Storybooks", "3+ year"], children: [] },
      { layoutId: "b", slotIndex: 0, tags: ["English", "2+ year"], children: [] },
    ];
    expect(filterOptionCounts(items, ["Storybooks"], groups)).toEqual({ "2+ year": 1, "3+ year": 1, storybooks: 2, english: 0 });
  });
  it("host = first enabled layout with the bar on; items skip untagged/disabled layouts", () => {
    const comps = [
      { id: "x", type: "columnLayout", enabled: false, props: { showTagFilter: true, slots: [[]], columnTags: [["A"]] } },
      { id: "y", type: "columnLayout", props: { showTagFilter: true, slots: [[], []], columnTags: [["A"], []] } },
      { id: "z", type: "columnLayout", props: { slots: [[]] } },
    ];
    expect(findFilterHost(comps)?.id).toBe("y");
    expect(collectFilterItems(comps).map((i) => `${i.layoutId}:${i.slotIndex}`)).toEqual(["y:0", "y:1"]);
  });
});
