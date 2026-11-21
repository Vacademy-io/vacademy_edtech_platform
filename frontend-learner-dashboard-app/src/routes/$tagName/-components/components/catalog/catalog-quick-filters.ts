/**
 * Quick filters: one-tap shortcuts to the SAME state the sidebar and sort
 * drive — "Free" is the price filter's Free, "Hindi" the language filter's
 * Hindi, "Popular" the Popular sort. So a chip lights up whenever its filter
 * is on however it got there, and switching it off clears exactly that. Pure.
 */

import {
  DEFAULT_COURSE_CATALOG_SORT,
  type CourseCatalogSortOption,
} from "../../../-types/course-catalogue-types";
import type { ResolvedQuickFilter } from "./catalog-config";
import type { DiscoveryState } from "./catalog-url";

export interface QuickFilterState extends Pick<DiscoveryState, "languages" | "price" | "badges"> {
  sort: CourseCatalogSortOption;
}

export const isQuickFilterActive = (qf: ResolvedQuickFilter, s: QuickFilterState): boolean => {
  switch (qf.kind) {
    case "popular":
      return s.sort === "Popular";
    case "new":
    case "bestseller":
      return s.badges.includes(qf.kind);
    case "free":
      return s.price?.kind === "free";
    case "language":
      return typeof qf.value === "string" && s.languages.includes(qf.value);
    case "priceMax":
      return s.price?.kind === "max" && s.price.max === qf.value;
    default:
      return false;
  }
};

/**
 * The state change a tap makes — only the keys it touches. Switching
 * "Popular" off returns to the section's default sort (or "Newest" when the
 * default itself is Popular).
 */
export const toggleQuickFilter = (
  qf: ResolvedQuickFilter,
  s: QuickFilterState,
  defaultSort: CourseCatalogSortOption,
): Partial<QuickFilterState> => {
  const on = isQuickFilterActive(qf, s);
  switch (qf.kind) {
    case "popular":
      return {
        sort: on ? (defaultSort === "Popular" ? DEFAULT_COURSE_CATALOG_SORT : defaultSort) : "Popular",
      };
    case "new":
    case "bestseller":
      return {
        badges: on ? s.badges.filter((b) => b !== qf.kind) : [...s.badges, qf.kind],
      };
    case "free":
      return { price: on ? null : { kind: "free" } };
    case "language": {
      const code = String(qf.value || "");
      if (!code) return {};
      return { languages: on ? s.languages.filter((c) => c !== code) : [...s.languages, code] };
    }
    case "priceMax":
      return typeof qf.value === "number" ? { price: on ? null : { kind: "max", max: qf.value } } : {};
    default:
      return {};
  }
};
