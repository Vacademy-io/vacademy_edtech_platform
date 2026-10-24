// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The editorial filter sidebar (feature 'sidebar') rendered by the real
 * CourseCatalogComponent: Figma group order, price checkboxes, FORMAT from
 * globalSettings.courseFormats with greyed zero rows, bilingual categories
 * across every stream with a show-all limit, FOR without counts, the promo
 * card — and the proof that a section without the props renders as before.
 */

const h = vi.hoisted(() => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `c${n}`,
    package_name: `Course ${n}`,
    package_session_id: `c${n}-ps`,
    enroll_invite_id: `inv-${n}`,
    level_name: n % 2 ? "English" : "Hindi",
    session_id: "s-a",
    session_name: "Morning",
    min_plan_actual_price: n % 3 === 0 ? 0 : 100 * n,
    currency: "INR",
    course_html_description_html: `<p>About course ${n}</p>`,
    comma_separeted_tags: "",
    instructors: [],
    created_at: `2026-0${(n % 9) + 1}-01T00:00:00Z`,
    ...extra,
  });
  return {
    search: "",
    rows: [
      row(1, { comma_separeted_tags: "vedic-parenting,format-ebook,for-parents" }),
      row(2, { comma_separeted_tags: "vedic-parenting,format-elearning,for-parents" }),
      row(3, { comma_separeted_tags: "mandir,format-elearning,for-students" }),
      row(4, { comma_separeted_tags: "mandir,format-film" }),
      row(5, { comma_separeted_tags: "gurukul,format-ebook,for-teachers" }),
    ] as Record<string, unknown>[],
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({}),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: "/courses" } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: "/courses", searchStr: h.search, search: {}, hash: "", href: "/courses" };
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
  RouteMatcher: { basePath: () => "", pagePath: (_tag: string, route: string) => route },
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
        { id: "c1", node_type: "FOLDER", title: "वैदिक पेरेंटिंग", subtitle: "Holistic Parenting", slug: "vedic-parenting", children: [] },
        { id: "c2", node_type: "FOLDER", title: "गुरुकुल शिक्षा", subtitle: "Gurukul Education", slug: "gurukul", children: [] },
        { id: "c4", node_type: "FOLDER", title: "जल्द", subtitle: "Soon", slug: "soon", coming_soon: true, children: [] },
      ],
    },
    {
      id: "s2",
      node_type: "FOLDER",
      title: "कला",
      subtitle: "Art",
      slug: "kala",
      children: [{ id: "c3", node_type: "FOLDER", title: "मंदिरों का भारत", subtitle: "India of temples", slug: "mandir", children: [] }],
    },
  ],
};

const GLOBALS = {
  courseLanguages: { enabled: true },
  courseFormats: {
    elearning: { label: "Interactive, self-paced E-learning" },
    ebook: { label: "E-books" },
    film: { label: "Short film / Animation" },
    audiobook: { label: "Audio Book" },
  },
  courseFormatOrder: ["elearning", "ebook", "film", "audiobook"],
};

const BASE = {
  streams: { enabled: true, source: "folderLibrary", libraryId: LIBRARY, labelMode: "both", allLabel: "All courses" },
  syncUrl: false,
  showFilterCounts: true,
  showAppliedChips: true,
  languageFilter: { enabled: true, label: "Language" },
  priceFilter: { enabled: true, label: "Price", showFree: true, maxOptions: [] },
  categoryFilter: { enabled: true, label: "Category  ·  श्रेणी" },
  mobileFilterSheet: true,
};

const SIDEBAR = {
  // The legacy level / session / tags groups off (the FORMAT group replaces them).
  filtersConfig: [],
  priceFilter: { enabled: true, label: "Price", showFree: true, maxOptions: [], control: "checkbox" },
  categoryFilter: {
    enabled: true,
    label: "Category  ·  श्रेणी",
    scope: "all",
    labelMode: "both",
    sort: "count",
    hideComingSoon: true,
    visibleCount: 2,
    showAllLabel: "+ Show all {count} categories",
  },
  customFilters: [
    { id: "format", label: "Format", source: "courseFormats" },
    {
      id: "for",
      label: "For",
      showCounts: false,
      visibleCount: 2,
      showAllLabel: "+ Show more",
      options: [
        { id: "parents", label: "Parents", tags: ["for-parents"] },
        { id: "students", label: "Students", tags: ["for-students"] },
        { id: "teachers", label: "Teachers", tags: ["for-teachers"] },
      ],
    },
  ],
  filterSidebar: {
    variant: "editorial",
    order: ["price", "language", "format", "category", "for"],
    dividerColor: "#EFE6CC", // design-lint-ignore: test fixture colour
    checkboxColor: "#A08A5C", // design-lint-ignore: test fixture colour
    checkboxSoftColor: "#958664", // design-lint-ignore: test fixture colour (lighter, still 3:1 on white)
    promo: {
      enabled: true,
      screenImage: "https://cdn.example.com/screen.png",
      eyebrow: "Brahm Varchas App",
      title: "Your learning, in your pocket",
      text: "Pick up where you left off.",
      button: { text: "Get the app", target: "/login" },
      eyebrowColor: "#E8A860", // design-lint-ignore: test fixture colour
    },
  },
};

