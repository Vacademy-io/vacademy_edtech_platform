// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A site's own headings for the Level / Session filters ("Format" where the
 * institute calls levels "Categories"): only a site that sets them changes,
 * the plural wins, and a हिन्दी page shows the dictionary's word or nothing
 * (the caller then keeps the institute's term) — never the English one.
 */

const h = vi.hoisted(() => ({ search: "" }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    latestLocation: { search: {} },
    history: { push: () => {}, replace: () => {}, location: { href: `/site${h.search}` } },
  }),
  useLocation: (opts?: { select?: (location: unknown) => unknown }) => {
    const location = { pathname: "/site", searchStr: h.search, search: {}, hash: "", href: `/site${h.search}` };
    return opts?.select ? opts.select(location) : location;
  },
}));

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { CatalogueLocaleProvider } from "./catalogue-locale";
import { CatalogueNamingProvider, useCatalogueFilterHeadings, type CatalogueNaming } from "./catalogue-naming";
import type { CatalogueI18nSettings } from "./catalogue-i18n";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SITE = (strings: Record<string, string>): CatalogueI18nSettings => ({
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: { hi: strings },
});

let root: Root | null = null;
let seen: { levels?: string; sessions?: string } = {};

const Probe = () => {
  seen = useCatalogueFilterHeadings();
  return null;
};

const render = async (settings: CatalogueI18nSettings | undefined, naming: CatalogueNaming | undefined) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      e(I18nextProvider, { i18n: i18next },
        e(CatalogueLocaleProvider, {
          settings,
          scope: "site",
          persist: false,
          children: e(CatalogueNamingProvider, { naming, children: e(Probe) }),
        })),
    );
  });
  return seen;
};

beforeAll(async () => {
  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LOCALES],
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    resources: { en: { common: {} }, hi: { common: {} } },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  h.search = "";
  seen = {};
});

describe("useCatalogueFilterHeadings", () => {
  it("leaves both headings to the institute when the site names neither", async () => {
    expect(await render(undefined, undefined)).toEqual({ levels: undefined, sessions: undefined });
    expect(await render(undefined, { course: "Programme" })).toEqual({ levels: undefined, sessions: undefined });
  });

  it("uses the site's word, plural first", async () => {
    expect(await render(undefined, { level: "Format", session: " Batch " })).toEqual({ levels: "Format", sessions: "Batch" });
    expect(await render(undefined, { level: "Format", levelPlural: "Formats", sessionPlural: "  " })).toEqual({
      levels: "Formats",
      sessions: undefined,
    });
  });

  it("shows the dictionary's word on a हिन्दी page, and nothing when it has none", async () => {
    h.search = "?lang=hi";
    expect(await render(SITE({ Format: "प्रारूप" }), { level: "Format", session: "Batch" })).toEqual({
      levels: "प्रारूप",
      sessions: undefined,
    });
  });

  it("keeps the base-language word on the English page of a site with languages", async () => {
    expect(await render(SITE({ Format: "प्रारूप" }), { level: "Format" })).toEqual({ levels: "Format", sessions: undefined });
  });
});
