import { describe, expect, it } from "vitest";
import { footInset, pageTop, shouldPin } from "./foot-pin";

const box = (top: number, bottom: number, width: number) => ({ top, bottom, width, height: bottom - top });

describe("footInset", () => {
  it("is the height of a full-width bar on the bottom edge", () => {
    expect(footInset([box(754, 844, 390)], 390, 844)).toBe(90);
  });

  it("is zero when nothing is pinned there", () => {
    expect(footInset([], 390, 844)).toBe(0);
  });

  it("ignores narrow floating buttons, boxes off the edge and full-screen layers", () => {
    expect(footInset([box(780, 836, 56)], 390, 844)).toBe(0);
    expect(footInset([box(600, 700, 390)], 390, 844)).toBe(0);
    expect(footInset([box(0, 844, 390)], 390, 844)).toBe(0);
  });

  it("takes the tallest of several bars", () => {
    expect(footInset([box(784, 844, 390), box(740, 844, 380)], 390, 844)).toBe(104);
  });
});

describe("shouldPin", () => {
  it("pins while the row and the bar take at most a third of the screen", () => {
    expect(shouldPin(92, 90, 844)).toBe(true);
    expect(shouldPin(92, 90, 640)).toBe(true);
    expect(shouldPin(92, 0, 800)).toBe(true);
  });

  it("leaves the row in the page when it would take more", () => {
    expect(shouldPin(160, 130, 844)).toBe(false);
    expect(shouldPin(92, 90, 500)).toBe(false);
  });

  it("never pins a row that has no size yet", () => {
    expect(shouldPin(0, 0, 844)).toBe(false);
  });
});

describe("pageTop", () => {
  it("is where the root starts on the page, whatever the scroll", () => {
    expect(pageTop(12, 0)).toBe(12);
    expect(pageTop(-188, 200)).toBe(12);
    expect(pageTop(12.4, 0)).toBe(12);
  });

  it("is never negative", () => {
    expect(pageTop(-40, 0)).toBe(0);
  });
});
