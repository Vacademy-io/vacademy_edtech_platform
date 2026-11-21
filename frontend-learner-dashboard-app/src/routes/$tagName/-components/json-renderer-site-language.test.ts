// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * JsonRenderer and the site language (हिन्दी / EN) + visibleWhen, rendered
 * for real (server markup; no JSX so the project's *.test.ts pattern picks it
 * up). Pins that a single-language page renders exactly as without the
 * feature, that authored props are localized (nested slot children too)
 * while the header still gets the authored values, and that visibleWhen hides
 * a section — or marks it, in the builder preview.
 */

const nav = vi.hoisted(() => ({ searchStr: "", forbidLocation: false, replace: vi.fn(), noHistoryLocation: false }));
// The ?lang= repair and real navigation are covered with a real router in
// -utils/catalogue-locale-provider.test.ts and catalogue-route-search.test.ts.
const captured = vi.hoisted(() => ({
  header: null as Record<string, unknown> | null,
  learningPath: null as Record<string, unknown> | null,
  /** How often the learning path module was loaded (the mock factory runs on first import). */
  learningPathLoads: 0,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ tagName: "site" }),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: {
      push: () => {},
      replace: nav.replace,
      location: nav.noHistoryLocation ? undefined : { href: `/site/courses${nav.searchStr}` },
    },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    if (nav.forbidLocation) throw new Error("this page must not subscribe to the URL");
    const location = { pathname: "/site/courses", searchStr: nav.searchStr, search: {}, hash: "" };
    return opts?.select ? opts.select(location) : location;
  },
  Link: () => null,
}));
vi.mock("react-i18next", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
    i18n: undefined,
  }),
}));
vi.mock("./components/HeaderComponent", () => ({
  HeaderComponent: (props: Record<string, unknown>) => {
    captured.header = props;
    return null;
  },
}));
vi.mock("./components/LearningPathComponent", () => {
  captured.learningPathLoads += 1;
  return {
    LearningPathComponent: (props: Record<string, unknown>) => {
      captured.learningPath = props;
      return null;
    },
  };
});

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JsonRenderer } from "./JsonRenderer";
import { CatalogueLocaleProvider } from "../-utils/catalogue-locale";
import type { CatalogueI18nSettings } from "../-utils/catalogue-i18n";

const h = React.createElement;

// An in-memory localStorage (the remembered site language is read from it).
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

const HINDI_SITE: CatalogueI18nSettings = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: {
    hi: {
      "Six streams of knowledge": "ज्ञान की छह धाराएँ",
      "Learn the Indian way of learning.": "सीखने का भारतीय तरीका।",
      "Start free": "मुफ़्त शुरू करें",
      "Explore Education": "शिक्षा देखें",
      Courses: "पाठ्यक्रम",
      "Get Started": "शुरू करें",
    },
  },
};

type Section = Record<string, unknown>;
const pageOf = (...components: Section[]) => ({ id: "courses", route: "courses", title: "Courses", components });
const heading = (id: string, title: string, extra: Section = {}): Section => ({
  id,
  type: "sectionHeading",
  enabled: true,
  props: { title },
  ...extra,
});

const renderPage = (
  components: Section[],
  opts: { settings?: CatalogueI18nSettings; provider?: boolean; isPreviewMode?: boolean } = {},
) => {
  const renderer = h(JsonRenderer, {
    page: pageOf(...components),
    globalSettings: {} as never,
    instituteId: "inst",
    tagName: "site",
    isPreviewMode: opts.isPreviewMode,
  } as never);
  return renderToString(
    opts.provider === false ? renderer : h(CatalogueLocaleProvider, { settings: opts.settings, scope: "site", children: renderer }),
  );
};

beforeEach(() => {
  nav.searchStr = "";
  nav.forbidLocation = false;
  nav.replace.mockReset();
  nav.noHistoryLocation = false;
  captured.header = null;
  captured.learningPath = null;
  localStorage.clear();
});

describe("a site without languages", () => {
  const page = [
    heading("intro", "Six streams of knowledge"),
    { id: "cta", type: "buttonBlock", enabled: true, props: { text: "Explore Education", url: "/courses?stream=shiksha" } },
    {
      id: "cols",
      type: "columnLayout",
      enabled: true,
      props: { slots: [[heading("inner", "Learn the Indian way of learning.")], []] },
    },
  ];

  it("renders without reading the URL when no section has visibleWhen rules", () => {
    nav.forbidLocation = true;
    const html = renderPage(page, { provider: false });
    expect(html).toContain("Six streams of knowledge");
    expect(html).toContain("Learn the Indian way of learning.");
  });

  it("renders the same markup with or without the language provider", () => {
    const bare = renderPage(page, { provider: false });
    expect(renderPage(page, { settings: undefined })).toBe(bare);
    // Languages switched off: the dictionary is ignored, even with ?lang=hi.
    nav.searchStr = "?lang=hi";
    expect(renderPage(page, { settings: { ...HINDI_SITE, enabled: false } })).toBe(bare);
  });
});

