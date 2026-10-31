// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The opt-in site theme on the catalogue's chrome wrapper (product pages):
 * theme.palette / theme.contentMaxWidth become CSS variables on the wrapper;
 * a site without them keeps a wrapper with no style attribute at all. Plus
 * the font pairing the Brahm Varchas design uses (Lato + Noto Sans Devanagari
 * at 400/700), loaded by the shared registry for a site offering हिन्दी.
 */

const mocks = vi.hoisted(() => ({ catalogue: null as unknown }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: "/p/offer" } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: "/p/offer", searchStr: "", search: {}, hash: "", href: "/p/offer" };
    return opts?.select ? opts.select(location) : location;
  },
}));
vi.mock("react-i18next", async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key: string) => key, i18n: undefined }),
}));
vi.mock("./JsonRenderer", () => ({ JsonRenderer: () => null }));
vi.mock("../-services/course-catalogue-service", () => ({
  CourseCatalogueService: { getCourseCatalogueByTag: async () => mocks.catalogue },
}));

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogueChrome } from "./CatalogueChrome";
import { buildGoogleFontsUrl, collectConfigFontFamilies } from "../-utils/catalogue-fonts";

const h = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

const HINDI = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: {},
};

const renderChrome = async (globalSettings: Record<string, unknown>) => {
  mocks.catalogue = { pages: [], globalSettings };
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      h(QueryClientProvider, { client }, h(CatalogueChrome, { tagName: "site", instituteId: "inst", children: h("p", null, "offer") })),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return host.querySelector("[data-catalogue-theme]") as HTMLElement;
};

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("CatalogueChrome site theme", () => {
  it("has no style attribute for a site without palette or content width", async () => {
    const wrapper = await renderChrome({ theme: { preset: "default" } });
    expect(wrapper).not.toBeNull();
    expect(wrapper.hasAttribute("style")).toBe(false);
  });

  it("keeps only the primary colour (set as before) when the theme has one but no palette", async () => {
    const wrapper = await renderChrome({ theme: { preset: "default", primaryColor: "#883000" } }); // design-lint-ignore
    const names = Array.from(wrapper.style).filter((n) => n.startsWith("--"));
    expect(names.some((n) => n.startsWith("--palette-") || n.includes("content-max"))).toBe(false);
  });

  it("sets the palette and content-width vars when the site opts in", async () => {
    const wrapper = await renderChrome({
      theme: { palette: { text: "#1a1208", applyToTokens: true }, contentMaxWidth: 1152 }, // design-lint-ignore
    });
    expect(wrapper.style.getPropertyValue("--palette-text")).toBe("33.3 52.9% 6.7%");
    expect(wrapper.style.getPropertyValue("--catalogue-text-primary")).toBe("33.3 52.9% 6.7%");
    expect(wrapper.style.getPropertyValue("--catalogue-content-max")).toBe("1216px");
    expect(wrapper.style.getPropertyValue("--site-content-max")).toBe("1152px");
  });

  it("loads Lato and Noto Sans Devanagari at 400 and 700 for a हिन्दी site that picks Lato", async () => {
    const gs = { i18n: HINDI, fonts: { enabled: true, family: "Lato, sans-serif" } };
    await renderChrome(gs);
    const url = decodeURIComponent(buildGoogleFontsUrl([...collectConfigFontFamilies({ globalSettings: gs }), "Noto Sans Devanagari"])!);
    expect(url).toMatch(/family=Lato:wght@[0-9;]*400[0-9;]*700/);
    expect(url).toMatch(/family=Noto Sans Devanagari:wght@[0-9;]*400[0-9;]*700/);
    const link = document.getElementById("catalogue-fonts") as HTMLLinkElement | null;
    expect(link && decodeURIComponent(link.href)).toContain("Lato:wght@300;400;700");
    // Latin in Lato; Devanagari reaches the Noto face before any generic family.
    const stack = document.body.style.fontFamily;
    expect(stack.startsWith("Lato")).toBe(true);
    expect(stack.indexOf("Noto Sans Devanagari")).toBeGreaterThan(0);
    expect(stack.indexOf("Noto Sans Devanagari")).toBeLessThan(stack.indexOf("sans-serif"));
  });
});
