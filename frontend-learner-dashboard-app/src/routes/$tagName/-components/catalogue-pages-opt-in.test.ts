// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The catalogue home (CourseCataloguePage) and sub-pages (CourseSubPage) in a
 * real router with memory history:
 *
 * - <head>: a site without languages keeps origin/main's rules — the home
 *   page's title is document.title (institute name, then the default, after
 *   it) and sub-pages set none; only a site with languages takes the page's
 *   own SEO title and description (CatalogueSeoHead).
 * - On a root-mounted host, "/<tag>/<app route>" (login, signup, dashboard…)
 *   still reaches the app's own page; it stays on the site only when the site
 *   has a page of that name (a Courses page). The decision reads only the
 *   memoised root catalogue, before any of the site page's own work.
 */

const h = vi.hoisted(() => ({
  rootTag: null as string | null,
  catalogue: null as unknown,
  failFetch: false,
  instituteId: "inst-1",
  namingReady: true,
  /** One entry per catalogue network request: "uncached:<tag>" | "memo:<tag>". */
  requests: [] as string[],
  memo: new Map<string, Promise<unknown>>(),
  /** Institutes whose terminology a page started loading. */
  namingSeeds: [] as string[],
  /** Tracking settings a page handed to the GA4 / Pixel / GTM hook. */
  tracking: [] as unknown[],
  /** Full-screen loader renders. */
  loaders: 0,
}));

vi.mock("@/services/domain-routing", () => ({ getCachedRootCatalogueTag: () => h.rootTag }));
vi.mock("@/hooks/use-domain-routing", () => ({
  useDomainRouting: () => ({ instituteName: "Acme Academy", instituteThemeCode: null }),
}));
vi.mock("../-services/course-catalogue-service", () => {
  const load = async () => {
    if (h.failFetch) throw new Error("offline");
    return h.catalogue;
  };
  return {
    CourseCatalogueService: {
      // One request per call, as the real service.
      getCourseCatalogueByTag: (_instituteId: string, tagName: string) => {
        h.requests.push(`uncached:${tagName}`);
        return load();
      },
      // One shared request per catalogue, as the real short-lived memo.
      getCourseCatalogueByTagMemo: (instituteId: string, tagName: string) => {
        const key = `${instituteId}::${tagName}`;
        if (!h.memo.has(key)) {
          h.requests.push(`memo:${tagName}`);
          const promise = load();
          h.memo.set(key, promise);
          promise.catch(() => h.memo.delete(key));
        }
        return h.memo.get(key)!;
      },
    },
  };
});
vi.mock("../-utils/institute-naming-seed", () => ({
  useInstituteNamingSettings: (instituteId: string) => {
    h.namingSeeds.push(instituteId);
    return h.namingReady;
  },
}));
vi.mock("react-i18next", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key: string) => key, i18n: undefined }),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: (_term: string, fallback: string) => fallback,
  getTerminologyPlural: (_term: string, fallback: string) => `${fallback}s`,
}));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: async () => null }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {} },
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "web" } }));
vi.mock("@/lib/auth/sessionUtility", () => ({ getTokenFromStorage: async () => null }));
vi.mock("@/components/core/dashboard-loader", () => ({
  DashboardLoader: () => {
    h.loaders++;
    return null;
  },
}));
vi.mock("../-utils/catalogue-tracking", () => ({
  useCatalogueTracking: (tracking: unknown) => {
    if (tracking) h.tracking.push(tracking);
  },
  useCataloguePageView: () => {},
  captureUtmOnce: () => {},
}));
vi.mock("../-utils/resource-unlock", () => ({ useResourceTrackingContext: () => {} }));
vi.mock("../-utils/catalogue-fonts", () => ({
  collectConfigFontFamilies: () => [],
  ensureFontsLoaded: () => {},
}));
vi.mock("./JsonRenderer", async () => {
  const { createElement } = await import("react");
  return {
    JsonRenderer: ({ page }: { page: { id: string } }) => createElement("section", { "data-page": page.id }),
  };
});
vi.mock("./IntroPageComponent", () => ({ IntroPageComponent: () => null }));
vi.mock("./LeadCollectionModal", () => ({ LeadCollectionModal: () => null }));
vi.mock("./AudienceFormModal", () => ({ AudienceFormModal: () => null }));
vi.mock("./MobileActionBar", () => ({ MobileActionBar: () => null }));
vi.mock("./WhatsAppFloatingButton", () => ({ WhatsAppFloatingButton: () => null }));
vi.mock("./CourseFinderWizard", () => ({ CourseFinderWizard: () => null }));

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from "@tanstack/react-router";
import { registerAppRoutePaths } from "@/services/reserved-app-routes";
import { CourseCatalogueService } from "../-services/course-catalogue-service";
import { CourseCataloguePage } from "./CourseCataloguePage";
import { CourseSubPage } from "./CourseSubPage";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HINDI_SITE = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: {},
};

