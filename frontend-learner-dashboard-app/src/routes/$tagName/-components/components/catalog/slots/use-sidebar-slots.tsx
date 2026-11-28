import React, { useId, useMemo, useState } from "react";
import { CaretDown, Funnel } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { NO_SLOTS, type CatalogSlotContext, type SidebarSlotOutputs } from "./catalog-slot-types";
import {
  DEFAULT_GROUP_ORDER,
  LEGACY_GROUP_ORDER,
  categoriesInScope,
  orderGroupIds,
  resolveFilterSidebar,
  type ResolvedFilterSidebar,
} from "../catalog-sidebar-config";
import { customGroupId, type ResolvedCustomFilter } from "../catalog-custom-filters";
import { GROUP_IDS, categoryOptions, countFacetOptions, customOptions } from "../catalog-filters";
import { formatPriceParam } from "../catalog-url";
import type { CatalogCategory } from "../catalog-streams";
import { DiscoveryFilterGroup } from "../DiscoveryFilterGroup";
import { EditorialFilterGroup, type EditorialFilterOption } from "../EditorialFilterGroup";
import { SidebarPromoCard } from "../SidebarPromoCard";

/**
 * Slot hook of FEATURE 'sidebar' (specs/filter-sidebar.json, Figma courses
 * node 1:136 "Left column"). OWNED BY THAT FEATURE.
 *
 *  - courseCatalog.filterSidebar.variant 'editorial' → the Figma filter card
 *    (Filters + Clear all, uppercase foldable sections in the authored order,
 *    18px checkboxes, counts, greyed zero rows, show-more) in a 280px column,
 *    the same groups in the phone sheet, and the dark app promo card below.
 *  - courseCatalog.customFilters WITHOUT the editorial variant → the original
 *    sidebar plus the authored groups in the original group style.
 *  - neither → NO_SLOTS (the original sidebar, byte-identical).
 */

// Exact Figma values the token scale lacks.
const COLUMN_WIDTH = "lg:w-[var(--fs-width)]"; // design-lint-ignore: authored sidebar width (default 280px)
const PANEL = "w-full rounded-[18px] border border-palette-border bg-white p-5"; // design-lint-ignore: Figma 18px radius
const PANEL_TITLE = "text-[17px] font-bold leading-6 text-palette-text"; // design-lint-ignore: Figma 17px / 24px

type Groups = { id: string; node: (flushTop: boolean) => React.ReactNode }[];

const NO_CATEGORIES: CatalogCategory[] = [];

/** Is a custom group showing counts? Its own flag, else the section's showFilterCounts. */
const groupShowsCounts = (g: ResolvedCustomFilter, sectionCounts: boolean) => g.showCounts ?? sectionCounts;

