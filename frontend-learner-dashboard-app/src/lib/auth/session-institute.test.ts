// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => new Map<string, string>());
const fetchDetails = vi.hoisted(() => vi.fn());
const token = vi.hoisted(() => ({
  access: null as string | null,
  refresh: null as string | null,
  institutes: [] as string[],
  expired: false,
}));
const arrival = vi.hoisted(() => ({ tokens: false }));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefs.set(key, value);
    },
  },
}));
vi.mock("@/lib/auth/sessionUtility", () => ({
  getTokenFromStorage: async (key: string) =>
    key === "accessToken" ? token.access : token.refresh,
  getTokenDecodedData: () => ({
    user: "user-1",
    authorities: Object.fromEntries(token.institutes.map((id: string) => [id, {}])),
  }),
  isTokenExpired: () => token.expired,
}));
vi.mock("@/lib/auth/arrival-tokens", () => ({ hasArrivalTokens: () => arrival.tokens }));
vi.mock("@/lib/auth/post-login-redirect", () => ({ INSTITUTE_SELECTED_EVENT: "picked" }));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  notifyNamingSettingsUpdated: () => {},
}));
vi.mock("@/services/fetchAndStoreInstituteDetails", () => ({
  fetchAndStoreInstituteDetails: fetchDetails,
}));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: async () => "" }));
vi.mock("@/lib/auth/axiosInstance", () => ({ default: {} }));
vi.mock("@/utils/platform-flavor", () => ({ getDomainAndSubdomain: async () => ({}) }));
vi.mock("@/utils/geo-country", () => ({ detectVisitorCountry: () => null }));
vi.mock("@/lib/student-preview", () => ({ readThemeRoleSettingsRaw: () => null }));

const OWN = "own-institute";
const HOST = "host-institute";

const details = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  institute_name: `name of ${id}`,
  institute_theme_code: `theme-${id}`,
  institute_settings_json: JSON.stringify({
    setting: {
      NAMING_SETTING: { data: { data: [{ key: "Course", customValue: `word of ${id}` }] } },
    },
  }),
  ...extra,
});

const signIn = (institutes: string[] = [OWN]) => {
  token.access = "access";
  token.refresh = "refresh";
  token.institutes = institutes;
  prefs.set("StudentDetails", "{}");
};

/** What a sign-in saves: both copies of the details agree. */
const saveSignedInState = (id: string) => {
  const value = JSON.stringify(details(id));
  prefs.set("InstituteDetails", value);
  prefs.set("InstituteId", id);
  localStorage.setItem("InstituteDetails", value);
  localStorage.setItem("InstituteId", id);
  localStorage.setItem("theme-code", `theme-${id}`);
  localStorage.setItem("namingSettings", JSON.stringify([{ key: "Course", customValue: `word of ${id}` }]));
};

/** Then host routing writes over the Preferences side and the branding caches. */
const writeHostOver = (hostId: string) => {
  prefs.set(
    "InstituteDetails",
    JSON.stringify({ ...JSON.parse(prefs.get("InstituteDetails") ?? "{}"), id: hostId, name: "host name", institute_theme_code: "host-theme" }),
  );
  prefs.set("InstituteId", hostId);
  localStorage.setItem("theme-code", "host-theme");
  localStorage.setItem("namingSettings", JSON.stringify([{ key: "Course", customValue: "host word" }]));
  localStorage.setItem("TabBranding", JSON.stringify({ tabText: "host tab", tabIconUrl: null }));
  localStorage.setItem(
    "InstituteBranding",
    JSON.stringify({ instituteId: hostId, instituteName: "host name", hideInstituteName: true }),
  );
};

const load = async () => {
  vi.resetModules();
  return import("./session-institute");
};

beforeEach(() => {
  prefs.clear();
  localStorage.clear();
  fetchDetails.mockReset();
  token.access = null;
  token.refresh = null;
  token.institutes = [];
  token.expired = false;
  arrival.tokens = false;
});

afterEach(() => vi.restoreAllMocks());

