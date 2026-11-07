// @vitest-environment jsdom
/**
 * The default (non-editorial) mega menu panel renders exactly as before.
 *
 * __golden__/mega-menu-default-panel.html was generated from the code BEFORE
 * the editorial mega menu existed (bv/foundation, a3c963c5ac), when the
 * panel's rows were still inline in MegaMenuNavItem. They now come from
 * panelContent(), shared with the editorial panel; this pins the eyebrow row,
 * the help link, the stream tiles, the detail with its categories and legend,
 * and the footnote byte-for-byte. Never regenerate it: a failure here means
 * another institute's mega menu changed.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  location: { pathname: "/new/about", searchStr: "", search: {}, href: "/new/about", hash: "" },
  fetchTree: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
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
vi.mock("../site-cart/use-site-cart", () => ({ useSiteCart: () => ({ items: [], hydrated: true }) }));
vi.mock("../site-cart/SiteCartDrawer", () => ({ SiteCartDrawer: () => null }));
vi.mock("../site-cart/pending-purchases", () => ({ reconcilePendingPurchases: async () => {} }));
vi.mock("../site-cart/payment-status", () => ({ fetchPaymentOutcome: async () => null }));

import { HeaderComponent } from "../components/HeaderComponent";

const h = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HEADER_PROPS = {
  logo: "https://cdn.test/logo.png",
  title: "Test Institute",
  navigation: [
    {
      label: "Streams",
      route: "/courses",
      type: "megaMenu" as const,
      megaMenu: {
        libraryId: "lib-1",
        eyebrow: "Six streams of knowledge",
        helpLabel: "Not sure where to begin? Find your path",
        helpRoute: "/learning-paths",
        footnote: "Coming soon subjects: click to be notified when they launch.",
        showLegend: true,
      },
    },
    { label: "Courses", route: "courses" },
  ],
  authLinks: [{ label: "Login", route: "login", style: "text" }],
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
      children: [
        { id: "g", node_type: "FOLDER", title: "गुरुकुल शिक्षा", subtitle: "Gurukul Education", description: "How the gurukul educated.", children: [] },
        { id: "s", node_type: "FOLDER", title: "संस्कृत", subtitle: "Sanskrit", coming_soon: true, audience_id: "aud-1", children: [] },
      ],
    },
    { id: "kala", node_type: "FOLDER", title: "कला", subtitle: "Skills | Craft", children: [] },
    { id: "veda", node_type: "FOLDER", title: "वेद", subtitle: "Vedas", coming_soon: true, audience_id: "aud-2", children: [] },
  ],
};

let container: HTMLDivElement;
let root: Root;

const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// React's useId values depend on how many ids the tree asked for before;
// they are not part of the markup a visitor sees.
const normalizeIds = (html: string) => html.replace(/[:«]r[0-9a-z]+[:»]/g, ":id:");

describe("default mega menu panel (no megaMenuStyle / navStyle)", () => {
  it("renders the open panel exactly as before the editorial look", async () => {
    mocks.fetchTree.mockResolvedValue(TREE);
    const settings = {
      courseCatalogeType: { enabled: false, value: "Course" },
      layout: { header: { id: "h", type: "header", enabled: true, props: HEADER_PROPS } },
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
          h(HeaderComponent as unknown as React.FC<Record<string, unknown>>, {
            tagName: "new",
            instituteId: "inst-1",
            catalogueData: catalogue,
            globalSettings: settings,
            ...HEADER_PROPS,
          }),
        ),
      );
    });
    await flush();
    const trigger = container.querySelector("nav [aria-controls]") as HTMLElement;
    await act(async () => trigger.click());
    await flush();
    const panel = container.querySelector('[role="region"]')!;
    expect(panel.textContent).toContain("Gurukul Education");
    await expect(normalizeIds(trigger.outerHTML + "\n" + panel.outerHTML) + "\n").toMatchFileSnapshot(
      "../__golden__/mega-menu-default-panel.html",
    );
  });
});
