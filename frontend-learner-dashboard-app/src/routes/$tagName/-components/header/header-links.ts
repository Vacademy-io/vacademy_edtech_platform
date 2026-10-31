/**
 * Links in the site header's mega menu, mobile menu and site search — pure
 * helpers (no router, no React) so every rule is unit-tested in
 * header-links.test.ts.
 *
 * Authors write links as SITE paths ("/courses?stream=shiksha"); the host
 * decides whether the catalogue tag shows in the real URL ("/new/courses…"
 * on a classic host, "/courses…" when the catalogue is root-mounted), so a
 * site path is turned into an app path only at render time (toAppHref).
 */

import { fillLinkPattern } from "../../-utils/catalogue-url-state";

export const DEFAULT_STREAM_LINK_PATTERN = "/courses?stream={stream}";
export const DEFAULT_CATEGORY_LINK_PATTERN = "/courses?stream={stream}&category={category}";

export interface HeaderLink {
  /** A site path ("/courses?stream=x") or, when external, a full http(s) URL. */
  href: string;
  external: boolean;
}

// Control characters (tab and newline included) are stripped by browsers when
// they parse a URL, which is how "/\t/evil.example" turns into "//evil.example".
const hasControlChars = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};
// "/x" but never "//host" or "/\host" (browsers read a backslash as a slash).
const SITE_PATH = /^\/(?![/\\])/;

/**
 * Accepts only a site-relative path or a full http(s) URL. Everything else —
 * javascript:, data:, mailto:, protocol-relative "//host", "/\host", bare
 * words — is refused, so catalogue JSON or folder data can never smuggle a
 * script URL or an off-site redirect into a header link.
 */
export const safeHeaderLink = (raw: unknown): HeaderLink | null => {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || hasControlChars(value)) return null;
  if (SITE_PATH.test(value)) return { href: value, external: false };
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) {
        return { href: value, external: true };
      }
    } catch {
      // Not a URL at all.
    }
  }
  return null;
};

/**
 * A nav-style `route`: a safe link, or a bare page route ("find-your-path",
 * "homepage") — the form the page builder's link picker stores for pages.
 * A bare route can only ever be a path on this site (no scheme, no host).
 */
export const routeHeaderLink = (raw: unknown): HeaderLink | null => {
  const safe = safeHeaderLink(raw);
  if (safe || typeof raw !== "string") return safe;
  const value = raw.trim();
  if (/^homepage$/i.test(value)) return { href: "/", external: false };
  return /^[a-z0-9][a-z0-9\-_/]*$/i.test(value) ? { href: `/${value}`, external: false } : null;
};

/** An image source from untrusted data: the same rule as links. */
export const safeImageSrc = (raw: unknown): string | null => safeHeaderLink(raw)?.href ?? null;

/** Accent colours from folder data: #rgb, #rrggbb or #rrggbbaa only. */
export const safeAccentColor = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value : null;
};

/**
 * Fills a link pattern ({stream}, {category} → URI-encoded slugs) and keeps the
 * result only when it is still a safe link. An empty or missing pattern uses
 * `fallback`.
 */
export const linkFromPattern = (
  pattern: string | null | undefined,
  fallback: string,
  values: Record<string, string | null | undefined>,
): HeaderLink | null => {
  const source = typeof pattern === "string" && pattern.trim() ? pattern.trim() : fallback;
  return safeHeaderLink(fillLinkPattern(source, values));
};

/**
 * Fills a TEXT pattern ("Explore {stream}"). Unknown placeholders are left as
 * typed so a typo stays visible to the author instead of silently vanishing.
 */
export const fillTextPattern = (pattern: string, values: Record<string, string>): string =>
  pattern.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole,
  );

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Site path → the path this host serves. `pagePath(route)` is the catalogue's
 * single (tag, route) → path rule (RouteMatcher.pagePath); the query string and
 * hash ride along untouched. A path written with the tag in it ("/new/courses",
 * pasted from the address bar) is the same page, so the tag is dropped first —
 * the same rule CatalogueLink applies.
 */
export const toAppHref = (
  sitePath: string,
  opts: { tagName: string; pagePath: (route: string) => string },
): string => {
  const hashAt = sitePath.indexOf("#");
  const beforeHash = hashAt >= 0 ? sitePath.slice(0, hashAt) : sitePath;
  const hash = hashAt >= 0 ? sitePath.slice(hashAt) : "";
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const query = queryAt >= 0 ? beforeHash.slice(queryAt) : "";

  let route = path.replace(/^\/+/, "");
  const tag = (opts.tagName || "").trim();
  if (tag) {
    route = route.replace(new RegExp(`^${escapeRegExp(tag)}(?=/|$)`, "i"), "").replace(/^\/+/, "");
  }
  return `${opts.pagePath(route)}${query.length > 1 ? query : ""}${hash.length > 1 ? hash : ""}`;
};

/**
 * Keeps the visitor's ?lang= (and any other listed parameter) on an internal
 * link that does not set it itself, so following a menu link never drops the
 * language the visitor picked.
 */
export const carrySearchParams = (
  href: string,
  currentSearch: string | null | undefined,
  keys: readonly string[] = ["lang"],
): string => {
  const current = new URLSearchParams(currentSearch || "");
  const hashAt = href.indexOf("#");
  const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const next = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "");

  let changed = false;
  for (const key of keys) {
    const value = current.get(key);
    if (value && !next.has(key)) {
      next.set(key, value);
      changed = true;
    }
  }
  if (!changed) return href;
  return `${path}?${next.toString()}${hash}`;
};
