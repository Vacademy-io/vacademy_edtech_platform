// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/axiosInstance", () => ({ default: {} }));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: async () => "" }));
vi.mock("../utils/platform-flavor", () => ({ getDomainAndSubdomain: async () => ({}) }));
vi.mock("@/utils/geo-country", () => ({ detectVisitorCountry: () => null }));
vi.mock("@/lib/student-preview", () => ({ readThemeRoleSettingsRaw: () => null }));

const load = async () => {
  vi.resetModules();
  return import("./domain-routing");
};
const saved = (key: string) => JSON.parse(localStorage.getItem(key) ?? "{}");

describe("adoptInstituteBranding", () => {
  beforeEach(() => {
    localStorage.clear();
    document.title = "tab before";
  });

  it("replaces another institute's branding, its display overrides and tab mirror", async () => {
    const { adoptInstituteBranding, setCachedInstituteBranding } = await load();
    setCachedInstituteBranding({
      instituteId: "host",
      instituteName: "Host",
      hideInstituteName: true,
      logoWidthPx: 120,
      homeIconClickRoute: "https://host.example",
    });
    localStorage.setItem("TabBranding", JSON.stringify({ tabText: "Host tab", tabIconUrl: "icon" }));

    adoptInstituteBranding({ id: "own", institute_name: "Own", institute_theme_code: "teal" });

    const branding = saved("InstituteBranding");
    expect(branding.instituteId).toBe("own");
    expect(branding.instituteName).toBe("Own");
    expect(branding.instituteThemeCode).toBe("teal");
    expect(branding.instituteThemeHex).toBe("#00897B"); // design-lint-ignore: stored value under test
    expect(branding.hideInstituteName).toBeNull();
    expect(branding.logoWidthPx).toBeNull();
    expect(branding.homeIconClickRoute).toBeNull();
    expect(saved("TabBranding").tabText).toBe("Own");
    expect(saved("TabBranding").tabIconUrl).not.toBe("icon");
    expect(document.title).toBe("Own");
  });

  it("keeps the routing row's overrides and tab for the institute already cached", async () => {
    const { adoptInstituteBranding, setCachedInstituteBranding } = await load();
    setCachedInstituteBranding({
      instituteId: "own",
      instituteName: "Old name",
      instituteLogoFileId: "logo",
      instituteLogoUrl: "https://cdn.example/logo",
      hideInstituteName: true,
      logoWidthPx: 120,
    });
    localStorage.setItem("TabBranding", JSON.stringify({ tabText: "Own tab", tabIconUrl: "icon" }));

    adoptInstituteBranding({
      id: "own",
      institute_name: "New name",
      institute_logo_file_id: "logo",
      institute_theme_code: "navy",
    });

    const branding = saved("InstituteBranding");
    expect(branding.instituteName).toBe("New name");
    expect(branding.instituteLogoUrl).toBe("https://cdn.example/logo");
    expect(branding.instituteThemeHex).toBe("#1A237E"); // design-lint-ignore: stored value under test
    expect(branding.hideInstituteName).toBe(true);
    expect(branding.logoWidthPx).toBe(120);
    expect(saved("TabBranding").tabText).toBe("Own tab");
    expect(document.title).toBe("tab before");
  });

  it("fills an absent tab mirror for the institute already cached", async () => {
    const { adoptInstituteBranding, setCachedInstituteBranding } = await load();
    setCachedInstituteBranding({ instituteId: "own" });
    adoptInstituteBranding({ id: "own", institute_name: "Own" });
    expect(saved("TabBranding").tabText).toBe("Own");
  });

  it("drops a logo address that belonged to a different logo file", async () => {
    const { adoptInstituteBranding, setCachedInstituteBranding } = await load();
    setCachedInstituteBranding({
      instituteId: "own",
      instituteLogoFileId: "old",
      instituteLogoUrl: "https://cdn.example/old",
    });
    adoptInstituteBranding({ id: "own", institute_logo_file_id: "new" });
    expect(saved("InstituteBranding").instituteLogoUrl).toBeNull();
  });
});
