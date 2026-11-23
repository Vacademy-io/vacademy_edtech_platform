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

import { upsertLearnerSettings } from "./learner-settings-cache";

const read = (id: string) => JSON.parse(prefs.get(`LEARNER_${id}`) ?? "null");

describe("upsertLearnerSettings", () => {
  beforeEach(() => prefs.clear());

  it("keeps the policy URLs and auth flags domain routing stored", async () => {
    // What use-domain-routing writes for a white-label portal.
    prefs.set(
      "LEARNER_inst-1",
      JSON.stringify({
        privacyPolicyUrl: "https://www.cbspd.com/privacy-policy",
        termsAndConditionUrl: "https://www.cbspd.com/terms-and-service",
        allowSignup: false,
        allowGoogleAuth: true,
        theme: "old-theme",
      }),
    );

    // What a public form page (invite, enquiry, ...) knows and writes.
    await upsertLearnerSettings("inst-1", { tabText: "CBS", theme: "primary" });

    expect(read("inst-1")).toEqual({
      privacyPolicyUrl: "https://www.cbspd.com/privacy-policy",
      termsAndConditionUrl: "https://www.cbspd.com/terms-and-service",
      allowSignup: false,
      allowGoogleAuth: true,
      tabText: "CBS",
      theme: "primary",
    });
  });

  it("creates the record when nothing was stored yet", async () => {
    await upsertLearnerSettings("inst-2", { tabText: "New" });
    expect(read("inst-2")).toEqual({ tabText: "New" });
  });

  it("starts over when the stored record is not valid JSON", async () => {
    prefs.set("LEARNER_inst-3", "{not json");
    await upsertLearnerSettings("inst-3", { tabText: "Fresh" });
    expect(read("inst-3")).toEqual({ tabText: "Fresh" });
  });

  it("starts over when the stored record is not an object", async () => {
    prefs.set("LEARNER_inst-4", JSON.stringify(["x"]));
    await upsertLearnerSettings("inst-4", { tabText: "Fresh" });
    expect(read("inst-4")).toEqual({ tabText: "Fresh" });
  });

  it("does not touch another institute's record", async () => {
    prefs.set("LEARNER_other", JSON.stringify({ privacyPolicyUrl: "https://other.example/p" }));
    await upsertLearnerSettings("inst-5", { tabText: "Mine" });
    expect(read("other")).toEqual({ privacyPolicyUrl: "https://other.example/p" });
  });
});
