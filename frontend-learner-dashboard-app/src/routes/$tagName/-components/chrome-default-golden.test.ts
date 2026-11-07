// @vitest-environment jsdom
/**
 * Site chrome without the opt-in props renders exactly as before.
 *
 * The files under __golden__/chrome-*.html were generated from the code BEFORE
 * the opt-in chrome variants existed (header bar size / width / nav style /
 * segmented language switch / cart display / editorial mega menu, footer
 * "brand", ctaBanner "band", stepsProcess "cards", the newsletter hook). Never
 * regenerate them: a failure here means another institute's site changed.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  location: { pathname: "/site/about", searchStr: "", search: {}, href: "/site/about", hash: "" },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ tagName: "site" }),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: "/site/about" } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) =>
    opts?.select ? opts.select(mocks.location) : mocks.location,
  Link: () => null,
}));
vi.mock("react-i18next", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key: string, a?: unknown, b?: unknown) => {
      const opts = (typeof a === "object" && a) || (typeof b === "object" && b) || {};
      const o = opts as Record<string, unknown>;
      const text = typeof a === "string" ? a : typeof o.defaultValue === "string" ? o.defaultValue : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String(o[k] ?? ""));
    },
    i18n: undefined,
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
vi.mock("../-stores/cart-store", () => ({
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

import { JsonRenderer } from "./JsonRenderer";
import { CatalogueLocaleProvider } from "../-utils/catalogue-locale";

const h = React.createElement;
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

type Section = Record<string, unknown>;

const HEADER: Section = {
  id: "header-1",
  type: "header",
  enabled: true,
  props: {
    logo: "https://cdn.test/logo.png",
    title: "",
    backgroundColor: "#FFFFFF", // design-lint-ignore: fixture colour
    navigation: [
      { label: "Courses", route: "courses", openInSameTab: true },
      { label: "About", route: "about", openInSameTab: true },
      { label: "Blog", route: "https://blog.test/", openInSameTab: false },
    ],
    authLinks: [
      { label: "Login", route: "login", style: "text" },
      { label: "Join", route: "signup", style: "primary" },
    ],
    activeStyle: "underline",
    showSearch: true,
    showLanguageSwitcher: true,
  },
};

const PLAIN_HEADER: Section = {
  id: "header-2",
  type: "header",
  enabled: true,
  props: {
    navigation: [
      { label: "Home", route: "home" },
      { label: "About", route: "about" },
    ],
    authLinks: [{ label: "Get Started", route: "get-started" }],
  },
};

const FOOTER: Section = {
  id: "footer-1",
  type: "footer",
  enabled: true,
  props: {
    layout: "four-column",
    backgroundColor: "#F5EAC9", // design-lint-ignore: fixture colour
    leftSection: {
      title: "Test Institute",
      text: "<p>Learning for everyone.</p>",
      socials: [
        { platform: "YouTube", icon: "youtube", url: "https://youtube.test/x" },
        { platform: "Instagram", icon: "instagram", url: "https://instagram.test/x", openInSameTab: true },
      ],
    },
    rightSection1: {
      title: "Explore",
      links: [
        { label: "Courses", route: "/courses", openInSameTab: true },
        { label: "Blog", route: "https://blog.test/" },
      ],
    },
    rightSection2: { title: "Learn", links: [{ label: "E-books", route: "/courses?q=eBook" }] },
    rightSection3: { title: "Support", links: [{ label: "FAQ", route: "https://site.test/faq", openInSameTab: true }] },
    bottomNote: "© 2026 Test Institute.",
  },
};

const BANDS: Section[] = [
  {
    id: "cta-1",
    type: "ctaBanner",
    enabled: true,
    props: {
      layout: "split",
      backgroundColor: "#1A1208", // design-lint-ignore: fixture colour
      textColor: "#FFFFFF", // design-lint-ignore: fixture colour
      heading: "Not sure which course is right for you?",
      subheading: "Answer one question.",
      button: { enabled: true, text: "Find your path", action: "navigate", target: "/learning-paths", style: "white" },
    },
  },
  {
    id: "cta-2",
    type: "ctaBanner",
    enabled: true,
    props: {
      heading: "Talk to us",
      button: { enabled: true, text: "Talk", action: "openForm", audienceId: "aud-1", formTitle: "Talk to us" },
    },
  },
  {
    id: "steps-1",
    type: "stepsProcess",
    enabled: true,
    props: {
      headerText: "How a learning path works",
      backgroundColor: "#F5EAC9", // design-lint-ignore: fixture colour
      accentColor: "#883000", // design-lint-ignore: fixture colour
      steps: [
        { number: "1", title: "Start", description: "Step one." },
        { number: "2", title: "Learn", description: "Step two." },
        { number: "3", title: "Finish", description: "Step three." },
      ],
    },
  },
  {
    id: "steps-2",
    type: "stepsProcess",
    enabled: true,
    props: {
      headerText: "Timeline",
      variant: "timeline-cards",
      steps: [{ title: "One", description: "First", chips: ["a"] }],
    },
  },
  {
    id: "news-1",
    type: "newsletterSignup",
    enabled: true,
    props: { heading: "Stay connected", subheading: "Updates.", buttonText: "Subscribe", audienceId: "aud-2" },
  },
];

const I18N = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: { hi: {} },
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const renderPage = async (components: Section[], pageId = "about") => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = { id: pageId, route: pageId, title: pageId, components };
  await act(async () => {
    root!.render(
      h(
        QueryClientProvider,
        { client },
        h(CatalogueLocaleProvider, {
          settings: I18N as never,
          scope: "site",
          persist: false,
          children: h(JsonRenderer, {
            page,
            globalSettings: { i18n: I18N } as never,
            instituteId: "inst-1",
            tagName: "site",
            catalogueData: { globalSettings: { i18n: I18N, layout: { header: HEADER } }, pages: [page] } as never,
          } as never),
        } as never),
      ),
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  // React's generated ids differ between runs of a file; normalise them.
  return container.innerHTML.replace(/«r\w+»|:r\w+:/g, "«id»");
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  memoryStorage.clear();
});

describe("site chrome golden markup (no opt-in props)", () => {
  it("header with search, language switch and the underline style, on a page with a header", async () => {
    const html = await renderPage([HEADER]);
    await expect(html).toMatchFileSnapshot("./__golden__/chrome-header.html");
  });

  it("a plain header page keeps the original page offset", async () => {
    const html = await renderPage([PLAIN_HEADER]);
    await expect(html).toMatchFileSnapshot("./__golden__/chrome-header-plain.html");
  });

  it("footer (four columns, socials)", async () => {
    const html = await renderPage([FOOTER], "footer");
    await expect(html).toMatchFileSnapshot("./__golden__/chrome-footer.html");
  });

  it("CTA banners, steps and the newsletter section", async () => {
    const html = await renderPage(BANDS, "home");
    await expect(html).toMatchFileSnapshot("./__golden__/chrome-bands.html");
  });
});
