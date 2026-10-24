import { useCallback } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";

/**
 * The URL parameter carrying the visitor's site language — LOCALE_PARAM in
 * catalogue-i18n.ts (a unit test keeps the two equal). Spelled out here so the
 * route files, which ship in the main bundle, do not pull in the catalogue's
 * i18n code.
 */
export const SITE_LANGUAGE_PARAM = "lang";

/* ── is a multi-language site on screen? ────────────────────────────── */

let languageSitesOnScreen = 0;

/**
 * Marks a multi-language catalogue site as on screen until the returned
 * function is called (calling it twice is harmless). CatalogueLocaleProvider
 * holds it while it renders a site with languages turned on. The catalogue
 * routes keep ?lang= only while it is held, so a site that never turned
 * languages on navigates exactly as it always did — even when its URL carries
 * a stray ?lang= from a campaign link.
 */
export const holdSiteLanguage = (): (() => void) => {
  languageSitesOnScreen += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    languageSitesOnScreen -= 1;
  };
};

/** True while a multi-language site is on screen (see holdSiteLanguage). */
export const isSiteLanguageHeld = (): boolean => languageSitesOnScreen > 0;

/** The ?lang= value the catalogue routes would carry over from `search`, if any. */
const carriedLanguage = (search: unknown): unknown =>
  languageSitesOnScreen > 0 && search !== null && typeof search === "object"
    ? (search as Record<string, unknown>)[SITE_LANGUAGE_PARAM]
    : undefined;

/* ── the catalogue routes' search middleware ───────────────────────── */

/**
 * A route search middleware that fits any route, whatever its search schema:
 * `lang` is read raw from the URL and is part of no route's validated search.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySearchMiddleware = (ctx: { search: any; next: (search: any) => any }) => any;

/**
 * Search middleware for the catalogue routes. While a multi-language site is
 * on screen, a navigation INTO the route that does not set ?lang= itself keeps
 * the one in the current URL (TanStack drops every parameter a navigation does
 * not name). Otherwise it passes the destination's search through untouched —
 * the same result as having no middleware. Only catalogue routes use it, so
 * /login and /dashboard never inherit the site language.
 *
 * A navigation whose `to` carries its own query string or #hash must go
 * through `href` while a language is carried (siteNavigateOptions /
 * useSiteNavigate), or the kept parameter lands after a second "?".
 */
export const retainSiteLanguage: AnySearchMiddleware = ({ search, next }) => {
  const result = next(search);
  const lang = carriedLanguage(search);
  if (lang === undefined) return result;
  // A destination that names `lang` itself (even as undefined, to drop it) wins.
  if (result !== null && typeof result === "object" && SITE_LANGUAGE_PARAM in result) return result;
  return { ...result, [SITE_LANGUAGE_PARAM]: lang };
};

/* ── navigating to an authored address ─────────────────────────────── */

/**
 * The target without the characters a browser drops when it reads a URL
 * (control characters and whitespace, anywhere), so "java\tscript:" and
 * " //host" are seen the way the browser would see them.
 */
const withoutIgnoredChars = (target: string): string => {
  let out = "";
  for (const ch of target) {
    const code = ch.charCodeAt(0);
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || /\s/.test(ch)) continue;
    out += ch;
  }
  return out;
};

/**
 * True for a target that names a scheme ("javascript:", "https:", "mailto:")
 * or a host ("//host", "/\host"). The router loads any absolute URL given as
 * `href` as a whole new page (window.location), which would run a
 * "javascript:" address, so such a target never goes by `href`.
 */
const namesSchemeOrHost = (target: string): boolean => {
  const bare = withoutIgnoredChars(target);
  return /^[a-z][a-z\d+.-]*:/i.test(bare) || /^[\\/]{2}/.test(bare);
};

/**
 * How to navigate to a site address that may carry its own query string or
 * #hash ("/courses?stream=x", "/about#team"):
 *
 * - `{ to }` — exactly what every caller did before languages existed. The
 *   router keeps that text in the path, so the URL is the authored one byte
 *   for byte. Used whenever the router will not carry a language, which is
 *   always the case on a site without languages — and always for a target
 *   with a scheme or a host (see namesSchemeOrHost).
 * - `{ href }` — when the router is about to carry ?lang= into a site
 *   address with its own query string or hash. With `to` the kept parameter
 *   would be appended after the whole address ("/courses?stream=x?lang=hi",
 *   where stream reads "x?lang=hi"); `href` is parsed first, so lang joins
 *   the query. (The router writes that query back out in its own encoding.)
 *
 * `currentSearch` is the current location's parsed search
 * (router.latestLocation.search), which the middleware copies lang from.
 */
export const siteNavigateOptions = (
  target: string,
  currentSearch: unknown,
): { to: string } | { href: string } =>
  carriedLanguage(currentSearch) !== undefined && /[?#]/.test(target) && !namesSchemeOrHost(target)
    ? { href: target }
    : { to: target };

/**
 * navigate() for authored catalogue addresses (header/footer/hero links, the
 * mobile bar): `siteNavigate("/courses?stream=x")` instead of
 * `navigate({ to: "/courses?stream=x" })`. Identical to the latter (same
 * useNavigate, same `from` for relative routes) unless a site language is
 * being carried into a site address — see siteNavigateOptions. The current
 * URL is read at call time, so the calling component does not re-render on
 * URL changes.
 */
export const useSiteNavigate = () => {
  const navigate = useNavigate();
  const router = useRouter();
  return useCallback(
    (target: string, options?: { replace?: boolean }): Promise<void> => {
      const nav = siteNavigateOptions(target, router.latestLocation?.search);
      return "href" in nav ? navigate({ href: nav.href, ...options }) : navigate({ to: nav.to, ...options });
    },
    [navigate, router],
  );
};
