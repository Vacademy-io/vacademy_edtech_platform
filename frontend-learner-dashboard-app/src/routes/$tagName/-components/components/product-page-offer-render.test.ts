import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
  Link: ({
    to,
    params,
    search,
    children,
    className,
  }: {
    to?: string;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
    children?: React.ReactNode;
    className?: string;
  }) => {
    const path = (to || "").replace(/\$(\w+)/g, (_, k: string) => params?.[k] ?? "");
    const qs = new URLSearchParams(
      Object.entries(search || {}).filter((e): e is [string, string] => typeof e[1] === "string"),
    ).toString();
    return React.createElement("a", { href: qs ? `${path}?${qs}` : path, className }, children);
  },
  useLocation: () => ({ pathname: "/", searchStr: "" }),
  useRouter: () => ({ history: { push: () => {}, replace: () => {} } }),
  useNavigate: () => () => Promise.resolve(),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: () => "Course",
  getTerminologyPlural: () => "Courses",
}));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => false }));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: () => Promise.resolve("") }));

// States a server render cannot stage: a store page that failed to load (the
// query would retry on mount) and a visitor reading the site in Hindi.
type StoreSale = import("../site-cart/store-sale").StoreSale;
const overrides = vi.hoisted(() => ({
  store: null as StoreSale | null,
  locale: null as { enabled: boolean; locale: string; baseLocale: string } | null,
}));
vi.mock("../site-cart/use-store-sale", async (importOriginal: () => Promise<unknown>) => {
  const real = (await importOriginal()) as typeof import("../site-cart/use-store-sale");
  return {
    ...real,
    useStoreSale: (...args: Parameters<typeof real.useStoreSale>) => {
      const sale = real.useStoreSale(...args);
      return overrides.store ?? sale;
    },
  };
});
vi.mock("../../-utils/catalogue-locale", async (importOriginal: () => Promise<unknown>) => {
  const real = (await importOriginal()) as typeof import("../../-utils/catalogue-locale");
  return {
    ...real,
    useCatalogueLocale: () => {
      const value = real.useCatalogueLocale();
      return overrides.locale ? { ...value, ...overrides.locale } : value;
    },
  };
});

const { ProductPageOfferComponent } = await import("./ProductPageOfferComponent");
const { useSiteCartStore } = await import("../../-stores/site-cart-store");
const { registerSiteCartOpener } = await import("../site-cart/site-cart-events");

const INSTITUTE = "inst-1";
const CODE = "OFFER";
const mapping = (ps: string, pkg: string, order: number) => ({
  id: `m-${ps}`,
  ps_invite_payment_option_id: `b-${ps}`,
  package_session_id: ps,
  package_id: pkg,
  package_name: `Course ${pkg}`,
  level_name: "English",
  status: "ACTIVE",
  display_order: order,
  payment_plan: { actual_price: 100, currency: "INR" },
});

const STORE = "STORE";
/** The site's store page, selling these versions (seeded where the store has loaded). */
const storePage = (ids: string[]) => ({
  id: "store",
  code: STORE,
  name: "Store",
  mappings: ids.map((id, n) => ({ ...mapping(id, `pkg-${id}`, n), id: `s-${id}` })),
});

const render = (
  props: Record<string, unknown>,
  storeSells: string[] | null = null,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) => {
  client.setQueryData(["PRODUCT_PAGE_BY_CODE", CODE, INSTITUTE], {
    id: "p",
    code: CODE,
    name: "Offer",
    settings_json: null,
    mappings: [mapping("ps-2", "B", 1), mapping("ps-1", "A", 0)],
  });
  if (storeSells) client.setQueryData(["PRODUCT_PAGE_BY_CODE", STORE, INSTITUTE], storePage(storeSells));
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(ProductPageOfferComponent, {
        productPageCode: CODE,
        instituteId: INSTITUTE,
        enableCart: true,
        showSearch: false,
        ...props,
      }),
    ),
  );
};

const addedCount = (html: string) => (html.match(/productPageOffer\.added/g) || []).length;

describe("productPageOffer and the site cart", () => {
  // Server rendering reads zustand's server snapshot — the store's INITIAL
  // state object — so the visitor's cart is seeded there (and restored after).
  const initial = useSiteCartStore.getInitialState();
  const pristine = { ...initial };
  beforeEach(() => {
    // A visitor whose site cart already holds course A.
    Object.assign(initial, {
      instituteId: INSTITUTE,
      hydrated: true,
      items: [{ packageSessionId: "ps-1", courseId: "A", title: "Course A" }],
    });
  });
  afterEach(() => {
    Object.assign(initial, pristine);
  });

  it("ignores the site cart on a site without one (its own basket, as before)", () => {
    const html = render({});
    expect(addedCount(html)).toBe(0);
    expect(html).not.toContain("productPageOffer.selectedCount");
  });

  it("shows the site cart's courses as added when the site has a site cart", () => {
    const html = render({ globalSettings: { siteCart: { enabled: true, storeProductPageCode: "STORE" } } }, ["ps-1", "ps-2"]);
    expect(addedCount(html)).toBe(1);
    expect(html).toContain("productPageOffer.selectedCount");
  });

  it("lists courses in display order", () => {
    const html = render({});
    expect(html.indexOf("Course A")).toBeLessThan(html.indexOf("Course B"));
  });

  const siteCart = { siteCart: { enabled: true, storeProductPageCode: "STORE" } };

  it("offers its own way to the cart on a page without a header cart button", () => {
    const html = render({ globalSettings: siteCart }, ["ps-1", "ps-2"]);
    expect(html).toContain("View cart (1)");
  });

  it("leaves the cart to the header when the page has a header cart button", () => {
    const unregister = registerSiteCartOpener(() => {});
    try {
      expect(render({ globalSettings: siteCart }, ["ps-1", "ps-2"])).not.toContain("View cart (");
    } finally {
      unregister();
    }
  });

  it("never shows the site cart's way in on a site without one", () => {
    expect(render({})).not.toContain("View cart (");
  });
});