const section = (props: Record<string, unknown>) =>
  e(CourseCatalogComponent, {
    title: "All courses",
    showFilters: true,
    render: { layout: "grid", cardFields: ["package_name"] },
    instituteId: "inst-1",
    tagName: "site",
    globalSettings: GLOBALS,
    ...props,
  } as unknown as React.ComponentProps<typeof CourseCatalogComponent>);

const mount = async (props: Record<string, unknown>) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["FOLDER_LIBRARY_PUBLIC", "inst-1", LIBRARY], TREE);
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(e(QueryClientProvider, { client: qc }, section(props)));
  });
  await act(tick);
  await act(tick);
  return host;
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  h.search = "";
  document.body.innerHTML = "";
});

const panel = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-filter-sidebar="editorial"]')!;
const group = (host: HTMLElement, id: string) => panel(host).querySelector<HTMLElement>(`[data-filter-group="${id}"]`)!;
const rowOf = (g: HTMLElement, label: string) =>
  [...g.querySelectorAll("label")].find((l) => l.textContent?.includes(label))!;
const shownCourses = (host: HTMLElement) =>
  [...new Set((host.textContent || "").match(/Course \d/g) ?? [])].sort();
const click = async (el: Element) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await act(tick);
};

describe("editorial filter sidebar", () => {
  it("renders the Figma card: header, groups in the authored order, promo", async () => {
    const host = await mount({ ...BASE, ...SIDEBAR });
    const p = panel(host);
    expect(p).toBeTruthy();
    expect(p.querySelector("h2")?.textContent).toBe("Filters");
    expect(p.querySelector("button[aria-disabled]")?.textContent).toBe("Clear all");
    expect([...p.querySelectorAll("[data-filter-group]")].map((g) => g.getAttribute("data-filter-group"))).toEqual([
      "price",
      "language",
      "format",
      "category",
      "for",
    ]);
    // The heading keeps Devanagari out of the letter-spacing.
    const heading = group(host, "category").querySelector("h3 button")!;
    expect(heading.getAttribute("aria-expanded")).toBe("true");
    expect(heading.querySelector(".tracking-normal")?.textContent).toBe("श्रेणी");
    // Author colours reach the group as CSS variables.
    expect(group(host, "price").getAttribute("style")).toContain("--fs-divider: #EFE6CC"); // design-lint-ignore: test fixture colour
    // Sidebar column 280px, promo card under the filter card.
    const column = p.parentElement!.parentElement!;
    expect(column.getAttribute("style")).toContain("--fs-width: 280px");
    const promo = host.querySelector("aside")!;
    expect(promo.getAttribute("aria-label")).toBe("Your learning, in your pocket");
    expect(promo.querySelector("[data-promo-phone] img")?.getAttribute("src")).toBe("https://cdn.example.com/screen.png");
    expect(promo.querySelector("p")?.getAttribute("style")).toContain("color: rgb(232, 168, 96)");
    expect(promo.querySelector("a")?.getAttribute("href")).toBe("/login");
    expect(promo.querySelector("a")?.textContent).toBe("Get the app→");
  });

  it("price: Free / Paid checkboxes, no 'Any price', at most one on", async () => {
    const host = await mount({ ...BASE, ...SIDEBAR });
    const price = group(host, "price");
    expect(price.textContent).not.toContain("Any price");
    expect(price.querySelectorAll('input[type="checkbox"]').length).toBe(2);
    await click(rowOf(group(host, "price"), "Paid").querySelector("input")!);
    await click(rowOf(group(host, "price"), "Free").querySelector("input")!);
    const checked = [...group(host, "price").querySelectorAll<HTMLInputElement>("input")].map((i) => i.checked);
    expect(checked).toEqual([true, false]);
    expect(shownCourses(host)).toEqual(["Course 3"]);
    await click(rowOf(group(host, "price"), "Free").querySelector("input")!);
    expect(shownCourses(host).length).toBe(5);
  });

  it("format: options from courseFormats, counts, no-course option hidden, zero-under-filters greyed; filters the grid", async () => {
    const host = await mount({ ...BASE, ...SIDEBAR });
    const format = group(host, "format");
    // No course is an audio book: the option is not listed at all.
    expect([...format.querySelectorAll("label")].map((l) => l.textContent)).toEqual([
      "Interactive, self-paced E-learning2",
      "E-books2",
      "Short film / Animation1",
    ]);
    // Zero only under another filter: still listed, greyed and disabled.
    await click(rowOf(group(host, "price"), "Free").querySelector("input")!);
    const zero = [...group(host, "format").querySelectorAll("label")].find((l) => /\D0$/.test(l.textContent ?? ""));
    expect(zero).toBeTruthy();
    expect(zero!.querySelector("input")!.disabled).toBe(true);
    expect(zero!.querySelector(".text-palette-muted2")).toBeTruthy();
    await click(rowOf(group(host, "price"), "Free").querySelector("input")!);
    await click(rowOf(group(host, "format"), "E-books").querySelector("input")!);
    expect(shownCourses(host)).toEqual(["Course 1", "Course 5"]);
    // Applied chip + Clear all clear it again.
    await click(panel(host).querySelector("button[aria-disabled]")!);
    expect(shownCourses(host).length).toBe(5);
  });

  it("category: every stream's categories on All, bilingual, by count, coming-soon hidden, show-all", async () => {
    const host = await mount({ ...BASE, ...SIDEBAR });
    const category = group(host, "category");
    const labels = () => [...group(host, "category").querySelectorAll("label")].map((l) => l.textContent);
    expect(labels()).toEqual(["वैदिक पेरेंटिंगHolistic Parenting2", "मंदिरों का भारतIndia of temples2"]);
    expect(category.textContent).not.toContain("जल्द");
    const showAll = [...category.querySelectorAll("button")].find((b) => b.textContent?.includes("Show all"))!;
    expect(showAll.textContent).toBe("+ Show all 3 categories");
    await click(showAll);
    expect(labels().length).toBe(3);
    expect(group(host, "category").textContent).toContain("− Show less");
    await click(rowOf(group(host, "category"), "Gurukul").querySelector("input")!);
    expect(shownCourses(host)).toEqual(["Course 5"]);
  });

  it("for: no counts, lighter boxes, + Show more; sections fold", async () => {
    const host = await mount({ ...BASE, ...SIDEBAR });
    const forGroup = group(host, "for");
    expect([...forGroup.querySelectorAll("label")].map((l) => l.textContent)).toEqual(["Parents", "Students"]);
    expect(forGroup.getAttribute("style")).toContain("--fs-box: #958664"); // design-lint-ignore: test fixture colour
    expect([...forGroup.querySelectorAll("button")].map((b) => b.textContent)).toContain("+ Show more");
    await click(forGroup.querySelector("h3 button")!);
    const folded = group(host, "for");
    const toggle = folded.querySelector("h3 button")!;
    expect(toggle.textContent).toContain("+");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // The list stays mounted (hidden), so aria-controls still names it.
    const list = folded.querySelector<HTMLElement>(`[id="${toggle.getAttribute("aria-controls")}"]`)!;
    expect(list).toBeTruthy();
    expect(list.hidden).toBe(true);
    expect(list.className).toContain("hidden");
    expect(folded.textContent).not.toContain("+ Show more");
    await click(toggle);
    expect(group(host, "for").querySelector<HTMLElement>("[role=group]")!.hidden).toBe(false);
  });

  it("every aria-controls in the card points at an element that exists", async () => {
    const host = await mount({ ...BASE, ...SIDEBAR });
    for (const g of panel(host).querySelectorAll<HTMLElement>("[data-filter-group]")) await click(g.querySelector("h3 button")!);
    const controls = [...panel(host).querySelectorAll("[aria-controls]")];
    expect(controls.length).toBeGreaterThan(0);
    for (const c of controls) expect(host.querySelector(`[id="${c.getAttribute("aria-controls")}"]`)).toBeTruthy();
  });

  it("for: '+ Show more' only when options are hidden behind it", async () => {
    const forAll = { ...SIDEBAR.customFilters[1], visibleCount: 3 };
    const host = await mount({ ...BASE, ...SIDEBAR, customFilters: [SIDEBAR.customFilters[0], forAll] });
    const forGroup = group(host, "for");
    expect(forGroup.querySelectorAll("label").length).toBe(3);
    expect(forGroup.textContent).not.toContain("Show more");
  });

  it("reads ?format= / ?for= / ?category= when the section syncs its URL", async () => {
    h.search = "?format=ebook&category=mandir";
    const host = await mount({ ...BASE, ...SIDEBAR, syncUrl: true });
    expect(shownCourses(host)).toEqual([]);
    h.search = "";
  });
});

