// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Feature 'tabs': the opt-in icon stream tabs (courseCatalog.streams.variant
 * "icons"). The band, its counts and its ARIA behaviour — and proof that a
 * section without the variant still renders the golden markup byte for byte.
 */

const h = vi.hoisted(() => {
  const row = (n: number, tags: string) => ({
    id: `c${n}`,
    package_name: `Course ${n}`,
    package_session_id: `c${n}-ps`,
    level_name: "Beginner",
    min_plan_actual_price: 100 * n,
    currency: "INR",
    comma_separeted_tags: tags,
  });
  return {
    rows: [] as Record<string, unknown>[],
    // Two courses tagged with the stream, one only with its category, one with neither.
    streamRows: [row(1, "shiksha"), row(2, "shiksha,gita"), row(3, "vedic-maths"), row(4, "other")],
    // The golden discovery fixture (catalog-default-golden.test.ts).
    goldenRows: [] as Record<string, unknown>[],
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: "/courses" } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: "/courses", searchStr: "", search: {}, hash: "", href: "/courses" };
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
vi.mock("../../../-services/route-matcher", () => ({ RouteMatcher: { basePath: () => "" } }));
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
import { readFileSync } from "node:fs";
import enCoursePlayerB from "@/locales/en/coursePlayerB.json";
import hiCoursePlayerB from "@/locales/hi/coursePlayerB.json";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseCatalogComponent } from "../CourseCatalogComponent";
import i18next from "i18next";
import { ROW_BLEED_DEFAULT, ROW_BLEED_SHELL, StreamIconTabs } from "./StreamIconTabs";
import { ICON_TABS_ROOT_CLASS } from "./slots/use-tabs-slots";
import { firstGrapheme, resolveStreamIconTabs } from "./stream-icon-tabs-config";
import type { CatalogStream } from "./catalog-streams";

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
};

const STREAMS = { enabled: true, source: "folderLibrary", libraryId: LIBRARY, labelMode: "both", allLabel: "सभी", sticky: false };
const ICONS = { ...STREAMS, variant: "icons", showCounts: true, allSubtitle: "All courses" };

const section = (props: Record<string, unknown>, globalSettings: Record<string, unknown> = {}) =>
  e(CourseCatalogComponent, {
    title: "",
    showFilters: true,
    render: { layout: "grid", cardFields: [] },
    instituteId: "inst-1",
    tagName: "site",
    globalSettings,
    ...props,
  } as unknown as React.ComponentProps<typeof CourseCatalogComponent>);

const client = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  qc.setQueryData(["FOLDER_LIBRARY_PUBLIC", "inst-1", LIBRARY], TREE);
  return qc;
};

const mount = async (props: Record<string, unknown>, globalSettings: Record<string, unknown> = {}) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(e(QueryClientProvider, { client: client() }, section(props, globalSettings)));
  });
  await act(tick);
  await act(tick);
  return host;
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const tabs = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const visibleText = (el: Element) => {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only").forEach((n) => n.remove());
  return clone.textContent;
};

describe("resolveStreamIconTabs", () => {
  it("is null unless the streams are on and the variant is exactly 'icons'", () => {
    expect(resolveStreamIconTabs(undefined)).toBeNull();
    expect(resolveStreamIconTabs({ enabled: true })).toBeNull();
    expect(resolveStreamIconTabs({ enabled: true, variant: "pills", showCounts: true })).toBeNull();
    expect(resolveStreamIconTabs({ enabled: true, variant: "ICONS" })).toBeNull();
    expect(resolveStreamIconTabs({ enabled: false, variant: "icons" })).toBeNull();
  });

  it("reads showCounts (true only) and a trimmed allSubtitle", () => {
    expect(resolveStreamIconTabs({ enabled: true, variant: "icons" })).toEqual({ showCounts: false, allSubtitle: "" });
    expect(resolveStreamIconTabs({ enabled: true, variant: "icons", showCounts: "yes", allSubtitle: 3 })).toEqual({
      showCounts: false,
      allSubtitle: "",
    });
    expect(resolveStreamIconTabs({ enabled: true, variant: "icons", showCounts: true, allSubtitle: " All courses " })).toEqual({
      showCounts: true,
      allSubtitle: "All courses",
    });
  });

  it("firstGrapheme keeps a Devanagari cluster whole", () => {
    expect(firstGrapheme("शिक्षा")).toBe("शि");
    expect(firstGrapheme(" kala")).toBe("K");
    expect(firstGrapheme("")).toBe("");
  });
});

