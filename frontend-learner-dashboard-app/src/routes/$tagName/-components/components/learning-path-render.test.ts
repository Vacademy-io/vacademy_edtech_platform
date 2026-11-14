import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── environment stubs (node, no router / browser) ──────────────────────────
vi.mock("@/constants/urls", () => ({
  BASE_URL: "",
  GET_PRODUCT_PAGE_BY_CODE: (code: string, id: string) => `/by-code?code=${code}&instituteId=${id}`,
  VALIDATE_PRODUCT_PAGE_COUPON: "",
  PRODUCT_PAGE_FORM_SUBMIT: "",
  PRODUCT_PAGE_ENROLL: "",
  PRODUCT_PAGE_CPO_ENROLL: "",
  PEYMENT_LOG_STATUS_URL: "",
}));

const interpolate = (text: string, vars: Record<string, unknown> = {}) =>
  text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ""));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) =>
      typeof opts === "string"
        ? opts
        : opts?.defaultValue
          ? interpolate(String(opts.defaultValue), opts)
          : key === "productPageOffer.free"
            ? "Free"
            : key,
    i18n: { language: "en" },
  }),
}));

// The query string the mocked router reports (?lang= picks the site language).
const routerState = vi.hoisted(() => ({ searchStr: "" }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string | undefined>;
    children?: React.ReactNode;
    className?: string;
  }) => {
    const path = to.replace(/\$(\w+)/g, (_, k: string) => params?.[k] ?? "");
    const qs = new URLSearchParams(
      Object.entries(search || {}).filter((e): e is [string, string] => typeof e[1] === "string"),
    ).toString();
    return React.createElement("a", { href: qs ? `${path}?${qs}` : path, className }, children);
  },
  useLocation: () => ({ pathname: "/courses", searchStr: routerState.searchStr }),
  useRouter: () => ({ history: { push: () => {}, replace: () => {} } }),
  useNavigate: () => () => Promise.resolve(),
}));

vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: () => "Course",
  getTerminologyPlural: () => "Courses",
}));
vi.mock("@/utils/ios-iap-compliance", () => ({ shouldHidePaidPurchaseUI: () => false }));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: () => Promise.resolve("") }));

// A store page that fails to load cannot be staged on a server render (the
// query would retry on mount), so that state is set here when a test needs it.
type StoreSale = import("../site-cart/store-sale").StoreSale;
const storeOverride = vi.hoisted(() => ({ current: null as StoreSale | null }));
vi.mock("../site-cart/use-store-sale", async (importOriginal: () => Promise<unknown>) => {
  const real = (await importOriginal()) as typeof import("../site-cart/use-store-sale");
  return {
    ...real,
    useStoreSale: (...args: Parameters<typeof real.useStoreSale>) => {
      const sale = real.useStoreSale(...args);
      return storeOverride.current ?? sale;
    },
  };
});

const { LearningPathComponent } = await import("./LearningPathComponent");
const { SiteCartButton } = await import("../site-cart/SiteCartButton");
const { useSiteCartStore } = await import("../../-stores/site-cart-store");
const { CatalogueLocaleProvider } = await import("../../-utils/catalogue-locale");

// ─── fixtures ───────────────────────────────────────────────────────────────
const INSTITUTE = "inst-1";
const CODE = "PATH1";

const mapping = (pkg: string, ps: string, level: string, price: number, order: number) => ({
  id: `m-${ps}`,
  ps_invite_payment_option_id: `b-${ps}`,
  package_session_id: ps,
  package_id: pkg,
  package_name: `Course ${pkg.toUpperCase()}`,
  level_name: level,
  session_name: "default",
  status: "ACTIVE",
  display_order: order,
  payment_plan: { actual_price: price, elevated_price: price, currency: "INR" },
});

const page = {
  id: "page-1",
  code: CODE,
  name: "Shiksha basics",
  mappings: [
    // Server order is not display order: the select sorts it.
    mapping("c2", "c2-hi", "Hindi", 300, 2),
    mapping("c1", "c1-en", "English", 500, 0),
    mapping("c1", "c1-hi", "Hindi", 400, 1),
  ],
};

