// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => new Map<string, string>());
const request = vi.hoisted(() => vi.fn());
const adopt = vi.hoisted(() => vi.fn());
const scope = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefs.set(key, value);
    },
  },
}));
vi.mock("@/lib/auth/axiosInstance", () => ({ default: request }));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  notifyNamingSettingsUpdated: () => {},
}));
vi.mock("@/services/domain-routing", () => ({ adoptInstituteBranding: adopt }));
vi.mock("@/components/common/layout-container/services/navbar-services", () => ({
  setPublicInstituteDetailsScope: scope,
}));
vi.mock("@/services/push-notifications/push-notification-service", () => ({
  pushNotificationService: { registerStoredToken: async () => {} },
}));

import { fetchAndStoreInstituteDetails } from "./fetchAndStoreInstituteDetails";

const OWN = "own-institute";
const WORDS = [{ key: "Course", customValue: "own word" }];
const details = (settings: unknown) => ({
  id: OWN,
  institute_name: "Own",
  institute_theme_code: "teal",
  institute_settings_json: settings,
});
const leftBehind = () => {
  localStorage.setItem("namingSettings", JSON.stringify([{ key: "Course", customValue: "host word" }]));
  localStorage.setItem("themeRoleSettings", JSON.stringify({ roles: { nav: {} } }));
  localStorage.setItem("languageSetting", JSON.stringify({ enabled_locales: ["ar"] }));
};
const leftovers = () =>
  ["namingSettings", "themeRoleSettings", "languageSetting"].filter((key) => localStorage.getItem(key));

beforeEach(() => {
  prefs.clear();
  localStorage.clear();
  request.mockReset();
  adopt.mockReset();
  scope.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("fetchAndStoreInstituteDetails after a successful read", () => {
  it("makes branding and the shared details query follow the institute", async () => {
    const answer = details(null);
    request.mockResolvedValue({ status: 200, data: answer });
    await fetchAndStoreInstituteDetails(OWN, "user-1");
    expect(adopt).toHaveBeenCalledOnce();
    expect(adopt.mock.calls[0][0].id).toBe(OWN);
    expect(scope).toHaveBeenCalledWith(OWN);
  });

  it.each([
    ["empty", ""],
    ["missing", undefined],
  ])("hands callers no colour when the institute's colour code is %s", async (_name: string, code: string | undefined) => {
    request.mockResolvedValue({ status: 200, data: { ...details(null), institute_theme_code: code } });
    const result = await fetchAndStoreInstituteDetails(OWN, "user-1");
    expect(result?.institute_theme_code).toBeNull();
    expect(JSON.parse(prefs.get("InstituteDetails") ?? "{}").institute_theme_code).toBeNull();
  });

  it("keeps a chosen colour code", async () => {
    request.mockResolvedValue({ status: 200, data: details(null) });
    const result = await fetchAndStoreInstituteDetails(OWN, "user-1");
    expect(result?.institute_theme_code).toBe("teal");
  });

  it("stores the institute's own words", async () => {
    request.mockResolvedValue({
      status: 200,
      data: details(JSON.stringify({ setting: { NAMING_SETTING: { data: { data: WORDS } } } })),
    });
    await fetchAndStoreInstituteDetails(OWN, "user-1");
    expect(JSON.parse(localStorage.getItem("namingSettings") ?? "[]")).toEqual(WORDS);
  });

  it.each([
    ["no settings at all", null],
    ["an empty value", ""],
    ["settings without these sections", JSON.stringify({ setting: { OTHER: {} } })],
  ])("drops what an earlier institute left behind when the institute has %s", async (_name: string, settings: string | null) => {
    leftBehind();
    request.mockResolvedValue({ status: 200, data: details(settings) });
    await fetchAndStoreInstituteDetails(OWN, "user-1");
    expect(leftovers()).toEqual([]);
  });
});

describe("fetchAndStoreInstituteDetails when the read fails", () => {
  it("keeps a real saved copy and returns it", async () => {
    const saved = JSON.stringify({ id: OWN, institute_name: "Own", institute_theme_code: "teal" });
    prefs.set("InstituteDetails", saved);
    localStorage.setItem("InstituteDetails", saved);
    leftBehind();
    request.mockRejectedValue(new Error("offline"));
    const result = await fetchAndStoreInstituteDetails(OWN, "user-1");
    expect(result?.institute_name).toBe("Own");
    expect(prefs.get("InstituteDetails")).toBe(saved);
    expect(localStorage.getItem("InstituteDetails")).toBe(saved);
    expect(leftovers()).toHaveLength(3);
    expect(adopt).not.toHaveBeenCalled();
  });

  it("does not take a saved copy of another institute for this one", async () => {
    prefs.set("InstituteDetails", JSON.stringify({ id: "other", institute_name: "Other" }));
    request.mockRejectedValue(new Error("offline"));
    const result = await fetchAndStoreInstituteDetails(OWN, "user-1");
    expect(result?.id).toBe(OWN);
    expect(result?.institute_name).toBe("Institute");
    expect(JSON.parse(prefs.get("InstituteDetails") ?? "{}").id).toBe(OWN);
  });

  it("still points the shared details query at this institute", async () => {
    request.mockRejectedValue(new Error("offline"));
    await fetchAndStoreInstituteDetails(OWN, "user-1");
    expect(scope).toHaveBeenCalledWith(OWN);
  });
});
