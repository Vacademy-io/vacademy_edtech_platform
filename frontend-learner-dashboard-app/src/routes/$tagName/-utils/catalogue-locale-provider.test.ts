// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import i18next, { type BackendModule, type i18n as I18nInstance } from "i18next";
import { I18nextProvider, useTranslation } from "react-i18next";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { CatalogueLocaleProvider, useCatalogueLocale } from "./catalogue-locale";
import { CatalogueLink } from "../-components/CatalogueLink";
import { isSiteLanguageHeld, retainSiteLanguage, useSiteNavigate } from "./catalogue-route-search";
import type { CatalogueI18nSettings } from "./catalogue-i18n";

/**
 * CatalogueLocaleProvider rendered for real: a real TanStack router (memory
 * history) and a real i18next instance whose catalogs load asynchronously, as
 * the app's lazy backend does (no JSX, so the project's *.test.ts pattern
 * picks this file up).
 */

const h = React.createElement;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The router resets the scroll position on navigation; jsdom has no layout.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

// An in-memory localStorage (the remembered site language is read from it).
const memoryStorage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memoryStorage.get(k) ?? null,
    setItem: (k: string, v: string) => void memoryStorage.set(k, String(v)),
    removeItem: (k: string) => void memoryStorage.delete(k),
    clear: () => memoryStorage.clear(),
  },
});

const CATALOGS: Record<string, Record<string, Record<string, string>>> = {
  en: { common: { ok: "OK" }, coursePlayerB: { addToCart: "Add to cart" } },
  hi: { common: { ok: "ठीक" }, coursePlayerB: { addToCart: "कार्ट में जोड़ें" } },
};

/** A stand-in for src/i18n.ts: lazy, asynchronous catalogs; English. */
const makeAppI18n = async (): Promise<I18nInstance> => {
  const backend: BackendModule = {
    type: "backend",
    init() {},
    read(lng, ns, callback) {
      setTimeout(() => callback(null, CATALOGS[lng]?.[ns] ?? {}), 5);
    },
  };
  const app = i18next.createInstance();
  await app.use(backend).init({
    lng: "en",
    fallbackLng: "en",
    supportedLngs: ["en", "hi"],
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false, bindI18n: "languageChanged namingTermsChanged" },
  });
  return app;
};

const HINDI_SITE: CatalogueI18nSettings = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: { hi: { Courses: "पाठ्यक्रम" } },
};

/** What the page under the provider sees. */
const seen: { i18n?: I18nInstance; siteNavigate?: (target: string) => Promise<void> } = {};

const Probe = () => {
  const { t, i18n } = useTranslation("coursePlayerB");
  const { locale } = useCatalogueLocale();
  seen.i18n = i18n;
  seen.siteNavigate = useSiteNavigate();
  return h("p", null, `${t("addToCart", "Add to cart")}|${locale}`);
};

/** A section that redirects from its own mount effect (runs before the provider's effects). */
const RedirectOnMount = () => {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  React.useEffect(() => {
    if (pathname === "/site/old-page") void navigate({ to: "/site/new-page" as never });
  }, [navigate, pathname]);
  return h("p", null, pathname);
};

/** A page with one CatalogueLink (authored `to`, as a section would pass it). */
const LinkPage = () => h(CatalogueLink, { to: current.linkTo, children: "Go" });

const current: {
  settings?: CatalogueI18nSettings;
  persist: boolean;
  page: React.FC;
  linkTo: string;
} = { persist: true, page: Probe, linkTo: "" };

/** The routes render whichever page the test asked for. */
const Page = () => h(current.page);

const makeRouter = (initial: string) => {
  // The provider wraps every catalogue page, as the page shells do.
  const rootRoute = createRootRoute({
    component: () =>
      h(CatalogueLocaleProvider, {
        settings: current.settings,
        scope: "site",
        persist: current.persist,
        children: h(Outlet),
      }),
  });
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: "$tagName/",
    search: { middlewares: [retainSiteLanguage] },
    component: Page,
  });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: "$tagName/$pageSlug",
    search: { middlewares: [retainSiteLanguage] },
    component: Page,
  });
  const history = createMemoryHistory({ initialEntries: [initial] });
  return { router: createRouter({ routeTree: rootRoute.addChildren([home, page]), history }), history };
};

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