const catalogue = (opts: { i18n?: unknown; pages?: string[] } = {}) => ({
  catalogueId: "cat-1",
  globalSettings: {
    leadCollection: { enabled: false, mandatory: false, fields: [] },
    ...(opts.i18n ? { i18n: opts.i18n } : {}),
  },
  pages: [
    {
      id: "home",
      route: "homepage",
      title: "Home",
      seo: { metaTitle: "NEET coaching | Acme", metaDescription: "Crack NEET with Acme." },
      components: [],
    },
    {
      id: "about",
      route: "about",
      title: "About",
      seo: { metaTitle: "About Acme", metaDescription: "Who we are." },
      components: [],
    },
    ...(opts.pages ?? []).map((route) => ({ id: route, route, title: route, components: [] })),
  ],
});

/** The app's route shapes: catalogue home + pages, and some of the app's own routes. */
const makeRouter = (initial: string) => {
  const rootRoute = createRootRoute();
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: "$tagName/",
    component: function CatalogueHome() {
      const { tagName = "" } = useParams({ strict: false }) as { tagName?: string };
      return e(CourseCataloguePage, { tagName, instituteId: "inst-1" });
    },
  });
  const subPage = createRoute({
    getParentRoute: () => rootRoute,
    path: "$tagName/$courseId/",
    component: function CatalogueSubPage() {
      const { tagName = "", courseId = "" } = useParams({ strict: false }) as { tagName?: string; courseId?: string };
      return e(CourseSubPage, { tagName, page: courseId, instituteId: h.instituteId });
    },
  });
  const appRoute = (path: string) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => e("main", { "data-app-route": path }) });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      home,
      subPage,
      appRoute("login"),
      appRoute("signup"),
      appRoute("dashboard"),
      appRoute("courses"),
      appRoute("privacy-policy"),
    ]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  // As main.tsx does: the app's own first path segments are reserved.
  registerAppRoutePaths(Object.keys(router.routesByPath));
  return router;
};

let root: Root | null = null;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const mount = async (initial: string) => {
  const router = makeRouter(initial);
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(e(RouterProvider, { router } as unknown as React.ComponentProps<typeof RouterProvider>));
  });
  // Route load, catalogue fetch, any redirect, and react-helmet's deferred
  // <head> update.
  for (let i = 0; i < 8; i++) await act(tick);
  return { router, host };
};

const meta = (selector: string) => document.head.querySelector(selector)?.getAttribute("content") ?? null;

beforeEach(() => {
  h.rootTag = null;
  h.catalogue = catalogue();
  h.failFetch = false;
  h.instituteId = "inst-1";
  h.namingReady = true;
  h.requests = [];
  h.memo.clear();
  h.namingSeeds = [];
  h.tracking = [];
  h.loaders = 0;
  document.body.style.fontFamily = "";
  // index.html's own title, before any branding.
  document.title = "Course Catalogue";
  document.head.querySelectorAll("[data-react-helmet]").forEach((el) => el.remove());
  localStorage.clear();
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  await act(tick);
  document.body.innerHTML = "";
});

describe("<head> on a site without languages", () => {
  it("the home page keeps origin/main's title rules and ignores page SEO", async () => {
    const { host } = await mount("/site/");
    expect(host.querySelector('[data-page="home"]')).not.toBeNull();
    expect(document.title).toBe("Course Catalogue");
    expect(meta('meta[property="og:title"]')).toBe("Acme Academy");
    expect(meta('meta[name="description"]')).toBe("courseCataloguePage.seoDescriptionWithInstitute");
    expect(meta('meta[property="og:description"]')).toBe("courseCataloguePage.seoDescriptionWithInstitute");
  });

  it("a sub-page sets no title or description, as before", async () => {
    const { host } = await mount("/site/about");
    expect(host.querySelector('[data-page="about"]')).not.toBeNull();
    expect(document.title).toBe("Course Catalogue");
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    expect(document.head.querySelector('meta[property="og:title"]')).toBeNull();
  });
});

describe("<head> on a site with languages", () => {
  it("the home page takes its own SEO title and description", async () => {
    h.catalogue = catalogue({ i18n: HINDI_SITE });
    const { host } = await mount("/site/");
    expect(host.querySelector('[data-page="home"]')).not.toBeNull();
    expect(document.title).toBe("NEET coaching | Acme");
    expect(meta('meta[property="og:title"]')).toBe("NEET coaching | Acme");
    expect(meta('meta[name="description"]')).toBe("Crack NEET with Acme.");
  });

  it("so does a sub-page", async () => {
    h.catalogue = catalogue({ i18n: HINDI_SITE });
    const { host } = await mount("/site/about");
    expect(host.querySelector('[data-page="about"]')).not.toBeNull();
    expect(document.title).toBe("About Acme");
    expect(meta('meta[name="description"]')).toBe("Who we are.");
  });
});

