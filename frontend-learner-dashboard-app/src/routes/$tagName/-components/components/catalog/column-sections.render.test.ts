// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * courseCatalog.columnSections (feature 'sections') rendered by the real
 * Courses grid: the free strip, the spotlight carousel and the coming-soon
 * row in the results column, their visibility rules and actions — and a
 * section without the prop (or with an empty / malformed one) rendering
 * exactly as before.
 */

const h = vi.hoisted(() => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `c${n}`,
    package_name: `Course ${n}`,
    package_session_id: `c${n}-ps`,
    enroll_invite_id: `inv-${n}`,
    level_name: "Beginner",
    min_plan_actual_price: 0,
    currency: "INR",
    comma_separeted_tags: n % 2 ? "shiksha" : "swasthya",
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  });
  return {
    rows: [
      row(1),
      row(2, { comma_separeted_tags: "swasthya,format-animation" }),
      row(3),
      row(4),
      row(5, { min_plan_actual_price: 500 }),
      row(6, { min_plan_actual_price: 1001, package_name: "Rajaswala Paricharya" }),
      row(7, { coming_soon: { enabled: true } }),
    ] as Record<string, unknown>[],
    navigate: [] as unknown[],
    /** Open enroll-invites by id ("error" = the request fails). */
    invites: {} as Record<string, unknown>,
    inviteGets: [] as string[],
    searchStr: "",
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => (opts: unknown) => {
    h.navigate.push(opts);
    return Promise.resolve();
  },
  useParams: () => ({ tagName: "site" }),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: "/courses" } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: "/courses", searchStr: h.searchStr, search: {}, hash: "", href: "/courses" };
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
  RouteMatcher: { basePath: () => "", pagePath: (_tag: string, route: string) => `/${route.replace(/^\//, "")}` },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("axios", () => {
  const api: Record<string, unknown> = {
    post: async () => ({ data: { content: h.rows, totalElements: h.rows.length } }),
    get: async (url: string) => {
      const invite = /\/open\/learner\/enroll-invite\/[^/]+\/(.+)$/.exec(url)?.[1];
      if (invite) {
        h.inviteGets.push(invite);
        const data = h.invites[invite];
        if (data === "error") throw new Error("offline");
        return { data: data ?? {} };
      }
      return { data: {} };
    },
  };
  api.create = () => api;
  return { default: api };
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseCatalogComponent } from "../CourseCatalogComponent";
import { CatalogueLocaleProvider } from "../../../-utils/catalogue-locale";
import { popularityQueryKey } from "../../../-services/popularity-service";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
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
      children: [
        { id: "c1", node_type: "FOLDER", title: "छन्द शास्त्र", subtitle: "Chhanda shastra", slug: "chhanda", coming_soon: true, audience_id: "aud-notify", children: [] },
        { id: "c2", node_type: "FOLDER", title: "गणित", subtitle: "Indian Mathematics", slug: "ganit", coming_soon: true, audience_id: "aud-notify", children: [] },
        { id: "c3", node_type: "FOLDER", title: "गीता", subtitle: "Gita", slug: "gita", children: [] },
      ],
    },
    {
      id: "s2",
      node_type: "FOLDER",
      title: "स्वास्थ्य",
      subtitle: "Health | Ayurveda",
      slug: "swasthya",
      accent_color: "#6f7a4d", // design-lint-ignore: test fixture colour
      children: [
        { id: "c4", node_type: "FOLDER", title: "योग", subtitle: "Yoga", slug: "yoga", coming_soon: true, audience_id: "aud-yoga", children: [] },
      ],
    },
  ],
};

const DISCOVERY = {
  title: "All courses",
  showFilters: true,
  render: { layout: "grid", cardFields: [] },
  instituteId: "inst-1",
  tagName: "site",
  streams: { enabled: true, source: "folderLibrary", libraryId: LIBRARY, labelMode: "both", allLabel: "All courses" },
  syncUrl: false,
  showAppliedChips: true,
  quickFilters: [{ id: "free", label: "", kind: "free" }],
  priceFilter: { enabled: true, showFree: true, maxOptions: [] },
};

