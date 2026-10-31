// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Feature 'hero' end to end in the real Courses grid (no slot mocks):
 * courseCatalog.hero → the cream hero (breadcrumb, H1, live stats, search,
 * Popular shortcuts), the results header and the labelled/filled quick
 * filters. Plus: a section without the prop (or with every part off) renders
 * the golden markup of today's grid.
 */

const h = vi.hoisted(() => {
  const tags = ["shiksha", "vedic-maths", "kala", "shiksha", "kala", "vedic-maths"];
  return {
    pathname: "/site/courses",
    rows: tags.map((tag, i) => ({
      id: `c${i + 1}`,
      package_name: `Course ${i + 1}`,
      package_session_id: `c${i + 1}-ps`,
      enroll_invite_id: `inv-${i + 1}`,
      level_name: "Beginner",
      min_plan_actual_price: i === 2 ? 0 : 100 * (i + 1),
      currency: "INR",
      comma_separeted_tags: tag,
      created_at: `2026-0${i + 1}-01T00:00:00Z`,
    })) as Record<string, unknown>[],
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ tagName: "site" }),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: h.pathname } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: h.pathname, searchStr: "", search: {}, hash: "", href: h.pathname };
    return opts?.select ? opts.select(location) : location;
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => {
      const values = typeof opts === "object" && opts ? (opts as Record<string, unknown>) : {};
      const text =
        typeof opts === "string" ? opts : typeof values.defaultValue === "string" ? values.defaultValue : key;
      return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
    },
    i18n: { language: "en" },
  }),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: (_term: string, fallback: string) => fallback,
  getTerminologyPlural: (_term: string, fallback: string) => `${fallback}s`,
}));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: async () => "" }));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => false }));
vi.mock("@/constants/urls", () => ({ BASE_URL: "", urlCourseDetails: "/courses-search" }));
vi.mock("../../../-services/route-matcher", () => ({
  RouteMatcher: {
    basePath: () => "",
    normalizeRoute: (route: string) =>
      route.toLowerCase().replace(/^\//, "").replace(/\/$/, "").replace(/^homepage$/, "home").trim(),
    pagePath: (tag: string, route?: string) =>
      !route || route === "homepage" ? `/${tag}` : `/${tag}/${route.replace(/^\/+/, "")}`,
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("axios", () => {
  const api: Record<string, unknown> = {
    post: async () => ({ data: { content: h.rows, totalElements: h.rows.length } }),
    get: async () => ({ data: {} }),
  };
  api.create = () => api;
  return { default: api };
});

import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseCatalogComponent } from "../CourseCatalogComponent";
import { QuickFilterBar } from "./QuickFilterBar";
import { PreviewPathProvider, isHomePreviewPath } from "../../../-utils/preview-path";
import { isSiteHomePath } from "./CatalogHero";
import { COUNT_ANNOUNCE_DELAY_MS } from "./CatalogResultsHeader";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const stableIds = (html: string): string => {
  const ids = new Map<string, string>();
  return html.replace(/«r[0-9a-z]+»/g, (id) => {
    if (!ids.has(id)) ids.set(id, `«id${ids.size}»`);
    return ids.get(id)!;
  });
};

const LIBRARY = "lib-1";
const TREE = {
  library: { id: LIBRARY, name: "Streams" },
  roots: [
    {
      id: "s1",
      node_type: "FOLDER",
      title: "शिक्षा",
      subtitle: "Education",
      slug: "shiksha",
      children: [
        { id: "c1", node_type: "FOLDER", title: "वैदिक गणित", subtitle: "Vedic Maths", slug: "vedic-maths", children: [] },
      ],
    },
    { id: "s2", node_type: "FOLDER", title: "कला", subtitle: "Art", slug: "kala", children: [] },
  ],
};

const DISCOVERY = {
  title: "",
  showFilters: true,
  render: { layout: "grid", cardFields: [] },
  instituteId: "inst-1",
  tagName: "site",
  streams: { enabled: true, source: "folderLibrary", libraryId: LIBRARY, labelMode: "both", allLabel: "All courses" },
  syncUrl: false,
  showAppliedChips: true,
  quickFilters: [
    { id: "qf-popular", label: "Popular", kind: "popular" },
    { id: "qf-free", label: "Free", kind: "free" },
  ],
  priceFilter: { enabled: true, showFree: true },
  categoryFilter: { enabled: true, label: "Category" },
  mobileFilterSheet: true,
  defaultSort: "Popular",
};

const HERO = {
  enabled: true,
  breadcrumb: [{ label: "Home", route: "homepage" }, { label: "Courses" }],
  title: "All courses",
  lead: "E-learning courses across six knowledge streams.",
  stats: [
    { kind: "courses", label: "courses & resources" },
    { kind: "streams", label: "knowledge streams" },
  ],
  search: { enabled: true, placeholder: "Search courses, topics or teachers", buttonText: "Search" },
  popularLabel: "Popular:",
  popular: [
    { label: "Vedic Maths", streamSlug: "shiksha", categorySlug: "vedic-maths" },
    { label: "Ghost stream", streamSlug: "nope" },
    { label: "Ghost category", streamSlug: "kala", categorySlug: "nope" },
    { label: "Free", quickFilterId: "qf-free" },
    { label: "Ghost quick", quickFilterId: "qf-none" },
    { label: "Course five", searchValue: "Course 5" },
    { label: "About", route: "about-us" },
  ],
  resultsHeader: {
    enabled: true,
    countText: "Showing {count} courses",
    countTextOne: "Showing {count} course",
    allStreamsLabel: "All streams",
    sortPrefix: "Sort:",
    sortLabels: { popular: "Most popular" },
  },
  quickFilterBar: { label: "Quick filters:", variant: "filled" },
};

const client = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  qc.setQueryData(["FOLDER_LIBRARY_PUBLIC", "inst-1", LIBRARY], TREE);
  return qc;
};
const element = (props: Record<string, unknown>, globalSettings: Record<string, unknown> = {}) =>
  e(
    QueryClientProvider,
    { client: client() },
    e(CourseCatalogComponent, { ...DISCOVERY, globalSettings, ...props } as unknown as React.ComponentProps<
      typeof CourseCatalogComponent
    >),
  );
const mount = async (props: Record<string, unknown>, globalSettings: Record<string, unknown> = {}) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element(props, globalSettings)));
  await act(tick);
  await act(tick);
  return host;
};
const unmount = () => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
};

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const cardTitles = (host: HTMLElement) => [...host.querySelectorAll("h3.font-bold")].map((n) => n.textContent);
const spans = (header: Element) => [...header.querySelectorAll("p > span")].map(text);
const heroOf = (host: HTMLElement) => host.querySelector("[data-catalog-hero]") as HTMLElement;
const headerOf = (host: HTMLElement) => host.querySelector("[data-catalog-results-header]") as HTMLElement;
const chip = (host: HTMLElement, label: string) =>
  [...heroOf(host).querySelectorAll("button, a")].find((b) => text(b) === label) as HTMLElement | undefined;
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
  await act(tick);
};
const typeInto = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(tick);
};

