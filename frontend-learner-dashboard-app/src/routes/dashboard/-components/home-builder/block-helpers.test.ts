import { describe, expect, it } from "vitest";
import { isPlainNotice, priceLabel } from "./block-helpers";
import { altOf, srcSetOf } from "./image-sources";

describe("priceLabel", () => {
  it("Free for is_free or a zero price", () => {
    expect(priceLabel({ is_free: true, price: 100, currency: "INR" }, "en-IN", "Free")).toBe("Free");
    expect(priceLabel({ price: 0, currency: "INR" }, "en-IN", "Free")).toBe("Free");
  });
  it("formats with the currency", () => {
    expect(priceLabel({ price: 4999, currency: "INR" }, "en-IN", "Free")).toBe("₹4,999");
    expect(priceLabel({ price: 19.5, currency: "USD" }, "en-US", "Free")).toBe("$19.50");
  });
  it("no chip without a price", () => {
    expect(priceLabel({ price: null }, "en", "Free")).toBeNull();
  });
});

describe("isPlainNotice (today's custom card)", () => {
  it("is plain only without image, ack, tone and dismiss", () => {
    expect(isPlainNotice({ title: "x", tone: "NEUTRAL", dismissible: false, require_ack: false })).toBe(true);
    expect(isPlainNotice({ title: "x" })).toBe(true);
    expect(isPlainNotice({ title: "x", tone: "INFO" })).toBe(false);
    expect(isPlainNotice({ title: "x", dismissible: true })).toBe(false);
    expect(isPlainNotice({ title: "x", require_ack: true })).toBe(false);
    expect(isPlainNotice({ title: "x", image: { url: "https://cdn/x.png" } })).toBe(false);
  });
});

describe("image sources", () => {
  it("builds a width-sorted srcset from renditions", () => {
    expect(srcSetOf({ url: "o", renditions: { "960": "c", "320": "a", "640": "b" } })).toBe("a 320w, b 640w, c 960w");
    expect(srcSetOf({ url: "o" })).toBe("");
  });
  it("alt is empty for decorative images", () => {
    expect(altOf({ url: "o", alt: "Diwali sale", decorative: true })).toBe("");
    expect(altOf({ url: "o", alt: " Diwali sale " })).toBe("Diwali sale");
  });
});
