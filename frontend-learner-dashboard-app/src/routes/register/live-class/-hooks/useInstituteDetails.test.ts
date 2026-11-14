import { beforeEach, describe, expect, it, vi } from "vitest";

const prefGet = vi.fn();
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: (...args: unknown[]) => prefGet(...args) },
}));
vi.mock("@/services/upload_file", () => ({
  getPublicUrl: vi.fn(async (id: string) => `https://cdn.test/${id}.png`),
}));

import { getInstituteDetails } from "./useInstituteDetails";

/**
 * Regression cover for a white screen on /register: a corrupt "InstituteDetails"
 * entry in Preferences threw out of this queryFn and left #root empty.
 * Reproduced on the live page by seeding localStorage with "{not json" —
 * rootLen went 18251 -> 0 while a clean profile rendered normally.
 */
describe("getInstituteDetails", () => {
  beforeEach(() => prefGet.mockReset());

  it("returns null when nothing is cached", async () => {
    prefGet.mockResolvedValue({ value: null });
    await expect(getInstituteDetails()).resolves.toBeNull();
  });

  it("returns null instead of throwing on a truncated entry", async () => {
    prefGet.mockResolvedValue({ value: "{not json" });
    await expect(getInstituteDetails()).resolves.toBeNull();
  });

  it("returns null on a literal null entry", async () => {
    prefGet.mockResolvedValue({ value: "null" });
    await expect(getInstituteDetails()).resolves.toBeNull();
  });

  it("returns null on a non-object entry", async () => {
    prefGet.mockResolvedValue({ value: '"just a string"' });
    await expect(getInstituteDetails()).resolves.toBeNull();
  });

  it("still resolves a well-formed entry, logo included", async () => {
    prefGet.mockResolvedValue({
      value: JSON.stringify({
        id: "inst-1",
        institute_name: "Elevate",
        institute_logo_file_id: "file-1",
      }),
    });
    await expect(getInstituteDetails()).resolves.toMatchObject({
      id: "inst-1",
      institute_name: "Elevate",
      logoUrl: "https://cdn.test/file-1.png",
      homeIconClickRoute: null,
    });
  });

  it("resolves an entry with no logo without calling the CDN", async () => {
    prefGet.mockResolvedValue({
      value: JSON.stringify({
        id: "inst-2",
        institute_name: "Elevate",
        institute_logo_file_id: null,
      }),
    });
    await expect(getInstituteDetails()).resolves.toMatchObject({
      logoUrl: null,
    });
  });
});
