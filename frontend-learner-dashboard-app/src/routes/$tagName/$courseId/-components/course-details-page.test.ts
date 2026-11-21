// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ── mocks: network, router, and the heavy children of the page ───────── */

// Vite `define` globals the app reads at runtime.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__MAC_APP_STORE__ = false;
});

const net = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("axios", () => {
  const instance = () => ({
    get: net.get,
    post: net.post,
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn(), eject: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
    defaults: { headers: { common: {} } },
  });
  return { default: { ...instance(), create: instance, isAxiosError: () => false } };
});

vi.mock("@/constants/urls", () => ({
  BASE_URL: "https://api.test",
  ENROLLMENT_INVITE_URL: "https://api.test/admin-core-service/open/learner/enroll-invite",
  urlCourseDetails: "https://api.test/admin-core-service/open/packages/v2/search",
  GET_PRODUCT_PAGE_BY_CODE: (code: string, instituteId: string) =>
    `https://api.test/by-code?code=${code}&instituteId=${instituteId}`,
  // Read by the site cart drawer's checkout and payment housekeeping.
  VALIDATE_PRODUCT_PAGE_COUPON: "https://api.test/coupon",
  PRODUCT_PAGE_FORM_SUBMIT: "https://api.test/form",
  PRODUCT_PAGE_ENROLL: "https://api.test/enroll",
  PRODUCT_PAGE_CPO_ENROLL: "https://api.test/cpo-enroll",
  PEYMENT_LOG_STATUS_URL: "https://api.test/payment-log",
}));

const router = vi.hoisted(() => ({
  location: { pathname: "/site/pkg", searchStr: "", hash: "" },
  replace: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => router.navigate,
  useRouter: () => ({ state: { location: router.location }, history: { replace: router.replace, push: vi.fn() } }),
  useLocation: () => router.location,
  useParams: () => ({}),
  useSearch: () => ({}),
  Link: () => null,
}));

vi.mock("react-i18next", async (importOriginal: () => Promise<typeof import("react-i18next")>) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key: string, opts?: string | { defaultValue?: string }) =>
      typeof opts === "string" ? opts : (opts?.defaultValue ?? key),
    i18n: { language: "en" },
  }),
}));

const catalogue = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("../../-services/course-catalogue-service", () => ({
  CourseCatalogueService: { getCourseCatalogueByTag: vi.fn(async () => catalogue.data) },
}));
vi.mock("@/hooks/use-domain-routing", () => ({ useDomainRouting: () => ({ instituteId: "inst", isLoading: false }) }));
vi.mock("../../-utils/institute-naming-seed", () => ({ useInstituteNamingSettings: () => true }));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: vi.fn(async () => "") }));
vi.mock("@/components/core/dashboard-loader", () => ({ DashboardLoader: () => null }));

const children = vi.hoisted(() => ({ dialog: null as Record<string, unknown> | null }));
vi.mock("../../-components/JsonRenderer", async () => {
  const React = await import("react");
  return {
    JsonRenderer: ({ page, courseData }: { page: { id: string }; courseData?: { title?: string } }) =>
      React.createElement("div", { "data-json": page.id }, courseData?.title ?? ""),
  };
});
vi.mock("../../-components/components/HtmlPageSection", () => ({ OPEN_COURSE_ENROLLMENT_EVENT: "openCourseEnrollment" }));
vi.mock("../../-components/EnrollmentPaymentDialog", () => ({
  EnrollmentPaymentDialog: (props: Record<string, unknown>) => {
    children.dialog = props;
    return null;
  },
}));
vi.mock("../../-components/LeadCollectionModal", () => ({ LeadCollectionModal: () => null }));
vi.mock("../../-components/AudienceFormModal", () => ({ AudienceFormModal: () => null }));
// Records each mount of the syllabus (a remount runs the mount effect again).
const syllabus = vi.hoisted(() => ({ mounts: [] as string[] }));
vi.mock("../../-components/CourseStructureDetails", async () => {
  const React = await import("react");
  return {
    CourseStructureDetails: ({ packageSessionId }: { packageSessionId: string }) => {
      React.useEffect(() => {
        syllabus.mounts.push(packageSessionId);
      }, []);
      return null;
    },
  };
});
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
vi.mock("@/components/common/enroll-by-invite/-components/InviteUnavailableMessage", () => ({
  InviteUnavailableMessage: () => null,
}));

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseDetailsPage } from "./CourseDetailsPage";
import { useSiteCartStore } from "../../-stores/site-cart-store";
import {
  registerSiteCartOpener,
  requestSiteCartReopen,
  takeSiteCartReopenRequest,
  type SiteCartOpenRequest,
} from "../../-components/site-cart/site-cart-events";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const memoryStorage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memoryStorage.get(k) ?? null,
    setItem: (k: string, v: string) => void memoryStorage.set(k, String(v)),
    removeItem: (k: string) => void memoryStorage.delete(k),
    clear: () => memoryStorage.clear(),
  },
});

/* ── fixtures ─────────────────────────────────────────────────────────── */

const courseInit = (courseId: string) => [
  {
    course: { id: courseId, package_name: "Yoga", is_course_published_to_catalaouge: true },
    sessions: [
      {
        session_dto: { id: "ses", session_name: "2026" },
        level_with_details: [
          { id: "lvl-en", name: "English", read_time_in_minutes: 90, instructors: [] },
          { id: "lvl-hi", name: "Hindi", read_time_in_minutes: 120, instructors: [] },
        ],
      },
    ],
    package_sessions: [
      { id: `${courseId}-en`, level: { id: "lvl-en", level_name: "English" }, session: { id: "ses" } },
      { id: `${courseId}-hi`, level: { id: "lvl-hi", level_name: "Hindi" }, session: { id: "ses" } },
    ],
  },
];

