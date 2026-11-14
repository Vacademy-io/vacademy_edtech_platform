/**
 * Courses-page filter state <-> query string. Pure.
 *
 *   ?stream=shiksha&category=vedic-maths,sanskrit&language=hi&price=max:1000
 *    &badge=new,bestseller&sort=popular&q=yoga
 *
 * A shared or mega-menu link reproduces the view. Every value is validated
 * against what the section actually offers (known streams, their categories,
 * the filters it shows…); anything unknown, malformed or without a control on
 * this section is ignored, so a stale link degrades to the unfiltered grid
 * instead of an empty or silently narrowed one.
 */

import { ALL_BADGES, type CourseBadge } from "../../../-utils/course-badges";
import { URL_PARAMS, readListParam, readSearchParam } from "../../../-utils/catalogue-url-state";
import {
  COURSE_CATALOG_SORT_OPTIONS,
  type CourseCatalogSortOption,
} from "../../../-types/course-catalogue-types";
import type { CatalogDiscoveryConfig, ResolvedQuickFilter } from "./catalog-config";
import { customValidation } from "./catalog-custom-filters";

/** Not in the shared URL_PARAMS (yet): ?badge=new,bestseller. */
export const BADGE_PARAM = "badge";

export type PriceChoice = { kind: "free" } | { kind: "paid" } | { kind: "max"; max: number };

export interface DiscoveryState {
  /** Stream slug; null = "All courses". */
  stream: string | null;
  /** Category slugs inside the stream (OR). */
  categories: string[];
  /** Course language codes (OR). */
  languages: string[];
  price: PriceChoice | null;
  /** Badge filters (OR). */
  badges: CourseBadge[];
  /**
   * Authored option groups (courseCatalog.customFilters): group id -> option
   * ids (OR inside a group). Present only on a section that has such groups.
   */
  custom?: Record<string, string[]>;
}

export const EMPTY_DISCOVERY_STATE: DiscoveryState = {
  stream: null,
  categories: [],
  languages: [],
  price: null,
  badges: [],
};

/** What a link (or the local state) may select on this section — see discoveryLinkScope. */
export interface DiscoveryValidation {
  /** Stream tabs, each with the categories that may be selected ([] = none). */
  streams: { slug: string; categories: { slug: string }[] }[];
  /** Course language codes that may be selected. */
  languageCodes: string[];
  /** Price choices that may be selected: any valid one, or exactly these. */
  prices: "any" | PriceChoice[];
  /** Badge filters that may be selected. */
  badges: CourseBadge[];
  /** Custom groups (id -> option ids) that may be selected; absent when the section has none. */
  custom?: Record<string, string[]>;
  /** Categories selectable WITHOUT a stream (categoryFilter.scope 'all'); absent otherwise. */
  rootCategories?: { slug: string }[];
}

/* ── sort ───────────────────────────────────────────────────────────── */

export const SORT_URL_TOKENS: Record<CourseCatalogSortOption, string> = {
  Newest: "newest",
  Oldest: "oldest",
  "Price: Low to High": "price-asc",
  "Price: High to Low": "price-desc",
  Rating: "rating",
  "Name A-Z": "name-asc",
  "Name Z-A": "name-desc",
  Popular: "popular",
};

export const sortFromToken = (token: string | null | undefined): CourseCatalogSortOption | null => {
  const t = (token || "").trim().toLowerCase();
  if (!t) return null;
  return COURSE_CATALOG_SORT_OPTIONS.find((option) => SORT_URL_TOKENS[option] === t) ?? null;
};

/** The ?sort= value, or null when it is the section's default (keeps URLs short). */
export const sortToToken = (
  sort: CourseCatalogSortOption,
  defaultSort: CourseCatalogSortOption,
): string | null => (sort === defaultSort ? null : SORT_URL_TOKENS[sort]);

/* ── price ──────────────────────────────────────────────────────────── */

export const parsePriceParam = (raw: string | null | undefined): PriceChoice | null => {
  const v = (raw || "").trim().toLowerCase();
  if (v === "free") return { kind: "free" };
  if (v === "paid") return { kind: "paid" };
  const m = /^max:(\d+(?:\.\d+)?)$/.exec(v);
  if (m) {
    const max = Number(m[1]);
    if (Number.isFinite(max) && max > 0) return { kind: "max", max };
  }
  return null;
};

