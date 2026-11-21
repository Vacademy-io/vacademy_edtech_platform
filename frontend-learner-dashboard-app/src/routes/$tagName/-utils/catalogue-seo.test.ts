import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeCatalogueSeo,
  hreflangAlternates,
  localizedPageUrl,
  pageSeoOf,
  seoLocaleContext,
  withHtmlLang,
} from "./catalogue-seo";
import type { CatalogueI18nSettings } from "./catalogue-i18n";

const HI_SITE: CatalogueI18nSettings = {
  enabled: true,
  defaultLocale: "en",
  locales: [
    { code: "en", label: "EN" },
    { code: "hi", label: "हिन्दी" },
  ],
  strings: {
    hi: {
      "About Gurukul": "गुरुकुल के बारे में",
      "Our story": "हमारी कहानी",
      "Gurukul Academy": "गुरुकुल अकादमी",
    },
  },
};

describe("pageSeoOf", () => {
  it("reads page.seo and tolerates pages without one", () => {
    expect(pageSeoOf({ seo: { metaTitle: " About ", metaDescription: "Story", ogImage: "https://x/y.png" } })).toEqual({
      metaTitle: "About",
      metaDescription: "Story",
      ogImage: "https://x/y.png",
    });
    expect(pageSeoOf({ id: "home" })).toEqual({});
    expect(pageSeoOf(undefined)).toEqual({});
    expect(pageSeoOf({ seo: "nonsense" })).toEqual({});
    expect(pageSeoOf({ seo: { metaTitle: 42 } })).toEqual({ metaTitle: "", metaDescription: "", ogImage: "" });
  });
});

describe("computeCatalogueSeo", () => {
  const base = { defaultTitle: "Course Catalogue", defaultDescription: "Browse our courses" };

  it("keeps today's order when the page has no SEO of its own: tab title, then institute, then default", () => {
    expect(computeCatalogueSeo({ ...base, tabText: "Gurukul", instituteName: "Gurukul Academy" })).toEqual({
      title: "Gurukul",
      ogTitle: "Gurukul Academy",
      description: "Browse our courses",
    });
    expect(computeCatalogueSeo({ ...base, tabText: null, instituteName: "Gurukul Academy" }).title).toBe("Gurukul Academy");
    expect(computeCatalogueSeo({ ...base, tabText: "  ", instituteName: "" })).toEqual({
      title: "Course Catalogue",
      ogTitle: "Course Catalogue",
      description: "Browse our courses",
    });
  });

  it("uses the page's own SEO title and description when the editor set them", () => {
    const seo = computeCatalogueSeo({
      ...base,
      pageSeo: { metaTitle: "About Gurukul", metaDescription: "Our story" },
      tabText: "Gurukul",
      instituteName: "Gurukul Academy",
    });
    expect(seo).toEqual({ title: "About Gurukul", ogTitle: "About Gurukul", description: "Our story" });
  });

  it("translates authored and branding text through the site dictionary", () => {
    const dict = HI_SITE.strings!.hi;
    expect(
      computeCatalogueSeo({ ...base, pageSeo: { metaTitle: "About Gurukul", metaDescription: "Our story" }, dict }),
    ).toEqual({ title: "गुरुकुल के बारे में", ogTitle: "गुरुकुल के बारे में", description: "हमारी कहानी" });
    expect(computeCatalogueSeo({ ...base, instituteName: "Gurukul Academy", dict }).title).toBe("गुरुकुल अकादमी");
    // Untranslated text falls back to the source.
    expect(computeCatalogueSeo({ ...base, tabText: "Gurukul", dict }).title).toBe("Gurukul");
  });

  describe("stable inputs", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("never reads the current document title, so a previous page's title cannot stick", () => {
      vi.stubGlobal("document", { title: "Some blog post title" });
      const first = computeCatalogueSeo({ ...base, tabText: "Gurukul" });
      vi.stubGlobal("document", { title: "गुरुकुल के बारे में" });
      const second = computeCatalogueSeo({ ...base, tabText: "Gurukul" });
      expect(first.title).toBe("Gurukul");
      expect(second).toEqual(first);
    });
  });
});