describe("a root-mounted host's tagged address for an app route", () => {
  beforeEach(() => {
    h.rootTag = "new";
  });

  it("reaches the app's own page when the site has no such page, query kept", async () => {
    const { router, host } = await mount("/new/login?redirect=%2Fdashboard");
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ redirect: "/dashboard" });
    expect(host.querySelector('[data-app-route="login"]')).not.toBeNull();
  });

  it("does so for every app route (signup, dashboard)", async () => {
    for (const route of ["signup", "dashboard"]) {
      const { router, host } = await mount(`/new/${route}`);
      expect(router.state.location.pathname).toBe(`/${route}`);
      expect(host.querySelector(`[data-app-route="${route}"]`)).not.toBeNull();
      act(() => root?.unmount());
    }
  });

  it("does so when the site cannot be loaded", async () => {
    h.failFetch = true;
    const { router } = await mount("/new/dashboard");
    expect(router.state.location.pathname).toBe("/dashboard");
  });

  it("does so when the institute could not be resolved, with no request", async () => {
    h.instituteId = "";
    const { router } = await mount("/new/login");
    expect(router.state.location.pathname).toBe("/login");
    expect(h.requests).toEqual([]);
  });

  it("leaves as soon as the site's pages are known, without waiting for its terminology", async () => {
    h.namingReady = false;
    const { router } = await mount("/new/login");
    expect(router.state.location.pathname).toBe("/login");
  });

  it("reuses the catalogue the page the visitor came from already read", async () => {
    // The site page holding the CTA read the root catalogue through the
    // shared memo (RootMountedSegment / CourseCataloguePage).
    await CourseCatalogueService.getCourseCatalogueByTagMemo("inst-1", "new");
    const { router } = await mount("/new/signup");
    expect(router.state.location.pathname).toBe("/signup");
    expect(h.requests).toEqual(["memo:new"]);
  });

  it("runs none of the site page's own work on the way (terminology, tracking, fonts)", async () => {
    const site = catalogue();
    h.catalogue = {
      ...site,
      globalSettings: {
        ...site.globalSettings,
        tracking: { ga4MeasurementId: "G-TEST" },
        fonts: { enabled: true, family: "Lora, serif" },
      },
    };
    const { router } = await mount("/new/login");
    expect(router.state.location.pathname).toBe("/login");
    expect(h.namingSeeds).toEqual([]);
    expect(h.tracking).toEqual([]);
    expect(document.body.style.fontFamily).toBe("");
  });

  it("opens the site's own page of that name (a Courses page)", async () => {
    h.catalogue = catalogue({ pages: ["courses"] });
    const { router, host } = await mount("/new/courses");
    expect(router.state.location.pathname).toBe("/new/courses");
    expect(host.querySelector('[data-page="courses"]')).not.toBeNull();
    expect(host.querySelector("[data-app-route]")).toBeNull();
    // The page list that kept the visitor here is the catalogue it renders:
    // one shared request.
    expect(h.requests).toEqual(["memo:new"]);
  });

  it("moves between the site's own pages of that kind as before: no loader, no new read", async () => {
    h.catalogue = catalogue({ pages: ["courses", "privacy-policy"] });
    const { router, host } = await mount("/new/courses");
    expect(host.querySelector('[data-page="courses"]')).not.toBeNull();
    const loaders = h.loaders;
    await act(async () => {
      await router.navigate({ to: "/new/privacy-policy" as never });
    });
    for (let i = 0; i < 4; i++) await act(tick);
    expect(router.state.location.pathname).toBe("/new/privacy-policy");
    expect(host.querySelector('[data-page="privacy-policy"]')).not.toBeNull();
    expect(h.loaders).toBe(loaders);
    expect(h.requests).toEqual(["memo:new"]);
  });

  it("and from one of them, an app route the site lacks still reaches the app", async () => {
    h.catalogue = catalogue({ pages: ["courses"] });
    const { router, host } = await mount("/new/courses");
    expect(host.querySelector('[data-page="courses"]')).not.toBeNull();
    await act(async () => {
      await router.navigate({ to: "/new/dashboard" as never });
    });
    for (let i = 0; i < 4; i++) await act(tick);
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(host.querySelector('[data-app-route="dashboard"]')).not.toBeNull();
  });

  it("leaves a classic host's missing page on the not-found screen", async () => {
    h.rootTag = null;
    const { router, host } = await mount("/other/login");
    expect(router.state.location.pathname).toBe("/other/login");
    expect(host.textContent).toContain("courseSubPage.pageNotFound");
  });
});

describe("a classic host's sub-page", () => {
  it("loads as on origin/main: its own uncached request, terminology first", async () => {
    const { host } = await mount("/site/about");
    expect(host.querySelector('[data-page="about"]')).not.toBeNull();
    expect(h.requests).toEqual(["uncached:site"]);
    expect(h.namingSeeds[0]).toBe("inst-1");
  });

  it("an app-route name is just a missing page there, with no redirect", async () => {
    const { router, host } = await mount("/site/dashboard");
    expect(router.state.location.pathname).toBe("/site/dashboard");
    expect(host.textContent).toContain("courseSubPage.pageNotFound");
    expect(h.requests).toEqual(["uncached:site"]);
  });
});
