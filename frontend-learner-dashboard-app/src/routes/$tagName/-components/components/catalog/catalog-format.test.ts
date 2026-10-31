import { describe, expect, it } from "vitest";
import { formatAmountLabel, formatRangeLabel } from "./catalog-format";

describe("formatAmountLabel", () => {
  it("formats whole rupee amounts without decimals", () => {
    expect(formatAmountLabel(1000, "INR", "en")).toBe("₹1,000");
    expect(formatAmountLabel(1000, undefined, "hi")).toBe("₹1,000");
  });

  it("keeps decimals for fractional amounts and other currencies", () => {
    expect(formatAmountLabel(499.5, "INR", "en")).toBe("₹499.50");
    expect(formatAmountLabel(20, "usd", "en")).toBe("$20");
  });

  it("falls back for an unknown currency code", () => {
    expect(formatAmountLabel(10, "NOT-A-CODE", "en")).toBe("NOT-A-CODE 10");
  });
});

describe("formatRangeLabel", () => {
  it("covers min-max, min only and max only", () => {
    expect(formatRangeLabel({ min: 500, max: 2000 }, "INR", "en")).toBe("₹500 – ₹2,000");
    expect(formatRangeLabel({ min: 500 }, "INR", "en")).toBe("≥ ₹500");
    expect(formatRangeLabel({ max: 2000 }, "INR", "en")).toBe("≤ ₹2,000");
  });
});
