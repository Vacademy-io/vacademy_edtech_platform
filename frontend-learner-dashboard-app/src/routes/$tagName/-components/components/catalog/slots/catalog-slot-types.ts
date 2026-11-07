/**
 * RENDER SLOTS of the Courses grid (CourseCatalogComponent).
 *
 * The component builds one read-only CatalogSlotContext per render and hands
 * it to five feature hooks (use-<feature>-slots.tsx). Each hook returns ONLY
 * the slot outputs its feature owns (enforced by the Pick<> types below); the
 * component renders an output where present and its original markup where
 * absent. With every hook returning NO_SLOTS — as on every site that sets
 * none of the opt-in props — the markup is byte-identical to before
 * (catalog/__golden__ proves it).
 *
 * Rules for feature hooks (see specs/CONTRACT.md):
 *  - Return NO_SLOTS (or an object without the key) unless the section opted
 *    in through its own prop. Never change a default.
 *  - Node outputs are THUNKS (() => ReactNode): they are called while the
 *    component renders its JSX, after every value in the context exists
 *    (renderCourseCard included). Do not call ctx.renderCourseCard in the hook
 *    body itself — call it inside a thunk or inside a child component.
 *  - Hooks may use React hooks (state, memo, queries) — they run on every
 *    render of the section, before its loading early-return, in a fixed order.
 */

import type React from "react";
import type { useTranslation } from "react-i18next";
import type { CourseCatalogSortOption } from "../../../../-types/course-catalogue-types";
import type { CourseBadge } from "../../../../-utils/course-badges";
import type { StoreSale } from "../../../site-cart/store-sale";
import type { CatalogCourseRow, CourseCatalogComponentProps } from "../../CourseCatalogComponent";
import type { CatalogDiscoveryConfig, ResolvedBadgeRules } from "../catalog-config";
import type { CardPriceView, CatalogCard } from "../catalog-cards";
import type { AppliedChip, CatalogCriteria, FacetGroup } from "../catalog-filters";
import type { CatalogCategory, CatalogStream } from "../catalog-streams";
import type { DiscoveryState, PriceChoice } from "../catalog-url";
import type { StreamTabs } from "../StreamTabs";

export type CatalogT = ReturnType<typeof useTranslation>["t"];
export type CatalogCardModel = CatalogCard<CatalogCourseRow>;

/** The props the component passes to the default <StreamTabs>. */
export type StreamTabsProps = React.ComponentProps<typeof StreamTabs>;

/** Options of renderCourseCard. The legacy card honours keyPrefix only; the rest are for the editorial card (feature 'cards'). */
export interface CourseCardRenderOptions {
  /** Prefixed to the React key (a second list of the same cards, e.g. "free-"). */
  keyPrefix?: string;
  /** Visible CTA text override ("Start free"; the card adds its own arrow). Editorial card only. */
  ctaLabel?: string;
  /** Extra pill on the image ("Free"). Editorial card only. */
  imageBadge?: string;
}

export type RenderCourseCard = (
  card: CatalogCardModel,
  index: number,
  opts?: CourseCardRenderOptions,
) => React.ReactNode;

/** One labelled filter option list (raw values; labels already display-ready). */
export interface SlotFilterItem {
  id: string;
  name: string;
}

export interface CatalogSlotContext {
  /* ── inputs ─────────────────────────────────────────────────────────── */
  /** The section's props exactly as JsonRenderer passed them (authored text already localized). */
  props: Readonly<CourseCatalogComponentProps>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalSettings: any;
  instituteId: string;
  tagName: string;
  /** react-i18next t of the coursePlayerB namespace. */
  t: CatalogT;
  /** Site dictionary (live data and globalSettings text → visitor language). */
  siteT: (text: string) => string;
  /** Visitor's site locale ("en", "hi"…). */
  siteLocale: string;
  /** Courses or folder streams still loading (the component shows its skeleton). */
  isLoading: boolean;

  /* ── layout ─────────────────────────────────────────────────────────── */
  /** The section root (scroll target of page changes and tab switches). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** The results (main) column — scroll target for "Search" / "See all". */
  resultsRef: React.RefObject<HTMLDivElement | null>;
  /** The card grid element. */
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** Resolved content width (px, gutters excluded) or null: props.contentMaxWidth, else globalSettings.theme.contentMaxWidth. */
  contentMaxWidth: number | null;
  /**
   * Style for a feature's own `.catalogue-shell` container so it lines up with
   * the catalog's content column (sets --catalogue-content-max); undefined
   * when no width is set — then use the class alone.
   */
  shellStyle: React.CSSProperties | undefined;

