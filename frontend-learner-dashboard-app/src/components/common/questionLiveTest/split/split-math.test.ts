import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOUNDS,
  SPLIT_MAX,
  SPLIT_MIN,
  boundsForWidth,
  clampSplit,
  parseStoredSplit,
  splitForKey,
  splitFits,
  splitFromPointer,
} from "./split-math";

describe("split maths (CBE + passage beside the question)", () => {
  it("knows when a row is too narrow for both panes", () => {
    // 250 + 12 + 400 = 662px: a 768px tablet with the 320px question rail open has 448px.
    expect(splitFits(448)).toBe(false);
    expect(splitFits(661)).toBe(false);
    expect(splitFits(662)).toBe(true);
    expect(splitFits(1200)).toBe(true);
    // Not measured yet (or no layout, as in jsdom): assume it fits.
    expect(splitFits(0)).toBe(true);
  });

  it("clamps to the default limits", () => {
    expect(clampSplit(5)).toBe(SPLIT_MIN);
    expect(clampSplit(90)).toBe(SPLIT_MAX);
    expect(clampSplit(40)).toBe(40);
    expect(clampSplit(40, { min: 45, max: 50 })).toBe(45);
  });

  it("keeps both panes above their pixel floors on a given width", () => {
    // 1200px: max = (1200 - 12 - 400) / 1200 = 65.7% -> capped at 62; min = max(22, 250/1200=20.8) = 22
    expect(boundsForWidth(1200)).toEqual({ min: SPLIT_MIN, max: SPLIT_MAX });
    // 800px: max = (800 - 412) / 800 = 48.5%; min = 250/800 = 31.25%
    const b = boundsForWidth(800);
    expect(b.max).toBeCloseTo(48.5, 5);
    expect(b.min).toBeCloseTo(31.25, 5);
    // 600px: too narrow for both -> the answer pane gets the room (min = max)
    const narrow = boundsForWidth(600);
    expect(narrow.min).toBe(narrow.max);
    expect(boundsForWidth(0)).toEqual(DEFAULT_BOUNDS);
  });

  it("reads a remembered split, falling back on junk", () => {
    expect(parseStoredSplit("55", 40)).toBe(55);
    expect(parseStoredSplit("99", 40)).toBe(SPLIT_MAX);
    expect(parseStoredSplit(null, 40)).toBe(40);
    expect(parseStoredSplit("", 50)).toBe(50);
    expect(parseStoredSplit("abc", 50)).toBe(50);
    expect(parseStoredSplit("-3", 50)).toBe(50);
  });

  it("moves with the keyboard the way the arrow points, in both directions", () => {
    const bounds = { min: 25, max: 60 };
    expect(splitForKey("ArrowRight", false, false, 40, bounds)).toBe(42);
    expect(splitForKey("ArrowLeft", true, false, 40, bounds)).toBe(30);
    expect(splitForKey("ArrowRight", false, true, 40, bounds)).toBe(38);
    expect(splitForKey("Home", false, false, 40, bounds)).toBe(25);
    expect(splitForKey("End", false, false, 40, bounds)).toBe(60);
    expect(splitForKey("Enter", false, false, 40, bounds)).toBeNull();
  });

  it("turns a pointer position into a %, mirrored in right-to-left", () => {
    expect(splitFromPointer(300, 100, 1100, false)).toBe(20);
    expect(splitFromPointer(300, 100, 1100, true)).toBe(80);
    expect(splitFromPointer(300, 100, 100, false)).toBeNull();
  });
});
