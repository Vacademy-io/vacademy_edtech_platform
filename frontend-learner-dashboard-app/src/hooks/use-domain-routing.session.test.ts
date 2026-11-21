// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => new Map<string, string>());
const session = vi.hoisted(() => ({ instituteId: null as string | null, active: false }));
const routing = vi.hoisted(() => ({ answer: null as unknown }));
const navigate = vi.hoisted(() => vi.fn());
const setPrimaryColor = vi.hoisted(() => vi.fn());
const applyTabBranding = vi.hoisted(() => vi.fn());
const setCachedInstituteBranding = vi.hoisted(() => vi.fn());
const setInstituteId = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefs.set(key, value);
    },
  },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ state: { matches: [] } }),
}));
vi.mock("@/lib/catalogue-post-route", () => ({ matchesCataloguePost: () => false }));
vi.mock("@/lib/auth/passwordless-landing-routes", () => ({ isPasswordlessLandingRoute: () => false }));
vi.mock("@/lib/auth/session-institute", () => ({
  readSessionInstituteId: async () => session.instituteId,
}));
vi.mock("@/lib/auth/sessionUtility", () => ({
  hasActiveLearnerSession: async () => session.active,
}));
vi.mock("@/services/domain-routing", () => ({
  resolveDomainRouting: async () => routing.answer,
  getCurrentDomainInfo: async () => ({ domain: "host.example", subdomain: "learn" }),
  setCachedInstituteBranding,
  setCachedPreferredCountries: () => {},
  setCachedPhoneCountryGeoMode: () => {},
}));
vi.mock("@/providers/theme/theme-provider", () => ({ useTheme: () => ({ setPrimaryColor }) }));
vi.mock("@/stores/insititute-feature-store", () => ({
  useInstituteFeatureStore: () => ({ setInstituteId }),
}));
vi.mock("@/utils/branding", () => ({ applyTabBranding }));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: async () => "" }));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  notifyNamingSettingsUpdated: () => {},
  NAMING_SETTINGS_UPDATED_EVENT: "naming-settings-updated",
}));
vi.mock("@/components/common/layout-container/sidebar/useSidebar", () => ({
  default: { getState: () => ({ setAppLinks: () => {} }) },
}));

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST = "host-institute";
const OWN = "own-institute";
const answer = (extra: Record<string, unknown> = {}) => ({
  instituteId: HOST,
  instituteName: "Host",
  instituteLogoFileId: null,
  instituteThemeCode: "navy",
  redirect: "/login",
  tabText: "Host tab",
  namingOverrides: { course: "host word" },
  ...extra,
});

let root: Root | null = null;

type RoutingResult = { isVisitor?: boolean; instituteId: string | null; instituteName: string | null };

const mountAt = async (path: string): Promise<RoutingResult> => {
  window.history.pushState({}, "", path);
  vi.resetModules();
  const { useDomainRouting } = await import("./use-domain-routing");
  let latest: RoutingResult | null = null;
  const Probe = () => {
    latest = useDomainRouting() as unknown as RoutingResult;
    return null;
  };
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(createElement(Probe));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  return latest as unknown as RoutingResult;
};

/** What this hook may save about a host: every key that a page reads back as the learner's. */
const savedAsTheLearners = () => ({
  instituteId: prefs.get("InstituteId"),
  details: prefs.get("InstituteDetails"),
  words: localStorage.getItem("namingSettings"),
  branding: setCachedInstituteBranding.mock.calls.length,
  colour: setPrimaryColor.mock.calls.length,
  tab: applyTabBranding.mock.calls.length,
});

beforeEach(() => {
  prefs.clear();
  localStorage.clear();
  session.instituteId = null;
  session.active = false;
  routing.answer = answer();
  [navigate, setPrimaryColor, applyTabBranding, setCachedInstituteBranding, setInstituteId].forEach((fn) =>
    fn.mockReset(),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("useDomainRouting with someone signed in to another institute", () => {
  it("saves nothing as the learner's and still answers about the host", async () => {
    session.instituteId = OWN;
    session.active = true;
    const state = await mountAt("/some-site");
    expect(state.isVisitor).toBe(true);
    expect(state.instituteId).toBe(HOST);
    expect(state.instituteName).toBe("Host");
    expect(savedAsTheLearners()).toEqual({
      instituteId: undefined,
      details: undefined,
      words: null,
      branding: 0,
      colour: 0,
      tab: 0,
    });
  });

  it("still keeps the per-institute settings, which name the host and no one else", async () => {
    session.instituteId = OWN;
    await mountAt("/some-site");
    expect(JSON.parse(prefs.get(`LEARNER_${HOST}`) ?? "{}").theme).toBe("navy");
  });
});

describe("useDomainRouting with a signed-in learner of this institute", () => {
  it("saves the host's details but does not cut the full set of words down to the seed", async () => {
    session.instituteId = HOST;
    session.active = true;
    localStorage.setItem("namingSettings", JSON.stringify([{ key: "Course", customValue: "full set" }]));
    const state = await mountAt("/some-site");
    expect(state.isVisitor).toBe(false);
    expect(prefs.get("InstituteId")).toBe(HOST);
    expect(setPrimaryColor).toHaveBeenCalledWith("navy");
    expect(JSON.parse(localStorage.getItem("namingSettings") ?? "[]")[0].customValue).toBe("full set");
  });
});

describe("useDomainRouting with nobody signed in", () => {
  it("saves the host's details, colours and words for the sign-in page", async () => {
    const state = await mountAt("/some-site");
    expect(state.isVisitor).toBe(false);
    expect(prefs.get("InstituteId")).toBe(HOST);
    expect(JSON.parse(prefs.get("InstituteDetails") ?? "{}").id).toBe(HOST);
    expect(setPrimaryColor).toHaveBeenCalledWith("navy");
    expect(setCachedInstituteBranding).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("namingSettings") ?? "[]")[0].customValue).toBe("host word");
  });
});

describe("useDomainRouting redirect from a page behind the host's sign-in", () => {
  it("takes a signed-in learner opening the catalogue to the dashboard", async () => {
    session.instituteId = OWN;
    session.active = true;
    await mountAt("/courses");
    expect(navigate).toHaveBeenCalledWith({ to: "/dashboard" });
    expect(navigate).not.toHaveBeenCalledWith({ to: "/login" });
  });

  it("takes a signed-out visitor opening the catalogue to sign-in", async () => {
    await mountAt("/courses");
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("does not send someone logging out back to the dashboard", async () => {
    session.instituteId = OWN;
    session.active = true;
    await mountAt("/logout");
    expect(navigate).not.toHaveBeenCalledWith({ to: "/dashboard" });
  });

  it("follows the host's own redirect when it is not the sign-in page", async () => {
    session.instituteId = OWN;
    session.active = true;
    routing.answer = answer({ redirect: "/main-site" });
    await mountAt("/courses");
    expect(navigate).toHaveBeenCalledWith({ to: "/main-site" });
  });
});