export const useSidebarSlots = (ctx: CatalogSlotContext): SidebarSlotOutputs => {
  const sidebar = useMemo(() => resolveFilterSidebar(ctx.props.filterSidebar), [ctx.props.filterSidebar]);
  const custom = ctx.discovery.customFilters;
  const categoryFilter = ctx.discovery.categoryFilter;

  // The categories the group lists (scope 'all': every stream's on "All").
  const scope = useMemo(
    () => (sidebar ? categoriesInScope(categoryFilter, ctx.streamList, ctx.activeStream) : NO_CATEGORIES),
    [sidebar, categoryFilter, ctx.streamList, ctx.activeStream],
  );
  // The UNFILTERED course count of each category: sort 'count' orders by it (rows
  // never jump while filtering), and a category no course is in is not listed.
  const totals = useMemo(
    () => (sidebar && scope.length ? countFacetOptions(ctx.allCards, [], GROUP_IDS.category, categoryOptions(scope)) : null),
    [sidebar, scope, ctx.allCards],
  );
  // The same for the authored groups: an option no course has (Format "Audio Book"
  // with no audio book) is not listed; one that is 0 only under other filters stays, greyed.
  const customTotals = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    if (!ctx.allCards.length) return out;
    for (const g of custom) out[g.id] = countFacetOptions(ctx.allCards, [], customGroupId(g.id), customOptions(g.options));
    return out;
  }, [custom, ctx.allCards]);
  // Live counts of the authored groups (each against every OTHER active filter).
  const customCounts = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const g of custom) {
      if (!groupShowsCounts(g, ctx.discovery.showFilterCounts)) continue;
      out[g.id] = countFacetOptions(ctx.allCards, ctx.facetGroups, customGroupId(g.id), customOptions(g.options));
    }
    return out;
  }, [custom, ctx.discovery.showFilterCounts, ctx.allCards, ctx.facetGroups]);

  if (!sidebar && !custom.length) return NO_SLOTS;

  const { t, siteT, discoveryState, setDiscoveryState } = ctx;
  const selectedOf = (id: string) => discoveryState.custom?.[id] ?? [];
  const toggleCustom = (groupId: string, optionId: string) => {
    const list = selectedOf(groupId);
    setDiscoveryState({
      custom: {
        ...discoveryState.custom,
        [groupId]: list.includes(optionId) ? list.filter((o) => o !== optionId) : [...list, optionId],
      },
    });
  };
  const customRows = (g: ResolvedCustomFilter) => {
    const counts = customCounts[g.id];
    const total = customTotals[g.id];
    const selected = selectedOf(g.id);
    return g.options
      .map((o) => ({ option: o, count: counts?.[o.id] }))
      .filter(({ option }) => !total || (total[option.id] ?? 0) > 0 || selected.includes(option.id))
      .filter(({ option, count }) => g.showEmpty || count === undefined || count > 0 || selected.includes(option.id))
      .map(({ option, count }) => ({
        value: option.id,
        label: g.labelFromSite ? siteT(option.label) : option.label,
        count,
      }));
  };

  /* ── the original sidebar + authored groups (no editorial variant) ── */
  if (!sidebar) {
    if (!ctx.filtersEnabled) return NO_SLOTS;
    return {
      filterGroups: () => (
        <>
          {ctx.defaultFilterGroups.discovery}
          {custom.map((g) => (
            <DiscoveryFilterGroup
              key={g.id}
              title={g.label}
              mode="multi"
              options={customRows(g)}
              selected={selectedOf(g.id)}
              onToggle={(value) => toggleCustom(g.id, value)}
            />
          ))}
          {ctx.defaultFilterGroups.legacy}
        </>
      ),
    };
  }

  /* ── editorial variant ──────────────────────────────────────────── */
  const groups = buildEditorialGroups(ctx, sidebar, {
    scope,
    totals,
    customRows,
    selectedOf,
    toggleCustom,
    customCounts,
  });
  const renderGroups = (flushFirst: boolean) => groups.map((g, i) => (
    <React.Fragment key={g.id}>{g.node(flushFirst && i === 0)}</React.Fragment>
  ));
  const stickyTop = ctx.discovery.streams?.sticky ? "lg:sticky lg:top-40" : "lg:sticky lg:top-20";
  const clearAll = sidebar.clearAllLabel || t("catalogSidebar.clearAll", "Clear all");

  return {
    columnsClassName: `flex flex-col ${ctx.showFiltersPanel ? "lg:flex-row" : ""} gap-4 lg:gap-10`,
    sidebarColumnClassName: cn(
      ctx.mobileFilterSheet && "hidden lg:block",
      "order-1 w-full lg:flex-shrink-0",
      COLUMN_WIDTH,
    ),
    sidebarColumnStyle: { "--fs-width": `${sidebar.width}px` } as React.CSSProperties,
    sidebarStickyClassName: cn("flex flex-col gap-5", sidebar.sticky && stickyTop),
    sidebarPanel: () => (
      <EditorialPanel
        ctx={ctx}
        title={sidebar.title || t("catalogSidebar.filters", "Filters")}
        clearAll={clearAll}
        // Without the phone sheet the card itself folds behind a toggle below lg.
        foldOnPhone={!ctx.mobileFilterSheet}
      >
        {renderGroups(false)}
      </EditorialPanel>
    ),
    // The phone sheet has its own title bar and Clear all: groups only.
    filterGroups: () => <div data-filter-sidebar="editorial">{renderGroups(true)}</div>,
    // The promo is a desktop card (with the phone sheet the whole column is
    // hidden below lg); without the sheet keep it off phones as well.
    ...(sidebar.promo
      ? {
          sidebarBottom: () =>
            ctx.mobileFilterSheet ? (
              <SidebarPromoCard promo={sidebar.promo!} />
            ) : (
              <div className="hidden lg:block">
                <SidebarPromoCard promo={sidebar.promo!} />
              </div>
            ),
        }
      : {}),
    mainColumnClassName: ctx.showFiltersPanel ? "order-2 w-full min-w-0 lg:flex-1" : "w-full",
  };
};

/**
 * The editorial filter card. With `foldOnPhone` (a section without the phone
 * filter sheet) it starts folded below lg behind a "Filters" toggle, with a
 * "Show results" button that folds it again — as the original card does.
 */