/** The site's store page, selling these versions (seeded where the store has loaded). */
const STORE = "STORE";
const storePage = (ids: string[]) => ({
  id: "store",
  code: STORE,
  name: "Store",
  mappings: ids.map((id, n) => ({
    id: `s-${id}`,
    package_session_id: id,
    status: "ACTIVE",
    display_order: n,
    payment_plan: { actual_price: 100, currency: "INR" },
  })),
});
const SELLS_ALL = ["c1-en", "c1-hi", "c2-hi"];

const render = (
  props: Record<string, unknown>,
  pageData: Record<string, unknown> = page,
  storeSells: string[] | null = null,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) => {
  client.setQueryData(["PRODUCT_PAGE_BY_CODE", CODE, INSTITUTE], pageData);
  if (storeSells) client.setQueryData(["PRODUCT_PAGE_BY_CODE", STORE, INSTITUTE], storePage(storeSells));
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(LearningPathComponent, { instituteId: INSTITUTE, tagName: "site", ...props }),
    ),
  );
};

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const grouped = { courseLanguages: { enabled: true } };

describe("learningPath (single)", () => {
  it("shows the courses as numbered steps in display order, one step per course", () => {
    const lines = text(render({ productPageCode: CODE, globalSettings: grouped }));
    expect(lines).toContain("Shiksha basics");
    const c1 = lines.indexOf("Course C1");
    const c2 = lines.indexOf("Course C2");
    expect(c1).toBeGreaterThan(-1);
    expect(c2).toBeGreaterThan(c1);
    expect(lines.filter((l) => l === "Course C1")).toHaveLength(1);
    // The two-version course offers both language chips.
    expect(lines).toContain("EN");
    expect(lines).toContain("हिं");
    expect(lines).toContain("2 courses");
  });

  it("without a site cart, enrols through the path's product page with every course", () => {
    const html = render({ productPageCode: CODE, globalSettings: grouped });
    expect(html).toContain("Enrol in this path");
    expect(html).toContain("/product-pages/PATH1?instituteId=inst-1&amp;tagName=site&amp;courseIds=c1-en%2Cc2-hi&amp;defaultTab=CART");
    expect(html).not.toContain("Add whole path to cart");
  });

  it("with a site cart, offers to add the whole path to it", () => {
    const html = render(
      {
        productPageCode: CODE,
        addAllLabel: "",
        globalSettings: { ...grouped, siteCart: { enabled: true, storeProductPageCode: "STORE" } },
      },
      page,
      SELLS_ALL,
    );
    expect(html).toContain("Add whole path to cart");
    expect(html).not.toContain("Enrol in this path");
  });

  it("keeps one step per version when the site does not group versions", () => {
    const lines = text(render({ productPageCode: CODE, globalSettings: {} }));
    expect(lines.filter((l) => l === "Course C1")).toHaveLength(2);
    expect(lines).toContain("3 courses");
  });

  it("renders nothing for visitors until configured, and a hint in the builder preview", () => {
    expect(render({ productPageCode: "" })).toBe("");
    expect(render({ productPageCode: "", isPreviewMode: true })).toContain("Pick the product page");
  });

  it("without a site cart, totals the path the way its product page charges it (basket price)", () => {
    const priced = {
      ...page,
      settings_json: JSON.stringify({ basketPricing: { enabled: true, ladder: { prices: [399, 649], perExtra: 200 } } }),
    };
    const lines = text(render({ productPageCode: CODE, globalSettings: grouped }, priced));
    // Two courses (C1 in English, C2): 500 + 300 = 800 list, 649 at checkout.
    expect(lines.some((l) => l.includes("649"))).toBe(true);
    expect(lines.some((l) => l.includes("800"))).toBe(true);
  });
});

