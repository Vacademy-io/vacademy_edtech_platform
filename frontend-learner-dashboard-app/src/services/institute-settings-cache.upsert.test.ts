import { beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => new Map<string, string>());
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefs.set(key, value);
    },
  },
}));
vi.mock("./signup-api", () => ({ getInstituteDetails: async () => null }));

import { upsertInstituteDetails } from "./institute-settings-cache";

const saved = () => JSON.parse(prefs.get("InstituteDetails") ?? "{}");

describe("upsertInstituteDetails", () => {
  beforeEach(() => prefs.clear());

  it("merges writes for the same institute", async () => {
    await upsertInstituteDetails({ id: "a", subjects: ["kept"] });
    await upsertInstituteDetails({ id: "a", name: "A" });
    expect(saved()).toEqual({ id: "a", subjects: ["kept"], name: "A" });
  });

  it("merges a write that names no institute", async () => {
    await upsertInstituteDetails({ id: "a" });
    await upsertInstituteDetails({ name: "A" });
    expect(saved()).toEqual({ id: "a", name: "A" });
  });

  it("does not carry fields over to another institute", async () => {
    await upsertInstituteDetails({ id: "a", playStoreAppLink: "link of a", name: "A" });
    await upsertInstituteDetails({ id: "b", institute_name: "B" });
    expect(saved()).toEqual({ id: "b", institute_name: "B" });
  });
});
