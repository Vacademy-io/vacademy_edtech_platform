// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The course word on a हिन्दी / EN site, end to end: the app's real i18n
 * bootstrap (src/i18n.ts) with its real locale files, the real
 * CatalogueLocaleProvider, getTerminology() and useCourseTerms(), the real
 * Courses grid, and a real product-page step inside the real CatalogueChrome.
 * Only the network and the router are stubbed.
 */

const h = vi.hoisted(() => ({
  /** The address bar's query string (?lang=). */
  search: "",
  /** What the catalogue (site config) request returns for CatalogueChrome. */
  catalogue: null as unknown,
  /** One course, with a level, a session and a tag, so every legacy filter shows. */
  rows: [
    {
      id: "neet",
      package_name: "NEET Foundation",
      package_session_id: "neet-1",
      level_name: "Class 11",
      session_id: "session-2026",
      session_name: "2026 Batch",
      comma_separeted_tags: "Science",
      min_plan_actual_price: 100,
    },
  ],
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: `/site${h.search}` } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: "/site", searchStr: h.search, search: {}, hash: "", href: `/site${h.search}` };
    return opts?.select ? opts.select(location) : location;
  },
}));
vi.mock("axios", () => {
  const api: Record<string, unknown> = {
    post: async () => ({ data: { content: h.rows, totalElements: h.rows.length } }),
    get: async () => ({ data: {} }),
    defaults: { headers: { common: {} } },
    interceptors: { request: { use: () => 0 }, response: { use: () => 0 } },
  };
  api.create = () => api;
  return { default: api };
});
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: async () => "" }));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => false }));
vi.mock("../-services/route-matcher", () => ({ RouteMatcher: { basePath: () => "" } }));
// CatalogueChrome: its catalogue request, its header/footer renderer and fonts.
vi.mock("../-services/course-catalogue-service", () => ({
  CourseCatalogueService: { getCourseCatalogueByTag: async () => h.catalogue },
}));
vi.mock("../-components/JsonRenderer", () => ({ JsonRenderer: () => null }));
vi.mock("./catalogue-fonts", () => ({ collectConfigFontFamilies: () => [], ensureFontsLoaded: () => {} }));

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/i18n";
import { CourseCatalogComponent } from "../-components/components/CourseCatalogComponent";
import { CatalogueChrome } from "../-components/CatalogueChrome";
import { CatalogueSeoHead } from "../-components/CatalogueSeoHead";
import { StepProgress } from "@/routes/product-pages/$productPageCode/-components/StepProgress";
import { CatalogueLocaleProvider } from "./catalogue-locale";
import type { CatalogueI18nSettings } from "./catalogue-i18n";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HINDI_SITE: CatalogueI18nSettings = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: { hi: { Programmes: "कार्यक्रम" } },
};

let root: Root | null = null;
let host: HTMLElement;

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Re-renders until `ready` holds (real catalogs load asynchronously), at most ~3 s. */
const until = async (ready: () => boolean) => {
  for (let i = 0; i < 150 && !ready(); i += 1) {
    await act(tick);
  }
};

const render = async (tree: React.ReactElement, ready: () => boolean) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(e(I18nextProvider, { i18n }, e(QueryClientProvider, { client }, tree)));
  });
  await until(ready);
};

/** The logged-in app's language — with its terms catalog in, as after its first term. */
const appLanguage = async (lng: string) => {
  await act(async () => {
    await i18n.changeLanguage(lng);
    await i18n.loadNamespaces("terms");
  });
};

