// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const capacitor = vi.hoisted(() => ({ native: false, appId: null as string | null }));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => capacitor.native,
    getPlatform: () => (capacitor.native ? "android" : "web"),
  },
}));
vi.mock("./platform-flavor", () => ({
  getPlatformFlavorInfo: async () => ({
    platform: capacitor.native ? "android" : "web",
    isNative: capacitor.native,
    flavorConfig: null,
    appId: capacitor.appId,
  }),
}));

import {
  APP_PUBLISHER,
  resolveAppIdentity,
  resolveCurrentAppIdentity,
  urlPointsAtCurrentPage,
} from "./app-identity";

const setLocation = (href: string) => {
  Object.defineProperty(window, "location", {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
};

describe("resolveAppIdentity", () => {
  it("finds every store id for a brand from its portal host", () => {
    const id = resolveAppIdentity({ hostname: "learner.soullifee.com" });
    expect(id.appName).toBe("DumBee");
    expect(id.appIds).toEqual(expect.arrayContaining(["com.dumbee.app", "io.dumbee.app"]));
    expect(id.host).toBe("learner.soullifee.com");
    expect(id.domain).toBe("soullifee.com");
    expect(id.subdomain).toBe("learner");
  });

  it("matches hosts case-insensitively", () => {
    expect(resolveAppIdentity({ hostname: "Learner.SoulLifee.com" }).appName).toBe("DumBee");
  });

  it("prefers an explicit app id over the hostname", () => {
    const id = resolveAppIdentity({ hostname: "learner.soullifee.com", appId: "io.agilore.app" });
    expect(id.appName).toBe("Agilore Global");
    expect(id.appIds).toContain("com.agilore.app");
    expect(id.appIds).not.toContain("com.dumbee.app");
  });

  it("widens to sibling ids that point at a different host", () => {
    // Shiksha Nation's Android flavour lives on vacademy.io, its iOS one on shikshanation.com.
    const id = resolveAppIdentity({ hostname: "learner.shikshanation.com" });
    expect(id.appIds).toEqual(
      expect.arrayContaining(["io.shikshanation.learner", "com.shikshanation.new.app"]),
    );
  });

  it("treats loosely spelled brand names as one family", () => {
    const id = resolveAppIdentity({ hostname: "7cs.vacademy.io" });
    expect(id.appIds).toEqual(expect.arrayContaining(["com.sevencs.app", "com.sevencs.learner"]));
  });

  it("returns an empty identity for an unknown host or id", () => {
    expect(resolveAppIdentity({ hostname: "learner.vacademy.io" })).toMatchObject({
      appName: null,
      appIds: [],
      host: null,
    });
    expect(resolveAppIdentity({ appId: "com.nope.app" }).appIds).toEqual([]);
  });
});

describe("resolveCurrentAppIdentity", () => {
  beforeEach(() => {
    capacitor.native = false;
    capacitor.appId = null;
    setLocation("https://learner.soullifee.com/privacy-policy");
  });

  it("uses the override when it is a known app id", async () => {
    const id = await resolveCurrentAppIdentity("com.ouiacademie.io");
    expect(id.appName).toBe("Oui Académie");
  });

  it("falls back to the host when the override is unknown", async () => {
    const id = await resolveCurrentAppIdentity("com.unknown.app");
    expect(id.appName).toBe("DumBee");
  });

  it("uses the native bundle id inside the app, where the hostname is localhost", async () => {
    capacitor.native = true;
    capacitor.appId = "io.brahmvarchas.app";
    setLocation("http://localhost/privacy-policy");
    const id = await resolveCurrentAppIdentity();
    expect(id.appName).toBe("Brahm Varchas Shiksha");
  });
});

describe("urlPointsAtCurrentPage", () => {
  beforeEach(() => {
    capacitor.native = false;
    setLocation("https://learner.soullifee.com/privacy-policy");
  });

  it("recognises the portal's own privacy page, with or without a trailing slash", () => {
    expect(urlPointsAtCurrentPage("https://learner.soullifee.com/privacy-policy")).toBe(true);
    expect(urlPointsAtCurrentPage("https://learner.soullifee.com/privacy-policy/")).toBe(true);
    expect(urlPointsAtCurrentPage("/privacy-policy?app=com.dumbee.app")).toBe(true);
  });

  it("does not treat an external policy as this page", () => {
    expect(urlPointsAtCurrentPage("https://shikshanation.com/privacy-policy")).toBe(false);
    expect(urlPointsAtCurrentPage("https://learner.soullifee.com/terms-and-conditions")).toBe(false);
    expect(urlPointsAtCurrentPage("not a url")).toBe(false);
  });

  it("compares only the path inside the native webview", () => {
    capacitor.native = true;
    setLocation("http://localhost/privacy-policy");
    expect(urlPointsAtCurrentPage("https://learner.soullifee.com/privacy-policy")).toBe(true);
  });
});

describe("APP_PUBLISHER", () => {
  it("names the store developer account exactly", () => {
    expect(APP_PUBLISHER.name).toBe("Vidyayatan Technologies LLP");
    expect(APP_PUBLISHER.addressLines.join(" ")).toContain("Bhopal");
  });
});
