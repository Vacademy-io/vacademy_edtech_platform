// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The line under each plan tile ("2 courses included · 180 days access") on a
 * checkout inside a site with languages: a sentence of the site's language
 * around the site's course word — never "2 कोर्स included" — and, anywhere
 * else, exactly the English line it always was. Real en / hi terms and
 * productPages catalogs; the new planTiles keys added as listed for the
 * locale files.
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
import { CatalogueLocaleProvider } from "@/routes/$tagName/-utils/catalogue-locale";
import { CatalogueNamingProvider, type CatalogueNaming } from "@/routes/$tagName/-utils/catalogue-naming";
import type { CatalogueI18nSettings } from "@/routes/$tagName/-utils/catalogue-i18n";
import { PlanTiles } from "./PlanTiles";
import type { ProductPageData, ProductPageSettings } from "../-types/product-page-types";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realCatalog = (lng: string, ns: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../../locales/${lng}/${ns}.json`), "utf8"));

/**
 * The planTiles keys as they go into the locale files. English is left to
 * the defaults written in PlanTiles (its entries repeat them), so these
 * tests also hold the defaults to the English line.
 */
const PLAN_TILES_HI = { coursesIncluded: "{{count}} {{courses}} शामिल", oneCourse: "1 {{course}}" };

const HINDI_SITE: CatalogueI18nSettings = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: { hi: { Programme: "कार्यक्रम" } },
};

const plan = (id: string, validity: number | undefined) => ({
  id,
  name: id,
  status: "ACTIVE",
  validity_in_days: validity,
  actual_price: 100,
  elevated_price: 100,
  currency: "INR",
  description: "",
  tag: "",
});

const mapping = (id: string, planId: string, validity: number | undefined, packageSessionId: string) => ({
  id,
  ps_invite_payment_option_id: `option-${id}`,
  enroll_invite_id: "invite",
  package_session_id: packageSessionId,
  payment_option_id: "payment-option",
  payment_plan_id: planId,
  payment_plan: plan(planId, validity),
  preselected: false,
  display_order: 0,
  status: "ACTIVE",
});

/** Two plans that both sell English — real alternatives, so the tiles show. */
const PAGE = {
  currency: "INR",
  mappings: [
    mapping("a", "single", 365, "english"),
    mapping("b", "combo", 180, "english"),
    mapping("c", "combo", 180, "maths"),
  ],
} as unknown as ProductPageData;

const SETTINGS = { planSelector: { enabled: true } } as unknown as ProductPageSettings;

let root: Root | null = null;
let host: HTMLElement;

const render = async (tree: React.ReactElement) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(e(I18nextProvider, { i18n: i18next }, tree));
  });
};

/** Each tile's line, in tile order. */
const lines = () => [...host.querySelectorAll("button p:last-child")].map((line) => line.textContent);

/** The same two plans, sold for 0 days and with no validity at all. */
const PAGE_WITHOUT_VALIDITY = {
  currency: "INR",
  mappings: [
    mapping("a", "single", 0, "english"),
    mapping("b", "combo", undefined, "english"),
    mapping("c", "combo", undefined, "maths"),
  ],
} as unknown as ProductPageData;

const tiles = (page = PAGE) =>
  e(PlanTiles, { pageData: page, settings: SETTINGS, primaryColor: "var(--primary-500)" });

const onSite = (settings: CatalogueI18nSettings | undefined, naming?: CatalogueNaming, page = PAGE) =>
  e(CatalogueLocaleProvider, {
    settings,
    scope: "site",
    persist: false,
    children: e(CatalogueNamingProvider, { naming, children: tiles(page) }),
  });

const appLanguage = async (lng: string) => {
  await act(async () => {
    await i18next.changeLanguage(lng);
  });
};

beforeAll(async () => {
  const hiProductPages = { ...realCatalog("hi", "productPages"), planTiles: PLAN_TILES_HI };
  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LOCALES],
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false, bindI18n: "languageChanged namingTermsChanged" },
    resources: {
      en: { common: {}, productPages: realCatalog("en", "productPages"), terms: realCatalog("en", "terms") },
      hi: { common: {}, productPages: hiProductPages, terms: realCatalog("hi", "terms") },
    },
  });
});

beforeEach(async () => {
  localStorage.clear();
  h.search = "";
  await appLanguage("en");
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("plan tiles on a checkout inside a हिन्दी / EN site", () => {
  it("Hindi page, English app: the whole line is Hindi", async () => {
    h.search = "?lang=hi";
    await render(onSite(HINDI_SITE));

    expect(lines()).toEqual(["1 कोर्स · 365 दिन की एक्सेस", "2 कोर्स शामिल · 180 दिन की एक्सेस"]);
  });

  it("English page, Hindi app: the whole line is English", async () => {
    await appLanguage("hi");
    await render(onSite(HINDI_SITE));

    expect(lines()).toEqual(["1 course · 365 days access", "2 courses included · 180 days access"]);
  });

  it("a plan with no validity says only what it sells, as the English line does", async () => {
    h.search = "?lang=hi";
    await render(onSite(HINDI_SITE, undefined, PAGE_WITHOUT_VALIDITY));

    expect(lines()).toEqual(["1 कोर्स", "2 कोर्स शामिल"]);
  });

  it("names the catalogue's own word as the rest of the checkout does", async () => {
    h.search = "?lang=hi";
    await render(onSite(HINDI_SITE, { course: "Programme", coursePlural: "Programmes" }));

    // "Programme" has a translation in the site's dictionary; "Programmes"
    // does not, so the plural is the institute's word in Hindi.
    expect(lines()).toEqual(["1 कार्यक्रम · 365 दिन की एक्सेस", "2 कोर्स शामिल · 180 दिन की एक्सेस"]);
  });
});

describe("plan tiles anywhere else, as before", () => {
  it("a product page opened on its own keeps the English line, in the app's word", async () => {
    await render(tiles());
    expect(lines()).toEqual(["1 course · 365 days access", "2 courses included · 180 days access"]);
    act(() => root?.unmount());
    root = null;

    await appLanguage("hi");
    await render(tiles());
    expect(lines()).toEqual(["1 कोर्स · 365 days access", "2 कोर्स included · 180 days access"]);
  });

  it("a plan with no validity says only what it sells", async () => {
    await render(tiles(PAGE_WITHOUT_VALIDITY));
    expect(lines()).toEqual(["1 course", "2 courses included"]);
  });

  it("a site without languages keeps the English line, whatever its ?lang= says", async () => {
    h.search = "?lang=hi";
    await render(onSite(undefined, { course: "Programme", coursePlural: "Programmes" }));

    // The institute's word, not the catalogue's: as on a site without languages before.
    expect(lines()).toEqual(["1 course · 365 days access", "2 courses included · 180 days access"]);
  });
});