const EditorialPanel: React.FC<{
  ctx: CatalogSlotContext;
  title: string;
  clearAll: string;
  foldOnPhone: boolean;
  children: React.ReactNode;
}> = ({ ctx, title, clearAll, foldOnPhone, children }) => {
  const [phoneOpen, setPhoneOpen] = useState(false);
  const bodyId = useId();
  const { t } = ctx;
  return (
    <div className={PANEL} data-filter-sidebar="editorial">
      {foldOnPhone && (
        <button
          type="button"
          aria-expanded={phoneOpen}
          aria-controls={bodyId}
          onClick={() => setPhoneOpen((v) => !v)}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-catalogue-xs text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 lg:hidden",
            phoneOpen && "mb-3.5",
          )}
          data-filter-sidebar-toggle=""
        >
          <span className="flex items-center gap-2">
            <Funnel size={16} aria-hidden="true" className="text-palette-muted" />
            <span className={PANEL_TITLE}>{title}</span>
            {ctx.hasActiveFilters && (
              <span className="catalogue-badge catalogue-badge-primary rounded-full">{ctx.filterBadgeCount}</span>
            )}
          </span>
          <CaretDown
            size={14}
            aria-hidden="true"
            className={cn("text-palette-muted transition-transform", phoneOpen && "rotate-180")}
          />
        </button>
      )}
      <div id={bodyId} className={foldOnPhone ? cn("lg:block", phoneOpen ? "block" : "hidden") : undefined}>
        <div className="flex items-center justify-between gap-3 pb-3.5">
          <h2 className={cn(PANEL_TITLE, foldOnPhone && "hidden lg:block")}>{title}</h2>
          <button
            type="button"
            onClick={ctx.hasActiveFilters ? ctx.clearAllFilters : undefined}
            aria-disabled={!ctx.hasActiveFilters}
            className="ms-auto rounded-catalogue-xs text-xs font-bold text-palette-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            {clearAll}
          </button>
        </div>
        {children}
        {foldOnPhone && (
          <button
            type="button"
            onClick={() => setPhoneOpen(false)}
            className="mt-4 w-full rounded-catalogue-sm bg-palette-primary px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 lg:hidden"
          >
            {t("courseCatalog.showResults", "Show results")}
          </button>
        )}
      </div>
    </div>
  );
};