export const formatPriceParam = (price: PriceChoice | null | undefined): string | null => {
  if (!price) return null;
  if (price.kind === "max") return `max:${price.max}`;
  return price.kind;
};

export const samePrice = (a: PriceChoice | null | undefined, b: PriceChoice | null | undefined): boolean =>
  formatPriceParam(a) === formatPriceParam(b);

/* ── what a section offers ──────────────────────────────────────────── */

const lower = (s: string) => s.toLowerCase();

const quickPriceChoice = (qf: ResolvedQuickFilter): PriceChoice[] => {
  if (qf.kind === "free") return [{ kind: "free" }];
  if (qf.kind === "priceMax" && typeof qf.value === "number") return [{ kind: "max", max: qf.value }];
  return [];
};

/**
 * What a link may switch on in this section. A filter value from the URL
 * only applies where the visitor can see and undo it: the section shows a
 * control for it (a sidebar group or a quick filter), or lists applied
 * filters as removable chips. Anything else is ignored — so a mega-menu link
 * to one category opens the whole stream on a section without a category
 * filter, instead of a silently narrowed grid under a tab that looks complete.
 * The stream itself always applies: the tabs are its control.
 */
export const discoveryLinkScope = (
  config: Pick<
    CatalogDiscoveryConfig,
    | "showAppliedChips"
    | "courseLanguagesOn"
    | "languages"
    | "languageFilter"
    | "priceFilter"
    | "categoryFilter"
    | "quickFilters"
  > &
    Partial<Pick<CatalogDiscoveryConfig, "customFilters">>,
  ctx: {
    streams: DiscoveryValidation["streams"];
    /** The section shows its filter sidebar (showFilters is not false). */
    filtersShown: boolean;
    /** Codes the sidebar language group lists (the languages some course is in). */
    presentLanguages: string[];
  },
): DiscoveryValidation => {
  const chips = config.showAppliedChips;
  const quick = config.quickFilters;
  const siteCodes = config.courseLanguagesOn ? config.languages.map((l) => lower(l.code)) : [];
  const languageControls = new Set(
    [
      ...(ctx.filtersShown && config.languageFilter.enabled ? ctx.presentLanguages : []),
      ...quick.flatMap((q) => (q.kind === "language" && typeof q.value === "string" ? [q.value] : [])),
    ].map(lower),
  );
  const categoryControl = chips || (ctx.filtersShown && config.categoryFilter.enabled);
  const priceControl = chips || (ctx.filtersShown && config.priceFilter.enabled);
  // Feature 'sidebar': custom groups and stream-less categories, only when the section has them.
  const customFilters = chips || ctx.filtersShown ? config.customFilters ?? [] : [];
  const rootCategories =
    categoryControl && config.categoryFilter.scope === "all"
      ? uniqueBySlug(ctx.streams.flatMap((s) => s.categories))
      : [];
  return {
    ...(customFilters.length ? { custom: customValidation(customFilters) } : {}),
    ...(rootCategories.length ? { rootCategories } : {}),
    streams: categoryControl
      ? ctx.streams
      : ctx.streams.map((s) => ({ slug: s.slug, categories: [] })),
    languageCodes: chips ? siteCodes : siteCodes.filter((c) => languageControls.has(c)),
    prices: priceControl ? "any" : quick.flatMap(quickPriceChoice),
    // Only "New" and "Bestseller" quick filters are badge filters ("Free" is
    // the price filter's Free, "Popular" a sort); no sidebar group lists badges.
    badges: chips
      ? [...ALL_BADGES]
      : ALL_BADGES.filter((b) => (b === "new" || b === "bestseller") && quick.some((q) => q.kind === b)),
  };
};

/* ── state <-> params ───────────────────────────────────────────────── */

const unique = <T>(list: T[]): T[] => [...new Set(list)];

const uniqueBySlug = <T extends { slug: string }>(list: T[]): T[] => {
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(lower(x.slug)) ? false : (seen.add(lower(x.slug)), true)));
};

const isBadge = (b: string): b is CourseBadge => ALL_BADGES.includes(b as CourseBadge);

