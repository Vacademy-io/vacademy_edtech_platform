// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The render slots of the Courses grid (catalog/slots), each filled by a
 * stand-in for its feature hook: every output lands in its documented place,
 * receives a usable context, and a hook that returns nothing leaves the
 * original markup (the golden test covers that byte-for-byte).
 */

const h = vi.hoisted(() => ({
  rows: Array.from({ length: 14 }, (_, i) => ({
    id: `c${i + 1}`,
    package_name: `Course ${i + 1}`,
    package_session_id: `c${i + 1}-ps`,
    level_name: "Beginner",
    min_plan_actual_price: 100,
    comma_separeted_tags: i % 2 ? "shiksha" : "kala",
  })),
  hero: {} as Record<string, unknown>,
  tabs: {} as Record<string, unknown>,
  sidebar: {} as Record<string, unknown>,
  sections: {} as Record<string, unknown>,
  cards: {} as Record<string, unknown>,
  contexts: [] as unknown[],
}));

vi.mock("./slots/use-hero-slots", () => ({
  useHeroSlots: (ctx: unknown) => {
    h.contexts.push(ctx);
    return h.hero;
  },
}));
vi.mock("./slots/use-tabs-slots", () => ({ useTabsSlots: () => h.tabs }));
vi.mock("./slots/use-sidebar-slots", () => ({ useSidebarSlots: () => h.sidebar }));
vi.mock("./slots/use-sections-slots", () => ({ useSectionsSlots: () => h.sections }));
vi.mock("./slots/use-cards-slots", () => ({ useCardsSlots: () => h.cards }));

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
    t: (key: string, opts?: unknown) =>
      typeof opts === "string" ? opts : (opts as { defaultValue?: string })?.defaultValue ?? key,
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
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseCatalogComponent } from "../CourseCatalogComponent";
import type { CatalogSlotContext } from "./slots/catalog-slot-types";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const PROPS = {
  title: "All courses",
  showFilters: true,
  render: { layout: "grid", cardFields: [] },
  instituteId: "inst-1",
  tagName: "site",
  filtersConfig: [{ id: "level", type: "checkbox", field: "level" }],
  streams: {
    enabled: true,
    source: "tags",
    items: [
      { label: "Shiksha", slug: "shiksha", tag: "shiksha" },
      { label: "Kala", slug: "kala", tag: "kala" },
    ],
  },
  mobileFilterSheet: true,
};

const element = (props: Record<string, unknown> = {}, globalSettings: Record<string, unknown> = {}) =>
  e(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    e(CourseCatalogComponent, { ...PROPS, globalSettings, ...props } as unknown as React.ComponentProps<
      typeof CourseCatalogComponent
    >),
  );

const mount = async (props: Record<string, unknown> = {}, globalSettings: Record<string, unknown> = {}) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element(props, globalSettings)));
  await act(tick);
  await act(tick);
  return host;
};
const marker = (id: string) => () => e("div", { "data-slot": id });
const slot = (host: HTMLElement, id: string) => host.querySelector(`[data-slot="${id}"]`);
const lastContext = () => h.contexts[h.contexts.length - 1] as CatalogSlotContext;

