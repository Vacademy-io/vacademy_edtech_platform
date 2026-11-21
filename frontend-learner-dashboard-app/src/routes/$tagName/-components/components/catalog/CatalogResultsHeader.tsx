import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown, MagnifyingGlass, X } from "@phosphor-icons/react";
import { MobileFiltersButton } from "./MobileFilterSheet";

/*
 * The results header (courseCatalog.hero.resultsHeader, Figma node 1:265
 * "Toolbar"): "Showing N courses" + the current-stream chip on the left, a
 * boxed "Sort: Most popular" on the right. The box is a native <select>
 * stretched invisibly over the visible label, so the OS picker and keyboard
 * keep working. Replaces the search/sort toolbar card; presentational.
 */

const ROW = "mb-5 flex scroll-mt-24 flex-col gap-3 sm:mb-7 sm:flex-row sm:items-center sm:justify-between";
const COUNT = "text-[15px] font-bold leading-[22px] text-palette-text"; // design-lint-ignore: Figma 15px/22px
const STREAM_CHIP =
  "inline-block max-w-full truncate rounded-full align-middle bg-palette-sand py-[5px] pe-2.5 ps-3 text-xs font-normal text-palette-primary"; // design-lint-ignore: Figma py 5px
const SORT_BOX =
  "relative inline-flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-[10px] border border-palette-border bg-catalogue-bg-elevated px-3.5 text-[13px] leading-[18px] text-palette-text focus-within:ring-2 focus-within:ring-primary-400 sm:h-[38px] sm:flex-none sm:justify-start"; // design-lint-ignore: Figma 38px box, radius 10px, 13px/18px

export interface CatalogResultsHeaderProps {
  /** Already-filled count line ("Showing 22 courses"). */
  countLabel: string;
  /** Chip text; null = no chip. */
  chipLabel: string | null;
  sort: {
    value: string;
    options: { value: string; label: string }[];
    /** The visible "Sort: Most popular" text. */
    display: string;
    ariaLabel: string;
    onChange: (value: string) => void;
  };
  /** The phone "Filters (n)" button; null = none. */
  filters: { count: number; onOpen: () => void } | null;
  /** A compact search input (only when the hero has no search box); null = none. */
  search: { value: string; placeholder: string; onChange: (value: string) => void } | null;
}

/** How long the count must hold still before the live region speaks it. */
export const COUNT_ANNOUNCE_DELAY_MS = 500;

/**
 * `value`, once it has held still for `delayMs`: the hero search filters as
 * the visitor types, and a screen reader should hear the count once, not
 * after every letter.
 */
const useSettled = (value: string, delayMs: number): string => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (settled === value) return;
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, settled, delayMs]);
  return settled;
};

export const CatalogResultsHeader = React.forwardRef<HTMLDivElement, CatalogResultsHeaderProps>(
  ({ countLabel, chipLabel, sort, filters, search }, ref) => {
    const { t } = useTranslation("coursePlayerB");
    const announced = useSettled(countLabel, COUNT_ANNOUNCE_DELAY_MS);
    return (
      <div ref={ref} className={ROW} data-catalog-results-header="">
        <span className="sr-only" aria-live="polite" aria-atomic="true" data-catalog-results-live="">
          {announced}
        </span>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
          <span className={COUNT}>{countLabel}</span>
          {chipLabel && <span className={STREAM_CHIP}>{chipLabel}</span>}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
          {search && (
            <div className="relative min-w-0 basis-full sm:w-56 sm:basis-auto">
              <MagnifyingGlass
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-palette-muted2"
              />
              <input
                type="search"
                value={search.value}
                placeholder={search.placeholder}
                aria-label={search.placeholder}
                onChange={(e) => search.onChange(e.target.value)}
                className="h-10 w-full rounded-catalogue-md border border-palette-border bg-catalogue-bg-elevated pe-8 ps-9 text-sm text-palette-text placeholder:text-palette-muted focus:outline-none focus:ring-2 focus:ring-primary-400 sm:h-9 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {search.value && (
                <button
                  type="button"
                  onClick={() => search.onChange("")}
                  aria-label={t("common.clearSearch")}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 text-palette-muted hover:text-palette-text"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          <label className={SORT_BOX}>
            <span className="truncate whitespace-nowrap" aria-hidden="true">
              {sort.display}
            </span>
            <CaretDown size={10} weight="fill" className="shrink-0 text-palette-muted" aria-hidden="true" />
            <select
              value={sort.value}
              aria-label={sort.ariaLabel}
              onChange={(e) => sort.onChange(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
            >
              {sort.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {filters && (
            <div className="shrink-0 lg:hidden">
              <MobileFiltersButton count={filters.count} onClick={filters.onOpen} />
            </div>
          )}
        </div>
      </div>
    );
  },
);
CatalogResultsHeader.displayName = "CatalogResultsHeader";