const searchRows = (courseId: string) => [
  { id: courseId, package_session_id: `${courseId}-en`, level_id: "lvl-en", level_name: "English", session_id: "ses", enroll_invite_id: `${courseId}-inv-en`, min_plan_actual_price: 999, currency: "INR" },
  { id: courseId, package_session_id: `${courseId}-hi`, level_id: "lvl-hi", level_name: "Hindi", session_id: "ses", enroll_invite_id: `${courseId}-inv-hi`, min_plan_actual_price: 499, currency: "INR" },
  { id: "another-course", package_session_id: "zz", level_name: "English", enroll_invite_id: "zz-inv" },
];

const invite = (id: string, psId: string, price: number) => ({
  id,
  availability_status: "AVAILABLE",
  package_session_to_payment_options: [
    { package_session_id: psId, payment_option: { id: `po-${id}`, payment_plans: [{ actual_price: price, currency: "INR" }] } },
  ],
});

const settings = (extra: Record<string, unknown> = {}) => ({
  globalSettings: {
    courseCatalogeType: { enabled: false, value: "" },
    mode: "light",
    payment: { enabled: true, provider: "razorpay", fields: [] },
    leadCollection: { enabled: false },
    ...extra,
  },
  pages: [{ id: "details", route: "course-details", components: [{ id: "hero", type: "heroSection", props: {} }] }],
});

const routeNetwork = (
  courseId: string,
  invites: Record<string, unknown>,
  mappings: unknown[] = [],
  over: { init?: unknown[]; rows?: unknown[] } = {},
) => {
  net.get.mockImplementation(async (url: string) => {
    if (url.includes("course-init")) return { data: over.init ?? courseInit(courseId) };
    if (url.includes("student-display")) return { data: { courseDetails: {} } };
    if (url.includes("by-code")) return { data: { mappings } };
    const inviteId = url.split("/").pop() as string;
    if (invites[inviteId]) return { data: invites[inviteId] };
    throw new Error(`unexpected GET ${url}`);
  });
  net.post.mockImplementation(async () => ({ data: { content: over.rows ?? searchRows(courseId) } }));
};

/** An invite selling several package sessions, each with its own plan. */
const bundleInvite = (id: string, prices: Record<string, number>) => ({
  id,
  availability_status: "AVAILABLE",
  package_session_to_payment_options: Object.entries(prices).map(([psId, price]) => ({
    package_session_id: psId,
    payment_option: { id: `po-${id}-${psId}`, payment_plans: [{ actual_price: price, currency: "INR" }] },
  })),
});

/** The store product page's mappings: it sells each of these versions of course `c` once. */
const storeSells = (c: string, ...versions: string[]) =>
  versions.map((v) => ({
    package_id: c,
    package_session_id: `${c}-${v}`,
    enroll_invite_id: `store-inv-${v}`,
    status: "ACTIVE",
    payment_plan: { actual_price: 999, currency: "INR" },
  }));

/** GETs of the site's store page (code STORE). */
const storePageReads = () =>
  net.get.mock.calls.filter(([u]: unknown[]) => String(u).includes("by-code?code=STORE"));

const lastUrlParams = () =>
  new URLSearchParams(((router.replace.mock.calls.at(-1)?.[0] as string) ?? "").split("?")[1] ?? "");

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const settle = async () => {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

const renderPage = async (props: Record<string, unknown>) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // The app's query client (the site cart drawer's checkout reads the store page through it).
  // No delay before the store page's one retry (useStoreSale), so a failing read settles here.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  act(() =>
    root!.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(CourseDetailsPage, { tagName: "site", instituteId: "inst", ...(props as { courseId: string }) }),
      ),
    ),
  );
  await settle();
  return host;
};

const radios = () => Array.from(host!.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
const buttonByText = (text: string) =>
  Array.from(host!.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.textContent?.trim() === text);

const cleanups: Array<() => void> = [];
/** A header cart button on the page: records the open requests it is handed. */
const headerCart = () => {
  const requests: Array<SiteCartOpenRequest | undefined> = [];
  cleanups.push(registerSiteCartOpener((request) => requests.push(request)));
  return requests;
};
/** The cart drawer (a dialog portalled to the body), when one is open. */
const openCartDrawer = () =>
  Array.from(document.body.querySelectorAll('[role="dialog"]')).find((d) => d.textContent?.includes("Your cart"));

beforeEach(() => {
  net.get.mockReset();
  net.post.mockReset();
  router.replace.mockReset();
  router.navigate.mockReset();
  router.location = { pathname: "/site/pkg", searchStr: "", hash: "" };
  children.dialog = null;
  syllabus.mounts = [];
  toasts.success.mockReset();
  toasts.error.mockReset();
  memoryStorage.clear();
  useSiteCartStore.setState({ instituteId: null, items: [], hydrated: false, lastAddedAt: 0 });
  takeSiteCartReopenRequest(); // none left over from another test
});

const unmountPage = () => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
};

afterEach(() => {
  unmountPage();
  while (cleanups.length) cleanups.pop()!();
});

/* ── tests ────────────────────────────────────────────────────────────── */

