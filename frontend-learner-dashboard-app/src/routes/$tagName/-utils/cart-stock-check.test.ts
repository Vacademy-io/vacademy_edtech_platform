// @vitest-environment jsdom
import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCartStock, copiesLeftForLine, findStockShortages } from "./cart-stock-check";

const line = (packageSessionId: string, quantity: number, id = `book-${packageSessionId}`) => ({
  id,
  packageSessionId,
  quantity,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findStockShortages", () => {
  it("flags a line wanting more than is left", () => {
    expect(findStockShortages([line("a", 2)], { a: 1 })).toEqual({ a: 1 });
  });

  it("flags a sold-out line", () => {
    expect(findStockShortages([line("a", 1)], { a: 0 })).toEqual({ a: 0 });
  });

  it("allows exactly what is left", () => {
    expect(findStockShortages([line("a", 2)], { a: 2 })).toEqual({});
  });

  it("treats a session absent from the answer as having no limit", () => {
    expect(findStockShortages([line("a", 99)], {})).toEqual({});
  });

  it("adds up lines selling the same session", () => {
    const lines = [line("a", 1, "invite-1"), line("a", 1, "invite-2")];
    expect(findStockShortages(lines, { a: 1 })).toEqual({ a: 1 });
  });

  it("falls back to the item id when a line has no package session", () => {
    expect(findStockShortages([{ id: "a", quantity: 2 }], { a: 1 })).toEqual({ a: 1 });
  });
});

describe("copiesLeftForLine", () => {
  it("reports the count while the line is still over", () => {
    expect(copiesLeftForLine(line("a", 2), [line("a", 2)], { a: 1 })).toBe(1);
  });

  it("clears as soon as the quantity comes down", () => {
    expect(copiesLeftForLine(line("a", 1), [line("a", 1)], { a: 1 })).toBeUndefined();
  });

  it("says nothing for a line with no problem", () => {
    expect(copiesLeftForLine(line("b", 5), [line("b", 5)], { a: 1 })).toBeUndefined();
  });
});

describe("checkCartStock", () => {
  it("asks once per session and reports the shortage", async () => {
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: { a: 1 } });
    await expect(checkCartStock([line("a", 2), line("b", 1)])).resolves.toEqual({ a: 1 });
    expect(post.mock.calls[0][1]).toEqual(["a", "b"]);
  });

  it("lets the learner continue when the check itself fails", async () => {
    vi.spyOn(axios, "post").mockRejectedValue(new Error("network"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(checkCartStock([line("a", 2)])).resolves.toEqual({});
  });
});
