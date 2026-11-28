/**
 * The editorial filter sidebar (courseCatalog.filterSidebar) and the opt-in
 * category-filter extensions — validated config + small pure helpers.
 * Feature 'sidebar' (specs/filter-sidebar.json, Figma courses node 1:136).
 *
 * resolveFilterSidebar() is null unless filterSidebar.variant === 'editorial',
 * and resolveCategoryFilterExtension() returns {} unless the section sets one
 * of its fields — so every other site resolves exactly as before.
 */

import { routeHeaderLink, safeAccentColor, safeImageSrc } from "../../header/header-links";
import { resolveAppStoreLinks, type AppStoreLinks } from "../promo/AppStoreBadges";
import type { CatalogCategory, CatalogStream } from "./catalog-streams";

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const positiveInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
};

/* ── categoryFilter extensions ──────────────────────────────────────── */

export interface ResolvedCategoryFilterExtension {
  scope?: "all";
  labelMode?: "subtitle" | "both";
  sort?: "count";
  hideComingSoon?: true;
  visibleCount?: number;
  showAllLabel?: string;
}

/** Only the fields a section actually sets (non-default values) — {} for every other site. */
export const resolveCategoryFilterExtension = (raw: unknown): ResolvedCategoryFilterExtension => {
  if (!isObject(raw)) return {};
  const out: ResolvedCategoryFilterExtension = {};
  if (raw.scope === "all") out.scope = "all";
  if (raw.labelMode === "subtitle" || raw.labelMode === "both") out.labelMode = raw.labelMode;
  if (raw.sort === "count") out.sort = "count";
  if (raw.hideComingSoon === true) out.hideComingSoon = true;
  const visible = positiveInt(raw.visibleCount);
  if (visible !== null) out.visibleCount = visible;
  const showAll = text(raw.showAllLabel);
  if (showAll) out.showAllLabel = showAll;
  return out;
};

/** Every stream's categories, stream then folder order, de-duplicated by slug (first wins). */
export const allCategories = (streams: CatalogStream[]): CatalogCategory[] => {
  const seen = new Set<string>();
  const out: CatalogCategory[] = [];
  for (const stream of streams) {
    for (const cat of stream.categories) {
      const key = cat.slug.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cat);
    }
  }
  return out;
};

/**
 * The categories the category filter offers: the active stream's, or — with
 * scope 'all' on "All courses" — every stream's. Without scope 'all' and no
 * active stream: none (the original behaviour).
 */
export const categoriesInScope = (
  categoryFilter: { scope?: "all" },
  streams: CatalogStream[],
  activeStream: CatalogStream | null,
): CatalogCategory[] =>
  activeStream ? activeStream.categories : categoryFilter.scope === "all" ? allCategories(streams) : [];

/* ── filterSidebar ──────────────────────────────────────────────────── */

export interface ResolvedSidebarPromo {
  image: string | null;
  imageAlt: string;
  screenImage: string | null;
  eyebrow: string;
  title: string;
  text: string;
  buttonText: string;
  /** Site route or https URL; null = no button. */
  buttonTarget: string | null;
  buttonExternal: boolean;
  openInNewTab: boolean;
  /** Store badges shown in place of the button; null = the button. */
  appLinks: AppStoreLinks | null;
  backgroundColor: string | null;
  eyebrowColor: string | null;
  titleColor: string | null;
  textColor: string | null;
  buttonColor: string | null;
  buttonTextColor: string | null;
}

export interface ResolvedFilterSidebar {
  width: number;
  sticky: boolean;
  collapsible: boolean;
  title: string;
  clearAllLabel: string;
  showMoreLabel: string;
  showLessLabel: string;
  order: string[];
  dividerColor: string | null;
  checkboxColor: string | null;
  checkboxSoftColor: string | null;
  promo: ResolvedSidebarPromo | null;
}

export const SIDEBAR_DEFAULT_WIDTH = 280;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 360;

