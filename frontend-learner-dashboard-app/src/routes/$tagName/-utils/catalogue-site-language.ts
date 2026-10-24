/**
 * Site-language plumbing for the public renderer (JsonRenderer, CatalogueLink,
 * the page shells) — pure helpers, unit-tested in catalogue-site-language.test.ts.
 *
 * Every helper is an identity on a single-language site (no dictionary, no
 * visibleWhen rules, no locale to carry), which is what keeps sites that never
 * opted in rendering exactly as before.
 */

import {
  LOCALE_PARAM,
  localesOf,
  localizeDeep,
  type CatalogueI18nSettings,
  type TranslationDictionary,
} from "./catalogue-i18n";
import { evaluateVisibleWhen } from "./catalogue-url-state";

/* ── authored props in the visitor's language ───────────────────────── */

const localizedPropsCache = new WeakMap<object, { dict: TranslationDictionary; value: unknown }>();

/**
 * A section's props in the visitor's language. The walk runs once per props
 * object and dictionary — later renders get the same result object back, so a
 * page does not re-walk every section on every render. Without a dictionary
 * (base language, single-language site) the props come back untouched.
 *
 * Nested sections (columnLayout slots, tab/accordion item slots) are left as
 * they are here: localizeDeep treats `slots` / `slot` as opaque, and each child
 * is localized on its own when the renderer reaches it.
 */
export const localizeComponentProps = <T>(props: T, dict: TranslationDictionary | undefined): T => {
  if (!dict || !props || typeof props !== "object") return props;
  const key = props as unknown as object;
  const hit = localizedPropsCache.get(key);
  if (hit && hit.dict === dict) return hit.value as T;
  const value = localizeDeep(props, dict);
  localizedPropsCache.set(key, { dict, value });
  return value;
};

/* ── visibleWhen (show a section only for some query strings) ───────── */

type SectionLike = { readonly [key: string]: unknown; visibleWhen?: unknown } | null | undefined;

/**
 * Does this section carry visibleWhen rules? Only such sections follow the
 * URL; a section without rules renders without reading the query string at
 * all (so it does not re-render when a filter changes the URL).
 */
export const hasVisibleWhenRules = (section: SectionLike): boolean =>
  Array.isArray(section?.visibleWhen) && (section!.visibleWhen as unknown[]).length > 0;

export type SectionVisibility = "show" | "hide" | "hint";

/**
 * Whether a section renders for the current query string. No rules = always
 * shown. A section whose rules fail is skipped — except in the builder
 * preview, where it still renders ("hint") so the admin can see and select it.
 */
export const sectionVisibility = (
  section: SectionLike,
  searchStr: string | null | undefined,
  isPreviewMode: boolean,
): SectionVisibility => {
  if (!hasVisibleWhenRules(section)) return "show";
  if (evaluateVisibleWhen(section!.visibleWhen, searchStr)) return "show";
  return isPreviewMode ? "hint" : "hide";
};

/* ── keeping ?lang= on links ────────────────────────────────────────── */

/**
 * `href` with ?lang=<locale> added (before any #hash), for links a crawler or a
 * new tab follows. The authored query string is kept byte for byte; a link
 * that already names a language keeps its own. No locale = unchanged.
 */
export const withLocaleParam = (href: string, locale: string | null | undefined): string => {
  if (!locale || !href) return href;
  const hashAt = href.indexOf("#");
  const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const queryAt = beforeHash.indexOf("?");
  const query = queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "";
  if (new URLSearchParams(query).has(LOCALE_PARAM)) return href;
  const param = `${LOCALE_PARAM}=${encodeURIComponent(locale)}`;
  const nextBefore =
    queryAt < 0 ? `${beforeHash}?${param}` : query ? `${beforeHash}&${param}` : `${beforeHash}${param}`;
  return `${nextBefore}${hash}`;
};

/**
 * Repairs the malformed address keeping ?lang= produces when a navigation's
 * `to` carried its own query string or #hash (a caller that does not use
 * useSiteNavigate): the router appends "?lang=hi" to the END of the address,
 * so "/courses?stream=x" becomes "/courses?stream=x?lang=hi" (stream reads
 * "x?lang=hi", lang is lost) and "/about#team" becomes "/about#team?lang=hi"
 * (the language lands in the hash). Returns the fixed address
 * ("/courses?stream=x&lang=hi", "/about?lang=hi#team"), or null when there is
 * nothing to fix. Only those exact shapes are touched; a link that named a
 * language itself keeps its own.
 *
 * Takes the RAW address (router.history.location.href): the router's parsed
 * location has already re-encoded the second "?" as %3F and cannot be repaired.
 */
export const repairRetainedLocaleHref = (href: string | null | undefined): string | null => {
  const match = new RegExp(`^([^?#]*)(\\?[^?#]*)?(#[^?#]*)?\\?(${LOCALE_PARAM}=[^?&#]*)$`).exec(href || "");
  if (!match) return null;
  const [, path, query = "", hash = "", lang] = match;
  // "/about?lang=hi" — the parameter is already where it belongs.
  if (!query && !hash) return null;
  const ownQuery = query.slice(1);
  const joined = !ownQuery ? `?${lang}` : new URLSearchParams(ownQuery).has(LOCALE_PARAM) ? query : `${query}&${lang}`;
  return `${path}${joined}${hash}`;
};

/* ── scripts that need their own font ───────────────────────────────── */

/** Site languages written in Devanagari. */
const DEVANAGARI_LOCALES = new Set(["hi", "mr", "ne", "sa", "kok", "mai", "bho", "brx", "doi"]);

/**
 * True when a multi-language site offers a Devanagari language (हिन्दी,
 * मराठी…), so its shells add a Devanagari face to the body font stack. A
 * single-language site never does — its font stack stays exactly as it was.
 */
export const siteUsesDevanagari = (settings: CatalogueI18nSettings | null | undefined): boolean =>
  !!settings?.enabled && localesOf(settings).some((l) => DEVANAGARI_LOCALES.has(l.code.split("-")[0]));