let scrolled: Element[] = [];
beforeEach(() => {
  h.pathname = "/site/courses";
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  } as unknown as Element["scrollIntoView"];
});
afterEach(unmount);

describe("courseCatalog.hero: page hero", () => {
  it("renders above the section with breadcrumb, H1, lead and live stats; no stray title block", async () => {
    const host = await mount({ hero: HERO });
    const hero = heroOf(host);
    expect(hero.tagName).toBe("SECTION");
    expect(hero.parentElement).toBe(host);
    expect(hero.className).toBe("w-full bg-palette-cream");
    expect(hero.nextElementSibling!.className).toBe("py-8 sm:py-10 bg-catalogue-bg-subtle w-full");

    const crumbs = hero.querySelector("nav")!;
    expect([...crumbs.querySelectorAll("li")].map(text)).toEqual(["Home/", "Courses"]);
    expect(crumbs.querySelector("a")!.getAttribute("href")).toBe("/site");
    expect(text(crumbs.querySelector('[aria-current="page"]'))).toBe("Courses");

    const h1 = hero.querySelector("h1")!;
    expect(text(h1)).toBe("All courses");
    expect(hero.getAttribute("aria-labelledby")).toBe(h1.id);
    expect(text(hero.querySelector("p"))).toBe("E-learning courses across six knowledge streams.");
    expect([...hero.querySelectorAll("ul > li")].map((li) => [...li.children].map(text))).toEqual([
      ["6", "courses & resources"],
      ["2", "knowledge streams"],
    ]);

    // The catalog's own title block (accent bar + h2) is gone: the hero owns the heading.
    expect(host.querySelector("h2.catalogue-h2")).toBeNull();
    expect(host.querySelectorAll("h1")).toHaveLength(1);
  });

  it("shows while the grid loads, with shimmering numbers", () => {
    const html = renderToStaticMarkup(element({ hero: HERO }));
    expect(html.startsWith('<section class="w-full bg-palette-cream"')).toBe(true);
    expect(html).toContain(">All courses</h1>");
    const stats = html.slice(html.indexOf("<ul"), html.indexOf("</ul>"));
    expect(stats.match(/catalogue-skeleton-shimmer/g)).toHaveLength(2);
    expect(stats).toContain("courses &amp; resources");
  });

  it("hides the breadcrumb on the site's home route", async () => {
    h.pathname = "/site/";
    const host = await mount({ hero: HERO });
    expect(heroOf(host).querySelector("nav")).toBeNull();
    expect(text(heroOf(host).querySelector("h1"))).toBe("All courses");
  });

  it("also on the home page's own route (/site/home, /site/homepage), not on other pages", async () => {
    for (const path of ["/site/home", "/site/Homepage/"]) {
      h.pathname = path;
      const host = await mount({ hero: HERO });
      expect(heroOf(host).querySelector("nav")).toBeNull();
      unmount();
    }
    expect(isSiteHomePath("/site/home", "site")).toBe(true);
    expect(isSiteHomePath("/site", "site")).toBe(true);
    expect(isSiteHomePath("/site/courses", "site")).toBe(false);
    expect(isSiteHomePath("/site/courses/home", "site")).toBe(false);
    expect(isSiteHomePath("/other/home", "site")).toBe(false);
  });

  it("in the editor preview, follows the shown page's real route instead of the address bar", async () => {
    // The Website view renders every page at the site root ("/site/") and posts its real route.
    h.pathname = "/site/";
    const at = async (previewPath: string) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      await act(async () => root!.render(e(PreviewPathProvider, { value: previewPath }, element({ hero: HERO }))));
      await act(tick);
      await act(tick);
      return host;
    };
    expect(heroOf(await at("courses")).querySelector("nav")).not.toBeNull();
    unmount();
    expect(heroOf(await at("")).querySelector("nav")).toBeNull();
    unmount();
    expect(heroOf(await at("home")).querySelector("nav")).toBeNull();
    expect(isHomePreviewPath("/homepage/")).toBe(true);
    expect(isHomePreviewPath("learning-paths")).toBe(false);
  });

  it("carries a section palette (courseCatalog.palette), since it sits outside the section root", async () => {
    const palette = { primary: "#883000", cream: "#FDF6E8" }; // design-lint-ignore: test fixture colours
    const host = await mount({ hero: HERO, palette });
    const hero = heroOf(host);
    const sectionRoot = hero.nextElementSibling as HTMLElement;
    expect(hero.style.getPropertyValue("--palette-primary")).toBe(
      sectionRoot.style.getPropertyValue("--palette-primary"),
    );
    expect(hero.style.getPropertyValue("--palette-primary")).not.toBe("");
    expect(hero.style.getPropertyValue("--palette-cream")).not.toBe("");
    unmount();

    // With an authored band fill too: both apply.
    const both = await mount({ hero: { ...HERO, backgroundColor: "#FFFFFF" }, palette }); // design-lint-ignore: test fixture colour
    expect(heroOf(both).style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(heroOf(both).style.getPropertyValue("--palette-primary")).not.toBe("");
    unmount();

    // No section palette: no style attribute at all.
    const plain = await mount({ hero: HERO });
    expect(heroOf(plain).hasAttribute("style")).toBe(false);
  });

  it("uses an authored band colour and the theme's content width", async () => {
    const host = await mount(
      { hero: { ...HERO, backgroundColor: "#FDF6E8" } }, // design-lint-ignore: test fixture colour
      { theme: { contentMaxWidth: 1152 } },
    );
    const hero = heroOf(host);
    expect(hero.style.backgroundColor).toBe("rgb(253, 246, 232)");
    const shell = hero.firstElementChild as HTMLElement;
    expect(shell.className).toContain("catalogue-shell");
    expect(shell.style.getPropertyValue("--catalogue-content-max")).toBe("1216px");
  });

  it("search: typing filters live, Search writes the term and scrolls to the results header", async () => {
    const host = await mount({ hero: HERO });
    const form = heroOf(host).querySelector('form[role="search"]') as HTMLFormElement;
    const input = form.querySelector('input[type="search"]') as HTMLInputElement;
    expect(input.placeholder).toBe("Search courses, topics or teachers");
    expect(text(form.querySelector('button[type="submit"]'))).toBe("Search");
    // One search box on the page: the toolbar card (and its input) is gone.
    expect(host.querySelector(".catalogue-toolbar")).toBeNull();
    expect(host.querySelectorAll('input[type="search"], input[type="text"]')).toHaveLength(1);

    await typeInto(input, "Course 4");
    expect(cardTitles(host)).toEqual(["Course 4"]);
    expect(scrolled).toHaveLength(0);

    await act(async () => form.requestSubmit());
    await act(tick);
    expect(scrolled).toEqual([headerOf(host)]);
    expect(spans(headerOf(host))[0]).toBe("Showing 1 course");

    const clear = form.querySelector('button[aria-label="common.clearSearch"]')!;
    await click(clear);
    expect(input.value).toBe("");
    expect(cardTitles(host)).toHaveLength(6);
  });

  it("popular chips: stream + category, quick filter, search value, link; unknown targets are hidden", async () => {
    const host = await mount({ hero: HERO });
    const row = heroOf(host).querySelector('[role="group"]')!;
    expect(row.getAttribute("aria-label")).toBe("Popular");
    expect([...row.children].map(text)).toEqual(["Popular:", "Vedic Maths", "Free", "Course five", "About"]);

    // Stream + category: opens the tab and selects the category; again = back to All.
    await click(chip(host, "Vedic Maths")!);
    expect(chip(host, "Vedic Maths")!.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toContain("शिक्षा");
    expect(cardTitles(host)).toEqual(["Course 2", "Course 6"]);
    expect(scrolled).toHaveLength(1);
    await click(chip(host, "Vedic Maths")!);
    expect(chip(host, "Vedic Maths")!.getAttribute("aria-pressed")).toBe("false");
    expect(cardTitles(host)).toHaveLength(6);

    // Quick filter: the same toggle as the quick-filter chip below.
    await click(chip(host, "Free")!);
    expect(chip(host, "Free")!.getAttribute("aria-pressed")).toBe("true");
    expect(cardTitles(host)).toEqual(["Course 3"]);
    await click(chip(host, "Free")!);
    expect(cardTitles(host)).toHaveLength(6);

    // Search value: sets the search; again clears it.
    await click(chip(host, "Course five")!);
    expect((heroOf(host).querySelector("input") as HTMLInputElement).value).toBe("Course 5");
    expect(cardTitles(host)).toEqual(["Course 5"]);
    await click(chip(host, "Course five")!);
    expect(cardTitles(host)).toHaveLength(6);

    // Link chip.
    expect(chip(host, "About")!.getAttribute("href")).toBe("/site/about-us");
  });
});

describe("courseCatalog.hero.resultsHeader", () => {
  it("count, stream chip and boxed sort replace the toolbar card", async () => {
    const host = await mount({ hero: HERO });
    const header = headerOf(host);
    expect(header.parentElement!.firstElementChild).toBe(header);
    const [count, streamChip] = [...header.querySelectorAll("p > span")];
    expect(text(count)).toBe("Showing 6 courses");
    expect(text(streamChip)).toBe("All streams");

    const select = header.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("Popular");
    expect(text(select.closest("label")!.querySelector("span"))).toBe("Sort: Most popular");
    expect([...select.options].find((o) => o.value === "Popular")!.textContent).toBe("Most popular");

    // The phone Filters button moves here.
    expect(text(header.querySelector('button[aria-haspopup="dialog"]'))).toBe("courseCatalog.filters");

    await act(async () => {
      select.value = "Newest";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(tick);
    expect(text(headerOf(host).querySelector("label span"))).toBe("Sort: Newest");

    // A stream tab: the chip names it (title; or the subtitle when asked).
    const tab = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent!.includes("कला"))!;
    await click(tab);
    expect(text(headerOf(host).querySelectorAll("p > span")[1])).toBe("कला");
    expect(text(headerOf(host).querySelectorAll("p > span")[0])).toBe("Showing 2 courses");
  });

  it("the stream chip ellipsizes; the count is announced once it settles, not per keystroke", async () => {
    const host = await mount({ hero: HERO });
    const header = headerOf(host);
    const streamChip = header.querySelectorAll("p > span")[1] as HTMLElement;
    expect(streamChip.className.split(" ")).toEqual(expect.arrayContaining(["inline-block", "truncate", "max-w-full"]));
    expect(streamChip.className).not.toContain("inline-flex");

    expect(header.querySelector("p")!.hasAttribute("aria-live")).toBe(false);
    const live = header.querySelector("[data-catalog-results-live]") as HTMLElement;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.getAttribute("aria-atomic")).toBe("true");
    expect(live.className).toBe("sr-only");
    expect(text(live)).toBe("Showing 6 courses");

    const input = heroOf(host).querySelector('input[type="search"]') as HTMLInputElement;
    await typeInto(input, "Course");
    await typeInto(input, "Course 4");
    // The visible count follows at once; the live region waits.
    expect(spans(headerOf(host))[0]).toBe("Showing 1 course");
    expect(text(live)).toBe("Showing 6 courses");
    await act(() => new Promise((resolve) => setTimeout(resolve, COUNT_ANNOUNCE_DELAY_MS + 50)));
    expect(text(headerOf(host).querySelector("[data-catalog-results-live]"))).toBe("Showing 1 course");
  });

  it("built-in texts, subtitle chip, no chip, and a compact search when the hero has none", async () => {
    const host = await mount({
      hero: { resultsHeader: { enabled: true, streamChipMode: "subtitle" } },
    });
    expect(heroOf(host)).toBeNull();
    // Without a hero the section keeps its title block.
    expect(host.querySelector("h2.catalogue-h2")).not.toBeNull();
    const header = headerOf(host);
    expect(spans(header)).toEqual(["Showing 6 courses", "All streams"]);
    expect(text(header.querySelector("label span"))).toBe("Sort: Popular");
    const search = header.querySelector('input[type="search"]') as HTMLInputElement;
    expect(search).not.toBeNull();
    await typeInto(search, "Course 2");
    expect(spans(headerOf(host))).toEqual(["Showing 1 course", "All streams"]);

    const tab = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent!.includes("शिक्षा"))!;
    await typeInto(headerOf(host).querySelector("input") as HTMLInputElement, "");
    await click(tab);
    expect(text(headerOf(host).querySelectorAll("p > span")[1])).toBe("Education");
    unmount();

    const bare = await mount({ hero: { resultsHeader: { enabled: true, showStreamChip: false } } });
    expect(headerOf(bare).querySelectorAll("p > span")).toHaveLength(1);
  });
});