describe("pickSessionInstitute", () => {
  it("has no answer without institutes on the token", async () => {
    const { pickSessionInstitute } = await load();
    expect(pickSessionInstitute({ tokenInstitutes: [], signedInCopyId: "a" })).toBeNull();
  });

  it("prefers the sign-in copy when the token names it", async () => {
    const { pickSessionInstitute } = await load();
    expect(
      pickSessionInstitute({ tokenInstitutes: ["a", "b"], signedInCopyId: "b", selectedId: "a" }),
    ).toBe("b");
  });

  it("trusts the sign-in copy for an institute newer than the token when the student record names it", async () => {
    const { pickSessionInstitute } = await load();
    expect(
      pickSessionInstitute({
        tokenInstitutes: ["a"],
        signedInCopyId: "b",
        studentInstituteId: "b",
        selectedId: "a",
      }),
    ).toBe("b");
  });

  it("ignores a sign-in copy that neither the token nor the student record names", async () => {
    const { pickSessionInstitute } = await load();
    expect(
      pickSessionInstitute({ tokenInstitutes: ["a"], signedInCopyId: "b", studentInstituteId: "a" }),
    ).toBe("a");
    expect(pickSessionInstitute({ tokenInstitutes: ["a"], signedInCopyId: "b" })).toBe("a");
  });

  it("falls back through the stored values that are on the token", async () => {
    const { pickSessionInstitute } = await load();
    const tokenInstitutes = ["a", "b"];
    expect(pickSessionInstitute({ tokenInstitutes, selectedId: "b", storedDetailsId: "a" })).toBe("b");
    expect(pickSessionInstitute({ tokenInstitutes, selectedId: "x", storedDetailsId: "b" })).toBe("b");
    expect(pickSessionInstitute({ tokenInstitutes, storedDetailsId: "x", storedInstituteId: "b" })).toBe("b");
    expect(pickSessionInstitute({ tokenInstitutes, storedDetailsId: "x", storedInstituteId: "y" })).toBe("a");
  });
});

describe("isLiveSession", () => {
  it("needs an access token that is valid or can be renewed", async () => {
    const { isLiveSession } = await load();
    expect(isLiveSession(null, "refresh")).toBe(false);
    expect(isLiveSession("access", "refresh")).toBe(true);
    token.expired = true;
    expect(isLiveSession("access", "refresh")).toBe(true);
    expect(isLiveSession("access", null)).toBe(false);
  });
});

describe("readSessionInstituteId", () => {
  it("is null when signed out, whatever host routing has saved", async () => {
    saveSignedInState(HOST);
    const { readSessionInstituteId } = await load();
    expect(await readSessionInstituteId()).toBeNull();
  });

  it("is the learner's institute when host routing wrote over Preferences", async () => {
    signIn();
    saveSignedInState(OWN);
    writeHostOver(HOST);
    const { readSessionInstituteId } = await load();
    expect(await readSessionInstituteId()).toBe(OWN);
  });

  it("is the learner's institute when the sign-in copy holds another institute", async () => {
    signIn();
    saveSignedInState(OWN);
    localStorage.setItem("InstituteDetails", JSON.stringify(details(HOST)));
    prefs.set("StudentDetails", JSON.stringify({ institute_id: OWN }));
    const { readSessionInstituteId } = await load();
    expect(await readSessionInstituteId()).toBe(OWN);
  });

  it("keeps an institute the learner enrolled in after the token was issued", async () => {
    signIn();
    saveSignedInState(HOST);
    prefs.set("StudentDetails", JSON.stringify({ institute_id: HOST }));
    const { readSessionInstituteId } = await load();
    expect(await readSessionInstituteId()).toBe(HOST);
  });

  it("does not take the host for the learner's institute when nothing else is saved", async () => {
    signIn(["first", "second"]);
    prefs.set("InstituteDetails", JSON.stringify({ id: HOST }));
    prefs.set("InstituteId", HOST);
    const { readSessionInstituteId } = await load();
    expect(await readSessionInstituteId()).toBe("first");
  });
});