describe("CourseDetailsPage — a site without the new settings", () => {
  it("makes the same requests and renders the same enrol flow as before", async () => {
    const c = "c-plain";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) });
    catalogue.data = settings();
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en`, level: "English" });

    expect(net.post).not.toHaveBeenCalled(); // no catalogue search
    // Exactly the three reads the page always made: course-init, the student
    // display settings and the link's invite — nothing new, nothing twice.
    expect(net.get.mock.calls.map(([u]: unknown[]) => String(u).split("?")[0]).sort()).toEqual([
      "https://api.test/admin-core-service/open/institute/setting/v1/student-display",
      `https://api.test/admin-core-service/open/learner/enroll-invite/inst/${c}-inv-en`,
      "https://api.test/admin-core-service/open/v1/learner-study-library/course-init",
    ]);
    expect(radios()).toHaveLength(0); // no Language picker
    expect(host!.textContent).toContain("English"); // the Level row is still there
    expect(buttonByText("Add to cart")).toHaveLength(0);
    expect(syllabus.mounts).toEqual([`${c}-en`]); // mounted once, never remounted
    const enrol = buttonByText("courseDetails.enrollNow");
    expect(enrol.every((b) => !b.disabled && !b.hasAttribute("aria-busy"))).toBe(true);

    act(() => enrol[0].click());
    expect(children.dialog).toMatchObject({
      open: true,
      courseData: expect.objectContaining({ packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en`, price: 999 }),
    });
  });

  it("shows the plan of the linked package session's invite entry (what the dialog charges)", async () => {
    const c = "c-bundle";
    routeNetwork(c, { bundle: bundleInvite("bundle", { [`${c}-en`]: 999, [`${c}-hi`]: 449 }) });
    catalogue.data = settings();
    await renderPage({ courseId: c, packageSessionId: `${c}-hi`, enrollInviteId: "bundle", level: "Hindi" });

    expect(net.post).not.toHaveBeenCalled();
    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(children.dialog).toMatchObject({
      courseData: expect.objectContaining({ packageSessionId: `${c}-hi`, enrollInviteId: "bundle", price: 449 }),
    });
  });
});

describe("CourseDetailsPage — language versions", () => {
  it("shows the picker, switches version, writes the URL and enrols in the picked version", async () => {
    const c = "c-lang";
    routeNetwork(c, {
      [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999),
      [`${c}-inv-hi`]: invite(`${c}-inv-hi`, `${c}-hi`, 449),
    });
    catalogue.data = settings({ courseLanguages: { enabled: true } });
    router.location = { pathname: `/site/${c}`, searchStr: `?packageSessionId=${c}-en&enrollInviteId=${c}-inv-en&utm_source=x`, hash: "" };
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en`, level: "English" });

    expect(net.post.mock.calls[0][1].package_ids).toEqual([c]);
    // Desktop + mobile cards each carry the picker.
    // One picker, in the enrol card beside the price.
    expect(radios().map((r) => r.textContent)).toEqual(["ENEnglish", "हिंHindi"]);
    expect(radios()[0].getAttribute("aria-checked")).toBe("true");

    act(() => radios()[1].click());
    await settle();

    const href = router.replace.mock.calls.at(-1)?.[0] as string;
    const params = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith(`/site/${c}?`)).toBe(true);
    expect(params.get("packageSessionId")).toBe(`${c}-hi`);
    expect(params.get("enrollInviteId")).toBe(`${c}-inv-hi`);
    expect(params.get("level")).toBe("Hindi");
    expect(params.get("utm_source")).toBe("x"); // other params survive
    expect(radios()[1].getAttribute("aria-checked")).toBe("true");

    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(children.dialog).toMatchObject({
      courseData: expect.objectContaining({ packageSessionId: `${c}-hi`, enrollInviteId: `${c}-inv-hi`, price: 449 }),
    });
  });

  it("hands the picked version to the product page on a product page visit", async () => {
    const c = "c-path";
    const mappings = [
      { package_id: c, package_session_id: `${c}-en`, enroll_invite_id: "pp-en", level_name: "English", status: "ACTIVE", display_order: 1, payment_plan: { actual_price: 600, currency: "INR" } },
      { package_id: c, package_session_id: `${c}-hi`, enroll_invite_id: "pp-hi", level_name: "Hindi", status: "ACTIVE", display_order: 2, payment_plan: { actual_price: 500, currency: "INR" } },
    ];
    routeNetwork(c, { "pp-en": invite("pp-en", `${c}-en`, 1), "pp-hi": invite("pp-hi", `${c}-hi`, 1) }, mappings);
    // The store sells both versions, at another price than this page's.
    const route = net.get.getMockImplementation()!;
    net.get.mockImplementation((url: string) =>
      url.includes("by-code?code=STORE") ? Promise.resolve({ data: { mappings: storeSells(c, "en", "hi") } }) : route(url),
    );
    catalogue.data = settings({ courseLanguages: { enabled: true }, siteCart: { enabled: true, storeProductPageCode: "STORE" } });
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: "pp-en", productPageCode: "PATH", price: "600" });

    expect(net.post).not.toHaveBeenCalled(); // the product page's own mappings, not the catalogue
    expect(buttonByText("Add to cart")).toHaveLength(0); // its own checkout: the store charges another price
    act(() => radios()[1].click());
    await settle();
    expect(host!.textContent).toContain("500"); // that page's price for the Hindi version

    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(router.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/product-pages/$productPageCode",
        params: { productPageCode: "PATH" },
        search: expect.objectContaining({ courseIds: `${c}-hi`, defaultTab: "CART" }),
      }),
    );
  });
});