describe("a हिन्दी / EN site", () => {
  it("localizes authored props, nested slot children included", () => {
    nav.searchStr = "?lang=hi";
    const html = renderPage(
      [
        heading("intro", "Six streams of knowledge"),
        {
          id: "cols",
          type: "columnLayout",
          enabled: true,
          props: { slots: [[heading("inner", "Learn the Indian way of learning.")], []] },
        },
        { id: "cta", type: "buttonBlock", enabled: true, props: { text: "Explore Education", url: "/courses?stream=shiksha" } },
      ],
      { settings: HINDI_SITE },
    );
    expect(html).toContain("ज्ञान की छह धाराएँ");
    expect(html).toContain("सीखने का भारतीय तरीका।");
    expect(html).toContain("शिक्षा देखें");
    expect(html).not.toContain("Six streams of knowledge");
    // Links keep their authored target, and carry the language for crawlers.
    expect(html).toContain('href="/site/courses?stream=shiksha&amp;lang=hi"');
  });

  it("renders the base language when the visitor has not picked Hindi", () => {
    const html = renderPage([heading("intro", "Six streams of knowledge")], { settings: HINDI_SITE });
    expect(html).toContain("Six streams of knowledge");
  });

  it("gives the header the authored props next to the localized ones", () => {
    nav.searchStr = "?lang=hi";
    const props = {
      navigation: [{ label: "Courses", route: "/courses" }],
      authLinks: [{ label: "Get Started", route: "get-started" }],
    };
    renderPage([{ id: "header", type: "header", enabled: true, props }], { settings: HINDI_SITE });
    const header = captured.header as {
      navigation: Array<{ label: string; route: string }>;
      authLinks: Array<{ label: string }>;
      baseProps: typeof props;
    };
    expect(header.navigation[0]).toEqual({ label: "पाठ्यक्रम", route: "/courses" });
    expect(header.authLinks[0].label).toBe("शुरू करें");
    expect(header.baseProps).toBe(props);
  });

  it("passes the very same props to the header when there is nothing to translate", () => {
    const props = { navigation: [{ label: "Courses", route: "/courses" }] };
    renderPage([{ id: "header", type: "header", enabled: true, props }], { provider: false });
    const header = captured.header as { navigation: unknown; baseProps: unknown };
    expect(header.baseProps).toBe(props);
    expect(header.navigation).toBe(props.navigation);
  });
});

describe("visibleWhen", () => {
  const startFree = heading("free", "Start free", { visibleWhen: [{ param: "stream", op: "empty" }] });
  const always = heading("always", "Six streams of knowledge");

  it("shows the section for a URL its rules accept", () => {
    const html = renderPage([always, startFree], { provider: false });
    expect(html).toContain("Start free");
    expect(html).toContain("Six streams of knowledge");
  });

  it("skips the section — wrapper and all — for a URL its rules reject", () => {
    nav.searchStr = "?stream=shiksha";
    const html = renderPage([always, heading("free", "Start free", { visibleWhen: startFree.visibleWhen, style: { paddingTop: "lg" } })], {
      provider: false,
    });
    expect(html).not.toContain("Start free");
    expect(html).not.toContain('data-component-id="free"');
    expect(html).toContain("Six streams of knowledge");
  });

  it("applies to nested slot children too", () => {
    nav.searchStr = "?stream=shiksha";
    const html = renderPage(
      [{ id: "cols", type: "columnLayout", enabled: true, props: { slots: [[startFree], [always]] } }],
      { provider: false },
    );
    expect(html).not.toContain("Start free");
    expect(html).toContain("Six streams of knowledge");
  });

  it("keeps the section on the builder preview, marked as hidden for this URL", () => {
    nav.searchStr = "?stream=shiksha";
    const html = renderPage([always, startFree], { provider: false, isPreviewMode: true });
    expect(html).toContain("Start free");
    expect(html).toContain("Hidden for this URL");
    expect(html).toContain('data-component-id="free"');
  });

  it("does not mark visible sections in the preview", () => {
    const html = renderPage([always, startFree], { provider: false, isPreviewMode: true });
    expect(html).not.toContain("Hidden for this URL");
  });
});

describe("learningPath", () => {
  it("is not loaded by pages without a learning path section", () => {
    const html = renderPage([heading("intro", "Six streams of knowledge")], { provider: false });
    expect(html).toContain("Six streams of knowledge");
    expect(captured.learningPathLoads).toBe(0);
  });

  it("loads on demand and renders the section with the renderer's context", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(
        h(JsonRenderer, {
          page: pageOf({ id: "lp", type: "learningPath", enabled: true, props: { mode: "list", title: "Paths" } }),
          globalSettings: {} as never,
          instituteId: "inst",
          tagName: "site",
          isPreviewMode: true,
        } as never),
      );
    });
    // The section's code arrives asynchronously, behind its own boundary.
    for (let i = 0; i < 5 && !captured.learningPath; i++) {
      await act(async () => {
        await vi.dynamicImportSettled();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(captured.learningPathLoads).toBe(1);
    expect(captured.learningPath).toMatchObject({
      mode: "list",
      title: "Paths",
      instituteId: "inst",
      tagName: "site",
      isPreviewMode: true,
    });
    expect(captured.learningPath?.globalSettings).toEqual({});
    await act(async () => root.unmount());
  });
});

describe("a router stub without a history location", () => {
  it("mounts a हिन्दी site's provider without trying to repair anything", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    nav.noHistoryLocation = true;
    nav.searchStr = "?lang=hi";
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(h(CatalogueLocaleProvider, { settings: HINDI_SITE, scope: "site", children: h("p", null, "page") }));
    });
    expect(host.textContent).toBe("page");
    expect(nav.replace).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
