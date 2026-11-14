// @vitest-environment jsdom
/**
 * The opt-in header looks (site-chrome-types.ts HeaderChromeProps), rendered
 * for real: compact 64px bar, 1280px container, logo only, editorial nav with
 * the open mega menu underlined, the editorial mega panel, the segmented
 * language switch and the cart icon only once the cart has items. The
 * no-props case is pinned byte-for-byte by chrome-default-golden.test.ts and
 * header-component.render.test.ts.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { pathname: "/new/courses", searchStr: "", search: {}, href: "/new/courses", hash: "" },
  fetchTree: vi.fn(),
  cartItems: [] as Array<{ id: string }>,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
  useRouter: () => ({ history: { push: vi.fn(), replace: vi.fn() } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, a?: unknown, b?: unknown) => {
      const opts = (typeof a === "object" && a) || (typeof b === "object" && b) || {};
      const o = opts as Record<string, unknown>;
      const text = typeof a === "string" ? a : typeof o.defaultValue === "string" ? o.defaultValue : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String(o[k] ?? ""));
    },
  }),
}));
vi.mock("@/constants/urls", () => ({ BASE_URL: "https://api.test", urlCourseDetails: "https://api.test/v2/search" }));
vi.mock("@/hooks/use-domain-routing", () => ({
  useDomainRouting: () => ({
    instituteId: "inst-1",
    instituteName: "Test Institute",
    instituteLogoFileId: null,
    homeIconClickRoute: null,
  }),
}));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: vi.fn(async () => null) }));
vi.mock("@/services/domain-routing", () => ({ getCachedRootCatalogueTag: () => null }));
vi.mock("../../-stores/cart-store", () => ({
  useCartStore: () => ({ getItemCountByMode: async () => 0, items: [], syncCart: async () => {} }),
}));
vi.mock("@/hooks/useIsIOS", () => ({ isIOSPlatform: () => false }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "web" } }));
vi.mock("@/lib/auth/sessionUtility", () => ({ getAccessToken: async () => null, isTokenExpired: () => true }));
vi.mock("@/components/announcements", () => ({ SystemAlertsBar: () => null }));
vi.mock("@/components/common/layout-container/sidebar/logoutSidebar", () => ({ LogoutSidebar: () => null }));
vi.mock("@/components/common/layout-container/sidebar/useSidebar", () => ({
  default: () => ({ setSidebarOpen: vi.fn() }),
}));
vi.mock("@/components/common/auth/modal/AuthModal", () => ({ AuthModal: () => null }));
vi.mock("@/services/student-display-settings", () => ({
  getStudentDisplaySettings: async () => ({ signup: { enabled: true, presentation: "page" } }),
}));
vi.mock(
  "../../-services/folder-library-service",
  async (importOriginal: () => Promise<Record<string, unknown>>) => ({
    ...(await importOriginal()),
    fetchPublicFolderTree: mocks.fetchTree,
  }),
);
// The site cart: its items are under test control; the drawer is not under test.
vi.mock("../site-cart/use-site-cart", () => ({
  useSiteCart: () => ({ items: mocks.cartItems, hydrated: true }),
}));
vi.mock("../site-cart/SiteCartDrawer", () => ({
  SiteCartDrawer: ({ open }: { open: boolean }) =>
    React.createElement("div", { "data-testid": "drawer", "data-open": String(open) }),
}));
vi.mock("../site-cart/pending-purchases", () => ({ reconcilePendingPurchases: async () => {} }));
vi.mock("../site-cart/payment-status", () => ({ fetchPaymentOutcome: async () => null }));

import { HeaderComponent } from "../components/HeaderComponent";
import { CatalogueLocaleProvider } from "../../-utils/catalogue-locale";
import { openSiteCartDrawer } from "../site-cart/site-cart-events";
import { EDITORIAL_SEARCH_ICON } from "./header-chrome";

const h = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const I18N = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
};

const HEADER_PROPS = {
  logo: "https://cdn.test/logo.png",
  title: "Brahm Varchas",
  navigation: [
    {
      label: "Knowledge Streams",
      route: "/courses",
      type: "megaMenu" as const,
      megaMenu: {
        libraryId: "lib-1",
        eyebrow: "Six streams of knowledge",
        helpLabel: "Not sure where to begin? Find your path",
        helpRoute: "/learning-paths",
        footnote: "Coming soon subjects: click to be notified when they launch.",
      },
    },
    { label: "Courses", route: "courses" },
    { label: "Learning Paths", route: "learning-paths" },
    { label: "Resources", route: "https://example.test/blogs/" },
  ],
  authLinks: [
    { label: "Login", route: "login", style: "text" },
    { label: "Become a member", route: "signup", style: "primary" },
  ],
  showSearch: true,
  showLanguageSwitcher: true,
};

const CHROME = {
  barSize: "compact",
  contentWidth: "contained",
  navStyle: "editorial",
  logoOnly: true,
  languageSwitcherStyle: "segmented",
  cartDisplay: "whenNotEmpty",
  megaMenuStyle: "editorial",
};

const TREE = {
  library: { id: "lib-1", name: "Streams" },
  roots: [
    {
      id: "edu",
      node_type: "FOLDER",
      title: "शिक्षा",
      subtitle: "Education",
      tagline: "Learn the Indian way of learning.",
      description: "Subjects in their shastriya order.",
      accent_color: "#ff0000", // design-lint-ignore: fixture folder colour
      children: [{ id: "g", node_type: "FOLDER", title: "गुरुकुल शिक्षा", subtitle: "Gurukul Education", children: [] }],
    },
    { id: "kala", node_type: "FOLDER", title: "कला", subtitle: "Skills | Craft", children: [] },
  ],
};

let container: HTMLDivElement;
let root: Root;

const render = async (props: Record<string, unknown>) => {
  const settings = {
    courseCatalogeType: { enabled: false, value: "Course" },
    i18n: I18N,
    siteCart: { enabled: true, storeProductPageCode: "store" },
    layout: { header: { id: "h", type: "header", enabled: true, props } },
  };
  const catalogue = {
    globalSettings: settings,
    pages: [
      { id: "home", route: "", title: "Home", components: [] },
      { id: "courses", route: "courses", title: "Courses", components: [] },
    ],
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      h(
        QueryClientProvider,
        { client },
        h(CatalogueLocaleProvider, {
          settings: I18N,
          scope: "new",
          persist: false,
          children: h(HeaderComponent as unknown as React.FC<Record<string, unknown>>, {
            tagName: "new",
            instituteId: "inst-1",
            catalogueData: catalogue,
            globalSettings: settings,
            ...props,
          }),
        } as never),
      ),
    );
  });
  await flush();
};

const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};
const click = async (el: Element) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const buttonByText = (text: string, scope: ParentNode = container) =>
  Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;

beforeEach(() => {
  mocks.location = { pathname: "/new/courses", searchStr: "", search: {}, href: "/new/courses", hash: "" };
  mocks.fetchTree.mockResolvedValue(TREE);
  mocks.cartItems = [];
});

afterEach(async () => {
  vi.clearAllMocks();
  await act(async () => root.unmount());
  container.remove();
});

describe("header with the design's opt-in props", () => {
  it("compact 64px bar in a 1280px container, logo only", async () => {
    await render({ ...HEADER_PROPS, ...CHROME });
    const header = container.querySelector("header")!;
    expect(header.className).toContain("border-palette-border");
    const outer = header.querySelector(":scope > div")!;
    expect(outer.className).toContain("xl:px-20");
    const row = outer.firstElementChild!;
    expect(row.className).toContain(" h-16 ");
    expect(row.className).not.toContain("md:h-20");
    expect(row.className).toContain("max-w-screen-xl xl:px-16");
    const logo = header.querySelector("img")!;
    expect(logo.className).toContain("h-12 max-h-12");
    expect(logo.className).not.toContain("md:max-h-16");
    // logoOnly: the authored title is not shown next to the logo.
    expect(header.textContent).not.toContain("Brahm Varchas");
  });

  it("editorial nav: 32px apart, the current page bold gold, 13px auth links and an 8px button", async () => {
    await render({ ...HEADER_PROPS, ...CHROME });
    const nav = container.querySelector("nav")!;
    expect(nav.className).toContain("gap-8");
    const courses = buttonByText("Courses", nav);
    expect(courses.className).toContain("font-bold text-palette-gold");
    expect(buttonByText("Learning Paths", nav).className).toContain("font-normal text-palette-text");
    // The mega trigger is not lit by its route (/courses) — only while open.
    const trigger = nav.querySelector("[aria-controls]")!;
    expect(trigger.className).toContain("text-palette-text");
    expect(buttonByText("Login").className).toContain("text-[13px]"); // design-lint-ignore: asserts the exact Figma class
    expect(buttonByText("Become a member").className).toContain("rounded-[8px]"); // design-lint-ignore: asserts the exact Figma class
    expect(buttonByText("Become a member").parentElement!.className).toContain("gap-4");
    // Line search icon in the palette olive.
    const search = container.querySelector('[aria-haspopup="dialog"]')!;
    expect(search.className).toContain("text-palette-olive");
    expect(search.querySelector("svg")!.getAttribute("class")).toBe(EDITORIAL_SEARCH_ICON);
  });

  it("opening the mega menu underlines its label and shows the editorial panel over a dimmed page", async () => {
    await render({ ...HEADER_PROPS, ...CHROME });
    const trigger = container.querySelector("nav [aria-controls]")!;
    await click(trigger);
    await flush();
    expect(trigger.className).toContain("font-bold text-palette-gold");
    expect(trigger.className).toContain("gap-1.5");
    expect(trigger.querySelector(".bg-palette-accent")).not.toBeNull();
    // Figma 0:29: a 10×6 chevron, up and in the accent while open.
    const chevron = trigger.querySelector(":scope > svg")!;
    expect(chevron.getAttribute("viewBox")).toBe("0 0 10 6");
    expect(chevron.getAttribute("class")).toContain("h-1.5 w-2.5");
    expect(chevron.getAttribute("class")).toContain("rotate-180 text-palette-accent");
    const panel = container.querySelector('[role="region"]')!;
    expect(panel.className).toContain("rounded-b-3xl");
    expect(panel.className).toContain("border-palette-border");
    expect(panel.previousElementSibling!.className).toContain("bg-palette-text/35");
    expect(panel.textContent).toContain("Six streams of knowledge");
    // 120px stream tiles; the selected one in cream with the accent border.
    const tiles = panel.querySelectorAll("ul li > button, ul li > a");
    expect(tiles[0].className).toContain("border-palette-accent bg-palette-cream");
    expect(tiles[0].querySelector(".size-\\[120px\\]")).not.toBeNull();
    // Detail box: tagline, CTA and the category row.
    expect(panel.querySelector(".bg-palette-cream.p-8")!.textContent).toContain("Learn the Indian way of learning.");
    expect(panel.textContent).toContain("Gurukul Education");
    expect(panel.textContent).toContain("Coming soon subjects");
    // The detail button keeps a keyboard focus ring.
    expect(Array.from(panel.querySelectorAll("a, button")).some((x) => x.className.includes("focus-visible:ring-2"))).toBe(true);
    // Closing removes the underline again.
    await click(trigger);
    expect(trigger.querySelector(".bg-palette-accent")).toBeNull();
    expect(trigger.querySelector(":scope > svg")!.getAttribute("class")).not.toContain("rotate-180");
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it("segmented हिन्दी | EN with the active half filled", async () => {
    await render({ ...HEADER_PROPS, ...CHROME });
    const group = container.querySelector('header [role="group"]')!;
    expect(group.className).toContain("rounded-[8px]"); // design-lint-ignore: asserts the exact Figma class
    const [hi, en] = Array.from(group.querySelectorAll("button"));
    expect([hi.textContent, en.textContent]).toEqual(["हिन्दी", "EN"]);
    expect(en.getAttribute("aria-pressed")).toBe("true");
    expect(en.className).toContain("bg-palette-sand text-palette-primary");
    expect(hi.className).not.toContain("bg-palette-sand");
  });

  it("cart icon only once the cart has an item; the drawer opens either way", async () => {
    await render({ ...HEADER_PROPS, ...CHROME });
    const cart = container.querySelector('[aria-label="Open cart"]')!;
    expect(cart.className).toContain("hidden");
    // "Add whole path to cart" / Buy now still reach the drawer.
    await act(async () => {
      openSiteCartDrawer();
    });
    expect(container.querySelector('[data-testid="drawer"]')!.getAttribute("data-open")).toBe("true");
    await act(async () => root.unmount());
    container.remove();
    mocks.cartItems = [{ id: "c1" }];
    await render({ ...HEADER_PROPS, ...CHROME });
    const withItem = container.querySelector('[aria-haspopup="dialog"][aria-label^="Open cart"]')!;
    expect(withItem.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it("without the props: the original bar, nav, switch and an always-visible cart", async () => {
    await render(HEADER_PROPS);
    const header = container.querySelector("header")!;
    expect(header.className).toContain("border-catalogue-border-subtle");
    expect(header.querySelector(":scope > div > div")!.className).toContain("h-16 md:h-20");
    expect(container.querySelector("nav")!.className).toBe("hidden lg:flex items-center gap-1");
    expect(header.textContent).toContain("Brahm Varchas");
    expect(container.querySelector('header [role="group"]')!.className).toContain("rounded-full");
    expect(container.querySelector('[aria-label="Open cart"]')!.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    await click(container.querySelector("nav [aria-controls]")!);
    await flush();
    const panel = container.querySelector('[role="region"]')!;
    expect(panel.className).toContain("rounded-b-catalogue-2xl");
    // The original bold 14px caret, not the editorial chevron.
    expect(container.querySelector("nav [aria-controls] > svg")!.getAttribute("class")).toContain("size-3.5");
    expect(panel.previousElementSibling?.className ?? "").not.toContain("bg-palette-text/35");
  });
});
