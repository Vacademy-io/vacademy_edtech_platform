import { describe, expect, it, vi, beforeEach } from "vitest";

const platform = { value: "web" };
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => platform.value },
}));

const {
  consumeLoginCodeLanding,
  homeLinkTargetsSiteRoot,
  isAppShell,
  isRootSiteServed,
  markLoginCodeLanding,
  setRootSiteServed,
  shouldServeRootSiteToSignedIn,
} = await import(
  "./root-site-for-signed-in"
);

describe("shouldServeRootSiteToSignedIn", () => {
  const base = {
    rootCatalogueTag: "parcham-classes",
    homeLinksToSite: true,
    appShell: false,
    readerMode: false,
    accessTokenValid: true,
  };

  it("serves the site on a root-catalogue host in a browser tab", () => {
    expect(shouldServeRootSiteToSignedIn(base)).toBe(true);
  });

  it("keeps the landing redirect on hosts without a root catalogue", () => {
    for (const rootCatalogueTag of [null, undefined, "", "   "]) {
      expect(shouldServeRootSiteToSignedIn({ ...base, rootCatalogueTag })).toBe(false);
    }
  });

  it("keeps the landing redirect when the logo link does not point at the site", () => {
    expect(shouldServeRootSiteToSignedIn({ ...base, homeLinksToSite: false })).toBe(false);
  });

  it("keeps the landing redirect inside an app shell", () => {
    expect(shouldServeRootSiteToSignedIn({ ...base, appShell: true })).toBe(false);
  });

  it("keeps the reader-mode landing route", () => {
    expect(shouldServeRootSiteToSignedIn({ ...base, readerMode: true })).toBe(false);
  });

  it("keeps the redirect when the access token has expired, so it refreshes", () => {
    expect(shouldServeRootSiteToSignedIn({ ...base, accessTokenValid: false })).toBe(false);
  });
});

describe("isAppShell", () => {
  beforeEach(() => {
    platform.value = "web";
    vi.unstubAllGlobals();
  });

  it("is false for a plain browser tab", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/130" });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(isAppShell()).toBe(false);
  });

  it("is true on native platforms", () => {
    platform.value = "android";
    expect(isAppShell()).toBe(true);
  });

  it("is true in Electron", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Electron/30.0" });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(isAppShell()).toBe(true);
  });

  it("is true for an installed PWA", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/130" });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(isAppShell()).toBe(true);
  });

  it("is true for an iOS home-screen launch", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Safari", standalone: true });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(isAppShell()).toBe(true);
  });
});

describe("homeLinkTargetsSiteRoot", () => {
  const origin = "https://parchamclasses.in";

  it("matches the host's own root, with or without a trailing slash", () => {
    expect(homeLinkTargetsSiteRoot("https://parchamclasses.in", origin)).toBe(true);
    expect(homeLinkTargetsSiteRoot("https://parchamclasses.in/", origin)).toBe(true);
    expect(homeLinkTargetsSiteRoot("/", origin)).toBe(true);
  });

  it("does not match another host, a sub-page, or nothing", () => {
    expect(homeLinkTargetsSiteRoot("https://www.parchamclasses.in", origin)).toBe(false);
    expect(homeLinkTargetsSiteRoot("https://parchamclasses.in/blog", origin)).toBe(false);
    expect(homeLinkTargetsSiteRoot("/dashboard", origin)).toBe(false);
    expect(homeLinkTargetsSiteRoot(null, origin)).toBe(false);
    expect(homeLinkTargetsSiteRoot("", origin)).toBe(false);
  });
});

describe("login-code landing mark", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it("is consumed exactly once", () => {
    expect(consumeLoginCodeLanding()).toBe(false);
    markLoginCodeLanding();
    expect(consumeLoginCodeLanding()).toBe(true);
    expect(consumeLoginCodeLanding()).toBe(false);
  });

  it("never throws when storage is blocked", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    expect(() => markLoginCodeLanding()).not.toThrow();
    expect(consumeLoginCodeLanding()).toBe(false);
  });
});

describe("root-site served flag", () => {
  it("defaults to false and follows the setter", () => {
    setRootSiteServed(false);
    expect(isRootSiteServed()).toBe(false);
    setRootSiteServed(true);
    expect(isRootSiteServed()).toBe(true);
    setRootSiteServed(false);
  });
});
