import { describe, expect, it } from "vitest";
import { pinchScale } from "./pdf-pinch";

describe("pinchScale", () => {
  it("scales with finger distance", () => {
    expect(pinchScale(1, 100, 200)).toBe(2);
    expect(pinchScale(1, 200, 100)).toBe(0.5);
  });
  it("stays in range", () => {
    expect(pinchScale(1, 10, 1000)).toBe(4);
    expect(pinchScale(1, 1000, 10)).toBe(0.4);
  });
  it("ignores a zero start", () => {
    expect(pinchScale(1.5, 0, 100)).toBe(1.5);
  });
});