describe("learningPath title in the site's language", () => {
  const i18n = {
    enabled: true,
    defaultLocale: "en",
    locales: [
      { code: "en", label: "EN" },
      { code: "hi", label: "हिन्दी" },
    ],
    strings: { hi: { "JEE Store": "जेईई स्टोर", "Shiksha basics": "शिक्षा की बुनियाद" } },
  };
  /** The section inside the site's language provider, in `lang` (?lang=). */
  const renderIn = (lang: string, props: Record<string, unknown>, pageData: Record<string, unknown>) => {
    routerState.searchStr = lang ? `?lang=${lang}` : "";
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(["PRODUCT_PAGE_BY_CODE", CODE, INSTITUTE], pageData);
      return renderToStaticMarkup(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(CatalogueLocaleProvider, {
            settings: i18n,
            scope: "site",
            persist: false,
            children: React.createElement(LearningPathComponent, { instituteId: INSTITUTE, tagName: "site", ...props }),
          }),
        ),
      );
    } finally {
      routerState.searchStr = "";
    }
  };
  // The cached name is data the renderer leaves as stored (catalogue-i18n), so
  // the component puts it through the dictionary itself.
  const cachedOnly = { productPageCode: CODE, productPageName: "JEE Store", globalSettings: grouped };
  const unnamedPage = { ...page, name: "" };

  it("shows the picked page's cached name in Hindi when neither a heading nor the page's name is there", () => {
    const lines = text(renderIn("hi", cachedOnly, unnamedPage));
    expect(lines).toContain("जेईई स्टोर");
    expect(lines).not.toContain("JEE Store");
  });

  it("shows it as stored in the base language, and the page's own name first when it has one", () => {
    expect(text(renderIn("", cachedOnly, unnamedPage))).toContain("JEE Store");
    const named = text(renderIn("hi", cachedOnly, page));
    expect(named).toContain("शिक्षा की बुनियाद");
    expect(named).not.toContain("जेईई स्टोर");
  });
});

describe("learningPath and the site cart", () => {
  // Server rendering reads zustand's server snapshot — the store's INITIAL
  // state — so the visitor's cart is seeded there (and restored after).
  const initial = useSiteCartStore.getInitialState();
  const pristine = { ...initial };
  const seedCart = (ids: string[]) =>
    Object.assign(initial, {
      instituteId: INSTITUTE,
      hydrated: true,
      items: ids.map((id) => ({ packageSessionId: id, courseId: id.split("-")[0]!, title: id })),
    });
  afterEach(() => {
    Object.assign(initial, pristine);
  });

  const siteCart = { siteCart: { enabled: true, storeProductPageCode: "STORE" } };
  const ONE_PER_COURSE = "Your cart holds one version of each course, so 2 of these go into it.";

  it("explains that two versions of one course go into the cart as one", () => {
    seedCart([]);
    const lines = text(render({ productPageCode: CODE, addAllLabel: "", globalSettings: siteCart }, page, SELLS_ALL));
    expect(lines).toContain("3 courses");
    expect(lines).toContain(ONE_PER_COURSE);
    expect(lines).toContain("Add whole path to cart");
  });

  it("settles once the cart holds one version of each course (the button never flips back)", () => {
    // What one "Add whole path to cart" leaves in the cart for this path.
    seedCart(["c1-en", "c2-hi"]);
    const html = render({ productPageCode: CODE, globalSettings: siteCart }, page, SELLS_ALL);
    expect(html).toContain("Whole path is in your cart");
    expect(html).not.toContain("Add the remaining");
  });

  it("keeps the version already in the cart and adds only the rest", () => {
    seedCart(["c1-hi"]);
    const html = render({ productPageCode: CODE, globalSettings: siteCart }, page, SELLS_ALL);
    expect(html).toContain("Add the remaining 1 to cart");
    // The step in the cart wears the selected ring.
    expect(html).toContain("ring-primary-500/35");
  });

  it("says nothing about versions when every step is a different course", () => {
    seedCart([]);
    expect(render({ productPageCode: CODE, globalSettings: { ...grouped, ...siteCart } }, page, SELLS_ALL)).not.toContain(
      "one version of each",
    );
  });
});