/** The editorial groups this section shows, in the authored order. */
function buildEditorialGroups(
  ctx: CatalogSlotContext,
  sidebar: ResolvedFilterSidebar,
  data: {
    scope: CatalogCategory[];
    totals: Record<string, number> | null;
    customRows: (g: ResolvedCustomFilter) => { value: string; label: string; count?: number }[];
    selectedOf: (id: string) => string[];
    toggleCustom: (groupId: string, optionId: string) => void;
    customCounts: Record<string, Record<string, number>>;
  },
): Groups {
  const { t, siteT, discovery, discoveryState, filterData, facetCounts } = ctx;
  const common = {
    collapsible: sidebar.collapsible,
    showLessLabel: sidebar.showLessLabel || undefined,
    dividerColor: sidebar.dividerColor,
    boxColor: sidebar.checkboxColor,
  };
  const withCounts = (count: number | undefined): Pick<EditorialFilterOption, "count" | "disabled"> => ({
    count,
    disabled: count === 0,
  });
  const byId: Record<string, Groups[number]["node"]> = {};

  // CATEGORY: bilingual labels, count order, coming-soon hidden, show-all limit.
  if (filterData.showCategoryFilter) {
    const cf = discovery.categoryFilter;
    let list = cf.hideComingSoon
      ? data.scope.filter((c) => !c.comingSoon || discoveryState.categories.includes(c.slug))
      : data.scope;
    // No course in it (and not a coming-soon placeholder): nothing to filter by.
    const totals = data.totals;
    if (totals && ctx.allCards.length) {
      list = list.filter((c) => c.comingSoon || (totals[c.slug] ?? 0) > 0 || discoveryState.categories.includes(c.slug));
    }
    if (totals && cf.sort === "count") {
      list = list
        .map((c, i) => ({ c, i }))
        .sort((a, b) => (totals[b.c.slug] ?? 0) - (totals[a.c.slug] ?? 0) || a.i - b.i)
        .map(({ c }) => c);
    }
    const label = (c: CatalogCategory): React.ReactNode => {
      const title = siteT(c.title || c.subtitle || c.slug);
      if (cf.labelMode === "subtitle") return siteT(c.subtitle || c.title || c.slug);
      const sub = cf.labelMode === "both" && c.subtitle ? siteT(c.subtitle) : "";
      return sub && sub !== title ? (
        <>
          <span>{title}</span>
          <span className="ms-2">{sub}</span>
        </>
      ) : (
        title
      );
    };
    if (list.length) {
      byId.category = (flushTop) => (
        <EditorialFilterGroup
          {...common}
          flushTop={flushTop}
          id="category"
          title={cf.label || t("courseCatalog.categories", "Categories")}
          options={list.map((c) => ({ value: c.slug, label: label(c), ...withCounts(facetCounts?.category[c.slug]) }))}
          selected={discoveryState.categories}
          onToggle={filterData.toggleCategory}
          visibleCount={cf.visibleCount}
          showAllLabel={cf.showAllLabel || sidebar.showMoreLabel || undefined}
        />
      );
    }
  }

  if (filterData.showLanguageFilter) {
    byId.language = (flushTop) => (
      <EditorialFilterGroup
        {...common}
        flushTop={flushTop}
        id="language"
        title={discovery.languageFilter.label || t("courseCatalog.language", "Language")}
        options={filterData.presentLanguages.map((code) => ({
          value: code,
          label: filterData.languageName(code),
          ...withCounts(facetCounts?.language[code]),
        }))}
        selected={discoveryState.languages}
        onToggle={filterData.toggleLanguage}
      />
    );
  }

  // PRICE: checkboxes (at most one on) with priceFilter.control 'checkbox', else radios + "Any price".
  if (filterData.showPriceChoiceFilter) {
    const checkbox = discovery.priceFilter.control === "checkbox";
    byId.price = (flushTop) => (
      <EditorialFilterGroup
        {...common}
        flushTop={flushTop}
        id="price"
        title={discovery.priceFilter.label || t("courseCatalog.price", "Price")}
        mode={checkbox ? "multi" : "single"}
        anyLabel={checkbox ? undefined : t("courseCatalog.priceAny", "Any price")}
        onClear={() => ctx.setDiscoveryState({ price: null })}
        options={filterData.priceChoices.map(({ value, choice }) => ({
          value,
          label: filterData.priceChoiceLabel(choice),
          ...withCounts(facetCounts?.price[value]),
        }))}
        selected={discoveryState.price ? [formatPriceParam(discoveryState.price) || ""] : []}
        onToggle={filterData.selectPrice}
      />
    );
  }

  // Authored groups (FORMAT, FOR…).
  if (ctx.filtersEnabled) {
    for (const g of discovery.customFilters) {
      const counted = !!data.customCounts[g.id];
      const rows = data.customRows(g);
      if (!rows.length) continue;
      byId[g.id] = (flushTop) => (
        <EditorialFilterGroup
          {...common}
          boxColor={counted ? sidebar.checkboxColor : sidebar.checkboxSoftColor ?? sidebar.checkboxColor}
          flushTop={flushTop}
          id={g.id}
          title={g.label}
          options={rows.map((r) => ({ value: r.value, label: r.label, ...(counted ? withCounts(r.count) : {}) }))}
          selected={data.selectedOf(g.id)}
          onToggle={(value) => data.toggleCustom(g.id, value)}
          visibleCount={g.visibleCount ?? undefined}
          showAllLabel={g.showAllLabel || sidebar.showMoreLabel || undefined}
        />
      );
    }
  }

  // The legacy filtersConfig groups (level / session / tags / instructor), same state.
  for (const key of ["level", "session", "tags", "instructor"] as const) {
    const legacy = filterData.legacy[key];
    if (!legacy.shown || !legacy.items.length) continue;
    const counts = facetCounts?.[key];
    byId[key] = (flushTop) => (
      <EditorialFilterGroup
        {...common}
        flushTop={flushTop}
        id={key}
        title={legacy.title}
        options={legacy.items.map((item) => ({ value: item.id, label: item.name, ...withCounts(counts?.[item.id]) }))}
        selected={legacy.selected}
        onToggle={legacy.toggle}
        visibleCount={3}
        showAllLabel={sidebar.showMoreLabel || undefined}
      />
    );
  }

  // The filtersConfig price range: its original min / max inputs in an editorial section.
  const range = filterData.legacy.priceRange;
  if (range.shown) {
    byId.priceRange = (flushTop) => (
      <EditorialFilterGroup
        {...common}
        flushTop={flushTop}
        id="priceRange"
        title={range.title}
        options={[]}
        selected={[]}
        onToggle={() => {}}
      >
        {range.inputs}
      </EditorialFilterGroup>
    );
  }

  const available = [
    ...DEFAULT_GROUP_ORDER,
    ...discovery.customFilters.map((g) => g.id),
    ...LEGACY_GROUP_ORDER,
  ].filter((id) => !!byId[id]);
  return orderGroupIds(available, sidebar.order).map((id) => ({ id, node: byId[id] }));
}
