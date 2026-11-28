import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ─── environment stubs (node, no router / browser / portals) ────────────────
vi.mock("@/constants/urls", () => ({
  BASE_URL: "",
  GET_PRODUCT_PAGE_BY_CODE: () => "",
  VALIDATE_PRODUCT_PAGE_COUPON: "",
  PRODUCT_PAGE_FORM_SUBMIT: "",
  PRODUCT_PAGE_ENROLL: "",
  PRODUCT_PAGE_CPO_ENROLL: "",
  PEYMENT_LOG_STATUS_URL: "",
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) =>
      typeof opts === "string"
        ? opts
        : typeof opts?.defaultValue === "string"
          ? opts.defaultValue.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts[k] ?? ""))
          : key,
    i18n: { language: "en" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({ state: { location: { pathname: "/" } }, history: { push: () => {}, replace: () => {} } }),
  useLocation: () => ({ pathname: "/", searchStr: "" }),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: () => "Course",
  getTerminologyPlural: () => "Courses",
}));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => false }));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: () => Promise.resolve("") }));
vi.mock("@/hooks/use-media-query", () => ({ useMediaQuery: () => true }));
// The sheet portals its content (nothing on a server render): render it inline.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  SheetContent: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement("div", { className }, children),
  SheetClose: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  SheetTitle: ({ children }: { children?: React.ReactNode }) => React.createElement("h2", null, children),
}));
// The checkout's state is what a pre-check left behind.
const checkout = vi.hoisted(() => ({ state: { status: "idle" } as unknown }));
vi.mock("./use-site-cart-checkout", () => ({
  useSiteCartCheckout: () => ({
    state: checkout.state,
    runCheckout: () => Promise.resolve(null),
    goToCheckout: () => {},
    reset: () => {},
    storeCode: "STORE",
  }),
}));

const { SiteCartDrawer } = await import("./SiteCartDrawer");
const { useSiteCartStore } = await import("../../-stores/site-cart-store");
const { precheckSiteCart } = await import("./site-cart-precheck");
const { formatPriceAmount } = await import("@/components/common/price-with-mrp");

type CartItem = import("../../-utils/site-cart").SiteCartItem;

const INSTITUTE = "inst-1";
const plan = (price: number, currency = "INR") => ({ actual_price: price, currency });
const store = (rows: Array<[string, number, string?]>) =>
  rows.map(([id, price, currency]) => ({ package_session_id: id, status: "ACTIVE", payment_plan: plan(price, currency) }));

const decode = (s: string) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => decode(l.trim()))
    .filter(Boolean);

describe("site cart drawer: the checkout review", () => {
  // Server rendering reads zustand's server snapshot — the store's INITIAL
  // state — so the visitor's cart is seeded there (and restored after).
  const initial = useSiteCartStore.getInitialState();
  const pristine = { ...initial };
  const seedCart = (items: CartItem[]) => Object.assign(initial, { instituteId: INSTITUTE, hydrated: true, items });
  beforeEach(() => {
    checkout.state = { status: "idle" };
  });
  afterEach(() => {
    Object.assign(initial, pristine);
  });

  const render = () =>
    renderToStaticMarkup(
      React.createElement(SiteCartDrawer, {
        open: true,
        onOpenChange: () => {},
        instituteId: INSTITUTE,
        tagName: "site",
        settings: { enabled: true, storeProductPageCode: "STORE" },
      }),
    );

  it("asks before charging a changed price: old → new for each course, then 'Continue at current prices'", () => {
    // Added from a promo link at 2,500; the store's plan is 4,999.
    const promo: CartItem = {
      packageSessionId: "ps-1",
      courseId: "c1",
      title: "Vedic Maths",
      price: 2500,
      currency: "INR",
      enrollInviteId: "DIWALI50",
    };
    const kept: CartItem = { packageSessionId: "ps-2", courseId: "c2", title: "Yoga", price: 100, currency: "INR" };
    seedCart([promo, kept]);
    checkout.state = {
      status: "review",
      result: precheckSiteCart([promo, kept], store([["ps-1", 4999], ["ps-2", 100]])),
    };

    const html = render();
    const lines = text(html);
    const was = formatPriceAmount(2500, "INR");
    const now = formatPriceAmount(4999, "INR");
    expect(lines).toContain(`Price changed from ${was} to ${now}`);
    expect(html).toContain("line-through");
    expect(lines).toContain("Some prices have changed — checkout shows the current price.");
    expect(lines).toContain("Continue at current prices");
    // A price review never says courses cannot be checked out.
    const all = lines.join("\n");
    expect(all).not.toContain("can't be checked out");
    expect(all).not.toContain("can be checked out online");
    expect(all).not.toContain("Check out 2 available");
    expect(all).not.toContain("Remove unavailable");
    // The total is what checkout will charge.
    expect(lines).toContain(formatPriceAmount(5099, "INR"));
  });

  it("sets courses in another currency aside, to check out separately", () => {
    const rupees: CartItem = { packageSessionId: "ps-1", courseId: "c1", title: "Vedic Maths", price: 499, currency: "INR" };
    const dollars: CartItem = { packageSessionId: "ps-2", courseId: "c2", title: "Yoga", price: 299, currency: "USD" };
    seedCart([rupees, dollars]);
    checkout.state = {
      status: "review",
      result: precheckSiteCart([rupees, dollars], store([["ps-1", 499], ["ps-2", 299, "USD"]])),
    };

    const lines = text(render());
    expect(lines).toContain("Priced in a different currency — check it out separately.");
    expect(lines).toContain("Some courses are priced in a different currency — check them out separately.");
    expect(lines).toContain("Check out 1 available");
    // They are not unavailable: nothing offers to throw them away in bulk.
    expect(lines).not.toContain("Remove unavailable");
    expect(lines.some((l) => l.includes("can't be checked out"))).toBe(false);
    // One currency, one honest total: the rupee order.
    expect(lines).toContain(formatPriceAmount(499, "INR"));
    expect(lines).not.toContain("Shown at checkout");
  });

  it("still says which courses the store cannot sell", () => {
    const sold: CartItem = { packageSessionId: "ps-1", courseId: "c1", title: "Vedic Maths", price: 100 };
    const missing: CartItem = { packageSessionId: "ps-9", courseId: "c9", title: "Gone", price: 100 };
    seedCart([sold, missing]);
    checkout.state = { status: "review", result: precheckSiteCart([sold, missing], store([["ps-1", 100]])) };

    const lines = text(render());
    expect(lines).toContain("Not available for online checkout.");
    expect(lines).toContain("Some courses can't be checked out right now — see the notes above.");
    expect(lines).toContain("Check out 1 available");
    expect(lines).toContain("Remove unavailable");
    expect(lines).not.toContain("Continue at current prices");
  });

  it("names the level of a version beside its language chip", () => {
    seedCart([
      { packageSessionId: "ps-1", courseId: "c1", title: "Vedic Maths", levelName: "Advanced Hindi", languageCode: "hi" },
      { packageSessionId: "ps-2", courseId: "c2", title: "Yoga", levelName: "Hindi", languageCode: "hi" },
    ]);
    const lines = text(render());
    expect(lines.filter((l) => l === "हिं")).toHaveLength(2);
    expect(lines).toContain("Advanced");
    expect(lines).not.toContain("Hindi");
  });
});
