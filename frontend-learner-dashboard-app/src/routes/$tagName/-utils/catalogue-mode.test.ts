import { describe, expect, it } from "vitest";
import { modeOfLevelFilter, rentLocationCityOf } from "./catalogue-mode";

describe("rentLocationCityOf", () => {
  it("returns the configured city, trimmed", () => {
    expect(rentLocationCityOf({ rentLocationCity: "  Pune " })).toBe("Pune");
  });

  it("returns nothing (no location question) when the catalogue names no city", () => {
    expect(rentLocationCityOf({})).toBe("");
    expect(rentLocationCityOf({ rentLocationCity: "   " })).toBe("");
    expect(rentLocationCityOf({ rentLocationCity: 42 })).toBe("");
    expect(rentLocationCityOf(null)).toBe("");
    expect(rentLocationCityOf(undefined)).toBe("");
  });
});

describe("modeOfLevelFilter", () => {
  it("reads rent from any level name containing it", () => {
    expect(modeOfLevelFilter("Rent")).toBe("rent");
    expect(modeOfLevelFilter("Buy")).toBe("buy");
    expect(modeOfLevelFilter(null)).toBe("buy");
  });
});
