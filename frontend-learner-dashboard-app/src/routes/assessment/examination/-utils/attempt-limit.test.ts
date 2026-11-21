import { describe, expect, it } from "vitest";
import { summarizeAttempts, UNLIMITED_ATTEMPTS } from "./attempt-limit";

describe("summarizeAttempts", () => {
  it("reads the limit written for mock and practice tests as no limit", () => {
    expect(summarizeAttempts(0, UNLIMITED_ATTEMPTS)).toEqual({ kind: "unlimited" });
    expect(summarizeAttempts(1, 100000)).toEqual({ kind: "unlimited" });
  });

  it("gives the allowance while no attempt has been used", () => {
    expect(summarizeAttempts(0, 2)).toEqual({ kind: "unused", max: 2 });
  });

  it("gives used out of allowed once an attempt has been used", () => {
    expect(summarizeAttempts(1, 3)).toEqual({ kind: "used", used: 1, max: 3 });
    expect(summarizeAttempts(2, 2)).toEqual({ kind: "used", used: 2, max: 2 });
  });

  it("keeps a real limit just below the sentinel", () => {
    expect(summarizeAttempts(1, 99999)).toEqual({ kind: "used", used: 1, max: 99999 });
  });

  it("says nothing when no limit is known", () => {
    expect(summarizeAttempts(0, 0)).toBeNull();
  });
});