describe("productPageOffer, the site cart and its store page", () => {
  const initial = useSiteCartStore.getInitialState();
  const pristine = { ...initial };
  beforeEach(() => {
    Object.assign(initial, { instituteId: INSTITUTE, hydrated: true, items: [] });
  });
  afterEach(() => {
    Object.assign(initial, pristine);
    overrides.store = null;
    overrides.locale = null;
  });
  const siteCart = { siteCart: { enabled: true, storeProductPageCode: STORE } };
  /** The card CTA for course B (ps-2): its own product page's checkout. */
  const OWN_CHECKOUT_B = "/product-pages/OFFER?instituteId=inst-1&amp;tagName=site&amp;courseIds=ps-2&amp;defaultTab=CART";
  const addCount = (html: string) => (html.match(/common\.addToCart/g) || []).length;
  const enrolCount = (html: string) => (html.match(/>productPageOffer\.enrolNow</g) || []).length;

  it("adds a course the store sells to the site cart, and links any other to this page's checkout", () => {
    const html = render({ globalSettings: siteCart, tagName: "site" }, ["ps-1"]);
    expect(addCount(html)).toBe(1);
    expect(enrolCount(html)).toBe(1);
    expect(html).toContain(`href="${OWN_CHECKOUT_B}"`);
    expect(html.indexOf("Course A")).toBeLessThan(html.indexOf("common.addToCart"));
    expect(html.indexOf("common.addToCart")).toBeLessThan(html.indexOf(OWN_CHECKOUT_B));
  });

  it("carries the visitor's language to that checkout", () => {
    overrides.locale = { enabled: true, locale: "hi", baseLocale: "en" };
    const html = render({ globalSettings: siteCart, tagName: "site" }, ["ps-1"]);
    expect(html).toContain(`href="${OWN_CHECKOUT_B}&amp;lang=hi"`);
  });

  it("offers no action while the store page loads", () => {
    const html = render({ globalSettings: siteCart, tagName: "site" });
    expect((html.match(/aria-label="Checking availability…"/g) || []).length).toBe(2);
    expect(addCount(html)).toBe(0);
    expect(enrolCount(html)).toBe(0);
  });

  it("links every course to this page's checkout when the store page cannot load", () => {
    overrides.store = { status: "error", sells: () => false, lists: () => false };
    const html = render({ globalSettings: siteCart, tagName: "site" });
    expect(enrolCount(html)).toBe(2);
    expect(addCount(html)).toBe(0);
    expect(html).toContain(`href="${OWN_CHECKOUT_B}"`);
  });

  /** The store page listing course A (ps-1) twice — two plans, say — and course B once. */
  const STORE_LISTING_A_TWICE = {
    id: "store",
    code: STORE,
    name: "Store",
    mappings: [
      { ...mapping("ps-1", "A", 0), id: "s-1a", ps_invite_payment_option_id: "plan-1a" },
      { ...mapping("ps-1", "A", 1), id: "s-1b", ps_invite_payment_option_id: "plan-1b" },
      { ...mapping("ps-2", "B", 2), id: "s-2" },
    ],
  };

  it("adds a course the store lists twice to the site cart when the section shows the store page itself", () => {
    // Its own checkout would select both of A's plans and charge it twice;
    // the cart's pre-check holds A back and says why instead.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["PRODUCT_PAGE_BY_CODE", STORE, INSTITUTE], STORE_LISTING_A_TWICE);
    const html = render({ productPageCode: STORE, globalSettings: siteCart, tagName: "site" }, null, client);
    expect(addCount(html)).toBe(3);
    expect(enrolCount(html)).toBe(0);
    expect(html).not.toContain("/product-pages/STORE?");
  });

  it("links a course the store lists twice to this page's checkout when this page sells it as it is", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["PRODUCT_PAGE_BY_CODE", STORE, INSTITUTE], STORE_LISTING_A_TWICE);
    const html = render({ globalSettings: siteCart, tagName: "site" }, null, client);
    expect(addCount(html)).toBe(1);
    expect(enrolCount(html)).toBe(1);
    expect(html).toContain(
      'href="/product-pages/OFFER?instituteId=inst-1&amp;tagName=site&amp;courseIds=ps-1&amp;defaultTab=CART"',
    );
  });

  it("keeps its own basket, reads no store page and links nothing new on a site without a site cart", () => {
    overrides.locale = { enabled: true, locale: "hi", baseLocale: "en" };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = render({ tagName: "site" }, null, client);
    expect(addCount(html)).toBe(2);
    expect(html).not.toContain("Checking availability");
    expect(html).not.toContain("lang=");
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys.some((k) => k.includes(STORE))).toBe(false);
    // Without the cart switched on, each course enrols on its own — as before.
    const plain = render({ tagName: "site", enableCart: false, globalSettings: siteCart });
    expect(enrolCount(plain)).toBe(2);
    expect(plain).toContain(`href="${OWN_CHECKOUT_B}"`);
    expect(plain).not.toContain("lang=");
  });
});