describe("CourseDetailsPage — language versions: links, syllabus, levels", () => {
  it("keeps a promo link's invite for every version it sells, switching away and back", async () => {
    const c = "c-promo";
    routeNetwork(c, {
      PROMO: bundleInvite("PROMO", { [`${c}-en`]: 700, [`${c}-hi`]: 300 }),
      [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999),
      [`${c}-inv-hi`]: invite(`${c}-inv-hi`, `${c}-hi`, 449),
    });
    catalogue.data = settings({ courseLanguages: { enabled: true } });
    router.location = { pathname: `/site/${c}`, searchStr: `?packageSessionId=${c}-en&enrollInviteId=PROMO`, hash: "" };
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: "PROMO" });

    act(() => radios()[1].click()); // Hindi
    await settle();
    expect(lastUrlParams().get("enrollInviteId")).toBe("PROMO");
    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(children.dialog).toMatchObject({
      courseData: expect.objectContaining({ packageSessionId: `${c}-hi`, enrollInviteId: "PROMO", price: 300 }),
    });

    act(() => radios()[0].click()); // back to English
    await settle();
    expect(lastUrlParams().get("enrollInviteId")).toBe("PROMO");
    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(children.dialog).toMatchObject({
      courseData: expect.objectContaining({ packageSessionId: `${c}-en`, enrollInviteId: "PROMO", price: 700 }),
    });
  });

  it("remounts the syllabus for the picked version, and shows that version's own read time", async () => {
    const c = "c-syl";
    const init = courseInit(c);
    // The Hindi version has no read time and no faculty of its own.
    (init[0].sessions[0].level_with_details[1] as { read_time_in_minutes: number }).read_time_in_minutes = 0;
    routeNetwork(
      c,
      { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999), [`${c}-inv-hi`]: invite(`${c}-inv-hi`, `${c}-hi`, 449) },
      [],
      { init },
    );
    catalogue.data = settings({ courseLanguages: { enabled: true } });
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });
    expect(syllabus.mounts).toEqual([`${c}-en`]);
    const durationRows = () => (host!.textContent?.match(/courseDetails\.duration/g) ?? []).length;
    expect(durationRows()).toBe(1); // English: 90 min, in the enrol card

    act(() => radios()[1].click());
    await settle();
    expect(syllabus.mounts).toEqual([`${c}-en`, `${c}-hi`]);
    expect(durationRows()).toBe(0); // not English's read time
  });

  it("offers a Level picker when the picked language has several versions", async () => {
    const c = "c-lvl";
    const rows = [
      { id: c, package_session_id: `${c}-en`, level_name: "English", enroll_invite_id: "i-en", min_plan_actual_price: 999 },
      { id: c, package_session_id: `${c}-hb`, level_name: "Beginner Hindi", enroll_invite_id: "i-hb", min_plan_actual_price: 399 },
      { id: c, package_session_id: `${c}-ha`, level_name: "Advanced Hindi", enroll_invite_id: "i-ha", min_plan_actual_price: 599 },
    ];
    routeNetwork(
      c,
      { "i-en": invite("i-en", `${c}-en`, 999), "i-hb": invite("i-hb", `${c}-hb`, 399), "i-ha": invite("i-ha", `${c}-ha`, 599) },
      [],
      { rows },
    );
    catalogue.data = settings({ courseLanguages: { enabled: true } });
    await renderPage({ courseId: c, packageSessionId: `${c}-hb`, enrollInviteId: "i-hb" });

    const labels = radios().map((r) => r.textContent);
    // Language (EN / हिं) then Level (two Hindi versions), in the enrol card.
    expect(labels.filter((l) => l === "Beginner Hindi")).toHaveLength(1);
    expect(labels.filter((l) => l === "Advanced Hindi")).toHaveLength(1);
    act(() => radios().find((r) => r.textContent === "Advanced Hindi")!.click());
    await settle();
    expect(lastUrlParams().get("packageSessionId")).toBe(`${c}-ha`);
    expect(lastUrlParams().get("level")).toBe("Advanced Hindi");
    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(children.dialog).toMatchObject({
      courseData: expect.objectContaining({ packageSessionId: `${c}-ha`, enrollInviteId: "i-ha", price: 599 }),
    });
  });

  it("holds the enrol button until the versions are known", async () => {
    const c = "c-wait";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999), [`${c}-inv-hi`]: invite(`${c}-inv-hi`, `${c}-hi`, 449) });
    let release: (value: unknown) => void = () => {};
    net.post.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    catalogue.data = settings({ courseLanguages: { enabled: true } });
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });

    const enrol = buttonByText("courseDetails.enrollNow");
    expect(enrol.length).toBeGreaterThan(0);
    expect(enrol.every((b) => b.disabled && b.getAttribute("aria-busy") === "true")).toBe(true);
    act(() => enrol[0].click());
    act(() => {
      window.dispatchEvent(new Event("openCourseEnrollment")); // an HTML page's data-vacademy="enrol"
    });
    expect(children.dialog).toMatchObject({ open: false });

    release({ data: { content: searchRows(c) } });
    await settle();
    const ready = buttonByText("courseDetails.enrollNow");
    expect(ready.every((b) => !b.disabled)).toBe(true);
    act(() => ready[0].click());
    expect(children.dialog).toMatchObject({ open: true, courseData: expect.objectContaining({ packageSessionId: `${c}-en` }) });
  });
});

