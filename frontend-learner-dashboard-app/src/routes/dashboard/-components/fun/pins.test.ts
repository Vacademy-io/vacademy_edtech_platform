import { describe, expect, it } from "vitest";
import { pinTimeLeft, pinTone } from "./pins";

describe("pinTone", () => {
  it("maps each priority, and anything else to normal", () => {
    expect(pinTone("HIGH")).toBe("high");
    expect(pinTone("MEDIUM")).toBe("medium");
    expect(pinTone("LOW")).toBe("low");
    expect(pinTone(undefined)).toBe("normal");
    expect(pinTone("URGENT")).toBe("normal");
  });
});

describe("pinTimeLeft", () => {
  const now = Date.UTC(2026, 10, 6, 4, 30);
  const at = (ms: number) => new Date(now + ms).toISOString();
  it("counts whole days, then whole hours, then under an hour", () => {
    expect(pinTimeLeft(at(2 * 86_400_000 + 5_000), now)).toEqual({ unit: "days", count: 2 });
    expect(pinTimeLeft(at(5 * 3_600_000 + 5_000), now)).toEqual({ unit: "hours", count: 5 });
    expect(pinTimeLeft(at(20 * 60_000), now)).toEqual({ unit: "lessThanHour" });
  });
  it("says nothing once the pin is past, or without a readable end", () => {
    expect(pinTimeLeft(at(-1_000), now)).toBeNull();
    expect(pinTimeLeft(undefined, now)).toBeNull();
    expect(pinTimeLeft("not a date", now)).toBeNull();
  });
});
