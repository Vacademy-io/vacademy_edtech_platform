import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/sessionUtility", () => ({
  getTokenDecodedData: vi.fn(),
  getTokenFromStorage: vi.fn(),
}));

const { getSubjectNameById } = await import("./helper");

describe("getSubjectNameById", () => {
  it("returns the subject's name", () => {
    expect(getSubjectNameById([{ id: "s1", subject_name: "Physics" }], "s1")).toBe("Physics");
  });

  it("returns nothing when the subject is unknown, so callers can drop it", () => {
    expect(getSubjectNameById([], "s1")).toBe("");
    expect(getSubjectNameById([{ id: "s1", subject_name: "Physics" }], null)).toBe("");
  });
});