describe("CourseDetailsPage — site cart", () => {
  it("refuses a 41st course and opens the cart instead of checking out", async () => {
    const c = "c-full";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) }, storeSells(c, "en"));
    catalogue.data = settings({ siteCart: { enabled: true, storeProductPageCode: "STORE" } });
    const full = Array.from({ length: 40 }, (_, i) => ({ packageSessionId: `x-${i}`, courseId: `xc-${i}`, title: `X${i}` }));
    useSiteCartStore.setState({ instituteId: "inst", items: full, hydrated: true });
    const opened = headerCart();
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });

    act(() => buttonByText("Add to cart")[0].click());
    expect(useSiteCartStore.getState().items).toHaveLength(40);
    expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining("Your cart is full"));
    expect(toasts.success).not.toHaveBeenCalled();

    act(() => buttonByText("Buy now")[0].click());
    expect(useSiteCartStore.getState().items).toHaveLength(40);
    expect(opened).toEqual([expect.objectContaining({ intent: "view" })]);
  });

  it("still swaps this course's version in a full cart", async () => {
    const c = "c-swap";
    routeNetwork(
      c,
      { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999), [`${c}-inv-hi`]: invite(`${c}-inv-hi`, `${c}-hi`, 449) },
      storeSells(c, "en", "hi"),
    );
    catalogue.data = settings({ courseLanguages: { enabled: true }, siteCart: { enabled: true, storeProductPageCode: "STORE" } });
    const full = [
      { packageSessionId: `${c}-en`, courseId: c, title: "Yoga" },
      ...Array.from({ length: 39 }, (_, i) => ({ packageSessionId: `x-${i}`, courseId: `xc-${i}`, title: `X${i}` })),
    ];
    useSiteCartStore.setState({ instituteId: "inst", items: full, hydrated: true });
    await renderPage({ courseId: c, packageSessionId: `${c}-hi`, enrollInviteId: `${c}-inv-hi` });

    act(() => buttonByText("Add to cart")[0].click());
    const items = useSiteCartStore.getState().items;
    expect(items).toHaveLength(40);
    expect(items.some((i) => i.packageSessionId === `${c}-hi`)).toBe(true);
    expect(items.some((i) => i.packageSessionId === `${c}-en`)).toBe(false);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("adds the version to the site cart, then offers In cart and Buy now", async () => {
    const c = "c-cart";
    routeNetwork(
      c,
      {
        [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999),
        [`${c}-inv-hi`]: invite(`${c}-inv-hi`, `${c}-hi`, 449),
      },
      storeSells(c, "en", "hi"),
    );
    catalogue.data = settings({ siteCart: { enabled: true, storeProductPageCode: "STORE" } });
    const opened = headerCart();

    // A bare link: the first version with an invite is the one on screen.
    await renderPage({ courseId: c });

    const add = buttonByText("Add to cart");
    expect(add.length).toBeGreaterThan(0);
    expect(add[0].disabled).toBe(false);
    act(() => add[0].click());
    expect(useSiteCartStore.getState().items).toEqual([
      expect.objectContaining({ packageSessionId: `${c}-en`, courseId: c, title: "Yoga", levelName: "English", languageCode: "en", enrollInviteId: `${c}-inv-en` }),
    ]);
    expect(buttonByText("In cart").length).toBeGreaterThan(0);

    act(() => buttonByText("Buy now")[0].click());
    expect(opened).toEqual([{ intent: "checkout", packageSessionId: `${c}-en`, source: "course" }]);
    expect(useSiteCartStore.getState().items).toHaveLength(1);
  });
});

describe("CourseDetailsPage — site cart drawer with and without a header cart button", () => {
  const siteCart = { siteCart: { enabled: true, storeProductPageCode: "STORE" } };
  // The store product page sells the English version at the price shown.
  const storeMappings = (c: string) => [
    { package_id: c, package_session_id: `${c}-en`, enroll_invite_id: "store-inv", status: "ACTIVE", payment_plan: { actual_price: 999, currency: "INR" } },
  ];
  const storeCheckouts = () =>
    router.navigate.mock.calls.filter(
      ([arg]: unknown[]) => (arg as { to?: string }).to === "/product-pages/$productPageCode",
    );

  it("hands Buy now and In cart to the header's cart and renders no drawer of its own", async () => {
    const c = "c-hdr";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) }, storeMappings(c));
    catalogue.data = settings(siteCart);
    const opened = headerCart();
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });

    act(() => buttonByText("Buy now")[0].click());
    await settle();
    act(() => buttonByText("In cart")[0].click());
    await settle();
    expect(opened).toEqual([
      { intent: "checkout", packageSessionId: `${c}-en`, source: "course" },
      { intent: "view", packageSessionId: `${c}-en`, source: "course" },
    ]);
    expect(openCartDrawer()).toBeUndefined();
    expect(storeCheckouts()).toHaveLength(0); // the header's drawer checks out, not the page
  });

  it("opens its own drawer on a page without one; Buy now checks out once", async () => {
    const c = "c-nohdr";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) }, storeMappings(c));
    catalogue.data = settings(siteCart); // no layout.header: no cart button anywhere
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });
    expect(openCartDrawer()).toBeUndefined();

    act(() => buttonByText("Buy now")[0].click());
    await settle();
    expect(useSiteCartStore.getState().items).toEqual([expect.objectContaining({ packageSessionId: `${c}-en` })]);
    // The drawer's checkout: store pre-check, then the store's cart step.
    expect(storeCheckouts()).toEqual([
      [
        expect.objectContaining({
          params: { productPageCode: "STORE" },
          search: expect.objectContaining({ courseIds: `${c}-en`, defaultTab: "CART", tagName: "site", source: "siteCart" }),
        }),
      ],
    ]);

    // "In cart" opens the drawer again — to look, not to check out again.
    act(() => buttonByText("In cart")[0].click());
    await settle();
    expect(openCartDrawer()).toBeDefined();
    expect(storeCheckouts()).toHaveLength(1);
  });

  it("reopens its own drawer after the store checkout's Back, but leaves that to a header", async () => {
    const c = "c-back";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) }, storeMappings(c));
    catalogue.data = settings(siteCart);
    requestSiteCartReopen();
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });
    expect(openCartDrawer()).toBeDefined();
    unmountPage();

    headerCart();
    requestSiteCartReopen();
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });
    expect(openCartDrawer()).toBeUndefined();
  });
});

