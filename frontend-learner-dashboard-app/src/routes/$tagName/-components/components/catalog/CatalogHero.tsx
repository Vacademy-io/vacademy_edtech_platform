import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { CatalogueLink } from "../../CatalogueLink";
import { useCatalogueTag } from "../../CatalogueTagContext";
import { RouteMatcher } from "../../../-services/route-matcher";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";
import { isHomePreviewPath, usePreviewPath } from "../../../-utils/preview-path";

/*
 * The Courses page hero (courseCatalog.hero, Figma node 1:69 "Hero + Search"):
 * cream band → breadcrumb, H1 + lead with live stats on the right, a large
 * search box with a Search button, and "Popular:" shortcut chips.
 * Presentational: the slot hook (slots/use-hero-slots.tsx) owns the data.
 *
 * Exact Figma sizes are kept in the class constants below (design-lint-ignore);
 * colours come from the site palette (text-palette-*), which falls back to the
 * catalogue tokens on a site without one.
 */

const BAND_INNER = "flex flex-col gap-5 pb-8 pt-8 sm:gap-6 sm:pb-10 sm:pt-12";
const CRUMB = "text-[13px] leading-5 text-palette-muted"; // design-lint-ignore: Figma 13px/20px
const H1 =
  "text-[32px] font-bold leading-[40px] text-palette-text sm:text-[40px] sm:leading-[48px] lg:text-[44px] lg:leading-[52px]"; // design-lint-ignore: Figma 44px/52px
const LEAD = "text-[15px] leading-6 text-palette-body sm:text-[17px] sm:leading-[27px]"; // design-lint-ignore: Figma 17px/27px
const STAT_NUMBER = "text-[22px] font-bold leading-7 text-palette-primary"; // design-lint-ignore: Figma 22px/28px
const SEARCH_BOX =
  "flex items-center gap-3 rounded-[12px] border border-palette-border-strong bg-catalogue-bg-elevated py-1.5 pe-1.5 ps-4 shadow-[0_4px_14px_hsl(var(--catalogue-text-primary)/0.06)] transition-shadow focus-within:ring-2 focus-within:ring-primary-400/40 sm:rounded-[14px] sm:py-2 sm:pe-2 sm:ps-5"; // design-lint-ignore: Figma radius 14px, shadow 0 4 14 6%
const SEARCH_INPUT =
  "min-w-0 flex-1 truncate bg-transparent text-[15px] leading-[22px] text-palette-text placeholder:text-palette-muted focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"; // design-lint-ignore: Figma 15px/22px
const SEARCH_BUTTON =
  "shrink-0 rounded-[8px] bg-palette-primary px-4 py-2.5 text-sm font-normal text-white transition-colors hover:bg-palette-primary/90 active:bg-palette-primary/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 sm:px-[22px] sm:py-3"; // design-lint-ignore: Figma 8px radius, 22px padding
const POPULAR_ROW =
  "catalogue-no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0";
const POPULAR_LABEL = "shrink-0 whitespace-nowrap text-[13px] font-bold leading-[18px] text-palette-muted"; // design-lint-ignore: Figma 13px/18px
const CHIP =
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-normal transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400";
const CHIP_IDLE =
  "border-palette-border bg-catalogue-bg-elevated text-palette-body hover:border-palette-border-strong hover:text-palette-text";
const CHIP_ACTIVE = "border-palette-primary bg-palette-primary text-white";

const trimPath = (path: string) => (path || "").replace(/\/+$/, "").toLowerCase();

/**
 * Is `pathname` the site's home page? The base ("/<tag>", or "/" when
 * root-mounted) and the home page's own route ("/<tag>/home",
 * "/<tag>/homepage"), which renders the same page.
 */
export const isSiteHomePath = (pathname: string, tagName: string): boolean => {
  const path = trimPath(pathname);
  const base = trimPath(RouteMatcher.pagePath(tagName, ""));
  if (path === base) return true;
  const cut = path.lastIndexOf("/");
  return cut >= 0 && path.slice(0, cut) === base && RouteMatcher.normalizeRoute(path.slice(cut + 1)) === "home";
};

/** The breadcrumb, never on the site's home route (the home page reuses the courses section). */
const HeroBreadcrumb: React.FC<{ items: BreadcrumbItem[]; tagName: string }> = ({ items, tagName }) => {
  const pathname = useLocation({ select: (location) => location.pathname });
  const tag = useCatalogueTag(tagName);
  const previewPath = usePreviewPath();
  const onHome = previewPath !== undefined ? isHomePreviewPath(previewPath) : isSiteHomePath(pathname, tag);
  if (onHome) return null;
  return (
    <Breadcrumb
      items={items}
      className={CRUMB}
      currentClassName="text-palette-muted"
      linkClassName="hover:text-palette-text hover:underline"
    />
  );
};