describe("learningPath and the site's store page", () => {
  const initial = useSiteCartStore.getInitialState();
  const pristine = { ...initial };
  afterEach(() => {
    Object.assign(initial, pristine);
    storeOverride.current = null;
  });
  const settings = { ...grouped, siteCart: { enabled: true, storeProductPageCode: STORE } };
  const OWN_CHECKOUT =
    "/product-pages/PATH1?instituteId=inst-1&amp;tagName=site&amp;courseIds=c1-en%2Cc2-hi&amp;defaultTab=CART";

  it("keeps the path's own checkout when the store does not sell every chosen course", () => {
    Object.assign(initial, { instituteId: INSTITUTE, hydrated: true, items: [] });
    // The store sells C1 in English, not C2.
    const html = render({ productPageCode: CODE, addAllLabel: "", globalSettings: settings }, page, ["c1-en", "c1-hi"]);
    expect(html).toContain("Enrol in this path");
    expect(html).toContain(OWN_CHECKOUT);
    expect(html).not.toContain("Add whole path to cart");
    expect(html).not.toContain("Checking availability");
  });

  it("goes by the versions the visitor chose", () => {
    // C1 shows in English (the visitor's language); the store sells only its Hindi version.
    expect(render({ productPageCode: CODE, globalSettings: settings }, page, ["c1-hi", "c2-hi"])).toContain(
      "Enrol in this path",
    );
    // A version nobody chose does not stand in the way.
    expect(render({ productPageCode: CODE, globalSettings: settings }, page, ["c1-en", "c2-hi"])).toContain(
      "Add whole path to cart",
    );
  });

  it("offers neither action, nor a total, while the store page loads", () => {
    const html = render({ productPageCode: CODE, addAllLabel: "", globalSettings: settings });
    const lines = text(html);
    expect(lines).toContain("Checking availability…");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"/);
    expect(html).not.toContain("Add whole path to cart");
    expect(html).not.toContain("Enrol in this path");
    expect(lines).not.toContain("Total shown at checkout");
    expect(html).toContain("catalogue-skeleton-shimmer");
  });

  it("falls back to the path's own checkout when the store page cannot load", () => {
    storeOverride.current = { status: "error", sells: () => false, lists: () => false };
    const html = render({ productPageCode: CODE, addAllLabel: "", globalSettings: settings });
    expect(html).toContain("Enrol in this path");
    expect(html).toContain(OWN_CHECKOUT);
    expect(html).not.toContain("Add whole path to cart");
  });

  it("adds the path to the cart when its page is the store page itself, even with a course listed twice", () => {
    Object.assign(initial, { instituteId: INSTITUTE, hydrated: true, items: [] });
    // The store lists C1 in English twice (two plans): its own checkout would
    // select both and charge C1 twice; the cart's pre-check holds it back.
    const storeAsPath = {
      ...page,
      code: STORE,
      mappings: [...page.mappings, { ...mapping("c1", "c1-en", "English", 450, 3), id: "m-c1-en-b", ps_invite_payment_option_id: "b-c1-en-b" }],
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["PRODUCT_PAGE_BY_CODE", STORE, INSTITUTE], storeAsPath);
    const html = render({ productPageCode: STORE, addAllLabel: "", globalSettings: settings }, page, null, client);
    expect(html).toContain("Add whole path to cart");
    expect(html).not.toContain("Enrol in this path");
    expect(html).not.toContain("/product-pages/STORE?");
  });

  it("keeps the path's own checkout for a course the store lists twice when the path's page sells it as it is", () => {
    Object.assign(initial, { instituteId: INSTITUTE, hydrated: true, items: [] });
    const html = render({ productPageCode: CODE, addAllLabel: "", globalSettings: settings }, page, ["c1-en", "c1-en", "c2-hi"]);
    expect(html).toContain("Enrol in this path");
    expect(html).toContain(OWN_CHECKOUT);
    expect(html).not.toContain("Add whole path to cart");
  });

  it("reads no store page on a site without a site cart", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = render({ productPageCode: CODE, globalSettings: grouped }, page, null, client);
    expect(html).toContain("Enrol in this path");
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys.some((k) => k.includes(STORE))).toBe(false);
    expect(keys.filter((k) => k[0] === "PRODUCT_PAGE_BY_CODE" && k[1])).toEqual([["PRODUCT_PAGE_BY_CODE", CODE, INSTITUTE]]);
  });

  it("asks the store page once a site cart is on (the checkout reuses it)", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render({ productPageCode: CODE, globalSettings: settings }, page, SELLS_ALL, client);
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(["PRODUCT_PAGE_BY_CODE", STORE, INSTITUTE]);
  });
});

