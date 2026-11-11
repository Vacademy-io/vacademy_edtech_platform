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
// A router whose navigation state the test drives: status, the page on screen
// (resolvedLocation) and the onResolved listeners.
const router = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    state: {
      matches: [] as unknown[],
      status: "idle" as "idle" | "pending",
      resolvedLocation: undefined as { pathname: string } | undefined,
    },
    listeners,
    subscribe: (_type: string, fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useRouter: () => router,
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

const answer = {
  instituteId: "host-institute",
  instituteName: "Host",
  instituteLogoFileId: null,
  instituteThemeCode: "navy",
  redirect: "/login",
};

let root: Root | null = null;

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

/** Mount the hook with the URL at `url`; domain routing resolves to `/login`. */
const mountAt = async (url: string) => {
  window.history.pushState({}, "", url);
  vi.resetModules();
  const { useDomainRouting } = await import("./use-domain-routing");
  const Probe = () => {
    useDomainRouting();
    return null;
  };
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(createElement(Probe));
  });
  await settle();
};

/** The in-flight navigation lands: the router goes idle and tells its listeners. */
const navigationLands = async () => {
  router.state.status = "idle";
  await act(async () => {
    [...router.listeners].forEach((fn) => fn());
  });
  await settle();
};

beforeEach(() => {
  prefs.clear();
  localStorage.clear();
  session.instituteId = null;
  session.active = false;
  routing.answer = answer;
  router.state.status = "idle";
  router.state.resolvedLocation = undefined;
  router.listeners.clear();
  [navigate, setPrimaryColor, applyTabBranding, setCachedInstituteBranding, setInstituteId].forEach((fn) =>
    fn.mockReset(),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

// "/a/b/c" is neither a public page nor a course page, so the hook sends a
// visitor there on to the domain's redirect.
describe("useDomainRouting redirect while a navigation is in flight", () => {
  it("redirects as before when no navigation is in flight", async () => {
    await mountAt("/a/b/c");
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("does not redirect for a page that navigated away (the URL already shows the destination)", async () => {
    // Live-class registration without a sessionId has called navigate("/a/b/c")
    // and is still on screen while the destination's code loads.
    router.state.status = "pending";
    router.state.resolvedLocation = { pathname: "/register/live-class" };
    await mountAt("/a/b/c");
    expect(navigate).not.toHaveBeenCalled();

    await navigationLands();
    expect(navigate).not.toHaveBeenCalled();
    expect(router.listeners.size).toBe(0);
  });

  it("decides once the navigation lands when the page stayed (a search-only change)", async () => {
    router.state.status = "pending";
    router.state.resolvedLocation = { pathname: "/a/b/c" };
    await mountAt("/a/b/c?tab=2");
    expect(navigate).not.toHaveBeenCalled();

    await navigationLands();
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("stops listening when the page unmounts before the navigation lands", async () => {
    router.state.status = "pending";
    router.state.resolvedLocation = { pathname: "/register/live-class" };
    await mountAt("/a/b/c");
    expect(router.listeners.size).toBe(1);
    act(() => root?.unmount());
    root = null;
    expect(router.listeners.size).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });
});
