import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatLaunchDate, openComingSoonForm } from "../../../../-utils/coming-soon";
import { useCourseFormats } from "../../../../-utils/course-format";
import {
  buildEditorialCardView,
  descriptionPlaceholders,
  editorialPriceRow,
  fillTemplate,
  resolveCardDesign,
  resolveGridHeading,
  resolveLoadMore,
  type EditorialCardDeps,
} from "../catalog-card-view";
import { rowsMatchingGroups } from "../catalog-filters";
import { formatAmountLabel } from "../catalog-format";
import { SORT_URL_TOKENS } from "../catalog-url";
import { CatalogGridHeading } from "../CatalogGridHeading";
import { EditorialCardSkeleton, EditorialCourseCard } from "../EditorialCourseCard";
import { LoadMorePagination } from "../LoadMorePagination";
import { NO_SLOTS, type CatalogSlotContext, type CardsSlotOutputs } from "./catalog-slot-types";

/**
 * Slot hook of FEATURE 'cards' (specs/course-cards-grid.json). OWNED BY THAT FEATURE — the only
 * catalog wiring file it edits (see specs/CONTRACT.md for the slot list).
 *
 * Three independent opt-ins under courseCatalog.render (each absent = the
 * original markup at its place, so every other site renders as before):
 *  - cardStyle "editorial" → renderCard (EditorialCourseCard), gridClassName,
 *    loadingGrid;
 *  - pagination.mode "loadMore" → visibleCards (the first N batches) and
 *    pagination (Load more + "Showing N of M"); paging resets whenever the
 *    result set changes (ctx.filterKey) and never scrolls;
 *  - gridHeading {…} → gridHeading ("All courses · Sorted by …").
 */

/** Figma grid: 3 x 264 px columns, 20 px column gap, 16 px row gap. */
export const EDITORIAL_GRID_CLASS = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4 mb-6";

/** The sorts that order merged cards by their price view (catalog-sort priceOf). */
const PRICE_SORTS: ReadonlySet<string> = new Set(["Price: Low to High", "Price: High to Low"]);

const SORTED_BY_DEFAULTS: Record<string, string> = {
  popular: "Sorted by most popular",
  newest: "Sorted by newest",
  oldest: "Sorted by oldest",
  "price-asc": "Sorted by price: low to high",
  "price-desc": "Sorted by price: high to low",
  rating: "Sorted by rating",
  "name-asc": "Sorted by name (A–Z)",
  "name-desc": "Sorted by name (Z–A)",
};

export const useCardsSlots = (ctx: CatalogSlotContext): CardsSlotOutputs => {
  const render = ctx.props.render;
  const design = useMemo(() => resolveCardDesign(render), [render]);
  const loadMore = useMemo(() => resolveLoadMore(render), [render]);
  const heading = useMemo(() => resolveGridHeading(render), [render]);
  const { formats } = useCourseFormats(design ? ctx.globalSettings : null);
  // Load-more batches, back to one whenever the result set changes.
  const [more, setMore] = useState({ key: ctx.filterKey, batches: 1 });
  const batches = more.key === ctx.filterKey ? more.batches : 1;
  // Only for the "no description" placeholder of every loaded language (no refetch on a language switch).
  const { i18n } = useTranslation("coursePlayerB");

  if (!design && !loadMore && !heading) return NO_SLOTS;

  const { t, siteT } = ctx;
  const tt = (key: string, opts?: Record<string, unknown> | string): string =>
    String(t(key, opts as never));
  const out: CardsSlotOutputs = {};

  if (design) {
    const imageFit =
      (render?.styles as { imageFit?: string } | undefined)?.imageFit === "contain" ? "contain" : "cover";
    const deps: EditorialCardDeps = {
      design,
      formats,
      streams: ctx.streamList,
      languages: ctx.discovery.languages,
      activeLanguage: ctx.preferredLanguage,
      paymentEnabled: ctx.globalSettings?.payment?.enabled !== false,
      imageFit,
      siteT,
      t: tt,
      formatAmount: (amount, currency) => formatAmountLabel(amount, currency, ctx.siteLocale),
      formatLaunch: (date) => formatLaunchDate(date, ctx.siteLocale) ?? null,
      descriptionPlaceholder: descriptionPlaceholders(tt("courseCatalog.noDescriptionAvailable"), i18n),
    };
    out.renderCard = (card, index, opts) => {
      const course = card.primary;
      // A merged card prices (Free pill, CTA) consistently with the grid's price
      // sorts and filters (ctx.priceViews) — see editorialPriceRow. Single-version
      // cards have no entry and price their own (primary) row.
      const priceView = ctx.priceViews.get(card);
      const priceRow = priceView
        ? editorialPriceRow(card, priceView, rowsMatchingGroups(card, ctx.facetGroups), PRICE_SORTS.has(ctx.effectiveSort))
        : null;
      const view = buildEditorialCardView(card, deps, { ...opts, priceRow });
      // The legacy card's React key, so a list keeps its identity across styles.
      const cardKey = ctx.discovery.grouping
        ? `course-${card.courseId}`
        : course.enrollInviteId ?? `${course.id}-${course.packageSessionId ?? ""}-${index}`;
      const comingSoon = view.comingSoon;
      return (
        <EditorialCourseCard
          key={opts?.keyPrefix ? `${opts.keyPrefix}${cardKey}` : cardKey}
          view={view}
          index={index}
          onOpen={() => ctx.handleCourseClick(course)}
          onCta={
            comingSoon
              ? () => {
                  if (!openComingSoonForm(comingSoon, tt("comingSoon.notifyTitle", { title: view.title }))) {
                    ctx.handleCourseClick(course);
                  }
                }
              : undefined
          }
        />
      );
    };
    out.gridClassName = EDITORIAL_GRID_CLASS;
    const skeletons = Math.min(loadMore?.pageSize ?? 9, 12);
    out.loadingGrid = () => (
      <div className={EDITORIAL_GRID_CLASS}>
        {Array.from({ length: skeletons }, (_, i) => (
          <EditorialCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (loadMore) {
    const total = ctx.filteredCards.length;
    const shown = Math.min(batches * loadMore.pageSize, total);
    out.visibleCards = ctx.filteredCards.slice(0, shown);
    out.pagination = () =>
      total > 0 ? (
        <LoadMorePagination
          shown={shown}
          total={total}
          onLoadMore={() => setMore({ key: ctx.filterKey, batches: batches + 1 })}
          label={
            loadMore.loadMoreLabel
              ? siteT(loadMore.loadMoreLabel)
              : tt("catalogCards.loadMore", "Load more courses")
          }
          countText={
            loadMore.countLabel
              ? fillTemplate(siteT(loadMore.countLabel), { shown, total })
              : tt("catalogCards.showingOf", { shown, total, defaultValue: "Showing {{shown}} of {{total}}" })
          }
          gridRef={ctx.gridRef}
          borderColor={design?.colors.loadMoreBorder}
        />
      ) : null;
  }

  if (heading) {
    const token = SORT_URL_TOKENS[ctx.effectiveSort];
    const authoredNote = heading.sortLabels[ctx.effectiveSort];
    const note = !heading.showSort
      ? null
      : authoredNote
        ? siteT(authoredNote)
        : tt(`catalogCards.sortedBy.${token}`, SORTED_BY_DEFAULTS[token] ?? "");
    const title = heading.title ? siteT(heading.title) : tt("catalogCards.allCourses", "All courses");
    out.gridHeading = () =>
      ctx.filteredCards.length > 0 ? <CatalogGridHeading title={title} note={note} /> : null;
  }

  return out;
};
