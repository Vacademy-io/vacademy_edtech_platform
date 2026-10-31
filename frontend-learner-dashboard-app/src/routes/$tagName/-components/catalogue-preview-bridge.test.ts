// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CourseCataloguePage as the editor's Website preview (?preview=true inside
 * the editor's iframe), in a real router:
 *
 * - it obeys only the frame that embeds it: a message from any other window
 *   cannot paint a made-up site onto the institute's domain; not framed (the
 *   headless AI preview) it takes the draft the page posts to itself;
 * - framed, it always shows a "Preview" ribbon;
 * - no form sends from it (no real leads from an editor trying the form);
 * - Browse mode (PREVIEW_INTERACT) reaches the renderer, and a link or a
 *   navigation to another page asks the editor to open that page instead of
 *   leaving the preview;
 * - the page's real route (previewPath) reaches the renderer for the header.
 */

const h = vi.hoisted(() => ({
  catalogue: null as unknown,
  /** Props of every JsonRenderer render, newest last. */
  renders: [] as Array<Record<string, unknown>>,
  /** React submit handlers of the forms the stand-in renderer shows. */
  leadSubmit: vi.fn(),
  searchSubmit: vi.fn(),
}));

vi.mock("@/services/domain-routing", () => ({ getCachedRootCatalogueTag: () => null }));
vi.mock("@/hooks/use-domain-routing", () => ({
  useDomainRouting: () => ({ instituteName: "Acme Academy", instituteThemeCode: null }),
}));
vi.mock("../-services/course-catalogue-service", () => ({
  CourseCatalogueService: {
    getCourseCatalogueByTag: async () => h.catalogue,
    getCourseCatalogueByTagMemo: async () => h.catalogue,
  },
}));
vi.mock("../-utils/institute-naming-seed", () => ({ useInstituteNamingSettings: () => true }));
vi.mock("react-i18next", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key: string) => key, i18n: undefined }),
}));
vi.mock("@/components/common/layout-container/sidebar/utils", () => ({
  getTerminology: (_term: string, fallback: string) => fallback,
  getTerminologyPlural: (_term: string, fallback: string) => `${fallback}s`,
}));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: async () => null }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {} },
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "web" } }));
vi.mock("@/lib/auth/sessionUtility", () => ({ getTokenFromStorage: async () => null }));
vi.mock("@/components/core/dashboard-loader", () => ({ DashboardLoader: () => null }));
vi.mock("../-utils/catalogue-tracking", () => ({
  useCatalogueTracking: () => {},
  useCataloguePageView: () => {},
  captureUtmOnce: () => {},
}));
vi.mock("../-utils/resource-unlock", () => ({ useResourceTrackingContext: () => {} }));
vi.mock("../-utils/catalogue-fonts", () => ({ collectConfigFontFamilies: () => [], ensureFontsLoaded: () => {} }));
vi.mock("./JsonRenderer", async () => {
  const { createElement } = await import("react");
  return {
    JsonRenderer: (props: { page: { id: string; title?: string } }) => {
      h.renders.push(props as unknown as Record<string, unknown>);
      return createElement(
        "section",
        { "data-page": props.page.id },
        props.page.title,
        createElement("a", { href: "/site/about", "data-testid": "about" }, "About"),
        createElement("a", { href: "#faq", "data-testid": "jump" }, "FAQ"),
        createElement("a", { href: "/site/courses#faq", "data-testid": "courses-faq" }, "Courses FAQ"),
        createElement("form", { "data-testid": "lead", onSubmit: h.leadSubmit }),
        createElement("form", { role: "search", "data-testid": "search", onSubmit: h.searchSubmit }),
      );
    },
  };
});
vi.mock("./IntroPageComponent", () => ({ IntroPageComponent: () => null }));
vi.mock("./LeadCollectionModal", () => ({ LeadCollectionModal: () => null }));
vi.mock("./AudienceFormModal", () => ({ AudienceFormModal: () => null }));
vi.mock("./MobileActionBar", () => ({ MobileActionBar: () => null }));
vi.mock("./WhatsAppFloatingButton", () => ({ WhatsAppFloatingButton: () => null }));
vi.mock("./CourseFinderWizard", () => ({ CourseFinderWizard: () => null }));

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from "@tanstack/react-router";
import { CourseCataloguePage } from "./CourseCataloguePage";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const site = (title: string) => ({
  catalogueId: "cat-1",
  globalSettings: { leadCollection: { enabled: false, mandatory: false, fields: [] } },
  pages: [
    { id: "home", route: "homepage", title, components: [] },
    { id: "about", route: "about", title: "About", components: [] },
  ],
});

