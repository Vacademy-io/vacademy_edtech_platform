// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration: every opt-in Courses-grid feature switched on in ONE section,
 * as the Knowledge Streams site authors it (hero + results header + filled
 * quick filters, icon stream tabs, editorial sidebar with FORMAT / FOR groups
 * and the promo, editorial cards with version groups and Load more, the
 * column sections). Each feature has its own tests; this one pins how they
 * sit together in the real CourseCatalogComponent: one search box, the slots
 * in the Figma order, the shared format helper feeding both the FORMAT group
 * and the card pill, and grouped cards counted once everywhere.
 */

const h = vi.hoisted(() => {
  const row = (id: string, name: string, tags: string, extra: Record<string, unknown> = {}) => ({
    id,
    package_name: name,
    package_session_id: `${id}-ps`,
    enroll_invite_id: `inv-${id}`,
    level_name: "default",
    min_plan_actual_price: 251,
    currency: "INR",
    comma_separeted_tags: tags,
    course_html_description_html: `<p>${name} description</p>`,
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  });
  return {
    rows: [
      row("vp-en", "Vedic Parenting - eBook", "english,dharma,vedic-parenting,format-ebook,for-parents"),
      row("vp-hi", "वैदिक पेरेंटिंग - ई पुस्तक", "hindi,dharma,vedic-parenting,format-ebook,for-parents"),
      row("gv-en", "Vedic Garbha Vigyan", "english,swasthya,garbha-vigyan,format-ebook"),
      row("film", "Martand: The Unforgotten Sun Temple", "english,bharat,mandir", {
        level_name: "Short Film",
        min_plan_actual_price: 0,
      }),
      row("essay", "मैकलसुता नर्मदा मैया के दर्शन", "hindi,bharat,mandir", {
        level_name: "Article/Essay",
        min_plan_actual_price: 0,
      }),
      row("gita", "गीतायन - eBook", "hindi,shastra,gita", { level_name: "eBook", min_plan_actual_price: 51 }),
      row("rishi", "Rishi Intelligence", "english,shastra,rishi-gyan,format-elearning"),
      row("raghu", "Raghuveer Gadyam Learning Intensive", "english,shastra,stotra,format-live"),
      row("well-en", "Principles of wellness", "english,swasthya,swasthavritta,format-elearning"),
      row("well-hi", "स्वस्थ रहने के सिद्धांत", "hindi,swasthya,swasthavritta,format-elearning"),
      row("gs-en", "True Gurukul Shiksha", "english,shiksha,gurukul-shiksha,format-ebook,for-teachers"),
      row("gs-hi", "गुरुकुल शिक्षा", "hindi,shiksha,gurukul-shiksha,format-ebook,for-teachers"),
      row("ram", "Ram Lekhan Kala Karyashala", "hindi,kala,lekhan-kala,format-live", { min_plan_actual_price: 0 }),
    ] as Record<string, unknown>[],
    searchStr: "",
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ tagName: "site" }),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: "/courses" } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: "/site/courses", searchStr: h.searchStr, search: {}, hash: "", href: "/site/courses" };
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
  I18nextProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: (_term: string, fallback: string) => fallback,
  getTerminologyPlural: (_term: string, fallback: string) => `${fallback}s`,
}));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: async () => "" }));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => false }));
vi.mock("@/constants/urls", () => ({
  BASE_URL: "",
  urlCourseDetails: "/courses-search",
  ENROLLMENT_INVITE_URL: "/open/learner/enroll-invite",
  GET_PRODUCT_PAGE_BY_CODE: (code: string) => `/product-page/${code}`,
}));
vi.mock("../../../-services/route-matcher", () => ({
  RouteMatcher: {
    basePath: () => "/site",
    pagePath: (_tag: string, route: string) => `/site/${route.replace(/^\//, "")}`,
    normalizeRoute: (route: string) => route.replace(/^\/+|\/+$/g, "").toLowerCase(),
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
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseCatalogComponent } from "../CourseCatalogComponent";
import { popularityQueryKey } from "../../../-services/popularity-service";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const LIBRARY = "lib-ks";
const folder = (slug: string, title: string, subtitle: string, children: unknown[] = []) => ({
  id: slug,
  node_type: "FOLDER",
  title,
  subtitle,
  slug,
  course_tag: slug,
  children,
});
const cat = (slug: string, title: string, subtitle: string, extra: Record<string, unknown> = {}) => ({
  ...folder(slug, title, subtitle),
  ...extra,
});
const TREE = {
  library: { id: LIBRARY, name: "Knowledge Streams" },
  roots: [
    folder("shastra", "शास्त्र व ग्रंथ", "Scriptures | Texts", [
      cat("gita", "गीता", "Bhagavad Gita"),
      cat("stotra", "स्तोत्र", "Stotra"),
      cat("rishi-gyan", "ऋषि ज्ञान", "Rishi knowledge"),
    ]),
    folder("bharat", "भारत परिक्रमा", "Orbiting Bharat", [cat("mandir", "मंदिरों का भारत", "India of temples")]),
    folder("shiksha", "शिक्षा", "Education", [
      cat("gurukul-shiksha", "गुरुकुल शिक्षा", "Gurukul Education"),
      cat("chhanda", "छन्द शास्त्र", "Chhanda shastra", { coming_soon: true, audience_id: "aud-notify" }),
      cat("sanskrit", "संस्कृत भाषा शिक्षण", "Sanskrit Language teaching", { coming_soon: true, audience_id: "aud-notify" }),
    ]),
    folder("swasthya", "स्वास्थ्य व आयुर्वेद", "Health | Ayurveda", [
      cat("swasthavritta", "स्वस्थ वृत्त", "SwasthaVritta"),
      cat("garbha-vigyan", "गर्भ विज्ञान", "Garbha Vigyan"),
    ]),
    folder("dharma", "धर्म | संस्कृति", "Virtue | Civilisation", [cat("vedic-parenting", "वैदिक पेरेंटिंग", "Holistic Parenting")]),
    folder("kala", "कला | शिल्प", "Skills | Craft", [cat("lekhan-kala", "लेखन कला", "Writing arts")]),
  ],
};

const GLOBAL = {
  theme: { contentMaxWidth: 1152 },
  courseLanguages: {
    enabled: true,
    languages: [
      { code: "en", label: "English", chip: "EN", match: ["english", "en"] },
      { code: "hi", label: "Hindi", chip: "हिं", match: ["hindi", "hi"] },
    ],
    versionGroups: [
      ["vp-en", "vp-hi"],
      ["well-en", "well-hi"],
      ["gs-en", "gs-hi"],
    ],
  },
  courseFormats: {
    elearning: { label: "Interactive, self-paced E-learning" },
    ebook: { label: "E-books", levels: ["eBook"] },
    live: { label: "Live sessions" },
    video: { label: "Video" },
    animation: { label: "Short film / Animation", levels: ["Short Film"] },
    article: { label: "Articles-essays", levels: ["Article/Essay"] },
    merch: { label: "Merchandise (in collaboration)" },
    audiobook: { label: "Audio Book" },
  },
};

/** The Knowledge Streams courseCatalog props (bv/build_site.py), trimmed to what the features read. */
const KS = {
  title: "",
  showFilters: true,
  filtersConfig: [],
  instituteId: "inst-1",
  tagName: "site",
  syncUrl: false,
  showFilterCounts: true,
  showAppliedChips: true,
  mobileFilterSheet: true,
  groupLanguageVersions: true,
  defaultSort: "Popular",
  render: {
    layout: "grid",
    cardFields: ["package_name", "course_preview_image_media_id", "price", "course_html_description_html"],
    cardStyle: "editorial",
    card: {
      formatLabels: { elearning: "E-Learning", ebook: "E-book", animation: "Animation", article: "Articles - essays", live: "Live session" },
      freeCtaByFormat: { animation: "watch", video: "watch", ebook: "read", article: "read" },
    },
    pagination: { mode: "loadMore", pageSize: 4 },
    gridHeading: { showSort: true },
  },
  streams: {
    enabled: true,
    source: "folderLibrary",
    libraryId: LIBRARY,
    labelMode: "both",
    allLabel: "सभी",
    variant: "icons",
    showCounts: true,
    allSubtitle: "All courses",
  },
  quickFilters: [
    { id: "qf-popular", label: "", kind: "popular" },
    { id: "qf-free", label: "", kind: "free" },
  ],
  languageFilter: { enabled: true, label: "Language" },
  priceFilter: { enabled: true, label: "Price", showFree: true, maxOptions: [], control: "checkbox" },
  categoryFilter: {
    enabled: true,
    label: "Category  ·  श्रेणी",
    scope: "all",
    labelMode: "both",
    sort: "count",
    hideComingSoon: true,
    visibleCount: 6,
    showAllLabel: "+ Show all {count} categories",
  },
  customFilters: [
    { id: "format", label: "Format", source: "courseFormats" },
    {
      id: "for",
      label: "For",
      showCounts: false,
      options: [
        { id: "parents", label: "Parents", tags: ["for-parents"] },
        { id: "teachers", label: "Teachers", tags: ["for-teachers"] },
      ],
    },
  ],
  filterSidebar: {
    variant: "editorial",
    width: 280,
    order: ["price", "language", "format", "category", "for"],
    promo: {
      enabled: true,
      screenImage: "https://cdn.example.com/screen.png",
      eyebrow: "Brahm Varchas app",
      title: "Your learning, in your pocket",
      text: "Pick up where you left off.",
      button: { text: "Get the app", target: "/login" },
    },
  },
  hero: {
    enabled: true,
    breadcrumb: [{ label: "Home", route: "homepage" }, { label: "Courses" }],
    title: "All courses",
    lead: "E-learning courses, E-books, live sessions, videos and short films.",
    stats: [
      { kind: "courses", label: "courses & resources" },
      { kind: "streams", label: "knowledge streams" },
    ],
    search: { enabled: true },
    popular: [
      { label: "Holistic Parenting", streamSlug: "dharma", categorySlug: "vedic-parenting" },
      { label: "Free", quickFilterId: "qf-free" },
    ],
    resultsHeader: { enabled: true, streamChipMode: "subtitle", sortLabels: { popular: "Most popular" } },
    quickFilterBar: { label: "Quick filters:", variant: "filled" },
  },
  columnSections: [
    { id: "ks-free", kind: "free-courses", placement: "before-grid", showWhen: "unfiltered", courseIds: ["film", "essay", "ram"], limit: 3 },
    {
      id: "ks-flagship",
      kind: "spotlight",
      placement: "before-grid",
      showWhen: "unfiltered-or-own-stream",
      slides: [{ id: "rajaswala", eyebrow: "Flagship program", streamSlug: "swasthya", title: "Rajaswala Paricharya" }],
    },
    {
      id: "ks-soon",
      kind: "coming-soon",
      placement: "after-grid",
      showWhen: "always",
      title: "Coming soon",
      categorySlugs: ["chhanda", "sanskrit"],
    },
  ],
};

const mount = async (
  props: Record<string, unknown> = {},
  ranks: Map<string, number> = new Map([["vp-en", 1], ["rishi", 2]]),
) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  qc.setQueryData(["FOLDER_LIBRARY_PUBLIC", "inst-1", LIBRARY], TREE);
  qc.setQueryData(popularityQueryKey("inst-1"), ranks);
  await act(async () => {
    root!.render(
      e(
        QueryClientProvider,
        { client: qc },
        e(CourseCatalogComponent, {
          ...KS,
          globalSettings: GLOBAL,
          ...props,
        } as unknown as React.ComponentProps<typeof CourseCatalogComponent>),
      ),
    );
  });
  await act(tick);
  await act(tick);
  return host;
};

const before = (a: Element | null, b: Element | null) => {
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  return !!(a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING);
};

beforeEach(() => {
  h.searchStr = "";
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("all Courses-grid features together (Knowledge Streams)", () => {
  it("renders every feature once, in the Figma order", async () => {
    const host = await mount();

    // Hero above the section, with the live stats: 13 rows, 3 EN/HI pairs = 10 cards; 6 streams.
    const hero = host.querySelector("[data-catalog-hero]");
    expect(hero?.querySelector("h1")?.textContent).toBe("All courses");
    expect(hero?.textContent).toContain("10");
    expect(hero?.textContent).toContain("courses & resources");
    expect(hero?.textContent).toContain("knowledge streams");

    // One search box on the page: the hero's (the toolbar card is replaced by the results header).
    expect(host.querySelectorAll('input[type="search"], input[type="text"]').length).toBe(1);
    expect(host.querySelector("[data-catalog-results-header]")?.textContent).toContain("All streams");

    // The icon band: All + 6 streams, before the sidebar.
    const tabs = host.querySelectorAll('[role="tablist"] [role="tab"]');
    expect(tabs.length).toBe(7);
    expect(tabs[0].textContent).toContain("All courses");

    // Editorial sidebar: groups in the authored order, FORMAT from globalSettings.courseFormats, promo under it.
    const groups = [...host.querySelectorAll("[data-filter-group]")].map((g) => g.getAttribute("data-filter-group"));
    expect(groups.slice(0, 5)).toEqual(["price", "language", "format", "category", "for"]);
    const format = host.querySelector('[data-filter-group="format"]')!;
    expect(format.textContent).toContain("Interactive, self-paced E-learning");
    // A format no course has (Audio Book) is not offered.
    expect(format.textContent).not.toContain("Audio Book");
    expect(host.querySelector("[data-promo-phone]")).toBeTruthy();
    expect(before(tabs[0], host.querySelector('[data-filter-group="price"]'))).toBe(true);

    // Results column order: free strip, spotlight, grid heading, cards, Load more, coming soon.
    const free = host.querySelector('[data-column-section="ks-free"]');
    const spot = host.querySelector('[data-column-section="ks-flagship"]');
    const heading = host.querySelector("[data-grid-heading]");
    const firstCard = [...host.querySelectorAll("[data-editorial-card]")].find((c) => !c.closest("[data-column-section]")) ?? null;
    const more = host.querySelector("[data-load-more]");
    const soon = host.querySelector('[data-column-section="ks-soon"]');
    expect(before(free, spot)).toBe(true);
    expect(before(spot, heading)).toBe(true);
    expect(before(heading, firstCard)).toBe(true);
    expect(before(firstCard, more)).toBe(true);
    expect(before(more, soon)).toBe(true);

    // The free strip uses the editorial card too, with ONE arrow after its CTA (the card draws it).
    expect(free!.querySelectorAll("[data-editorial-card]").length).toBe(3);
    const ctas = [...free!.querySelectorAll("[data-card-cta]")].map((b) => b.textContent);
    expect(ctas).toEqual(["Start free→", "Start free→", "Start free→"]);
    // Coming soon lists the authored categories (not hidden by the sidebar's hideComingSoon).
    expect(soon!.textContent).toContain("Chhanda shastra");
    expect(soon!.textContent).toContain("Sanskrit Language teaching");
  });

  it("one card per version group: the grid, the FORMAT counts and the stream counts agree", async () => {
    const host = await mount({ render: { ...KS.render, pagination: { mode: "loadMore", pageSize: 30 } } });
    const grid = [...host.querySelectorAll("[data-editorial-card]")].filter(
      (card) => !card.closest('[data-column-section="ks-free"]'),
    );
    expect(grid.length).toBe(10);
    const names = grid.map((c) => c.querySelector("h3")?.textContent ?? "");
    expect(names.filter((n) => /Parenting|पेरेंटिंग/.test(n)).length).toBe(1);

    // FORMAT "E-books": vp pair (1 card) + gv-en + gita (eBook level) + gs pair (1 card) = 4.
    const ebooks = [...host.querySelectorAll('[data-filter-group="format"] label, [data-filter-group="format"] button')].find(
      (n) => n.textContent?.includes("E-books"),
    );
    expect(ebooks?.textContent).toContain("4");

    // Shiksha tab count: the gurukul pair is one card.
    const shiksha = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes("Education"));
    expect(shiksha?.textContent).toContain("1");
  });

  it("the card pill comes from the shared format helper (tag first, then level)", async () => {
    const host = await mount({ render: { ...KS.render, pagination: { mode: "loadMore", pageSize: 30 } } });
    const card = (name: string) =>
      [...host.querySelectorAll("[data-editorial-card]")].find(
        (c) => c.querySelector("h3")?.textContent?.includes(name) && !c.closest('[data-column-section="ks-free"]'),
      );
    expect(card("Rishi Intelligence")?.textContent).toContain("E-Learning");
    expect(card("गीतायन")?.textContent).toContain("E-book");
    expect(card("Martand")?.textContent).toContain("Animation");
  });

  it("a version group earns the badges of every version (Bestsellers keeps the merged card)", async () => {
    // Only the HI version of Vedic Parenting is ranked; the card is keyed by the EN id.
    const host = await mount(
      {
        quickFilters: [...KS.quickFilters, { id: "qf-bestseller", label: "Bestsellers", kind: "bestseller" }],
        render: { ...KS.render, pagination: { mode: "loadMore", pageSize: 30 } },
      },
      new Map([["vp-hi", 1]]),
    );
    const group = host.querySelector('[role="group"][aria-label="Quick filters:"]')!;
    const chip = [...group.querySelectorAll("button")].find((b) => b.textContent?.includes("Bestsellers"))!;
    await act(async () => chip.click());
    await act(tick);
    const grid = [...host.querySelectorAll("[data-editorial-card]")].filter((c) => !c.closest("[data-column-section]"));
    expect(grid.map((c) => c.querySelector("h3")?.textContent ?? "")).toHaveLength(1);
    expect(grid[0].querySelector("h3")?.textContent).toMatch(/Parenting|पेरेंटिंग/);
  });

  it("Load more pages the grid without touching the column sections", async () => {
    const host = await mount();
    const gridCards = () =>
      [...host.querySelectorAll("[data-editorial-card]")].filter((c) => !c.closest("[data-column-section]")).length;
    expect(gridCards()).toBe(4);
    const button = host.querySelector<HTMLButtonElement>("[data-load-more] button");
    await act(async () => button!.click());
    await act(tick);
    expect(gridCards()).toBe(8);
    expect(host.querySelector('[data-column-section="ks-free"]')).toBeTruthy();
  });
});
