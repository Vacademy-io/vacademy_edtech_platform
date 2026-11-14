import { describe, expect, it } from "vitest";
import {
  launcherStack,
  pageHasCatalogueBlock,
  resolveSiteAssistantSettings,
  routeMatches,
  shouldShowSiteAssistant,
  type PlacementInput,
} from "./settings";

const base = (over: Partial<Omit<PlacementInput, "settings">> & { settings?: unknown } = {}): PlacementInput => ({
  siteRoute: "",
  pageKind: "home",
  hasCatalogueBlock: false,
  studentAiVisible: false,
  isPreview: false,
  ...over,
  settings: resolveSiteAssistantSettings(over.settings ?? { enabled: true }),
});

describe("resolveSiteAssistantSettings", () => {
  it("fills SPEC §1 defaults for missing keys", () => {
    const s = resolveSiteAssistantSettings(undefined);
    expect(s.enabled).toBe(false);
    expect(s.placement).toEqual({ mode: "all", routes: [] });
    expect(s.position).toBe("bottom-right");
    expect(s.persona).toBe("warm");
    expect(s.accentColor).toBeNull();
    expect(s.embed.enabled).toBe(false);
  });

  it("ignores junk values", () => {
    const s = resolveSiteAssistantSettings({
      enabled: "yes",
      persona: "rude",
      placement: { mode: "everywhere", routes: ["/a", 3, ""] },
      position: "top",
      suggestions: ["Courses?", "", null, "Free class?"],
    });
    expect(s.enabled).toBe(false);
    expect(s.persona).toBe("warm");
    expect(s.placement).toEqual({ mode: "all", routes: ["/a"] });
    expect(s.position).toBe("bottom-right");
    expect(s.suggestions).toEqual(["Courses?", "Free class?"]);
  });
});

describe("shouldShowSiteAssistant", () => {
  it("is off unless enabled", () => {
    expect(shouldShowSiteAssistant(base({ settings: {} }))).toBe(false);
    expect(shouldShowSiteAssistant(base())).toBe(true);
  });

  it("never shows next to the Student AI, in the editor preview, or on login/checkout pages", () => {
    expect(shouldShowSiteAssistant(base({ studentAiVisible: true }))).toBe(false);
    expect(shouldShowSiteAssistant(base({ isPreview: true }))).toBe(false);
    expect(shouldShowSiteAssistant(base({ siteRoute: "checkout", pageKind: "page" }))).toBe(false);
    expect(shouldShowSiteAssistant(base({ siteRoute: "login", pageKind: "page" }))).toBe(false);
    expect(shouldShowSiteAssistant(base({ siteRoute: "cart/review", pageKind: "page" }))).toBe(false);
    expect(shouldShowSiteAssistant(base({ siteRoute: "cartography", pageKind: "page" }))).toBe(true);
  });

  it("catalogue_and_courses: home, course pages and pages with a course listing", () => {
    const settings = { enabled: true, placement: { mode: "catalogue_and_courses" } };
    expect(shouldShowSiteAssistant(base({ settings }))).toBe(true);
    expect(shouldShowSiteAssistant(base({ settings, pageKind: "course", siteRoute: "123" }))).toBe(true);
    expect(shouldShowSiteAssistant(base({ settings, pageKind: "page", siteRoute: "about" }))).toBe(false);
    expect(shouldShowSiteAssistant(base({ settings, pageKind: "page", siteRoute: "courses", hasCatalogueBlock: true }))).toBe(true);
  });

  it("routes: exact routes, home as '/', and prefix wildcards", () => {
    const settings = { enabled: true, placement: { mode: "routes", routes: ["/", "/About/", "blog/*"] } };
    expect(shouldShowSiteAssistant(base({ settings }))).toBe(true);
    expect(shouldShowSiteAssistant(base({ settings, pageKind: "page", siteRoute: "about" }))).toBe(true);
    expect(shouldShowSiteAssistant(base({ settings, pageKind: "page", siteRoute: "blog/my-post" }))).toBe(true);
    expect(shouldShowSiteAssistant(base({ settings, pageKind: "page", siteRoute: "contact" }))).toBe(false);
    expect(shouldShowSiteAssistant(base({ settings: { enabled: true, placement: { mode: "routes" } } }))).toBe(false);
  });

  it("routeMatches normalises slashes, case and home aliases", () => {
    expect(routeMatches("homepage", "")).toBe(true);
    expect(routeMatches("/Courses", "courses")).toBe(true);
    expect(routeMatches("courses*", "courses/123")).toBe(true);
  });

  it("pageHasCatalogueBlock only counts enabled listing blocks", () => {
    expect(pageHasCatalogueBlock([{ type: "hero" }, { type: "courseCatalog" }])).toBe(true);
    expect(pageHasCatalogueBlock([{ type: "courseCatalog", enabled: false }])).toBe(false);
    expect(pageHasCatalogueBlock(undefined)).toBe(false);
  });
});

describe("launcherStack", () => {
  it("clears the mobile action bar like the WhatsApp bubble does", () => {
    expect(launcherStack({ side: "end", hasMobileBar: true })).toEqual({ level: 0, className: "bottom-32 md:bottom-6" });
    expect(launcherStack({ side: "end", hasMobileBar: false })).toEqual({ level: 0, className: "bottom-6" });
  });

  it("stacks above a WhatsApp bubble or back-to-top button on the same side only", () => {
    const whatsapp = { enabled: true, phone: "+91 98956 03342" };
    expect(launcherStack({ side: "end", hasMobileBar: true, whatsapp })).toEqual({ level: 1, className: "bottom-52 md:bottom-24" });
    expect(launcherStack({ side: "start", hasMobileBar: false, whatsapp })).toEqual({ level: 0, className: "bottom-6" });
    expect(launcherStack({ side: "start", hasMobileBar: false, whatsapp: { ...whatsapp, position: "left" } }).level).toBe(1);
    expect(launcherStack({ side: "end", hasMobileBar: false, whatsapp: { enabled: true, phone: "" } }).level).toBe(0);
    expect(launcherStack({ side: "end", hasMobileBar: false, backToTop: true }).level).toBe(1);
    expect(launcherStack({ side: "start", hasMobileBar: false, backToTop: true }).level).toBe(0);
  });
});