const makeRouter = () => {
  const rootRoute = createRootRoute();
  const page = (path: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: function CatalogueHome() {
        const { tagName = "" } = useParams({ strict: false }) as { tagName?: string };
        return e(CourseCataloguePage, { tagName, instituteId: "inst-1" });
      },
    });
  return createRouter({
    routeTree: rootRoute.addChildren([page("$tagName/"), page("$tagName/$courseId/")]),
    // Browser history (as the app): memory history ignores blockers.
    history: createBrowserHistory(),
  });
};

let root: Root | null = null;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(tick);
};

/** The editor's window: what the page posts to it, and how it sends messages. */
const editor = { postMessage: vi.fn() };
const realParent = Object.getOwnPropertyDescriptor(window, "parent")!;
const fromEditor = (data: unknown, source: unknown = editor, origin = "https://dash.vacademy.io") =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: source as Window, origin }));
  });
const posted = (type: string) =>
  editor.postMessage.mock.calls.filter((call: unknown[]) => (call[0] as { type?: string })?.type === type);
const lastRender = () => h.renders[h.renders.length - 1] ?? {};

const mount = async () => {
  const router = makeRouter();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(e(RouterProvider, { router } as unknown as React.ComponentProps<typeof RouterProvider>));
  });
  await settle();
  return { router, host };
};

beforeEach(() => {
  h.catalogue = site("Published home");
  h.renders = [];
  h.leadSubmit.mockReset();
  h.searchSubmit.mockReset();
  editor.postMessage.mockReset();
  window.history.replaceState({}, "", "/site/?preview=true");
  Object.defineProperty(window, "parent", { configurable: true, value: editor });
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  await act(tick);
  document.body.innerHTML = "";
  Object.defineProperty(window, "parent", realParent);
  window.history.replaceState({}, "", "/");
});

describe("who may drive the preview", () => {
  it("announces itself to the embedding editor and shows the posted draft", async () => {
    const { host } = await mount();
    expect(posted("PREVIEW_READY")).toHaveLength(1);
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: site("Draft home") });
    expect(host.querySelector('[data-page="home"]')?.textContent).toContain("Draft home");
    // The editor's frame gets the editor's marks.
    expect(lastRender().previewChrome).toBe(true);
  });

  it("ignores a draft posted by any other window", async () => {
    const { host } = await mount();
    const stranger = { postMessage: vi.fn() };
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: site("Fake site") }, stranger);
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: site("Fake site") }, window);
    expect(host.textContent).toContain("Published home");
    expect(host.textContent).not.toContain("Fake site");
  });

  it("not framed (the headless AI preview), takes the draft the page posts to itself, from no one else", async () => {
    Object.defineProperty(window, "parent", { configurable: true, value: window });
    const { host } = await mount();
    const stranger = { postMessage: vi.fn() };
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: site("Fake site") }, stranger, window.location.origin);
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: site("Fake site") }, window, "https://evil.example");
    expect(host.textContent).toContain("Published home");
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: site("Draft home") }, window, window.location.origin);
    expect(host.querySelector('[data-page="home"]')?.textContent).toContain("Draft home");
    // Shot as visitors see it: no ribbon, no hidden-block strips or block frames.
    expect(host.textContent).not.toContain("courseCataloguePage.previewRibbon");
    expect(lastRender().previewChrome).toBe(false);
    expect(lastRender().isPreviewMode).toBe(true);
  });

  it("answers the editor's HELLO with READY (its frame reloaded)", async () => {
    await mount();
    fromEditor({ type: "PREVIEW_HELLO" });
    expect(posted("PREVIEW_READY")).toHaveLength(2);
  });

  it("strips script from the posted draft's HTML text", async () => {
    await mount();
    const draft = site("Draft home");
    (draft.pages[0] as Record<string, unknown>).components = [
      { id: "t", type: "textBlock", props: { content: '<img src="x" onerror="alert(1)">' } },
    ];
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: draft });
    const page = lastRender().page as { components: Array<{ props: { content: string } }> };
    expect(page.components[0]!.props.content).not.toContain("onerror");
  });

  it("always shows the Preview ribbon in a framed preview, never on the live site", async () => {
    const { host } = await mount();
    expect(host.textContent).toContain("courseCataloguePage.previewRibbon");
    act(() => root?.unmount());
    window.history.replaceState({}, "", "/site/");
    const live = await mount();
    expect(live.host.textContent).not.toContain("courseCataloguePage.previewRibbon");
  });
});

