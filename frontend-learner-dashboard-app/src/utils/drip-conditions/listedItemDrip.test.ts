import { describe, expect, it, vi } from "vitest";
import { evaluateListedItem, rowDripCondition, type ListedItemDripRules } from "./listedItemDrip";

const FUTURE = { type: "date_based", params: { unlock_date: "2099-01-01T00:00:00.000Z" } };
const PAST = { type: "date_based", params: { unlock_date: "2020-01-01T00:00:00.000Z" } };
const lock = (rule: unknown = FUTURE, over = {}) => ({ behavior: "lock", rules: [rule], ...over }) as never;
const rules = (over: Partial<ListedItemDripRules> = {}): ListedItemDripRules => ({
  conditionFor: () => null,
  rowLevelEnabled: false,
  now: new Date("2026-06-01T00:00:00.000Z"),
  ...over,
});
const items = (...percentages: number[]) =>
  percentages.map((percentage, i) => ({ id: `s${i}`, percentage }));

describe("rowDripCondition", () => {
  it("reads a JSON string, an object and an array", () => {
    const c = { target: "slide", behavior: "lock", rules: [] };
    expect(rowDripCondition(JSON.stringify(c), "slide")).toEqual(c);
    expect(rowDripCondition(c, "slide")).toEqual(c);
    expect(rowDripCondition([{ ...c, target: "chapter" }, c], "slide")).toEqual(c);
  });

  it("leaves out another level and a disabled condition", () => {
    expect(rowDripCondition({ target: "chapter", behavior: "lock", rules: [] }, "slide")).toBeNull();
    expect(rowDripCondition({ behavior: "lock", rules: [], is_enabled: false }, "slide")).toBeNull();
  });

  it("treats an empty value and unreadable text as no condition", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(rowDripCondition(null, "slide")).toBeNull();
    expect(rowDripCondition("{not json", "slide")).toBeNull();
    quiet.mockRestore();
  });
});

describe("evaluateListedItem", () => {
  it("leaves an item open with no condition, or at a position that does not exist", () => {
    expect(evaluateListedItem("slide", items(0), 0, rules()).isLocked).toBe(false);
    expect(evaluateListedItem("slide", items(0), -1, rules()).isLocked).toBe(false);
  });

  it("applies a configured condition without the row-level switch", () => {
    const r = rules({ conditionFor: () => lock() });
    expect(evaluateListedItem("slide", items(0), 0, r).isLocked).toBe(true);
  });

  it("holds a row's own condition and the course's behind the row-level switch", () => {
    const list = [{ id: "s0", percentage: 0, rowCondition: lock() }];
    expect(evaluateListedItem("slide", list, 0, rules()).isLocked).toBe(false);
    expect(evaluateListedItem("slide", list, 0, rules({ rowLevelEnabled: true })).isLocked).toBe(true);
    expect(evaluateListedItem("slide", items(0), 0, rules({ courseCondition: lock() })).isLocked).toBe(false);
    expect(
      evaluateListedItem("slide", items(0), 0, rules({ courseCondition: lock(), rowLevelEnabled: true })).isLocked,
    ).toBe(true);
  });

  it("lets the configured condition win over the row's, then the row's over the course's", () => {
    const row = [{ id: "s0", percentage: 0, rowCondition: lock() }];
    const configuredPast = rules({ conditionFor: () => lock(PAST), rowLevelEnabled: true });
    expect(evaluateListedItem("slide", row, 0, configuredPast).isLocked).toBe(false);
    const rowPast = [{ id: "s0", percentage: 0, rowCondition: lock(PAST) }];
    expect(
      evaluateListedItem("slide", rowPast, 0, rules({ courseCondition: lock(), rowLevelEnabled: true })).isLocked,
    ).toBe(false);
  });

  it("reports a hidden item as hidden", () => {
    const r = rules({ conditionFor: () => lock(FUTURE, { behavior: "hide" }) });
    const result = evaluateListedItem("slide", items(0), 0, r);
    expect(result.isHidden).toBe(true);
    expect(result.isLocked).toBe(false);
  });

  it("reads progress rules from the list order, with the first item exempt", () => {
    const sequential = { type: "sequential", params: { requires_previous: true, threshold: 100 } };
    const r = rules({ conditionFor: () => lock(sequential) });
    expect(evaluateListedItem("slide", items(40, 0), 0, r).isLocked).toBe(false);
    expect(evaluateListedItem("slide", items(40, 0), 1, r).isLocked).toBe(true);
    expect(evaluateListedItem("slide", items(100, 0), 1, r).isLocked).toBe(false);
  });

  it("reads a prerequisite from the list and from the caller's extra completions", () => {
    const prerequisite = (required_chapters: string[], required_slides: string[]) => ({
      type: "prerequisite",
      params: { required_chapters, required_slides, threshold: 100 },
    });
    const list = items(100, 0);
    const onSlide = rules({ conditionFor: () => lock(prerequisite([], ["s0"])) });
    expect(evaluateListedItem("slide", list, 1, onSlide).isLocked).toBe(false);
    const onChapter = rules({ conditionFor: () => lock(prerequisite(["ch1"], [])) });
    expect(evaluateListedItem("slide", list, 1, onChapter).isLocked).toBe(true);
    expect(evaluateListedItem("slide", list, 1, onChapter, { ch1: 100 }).isLocked).toBe(false);
  });

  it("ignores row and course conditions for levels that have only the configured path", () => {
    const list = [{ id: "m0", percentage: 0, rowCondition: lock() }];
    const r = rules({ rowLevelEnabled: true, courseCondition: lock() });
    expect(evaluateListedItem("module", list, 0, r).isLocked).toBe(false);
  });

  it("counts a day-wise rule from the anchor, and opens when there is none", () => {
    const dayFive = lock({ type: "relative_date", params: { unlock_on_day: 5 } });
    const r = rules({ conditionFor: () => dayFive, now: new Date(2026, 5, 2) });
    expect(evaluateListedItem("slide", items(0), 0, r).isLocked).toBe(false);
    const enrolled = { ...r, enrollmentDate: new Date(2026, 5, 1).toISOString() };
    expect(evaluateListedItem("slide", items(0), 0, enrolled).isLocked).toBe(true);
  });
});