describe("CourseDetailsPage — site cart and a link's own invite", () => {
  const siteCart = { siteCart: { enabled: true, storeProductPageCode: "STORE" } };

  it("keeps a plain link (the version's own invite) in the site cart", async () => {
    const c = "c-own";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) }, storeSells(c, "en"));
    catalogue.data = settings(siteCart);
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });
    expect(buttonByText("Add to cart").length).toBeGreaterThan(0);
    expect(buttonByText("courseDetails.enrollNow")).toHaveLength(0);
  });

  it("enrols a promo link through its invite at its price, never through the cart", async () => {
    const c = "c-diwali";
    routeNetwork(c, {
      PROMO: invite("PROMO", `${c}-en`, 700),
      [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999),
    });
    catalogue.data = settings(siteCart);
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: "PROMO" });

    expect(buttonByText("Add to cart")).toHaveLength(0);
    expect(buttonByText("Buy now")).toHaveLength(0);
    const enrol = buttonByText("courseDetails.enrollNow");
    expect(enrol.length).toBeGreaterThan(0);
    act(() => enrol[0].click());
    expect(children.dialog).toMatchObject({
      open: true,
      courseData: expect.objectContaining({ packageSessionId: `${c}-en`, enrollInviteId: "PROMO", price: 700 }),
    });
    // An HTML page's data-vacademy="enrol" goes the same way.
    act(() => (children.dialog!.onOpenChange as (open: boolean) => void)(false));
    expect(children.dialog).toMatchObject({ open: false });
    act(() => {
      window.dispatchEvent(new Event("openCourseEnrollment"));
    });
    expect(children.dialog).toMatchObject({
      open: true,
      courseData: expect.objectContaining({ enrollInviteId: "PROMO", price: 700 }),
    });
    expect(useSiteCartStore.getState().items).toHaveLength(0);
  });

  it("offers the cart for a version the promo does not sell, and the promo again on the way back", async () => {
    const c = "c-promo-en";
    routeNetwork(
      c,
      {
        PROMO: invite("PROMO", `${c}-en`, 700), // sells English only
        [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999),
        [`${c}-inv-hi`]: invite(`${c}-inv-hi`, `${c}-hi`, 449),
      },
      storeSells(c, "en", "hi"),
    );
    catalogue.data = settings({ courseLanguages: { enabled: true }, ...siteCart });
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: "PROMO" });
    expect(buttonByText("Add to cart")).toHaveLength(0);

    act(() => radios()[1].click()); // Hindi, through its own invite
    await settle();
    act(() => buttonByText("Add to cart")[0].click());
    expect(useSiteCartStore.getState().items).toEqual([
      expect.objectContaining({ packageSessionId: `${c}-hi`, enrollInviteId: `${c}-inv-hi`, price: 449 }),
    ]);

    act(() => radios()[0].click()); // back to English: the promo again
    await settle();
    expect(buttonByText("Add to cart")).toHaveLength(0);
    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(children.dialog).toMatchObject({
      courseData: expect.objectContaining({ packageSessionId: `${c}-en`, enrollInviteId: "PROMO", price: 700 }),
    });
  });

  it("keeps a link's invite when the versions cannot be read to vouch for it", async () => {
    const c = "c-noversions";
    routeNetwork(c, { PROMO: invite("PROMO", `${c}-en`, 700) });
    net.post.mockImplementation(async () => {
      throw new Error("search down");
    });
    catalogue.data = settings(siteCart);
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: "PROMO" });
    expect(buttonByText("Add to cart")).toHaveLength(0);
    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(children.dialog).toMatchObject({
      courseData: expect.objectContaining({ enrollInviteId: "PROMO", price: 700 }),
    });
  });
});

