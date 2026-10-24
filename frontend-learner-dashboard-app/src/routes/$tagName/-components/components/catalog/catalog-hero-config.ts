/**
 * courseCatalog.hero → what the hero feature renders. Pure (no React).
 * Every resolver returns null unless its part opted in, so a section without
 * `hero` keeps the original markup (see -types/catalog-hero-types.ts).
 */

import type {
  CatalogHeroBreadcrumbItem,
  CatalogHeroSortToken,
  CatalogHeroStatKind,
} from "../../../-types/catalog-hero-types";

export const MAX_HERO_STATS = 3;
export const MAX_HERO_POPULAR = 8;

const STAT_KINDS: readonly CatalogHeroStatKind[] = ["courses", "streams", "categories"];
const SORT_TOKENS: readonly CatalogHeroSortToken[] = [
  "newest",
  "oldest",
  "price-asc",
  "price-desc",
  "rating",
  "name-asc",
  "name-desc",
  "popular",
];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export type ResolvedPopularChip =
  | { kind: "search"; label: string; value: string }
  | { kind: "stream"; label: string; streamSlug: string; categorySlug: string | null }
  | { kind: "quick"; label: string; quickFilterId: string }
  | { kind: "route"; label: string; route: string };

export interface ResolvedHeroBand {
  backgroundColor: string | null;
  breadcrumb: CatalogHeroBreadcrumbItem[];
  title: string;
  lead: string;
  stats: { kind: CatalogHeroStatKind; label: string }[];
  /** null = no search box. */
  search: { placeholder: string; buttonText: string } | null;
  popularLabel: string;
  popular: ResolvedPopularChip[];
}

export interface ResolvedResultsHeader {
  countText: string;
  countTextOne: string;
  showStreamChip: boolean;
  allStreamsLabel: string;
  streamChipMode: "title" | "subtitle";
  sortPrefix: string;
  sortLabels: Partial<Record<CatalogHeroSortToken, string>>;
}

export interface ResolvedQuickFilterBar {
  label: string;
  variant: "tint" | "filled";
}

export interface ResolvedCatalogHero {
  /** The cream band above the section; null = none. */
  band: ResolvedHeroBand | null;
  /** The results header; null = the original toolbar card. */
  resultsHeader: ResolvedResultsHeader | null;
  /** The labelled / filled quick filters; null = the original QuickFilterBar. */
  quickFilterBar: ResolvedQuickFilterBar | null;
}

/** Accepts #rgb / #rrggbb / #rrggbbaa and rgb()/hsl() colours; anything else is dropped. */
export const safeBandColor = (v: unknown): string | null => {
  const s = str(v);
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  if (/^(?:rgb|rgba|hsl|hsla)\([\d\s.,%/]+\)$/i.test(s)) return s;
  return null;
};

export const resolvePopularChip = (raw: unknown): ResolvedPopularChip | null => {
  if (!isObject(raw)) return null;
  const label = str(raw.label);
  if (!label) return null;
  const value = str(raw.searchValue);
  if (value) return { kind: "search", label, value };
  const streamSlug = str(raw.streamSlug);
  if (streamSlug) return { kind: "stream", label, streamSlug, categorySlug: str(raw.categorySlug) || null };
  const quickFilterId = str(raw.quickFilterId);
  if (quickFilterId) return { kind: "quick", label, quickFilterId };
  const route = str(raw.route);
  if (route) return { kind: "route", label, route };
  return null;
};

const resolveBand = (raw: Record<string, unknown>): ResolvedHeroBand | null => {
  if (raw.enabled !== true) return null;
  const breadcrumb = (Array.isArray(raw.breadcrumb) ? raw.breadcrumb : [])
    .filter(isObject)
    .map((item) => ({ label: str(item.label), route: str(item.route) || undefined }))
    .filter((item) => item.label);
  const stats = (Array.isArray(raw.stats) ? raw.stats : [])
    .filter(isObject)
    .filter((s): s is Record<string, unknown> & { kind: CatalogHeroStatKind } =>
      STAT_KINDS.includes(s.kind as CatalogHeroStatKind),
    )
    .slice(0, MAX_HERO_STATS)
    .map((s) => ({ kind: s.kind, label: str(s.label) }));
  const search = isObject(raw.search) && raw.search.enabled === true
    ? { placeholder: str(raw.search.placeholder), buttonText: str(raw.search.buttonText) }
    : null;
  const popular = (Array.isArray(raw.popular) ? raw.popular : [])
    .map(resolvePopularChip)
    .filter((c): c is ResolvedPopularChip => !!c)
    .slice(0, MAX_HERO_POPULAR);
  return {
    backgroundColor: safeBandColor(raw.backgroundColor),
    breadcrumb,
    title: str(raw.title),
    lead: str(raw.lead),
    stats,
    search,
    popularLabel: str(raw.popularLabel),
    popular,
  };
};

const resolveResultsHeaderConfig = (raw: unknown, forced: boolean): ResolvedResultsHeader | null => {
  const cfg = isObject(raw) ? raw : {};
  if (cfg.enabled !== true && !forced) return null;
  const sortLabels: Partial<Record<CatalogHeroSortToken, string>> = {};
  if (isObject(cfg.sortLabels)) {
    for (const token of SORT_TOKENS) {
      const label = str(cfg.sortLabels[token]);
      if (label) sortLabels[token] = label;
    }
  }
  const countText = str(cfg.countText);
  return {
    countText,
    countTextOne: str(cfg.countTextOne) || countText,
    showStreamChip: cfg.showStreamChip !== false,
    allStreamsLabel: str(cfg.allStreamsLabel),
    streamChipMode: cfg.streamChipMode === "subtitle" ? "subtitle" : "title",
    sortPrefix: str(cfg.sortPrefix),
    sortLabels,
  };
};

const resolveQuickFilterBar = (raw: unknown): ResolvedQuickFilterBar | null => {
  if (!isObject(raw)) return null;
  const label = str(raw.label);
  const variant = raw.variant === "filled" ? "filled" : "tint";
  if (!label && variant === "tint") return null;
  return { label, variant };
};

/** null when the section sets no part of the hero (the original markup everywhere). */
export const resolveCatalogHero = (raw: unknown): ResolvedCatalogHero | null => {
  if (!isObject(raw)) return null;
  const band = resolveBand(raw);
  // The hero search replaces the toolbar's search, so the toolbar card gives
  // way to the results header (sort + filters button) — one search per page.
  const resultsHeader = resolveResultsHeaderConfig(raw.resultsHeader, !!band?.search);
  const quickFilterBar = resolveQuickFilterBar(raw.quickFilterBar);
  if (!band && !resultsHeader && !quickFilterBar) return null;
  return { band, resultsHeader, quickFilterBar };
};

/** "Showing {count} courses" → "Showing 22 courses". */
export const fillCount = (template: string, count: string): string => template.split("{count}").join(count);
