// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Courses grid's sort, rendered: the order of the cards and the names in
 * the sort menu.
 *
 * The v2 search now sends created_at, but an older section (no discovery
 * props) must keep the order it always showed under "Newest" and "Oldest" —
 * the search's own — while a section that opted into discovery sorts by date.
 */

const h = vi.hoisted(() => ({
  // The search's own order: B, C, A. By date: A (newest), B, C (oldest).
  rows: [
    { id: "b", package_name: "Course B", package_session_id: "b-1", level_name: "Beginner", min_plan_actual_price: 100, created_at: "2026-05-01T00:00:00.000Z" },
    { id: "c", package_name: "Course C", package_session_id: "c-1", level_name: "Beginner", min_plan_actual_price: 200, created_at: "2025-01-01T00:00:00.000Z" },
    { id: "a", package_name: "Course A", package_session_id: "a-1", level_name: "Beginner", min_plan_actual_price: 300, created_at: "2026-09-01T00:00:00.000Z" },
  ],
  // A Hindi chrome catalogue for the sort names only; every other key falls
  // back to its English default (or the key).
  hindi: {
    "courseCatalog.sort.newest": "सबसे नया",
    "courseCatalog.sort.oldest": "सबसे पुराना",
    "courseCatalog.sort.price-asc": "कीमत: कम से ज़्यादा",
    "courseCatalog.sort.price-desc": "कीमत: ज़्यादा से कम",
    "courseCatalog.sort.rating": "रेटिंग",
    "courseCatalog.sort.name-asc": "नाम: A-Z",
    "courseCatalog.sort.name-desc": "नाम: Z-A",
    "courseCatalog.sort.popular": "लोकप्रिय",
  } as Record<string, string>,
}));

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
      h.hindi[key] ??
      (typeof opts === "string"
        ? opts
        : typeof (opts as { defaultValue?: unknown } | undefined)?.defaultValue === "string"
          ? (opts as { defaultValue: string }).defaultValue
          : key),
    i18n: { language: "hi" },
  }),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: (_term: string, fallback: string) => fallback,
  getTerminologyPlural: (_term: string, fallback: string) => `${fallback}s`,
}));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: async () => "" }));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => false }));
vi.mock("../../-services/route-matcher", () => ({ RouteMatcher: { basePath: () => "" } }));
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
import { CourseCatalogComponent } from "./CourseCatalogComponent";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const mount = async (props: Record<string, unknown>) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const section = e(CourseCatalogComponent, {
    title: "Courses",
    showFilters: false,
    render: { layout: "grid", cardFields: [] },
    ...props,
    instituteId: "inst-1",
    tagName: "site",
    globalSettings: {},
  } as unknown as React.ComponentProps<typeof CourseCatalogComponent>);
  await act(async () => {
    root!.render(e(QueryClientProvider, { client }, section));
  });
  await act(tick);
  await act(tick);
  return host;
};

const cardTitles = (host: HTMLElement) =>
  [...host.querySelectorAll("h3.font-bold")].map((title) => title.textContent);

const sortMenu = (host: HTMLElement) => host.querySelector("select") as HTMLSelectElement;

const pickSort = async (host: HTMLElement, value: string) => {
  const select = sortMenu(host);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
  });
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("an older Courses section (no discovery props)", () => {
  it("keeps the search's own order under Newest and Oldest, as before created_at existed", async () => {
    const host = await mount({});
    expect(sortMenu(host).value).toBe("Newest");
    expect(cardTitles(host)).toEqual(["Course B", "Course C", "Course A"]);
    await pickSort(host, "Oldest");
    expect(sortMenu(host).value).toBe("Oldest");
    expect(cardTitles(host)).toEqual(["Course B", "Course C", "Course A"]);
  });

  it("still sorts by price and name", async () => {
    const host = await mount({});
    await pickSort(host, "Price: High to Low");
    expect(cardTitles(host)).toEqual(["Course A", "Course C", "Course B"]);
    await pickSort(host, "Name A-Z");
    expect(cardTitles(host)).toEqual(["Course A", "Course B", "Course C"]);
  });
});

describe("a section that opted into discovery", () => {
  it("sorts Newest and Oldest by created_at", async () => {
    const host = await mount({ showAppliedChips: true });
    expect(cardTitles(host)).toEqual(["Course A", "Course B", "Course C"]);
    await pickSort(host, "Oldest");
    expect(cardTitles(host)).toEqual(["Course C", "Course B", "Course A"]);
  });
});

describe("the sort menu", () => {
  it("names each sort in the visitor's language and keeps the English values", async () => {
    const host = await mount({});
    const options = [...sortMenu(host).querySelectorAll("option")];
    // An older section's menu: every sort but Popular.
    expect(options.map((option) => option.value)).toEqual([
      "Newest",
      "Oldest",
      "Price: Low to High",
      "Price: High to Low",
      "Rating",
      "Name A-Z",
      "Name Z-A",
    ]);
    expect(options.map((option) => option.textContent)).toEqual([
      "सबसे नया",
      "सबसे पुराना",
      "कीमत: कम से ज़्यादा",
      "कीमत: ज़्यादा से कम",
      "रेटिंग",
      "नाम: A-Z",
      "नाम: Z-A",
    ]);
  });

  it("names Popular too where discovery lists it", async () => {
    const host = await mount({ showAppliedChips: true });
    const popular = sortMenu(host).querySelector('option[value="Popular"]');
    expect(popular?.textContent).toBe("लोकप्रिय");
  });
});
