import { describe, expect, it } from "vitest";
import { toSegments } from "./segments";
import type { HomePlacement } from "@/types/learner-home";

const b = (key: string, placement: HomePlacement) => ({ key, placement });

describe("toSegments", () => {
  it("cuts the list at every FULL block", () => {
    const segs = toSegments([b("hero", "FULL"), b("a", "MAIN"), b("r", "RAIL"), b("ban", "FULL"), b("c", "MAIN")]);
    expect(segs.map((s) => s.kind)).toEqual(["full", "grid", "full", "grid"]);
    expect(segs[1]).toMatchObject({ main: [b("a", "MAIN")], rail: [b("r", "RAIL")] });
    expect(segs[3]).toMatchObject({ main: [b("c", "MAIN")], rail: [] });
  });

  it("keeps list order inside each column of a run", () => {
    const segs = toSegments([b("r1", "RAIL"), b("m1", "MAIN"), b("r2", "RAIL"), b("m2", "MAIN")]);
    expect(segs).toHaveLength(1);
    const grid = segs[0];
    if (grid?.kind !== "grid") throw new Error("expected a grid");
    expect(grid.main.map((x) => x.key)).toEqual(["m1", "m2"]);
    expect(grid.rail.map((x) => x.key)).toEqual(["r1", "r2"]);
  });

  it("gives a run without RAIL blocks an empty rail (main spans the width)", () => {
    const segs = toSegments([b("m1", "MAIN"), b("m2", "MAIN")]);
    expect(segs).toEqual([{ kind: "grid", key: "grid-m1", main: [b("m1", "MAIN"), b("m2", "MAIN")], rail: [] }]);
  });

  it("matches today's desktop layout for the 'current home' conversion: hero band, then one grid", () => {
    const segs = toSegments([b("hero", "FULL"), b("cl", "MAIN"), b("pins", "RAIL"), b("ec", "MAIN"), b("live", "RAIL")]);
    expect(segs.map((s) => s.kind)).toEqual(["full", "grid"]);
  });

  it("handles an empty list", () => {
    expect(toSegments([])).toEqual([]);
  });
});