describe("learningPath (list): the cards", () => {
  const LIBRARY = "lib-1";
  const pathNode = (id: string, code: string, extra: Record<string, unknown> = {}) => ({
    id,
    node_type: "PRODUCT_PAGE",
    product_page_code: code,
    title: `Path ${id}`,
    description: `About ${id}`,
    children: [],
    ...extra,
  });
  const renderList = (nodes: Record<string, unknown>[]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["FOLDER_LIBRARY_PUBLIC", INSTITUTE, LIBRARY], {
      library: { id: LIBRARY, name: "Library" },
      roots: [{ id: "f1", node_type: "FOLDER", title: "Shiksha", children: nodes }],
    });
    return renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(LearningPathComponent, {
          instituteId: INSTITUTE,
          tagName: "site",
          mode: "list",
          libraryId: LIBRARY,
          viewPathLabel: "Open path",
        }),
      ),
    );
  };
  const cardOf = (html: string, title: string) => {
    const at = html.indexOf(`>${title}<`);
    return html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at));
  };

  it("shows the item's own subtitle, tagline, button label and accent colour", () => {
    const html = renderList([
      pathNode("a", "PA", {
        subtitle: "Foundations",
        tagline: "Start with the basics",
        cta_label: "Begin path",
        accent_color: "#f59e0b", // design-lint-ignore: test fixture colour
      }),
    ]);
    const card = cardOf(html, "Path a");
    const lines = text(card);
    expect(lines).toEqual(["Shiksha", "Path a", "Foundations", "Start with the basics", "About a", "Begin path"]);
    expect(card).toContain('aria-label="Begin path — Path a"');
    expect(card).toContain("background-color:#f59e0b"); // design-lint-ignore: test fixture colour
    expect(card).not.toContain("bg-catalogue-bg-muted");
  });

  it("renders a card without them exactly as before", () => {
    const html = renderList([pathNode("b", "PB"), pathNode("c", "PC", { accent_color: "javascript:alert(1)" })]);
    for (const title of ["Path b", "Path c"]) {
      const card = cardOf(html, title);
      expect(text(card)).toEqual(["Shiksha", title, `About ${title.slice(-1)}`, "Open path"]);
      expect(card).toContain(`aria-label="Open path — ${title}"`);
      expect(card).not.toContain("style=");
      expect(card).toContain('<div class="relative aspect-[16/9] w-full bg-catalogue-bg-muted">');
    }
  });
});

describe("SiteCartButton", () => {
  const button = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        React.createElement(SiteCartButton, { instituteId: INSTITUTE, tagName: "site", ...props }),
      ),
    );

  it("renders nothing on a site without a site cart", () => {
    expect(button({})).toBe("");
    expect(button({ settings: { enabled: true } })).toBe("");
    expect(button({ settings: { enabled: false, storeProductPageCode: "STORE" } })).toBe("");
    expect(button({ instituteId: "", settings: { enabled: true, storeProductPageCode: "STORE" } })).toBe("");
  });

  it("renders the cart icon button when the site has one", () => {
    const html = button({ settings: { enabled: true, storeProductPageCode: "STORE" } });
    expect(html).toContain('aria-label="Open cart"');
    expect(html).toContain('aria-haspopup="dialog"');
  });
});
