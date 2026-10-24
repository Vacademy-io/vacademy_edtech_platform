// @vitest-environment jsdom
// (the suite default is node; the self-link check reads window.location)
import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * The sidebar's "Apps & Portals" footer renders straight off these store
 * fields, so a null here is an invisible footer. They used to stay null for the
 * whole session: the only caller of setInstituteDetails (the learner navbar)
 * always passes an institute name, and that branch returned before ever reading
 * the links out of the InstituteDetails cache.
 */

const prefs: Record<string, string> = {};

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs[key] ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefs[key] = value;
    },
  },
}));

vi.mock("@/services/upload_file", () => ({
  getPublicUrl: async () => "",
}));

vi.mock("@/services/domain-routing", () => ({
  getCachedInstituteBranding: () => null,
}));

const appleStore = { build: false };
vi.mock("@/utils/ios-iap-compliance", () => ({
  isAppleStoreBuild: () => appleStore.build,
}));

const { default: useStore } = await import("./useSidebar");

const DETAILS = {
  institute_name: "Shiksha Nation",
  institute_logo_file_id: "logo-1",
  playStoreAppLink: "https://play.google.com/store/apps/details?id=com.sn",
  appStoreAppLink: "https://apps.apple.com/app/id123",
  windowsAppLink: "https://example.com/sn.exe",
  macAppLink: "https://example.com/sn.dmg",
  learnerPortalUrl: "learner.shikshanation.com",
};

describe("useSidebar app/portal links", () => {
  beforeEach(() => {
    appleStore.build = false;
    for (const key of Object.keys(prefs)) delete prefs[key];
    useStore.setState({
      playStoreAppLink: null,
      appStoreAppLink: null,
      windowsAppLink: null,
      macAppLink: null,
      learnerPortalUrl: null,
      instructorPortalUrl: null,
    });
  });

  it("populates the links when called WITH a name (the navbar's path)", async () => {
    prefs.InstituteDetails = JSON.stringify(DETAILS);

    await useStore.getState().setInstituteDetails("Shiksha Nation", "", null);

    const state = useStore.getState();
    expect(state.playStoreAppLink).toBe(DETAILS.playStoreAppLink);
    expect(state.appStoreAppLink).toBe(DETAILS.appStoreAppLink);
    expect(state.windowsAppLink).toBe(DETAILS.windowsAppLink);
    expect(state.macAppLink).toBe(DETAILS.macAppLink);
  });

  it("populates the links on the no-argument fallback path too", async () => {
    prefs.InstituteDetails = JSON.stringify(DETAILS);

    await useStore.getState().setInstituteDetails();

    expect(useStore.getState().playStoreAppLink).toBe(DETAILS.playStoreAppLink);
  });

  // A bare host in an href is read as a relative path, so the link would land
  // on a 404 inside the app rather than the store listing.
  it("adds a scheme to a bare host", () => {
    useStore.getState().setAppLinks({ windowsAppLink: "downloads.example.com/sn.exe" });

    expect(useStore.getState().windowsAppLink).toBe(
      "https://downloads.example.com/sn.exe",
    );
  });

  it("drops the learner portal link when it is the page we are already on", () => {
    useStore
      .getState()
      .setAppLinks({ learnerPortalUrl: `https://${window.location.host}` });

    expect(useStore.getState().learnerPortalUrl).toBeNull();
  });

  it("keeps a learner portal link that points somewhere else", () => {
    useStore.getState().setAppLinks({ learnerPortalUrl: "learner.example.com" });

    expect(useStore.getState().learnerPortalUrl).toBe("https://learner.example.com");
  });

  it("leaves unset links null so the footer stays hidden", () => {
    useStore.getState().setAppLinks({ playStoreAppLink: "   " });

    const state = useStore.getState();
    expect(state.playStoreAppLink).toBeNull();
    expect(state.macAppLink).toBeNull();
  });

  // Apple 2.3.10: no other platforms inside an app on Apple's stores.
  it("drops the Google Play and Windows links in the iOS / Mac App Store builds", () => {
    appleStore.build = true;
    useStore.getState().setAppLinks(DETAILS);

    const state = useStore.getState();
    expect(state.playStoreAppLink).toBeNull();
    expect(state.windowsAppLink).toBeNull();
    expect(state.appStoreAppLink).toBe(DETAILS.appStoreAppLink);
    expect(state.macAppLink).toBe(DETAILS.macAppLink);
    expect(state.learnerPortalUrl).toBe("https://learner.shikshanation.com");
  });
});