beforeEach(() => {
  h.hero = {};
  h.tabs = {};
  h.sidebar = {};
  h.sections = {};
  h.cards = {};
  h.contexts = [];
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("render slots", () => {
  it("hero: above the section root (also while loading), title block hidden, toolbar + quick filters replaced", async () => {
    h.hero = {
      catalogHero: marker("hero"),
      hideTitleBlock: true,
      resultsHeader: marker("results-header"),
      quickFilterBar: marker("quick"),
    };
    const loading = renderToStaticMarkup(element());
    expect(loading.startsWith('<div data-slot="hero"></div><div class="py-8')).toBe(true);

    const host = await mount();
    const hero = slot(host, "hero")!;
    const sectionRoot = hero.nextElementSibling as HTMLElement;
    expect(hero.parentElement).toBe(host);
    expect(sectionRoot.className).toBe("py-8 sm:py-10 bg-catalogue-bg-subtle w-full");
    expect(host.querySelector("h2.catalogue-h2")).toBeNull();
    expect(host.querySelector(".catalogue-toolbar")).toBeNull();
    const main = slot(host, "results-header")!.parentElement!;
    expect(main.firstElementChild).toBe(slot(host, "results-header"));
    expect(slot(host, "results-header")!.nextElementSibling).toBe(slot(host, "quick"));
    // The tabs are still in the section, after the (hidden) title block.
    expect(sectionRoot.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it("hero: commitSearch filters the grid now", async () => {
    const host = await mount();
    act(() => lastContext().commitSearch("Course 12"));
    await act(tick);
    expect([...host.querySelectorAll("h3.font-bold")].map((n) => n.textContent)).toEqual(["Course 12"]);
  });

  it("tabs: one render call with the default props; 'band' puts it full-bleed before the content container", async () => {
    const seen: unknown[] = [];
    h.tabs = {
      streamTabs: (props: { streams: unknown[]; controlsId?: string }) => {
        seen.push(props);
        return e("div", { "data-slot": "tabs" });
      },
      streamTabsPlacement: "band",
      rootClassName: "pb-8 w-full",
    };
    const host = await mount();
    const root = host.firstElementChild as HTMLElement;
    expect(root.className).toBe("pb-8 w-full");
    expect(root.firstElementChild).toBe(slot(host, "tabs"));
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    const props = seen[seen.length - 1] as { streams: { slug: string }[]; active: string | null; controlsId: string };
    expect(props.streams.map((s) => s.slug)).toEqual(["shiksha", "kala"]);
    expect(props.active).toBeNull();
    expect(host.querySelector('[role="tabpanel"]')!.id).toBe(props.controlsId);
  });

  it("sidebar: layout classes, top/bottom, a replaced card and one filter-groups entry point", async () => {
    h.sidebar = {
      columnsClassName: "flex gap-10",
      sidebarColumnClassName: "w-full lg:w-72",
      sidebarColumnStyle: { "--fs-w": "280px" },
      sidebarStickyClassName: "static",
      sidebarTop: marker("side-top"),
      sidebarBottom: marker("side-bottom"),
      filterGroups: marker("groups"),
      mainColumnClassName: "flex-1",
    };
    let host = await mount();
    const column = slot(host, "side-top")!.parentElement!.parentElement!;
    expect(column.className).toBe("w-full lg:w-72");
    expect(column.getAttribute("style")).toContain("--fs-w: 280px");
    expect(column.parentElement!.className).toBe("flex gap-10");
    const sticky = slot(host, "side-top")!.parentElement!;
    expect(sticky.className).toBe("static");
    expect(sticky.firstElementChild).toBe(slot(host, "side-top"));
    expect(sticky.lastElementChild).toBe(slot(host, "side-bottom"));
    // The default card stays, with the groups from the one entry point.
    expect(sticky.querySelector(".catalogue-surface [data-slot=groups]")).not.toBeNull();
    expect(column.nextElementSibling!.className).toBe("flex-1");

    act(() => root?.unmount());
    h.sidebar = { sidebarPanel: marker("panel") };
    host = await mount();
    expect(slot(host, "panel")).not.toBeNull();
    expect(host.querySelector(".catalogue-surface")).toBeNull();
  });

  it("sections + cards: before/after the grid, heading, grid class, card renderer, visible cards, pagination", async () => {
    h.sections = { beforeGrid: marker("before"), afterGrid: marker("after") };
    h.cards = {
      gridHeading: marker("heading"),
      gridClassName: "grid gap-5",
      renderCard: (card: { courseId: string }, index: number, opts?: { keyPrefix?: string }) =>
        index === 0 ? undefined : e("article", { key: `${opts?.keyPrefix ?? ""}${card.courseId}`, "data-card": card.courseId }),
      pagination: marker("load-more"),
    };
    const host = await mount();
    const grid = slot(host, "heading")!.nextElementSibling as HTMLElement;
    expect(grid.className).toBe("grid gap-5");
    expect(slot(host, "before")!.nextElementSibling).toBe(slot(host, "heading"));
    // The first card fell back to the legacy markup; the rest are the slot's.
    expect(grid.children[0].tagName).toBe("DIV");
    expect(grid.querySelectorAll("article")).toHaveLength(11);
    expect(host.querySelector('nav[aria-label="courseCatalog.paginationAriaLabel"]')).toBeNull();
    expect(slot(host, "load-more")!.nextElementSibling).toBe(slot(host, "after"));
    expect(slot(host, "after")!.parentElement).toBe(grid.parentElement);
    // The results column is the context's resultsRef, the grid its gridRef.
    expect(lastContext().resultsRef.current).toBe(grid.parentElement);
    expect(lastContext().gridRef.current).toBe(grid);
  });

  it("cards: visibleCards replaces the current page; renderCourseCard reaches the same renderer", async () => {
    let ctxCards: unknown[] = [];
    h.cards = {
      visibleCards: undefined,
      renderCard: () => undefined,
    };
    const host = await mount();
    expect(host.querySelectorAll("h3.font-bold")).toHaveLength(12);
    ctxCards = lastContext().filteredCards;
    act(() => root?.unmount());
    h.cards = { visibleCards: ctxCards.slice(0, 13) };
    const host2 = await mount();
    expect(host2.querySelectorAll("h3.font-bold")).toHaveLength(13);
    const rendered = renderToStaticMarkup(
      e(React.Fragment, null, lastContext().renderCourseCard(lastContext().filteredCards[0], 0, { keyPrefix: "free-" })),
    );
    expect(rendered).toContain("Course");
  });

  it("context: data, counts and actions a feature needs", async () => {
    await mount();
    const ctx = lastContext();
    expect(ctx.isLoading).toBe(false);
    expect(ctx.allCards).toHaveLength(14);
    expect(ctx.paginatedCards).toHaveLength(12);
    expect(ctx.totalPages).toBe(2);
    expect(ctx.streamList.map((s) => s.slug)).toEqual(["shiksha", "kala"]);
    expect(ctx.filterData.legacy.level).toMatchObject({ shown: true, items: [{ id: "Beginner", name: "Beginner" }] });
    expect(ctx.contentMaxWidth).toBeNull();
    expect(ctx.shellStyle).toBeUndefined();
    expect(ctx.sortLabel(ctx.effectiveSort)).toBeTruthy();
  });
});

describe("content width + section palette (foundation opt-ins)", () => {
  it("lines the content container up as a catalogue-shell of the given width", async () => {
    const host = await mount({ contentMaxWidth: 1152 });
    const container = host.firstElementChild!.firstElementChild as HTMLElement;
    expect(container.className).toBe("catalogue-shell");
    expect(container.style.getPropertyValue("--catalogue-content-max")).toBe("1216px");
    expect(lastContext().contentMaxWidth).toBe(1152);
  });

  it("takes the width from globalSettings.theme when the section sets none", async () => {
    const host = await mount({}, { theme: { contentMaxWidth: 1000 } });
    expect((host.firstElementChild!.firstElementChild as HTMLElement).style.getPropertyValue("--site-content-max")).toBe(
      "1000px",
    );
  });

  it("puts a section palette's vars on the section root only", async () => {
    const host = await mount({ palette: { sand: "#f5eac9" } }); // design-lint-ignore: fixture colour
    expect((host.firstElementChild as HTMLElement).style.getPropertyValue("--palette-sand")).toBe("45 68.8% 87.5%");
  });
});