const resolvePromo = (raw: unknown): ResolvedSidebarPromo | null => {
  if (!isObject(raw) || raw.enabled !== true) return null;
  const button = isObject(raw.button) ? raw.button : {};
  const link = routeHeaderLink(button.target);
  const buttonText = text(button.text);
  return {
    image: safeImageSrc(raw.image),
    imageAlt: text(raw.imageAlt),
    screenImage: safeImageSrc(raw.screenImage),
    eyebrow: text(raw.eyebrow),
    title: text(raw.title),
    text: text(raw.text),
    buttonText,
    buttonTarget: buttonText && link ? link.href : null,
    buttonExternal: !!link?.external,
    openInNewTab: button.openInNewTab === true,
    appLinks: resolveAppStoreLinks(raw.appLinks),
    backgroundColor: safeAccentColor(raw.backgroundColor),
    eyebrowColor: safeAccentColor(raw.eyebrowColor),
    titleColor: safeAccentColor(raw.titleColor),
    textColor: safeAccentColor(raw.textColor),
    buttonColor: safeAccentColor(raw.buttonColor),
    buttonTextColor: safeAccentColor(raw.buttonTextColor),
  };
};

/** WCAG contrast of a #rgb / #rrggbb / #rrggbbaa colour (alpha blended onto white) against white. */
export const contrastOnWhite = (hex: string): number => {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  const channel = (i: number) => {
    const c = (parseInt(h.slice(i, i + 2), 16) * alpha + 255 * (1 - alpha)) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return 1.05 / (lum + 0.05);
};

/**
 * An authored checkbox border: a hex colour that still shows on the white box
 * (WCAG 1.4.11, 3:1 for a control's boundary); a fainter one is dropped so
 * the default (or the group's main checkbox colour) draws it.
 */
const checkboxBorderColor = (raw: unknown): string | null => {
  const color = safeAccentColor(raw);
  return color && contrastOnWhite(color) >= 3 ? color : null;
};

/** The editorial sidebar's config, or null (the original sidebar) unless variant === 'editorial'. */
export const resolveFilterSidebar = (raw: unknown): ResolvedFilterSidebar | null => {
  if (!isObject(raw) || raw.variant !== "editorial") return null;
  const width = positiveInt(raw.width);
  const order = Array.isArray(raw.order)
    ? [...new Set(raw.order.map((id) => text(id).toLowerCase()).filter(Boolean))]
    : [];
  return {
    width: width === null ? SIDEBAR_DEFAULT_WIDTH : Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)),
    sticky: raw.sticky === true,
    collapsible: raw.collapsible !== false,
    title: text(raw.title),
    clearAllLabel: text(raw.clearAllLabel),
    showMoreLabel: text(raw.showMoreLabel),
    showLessLabel: text(raw.showLessLabel),
    order,
    dividerColor: safeAccentColor(raw.dividerColor),
    checkboxColor: checkboxBorderColor(raw.checkboxColor),
    checkboxSoftColor: checkboxBorderColor(raw.checkboxSoftColor),
    promo: resolvePromo(raw.promo),
  };
};

/** The original group order: discovery groups, then custom groups, then the legacy filtersConfig groups. */
export const DEFAULT_GROUP_ORDER = ["category", "language", "price"] as const;
export const LEGACY_GROUP_ORDER = ["level", "session", "tags", "instructor", "priceRange"] as const;

/**
 * Group ids in display order: the authored `order` first (unknown ids
 * ignored; matched case-insensitively, as the resolver lower-cases it —
 * 'priceRange' / 'pricerange'), then every remaining id in its original position.
 */
export const orderGroupIds = (available: string[], order: string[]): string[] => {
  const listed: string[] = [];
  for (const raw of order) {
    const id = available.find((a) => a.toLowerCase() === raw.toLowerCase());
    if (id && !listed.includes(id)) listed.push(id);
  }
  return [...listed, ...available.filter((id) => !listed.includes(id))];
};

/* ── text helpers ───────────────────────────────────────────────────── */

const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/;

/**
 * Splits text into Devanagari and other runs, so letter-spacing can apply
 * to the Latin part only — tracking breaks the shirorekha (the headline
 * joining Devanagari letters). Spaces and punctuation join the run before them.
 */
export const splitScriptRuns = (value: string): { text: string; devanagari: boolean }[] => {
  const runs: { text: string; devanagari: boolean }[] = [];
  for (const ch of value) {
    const isDeva = DEVANAGARI.test(ch);
    const neutral = !isDeva && !/[A-Za-z0-9]/.test(ch);
    const last = runs[runs.length - 1];
    if (last && (neutral || last.devanagari === isDeva)) last.text += ch;
    else runs.push({ text: ch, devanagari: isDeva });
  }
  return runs;
};

/** "+ Show all {count} categories" → "+ Show all 11 categories". */
export const fillCount = (template: string, count: number): string =>
  template.replace(/\{\{?count\}?\}/g, String(count));
