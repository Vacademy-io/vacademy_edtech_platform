/**
 * Courses-page sort. Pure.
 *
 * The comparators are the catalogue's original ones applied to a card's
 * primary version (a card without grouping IS its row), plus "Popular":
 * ranked courses by enrolment rank, the rest after them in their current
 * order. Array.prototype.sort is stable, so ties keep catalogue order.
 */

import type { TFunction } from "i18next";
import { comparePopularity } from "../../../-utils/course-badges";
import type { CourseCatalogSortOption } from "../../../-types/course-catalogue-types";
import type { CatalogCard, CatalogRowLike } from "./catalog-cards";
import { SORT_URL_TOKENS } from "./catalog-url";

/** Milliseconds for a created_at value; missing or unparseable sorts as the epoch. */
export const createdTime = (value: string | null | undefined): number => {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Rows with `createdAt` (read by the Newest / Oldest sorts and the "New"
 * badge) taken from the search API's created_at — only for a section that
 * opted into discovery (`dated`). The API used to send no date, so an older
 * grid showed the search's own order under "Newest" and "Oldest" alike; such
 * a section gets its rows back untouched and keeps exactly that order.
 */
export const withCreatedAt = <R extends { created_at?: unknown; createdAt?: string }>(
  rows: R[],
  dated: boolean,
): R[] =>
  dated
    ? rows.map((row) =>
        typeof row.created_at === "string" && row.created_at && row.createdAt !== row.created_at
          ? { ...row, createdAt: row.created_at }
          : row,
      )
    : rows;

/**
 * A sort's visitor-facing name (react-i18next chrome, so it follows the site
 * language): courseCatalog.sort.<its ?sort= token>, with the option itself as
 * the English default. The option's value stays the stored English name.
 */
export const sortOptionLabel = (t: TFunction, option: CourseCatalogSortOption): string =>
  t(`courseCatalog.sort.${SORT_URL_TOKENS[option]}`, option);

/** The id with the best (lowest) rank; the first id when none is ranked. */
export const bestRankedId = (ids: string[], ranks: Map<string, number>): string => {
  let best = ids[0];
  for (const id of ids) {
    const rank = ranks.get(id);
    const bestRank = ranks.get(best);
    if (rank !== undefined && (bestRank === undefined || rank < bestRank)) best = id;
  }
  return best;
};

export const sortCatalogCards = <R extends CatalogRowLike>(
  cards: CatalogCard<R>[],
  sort: CourseCatalogSortOption,
  opts: {
    ranks: Map<string, number>;
    titleOf: (card: CatalogCard<R>) => string;
    /** The price a card shows (merged cards: given the active filters). Default: card.sortPrice. */
    priceOf?: (card: CatalogCard<R>) => number;
  },
): CatalogCard<R>[] => {
  const out = [...cards];
  const priceOf = opts.priceOf ?? ((card: CatalogCard<R>) => card.sortPrice);
  switch (sort) {
    case "Newest":
      out.sort((a, b) => createdTime(b.primary.createdAt) - createdTime(a.primary.createdAt));
      break;
    case "Oldest":
      out.sort((a, b) => createdTime(a.primary.createdAt) - createdTime(b.primary.createdAt));
      break;
    case "Price: Low to High":
      out.sort((a, b) => priceOf(a) - priceOf(b));
      break;
    case "Price: High to Low":
      out.sort((a, b) => priceOf(b) - priceOf(a));
      break;
    case "Rating":
      out.sort((a, b) => b.primary.rating - a.primary.rating);
      break;
    case "Name A-Z":
      out.sort((a, b) => opts.titleOf(a).localeCompare(opts.titleOf(b)));
      break;
    case "Name Z-A":
      out.sort((a, b) => opts.titleOf(b).localeCompare(opts.titleOf(a)));
      break;
    case "Popular": {
      const byRank = comparePopularity(opts.ranks);
      // A card folding several packages (version groups) ranks by its best one.
      const idOf = (card: CatalogCard<R>) => (card.courseIds ? bestRankedId(card.courseIds, opts.ranks) : card.courseId);
      out.sort((a, b) => byRank(idOf(a), idOf(b)));
      break;
    }
  }
  return out;
};
