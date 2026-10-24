import { describe, expect, it } from "vitest";
import { cropShare, resolveFit } from "./fit-mode";

const wide = { width: 1600, height: 900 }; // 16:9
const card = { width: 320, height: 180 }; // 16:9 box

describe("cropShare", () => {
  it("is what filling cuts off: nothing for the box's own shape, more the further apart", () => {
    expect(cropShare(wide, card)).toBeCloseTo(0);
    expect(cropShare({ width: 1200, height: 900 }, card)).toBeCloseTo(0.25); // 4:3 in 16:9
    expect(cropShare({ width: 900, height: 900 }, card)).toBeCloseTo(0.4375); // square in 16:9
    expect(cropShare(wide, { width: 200, height: 200 })).toBeCloseTo(0.4375); // 16:9 in a square tile
  });
});

describe("resolveFit", () => {
  it("fills while filling cuts little, and fits once it would cut more than maxCrop", () => {
    expect(resolveFit("auto", wide, card)).toBe("cover");
    expect(resolveFit("auto", { width: 1200, height: 900 }, card)).toBe("cover");
    expect(resolveFit("auto", { width: 900, height: 900 }, card)).toBe("contain");
    expect(resolveFit("auto", { width: 600, height: 1200 }, card)).toBe("contain"); // a poster
    expect(resolveFit("auto", { width: 1200, height: 900 }, card, 0.2)).toBe("contain");
  });

  it("fills until both the image and the box are known, as sections always did", () => {
    expect(resolveFit("auto", null, card)).toBe("cover");
    expect(resolveFit("auto", { width: 900, height: 900 }, null)).toBe("cover");
    expect(resolveFit("auto", { width: 900, height: 900 }, { width: 0, height: 0 })).toBe("cover");
    expect(resolveFit("auto", { width: 0, height: 0 }, card)).toBe("cover");
  });

  it("keeps a section's explicit choice", () => {
    expect(resolveFit("cover", { width: 900, height: 900 }, card)).toBe("cover");
    expect(resolveFit("contain", wide, card)).toBe("contain");
  });
});