beforeEach(async () => {
  localStorage.clear();
  h.search = "";
  h.catalogue = null;
  await appLanguage("en");
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

/* ── the Courses grid ─────────────────────────────────────────────────── */

const grid = (settings: CatalogueI18nSettings | undefined) =>
  e(CatalogueLocaleProvider, {
    settings,
    scope: "site",
    children: e(CourseCatalogComponent, {
      title: "Courses",
      render: { layout: "grid", cardFields: [] },
      instituteId: "inst-1",
      tagName: "site",
      globalSettings: {},
    } as unknown as React.ComponentProps<typeof CourseCatalogComponent>),
  });

const buttons = () => [...host.querySelectorAll("button")].map((button) => button.textContent?.trim());
const headings = () => [...host.querySelectorAll("h3")].map((heading) => heading.textContent?.trim());
const searchBox = () => host.querySelector<HTMLInputElement>('input[type="text"]');

describe("the Courses grid on a हिन्दी / EN site", () => {
  it("Hindi page, English app: the card button, search box and filter headings are all Hindi", async () => {
    h.search = "?lang=hi";
    await render(grid(HINDI_SITE), () => buttons().includes("कोर्स देखें") && headings().includes("स्तर"));

    expect(buttons()).toContain("कोर्स देखें");
    expect(buttons()).not.toContain("Course देखें");
    expect(searchBox()?.placeholder).toBe("कोर्स खोजें...");
    expect(searchBox()?.getAttribute("aria-label")).toBe("कोर्स खोजें");
    expect(headings()).toEqual(expect.arrayContaining(["स्तर", "सत्र", "लोकप्रिय टैग"]));
    expect(headings()).not.toContain("Levels");
    // The logged-in app's language is untouched.
    expect(i18n.language).toBe("en");
  });

  it("English page, Hindi app: everything is English", async () => {
    await appLanguage("hi");
    await render(grid(HINDI_SITE), () => buttons().includes("View Course") && headings().includes("Levels"));

    expect(buttons()).toContain("View Course");
    expect(buttons()).not.toContain("View कोर्स");
    expect(searchBox()?.placeholder).toBe("Search courses...");
    expect(headings()).toEqual(expect.arrayContaining(["Levels", "Sessions", "Popular Tags"]));
    expect(i18n.language).toBe("hi");
  });

  it("a site without languages follows the app's language, as before", async () => {
    h.search = "?lang=hi";
    await render(grid(undefined), () => buttons().includes("View Course"));
    expect(searchBox()?.placeholder).toBe("Search courses...");
    expect(headings()).toEqual(expect.arrayContaining(["Levels", "Sessions", "Popular Tags"]));
    act(() => root?.unmount());
    root = null;

    await appLanguage("hi");
    await render(grid(undefined), () => buttons().includes("कोर्स देखें") && headings().includes("स्तर"));
    expect(searchBox()?.placeholder).toBe("कोर्स खोजें...");
  });
});

/* ── a product page in the site's chrome ──────────────────────────────── */

const productPage = () =>
  e(CatalogueChrome, { tagName: "site", instituteId: "inst-1", children: e(StepProgress) });

/** The step rail's labels, in order (the first one names the courses). */
const steps = () => [...host.querySelectorAll("nav span")].map((label) => label.textContent?.trim());
const hasStep = (label: string) => steps()[0] === label;

describe("a product page inside CatalogueChrome on a हिन्दी / EN site", () => {
  it("Hindi page, English app: the step names the courses in Hindi", async () => {
    h.search = "?lang=hi";
    h.catalogue = { pages: [], globalSettings: { i18n: HINDI_SITE } };
    await render(productPage(), () => hasStep("कोर्स चुनें"));

    expect(steps()[0]).toBe("कोर्स चुनें");
  });

  it("English page, Hindi app: the step is English", async () => {
    await appLanguage("hi");
    h.catalogue = { pages: [], globalSettings: { i18n: HINDI_SITE } };
    await render(productPage(), () => hasStep("Select courses"));

    expect(steps()[0]).toBe("Select courses");
  });

  it("the catalogue's own word shows through the site dictionary in Hindi, and as authored in English", async () => {
    h.catalogue = {
      pages: [],
      globalSettings: { i18n: HINDI_SITE, naming: { course: "Programme", coursePlural: "Programmes" } },
    };
    h.search = "?lang=hi";
    await render(productPage(), () => hasStep("कार्यक्रम चुनें"));
    expect(hasStep("कार्यक्रम चुनें")).toBe(true);
    act(() => root?.unmount());
    root = null;

    // A new visitor (nothing remembered) on the English page.
    localStorage.clear();
    h.search = "";
    await render(productPage(), () => hasStep("Select programmes"));
    expect(hasStep("Select programmes")).toBe(true);
  });

  it("a product page opened on its own (no site) follows the app's language, as before", async () => {
    const standalone = () => e(CatalogueChrome, { instituteId: "inst-1", children: e(StepProgress) });
    h.search = "?lang=hi";
    await render(standalone(), () => hasStep("Select courses"));
    expect(hasStep("Select courses")).toBe(true);
    act(() => root?.unmount());
    root = null;

    await appLanguage("hi");
    await render(standalone(), () => hasStep("कोर्स चुनें"));
    expect(hasStep("कोर्स चुनें")).toBe(true);
  });
});

/* ── the page head ────────────────────────────────────────────────────── */

describe("the page head on a site with languages", () => {
  it("names the courses in the site language, whatever words the page shell passed", async () => {
    document.title = "";
    h.search = "?lang=hi";
    // The page shells compute their words outside the provider (here, the
    // English ones a first render gets) and still hand them over.
    const head = e(CatalogueLocaleProvider, {
      settings: HINDI_SITE,
      scope: "site",
      children: e(CatalogueSeoHead, { page: undefined, instituteName: null, course: "Course", courses: "courses" }),
    });
    await render(head, () => document.title === "कोर्स कैटलॉग");

    expect(document.title).toBe("कोर्स कैटलॉग");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "हमारे कोर्स देखें और ऑनलाइन नामांकन करें।",
    );
  });
});