describe("StreamIconTabs (component)", () => {
  const stream = (over: Partial<CatalogStream>): CatalogStream => ({
    id: "s",
    slug: "s",
    title: "",
    subtitle: "",
    tag: "s",
    tags: ["s"],
    comingSoon: false,
    audienceId: null,
    categories: [],
    ...over,
  });
  const base = {
    streams: [
      stream({ id: "a", slug: "shastra", title: "शास्त्र व ग्रंथ", subtitle: "Scriptures | Texts", imageUrl: "https://cdn.example.com/a.png" }),
      stream({ id: "b", slug: "kala", title: "कला", subtitle: "Skills | Craft", accentColor: "#cc7722" }), // design-lint-ignore: test fixture colour
      stream({ id: "c", slug: "dharma", title: "धर्म", subtitle: "Virtue" }),
    ],
    active: null,
    allLabel: "सभी",
    labelMode: "both" as const,
    sticky: false,
    onSelect: () => {},
    controlsId: "grid",
  };

  it("without counts: no dot and no number; the All tab has the grid glyph and no image", () => {
    const html = renderToStaticMarkup(e(StreamIconTabs, { ...base, allSubtitle: "All courses" }));
    expect(html).not.toContain("·");
    expect(html).not.toContain("sr-only");
    expect(html).toContain(">Scriptures | Texts<");
    const host = document.createElement("div");
    host.innerHTML = html;
    const [all, shastra, kala, dharma] = [...host.querySelectorAll('[role="tab"]')];
    expect(all.querySelector("svg")).not.toBeNull();
    expect(all.querySelector("img")).toBeNull();
    expect(all.getAttribute("aria-selected")).toBe("true");
    expect(all.className).toContain("border-palette-accent");
    expect(shastra.className).toContain("border-transparent");
    expect(shastra.querySelector("img")!.getAttribute("src")).toBe("https://cdn.example.com/a.png");
    expect(shastra.querySelector("img")!.getAttribute("alt")).toBe("");
    // No image: the accent colour behind the first letter; no accent either: the palette sand.
    const kalaIcon = kala.firstElementChild as HTMLElement;
    expect(kalaIcon.getAttribute("style")).toContain("background-color");
    expect(kalaIcon.textContent).toBe("क");
    expect(dharma.firstElementChild!.className).toContain("bg-palette-sand");
    expect(dharma.firstElementChild!.textContent).toBe("ध");
  });

  it("is a band with the content column inside, sticky only when asked", () => {
    const html = renderToStaticMarkup(
      e(StreamIconTabs, { ...base, shellClassName: "catalogue-shell", shellStyle: { maxWidth: 10 } }),
    );
    expect(html).toContain('<div class="w-full border-b border-palette-border bg-catalogue-bg-elevated');
    expect(html).toContain('<div class="catalogue-shell" style="max-width:10px"><div role="tablist"');
    expect(html).not.toContain("sticky");
    expect(renderToStaticMarkup(e(StreamIconTabs, { ...base, sticky: true }))).toContain("sticky top-16 z-20 md:top-20");
    expect(renderToStaticMarkup(e(StreamIconTabs, { ...base, streams: [] }))).toBe("");
  });

  it("arrow keys move focus, click selects", async () => {
    const onSelect = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(e(StreamIconTabs, { ...base, onSelect })));
    const [all, shastra] = tabs(host);
    all.focus();
    await act(async () => {
      all.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(shastra);
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => shastra.click());
    expect(onSelect).toHaveBeenCalledWith("shastra");
    expect(all.tabIndex).toBe(0);
    expect(shastra.tabIndex).toBe(-1);
  });
});

