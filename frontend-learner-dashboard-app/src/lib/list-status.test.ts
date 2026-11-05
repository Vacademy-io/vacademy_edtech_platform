import { describe, expect, it } from "vitest";
import { requireListPage, resolveListView } from "./list-status";

describe("resolveListView", () => {
  it("treats a list with no request yet as loading", () => {
    expect(resolveListView(undefined, 0)).toBe("loading");
  });

  it("stays loading while a request is running, even with no items", () => {
    expect(resolveListView("loading", 0)).toBe("loading");
    expect(resolveListView("loading", 3)).toBe("loading");
  });

  it("shows the error for a failed request, with or without earlier items", () => {
    expect(resolveListView("error", 0)).toBe("error");
    expect(resolveListView("error", 3)).toBe("error");
  });

  it("shows empty only after a successful answer with no items", () => {
    expect(resolveListView("success", 0)).toBe("empty");
  });

  it("shows the data after a successful answer with items", () => {
    expect(resolveListView("success", 1)).toBe("data");
  });
});

describe("requireListPage", () => {
  it("returns a page, including one with no items", () => {
    const page = { content: [], totalPages: 0 };
    expect(requireListPage(page)).toBe(page);
  });

  it.each([
    ["an object with no list", {}],
    ["a list that is null", { content: null }],
    ["a list that is not an array", { content: "nope" }],
    ["an HTML page", "<html></html>"],
    ["null", null],
    ["nothing", undefined],
  ])("throws on %s", (_label: string, body: unknown) => {
    expect(() => requireListPage(body)).toThrow();
  });
});