/** The discovery values a query string carries — syntax only; sanitizeDiscoveryState decides what applies. */
export const parseDiscoveryParams = (
  searchStr: string | null | undefined,
  customIds: string[] = [],
): DiscoveryState => ({
  stream: readSearchParam(searchStr, URL_PARAMS.stream),
  categories: readListParam(searchStr, URL_PARAMS.category),
  languages: readListParam(searchStr, URL_PARAMS.language),
  price: parsePriceParam(readSearchParam(searchStr, URL_PARAMS.price)),
  badges: readListParam(searchStr, BADGE_PARAM).map(lower).filter(isBadge),
  ...(customIds.length
    ? { custom: Object.fromEntries(customIds.map((id) => [id, readListParam(searchStr, id).map(lower)])) }
    : {}),
});

/**
 * The part of a discovery state this section offers: a known stream (its
 * slug as the section spells it), that stream's selectable categories, and
 * the languages / price / badges listed in `v`. Everything else is dropped.
 */
export const sanitizeDiscoveryState = (s: DiscoveryState, v: DiscoveryValidation): DiscoveryState => {
  const wanted = lower(s.stream || "");
  const stream = wanted ? v.streams.find((x) => lower(x.slug) === wanted) : undefined;
  const codes = new Set(v.languageCodes.map(lower));
  const price = s.price;
  // Without a stream, categories apply only on a section listing every stream's (scope 'all').
  const categoryPool = stream ? stream.categories : v.rootCategories ?? [];
  return {
    stream: stream?.slug ?? null,
    categories: categoryPool.length
      ? unique(
          s.categories
            .map((c) => categoryPool.find((x) => lower(x.slug) === lower(c))?.slug)
            .filter((c): c is string => !!c),
        )
      : [],
    languages: unique(s.languages.map(lower).filter((c) => codes.has(c))),
    price: price && (v.prices === "any" || v.prices.some((p) => samePrice(p, price))) ? price : null,
    badges: unique(s.badges.filter((b) => v.badges.includes(b))),
    ...(v.custom
      ? {
          custom: Object.fromEntries(
            Object.entries(v.custom).map(([id, allowed]) => [
              id,
              unique((s.custom?.[id] ?? []).map(lower).filter((o) => allowed.includes(o))),
            ]),
          ),
        }
      : {}),
  };
};

export const readDiscoveryParams = (
  searchStr: string | null | undefined,
  v: DiscoveryValidation,
): DiscoveryState => sanitizeDiscoveryState(parseDiscoveryParams(searchStr, Object.keys(v.custom ?? {})), v);

/** Stream and category only — what a mega-menu link carries. */
export const readStreamParams = (
  searchStr: string | null | undefined,
  v: DiscoveryValidation,
): Pick<DiscoveryState, "stream" | "categories"> => {
  const { stream, categories } = readDiscoveryParams(searchStr, v);
  return { stream, categories };
};

/** Query-string updates for the keys present in `patch` (null removes a key). */
export const discoveryPatchToParams = (
  patch: Partial<DiscoveryState>,
): Record<string, string | string[] | null> => {
  const out: Record<string, string | string[] | null> = {};
  if ("stream" in patch) out[URL_PARAMS.stream] = patch.stream || null;
  if ("categories" in patch) out[URL_PARAMS.category] = patch.categories?.length ? patch.categories : null;
  if ("languages" in patch) out[URL_PARAMS.language] = patch.languages?.length ? patch.languages : null;
  if ("price" in patch) out[URL_PARAMS.price] = formatPriceParam(patch.price);
  if ("badges" in patch) out[BADGE_PARAM] = patch.badges?.length ? patch.badges : null;
  for (const [id, list] of Object.entries(patch.custom ?? {})) out[id] = list.length ? list : null;
  return out;
};

/** Search text as it goes into ?q= — trimmed and bounded. */
export const searchToParam = (term: string): string | null => {
  const t = term.trim().slice(0, 200);
  return t || null;
};

/** Number of applied discovery filters (the stream is a tab, not a filter). */
export const countDiscoveryFilters = (s: DiscoveryState): number =>
  s.categories.length +
  s.languages.length +
  (s.price ? 1 : 0) +
  s.badges.length +
  Object.values(s.custom ?? {}).reduce((n, list) => n + list.length, 0);