describe("seoLocaleContext", () => {
  it("is null for a site without languages — the edge must then change nothing", () => {
    expect(seoLocaleContext(undefined, "hi")).toBeNull();
    expect(seoLocaleContext({ ...HI_SITE, enabled: false }, "hi")).toBeNull();
  });

  it("reads ?lang= and falls back to the base language for unknown codes", () => {
    const hi = seoLocaleContext(HI_SITE, "hi")!;
    expect(hi.locale).toBe("hi");
    expect(hi.baseLocale).toBe("en");
    expect(hi.locales).toEqual(["en", "hi"]);
    expect(hi.dict?.["Our story"]).toBe("हमारी कहानी");

    expect(seoLocaleContext(HI_SITE, "HI")!.locale).toBe("hi");
    const unknown = seoLocaleContext(HI_SITE, "fr")!;
    expect(unknown.locale).toBe("en");
    expect(unknown.dict).toBeUndefined();
    expect(seoLocaleContext(HI_SITE, null)!.locale).toBe("en");
  });

  it("counts only languages with translations, so an English page is never called Hindi", () => {
    // Languages on, nothing translated yet: ?lang=hi renders English.
    const untranslated = seoLocaleContext({ ...HI_SITE, strings: {} }, "hi")!;
    expect(untranslated.locale).toBe("en");
    expect(untranslated.locales).toEqual(["en"]);
    expect(untranslated.dict).toBeUndefined();
    // An empty dictionary is no translation either.
    expect(seoLocaleContext({ ...HI_SITE, strings: { hi: {} } }, "hi")!.locale).toBe("en");
    // No locales configured: the default English / Hindi pair, Hindi untranslated.
    const defaults = seoLocaleContext({ enabled: true }, "hi")!;
    expect(defaults.locale).toBe("en");
    expect(defaults.locales).toEqual(["en"]);
    // A third language without translations is left out; Hindi still counts.
    const mixed = seoLocaleContext(
      { ...HI_SITE, locales: [...HI_SITE.locales!, { code: "mr", label: "मराठी" }] },
      "mr",
    )!;
    expect(mixed.locale).toBe("en");
    expect(mixed.locales).toEqual(["en", "hi"]);
  });
});

describe("localizedPageUrl", () => {
  const origin = "https://learn.example.com";

  it("is the old canonical for the base language", () => {
    expect(localizedPageUrl(origin, "/shiksha/about/", "en", "en")).toBe("https://learn.example.com/shiksha/about");
    expect(localizedPageUrl(origin, "/", "en", "en")).toBe("https://learn.example.com/");
    expect(localizedPageUrl(origin, "", "en", "en")).toBe("https://learn.example.com/");
  });

  it("keeps ?lang= for any other language", () => {
    expect(localizedPageUrl(origin, "/shiksha/about", "hi", "en")).toBe("https://learn.example.com/shiksha/about?lang=hi");
    expect(localizedPageUrl(origin, "/", "hi", "en")).toBe("https://learn.example.com/?lang=hi");
  });
});

describe("hreflangAlternates", () => {
  it("lists every language plus x-default (the base language)", () => {
    expect(
      hreflangAlternates("https://learn.example.com", "/shiksha/about", { locales: ["en", "hi"], baseLocale: "en" }),
    ).toEqual([
      { hreflang: "en", href: "https://learn.example.com/shiksha/about" },
      { hreflang: "hi", href: "https://learn.example.com/shiksha/about?lang=hi" },
      { hreflang: "x-default", href: "https://learn.example.com/shiksha/about" },
    ]);
  });

  it("emits nothing while only the base language has text", () => {
    expect(hreflangAlternates("https://learn.example.com", "/shiksha/about", { locales: ["en"], baseLocale: "en" })).toEqual(
      [],
    );
  });
});

describe("withHtmlLang", () => {
  it("replaces the document language", () => {
    expect(withHtmlLang('<!doctype html>\n<html lang="en">\n<head>', "hi")).toBe('<!doctype html>\n<html lang="hi">\n<head>');
    expect(withHtmlLang('<html class="x" lang="en-US" dir="ltr">', "hi")).toBe('<html class="x" lang="hi" dir="ltr">');
  });

  it("adds the attribute when the document has none", () => {
    expect(withHtmlLang("<html><head>", "hi")).toBe('<html lang="hi"><head>');
  });

  it("never writes anything but a language tag", () => {
    expect(withHtmlLang('<html lang="en">', 'hi" onload="x')).toBe('<html lang="hionloadx">');
    expect(withHtmlLang('<html lang="en">', '"><')).toBe('<html lang="en">');
  });
});
