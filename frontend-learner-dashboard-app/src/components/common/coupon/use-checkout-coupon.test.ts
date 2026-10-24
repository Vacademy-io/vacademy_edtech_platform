// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The coupon error that names the course ("This coupon isn’t valid for this
 * course.") on a site checkout with languages: a sentence of the site's
 * language around the site's course word — never "…for this कोर्स." — and,
 * on every other checkout, exactly the English copy it always was. Real en /
 * hi terms and layoutCommonB catalogs; the new key added as listed for the
 * locale files. Only the network and the router are stubbed.
 */

const h = vi.hoisted(() => ({
  /** The address bar's query string (?lang=). */
  search: "",
  /** The error code the validate endpoint answers with. */
  code: "COUPON_NOT_APPLICABLE",
  /** Validate requests made. */
  requests: 0,
}));

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
vi.mock("axios", () => {
  const api: Record<string, unknown> = {
    post: async () => {
      h.requests += 1;
      return { data: { valid: false, message: h.code } };
    },
    get: async () => ({ data: {} }),
    defaults: { headers: { common: {} } },
    interceptors: { request: { use: () => 0 }, response: { use: () => 0 } },
  };
  api.create = () => api;
  return { default: api };
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { CatalogueLocaleProvider } from "@/routes/$tagName/-utils/catalogue-locale";
import type { CatalogueI18nSettings } from "@/routes/$tagName/-utils/catalogue-i18n";
import { couponErrorMessage } from "@/services/coupon";
import { useCheckoutCoupon } from "./use-checkout-coupon";

const e = React.createElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realCatalog = (lng: string, ns: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../locales/${lng}/${ns}.json`), "utf8"));

/**
 * The new key's Hindi, as it goes into the locale files. English is left to
 * the default written in couponErrorMessage (its entry repeats it), so these
 * tests also hold the default to the English copy.
 */
const NOT_APPLICABLE_HI = "यह कूपन इस {{course}} के लिए मान्य नहीं है।";

const HINDI_SITE: CatalogueI18nSettings = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
};

const seen: { apply?: (code?: string) => Promise<void> } = {};

/** A checkout's coupon box: what it shows after an Apply. */
const CouponBox = () => {
  const coupon = useCheckoutCoupon({
    buildRequest: (code) => ({ couponCode: code, instituteId: "inst-1", totalAmount: 100 }),
  });
  seen.apply = coupon.apply;
  return e("p", null, coupon.state.error ?? "");
};

const onSite = (settings: CatalogueI18nSettings | undefined) =>
  e(CatalogueLocaleProvider, { settings, scope: "site", persist: false, children: e(CouponBox) });

let root: Root | null = null;
let host: HTMLElement;

/** Renders `tree`, applies a code, and returns the error the box shows. */
const errorAfterApply = async (tree: React.ReactElement) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(e(I18nextProvider, { i18n: i18next }, tree));
  });
  await act(async () => {
    await seen.apply!("SAVE10");
  });
  return host.querySelector("p")?.textContent;
};

const appLanguage = async (lng: string) => {
  await act(async () => {
    await i18next.changeLanguage(lng);
  });
};

beforeAll(async () => {
  const hiLayout = realCatalog("hi", "layoutCommonB") as { couponInput: { errors: Record<string, string> } };
  const hiLayoutWithKey = {
    ...hiLayout,
    couponInput: { ...hiLayout.couponInput, errors: { ...hiLayout.couponInput.errors, notApplicable: NOT_APPLICABLE_HI } },
  };
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
      en: { common: {}, layoutCommonB: realCatalog("en", "layoutCommonB"), terms: realCatalog("en", "terms") },
      hi: { common: {}, layoutCommonB: hiLayoutWithKey, terms: realCatalog("hi", "terms") },
    },
  });
});

beforeEach(async () => {
  localStorage.clear();
  h.search = "";
  h.code = "COUPON_NOT_APPLICABLE";
  h.requests = 0;
  seen.apply = undefined;
  await appLanguage("en");
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("a coupon the course does not take, on a checkout inside a हिन्दी / EN site", () => {
  it("Hindi page, English app: the message is Hindi, word and sentence", async () => {
    h.search = "?lang=hi";
    expect(await errorAfterApply(onSite(HINDI_SITE))).toBe("यह कूपन इस कोर्स के लिए मान्य नहीं है।");
    expect(h.requests).toBe(1);
  });

  it("English page, Hindi app: the message is English", async () => {
    await appLanguage("hi");
    expect(await errorAfterApply(onSite(HINDI_SITE))).toBe("This coupon isn’t valid for this course.");
  });

  it("leaves the messages that name no course as they were", async () => {
    h.search = "?lang=hi";
    h.code = "COUPON_EXPIRED";
    expect(await errorAfterApply(onSite(HINDI_SITE))).toBe("This coupon has expired.");
  });
});

describe("every other checkout, as before", () => {
  it("an app checkout keeps the English copy, in the app's word", async () => {
    expect(await errorAfterApply(e(CouponBox))).toBe("This coupon isn’t valid for this course.");
    act(() => root?.unmount());
    root = null;

    await appLanguage("hi");
    expect(await errorAfterApply(e(CouponBox))).toBe("This coupon isn’t valid for this कोर्स.");
  });

  it("a site without languages keeps the English copy, whatever its ?lang= says", async () => {
    h.search = "?lang=hi";
    expect(await errorAfterApply(onSite(undefined))).toBe("This coupon isn’t valid for this course.");
  });
});

describe("couponErrorMessage", () => {
  const CODES = [
    "INVALID_COUPON",
    "COUPON_INACTIVE",
    "COUPON_NOT_STARTED",
    "COUPON_EXPIRED",
    "COUPON_LIMIT_REACHED",
    "COUPON_EMAIL_RESTRICTED",
    "COUPON_NOT_FOR_PLAN_TYPE",
    "COUPON_DISCOUNT_NOT_CONFIGURED",
    "SOMETHING_NEW",
  ];

  it("puts only the message that names the course through a translator", () => {
    const t = vi.fn(() => "translated") as unknown as Parameters<typeof couponErrorMessage>[1];
    for (const code of CODES) expect(couponErrorMessage(code, t)).toBe(couponErrorMessage(code));
    expect(t).not.toHaveBeenCalled();

    expect(couponErrorMessage("COUPON_NOT_APPLICABLE", t)).toBe("translated");
    expect(t).toHaveBeenCalledWith("couponInput.errors.notApplicable", {
      course: "course",
      defaultValue: "This coupon isn’t valid for this {{course}}.",
    });
  });

  it("without one, gives the English copy as before", () => {
    expect(couponErrorMessage("COUPON_NOT_APPLICABLE")).toBe("This coupon isn’t valid for this course.");
    expect(couponErrorMessage("COUPON_EXPIRED")).toBe("This coupon has expired.");
    expect(couponErrorMessage(undefined)).toBe("Could not apply this coupon.");
  });
});
