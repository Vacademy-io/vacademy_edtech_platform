// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * GOLDEN MARKUP of the Courses grid for sites that use none of the opt-in
 * Figma-fidelity props (hero, editorial cards, sidebar variant, column
 * sections, palette, content width…). The files under __golden__/ were
 * written from origin/main's CourseCatalogComponent BEFORE the render slots
 * were added, so a slot, a refactor or a feature that changes what an
 * existing site renders fails here. Never regenerate them to make a change
 * pass: a diff means some other institute's site changed.
 */

const h = vi.hoisted(() => {
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
  return {
    rows: [] as Record<string, unknown>[],
    plain: Array.from({ length: 14 }, (_, i) =>
      row(i + 1, i === 4 ? { coming_soon: { enabled: true, buttonText: "Notify me" } } : {}),
    ),
    versions: [
      row(1, { id: "p1", package_id: "p1", level_name: "English", package_session_id: "p1-en" }),
      row(2, { id: "p1", package_id: "p1", level_name: "Hindi", package_session_id: "p1-hi", min_plan_actual_price: 150 }),
      row(3, { id: "p2", package_id: "p2", level_name: "Hindi", package_session_id: "p2-hi", comma_separeted_tags: "vedic-maths" }),
      row(4, { id: "p3", package_id: "p3", level_name: "English", package_session_id: "p3-en", min_plan_actual_price: 0 }),
    ],
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
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseCatalogComponent } from "../CourseCatalogComponent";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
/** React's useId values («r2»…) count every id the test file has used so far; number them per markup instead. */
const stableIds = (html: string): string => {
  const ids = new Map<string, string>();
  return html.replace(/«r[0-9a-z]+»/g, (id) => {
    if (!ids.has(id)) ids.set(id, `«id${ids.size}»`);
    return ids.get(id)!;
  });
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

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

const section = (props: Record<string, unknown>, globalSettings: Record<string, unknown> = {}) =>
  e(CourseCatalogComponent, {
    title: "All courses",
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
  return stableIds(host.innerHTML);
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const DISCOVERY = {
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
const LANGUAGES = { courseLanguages: { enabled: true } };

describe("Courses grid golden markup (no opt-in props)", () => {
  it("loading skeleton", async () => {
    h.rows = h.plain;
    const html = stableIds(renderToStaticMarkup(e(QueryClientProvider, { client: client() }, section({}))));
    await expect(html).toMatchFileSnapshot("./__golden__/loading.html");
  });

  it("plain grid with every legacy filter, cart controls and two pages", async () => {
    h.rows = h.plain;
    const html = await mount({
      cartButtonConfig: { enabled: true },
      render: { layout: "grid", cardFields: [], subtitle: "Pick one", styles: { roundedEdges: false } },
      filtersConfig: [
        { id: "level", type: "checkbox", field: "level" },
        { id: "session", type: "checkbox", field: "session" },
        { id: "tags", type: "checkbox", field: "tags" },
        { id: "authors", type: "checkbox", field: "instructor" },
        { id: "price", type: "range", field: "price" },
      ],
    });
    await expect(html).toMatchFileSnapshot("./__golden__/plain.html");
  });

  it("filters off, contain images, no results", async () => {
    h.rows = [];
    const html = await mount({ showFilters: false, render: { layout: "grid", cardFields: ["package_name"], styles: { imageFit: "contain" } } });
    await expect(html).toMatchFileSnapshot("./__golden__/empty.html");
  });

  it("discovery: folder streams, quick filters, counts, chips, language versions, badges", async () => {
    h.rows = h.versions;
    const html = await mount(DISCOVERY, LANGUAGES);
    await expect(html).toMatchFileSnapshot("./__golden__/discovery.html");
  });

  it("discovery with a theme that sets no palette or content width", async () => {
    h.rows = h.versions;
    const html = await mount(DISCOVERY, {
      ...LANGUAGES,
      theme: { preset: "default", primaryColor: "#883000" }, // design-lint-ignore: test fixture colour
      fonts: { enabled: true, family: "Inter, sans-serif" },
    });
    await expect(html).toMatchFileSnapshot("./__golden__/discovery.html");
  });
});