export interface CatalogHeroStatView {
  key: string;
  /** Formatted number; null = still loading (shimmer). */
  value: string | null;
  label: string;
}

export type CatalogHeroChipView =
  | { key: string; label: string; type: "toggle"; active: boolean; onClick: () => void }
  | { key: string; label: string; type: "link"; route: string };

export interface CatalogHeroProps {
  backgroundColor: string | null;
  breadcrumb: BreadcrumbItem[];
  title: string;
  lead: string;
  stats: CatalogHeroStatView[];
  /** Search box; null = none. */
  search: {
    value: string;
    placeholder: string;
    buttonText: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    onClear: () => void;
  } | null;
  popularLabel: string;
  chips: CatalogHeroChipView[];
  /** Style for the content container (lines up with the catalog's column). */
  shellStyle?: React.CSSProperties;
  /** The section's tag (fallback for the home-route check). */
  tagName: string;
  /** The section's own palette vars (courseCatalog.palette); undefined = none. */
  paletteStyle?: React.CSSProperties;
}

export const CatalogHero: React.FC<CatalogHeroProps> = ({
  backgroundColor,
  breadcrumb,
  title,
  lead,
  stats,
  search,
  popularLabel,
  chips,
  shellStyle,
  tagName,
  paletteStyle,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const h1Id = useId();
  const inputId = useId();
  const hasTitleRow = !!(title || lead || stats.length);
  return (
    <section
      className="w-full bg-palette-cream"
      aria-labelledby={title ? h1Id : undefined}
      data-catalog-hero=""
      // The section palette (the hero sits outside the section root), then an
      // author-picked band fill (validated colour), else the palette cream.
      style={
        paletteStyle || backgroundColor
          ? { ...paletteStyle, ...(backgroundColor ? { backgroundColor } : {}) }
          : undefined
      }
    >
      <div className={cn("catalogue-shell", BAND_INNER)} style={shellStyle}>
        {breadcrumb.length > 0 && <HeroBreadcrumb items={breadcrumb} tagName={tagName} />}

        {hasTitleRow && (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
            {(title || lead) && (
              <div className="flex min-w-0 flex-col gap-2.5">
                {title && (
                  <h1 id={h1Id} className={H1}>
                    {title}
                  </h1>
                )}
                {lead && <p className={LEAD}>{lead}</p>}
              </div>
            )}
            {stats.length > 0 && (
              <ul className="flex shrink-0 flex-wrap gap-x-7 gap-y-3">
                {stats.map((stat) => (
                  <li key={stat.key} className="flex flex-col items-start gap-0.5">
                    {stat.value === null ? (
                      <span className="catalogue-skeleton-shimmer my-0.5 inline-block h-6 w-8 rounded" aria-hidden="true" />
                    ) : (
                      <span className={STAT_NUMBER}>{stat.value}</span>
                    )}
                    <span className="text-xs text-palette-muted">{stat.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {search && (
          <form
            role="search"
            className={SEARCH_BOX}
            onSubmit={(e) => {
              e.preventDefault();
              search.onSubmit(search.value);
            }}
          >
            <MagnifyingGlass size={20} className="shrink-0 text-palette-muted2" aria-hidden="true" />
            <label htmlFor={inputId} className="sr-only">
              {search.placeholder}
            </label>
            <input
              id={inputId}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              value={search.value}
              placeholder={search.placeholder}
              onChange={(e) => search.onChange(e.target.value)}
              className={SEARCH_INPUT}
            />
            {search.value && (
              <button
                type="button"
                onClick={search.onClear}
                aria-label={t("common.clearSearch")}
                className="shrink-0 rounded-full p-1 text-palette-muted transition-colors hover:text-palette-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
            <button type="submit" className={SEARCH_BUTTON}>
              {search.buttonText}
            </button>
          </form>
        )}

        {chips.length > 0 && (
          <div className={POPULAR_ROW} role="group" aria-label={popularLabel.replace(/[:：]\s*$/, "")}>
            <span className={POPULAR_LABEL} aria-hidden="true">
              {popularLabel}
            </span>
            {chips.map((chip) =>
              chip.type === "link" ? (
                <CatalogueLink key={chip.key} to={chip.route} target="_self" className={cn(CHIP, CHIP_IDLE)}>
                  {chip.label}
                </CatalogueLink>
              ) : (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={chip.active}
                  onClick={chip.onClick}
                  className={cn(CHIP, chip.active ? CHIP_ACTIVE : CHIP_IDLE)}
                >
                  {chip.label}
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </section>
  );
};