describe("icon stream tabs in the Courses grid", () => {
  it("renders a full-bleed band at the top of the section with catalogue-total counts", async () => {
    h.rows = h.streamRows;
    const host = await mount({ streams: ICONS, syncUrl: false });
    const sectionRoot = host.firstElementChild as HTMLElement;
    expect(sectionRoot.className).toBe(ICON_TABS_ROOT_CLASS);
    const band = sectionRoot.firstElementChild as HTMLElement;
    expect(band.querySelector('[role="tablist"]')).not.toBeNull();
    expect(band.nextElementSibling!.className).toBe("w-full px-4 sm:px-6 lg:px-8");
    expect(band.nextElementSibling!.querySelector('[role="tablist"]')).toBeNull();

    const [all, shiksha, kala] = tabs(host);
    expect(visibleText(all)).toBe("सभीAll courses·4");
    expect(all.querySelector(".sr-only")!.textContent).toBe("4 courses");
    // Two stream-tagged courses + one tagged only with its category.
    expect(visibleText(shiksha)).toBe("शिक्षाEducation·3");
    expect(shiksha.querySelector(".sr-only")!.textContent).toBe("3 courses");
    expect(shiksha.querySelector("img")!.getAttribute("src")).toBe("https://cdn.example.com/shiksha.png");
    // Coming soon with no courses: the Soon pill instead of "· 0".
    expect(visibleText(kala)).toBe("ककलाArtSoon"); // the fallback icon's initial, then the name
    expect(kala.querySelector(".sr-only")).toBeNull();
    // The tab panel still names the active tab.
    expect(host.querySelector('[role="tabpanel"]')!.getAttribute("aria-labelledby")).toBe(all.id);

    // Selecting a stream filters the grid; the counts stay catalogue totals.
    await act(async () => shiksha.click());
    await act(tick);
    expect(tabs(host)[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs(host)[1].className).toContain("border-palette-accent");
    expect(host.querySelectorAll("h3.font-bold").length).toBe(3);
    expect(visibleText(tabs(host)[0])).toBe("सभीAll courses·4");
  });

  it("without showCounts shows the English line only", async () => {
    h.rows = h.streamRows;
    const host = await mount({ streams: { ...ICONS, showCounts: false }, syncUrl: false });
    const [all, shiksha] = tabs(host);
    expect(visibleText(all)).toBe("सभीAll courses");
    expect(visibleText(shiksha)).toBe("शिक्षाEducation");
  });

  it("lines its tabs up with the site content width", async () => {
    h.rows = h.streamRows;
    const host = await mount({ streams: ICONS, syncUrl: false }, { theme: { contentMaxWidth: 1152 } });
    const shell = host.querySelector('[role="tablist"]')!.parentElement as HTMLElement;
    expect(shell.className).toBe("catalogue-shell");
    expect(shell.getAttribute("style")).toContain("--catalogue-content-max: 1216px");
  });

  it("a section without variant 'icons' (other new keys ignored) renders the golden markup unchanged", async () => {
    // Same fixture as catalog-default-golden.test.ts → __golden__/discovery.html.
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
    h.rows = [
      row(1, { id: "p1", package_id: "p1", level_name: "English", package_session_id: "p1-en" }),
      row(2, { id: "p1", package_id: "p1", level_name: "Hindi", package_session_id: "p1-hi", min_plan_actual_price: 150 }),
      row(3, { id: "p2", package_id: "p2", level_name: "Hindi", package_session_id: "p2-hi", comma_separeted_tags: "vedic-maths" }),
      row(4, { id: "p3", package_id: "p3", level_name: "English", package_session_id: "p3-en", min_plan_actual_price: 0 }),
    ];
    const host = await mount(
      {
        title: "All courses",
        streams: {
          enabled: true,
          source: "folderLibrary",
          libraryId: LIBRARY,
          labelMode: "both",
          allLabel: "All courses",
          variant: "pills",
          showCounts: true,
          allSubtitle: "Everything",
        },
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
      },
      { courseLanguages: { enabled: true } },
    );
    const golden = readFileSync(
      resolve(process.cwd(), "src/routes/$tagName/-components/components/catalog/__golden__/discovery.html"),
      "utf8",
    );
    expect(stableIds(host.innerHTML)).toBe(golden);
  });
});

describe("icon stream tabs — review fixes", () => {
  const DEFAULT_ROOT = "py-8 sm:py-10 bg-catalogue-bg-subtle w-full";

  it("streams that come back empty: no band and the original padded section root", async () => {
    h.rows = h.streamRows;
    const host = await mount({ streams: { ...ICONS, libraryId: "missing-library" }, syncUrl: false });
    const sectionRoot = host.firstElementChild as HTMLElement;
    expect(tabs(host)).toHaveLength(0);
    expect(sectionRoot.className).toBe(DEFAULT_ROOT);
    expect(sectionRoot.querySelector(".border-palette-border")).toBeNull();
  });

  it("the icon band does not stick unless sticky: true is set (sidebar offset follows)", async () => {
    h.rows = h.streamRows;
    const { sticky: _omit, ...noSticky } = ICONS;
    void _omit;
    let host = await mount({ streams: noSticky, syncUrl: false });
    let band = (host.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
    expect(band.className).not.toContain("sticky");
    expect(host.querySelector(".lg\\:top-40")).toBeNull();
    expect(host.querySelector(".lg\\:top-20")).not.toBeNull();
    act(() => root?.unmount());
    document.body.innerHTML = "";

    host = await mount({ streams: { ...ICONS, sticky: true }, syncUrl: false });
    band = (host.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
    expect(band.className).toContain("sticky top-16 z-20 md:top-20");
    expect(host.querySelector(".lg\\:top-40")).not.toBeNull();
  });

  it("the loading skeleton uses the band's root and a placeholder band", () => {
    h.rows = h.streamRows;
    const html = renderToStaticMarkup(e(QueryClientProvider, { client: client() }, section({ streams: ICONS })));
    const host = document.createElement("div");
    host.innerHTML = html;
    const skeletonRoot = host.firstElementChild as HTMLElement;
    expect(skeletonRoot.className).toBe(ICON_TABS_ROOT_CLASS);
    const band = skeletonRoot.firstElementChild as HTMLElement;
    expect(band.getAttribute("aria-hidden")).toBe("true");
    expect(band.className).toContain("border-palette-border");
    expect(band.querySelectorAll(".rounded-full.catalogue-skeleton-shimmer")).toHaveLength(6);
    expect(band.querySelector('[role="tab"]')).toBeNull();
  });

  it("a section without the variant keeps the original loading skeleton", () => {
    h.rows = h.streamRows;
    const html = renderToStaticMarkup(e(QueryClientProvider, { client: client() }, section({ streams: STREAMS })));
    expect(html.startsWith('<div class="py-8 sm:py-10 w-full bg-catalogue-bg-subtle"><div class="w-full px-4')).toBe(true);
  });

  it("the scrolling row runs to the screen edges below lg, matching the shell's gutter", async () => {
    h.rows = h.streamRows;
    let host = await mount({ streams: ICONS, syncUrl: false });
    expect(host.querySelector('[role="tablist"]')!.className).toContain(ROW_BLEED_DEFAULT);
    act(() => root?.unmount());
    document.body.innerHTML = "";
    host = await mount({ streams: ICONS, syncUrl: false }, { theme: { contentMaxWidth: 1152 } });
    const list = host.querySelector('[role="tablist"]')!;
    expect(list.className).toContain(ROW_BLEED_SHELL);
    expect(list.className).not.toContain("sm:-mx-6");
  });

  it("the screen-reader count says '0 courses' in Hindi (CLDR 'one' includes 0)", async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: "hi",
      fallbackLng: "en",
      ns: ["coursePlayerB"],
      defaultNS: "coursePlayerB",
      resources: { en: { coursePlayerB: enCoursePlayerB }, hi: { coursePlayerB: hiCoursePlayerB } },
      interpolation: { escapeValue: false },
    });
    const say = (count: number) => i18n.t("catalogTabs.countA11y", { count, course: "course", courses: "courses" });
    expect(say(0)).toBe("0 courses");
    expect(say(1)).toBe("1 course");
    expect(say(3)).toBe("3 courses");
    await i18n.changeLanguage("en");
    expect(say(0)).toBe("0 courses");
    expect(say(1)).toBe("1 course");
  });
});
