/**
 * courseCatalog.hero — OWNED BY FEATURE 'hero' (specs/courses-hero-results-header.json).
 *
 * Everything is opt-in. A section without `hero` (or with none of its parts
 * switched on) renders exactly as before. Three independent parts:
 *  - the cream page hero above the section (`enabled: true`): breadcrumb, H1,
 *    lead, live stats, a large search box and "Popular:" shortcut chips;
 *  - `resultsHeader.enabled: true`: "Showing N courses" + the current-stream
 *    chip + a boxed "Sort: Most popular" select, replacing the search/sort
 *    toolbar card (also rendered whenever the hero search is on, so the page
 *    keeps one search box);
 *  - `quickFilterBar`: a visible "Quick filters:" label and/or the filled chip style.
 *
 * Key names decide what the site dictionary translates (catalogue-i18n.ts):
 * label/title/lead/placeholder/buttonText/countText/sortPrefix… are prose;
 * route, kind, searchValue, streamSlug, categorySlug, quickFilterId,
 * backgroundColor, streamChipMode, variant are data and stay as authored.
 */

export type CatalogHeroStatKind = "courses" | "streams" | "categories";

export interface CatalogHeroStat {
  /** courses = every card in "All"; streams = stream tabs; categories = categories across streams. */
  kind: CatalogHeroStatKind;
  /** Text under the number ("courses & resources"). Empty = a built-in label. */
  label?: string;
}

export interface CatalogHeroBreadcrumbItem {
  label: string;
  /** Site route ("homepage", "courses"…) or URL. The last item is the current page and is never a link. */
  route?: string;
}

/**
 * A "Popular:" shortcut. Exactly one action is used, by precedence:
 * searchValue > streamSlug (+ categorySlug) > quickFilterId > route.
 */
export interface CatalogHeroPopularChip {
  label: string;
  /** Sets the search box (never translated). */
  searchValue?: string;
  /** Opens this stream tab (folder slug or tag-stream slug)… */
  streamSlug?: string;
  /** …with this category of it selected. */
  categorySlug?: string;
  /** Toggles one of the section's quickFilters[] by id. */
  quickFilterId?: string;
  /** A plain link (CatalogueLink rules). */
  route?: string;
}

export interface CatalogHeroSearchConfig {
  enabled?: boolean;
  /** Empty = a built-in placeholder. */
  placeholder?: string;
  /** Empty = "Search". */
  buttonText?: string;
}

/** Sort option tokens, as in ?sort= (catalog-url.ts SORT_URL_TOKENS). */
export type CatalogHeroSortToken =
  | "newest"
  | "oldest"
  | "price-asc"
  | "price-desc"
  | "rating"
  | "name-asc"
  | "name-desc"
  | "popular";

export interface CatalogResultsHeaderConfig {
  enabled?: boolean;
  /** "Showing {count} courses". Empty = a built-in (plural-aware) text. */
  countText?: string;
  /** Singular form, used when count is 1 ("Showing {count} course"). Falls back to countText. */
  countTextOne?: string;
  /** The chip after the count. Default true. */
  showStreamChip?: boolean;
  /** Chip text when no stream is selected. Empty = "All streams". */
  allStreamsLabel?: string;
  /** Which folder text the chip shows for the active stream/category. Default 'title'. */
  streamChipMode?: "title" | "subtitle";
  /** "Sort:" before the current option. Empty = built-in. */
  sortPrefix?: string;
  /** Per-option label overrides ("popular": "Most popular"), used in the box and the menu. */
  sortLabels?: Partial<Record<CatalogHeroSortToken, string>>;
}

export interface CatalogQuickFilterBarConfig {
  /** Visible label before the chips ("Quick filters:"); also the group's accessible name. */
  label?: string;
  /** 'filled' = solid active chip, 12px bold chips. Default 'tint' (today's chips). */
  variant?: "tint" | "filled";
}

export interface CatalogHeroConfig {
  /** Must be true for the page hero band. */
  enabled?: boolean;
  /** Band fill (inline). Default: the site palette's cream (catalogue subtle background without a palette). */
  backgroundColor?: string;
  /** Trail ending at the current page. Absent/empty = no breadcrumb. Never shown on the site's home route. */
  breadcrumb?: CatalogHeroBreadcrumbItem[];
  /** H1. Empty = no H1. */
  title?: string;
  lead?: string;
  /** Live numbers right of the title (max 3). */
  stats?: CatalogHeroStat[];
  search?: CatalogHeroSearchConfig;
  /** Label before the shortcut chips. Empty = "Popular:". */
  popularLabel?: string;
  /** Shortcut chips (max 8). */
  popular?: CatalogHeroPopularChip[];
  /** "Showing N courses" header above the results (independent of `enabled`). */
  resultsHeader?: CatalogResultsHeaderConfig;
  /** Labelled / filled quick-filter chips (independent of `enabled`). */
  quickFilterBar?: CatalogQuickFilterBarConfig;
}