describe("CourseDetailsPage — site cart and what the store page sells", () => {
  const siteCart = { siteCart: { enabled: true, storeProductPageCode: "STORE" } };
  const pendingButtons = () =>
    Array.from(host!.querySelectorAll<HTMLButtonElement>('button[aria-label="Checking availability…"]'));
  /** Answers GETs of the store page with `answer`, every other GET as routeNetwork set it up. */
  const storePageAnswers = (answer: (url: string) => Promise<unknown>) => {
    const route = net.get.getMockImplementation()!;
    net.get.mockImplementation((url: string) => (url.includes("by-code") ? answer(url) : route(url)));
  };

  it("enrols in a free course the store does not sell for free, as without a site cart", async () => {
    const c = "c-orient";
    // The store sells other courses only (its sync skipped this one).
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 0) }, storeSells("c-other", "en"));
    catalogue.data = settings(siteCart);
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });

    expect(buttonByText("Add to cart")).toHaveLength(0);
    expect(buttonByText("Buy now")).toHaveLength(0);
    const enrol = buttonByText("courseDetails.enrollForFree");
    expect(enrol.length).toBeGreaterThan(0);
    act(() => enrol[0].click());
    expect(children.dialog).toMatchObject({
      open: true,
      courseData: expect.objectContaining({ packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en`, price: 0 }),
    });
    // An HTML page's data-vacademy="enrol" goes the same way.
    act(() => (children.dialog!.onOpenChange as (open: boolean) => void)(false));
    act(() => {
      window.dispatchEvent(new Event("openCourseEnrollment"));
    });
    expect(children.dialog).toMatchObject({ open: true });
    expect(useSiteCartStore.getState().items).toHaveLength(0);
    expect(storePageReads()).toHaveLength(1);
  });

  it("keeps the enrol flow for a version the store does not sell, and the cart for one it does", async () => {
    const c = "c-half";
    routeNetwork(
      c,
      { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999), [`${c}-inv-hi`]: invite(`${c}-inv-hi`, `${c}-hi`, 449) },
      storeSells(c, "en"), // not the Hindi version
    );
    catalogue.data = settings({ courseLanguages: { enabled: true }, ...siteCart });
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });
    expect(buttonByText("Add to cart").length).toBeGreaterThan(0);

    act(() => radios()[1].click()); // Hindi
    await settle();
    expect(buttonByText("Add to cart")).toHaveLength(0);
    expect(pendingButtons()).toHaveLength(0); // the store is known: nothing to wait for
    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(children.dialog).toMatchObject({
      open: true,
      courseData: expect.objectContaining({ packageSessionId: `${c}-hi`, enrollInviteId: `${c}-inv-hi`, price: 449 }),
    });
    expect(useSiteCartStore.getState().items).toHaveLength(0);

    act(() => radios()[0].click()); // back to English: the cart again
    await settle();
    act(() => buttonByText("Add to cart")[0].click());
    expect(useSiteCartStore.getState().items).toEqual([expect.objectContaining({ packageSessionId: `${c}-en` })]);
    expect(storePageReads()).toHaveLength(1);
  });

  it("sends a version the store lists twice to its own enrol flow, never the cart", async () => {
    const c = "c-twice";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) }, [
      ...storeSells(c, "en"),
      ...storeSells(c, "en"),
    ]);
    catalogue.data = settings(siteCart);
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });

    expect(buttonByText("Add to cart")).toHaveLength(0);
    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(children.dialog).toMatchObject({
      open: true,
      courseData: expect.objectContaining({ packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` }),
    });
  });

  it("offers neither action until the store page is known, then the cart", async () => {
    const c = "c-wait-store";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) });
    let releaseStore: (value: unknown) => void = () => {};
    storePageAnswers(() => new Promise((resolve) => (releaseStore = resolve)));
    catalogue.data = settings(siteCart);
    const opened = headerCart();
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });

    // Both overview cards and the mobile bar wait, with nothing to press.
    const waiting = pendingButtons();
    expect(waiting).toHaveLength(2); // the enrol card and the mobile bar
    expect(waiting.every((b) => b.disabled && b.getAttribute("aria-busy") === "true")).toBe(true);
    expect(buttonByText("Add to cart")).toHaveLength(0);
    expect(buttonByText("courseDetails.enrollNow")).toHaveLength(0);
    // An HTML page's data-vacademy="enrol" waits too.
    act(() => {
      window.dispatchEvent(new Event("openCourseEnrollment"));
    });
    expect(children.dialog).toMatchObject({ open: false });
    expect(opened).toEqual([]);
    expect(useSiteCartStore.getState().items).toHaveLength(0);

    releaseStore({ data: { mappings: storeSells(c, "en") } });
    await settle();
    expect(pendingButtons()).toHaveLength(0);
    act(() => buttonByText("Buy now")[0].click());
    expect(opened).toEqual([{ intent: "checkout", packageSessionId: `${c}-en`, source: "course" }]);
  });

  it("falls back to the enrol flow when the store page cannot be read", async () => {
    const c = "c-store-down";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) });
    storePageAnswers(async () => {
      throw new Error("store page down");
    });
    catalogue.data = settings(siteCart);
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });

    expect(storePageReads().length).toBeGreaterThan(0);
    expect(pendingButtons()).toHaveLength(0);
    expect(buttonByText("Add to cart")).toHaveLength(0);
    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(children.dialog).toMatchObject({
      open: true,
      courseData: expect.objectContaining({ enrollInviteId: `${c}-inv-en`, price: 999 }),
    });
  });

  it("reads no store page on a site without a site cart", async () => {
    const c = "c-no-store";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999), [`${c}-inv-hi`]: invite(`${c}-inv-hi`, `${c}-hi`, 449) });
    catalogue.data = settings({ courseLanguages: { enabled: true } });
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });
    expect(net.get.mock.calls.some(([u]: unknown[]) => String(u).includes("by-code"))).toBe(false);
    expect(pendingButtons()).toHaveLength(0);
    const enrol = buttonByText("courseDetails.enrollNow");
    expect(enrol.length).toBeGreaterThan(0);
    expect(enrol.every((b) => !b.disabled)).toBe(true);
  });

  // A folder card's "View" link carries its product page's code.
  const pageMapping = (p: string, price: number) => ({
    package_id: p,
    package_session_id: `${p}-en`,
    enroll_invite_id: "pp-en",
    level_name: "English",
    status: "ACTIVE",
    display_order: 1,
    payment_plan: { actual_price: price, currency: "INR" },
  });

  it("puts a product page visit in the site cart when the store sells it at the page's price", async () => {
    const p = "c-pp-same";
    // The store and the page answer with the same mapping: same version, same price.
    routeNetwork(p, { "pp-en": invite("pp-en", `${p}-en`, 600) }, [pageMapping(p, 600)]);
    catalogue.data = settings(siteCart);
    await renderPage({ courseId: p, packageSessionId: `${p}-en`, enrollInviteId: "pp-en", productPageCode: "PATH" });
    expect(storePageReads().length).toBeGreaterThan(0);
    expect(buttonByText("Add to cart").length).toBeGreaterThan(0);
    expect(buttonByText("Buy now").length).toBeGreaterThan(0);
    expect(buttonByText("courseDetails.enrollNow")).toHaveLength(0);
  });

  it("keeps a product page visit on the page's own checkout when the store charges another price", async () => {
    const p = "c-pp-promo";
    routeNetwork(p, { "pp-en": invite("pp-en", `${p}-en`, 600) }, [pageMapping(p, 600)]);
    storePageAnswers(async (url) =>
      url.includes("code=STORE") ? { data: { mappings: [pageMapping(p, 999)] } } : { data: { mappings: [pageMapping(p, 600)] } },
    );
    catalogue.data = settings(siteCart);
    await renderPage({ courseId: p, packageSessionId: `${p}-en`, enrollInviteId: "pp-en", productPageCode: "PATH" });
    expect(pendingButtons()).toHaveLength(0);
    expect(buttonByText("Add to cart")).toHaveLength(0);
    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(router.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/product-pages/$productPageCode", params: { productPageCode: "PATH" } }),
    );
  });
});

