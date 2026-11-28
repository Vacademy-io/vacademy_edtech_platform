import { describe, expect, it } from "vitest";
import { batchNamesOf, courseIdsNeedingBatchNames, shownName, withBatchNames } from "./batch-names";

describe("batchNamesOf", () => {
  it("keys each batch's level, session and own name by its id", () => {
    const names = batchNamesOf([
      { id: "ps-a", package_dto: { package_name: "Ai/ML" }, level: { level_name: "Class 12" }, session: { session_name: "2025-26" }, package_session_name: "Ai/ML Weekend" },
      { id: "ps-b", package_dto: { package_name: "Ai/ML" }, level: { level_name: "DEFAULT" }, session: { session_name: "default" }, package_session_name: null },
      { id: null, level: { level_name: "Lost" } },
    ]);
    expect(names.get("ps-a")).toEqual({ level: "Class 12", session: "2025-26", batch: "Weekend" });
    expect(names.get("ps-b")).toEqual({ level: "", session: "", batch: "" });
    expect(names.size).toBe(2);
  });
  it("keeps a batch name that does not start with the course name", () => {
    const names = batchNamesOf([{ id: "ps", package_dto: { package_name: "Physics" }, package_session_name: "Evening group" }]);
    expect(names.get("ps")?.batch).toBe("Evening group");
  });
  it("reads nothing from a missing list", () => {
    expect(batchNamesOf(undefined).size).toBe(0);
  });
});

describe("courseIdsNeedingBatchNames", () => {
  it("asks only for shared names missing a session or batch name, once per course", () => {
    expect(
      courseIdsNeedingBatchNames([
        { courseId: "pkg-b", name: "Ai/ML" },
        { courseId: "pkg-b", name: " ai/ml " },
        { courseId: "pkg-c", name: "Chemistry" },
        { courseId: "pkg-a", name: "Maths", session: "2026", batch: "Weekend" },
        { courseId: "pkg-a2", name: "maths", session: "default" },
      ]),
    ).toEqual(["pkg-a2", "pkg-b"]);
  });
  it("asks nothing for a list with no shared name", () => {
    expect(courseIdsNeedingBatchNames([{ courseId: "a", name: "A" }, { courseId: "b", name: "B" }])).toEqual([]);
  });
});

describe("withBatchNames / shownName", () => {
  it("fills only the blanks and placeholders", () => {
    const names = { level: "Class 12", session: "2025-26", batch: "Weekend" };
    expect(withBatchNames({ level: "default", session: null, batch: "Own" }, names)).toEqual({ level: "Class 12", session: "2025-26", batch: "Own" });
    const row = { level: "A" };
    expect(withBatchNames(row, undefined)).toBe(row);
  });
  it("treats platform placeholders as blank", () => {
    expect(shownName(" Default ")).toBe("");
    expect(shownName("n/a")).toBe("");
    expect(shownName(" 2026 ")).toBe("2026");
  });
});