describe("sections without the sidebar props", () => {
  it("render exactly as before (variant 'default' or absent)", async () => {
    const plain = stableIds((await mount(BASE)).innerHTML);
    act(() => root?.unmount());
    document.body.innerHTML = "";
    const withDefault = stableIds((await mount({ ...BASE, filterSidebar: { variant: "default", width: 300 } })).innerHTML);
    expect(withDefault).toBe(plain);
    expect(plain).not.toContain("data-filter-sidebar");
    expect(plain).not.toContain("data-filter-group");
  });

  it("legacy filtersConfig groups follow the authored order in the editorial style", async () => {
    const host = await mount({ ...BASE, ...SIDEBAR, filtersConfig: [{ id: "level", type: "checkbox", field: "level" }] });
    const ids = [...panel(host).querySelectorAll("[data-filter-group]")].map((g) => g.getAttribute("data-filter-group"));
    expect(ids).toEqual(["price", "language", "format", "category", "for", "level"]);
  });

  it("editorial: a filtersConfig price range keeps its min / max inputs (and the 'priceRange' order slot)", async () => {
    const host = await mount({
      ...BASE,
      ...SIDEBAR,
      filtersConfig: [{ id: "price-range", type: "range", field: "price", label: "Budget" }],
      filterSidebar: { ...SIDEBAR.filterSidebar, order: ["priceRange", "price"] },
    });
    const ids = [...panel(host).querySelectorAll("[data-filter-group]")].map((g) => g.getAttribute("data-filter-group"));
    expect(ids[0]).toBe("priceRange");
    const range = group(host, "priceRange");
    expect(range.querySelector("h3")?.textContent).toContain("Budget");
    const inputs = range.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(inputs.length).toBe(2);
    // Same state as the default card: a max of 150 leaves the free courses and Course 1.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputs[1], "150");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(tick);
    expect(group(host, "priceRange").querySelectorAll<HTMLInputElement>('input[type="number"]')[1].value).toBe("150");
    expect(shownCourses(host)).toEqual(["Course 1", "Course 3"]);
  });

  it("editorial without the phone sheet: the card folds behind a phone toggle, promo off phones", async () => {
    const host = await mount({ ...BASE, ...SIDEBAR, mobileFilterSheet: false });
    const p = panel(host);
    const column = p.parentElement!.parentElement!;
    expect(column.className).not.toContain("hidden");
    const toggle = p.querySelector<HTMLButtonElement>("[data-filter-sidebar-toggle]")!;
    expect(toggle.className).toContain("lg:hidden");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const body = host.querySelector<HTMLElement>(`[id="${toggle.getAttribute("aria-controls")}"]`)!;
    expect(body.className.split(" ")).toEqual(expect.arrayContaining(["lg:block", "hidden"]));
    await click(toggle);
    expect(panel(host).querySelector("[data-filter-sidebar-toggle]")!.getAttribute("aria-expanded")).toBe("true");
    expect(body.className.split(" ")).toContain("block");
    expect(body.className.split(" ")).not.toContain("hidden");
    const showResults = [...body.querySelectorAll("button")].find((b) => b.textContent === "Show results")!;
    expect(showResults.className).toContain("lg:hidden");
    await click(showResults);
    expect(body.className.split(" ")).toContain("hidden");
    expect(host.querySelector("aside")!.parentElement!.className).toBe("hidden lg:block");
  });

  it("editorial with the phone sheet: no phone toggle in the card (column hidden below lg)", async () => {
    const host = await mount({ ...BASE, ...SIDEBAR });
    const p = panel(host);
    expect(p.querySelector("[data-filter-sidebar-toggle]")).toBeNull();
    expect(p.parentElement!.parentElement!.className).toContain("hidden lg:block");
    expect([...p.querySelectorAll("button")].some((b) => b.textContent === "Show results")).toBe(false);
  });

  it("customFilters alone add the groups in the original group style", async () => {
    const host = await mount({ ...BASE, customFilters: SIDEBAR.customFilters });
    expect(host.querySelector("[data-filter-sidebar]")).toBeNull();
    const titles = [...host.querySelectorAll("h3")].map((x) => x.textContent);
    expect(titles).toEqual(expect.arrayContaining(["Language", "Price", "Format", "For"]));
  });
});
