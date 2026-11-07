import { describe, expect, it } from "vitest";
import { fitScale } from "./fit-scale";

describe("fitScale", () => {
  it("fits a 1920x1080 stage inside a phone-width box", () => {
    const scale = fitScale(364, 205, 1920, 1080, false);
    expect(1920 * scale).toBeLessThanOrEqual(364);
    expect(1080 * scale).toBeLessThanOrEqual(205);
    expect(scale).toBeCloseTo(0.186, 2);
  });

  it("uses the tighter side when the box is not 16:9", () => {
    expect(fitScale(1000, 100, 1920, 1080, false)).toBeCloseTo((100 / 1080) * 0.98, 5);
  });

  it("never enlarges past natural size", () => {
    expect(fitScale(4000, 3000, 1920, 1080, false)).toBe(1);
    expect(fitScale(4000, 3000, 1920, 1080, true)).toBe(1);
  });

  it("drops the margin in fullscreen", () => {
    expect(fitScale(960, 540, 1920, 1080, true)).toBeCloseTo(0.5, 5);
    expect(fitScale(960, 540, 1920, 1080, false)).toBeCloseTo(0.49, 5);
  });
});
