/**
 * Page titles and crawler tags for catalogue sites, in the site's languages.
 *
 * Shared by the app (CatalogueSeoHead sets <title>/meta for visitors and for
 * crawlers that run JavaScript) and the Cloudflare edge middleware
 * (functions/_middleware.ts imports this file for crawlers that do not), so
 * both read the same rules. Pure: no React, no DOM, no router — only
 * catalogue-i18n, which is pure as well.
 */

import {
  LOCALE_PARAM,
  baseLocaleOf,
  dictionaryFor,
  localesOf,
  resolveSiteLocale,
  translateText,
  type CatalogueI18nSettings,
  type TranslationDictionary,
} from "./catalogue-i18n";

/** page.seo as the page editor stores it (every key optional). */
export interface PageSeoFields {
  metaTitle?: string;
  metaDescription?: string;
  ogImage?: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** A catalogue page's `seo`, tolerating pages (and unknown shapes) without one. */
export const pageSeoOf = (page: unknown): PageSeoFields => {
  const seo = (page as { seo?: unknown } | null | undefined)?.seo;
  if (!seo || typeof seo !== "object") return {};
  const { metaTitle, metaDescription, ogImage } = seo as Record<string, unknown>;
  return { metaTitle: text(metaTitle), metaDescription: text(metaDescription), ogImage: text(ogImage) };
};

/* ── the app's <title> / description ────────────────────────────────── */

export interface CatalogueSeoInput {
  pageSeo?: PageSeoFields | null;
  /** The institute's configured tab title (white-label branding), if any. */
  tabText?: string | null;
  instituteName?: string | null;
  /** Chrome fallbacks, already in the visitor's language. */
  defaultTitle: string;
  defaultDescription: string;
  /** The site dictionary for the visitor's language (undefined = base language). */
  dict?: TranslationDictionary;
}

export interface CatalogueSeo {
  title: string;
  ogTitle: string;
  description: string;
}

/**
 * The page's title and description from STABLE inputs only. The old code read
 * document.title back into the title it then wrote, so whatever title was last
 * on screen (a blog post's, a Hindi one after switching back to English) stuck.
 *
 *   title       = page SEO title → institute tab title → institute name → default
 *   og:title    = page SEO title → institute name → default
 *   description = page SEO description → default
 *
 * Each authored/branding string goes through the site dictionary, so a हिन्दी
 * visitor gets the Hindi title wherever a translation exists.
 */
export const computeCatalogueSeo = (input: CatalogueSeoInput): CatalogueSeo => {
  const tr = (s: string) => translateText(s, input.dict);
  const metaTitle = text(input.pageSeo?.metaTitle);
  const metaDescription = text(input.pageSeo?.metaDescription);
  const instituteName = text(input.instituteName);
  const brandTitle = text(input.tabText) || instituteName;
  return {
    title: metaTitle ? tr(metaTitle) : brandTitle ? tr(brandTitle) : input.defaultTitle,
    ogTitle: metaTitle ? tr(metaTitle) : instituteName ? tr(instituteName) : input.defaultTitle,
    description: metaDescription ? tr(metaDescription) : input.defaultDescription,
  };
};

/* ── crawler tags (edge middleware) ─────────────────────────────────── */

export interface SeoLocaleContext {
  /** Language this request's text is in (canonical, <html lang>). */
  locale: string;
  baseLocale: string;
  /** Languages the page has text in: the base, then each with translations. */
  locales: string[];
  /** Translations for `locale` (undefined in the base language). */
  dict: TranslationDictionary | undefined;
}

/**
 * The language of a crawler request (?lang=, else the site's base language).
 * null for a single-language site — the caller must then emit exactly what it
 * emitted before languages existed.
 *
 * Only languages with translations count: a site that turned languages on
 * before translating anything serves base-language text on ?lang=hi, so that
 * request is the base page (base canonical and <html lang>) and "hi" is not
 * offered as an alternate — crawlers are never told an English page is Hindi.
 */
export const seoLocaleContext = (
  settings: CatalogueI18nSettings | null | undefined,
  langParam: string | null | undefined,
): SeoLocaleContext | null => {
  if (!settings?.enabled) return null;
  const baseLocale = baseLocaleOf(settings);
  const requested = resolveSiteLocale({ settings, urlLocale: langParam });
  const dict = dictionaryFor(settings, requested);
  return {
    locale: dict ? requested : baseLocale,
    baseLocale,
    locales: localesOf(settings)
      .map((l) => l.code)
      .filter((code) => code === baseLocale || dictionaryFor(settings, code) !== undefined),
    dict,
  };
};

/**
 * The page's own address in `locale`, for the canonical and hreflang links:
 * the base language has no ?lang=, any other language carries it (so the Hindi
 * page is its own indexable URL instead of a duplicate of the English one).
 * Every other query parameter is dropped, as the canonical always did.
 */
export const localizedPageUrl = (origin: string, pathname: string, locale: string, baseLocale: string): string => {
  const path = pathname.replace(/\/+$/, "") || "/";
  return locale === baseLocale
    ? `${origin}${path}`
    : `${origin}${path}?${LOCALE_PARAM}=${encodeURIComponent(locale)}`;
};

/**
 * <link rel="alternate" hreflang> targets: one per language the page has text
 * in, plus x-default (the base). None until a second language has
 * translations — there is nothing to pair a lone version with.
 */
export const hreflangAlternates = (
  origin: string,
  pathname: string,
  ctx: Pick<SeoLocaleContext, "locales" | "baseLocale">,
): Array<{ hreflang: string; href: string }> =>
  ctx.locales.length < 2
    ? []
    : [
        ...ctx.locales.map((code) => ({
          hreflang: code,
          href: localizedPageUrl(origin, pathname, code, ctx.baseLocale),
        })),
        { hreflang: "x-default", href: localizedPageUrl(origin, pathname, ctx.baseLocale, ctx.baseLocale) },
      ];

/** Sets <html lang="…"> on a full HTML document (the attribute is added when missing). */
export const withHtmlLang = (html: string, locale: string): string => {
  const safe = locale.replace(/[^A-Za-z0-9-]/g, "");
  if (!safe) return html;
  if (/<html\b[^>]*\blang\s*=\s*"[^"]*"/i.test(html)) {
    return html.replace(/(<html\b[^>]*\blang\s*=\s*")[^"]*(")/i, `$1${safe}$2`);
  }
  return html.replace(/<html\b/i, `<html lang="${safe}"`);
};
