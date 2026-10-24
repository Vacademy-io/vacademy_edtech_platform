// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
} from "@tanstack/react-router";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { NAMING_SETTINGS_KEY, type LocalizedNamingSettings } from "@/types/naming-settings";
import { CatalogueLocaleProvider, useCatalogueLocale } from "./catalogue-locale";
import { CatalogueNamingProvider, useCourseTerms, type CatalogueNaming } from "./catalogue-naming";
import type { CatalogueI18nSettings } from "./catalogue-i18n";

/**
 * The institute's terms on a public site with languages: CatalogueLocaleProvider
 * puts up the site term scope, so getTerminology() — and useCourseTerms() —
 * read the site language, not the app's. Rendered for real: a TanStack router
 * (memory history), the app's i18next instance with asynchronous catalogs, and
 * the real en / hi terms and coursePlayerB catalogs.
 */

const h = React.createElement;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

const realCatalog = (lng: string, ns: string): object =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../locales/${lng}/${ns}.json`), "utf8"));

const CATALOGS: Record<string, Record<string, object>> = {
  en: { common: {}, coursePlayerB: realCatalog("en", "coursePlayerB"), terms: realCatalog("en", "terms") },
  hi: { common: {}, coursePlayerB: realCatalog("hi", "coursePlayerB"), terms: realCatalog("hi", "terms") },
};

/** Reads held until released ("lng/ns"), and reads that fail the first time. */
const holding = new Set<string>();
const held = new Map<string, Array<() => void>>();
const failOnce = new Set<string>();

/** The app's lazy backend: asynchronous, like the real one. */
const backend: BackendModule = {
  type: "backend",
  init() {},
  read(lng, ns, callback) {
    const name = `${lng}/${ns}`;
    const answer = () => {
      const data = CATALOGS[lng]?.[ns];
      if (failOnce.delete(name) || !data) callback(new Error(`no catalog ${name}`), false);
      else callback(null, data as never);
    };
    if (holding.has(name)) held.set(name, [...(held.get(name) ?? []), answer]);
    else setTimeout(answer, 2);
  },
};

const release = async (name: string) => {
  holding.delete(name);
  await act(async () => {
    for (const answer of held.get(name) ?? []) answer();
    held.delete(name);
  });
};

const HINDI_SITE: CatalogueI18nSettings = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: { hi: { Programme: "कार्यक्रम" } },
};

/** What the pages render, render by render. */
const log = {
  /** The course word each site render read, as "<site language>:<word>". */
  site: [] as string[],
  /** The course word each render of the app's own page read. */
  app: [] as string[],
};
const seen: { setLocale?: (code: string) => void; hideFirst?: () => void } = {};

/** A section of a site page: the card button, as CourseCatalogComponent builds it. */
const SiteSection = () => {
  const { t } = useTranslation("coursePlayerB");
  const { locale, setLocale } = useCatalogueLocale();
  seen.setLocale = setLocale;
  const course = getTerminology("Course", "Course");
  log.site.push(`${locale}:${course}`);
  return h("p", null, t("courseCatalog.viewCourse", { course }));
};

/** useCourseTerms() under the catalogue's own naming block. */
const NamingProbe = () => {
  const { course, courses } = useCourseTerms();
  return h("span", { "data-terms": "" }, `${course}|${courses}`);
};

/** Throws on render: an error boundary above the page replaces it. */
const Broken = (): React.ReactElement => {
  throw new Error("a section crashed on its first render");
};

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? h("p", null, "error") : this.props.children;
  }
}

const current: {
  settings?: CatalogueI18nSettings;
  naming?: CatalogueNaming;
  broken: boolean;
  persist: boolean;
} = { broken: false, persist: false };

/** A catalogue page: its own provider around its sections, as the page shells mount it. */
const sitePage = () =>
  h(
    Boundary,
    null,
    h(CatalogueLocaleProvider, {
      settings: current.settings,
      scope: "site",
      persist: current.persist,
      children: h(CatalogueNamingProvider, {
        naming: current.naming,
        children: h(React.Fragment, null, h(SiteSection), h(NamingProbe), current.broken ? h(Broken) : null),
      }),
    }),
  );
// Two different page components, so moving between them replaces the provider.
const HomePage = () => sitePage();
const CoursesPage = () => sitePage();

/** One section under its own provider (what the pair page shows twice). */
const providerOf = (settings: CatalogueI18nSettings) =>
  h(CatalogueLocaleProvider, { settings, scope: "pair", persist: false, children: h(SiteSection) });

/** The pair page's first provider (a हिन्दी site), which leaves on its own. */
const FirstOfPair = () => {
  const [shown, setShown] = React.useState(true);
  seen.hideFirst = () => setShown(false);
  return shown ? providerOf({ ...HINDI_SITE, defaultLocale: "hi" }) : null;
};

/** The pair page's second provider (an English site); does not re-render when the first leaves. */
const SecondOfPair = () => providerOf(HINDI_SITE);

/** Two providers on screen at once — the first one leaves while the second stays. */
const PairPage = () => h(React.Fragment, null, h(FirstOfPair), h(SecondOfPair));

/** A page of the logged-in app: no provider. */
const AppPage = () => {
  const { t } = useTranslation("coursePlayerB");
  const course = getTerminology("Course", "Course");
  log.app.push(course);
  return h("p", null, t("courseCatalog.viewCourse", { course }));
};

const makeRouter = (initial: string) => {
  const rootRoute = createRootRoute({ component: () => h(Outlet) });
  const routes = [
    createRoute({ getParentRoute: () => rootRoute, path: "site/home", component: HomePage }),
    createRoute({ getParentRoute: () => rootRoute, path: "site/courses", component: CoursesPage }),
    createRoute({ getParentRoute: () => rootRoute, path: "dashboard", component: AppPage }),
    createRoute({ getParentRoute: () => rootRoute, path: "site/pair", component: PairPage }),
  ];
  const history = createMemoryHistory({ initialEntries: [initial] });
  return createRouter({ routeTree: rootRoute.addChildren(routes), history });
};

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

const mounted: Array<() => Promise<void>> = [];

/** Mounts the page at `url` under the app's i18next instance (`app`, the global one by default). */
const mount = async (url: string, settings: CatalogueI18nSettings | undefined, app: I18nInstance = i18next) => {
  current.settings = settings;
  const router = makeRouter(url);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(h(I18nextProvider, { i18n: app }, h(RouterProvider, { router })));
  });
  await settle();
  let gone = false;
  const unmount = async () => {
    if (gone) return;
    gone = true;
    await act(async () => root.unmount());
    host.remove();
  };
  mounted.push(unmount);
  return {
    router,
    unmount,
    text: () => host.querySelector("p")?.textContent,
    terms: () => host.querySelector("[data-terms]")?.textContent,
    go: async (to: string, search?: Record<string, string>) => {
      await act(async () => {
        await router.navigate({ to: to as never, search: search as never });
      });
      await settle();
    },
  };
};

/** The course word outside any render: whatever scope is up right now. */
const courseNow = () => getTerminology("Course", "Course");

const naming = (entries: LocalizedNamingSettings[]) =>
  localStorage.setItem(NAMING_SETTINGS_KEY, JSON.stringify(entries));

/**
 * The app's own options (src/i18n.ts): English, catalogs loaded on demand. A
 * new object per instance — i18next keeps, and grows, the arrays it is given.
 */
const appOptions = () => ({
  lng: "en",
  fallbackLng: "en",
  supportedLngs: [...SUPPORTED_LOCALES],
  nonExplicitSupportedLngs: true,
  load: "languageOnly" as const,
  ns: ["common", "coursePlayerB"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  react: { useSuspense: false, bindI18n: "languageChanged namingTermsChanged" },
});

/**
 * A new app instance: nothing read yet, and no site clone made from it — the
 * global one has been read from by every earlier test, and the clones made
 * from it are kept for the session.
 */
const freshApp = async (): Promise<I18nInstance> => {
  const app = i18next.createInstance();
  await app.use(backend).init(appOptions());
  return app;
};

beforeAll(async () => {
  await i18next.use(backend).init(appOptions());
});

beforeEach(async () => {
  localStorage.clear();
  log.site.length = 0;
  log.app.length = 0;
  current.naming = undefined;
  current.broken = false;
  current.persist = false;
  seen.setLocale = undefined;
  seen.hideFirst = undefined;
  holding.clear();
  held.clear();
  failOnce.clear();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  vi.restoreAllMocks();
});

describe("a हिन्दी page", () => {
  it("shows the site language's course word in the site language's sentence", async () => {
    const page = await mount("/site/home?lang=hi", HINDI_SITE);

    expect(page.text()).toBe("कोर्स देखें");
    // The app keeps its own language.
    expect(i18next.language).toBe("en");
  });

  it("reads the site language on the sections' very first render", async () => {
    naming([{ key: "Course", customValue: "Programme", locales: { hi: { customValue: "पाठ्यक्रम" } } }]);
    const page = await mount("/site/home?lang=hi", HINDI_SITE);

    expect(log.site[0]).toBe("hi:पाठ्यक्रम");
    expect(page.text()).toBe("पाठ्यक्रम देखें");
  });

  it("re-renders the sections once the site language's terms catalog lands", async () => {
    // The chrome's own catalog is in; the terms catalog is still on its way.
    await i18next.reloadResources(["hi"], ["coursePlayerB"]);
    i18next.removeResourceBundle("hi", "terms");
    holding.add("hi/terms");
    const page = await mount("/site/home?lang=hi", HINDI_SITE);
    expect(page.text()).toBe("Course देखें");

    await release("hi/terms");
    await settle();
    expect(page.text()).toBe("कोर्स देखें");
  });

  it("fetches the terms catalog again when it failed to arrive with the chrome", async () => {
    // The page's clone makes the first read of hi/terms, and that read fails.
    const app = await freshApp();
    failOnce.add("hi/terms");
    const page = await mount("/site/home?lang=hi", HINDI_SITE, app);
    await settle();

    expect(failOnce.has("hi/terms")).toBe(false);
    expect(app.hasResourceBundle("hi", "terms")).toBe(true);
    expect(page.text()).toBe("कोर्स देखें");
  });

  it("switches the word with the language, from the first render after the switch", async () => {
    const page = await mount("/site/home?lang=hi", HINDI_SITE);
    expect(page.text()).toBe("कोर्स देखें");
    const before = log.site.length;

    await act(async () => seen.setLocale!("en"));
    await settle();
    expect(page.text()).toBe("View Course");
    expect(log.site.slice(before).filter((entry) => entry.startsWith("en:"))).not.toHaveLength(0);
    expect(log.site.slice(before).filter((entry) => entry.startsWith("en:") && entry !== "en:Course")).toEqual([]);

    await act(async () => seen.setLocale!("hi"));
    await settle();
    expect(page.text()).toBe("कोर्स देखें");
  });
});

describe("an English page", () => {
  it("shows the English word even when the app runs in Hindi", async () => {
    await i18next.reloadResources(["hi"], ["coursePlayerB", "terms"]);
    await act(async () => {
      await i18next.changeLanguage("hi");
    });
    expect(courseNow()).toBe("कोर्स");

    const page = await mount("/site/home", HINDI_SITE);
    expect(page.text()).toBe("View Course");
  });
});

describe("a site without languages", () => {
  it("sets no scope: the words follow the app's language, as before", async () => {
    await i18next.reloadResources(["hi"], ["coursePlayerB", "terms"]);
    await act(async () => {
      await i18next.changeLanguage("hi");
    });
    const page = await mount("/site/home?lang=en", undefined);

    expect(page.text()).toBe("कोर्स देखें");
    expect(log.site).not.toHaveLength(0);
    expect(log.site.filter((entry) => entry !== "en:कोर्स")).toEqual([]);
    expect(courseNow()).toBe("कोर्स");
    await page.unmount();

    await act(async () => {
      await i18next.changeLanguage("en");
    });
    const english = await mount("/site/home?lang=hi", undefined);
    expect(english.text()).toBe("View Course");
    expect(courseNow()).toBe("Course");
  });
});

describe("the scope's lifetime", () => {
  it("lasts while the page is on screen and ends with it", async () => {
    const page = await mount("/site/home?lang=hi", HINDI_SITE);
    expect(courseNow()).toBe("कोर्स");

    await page.unmount();
    expect(courseNow()).toBe("Course");
  });

  it("stays with the next page of the site when the old page's cleanup runs after it", async () => {
    const page = await mount("/site/home?lang=hi", HINDI_SITE);
    await page.go("/site/courses", { lang: "hi" });

    // The home page's provider was replaced by the courses page's, which had
    // already put up its own scope: the old one lifted nothing.
    expect(page.text()).toBe("कोर्स देखें");
    expect(courseNow()).toBe("कोर्स");
  });

  it("ends when the visitor leaves the site, and the app's page re-renders in the app's language", async () => {
    // The visitor's remembered हिन्दी keeps the site in Hindi up to the moment
    // the app's page replaces it: that page's first render still sees the
    // scope, so it must render again once the scope is lifted.
    current.persist = true;
    localStorage.setItem("catalogue-locale:site", "hi");
    const page = await mount("/site/home?lang=hi", HINDI_SITE);
    expect(page.text()).toBe("कोर्स देखें");
    await page.go("/dashboard");

    expect(courseNow()).toBe("Course");
    expect(page.text()).toBe("View Course");
    expect(log.app.at(-1)).toBe("Course");
  });

  it("is not lifted by a provider that leaves while another one holds it", async () => {
    await i18next.reloadResources(["hi"], ["coursePlayerB", "terms"]);
    await act(async () => {
      await i18next.changeLanguage("hi");
    });
    const page = await mount("/site/pair", undefined);
    // The second (English) provider rendered last and holds the scope.
    expect(courseNow()).toBe("Course");
    const emit = vi.spyOn(i18next, "emit");

    await act(async () => seen.hideFirst!());
    await settle();
    expect(courseNow()).toBe("Course");
    expect(page.text()).toBe("View Course");
    // Nothing was lifted, so the app is not asked to re-render its translations.
    expect(emit).not.toHaveBeenCalledWith("namingTermsChanged");
  });

  it("is lifted after a while when the page's render never commits", async () => {
    // Every catalog already in, so the abandoned scope would read Hindi.
    await i18next.reloadResources(["hi"], ["coursePlayerB", "terms"]);
    const timers: Array<{ run: () => void; ms: number }> = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((run: () => void, ms?: number, ...args: unknown[]) => {
      if (ms === 10_000) {
        timers.push({ run, ms });
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(run, ms, ...args);
    }) as typeof setTimeout);
    vi.spyOn(console, "error").mockImplementation(() => {});

    current.broken = true;
    const page = await mount("/site/home?lang=hi", HINDI_SITE);
    expect(page.text()).toBe("error");
    // The thrown-away render set a scope that no cleanup will lift…
    expect(courseNow()).toBe("कोर्स");
    expect(timers.length).toBeGreaterThan(0);

    // …until its timer finds it never committed.
    await act(async () => timers.forEach((timer) => timer.run()));
    expect(courseNow()).toBe("Course");
  });
});

describe("useCourseTerms", () => {
  const PROGRAMME: CatalogueNaming = { course: "Programme", coursePlural: "Programmes" };

  it("gives the catalogue's own words in the site's base language, as before", async () => {
    current.naming = PROGRAMME;
    const page = await mount("/site/home", HINDI_SITE);

    expect(page.terms()).toBe("Programme|Programmes");
  });

  it("gives them on a site without languages, as before", async () => {
    current.naming = PROGRAMME;
    const page = await mount("/site/home?lang=hi", undefined);

    expect(page.terms()).toBe("Programme|Programmes");
  });

  it("translates them through the site's dictionary in another language", async () => {
    current.naming = PROGRAMME;
    const page = await mount("/site/home?lang=hi", HINDI_SITE);

    // "Programme" has a translation; "Programmes" does not, so the plural is
    // the institute's term in Hindi rather than an English word.
    expect(page.terms()).toBe("कार्यक्रम|कोर्स");
  });

  it("falls back to the localized term without a naming block, and follows the catalog landing", async () => {
    await i18next.reloadResources(["hi"], ["coursePlayerB"]);
    i18next.removeResourceBundle("hi", "terms");
    holding.add("hi/terms");
    const page = await mount("/site/home?lang=hi", HINDI_SITE);
    expect(page.terms()).toBe("Course|Courses");

    await release("hi/terms");
    await settle();
    expect(page.terms()).toBe("कोर्स|कोर्स");
  });
});
