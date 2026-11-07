// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * courseShowcase: the default strip is unchanged (golden written from the
 * component BEFORE feature 'cards'), and cardStyle "editorial" draws the
 * catalogue's editorial card (Free pill, format pill, stream line, folded
 * language versions, text CTA by format).
 */

const h = vi.hoisted(() => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `c${n}`,
    package_name: `Course ${n}`,
    package_session_id: `c${n}-ps`,
    enroll_invite_id: `inv-${n}`,
    level_name: n % 2 ? "Short Film" : "eBook",
    min_plan_actual_price: n === 3 ? 450 : 0,
    min_plan_elevated_price: n === 3 ? 600 : undefined,
    currency: "INR",
    course_html_description_html: `<p>About course ${n}</p>`,
    comma_separeted_tags: "free,swasthya,English",
    enroll_invite_availability: "AVAILABLE",
    ...extra,
  });
  return { row, rows: [] as Record<string, unknown>[], navigate: [] as unknown[] };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => (opts: unknown) => {
    h.navigate.push(opts);
    return Promise.resolve();
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
vi.mock("../../-services/route-matcher", () => ({ RouteMatcher: { basePath: () => "" } }));
vi.mock("axios", () => {
  const api: Record<string, unknown> = {
    post: async () => ({ data: { content: h.rows } }),
    get: async () => ({ data: {} }),
  };
  api.create = () => api;
  return { default: api };
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseShowcaseComponent } from "./CourseShowcaseComponent";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const LIBRARY = "lib-bv";
const TREE = {
  library: { id: LIBRARY, name: "Streams" },
  roots: [
    {
      id: "s1",
      node_type: "FOLDER",
      title: "स्वास्थ्य",
      subtitle: "Health | Ayurveda",
      slug: "swasthya",
      image_url: "https://cdn.example.com/swasthya.png",
      children: [],
    },
  ],
};

let root: Root | null = null;
let host: HTMLDivElement;
const mount = async (props: Record<string, unknown>, withQueryClient = true) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const showcase = e(CourseShowcaseComponent, {
    instituteId: "inst-1",
    tagName: "site",
    ...props,
  } as React.ComponentProps<typeof CourseShowcaseComponent>);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["FOLDER_LIBRARY_PUBLIC", "inst-1", LIBRARY], TREE);
  await act(async () => {
    root!.render(withQueryClient ? e(QueryClientProvider, { client: qc }, showcase) : showcase);
  });
  await act(tick);
  await act(tick);
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const cards = () => [...host.querySelectorAll<HTMLElement>("[data-editorial-card]")];

describe("courseShowcase", () => {
  it("without cardStyle: the original strip, byte for byte (no query client needed)", async () => {
    h.rows = [h.row(1), h.row(2), h.row(3), h.row(4)];
    await mount(
      {
        title: "New here? Start free",
        subtitle: "Try a course first",
        source: "tag",
        tag: "free",
        limit: 3,
        badgeText: "Free",
        globalSettings: { courseLanguages: { enabled: true } },
      },
      false,
    );
    expect(cards()).toHaveLength(0);
    await expect(host.innerHTML).toMatchFileSnapshot("./__golden__/showcase-default.html");
  });

  it("cardStyle editorial: the editorial card, CTA by format, folded versions, limit after folding", async () => {
    h.rows = [
      h.row(1, { id: "en1", package_name: "Martand | Short Film" }),
      h.row(2, { id: "hi1", package_name: "मार्तण्ड", level_name: "Short Film", comma_separeted_tags: "free,swasthya,Hindi" }),
      h.row(4),
      h.row(3),
      h.row(6),
    ];
    await mount({
      title: "New here? Start free",
      source: "tag",
      tag: "free",
      limit: 3,
      cardStyle: "editorial",
      streamsLibraryId: LIBRARY,
      card: {
        formatLabels: { animation: "Animation", ebook: "E-book" },
        freeCtaByFormat: { animation: "watch", ebook: "read" },
      },
      globalSettings: {
        courseLanguages: { enabled: true, versionGroups: [["en1", "hi1"]] },
        courseFormats: {
          ebook: { label: "E-books", levels: ["eBook"] },
          animation: { label: "Short film / Animation", levels: ["Short Film"] },
        },
      },
    });
    expect(cards()).toHaveLength(3);
    const [film, book, paid] = cards();
    expect(film.querySelector("h3")?.textContent).toBe("Martand | Short Film");
    expect(film.textContent).toContain("English");
    expect(film.textContent).toContain("Hindi");
    expect(film.textContent).toContain("Animation");
    expect(film.textContent).toContain("Health | Ayurveda");
    expect(film.querySelector("[data-card-cta]")?.textContent).toBe("Watch free→");
    expect([...film.querySelectorAll("span")].filter((s) => s.textContent === "Free")).toHaveLength(2);
    expect(book.querySelector("[data-card-cta]")?.textContent).toBe("Read free→");
    expect(paid.textContent).toContain("₹450");
    expect(paid.textContent).not.toContain("₹600");
    expect(paid.querySelector("[data-card-cta]")?.textContent).toBe("View course→");
    expect(host.querySelector(".catalogue-btn")).toBeNull();

    await act(async () => paid.querySelector<HTMLElement>("[data-card-cta]")!.click());
    expect(h.navigate).toEqual([
      expect.objectContaining({ to: "/c3", search: expect.objectContaining({ enrollInviteId: "inv-3" }) }),
    ]);
  });

  it("cardStyle editorial, picked: one id of a version pair still shows both languages; order + limit follow the selection", async () => {
    h.rows = [
      h.row(1, { id: "en1", package_name: "Martand | Short Film" }),
      h.row(2, { id: "hi1", package_name: "मार्तण्ड", level_name: "Short Film", comma_separeted_tags: "free,swasthya,Hindi" }),
      h.row(4, { id: "c4" }),
      h.row(6, { id: "c6" }),
      h.row(8, { id: "c8" }),
    ];
    await mount({
      title: "New here? Start free",
      source: "picked",
      courseIds: ["c6", "en1", "c4"],
      limit: 2,
      cardStyle: "editorial",
      streamsLibraryId: LIBRARY,
      globalSettings: { courseLanguages: { enabled: true, versionGroups: [["en1", "hi1"]] } },
    });
    expect(cards().map((c) => c.querySelector("h3")?.textContent)).toEqual(["Course 6", "Martand | Short Film"]);
    const film = cards()[1];
    expect(film.textContent).toContain("English");
    expect(film.textContent).toContain("Hindi");
  });

  it("cardStyle editorial: a picked free EN version prices Free though its unpicked HI version is paid", async () => {
    h.rows = [
      h.row(1, { id: "en1", package_name: "Martand | Short Film", min_plan_actual_price: 0 }),
      h.row(2, { id: "hi1", package_name: "मार्तण्ड", level_name: "Short Film", min_plan_actual_price: 99, comma_separeted_tags: "free,swasthya,Hindi" }),
    ];
    await mount({
      source: "picked",
      courseIds: ["en1"],
      limit: 3,
      cardStyle: "editorial",
      globalSettings: { courseLanguages: { enabled: true, versionGroups: [["en1", "hi1"]] } },
    });
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain("Hindi");
    expect(cards()[0].textContent).not.toContain("₹99");
    expect([...cards()[0].querySelectorAll("span")].filter((s) => s.textContent === "Free")).toHaveLength(2);
  });
});