describe("repairSessionInstituteState", () => {
  it("leaves a healthy learner untouched and asks the server nothing", async () => {
    signIn();
    saveSignedInState(OWN);
    localStorage.setItem("InstituteBranding", JSON.stringify({ instituteId: OWN, hideInstituteName: true }));
    const before = JSON.stringify([[...prefs], { ...localStorage }]);
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    expect(JSON.stringify([[...prefs], { ...localStorage }])).toBe(before);
    expect(fetchDetails).not.toHaveBeenCalled();
  });

  it("does nothing for a signed-out visitor", async () => {
    writeHostOver(HOST);
    const before = JSON.stringify({ ...localStorage });
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });

  it("leaves saved state alone while an arrival link is signing the learner in", async () => {
    signIn();
    saveSignedInState(OWN);
    writeHostOver(HOST);
    arrival.tokens = true;
    const before = JSON.stringify([[...prefs], { ...localStorage }]);
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    expect(JSON.stringify([[...prefs], { ...localStorage }])).toBe(before);
    expect(fetchDetails).not.toHaveBeenCalled();
  });

  it("does nothing while sign-in has not reached the learner record yet", async () => {
    token.access = "access";
    token.refresh = "refresh";
    token.institutes = [OWN];
    prefs.set("InstituteDetails", JSON.stringify(details(HOST)));
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    expect(JSON.parse(prefs.get("InstituteDetails") ?? "{}").id).toBe(HOST);
    expect(fetchDetails).not.toHaveBeenCalled();
  });

  it("restores identity, words, colours and branding from the local copy", async () => {
    signIn();
    saveSignedInState(OWN);
    writeHostOver(HOST);
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();

    const restored = JSON.parse(prefs.get("InstituteDetails") ?? "{}");
    expect(restored.id).toBe(OWN);
    expect(restored.name).toBeUndefined();
    expect(prefs.get("InstituteId")).toBe(OWN);
    expect(localStorage.getItem("theme-code")).toBe(`theme-${OWN}`);
    expect(JSON.parse(localStorage.getItem("namingSettings") ?? "[]")[0].customValue).toBe(`word of ${OWN}`);
    const branding = JSON.parse(localStorage.getItem("InstituteBranding") ?? "{}");
    expect(branding.instituteId).toBe(OWN);
    expect(branding.instituteName).toBe(`name of ${OWN}`);
    expect(branding.hideInstituteName).toBeNull();
    expect(JSON.parse(localStorage.getItem("TabBranding") ?? "{}").tabText).toBe(`name of ${OWN}`);
    expect(fetchDetails).not.toHaveBeenCalled();
  });

  it("restores a custom-colour institute through the custom colour key", async () => {
    signIn();
    saveSignedInState(OWN);
    const own = JSON.stringify(details(OWN, { institute_theme_code: "#123456" })); // design-lint-ignore: stored value under test
    localStorage.setItem("InstituteDetails", own);
    writeHostOver(HOST);
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    expect(localStorage.getItem("theme-custom-color")).toBe("#123456"); // design-lint-ignore: stored value under test
    expect(localStorage.getItem("theme-code")).toBeNull();
  });

  it("repairs branding and words left behind by a later sign-in without touching colours", async () => {
    signIn();
    saveSignedInState(OWN);
    localStorage.setItem("InstituteBranding", JSON.stringify({ instituteId: HOST, instituteName: "host name" }));
    localStorage.setItem("namingSettings", JSON.stringify([{ key: "Course", customValue: "host word" }]));
    prefs.set("InstituteDetails", JSON.stringify({ ...details(OWN), name: "host name" }));
    localStorage.setItem("theme-code", "institute-picked-later");
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    expect(JSON.parse(localStorage.getItem("InstituteBranding") ?? "{}").instituteId).toBe(OWN);
    expect(JSON.parse(prefs.get("InstituteDetails") ?? "{}").name).toBeUndefined();
    expect(JSON.parse(localStorage.getItem("namingSettings") ?? "[]")[0].customValue).toBe(`word of ${OWN}`);
    expect(localStorage.getItem("theme-code")).toBe("institute-picked-later");
  });

  it("clears another institute's words, roles and languages when the learner's institute has no settings", async () => {
    signIn();
    saveSignedInState(OWN);
    const bare = JSON.stringify(details(OWN, { institute_settings_json: null }));
    prefs.set("InstituteDetails", bare);
    localStorage.setItem("InstituteDetails", bare);
    localStorage.setItem("InstituteBranding", JSON.stringify({ instituteId: HOST, instituteName: "host name" }));
    localStorage.setItem("namingSettings", JSON.stringify([{ key: "Course", customValue: "host word" }]));
    localStorage.setItem("themeRoleSettings", JSON.stringify({ roles: { nav: {} } }));
    localStorage.setItem("languageSetting", JSON.stringify({ enabled_locales: ["ar"] }));
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    expect(localStorage.getItem("namingSettings")).toBeNull();
    expect(localStorage.getItem("themeRoleSettings")).toBeNull();
    expect(localStorage.getItem("languageSetting")).toBeNull();
  });

  it("restores the learner's own roles and languages from the local copy", async () => {
    signIn();
    saveSignedInState(OWN);
    const copy = JSON.stringify(
      details(OWN, {
        institute_settings_json: JSON.stringify({
          setting: {
            THEME_SETTING: { data: { roles: { nav: { surface: "own" } } } },
            LANGUAGE_SETTING: { data: { enabled_locales: ["en", "fr"] } },
          },
        }),
      }),
    );
    prefs.set("InstituteDetails", copy);
    localStorage.setItem("InstituteDetails", copy);
    localStorage.setItem("InstituteBranding", JSON.stringify({ instituteId: HOST, instituteName: "host name" }));
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    expect(JSON.parse(localStorage.getItem("themeRoleSettings") ?? "{}").roles.nav.surface).toBe("own");
    expect(JSON.parse(localStorage.getItem("languageSetting") ?? "{}").enabled_locales).toEqual(["en", "fr"]);
  });

  it("replaces a sign-in copy of another institute by asking the server", async () => {
    signIn();
    saveSignedInState(OWN);
    localStorage.setItem("InstituteDetails", JSON.stringify(details(HOST)));
    writeHostOver(HOST);
    prefs.set("StudentDetails", JSON.stringify({ institute_id: OWN }));
    fetchDetails.mockResolvedValue(details(OWN));
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    expect(fetchDetails).toHaveBeenCalledWith(OWN, "user-1");
    expect(localStorage.getItem("theme-code")).toBe(`theme-${OWN}`);
    expect(JSON.parse(localStorage.getItem("InstituteBranding") ?? "{}").instituteId).toBe(OWN);
  });

  it("replaces a loading placeholder held in the branding cache", async () => {
    signIn();
    saveSignedInState(OWN);
    localStorage.setItem(
      "InstituteBranding",
      JSON.stringify({ instituteId: OWN, instituteName: "Loading...", hideInstituteName: true }),
    );
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    const branding = JSON.parse(localStorage.getItem("InstituteBranding") ?? "{}");
    expect(branding.instituteName).toBe(`name of ${OWN}`);
    expect(branding.hideInstituteName).toBe(true);
  });

  it("settles after one run", async () => {
    signIn();
    saveSignedInState(OWN);
    writeHostOver(HOST);
    const first = await load();
    await first.repairSessionInstituteState();
    const after = JSON.stringify([[...prefs], { ...localStorage }]);
    const second = await load();
    await second.repairSessionInstituteState();
    expect(JSON.stringify([[...prefs], { ...localStorage }])).toBe(after);
  });

  it("asks the server when no usable copy is saved, and drops the host's words meanwhile", async () => {
    signIn();
    prefs.set("InstituteDetails", JSON.stringify(details(HOST)));
    prefs.set("InstituteId", HOST);
    localStorage.setItem("theme-code", "host-theme");
    localStorage.setItem("namingSettings", JSON.stringify([{ key: "Course", customValue: "host word" }]));
    fetchDetails.mockResolvedValue(details(OWN));
    const repainted = vi.fn();
    window.addEventListener("picked", repainted);
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    window.removeEventListener("picked", repainted);
    expect(fetchDetails).toHaveBeenCalledWith(OWN, "user-1");
    expect(localStorage.getItem("namingSettings")).toBeNull();
    expect(localStorage.getItem("theme-code")).toBe(`theme-${OWN}`);
    expect(repainted).toHaveBeenCalledOnce();
  });

  it("stops showing the other institute even when the server cannot answer", async () => {
    signIn();
    prefs.set("InstituteDetails", JSON.stringify(details(HOST)));
    prefs.set("InstituteId", HOST);
    localStorage.setItem(
      "InstituteBranding",
      JSON.stringify({ instituteId: HOST, instituteName: "host name", hideInstituteName: true }),
    );
    fetchDetails.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    const branding = JSON.parse(localStorage.getItem("InstituteBranding") ?? "{}");
    expect(branding.instituteId).toBe(OWN);
    expect(branding.instituteName).toBeNull();
    expect(branding.hideInstituteName).toBeNull();
  });

  it("refills a placeholder left by a sign-in whose fetch failed", async () => {
    signIn();
    saveSignedInState(OWN);
    const placeholder = JSON.stringify({ id: OWN, institute_name: "Institute", institute_theme_code: "#000000" }); // design-lint-ignore: stored value under test
    prefs.set("InstituteDetails", placeholder);
    localStorage.setItem("InstituteDetails", placeholder);
    fetchDetails.mockResolvedValue(details(OWN));
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    expect(fetchDetails).toHaveBeenCalledOnce();
  });

  it("does not treat an institute that is really called Institute as unfinished", async () => {
    signIn();
    saveSignedInState(OWN);
    const real = JSON.stringify({ id: OWN, institute_name: "Institute", institute_theme_code: "teal" });
    prefs.set("InstituteDetails", real);
    localStorage.setItem("InstituteDetails", real);
    const { repairSessionInstituteState } = await load();
    await repairSessionInstituteState();
    expect(fetchDetails).not.toHaveBeenCalled();
  });

  it("never throws into app start", async () => {
    signIn();
    saveSignedInState(OWN);
    writeHostOver(HOST);
    fetchDetails.mockRejectedValue(new Error("down"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { repairSessionInstituteState } = await load();
    await expect(repairSessionInstituteState()).resolves.toBeUndefined();
  });
});