const FREE = {
  id: "ks-free",
  kind: "free-courses",
  title: "New here? Start free",
  subtitle: "Try a free E-learning course, film or article before you enrol.",
  seeAllLabel: "See all {count} free",
  courseIds: ["c3", "c1"],
  ctaRules: [{ formats: ["animation"], label: "Watch free" }],
};
const SLIDE = {
  id: "rajaswala",
  eyebrow: "Flagship program",
  streamSlug: "swasthya",
  title: "Rajaswala Paricharya",
  titleNative: "रजस्वला परिचर्या",
  description: "Menstrual care and wellbeing, the Ayurvedic way.",
  cta: { label: "Enrol for {price}", price: "₹251", action: "course", courseId: "c6", enrollInviteId: "inv-6" },
  steps: [
    { title: "Rajaswala survey", meta: "Free", tone: "accent" },
    { title: "E-Learning course", meta: "{price}" },
    { title: "Live session", meta: "Included" },
  ],
};
const SPOTLIGHT = { id: "ks-flagship", kind: "spotlight", slides: [SLIDE] };
const SOON = {
  id: "ks-soon",
  kind: "coming-soon",
  title: "Coming soon",
  subtitle: "Be the first to know when these open.",
};

const client = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  qc.setQueryData(["FOLDER_LIBRARY_PUBLIC", "inst-1", LIBRARY], TREE);
  // Popularity: c4 > c1 (c3 is picked by id first).
  qc.setQueryData(popularityQueryKey("inst-1"), new Map([["c4", 1], ["c1", 2]]));
  return qc;
};

