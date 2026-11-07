import { describe, expect, it } from "vitest";
import { contentForSlide } from "./slide-load-guard";

describe("contentForSlide", () => {
  it("shows content built for the active slide", () => {
    expect(contentForSlide({ slideId: "a", node: "A" }, "a")).toBe("A");
  });

  it("shows nothing as soon as another slide becomes active", () => {
    expect(contentForSlide({ slideId: "a", node: "A" }, "b")).toBeNull();
  });

  it("shows nothing before anything is built", () => {
    expect(contentForSlide(null, "a")).toBeNull();
    expect(contentForSlide(null, null)).toBeNull();
  });

  it("keeps the no-slide state only while no slide is active", () => {
    expect(contentForSlide({ slideId: null, node: "empty" }, null)).toBe("empty");
    expect(contentForSlide({ slideId: null, node: "empty" }, "a")).toBeNull();
  });
});