describe("courseCatalog.hero.quickFilterBar", () => {
  it("adds the visible label and the filled active chip", async () => {
    const host = await mount({ hero: { quickFilterBar: { label: "Quick filters:", variant: "filled" } } });
    const group = host.querySelector('[role="group"][aria-label="Quick filters:"]')!;
    expect(text(group.previousElementSibling)).toBe("Quick filters:");
    const popular = [...group.querySelectorAll("button")].find((b) => text(b) === "Popular")!;
    // Sorted by popularity by default → the Popular chip is on.
    expect(popular.getAttribute("aria-pressed")).toBe("true");
    expect(popular.className).toContain("bg-palette-primary");
    expect(popular.className).toContain("text-white");
    expect(popular.querySelector("svg")).not.toBeNull();
    const free = [...group.querySelectorAll("button")].find((b) => text(b) === "Free")!;
    expect(free.className).toContain("border-palette-border");
    // The toolbar card is untouched when only the quick filters opt in.
    expect(host.querySelector(".catalogue-toolbar")).not.toBeNull();
  });

  it("QuickFilterBar without the new props is the original markup", () => {
    const chips = [
      { id: "a", label: "Popular", active: true },
      { id: "b", label: "Free", active: false },
    ];
    const html = renderToStaticMarkup(e(QuickFilterBar, { chips, onToggle: () => {} }));
    expect(html).toBe(
      '<div class="catalogue-no-scrollbar mb-4 flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible" role="group" aria-label="Quick filters">' +
        '<button type="button" aria-pressed="true" class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-catalogue-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 border-primary-500 bg-primary-50 text-catalogue-brand-ink">' +
        html.slice(html.indexOf("<svg"), html.indexOf("</svg>") + 6) +
        "Popular</button>" +
        '<button type="button" aria-pressed="false" class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-catalogue-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 border-catalogue-border bg-catalogue-bg-elevated text-catalogue-text-secondary hover:border-catalogue-border-strong hover:text-catalogue-text-primary">Free</button>' +
        "</div>",
    );
  });
});