let app: I18nInstance;
const mounted: Array<() => Promise<void>> = [];

const mount = async (
  url: string,
  settings: CatalogueI18nSettings | undefined,
  opts: { persist?: boolean; page?: React.FC; linkTo?: string } = {},
) => {
  current.settings = settings;
  current.persist = opts.persist ?? true;
  current.page = opts.page ?? Probe;
  current.linkTo = opts.linkTo ?? "";
  const { router, history } = makeRouter(url);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(h(I18nextProvider, { i18n: app }, h(RouterProvider, { router })));
  });
  await settle();
  const unmount = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  mounted.push(unmount);
  const link = () => host.querySelector("a")!;
  const click = async () => {
    await act(async () => {
      link().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await settle();
  };
  return { router, history, text: () => host.textContent, unmount, link, click };
};

beforeEach(async () => {
  app = await makeAppI18n();
  memoryStorage.clear();
  seen.i18n = undefined;
  seen.siteNavigate = undefined;
});

afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
});

describe("react-i18next chrome on a हिन्दी / EN site", () => {
  it("follows the site language without changing the app's language", async () => {
    const appLanguageChanged = vi.fn();
    app.on("languageChanged", appLanguageChanged);

    const page = await mount("/site/courses?lang=hi", HINDI_SITE);

    expect(page.text()).toBe("कार्ट में जोड़ें|hi");
    expect(seen.i18n).not.toBe(app);
    expect(seen.i18n?.language).toBe("hi");
    // The logged-in app (dashboard language, Accept-Language) is untouched.
    expect(app.language).toBe("en");
    expect(app.t("coursePlayerB:addToCart")).toBe("Add to cart");
    expect(appLanguageChanged).not.toHaveBeenCalled();
  });

  it("stays in the base language until the visitor picks another", async () => {
    const page = await mount("/site/courses", HINDI_SITE);
    expect(page.text()).toBe("Add to cart|en");
  });

  it("gives a single-language site the app's own instance", async () => {
    const page = await mount("/site/courses?lang=hi", undefined);
    expect(seen.i18n).toBe(app);
    expect(page.text()).toBe("Add to cart|en");
  });
});

describe("carrying ?lang= across navigation", () => {
  it("holds the language only while a site with languages is on screen", async () => {
    const plain = await mount("/site/courses?lang=hi", undefined);
    expect(isSiteLanguageHeld()).toBe(false);
    await plain.unmount();

    const hindi = await mount("/site/courses?lang=hi", HINDI_SITE);
    expect(isSiteLanguageHeld()).toBe(true);
    await hindi.unmount();
    expect(isSiteLanguageHeld()).toBe(false);
  });

  it("is held before a section's own mount effect navigates", async () => {
    const { history } = await mount("/site/old-page?lang=hi", HINDI_SITE, { page: RedirectOnMount });
    expect(history.location.href).toBe("/site/new-page?lang=hi");
  });

  it("repairs a caller's `to` with its own query string after one render", async () => {
    const { router, history } = await mount("/site/about?lang=hi", HINDI_SITE);
    await act(async () => {
      await router.navigate({ to: "/site/courses?stream=shiksha" as never });
    });
    await settle();
    expect(history.location.href).toBe("/site/courses?stream=shiksha&lang=hi");
    expect((router.state.location.search as Record<string, unknown>).stream).toBe("shiksha");
    expect((router.state.location.search as Record<string, unknown>).lang).toBe("hi");
  });

  it("moves a carried language out of a caller's #hash", async () => {
    const { router, history } = await mount("/site/about?lang=hi", HINDI_SITE);
    await act(async () => {
      await router.navigate({ to: "/site/faq#fees" as never });
    });
    await settle();
    expect(history.location.href).toBe("/site/faq?lang=hi#fees");
  });

  it("never touches the address of a site without languages", async () => {
    const inbound = await mount("/site/courses?stream=x?lang=hi", undefined);
    expect(inbound.history.location.href).toBe("/site/courses?stream=x?lang=hi");
    await inbound.unmount();

    const { router, history } = await mount("/site/about?lang=hi", undefined);
    await act(async () => {
      await router.navigate({ to: "/site/courses?stream=shiksha" as never });
    });
    await settle();
    expect(history.location.href).toBe("/site/courses?stream=shiksha");
  });

  it("useSiteNavigate keeps authored addresses exact unless a language is carried", async () => {
    const plain = await mount("/site/about?lang=hi", undefined);
    await act(async () => {
      await seen.siteNavigate!("/site/courses?v=1.0&category=a,b");
    });
    expect(plain.history.location.href).toBe("/site/courses?v=1.0&category=a,b");
    await plain.unmount();

    const hindi = await mount("/site/about?lang=hi", HINDI_SITE);
    const repaired = vi.spyOn(hindi.history, "replace");
    await act(async () => {
      await seen.siteNavigate!("/site/courses?stream=shiksha");
    });
    await settle();
    expect(hindi.history.location.href).toBe("/site/courses?stream=shiksha&lang=hi");
    expect(repaired).not.toHaveBeenCalled();
  });
});