  /* ── discovery + data ───────────────────────────────────────────────── */
  discovery: CatalogDiscoveryConfig;
  courses: CatalogCourseRow[];
  streamList: CatalogStream[];
  activeStream: CatalogStream | null;
  activeCategories: CatalogCategory[];
  discoveryState: DiscoveryState;
  setDiscoveryState: (patch: Partial<DiscoveryState>, opts?: { push?: boolean }) => void;
  /** What a stream tab does (push history, clear categories, scroll back to the grid). */
  selectStream: (slug: string | null) => void;
  /** Every card (after language grouping), unfiltered — catalogue totals. */
  allCards: CatalogCardModel[];
  /** Cards matching every active filter, unsorted. */
  matchedCards: CatalogCardModel[];
  /** matchedCards sorted — what the grid lists across its pages. */
  filteredCards: CatalogCardModel[];
  /** The current page of filteredCards (what the default grid shows). */
  paginatedCards: CatalogCardModel[];
  criteria: CatalogCriteria;
  facetGroups: FacetGroup<CatalogCardModel, CatalogCourseRow>[];
  /** Live option counts (showFilterCounts) or null. */
  facetCounts: Record<string, Record<string, number>> | null;
  /** Changes whenever the result set changes (search, filters, sort, stream…) — reset paging on it. */
  filterKey: string;
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  setCurrentPage: (next: number | ((prev: number) => number)) => void;

  /* ── search + sort ──────────────────────────────────────────────────── */
  searchTerm: string;
  /** Live typing (debounced ?q= write when syncUrl). */
  setSearchTerm: (term: string) => void;
  /** Submit: set the term AND write ?q= now (no debounce) when syncUrl. Does not scroll. */
  commitSearch: (term: string) => void;
  effectiveSort: CourseCatalogSortOption;
  sortOptions: readonly CourseCatalogSortOption[];
  changeSort: (next: CourseCatalogSortOption) => void;
  /** The visitor-language label of a sort option (the dropdown's own text). */
  sortLabel: (option: CourseCatalogSortOption) => string;

  /* ── quick filters + applied chips ──────────────────────────────────── */
  quickChips: { id: string; label: string; active: boolean }[];
  toggleQuick: (id: string) => void;
  appliedChips: AppliedChip[];
  removeChip: (chip: AppliedChip) => void;
  clearAllFilters: () => void;
  hasActiveFilters: boolean;
  filterBadgeCount: number;

  /* ── filter panel ───────────────────────────────────────────────────── */
  filtersEnabled: boolean;
  /** The sidebar (and phone sheet) renders at all. */
  showFiltersPanel: boolean;
  mobileFilterSheet: boolean;
  openFilterSheet: () => void;
  /** The default group fragments, as rendered today (sidebar + phone sheet). */
  defaultFilterGroups: { discovery: React.ReactNode; legacy: React.ReactNode };
  /** Everything the default groups are built from, for a re-styled rendering of the same filters. */
  filterData: {
    showCategoryFilter: boolean;
    showLanguageFilter: boolean;
    showPriceChoiceFilter: boolean;
    presentLanguages: string[];
    priceChoices: { value: string; choice: PriceChoice }[];
    priceChoiceLabel: (choice: PriceChoice) => string;
    languageName: (code: string) => string;
    toggleCategory: (slug: string) => void;
    toggleLanguage: (code: string) => void;
    selectPrice: (value: string) => void;
    /** Legacy groups (filtersConfig): shown?, options (display names), selection and toggle. */
    legacy: {
      level: { shown: boolean; title: string; items: SlotFilterItem[]; selected: string[]; toggle: (id: string) => void };
      session: { shown: boolean; title: string; items: SlotFilterItem[]; selected: string[]; toggle: (id: string) => void };
      tags: { shown: boolean; title: string; items: SlotFilterItem[]; selected: string[]; toggle: (id: string) => void };
      instructor: { shown: boolean; title: string; items: SlotFilterItem[]; selected: string[]; toggle: (id: string) => void };
      /** filtersConfig price range: heading + the original min / max inputs (same state as the default card). */
      priceRange: { shown: boolean; title: string; inputs: React.ReactNode };
    };
  };

  /* ── cards ──────────────────────────────────────────────────────────── */
  /** The grid's card renderer (the 'cards' feature's renderCard first, else the legacy card). */
  renderCourseCard: RenderCourseCard;
  /** Opens a course (details page or its authored page) — the card click. */
  handleCourseClick: (course: CatalogCourseRow) => void;
  /** Merged-version price views (groupLanguageVersions), keyed by card. */
  priceViews: Map<CatalogCardModel, CardPriceView<CatalogCourseRow> | null>;
  /** Enrolment ranks (empty unless something on the section needs them). */
  ranks: Map<string, number>;
  badgeRules: ResolvedBadgeRules | null;
  displayBadges: Map<string, CourseBadge[]>;
  /** The language a grouped card opens in (null without grouping). */
  preferredLanguage: string | null;
  siteCartOn: boolean;
  storeSale: StoreSale;
}