describe("sites without the hero render today's grid", () => {
  const GOLDEN_DISCOVERY = {
    title: "All courses",
    streams: { enabled: true, source: "folderLibrary", libraryId: LIBRARY, labelMode: "both", allLabel: "All courses" },
    syncUrl: false,
    showFilterCounts: true,
    showAppliedChips: true,
    quickFilters: [
      { id: "free", label: "", kind: "free" },
      { id: "hindi", label: "Hindi", kind: "language", value: "hi" },
    ],
    languageFilter: { enabled: true },
    priceFilter: { enabled: true, showFree: true, maxOptions: [1000] },
    categoryFilter: { enabled: true, label: "Category" },
    groupLanguageVersions: true,
    badges: { enabled: true, types: ["new", "free"] },
    mobileFilterSheet: true,
  };
  const versions = () => {
    const row = (n: number, extra: Record<string, unknown> = {}) => ({
      id: `c${n}`,
      package_name: `Course ${n}`,
      package_session_id: `c${n}-ps`,
      enroll_invite_id: `inv-${n}`,
      level_name: n % 3 === 0 ? "Advanced" : "Beginner",
      session_id: n % 2 ? "s-a" : "s-b",
      session_name: n % 2 ? "Morning" : "Evening",
      min_plan_actual_price: n % 4 === 0 ? 0 : 100 * n,
      min_plan_elevated_price: n % 5 === 0 ? 200 * n : undefined,
      currency: "INR",
      course_html_description_html: `<p>About course ${n}</p>`,
      comma_separeted_tags: n % 2 ? "shiksha,gita" : "kala",
      instructors: n % 3 === 1 ? [{ full_name: "Asha" }] : [],
      created_at: `2026-0${(n % 9) + 1}-01T00:00:00Z`,
      ...extra,
    });
    return [
      row(1, { id: "p1", package_id: "p1", level_name: "English", package_session_id: "p1-en" }),
      row(2, { id: "p1", package_id: "p1", level_name: "Hindi", package_session_id: "p1-hi", min_plan_actual_price: 150 }),
      row(3, { id: "p2", package_id: "p2", level_name: "Hindi", package_session_id: "p2-hi", comma_separeted_tags: "vedic-maths" }),
      row(4, { id: "p3", package_id: "p3", level_name: "English", package_session_id: "p3-en", min_plan_actual_price: 0 }),
    ];
  };
  const GOLDEN_TREE_CLIENT = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
    qc.setQueryData(["FOLDER_LIBRARY_PUBLIC", "inst-1", LIBRARY], {
      library: { id: LIBRARY, name: "Streams" },
      roots: [
        {
          id: "s1",
          node_type: "FOLDER",
          title: "शिक्षा",
          subtitle: "Education",
          slug: "shiksha",
          image_url: "https://cdn.example.com/shiksha.png",
          accent_color: "#883000", // design-lint-ignore: test fixture colour
          children: [
            {
              id: "c1",
              node_type: "FOLDER",
              title: "वैदिक गणित",
              subtitle: "Vedic Maths",
              slug: "vedic-maths",
              image_url: "https://cdn.example.com/vm.png",
              children: [],
            },
          ],
        },
        { id: "s2", node_type: "FOLDER", title: "कला", subtitle: "Art", slug: "kala", coming_soon: true, children: [] },
      ],
    });
    return qc;
  };

  it.each([
    ["no hero prop", {}],
    ["hero: {}", { hero: {} }],
    ["every part off", { hero: { enabled: false, title: "X", resultsHeader: { enabled: false }, quickFilterBar: {} } }],
  ])("%s → the golden discovery markup", async (_name: string, extra: Record<string, unknown>) => {
    h.pathname = "/courses";
    h.rows = versions();
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        e(
          QueryClientProvider,
          { client: GOLDEN_TREE_CLIENT() },
          e(CourseCatalogComponent, {
            showFilters: true,
            render: { layout: "grid", cardFields: [] },
            instituteId: "inst-1",
            tagName: "site",
            globalSettings: { courseLanguages: { enabled: true } },
            ...GOLDEN_DISCOVERY,
            ...extra,
          } as unknown as React.ComponentProps<typeof CourseCatalogComponent>),
        ),
      );
    });
    await act(tick);
    await act(tick);
    await expect(stableIds(host.innerHTML)).toMatchFileSnapshot("./__golden__/discovery.html");
  });
});