describe("selection and the page shown", () => {
  it("passes the real route of the shown page on, for the header's active item", async () => {
    await mount();
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: site("Courses"), previewPath: "courses" });
    expect(lastRender().previewPath).toBe("courses");
  });

  it("posts a picked nested block with its parent, to the editor's origin", async () => {
    await mount();
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: site("Draft home") });
    const onComponentClick = lastRender().onComponentClick as (id: string, pageId: string, parentId?: string) => void;
    act(() => onComponentClick("inner", "home", "cols"));
    expect(posted("COMPONENT_SELECTED")).toEqual([
      [{ type: "COMPONENT_SELECTED", componentId: "inner", pageId: "home", parentId: "cols" }, "https://dash.vacademy.io"],
    ]);
  });
});

describe("Browse mode", () => {
  it("turns on and off from the editor", async () => {
    await mount();
    expect(lastRender().previewInteractive).toBe(false);
    fromEditor({ type: "PREVIEW_INTERACT", on: true });
    expect(lastRender().previewInteractive).toBe(true);
    fromEditor({ type: "PREVIEW_INTERACT", on: false });
    expect(lastRender().previewInteractive).toBe(false);
  });

  it("a link to another page asks the editor to open it instead of leaving", async () => {
    const { host } = await mount();
    fromEditor({ type: "PREVIEW_INTERACT", on: true });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      host.querySelector('[data-testid="about"]')!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(posted("PREVIEW_NAVIGATE")).toEqual([
      [{ type: "PREVIEW_NAVIGATE", route: "about", href: `${window.location.origin}/site/about` }, "https://dash.vacademy.io"],
    ]);
  });

  it("a link to the page being shown jumps within it instead", async () => {
    const { host } = await mount();
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: site("Courses"), previewPath: "courses" });
    fromEditor({ type: "PREVIEW_INTERACT", on: true });
    const target = document.createElement("div");
    target.id = "faq";
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      host.querySelector('[data-testid="courses-faq"]')!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(posted("PREVIEW_NAVIGATE")).toHaveLength(0);
  });

  it("an in-page jump still scrolls the page", async () => {
    const { host } = await mount();
    fromEditor({ type: "PREVIEW_INTERACT", on: true });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      host.querySelector('[data-testid="jump"]')!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(posted("PREVIEW_NAVIGATE")).toHaveLength(0);
  });

  it("navigation from code to another page is held and handed to the editor", async () => {
    const { router } = await mount();
    fromEditor({ type: "PREVIEW_INTERACT", on: true });
    // A held navigation never settles, so it is not awaited.
    act(() => {
      void router.navigate({ to: "/site/about" } as never);
    });
    await settle();
    expect(router.state.location.pathname).toMatch(/^\/site\/?$/);
    expect(window.location.pathname).toMatch(/^\/site\/?$/);
    expect(posted("PREVIEW_NAVIGATE")).toEqual([
      [{ type: "PREVIEW_NAVIGATE", route: "about", href: "/site/about" }, "https://dash.vacademy.io"],
    ]);
  });

  it("the header's Home or logo (same page, no ?preview) opens the home page and stays a preview", async () => {
    const { router } = await mount();
    fromEditor({ type: "PREVIEW_INTERACT", on: true });
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: site("Courses"), previewPath: "courses" });
    act(() => {
      void router.navigate({ to: "/site" } as never);
    });
    await settle();
    expect(window.location.search).toContain("preview=true");
    expect(posted("PREVIEW_NAVIGATE")).toEqual([
      [{ type: "PREVIEW_NAVIGATE", route: "", href: "/site" }, "https://dash.vacademy.io"],
    ]);
    expect(lastRender().isPreviewMode).toBe(true);
    expect(lastRender().onComponentClick).toBeTypeOf("function");
  });

  it("a query change that keeps ?preview (a tab, a filter) stays on the page", async () => {
    const { router } = await mount();
    fromEditor({ type: "PREVIEW_INTERACT", on: true });
    await act(async () => {
      await router.navigate({ to: "/site", search: { preview: true, tab: 2 } } as never);
    });
    await settle();
    expect(window.location.search).toContain("tab=2");
    expect(posted("PREVIEW_NAVIGATE")).toHaveLength(0);
  });

  it("stays a preview even if the address loses ?preview (it is the document's, read once)", async () => {
    const { router } = await mount();
    await act(async () => {
      await router.navigate({ to: "/site", search: { tab: 1 } } as never);
    });
    await settle();
    expect(window.location.search).not.toContain("preview");
    fromEditor({ type: "CATALOGUE_CONFIG_UPDATE", payload: site("Draft home") });
    expect(lastRender().isPreviewMode).toBe(true);
  });

  it("a navigation that would replace the page (window.location from code) is held and handed over", async () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
    try {
      await mount();
      const leave = Object.assign(new Event("navigate", { cancelable: true }), {
        navigationType: "push",
        destination: { sameDocument: false, url: "https://elsewhere.example/" },
      });
      const routerMove = Object.assign(new Event("navigate", { cancelable: true }), {
        navigationType: "push",
        destination: { sameDocument: true, url: `${window.location.origin}/site/?preview=true&tab=2` },
      });
      act(() => {
        navigation.dispatchEvent(leave);
        navigation.dispatchEvent(routerMove);
      });
      expect(leave.defaultPrevented).toBe(true);
      expect(routerMove.defaultPrevented).toBe(false);
      expect(posted("PREVIEW_NAVIGATE")).toEqual([
        [{ type: "PREVIEW_NAVIGATE", route: null, href: "https://elsewhere.example/" }, "*"],
      ]);
    } finally {
      delete (window as { navigation?: unknown }).navigation;
    }
  });

  it("in Select mode links are untouched (the editor's click-through layer stops them)", async () => {
    const { host } = await mount();
    let preventedBefore: boolean | null = null;
    host.addEventListener("click", (event) => {
      preventedBefore = event.defaultPrevented;
      event.preventDefault(); // jsdom cannot follow the link
    });
    act(() => {
      host.querySelector('[data-testid="about"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(preventedBefore).toBe(false);
    expect(posted("PREVIEW_NAVIGATE")).toHaveLength(0);
  });
});

describe("forms in the preview", () => {
  const submit = (host: HTMLElement, testId: string) => {
    const event = new Event("submit", { bubbles: true, cancelable: true });
    act(() => {
      host.querySelector(`[data-testid="${testId}"]`)!.dispatchEvent(event);
    });
    return event;
  };

  it("never send (no real lead), and say so", async () => {
    const { host } = await mount();
    const event = submit(host, "lead");
    expect(event.defaultPrevented).toBe(true);
    expect(h.leadSubmit).not.toHaveBeenCalled();
    expect(host.textContent).toContain("courseCataloguePage.previewFormNotSent");
  });

  it("site search still works", async () => {
    const { host } = await mount();
    submit(host, "search");
    expect(h.searchSubmit).toHaveBeenCalled();
  });

  it("on the live site forms send as always", async () => {
    window.history.replaceState({}, "", "/site/");
    const { host } = await mount();
    submit(host, "lead");
    expect(h.leadSubmit).toHaveBeenCalled();
  });
});