/**
 * Every slot. Absent key = the original markup at that place.
 * OWNER in brackets — a feature hook may only return its own keys.
 */
export interface CatalogSlotOutputs {
  /* [hero] */
  /** Above the section root (outside scrollRef), also while loading. */
  catalogHero?: () => React.ReactNode;
  /** Skip the accent bar + h2 + subtitle title block. */
  hideTitleBlock?: boolean;
  /** Replaces the search + sort toolbar card at the top of the results column. */
  resultsHeader?: () => React.ReactNode;
  /** Replaces <QuickFilterBar> (labelled / restyled quick filters). */
  quickFilterBar?: () => React.ReactNode;

  /* [tabs] */
  /** Renders the stream tabs instead of <StreamTabs {...props}> (only called when streams are on). */
  streamTabs?: (props: StreamTabsProps) => React.ReactNode;
  /** 'band' = render the tabs full-bleed at the top of the section root, outside the content container. Default 'inline'. */
  streamTabsPlacement?: "inline" | "band";
  /** Replaces the section root's className ("py-8 sm:py-10 bg-catalogue-bg-subtle w-full") — the loading skeleton's root too. */
  rootClassName?: string;
  /** Whether the rendered tabs stick under the header (sets the sidebar's sticky offset). Default discovery.streams.sticky. */
  streamTabsSticky?: boolean;
  /** 'band' placement only: a placeholder band at the top of the loading skeleton, so the page does not shift when the tabs arrive. */
  loadingStreamTabs?: () => React.ReactNode;

  /* [sidebar] */
  /** Replaces the sidebar/results flex row's className. */
  columnsClassName?: string;
  /** Replaces the sidebar column's className. */
  sidebarColumnClassName?: string;
  /** Inline style for the sidebar column (e.g. a width CSS var). */
  sidebarColumnStyle?: React.CSSProperties;
  /** Replaces the sticky wrapper's className inside the sidebar column. */
  sidebarStickyClassName?: string;
  /** Inside the sticky wrapper, before the filter card. */
  sidebarTop?: () => React.ReactNode;
  /** Replaces the whole filter card (header + groups). Render filterGroups yourself. */
  sidebarPanel?: () => React.ReactNode;
  /** Inside the sticky wrapper, after the filter card (promo card). */
  sidebarBottom?: () => React.ReactNode;
  /** Replaces {discoveryFilterGroups}{legacyFilterGroups} in the default card AND the phone sheet. */
  filterGroups?: () => React.ReactNode;
  /** Replaces the results column's className. */
  mainColumnClassName?: string;

  /* [sections] */
  /** In the results column, after the applied-filter chips, before the grid heading. */
  beforeGrid?: () => React.ReactNode;
  /** In the results column, after the pagination block. */
  afterGrid?: () => React.ReactNode;

  /* [cards] */
  /** Right before the grid. */
  gridHeading?: () => React.ReactNode;
  /** Replaces the grid's className. */
  gridClassName?: string;
  /** Renders one card; return undefined to fall back to the legacy card. */
  renderCard?: (card: CatalogCardModel, index: number, opts?: CourseCardRenderOptions) => React.ReactNode | undefined;
  /** Cards the grid lists instead of the current page (load-more). */
  visibleCards?: CatalogCardModel[];
  /** Replaces the numbered pagination block. */
  pagination?: () => React.ReactNode;
  /** Replaces the loading skeleton's card grid. */
  loadingGrid?: () => React.ReactNode;
}

export type HeroSlotOutputs = Pick<CatalogSlotOutputs, "catalogHero" | "hideTitleBlock" | "resultsHeader" | "quickFilterBar">;
export type TabsSlotOutputs = Pick<
  CatalogSlotOutputs,
  "streamTabs" | "streamTabsPlacement" | "rootClassName" | "streamTabsSticky" | "loadingStreamTabs"
>;
export type SidebarSlotOutputs = Pick<
  CatalogSlotOutputs,
  | "columnsClassName"
  | "sidebarColumnClassName"
  | "sidebarColumnStyle"
  | "sidebarStickyClassName"
  | "sidebarTop"
  | "sidebarPanel"
  | "sidebarBottom"
  | "filterGroups"
  | "mainColumnClassName"
>;
export type SectionsSlotOutputs = Pick<CatalogSlotOutputs, "beforeGrid" | "afterGrid">;
export type CardsSlotOutputs = Pick<
  CatalogSlotOutputs,
  "gridHeading" | "gridClassName" | "renderCard" | "visibleCards" | "pagination" | "loadingGrid"
>;

/** The "nothing to add" result — every site without the feature's prop. */
export const NO_SLOTS: Readonly<Record<string, never>> = Object.freeze({});
