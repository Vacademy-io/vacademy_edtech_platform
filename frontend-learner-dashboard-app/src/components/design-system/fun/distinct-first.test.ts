import { describe, expect, it } from "vitest";
import { distinctPartsFirst } from "./distinct-first";

describe("distinctPartsFirst", () => {
  it("puts the session first when the level is shared", () => {
    expect(
      distinctPartsFirst([
        ["Class 12 Science", "2025-26"],
        ["class 12 science ", "2026-27"],
      ]),
    ).toEqual([
      ["2025-26", "Class 12 Science"],
      ["2026-27", "class 12 science "],
    ]);
  });
  it("keeps the order when the first part already differs", () => {
    expect(
      distinctPartsFirst([
        ["Beginner", "2026"],
        ["Advanced", "2026"],
      ]),
    ).toEqual([
      ["Beginner", "2026"],
      ["Advanced", "2026"],
    ]);
  });
  it("leaves a part one other row lacks where it is", () => {
    expect(
      distinctPartsFirst([
        ["Class 12", "2025-26"],
        ["Class 12", "2026-27"],
        ["Class 11", "2026-27"],
      ]),
    ).toEqual([
      ["Class 12", "2025-26"],
      ["Class 12", "2026-27"],
      ["Class 11", "2026-27"],
    ]);
  });
  it("leaves a single row and identical rows as they are", () => {
    expect(distinctPartsFirst([["Class 12", "2026"]])).toEqual([["Class 12", "2026"]]);
    expect(distinctPartsFirst([["Class 12"], ["Class 12"]])).toEqual([["Class 12"], ["Class 12"]]);
  });
});
