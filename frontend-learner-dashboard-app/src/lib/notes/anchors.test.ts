import { describe, expect, it } from "vitest";
import { dragRect, findQuote, mergeLineRects, parseAnchor, toPageRect } from "./anchors";

describe("mergeLineRects", () => {
  it("joins words on a line and keeps lines apart", () => {
    const merged = mergeLineRects([
      { page: 0, x: 10, y: 10, w: 5, h: 2 },
      { page: 0, x: 16, y: 10.1, w: 5, h: 2 },
      { page: 0, x: 10, y: 14, w: 5, h: 2 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ page: 0, x: 10, y: 10, w: 11, h: 2.1 });
  });

  it("does not join across pages or across a wide gap", () => {
    expect(
      mergeLineRects([
        { page: 0, x: 10, y: 10, w: 5, h: 2 },
        { page: 1, x: 16, y: 10, w: 5, h: 2 },
        { page: 0, x: 60, y: 10, w: 5, h: 2 },
      ]),
    ).toHaveLength(3);
  });

  it("drops empty boxes", () => {
    expect(mergeLineRects([{ page: 0, x: 1, y: 1, w: 0, h: 2 }])).toEqual([]);
  });
});

describe("toPageRect", () => {
  const page = { left: 100, top: 100, right: 300, bottom: 500, width: 200, height: 400 };
  it("converts to percent of the page", () => {
    const client = { left: 150, top: 200, right: 250, bottom: 220, width: 100, height: 20 };
    expect(toPageRect(client, page, 2)).toEqual({ page: 2, x: 25, y: 25, w: 50, h: 5 });
  });
  it("clips to the page and rejects boxes outside it", () => {
    const over = { left: 50, top: 200, right: 150, bottom: 220, width: 100, height: 20 };
    expect(toPageRect(over, page, 0)?.x).toBe(0);
    const out = { left: 400, top: 200, right: 450, bottom: 220, width: 50, height: 20 };
    expect(toPageRect(out, page, 0)).toBeNull();
  });
});

describe("dragRect", () => {
  it("works in any drag direction and stays on the page", () => {
    expect(dragRect(1, { x: 80, y: 120 }, { x: 20, y: 40 })).toEqual({
      page: 1,
      x: 20,
      y: 40,
      w: 60,
      h: 60,
    });
  });
});

describe("findQuote", () => {
  it("finds text across nodes with different whitespace", () => {
    const hit = findQuote(["Plants  make\n", "food using ", "sunlight daily"], "make food using sunlight");
    expect(hit).toEqual({ startNode: 0, startOffset: 8, endNode: 2, endOffset: 8 });
  });
  it("finds text across paragraphs with nothing between them", () => {
    expect(findQuote(["First paragraph.", "Second one."], "paragraph. Second")).toEqual({
      startNode: 0,
      startOffset: 6,
      endNode: 1,
      endOffset: 6,
    });
  });
  it("finds Hindi text", () => {
    expect(findQuote(["प्रकाश संश्लेषण एक प्रक्रिया है"], "संश्लेषण एक")).not.toBeNull();
  });
  it("returns null when absent or empty", () => {
    expect(findQuote(["abc"], "xyz")).toBeNull();
    expect(findQuote(["abc"], "   ")).toBeNull();
  });
});

describe("parseAnchor", () => {
  it("survives bad input", () => {
    expect(parseAnchor("{bad")).toEqual({});
    expect(parseAnchor(null)).toEqual({});
    expect(parseAnchor('{"rects":[]}')).toEqual({ rects: [] });
  });
});