describe("<html lang>", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
  });

  it("is the language the page's text is in, and is restored on unmount", async () => {
    const page = await mount("/site/courses?lang=hi", HINDI_SITE);
    expect(document.documentElement.lang).toBe("hi");
    await page.unmount();
    expect(document.documentElement.lang).toBe("en");
  });

  it("stays the base language for a language with no translations yet", async () => {
    document.documentElement.lang = "xx";
    await mount("/site/courses?lang=hi", { ...HINDI_SITE, strings: {} });
    expect(document.documentElement.lang).toBe("en");
  });

  it("is left alone on a site without languages", async () => {
    document.documentElement.lang = "xx";
    await mount("/site/courses?lang=hi", undefined);
    expect(document.documentElement.lang).toBe("xx");
  });
});

describe("the remembered language", () => {
  it("is written when a visitor arrives with ?lang=", async () => {
    await mount("/site/courses?lang=hi", HINDI_SITE);
    expect(memoryStorage.get("catalogue-locale:site")).toBe("hi");
  });

  it("is neither read nor written by the builder preview (persist off)", async () => {
    memoryStorage.set("catalogue-locale:site", "hi");
    const preview = await mount("/site/courses", HINDI_SITE, { persist: false });
    expect(preview.text()).toBe("Add to cart|en");
    await preview.unmount();

    memoryStorage.clear();
    const hindiPreview = await mount("/site/courses?lang=hi", HINDI_SITE, { persist: false });
    expect(hindiPreview.text()).toBe("कार्ट में जोड़ें|hi");
    expect(memoryStorage.has("catalogue-locale:site")).toBe(false);
  });
});

describe("CatalogueLink", () => {
  it("navigates to the authored address byte for byte on a site without languages", async () => {
    // A stray ?lang= (campaign link) is neither carried nor added.
    const page = await mount("/site/about?lang=hi", undefined, { page: LinkPage, linkTo: "courses?v=1.0&category=a,b" });
    expect(page.link().getAttribute("href")).toBe("/site/courses?v=1.0&category=a,b");
    await page.click();
    expect(page.history.location.href).toBe("/site/courses?v=1.0&category=a,b");
  });

  it("carries the visitor's language in its href and on click, in one query string", async () => {
    const page = await mount("/site/about?lang=hi", HINDI_SITE, { page: LinkPage, linkTo: "courses?stream=shiksha" });
    expect(page.link().getAttribute("href")).toBe("/site/courses?stream=shiksha&lang=hi");
    const repaired = vi.spyOn(page.history, "replace");
    await page.click();
    expect(page.history.location.href).toBe("/site/courses?stream=shiksha&lang=hi");
    // Right the first time — not malformed and then repaired.
    expect(repaired).not.toHaveBeenCalled();
  });

  it("keeps the authored query exact when the language comes from the visitor's memory", async () => {
    memoryStorage.set("catalogue-locale:site", "hi");
    const page = await mount("/site/about", HINDI_SITE, { page: LinkPage, linkTo: "courses?v=1.0" });
    expect(page.link().getAttribute("href")).toBe("/site/courses?v=1.0&lang=hi");
    await page.click();
    expect(page.history.location.href).toBe("/site/courses?v=1.0&lang=hi");
  });
});
