// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CatalogueChrome (the catalogue's header/footer/theme around product pages)
 * and the Devanagari face: a site offering हिन्दी gets the face both loaded
 * AND in the body font stack, whether or not it picked a catalogue font; a
 * site without languages keeps the page's font untouched.
 */

const mocks = vi.hoisted(() => ({
  catalogue: null as unknown,
  loadedFamilies: [] as string[][],
}));

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
vi.mock("../-utils/catalogue-fonts", () => ({
  collectConfigFontFamilies: () => [],
  ensureFontsLoaded: (families: string[]) => void mocks.loadedFamilies.push(families),
}));

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogueChrome } from "./CatalogueChrome";

const h = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HINDI = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: {},
};

let root: Root | null = null;

const renderChrome = async (globalSettings: Record<string, unknown>) => {
  mocks.catalogue = { pages: [], globalSettings };
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      h(
        QueryClientProvider,
        { client },
        h(CatalogueChrome, { tagName: "site", instituteId: "inst", children: h("p", null, "offer") }),
      ),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

/** The body stack as a list of family names, quotes dropped. */
const bodyFamilies = () =>
  document.body.style.fontFamily
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);

beforeEach(() => {
  document.body.style.fontFamily = "";
  mocks.loadedFamilies = [];
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe("CatalogueChrome fonts", () => {
  it("puts the Devanagari face it loads into the default stack when the site picked no font", async () => {
    await renderChrome({ i18n: HINDI, fonts: { enabled: false } });
    expect(mocks.loadedFamilies.flat()).toContain("Noto Sans Devanagari");
    const families = bodyFamilies();
    // Latin text keeps the brand font (first); Hindi reaches the Devanagari
    // face before any generic family.
    expect(families[0]).toBe("Figtree");
    expect(families).toContain("Noto Sans Devanagari");
    expect(families.indexOf("Noto Sans Devanagari")).toBeLessThan(families.indexOf("sans-serif"));
  });

  it("adds it after the site's own font when one is picked", async () => {
    await renderChrome({ i18n: HINDI, fonts: { enabled: true, family: "'Poppins', sans-serif" } });
    const families = bodyFamilies();
    expect(families[0]).toBe("Poppins");
    expect(families.indexOf("Noto Sans Devanagari")).toBeGreaterThan(0);
    expect(families.indexOf("Noto Sans Devanagari")).toBeLessThan(families.indexOf("sans-serif"));
  });

  it("leaves the page's font alone on a site without languages", async () => {
    await renderChrome({ fonts: { enabled: false } });
    expect(document.body.style.fontFamily).toBe("");
    expect(mocks.loadedFamilies).toEqual([]);
  });
});