const mount = async (props: Record<string, unknown>, i18n?: Record<string, unknown>) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const section = e(CourseCatalogComponent, {
    ...DISCOVERY,
    globalSettings: { i18n },
    ...props,
  } as unknown as React.ComponentProps<typeof CourseCatalogComponent>);
  await act(async () => {
    root!.render(
      e(
        QueryClientProvider,
        { client: client() },
        i18n ? e(CatalogueLocaleProvider, { settings: i18n as never, scope: "site", persist: false, children: section }) : section,
      ),
    );
  });
  await act(tick);
  await act(tick);
  return host;
};
const block = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-column-section="${id}"]`);
const titles = (el: Element | null) => [...(el?.querySelectorAll("h3.font-bold") ?? [])].map((n) => n.textContent);
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await act(tick);
};
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  h.navigate = [];
  h.inviteGets = [];
  h.searchStr = "";
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("columnSections: opt-in only", () => {
  it("absent, empty and malformed columnSections all render the same markup as no prop", async () => {
    const plain = (await mount({})).innerHTML;
    act(() => root?.unmount());
    document.body.innerHTML = "";
    const empty = (await mount({ columnSections: [] })).innerHTML;
    act(() => root?.unmount());
    document.body.innerHTML = "";
    const junk = (await mount({ columnSections: [{ kind: "carousel" }, { id: "x" }, null] })).innerHTML;
    // useId values differ per mount: compare with ids normalised.
    const norm = (s: string) => s.replace(/«r[0-9a-z]+»/g, "«id»");
    expect(norm(empty)).toBe(norm(plain));
    expect(norm(junk)).toBe(norm(plain));
    expect(plain).not.toContain("data-column-section");
  });
});

describe("free courses strip", () => {
  it("picked ids first, then popularity; the link counts every free card; grid unchanged below", async () => {
    const host = await mount({ columnSections: [FREE] });
    const strip = block(host, "ks-free")!;
    expect(strip.querySelector("h2")!.textContent).toBe("New here? Start free");
    expect(strip.textContent).toContain("Try a free E-learning course");
    // c3, c1 picked; then the most popular other free card (c4). Paid c5/c6 and coming-soon c7 never.
    expect(titles(strip)).toEqual(["Course 3", "Course 1", "Course 4"]);
    expect(button(host, "See all 4 free")).toBeTruthy();
    // It sits before the grid, in the results column, and the grid still lists every course.
    const grid = strip.parentElement!.nextElementSibling as HTMLElement;
    expect(grid.className).toBe("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6");
    expect(titles(grid)).toHaveLength(7);
  });

  it("'See all' switches the Free quick filter on and the strip steps aside", async () => {
    const host = await mount({ columnSections: [FREE] });
    await click(button(host, "See all 4 free"));
    expect(block(host, "ks-free")).toBeNull();
    const freeChip = [...host.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent?.includes("Free"));
    expect(freeChip?.getAttribute("aria-pressed")).toBe("true");
    expect(Element.prototype.scrollIntoView).toBeDefined();
  });

  it("no link when every free card is already shown, or when the section has no Free control", async () => {
    let host = await mount({ columnSections: [{ ...FREE, limit: 6 }] });
    expect(host.textContent).not.toContain("See all");
    act(() => root?.unmount());
    host = await mount({ columnSections: [FREE], quickFilters: [], priceFilter: { enabled: false }, showAppliedChips: false });
    expect(block(host, "ks-free")).not.toBeNull();
    expect(host.textContent).not.toContain("See all");
  });

  it("hides on a stream tab", async () => {
    const host = await mount({ columnSections: [FREE] });
    const tab = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes("Education"));
    await click(tab);
    expect(block(host, "ks-free")).toBeNull();
  });
});

describe("spotlight", () => {
  it("one slide: eyebrow with the stream subtitle, both titles, live price, steps; no carousel controls", async () => {
    const host = await mount({ columnSections: [SPOTLIGHT] });
    const panel = block(host, "ks-flagship")!;
    expect(panel.querySelector("p")!.textContent).toBe("Flagship program  ·  Health | Ayurveda");
    expect(panel.querySelector("h2")!.textContent).toBe("Rajaswala Paricharyaरजस्वला परिचर्या");
    // c6 is in the catalogue at ₹1,001: the live price beats the authored ₹251, in the button and the step.
    const cta = button(host, "Enrol for ₹1,001")!;
    expect(cta).toBeTruthy();
    expect([...panel.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "1Rajaswala surveyFree",
      "2E-Learning course₹1,001",
      "3Live sessionIncluded",
    ]);
    // Step 1 takes the stream's accent colour.
    expect((panel.querySelector("li span") as HTMLElement).style.backgroundColor).toBe("rgb(111, 122, 77)");
    expect(panel.getAttribute("aria-roledescription")).toBeNull();
    expect(panel.querySelector('[aria-label="Next slide"]')).toBeNull();
    expect(panel.textContent).not.toContain("1 / 1");

    await click(cta);
    expect(h.navigate).toEqual([
      expect.objectContaining({ to: "/c6", search: expect.objectContaining({ enrollInviteId: "inv-6" }) }),
    ]);
  });

  it("a course outside the catalogue: the live price of its invite, never the authored mock; opens through its product page", async () => {
    // bv/rajaswala_invite.json: invite b6d3bd0d sells session 18bba28f at ₹1,001.
    h.invites["inv-rajaswala"] = {
      currency: "INR",
      package_session_to_payment_options: [
        {
          package_session_id: "ps-rajaswala",
          status: "ACTIVE",
          payment_option: { type: "ONE_TIME", payment_plans: [{ actual_price: 1001.0, currency: "INR" }] },
        },
      ],
    };
    const cta = {
      ...SLIDE.cta,
      courseId: "pkg-rajaswala",
      enrollInviteId: "inv-rajaswala",
      packageSessionId: "ps-rajaswala",
      productPageCode: "forbvy",
    };
    const host = await mount({ columnSections: [{ ...SPOTLIGHT, slides: [{ ...SLIDE, cta }] }] });
    const panel = block(host, "ks-flagship")!;
    expect(h.inviteGets).toEqual(["inv-rajaswala"]);
    expect(button(host, "Enrol for ₹251")).toBeUndefined();
    const enrol = button(host, "Enrol for ₹1,001");
    expect(enrol).toBeTruthy();
    expect([...panel.querySelectorAll("li")][1].textContent).toBe("2E-Learning course₹1,001");
    await click(enrol);
    expect(h.navigate).toEqual([
      {
        to: "/pkg-rajaswala",
        search: { enrollInviteId: "inv-rajaswala", packageSessionId: "ps-rajaswala", productPageCode: "forbvy" },
      },
    ]);
  });

  it("the authored price only when the invite cannot be read; hidden on a filtered view", async () => {
    h.invites["inv-down"] = "error";
    const host = await mount({
      columnSections: [{ ...SPOTLIGHT, slides: [{ ...SLIDE, cta: { ...SLIDE.cta, courseId: "elsewhere", enrollInviteId: "inv-down" } }] }],
    });
    expect(button(host, "Enrol for ₹251")).toBeTruthy();
    // No product page: the course opens like a card.
    await click(button(host, "Enrol for ₹251"));
    expect(h.navigate).toEqual([
      expect.objectContaining({ to: "/elsewhere", search: expect.objectContaining({ enrollInviteId: "inv-down" }) }),
    ]);
    await click(button(host, "Free"));
    expect(block(host, "ks-flagship")).toBeNull();
  });

  it("a free spotlight course: the CTA drops its price, {price} steps say Free; a course in the catalogue fetches no invite", async () => {
    const host = await mount({
      columnSections: [{ ...SPOTLIGHT, slides: [{ ...SLIDE, cta: { ...SLIDE.cta, courseId: "c1", enrollInviteId: "inv-1" } }] }],
    });
    const panel = block(host, "ks-flagship")!;
    expect(button(host, "Enrol")).toBeTruthy();
    expect(panel.textContent).not.toContain("₹251");
    expect([...panel.querySelectorAll("li")][1].textContent).toBe("2E-Learning courseFree");
    expect(h.inviteGets).toEqual([]);
  });

  it("one slide: no clipping wrapper (focus rings stay whole); several: the track clips with room for the ring", async () => {
    const one = await mount({ columnSections: [SPOTLIGHT] });
    expect(block(one, "ks-flagship")!.querySelector(".overflow-hidden")).toBeNull();
    act(() => root?.unmount());
    document.body.innerHTML = "";
    const two = await mount({
      columnSections: [{ ...SPOTLIGHT, slides: [SLIDE, { id: "two", title: "Garbha Vigyan" }] }],
    });
    const clip = block(two, "ks-flagship")!.querySelector(".overflow-hidden")!;
    expect(clip.className).toBe("-m-1 overflow-hidden p-1");
    const track = clip.firstElementChild as HTMLElement;
    expect(track.style.transform).toBe("translateX(calc(0 * (100% + 8px)))");
    await click(block(two, "ks-flagship")!.querySelector('[aria-label="Next slide"]'));
    expect(track.style.transform).toBe("translateX(calc(-1 * (100% + 8px)))");
  });

  it("two slides: dots, counter and wrapping arrows", async () => {
    const two = {
      ...SPOTLIGHT,
      slides: [SLIDE, { id: "two", title: "Garbha Vigyan", cta: { label: "View path", action: "product-page", productPageCode: "forbvy" } }],
    };
    const host = await mount({ columnSections: [two] });
    const panel = block(host, "ks-flagship")!;
    expect(panel.getAttribute("aria-roledescription")).toBe("carousel");
    const counter = () => [...panel.querySelectorAll("p")].find((p) => /^\d \/ \d$/.test(p.textContent || ""))!.textContent;
    const slides = () => [...panel.querySelectorAll('[aria-roledescription="slide"]')].map((s) => s.getAttribute("aria-hidden"));
    expect(counter()).toBe("1 / 2");
    expect(slides()).toEqual([null, "true"]);
    await click(panel.querySelector('[aria-label="Previous slide"]'));
    expect(counter()).toBe("2 / 2");
    expect(slides()).toEqual(["true", null]);
    await click(panel.querySelector('[aria-label="Next slide"]'));
    expect(counter()).toBe("1 / 2");
    await click(panel.querySelector('[aria-label="Go to slide 2"]'));
    expect(counter()).toBe("2 / 2");
    const link = [...panel.querySelectorAll("a")].find((a) => a.textContent === "View path")!;
    expect(link.getAttribute("href")).toBe("/product-pages/forbvy");
    await click(link);
    expect(h.navigate).toEqual([{ to: "/product-pages/$productPageCode", params: { productPageCode: "forbvy" } }]);
  });

  it("arrow keys move slides only from the carousel controls (never from a slide's own link)", async () => {
    const two = {
      ...SPOTLIGHT,
      slides: [SLIDE, { id: "two", title: "Garbha Vigyan", cta: { label: "View path", action: "product-page", productPageCode: "forbvy" } }],
    };
    const host = await mount({ columnSections: [two] });
    const panel = block(host, "ks-flagship")!;
    const counter = () => [...panel.querySelectorAll("p")].find((p) => /^\d \/ \d$/.test(p.textContent || ""))!.textContent;
    const press = async (el: Element) => {
      await act(async () => {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      });
      await act(tick);
    };
    const cta = [...panel.querySelectorAll('[aria-roledescription="slide"]')][0].querySelector("button, a")!;
    await press(cta);
    expect(counter()).toBe("1 / 2");
    await press(panel.querySelector('[aria-label="Next slide"]')!);
    expect(counter()).toBe("2 / 2");
    // No autoplay authored: no pause control.
    expect(panel.querySelector("[data-carousel-autoplay]")).toBeNull();
  });

  it("autoplay: a pause / play control", async () => {
    const two = {
      ...SPOTLIGHT,
      autoplayMs: 5000,
      slides: [SLIDE, { id: "two", title: "Garbha Vigyan" }],
    };
    const host = await mount({ columnSections: [two] });
    const panel = block(host, "ks-flagship")!;
    const toggle = panel.querySelector("[data-carousel-autoplay]");
    expect(toggle?.getAttribute("aria-label")).toBe("Pause slides");
    await click(toggle);
    expect(toggle?.getAttribute("aria-label")).toBe("Play slides");
  });

  it("'unfiltered-or-own-stream': on a stream tab only that stream's slides", async () => {
    const host = await mount({
      columnSections: [
        {
          ...SPOTLIGHT,
          showWhen: "unfiltered-or-own-stream",
          slides: [SLIDE, { id: "edu", title: "Shiksha path", streamSlug: "shiksha" }],
        },
      ],
    });
    const tab = (label: string) => [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes(label));
    await click(tab("Health"));
    const panel = block(host, "ks-flagship")!;
    expect(panel.querySelector("h2")!.textContent).toContain("Rajaswala");
    expect(panel.textContent).not.toContain("Shiksha path");
    expect(panel.querySelector('[aria-label="Next slide"]')).toBeNull();
  });
});

describe("coming soon row", () => {
  it("after the grid: categories flagged coming soon; Notify opens the category's form", async () => {
    const host = await mount({ columnSections: [SOON] });
    const row = block(host, "ks-soon")!;
    expect(row.querySelector("h2")!.textContent).toBe("Coming soon");
    const cards = [...row.querySelectorAll("li")];
    expect(cards.map((c) => c.querySelector("p")!.textContent)).toEqual([
      "शिक्षा  ·  Education",
      "शिक्षा  ·  Education",
      "स्वास्थ्य  ·  Health | Ayurveda",
    ]);
    expect(cards[0].querySelectorAll("p")[1].textContent).toBe("छन्द शास्त्रChhanda shastra");
    // The row is the results column's last block.
    expect(row.parentElement!.parentElement!.lastElementChild).toBe(row.parentElement);

    const events: CustomEvent[] = [];
    const listener = (ev: Event) => events.push(ev as CustomEvent);
    window.addEventListener("openAudienceForm", listener);
    await click(cards[0].querySelector("button"));
    window.removeEventListener("openAudienceForm", listener);
    expect(events.map((ev) => ev.detail)).toEqual([
      { audienceId: "aud-notify", title: "Get notified when Chhanda shastra launches" },
    ]);
    expect(cards[0].querySelector("button")!.textContent).toBe("Notify me");
    // The bell: palette gold unless the site names a colour.
    expect(cards[0].querySelector("button svg")!.getAttribute("class")).toContain("text-palette-gold");
    expect((cards[0].querySelector("button svg") as SVGElement).style.color).toBe("");
  });

  it("an authored bell colour", async () => {
    const host = await mount({ columnSections: [{ ...SOON, colors: { iconColor: "#C99621" } }] }); // design-lint-ignore: Figma bell colour
    const bell = block(host, "ks-soon")!.querySelector("li button svg") as SVGElement;
    expect(bell.style.color).toBe("rgb(201, 150, 33)");
  });

  it("scope 'active-stream' follows the tab; categorySlugs order and filter", async () => {
    const host = await mount({ columnSections: [{ ...SOON, categorySlugs: ["ganit", "yoga", "chhanda", "gita"] }] });
    const names = () =>
      [...(block(host, "ks-soon")?.querySelectorAll("li") ?? [])].map((li) => li.querySelectorAll("p")[1].textContent);
    expect(names()).toEqual(["गणितIndian Mathematics", "योगYoga", "छन्द शास्त्रChhanda shastra"]);
    const tab = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes("Health"));
    await click(tab);
    expect(names()).toEqual(["योगYoga"]);
  });
});

describe("in the site's other language", () => {
  it("live folder names go through the site dictionary; a repeated eyebrow / name shows once", async () => {
    h.searchStr = "?lang=hi";
    const i18n = {
      enabled: true,
      defaultLocale: "en",
      locales: [
        { code: "en", label: "EN" },
        { code: "hi", label: "हिन्दी" },
      ],
      strings: {
        hi: {
          Education: "शिक्षा",
          "Health | Ayurveda": "स्वास्थ्य | आयुर्वेद",
          "Chhanda shastra": "छन्द शास्त्र",
          "Indian Mathematics": "भारतीय गणित",
        },
      },
    };
    const host = await mount(
      {
        columnSections: [
          // Authored text reaches the section already translated (JsonRenderer).
          { ...SPOTLIGHT, slides: [{ ...SLIDE, eyebrow: "प्रमुख कार्यक्रम", title: "रजस्वला परिचर्या" }] },
          { ...SOON, title: "जल्द आ रहा है", notifyLabel: "मुझे सूचित करें", scope: "all" },
        ],
      },
      i18n,
    );
    const panel = block(host, "ks-flagship")!;
    expect(panel.querySelector("p")!.textContent).toBe("प्रमुख कार्यक्रम  ·  स्वास्थ्य | आयुर्वेद");
    expect(panel.querySelector("h2")!.textContent).toBe("रजस्वला परिचर्या");
    const cards = [...block(host, "ks-soon")!.querySelectorAll("li")];
    expect(cards[0].querySelector("p")!.textContent).toBe("शिक्षा");
    expect(cards[0].querySelectorAll("p")[1].textContent).toBe("छन्द शास्त्र");
    expect(cards[1].querySelectorAll("p")[1].textContent).toBe("गणितभारतीय गणित");
    expect(cards[0].querySelector("button")!.textContent).toBe("मुझे सूचित करें");
  });
});