describe("CourseDetailsPage — product page checkout and the site language", () => {
  const i18n = {
    enabled: true,
    defaultLocale: "en",
    locales: [{ code: "en", label: "EN" }, { code: "hi", label: "हिन्दी" }],
    strings: { hi: { Yoga: "योग" } },
  };
  const mappings = (c: string) => [
    { package_id: c, package_session_id: `${c}-en`, enroll_invite_id: "pp-en", level_name: "English", status: "ACTIVE", display_order: 1, payment_plan: { actual_price: 600, currency: "INR" } },
  ];
  const enrolFromPath = async (c: string, extra: Record<string, unknown>) => {
    routeNetwork(c, { "pp-en": invite("pp-en", `${c}-en`, 600) }, mappings(c));
    catalogue.data = settings(extra);
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: "pp-en", productPageCode: "PATH" });
    act(() => buttonByText("courseDetails.enrollNow")[0].click());
    expect(router.navigate).toHaveBeenCalledTimes(1);
    return (router.navigate.mock.calls[0][0] as { search: Record<string, unknown> }).search;
  };

  it("keeps the exact checkout URL on a single-language site", async () => {
    expect(await enrolFromPath("c-pp-plain", {})).toEqual({
      instituteId: "inst",
      courseIds: "c-pp-plain-en",
      defaultTab: "CART",
    });
  });

  it("opens the checkout inside the site on a site with languages (base language: no lang)", async () => {
    expect(await enrolFromPath("c-pp-en", { i18n })).toEqual({
      instituteId: "inst",
      courseIds: "c-pp-en-en",
      defaultTab: "CART",
      tagName: "site",
    });
  });

  it("carries the visitor's language, from the URL or the remembered choice", async () => {
    router.location = { pathname: "/site/c-pp-hi", searchStr: "?lang=hi", hash: "" };
    expect(await enrolFromPath("c-pp-hi", { i18n })).toEqual({
      instituteId: "inst",
      courseIds: "c-pp-hi-en",
      defaultTab: "CART",
      tagName: "site",
      lang: "hi",
    });

    unmountPage();
    router.navigate.mockReset();
    router.location = { pathname: "/site/c-pp-kept", searchStr: "", hash: "" };
    memoryStorage.set("catalogue-locale:site", "hi"); // chosen on an earlier visit
    expect(await enrolFromPath("c-pp-kept", { i18n })).toMatchObject({ tagName: "site", lang: "hi" });
  });
});

describe("CourseDetailsPage — site languages", () => {
  it("shows live course text in the visitor's language but submits the base values", async () => {
    const c = "c-i18n";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) });
    catalogue.data = settings({
      i18n: { enabled: true, defaultLocale: "en", locales: [{ code: "en", label: "EN" }, { code: "hi", label: "हिन्दी" }], strings: { hi: { Yoga: "योग" } } },
    });
    router.location = { pathname: `/site/${c}`, searchStr: "?lang=hi", hash: "" };
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });

    expect(host!.querySelector('[data-json="details"]')?.textContent).toBe("योग");
    expect(children.dialog).toMatchObject({ courseData: expect.objectContaining({ title: "Yoga" }) });
  });
});

describe("CourseDetailsPage — default layout", () => {
  const noDetailsPage = (extra: Record<string, unknown> = {}) => ({ ...settings(extra), pages: [] });

  it("says what the course is: a title heading when the site has no course header of its own", async () => {
    const c = "c-head";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) });
    catalogue.data = noDetailsPage();
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });
    expect(host!.querySelector("h1")?.textContent).toBe("Yoga");
    expect(host!.textContent).toContain("This course includes");
    // No folded highlights box, and no rating the course does not have.
    expect(host!.textContent).not.toContain("courseDetails.accordion.highlightsTitle");
    expect(host!.textContent).not.toContain("courseDetails.rating");
  });

  it("leaves the header to a site that built its own course header", async () => {
    const c = "c-own-head";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) });
    catalogue.data = settings();
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });
    expect(host!.querySelector("h1")).toBeNull();
    expect(host!.querySelector('[data-json="details"]')).toBeTruthy();
  });

  it("keeps the classic layout for a site that asks for it", async () => {
    const c = "c-classic";
    routeNetwork(c, { [`${c}-inv-en`]: invite(`${c}-inv-en`, `${c}-en`, 999) });
    catalogue.data = noDetailsPage({ courseDetails: { layout: "classic" } });
    await renderPage({ courseId: c, packageSessionId: `${c}-en`, enrollInviteId: `${c}-inv-en` });
    expect(host!.textContent).toContain("courseDetails.courseOverview");
    expect(host!.textContent).not.toContain("This course includes");
    // Even there, no invented 5.0.
    expect(host!.textContent).not.toContain("courseDetails.rating");
  });
});
