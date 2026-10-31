import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── environment stubs (node, no router / browser) ──────────────────────────
vi.mock("@/constants/urls", () => ({
  BASE_URL: "",
  GET_PRODUCT_PAGE_BY_CODE: () => "",
  VALIDATE_PRODUCT_PAGE_COUPON: "",
  PRODUCT_PAGE_FORM_SUBMIT: "",
  PRODUCT_PAGE_ENROLL: "",
  PRODUCT_PAGE_CPO_ENROLL: "",
  PEYMENT_LOG_STATUS_URL: "",
}));
// Every navigation the hook asks for, and whether the build hides prices
// (Apple store builds do).
const env = vi.hoisted(() => ({ navigations: [] as unknown[], hidePrices: false }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => (options: unknown) => {
    env.navigations.push(options);
    return Promise.resolve();
  },
  useRouter: () => ({ state: { location: { pathname: "/site" } } }),
  useLocation: () => ({ pathname: "/site", searchStr: "" }),
}));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => env.hidePrices }));

const { useSiteCartCheckout } = await import("./use-site-cart-checkout");

type CartItem = import("../../-utils/site-cart").SiteCartItem;
type Checkout = ReturnType<typeof useSiteCartCheckout>;

const INSTITUTE = "inst-1";
const STORE = "STORE";
const store = (rows: Array<[string, number, string?]>) => ({
  id: "store",
  code: STORE,
  name: "Store",
  mappings: rows.map(([id, price, currency = "INR"]) => ({
    package_session_id: id,
    status: "ACTIVE",
    payment_plan: { actual_price: price, currency },
  })),
});
const course = (id: string, price: number, currency = "INR"): CartItem => ({
  courseId: `course-${id}`,
  packageSessionId: id,
  title: `Course ${id}`,
  price,
  currency,
});

/** Renders the hook once, with the store page already read, and hands back its checkout. */
const mount = (storePage: unknown, onNavigate?: () => void): Checkout => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["PRODUCT_PAGE_BY_CODE", STORE, INSTITUTE], storePage);
  const captured: { checkout?: Checkout } = {};
  const Probe = () => {
    captured.checkout = useSiteCartCheckout({
      instituteId: INSTITUTE,
      tagName: "site",
      settings: { enabled: true, storeProductPageCode: STORE },
      onNavigate,
    });
    return null;
  };
  renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)));
  return captured.checkout!;
};

describe("site cart checkout: going on to the store checkout", () => {
  afterEach(() => {
    env.navigations = [];
    env.hidePrices = false;
  });

  it("stops for the visitor when a price changed since the course was added — never charges it silently", async () => {
    // Added from a promo link at 2,500; the store's plan is 4,999.
    const result = await mount(store([["a", 4999]])).runCheckout([course("a", 2500)]);
    expect(result?.ok).toBe(true);
    expect(result?.priceChanges.map((c) => c.storePrice)).toEqual([4999]);
    expect(env.navigations).toEqual([]);
  });

  it("stops for the visitor when the cart mixes currencies", async () => {
    const result = await mount(store([["a", 499], ["b", 299, "USD"]])).runCheckout([
      course("a", 499),
      course("b", 299, "USD"),
    ]);
    expect(result?.flagged.map((f) => f.issue)).toEqual(["otherCurrency"]);
    expect(env.navigations).toEqual([]);
  });

  it("opens the store checkout with the cart's courses when every price is as the cart showed it", async () => {
    const closeDrawer = vi.fn();
    await mount(store([["a", 4999], ["b", 999]]), closeDrawer).runCheckout([course("a", 4999), course("b", 999)]);
    expect(closeDrawer).toHaveBeenCalledTimes(1);
    expect(env.navigations).toEqual([
      {
        to: "/product-pages/$productPageCode",
        params: { productPageCode: STORE },
        search: { courseIds: "a,b", defaultTab: "CART", instituteId: INSTITUTE, tagName: "site", source: "siteCart" },
        replace: false,
      },
    ]);
  });

  it("goes straight on where prices are hidden — there is no price to confirm — but never with an item it cannot sell", async () => {
    env.hidePrices = true;
    await mount(store([["a", 4999]])).runCheckout([course("a", 2500)]);
    expect(env.navigations).toHaveLength(1);

    env.navigations = [];
    await mount(store([["a", 4999], ["b", 299, "USD"]])).runCheckout([course("a", 4999), course("b", 299, "USD")]);
    expect(env.navigations).toEqual([]);
  });
});
