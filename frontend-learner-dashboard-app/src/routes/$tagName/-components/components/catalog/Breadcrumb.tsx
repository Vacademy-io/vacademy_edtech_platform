import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CatalogueLink } from "../../CatalogueLink";

export interface BreadcrumbItem {
  /** Visible text. Authored props arrive already localized (localizeComponentProps); pass live data through siteT first. */
  label: string;
  /** Site route or URL (CatalogueLink rules). The last item is the current page and is never a link. */
  route?: string;
}

export interface BreadcrumbProps {
  items: ReadonlyArray<BreadcrumbItem> | null | undefined;
  /** Classes for the <nav>. Default: 13px muted text. */
  className?: string;
  /** Classes for each linked item (hover colour etc.). */
  linkClassName?: string;
  /** Classes for the current (last) item. */
  currentClassName?: string;
  /** Separator glyph between items. Default "/". */
  separator?: React.ReactNode;
  /** Accessible name of the landmark. Default t('courseCatalog.breadcrumbAriaLabel'). */
  ariaLabel?: string;
}

/** Drops items without a label; null when nothing is left to show. */
export const visibleBreadcrumbItems = (
  items: ReadonlyArray<BreadcrumbItem> | null | undefined,
): BreadcrumbItem[] =>
  (Array.isArray(items) ? items : [])
    .filter((item): item is BreadcrumbItem => !!item && typeof item.label === "string" && item.label.trim() !== "")
    .map((item) => ({
      label: item.label.trim(),
      route: typeof item.route === "string" && item.route.trim() ? item.route.trim() : undefined,
    }));

/**
 * "Home / Courses" — a breadcrumb trail (shared by the courses hero and the
 * learning-paths hero). A <nav> landmark with an ordered list; earlier items
 * with a route are links (CatalogueLink keeps ?lang= and the site prefix),
 * the last item is the current page (aria-current="page"). Renders nothing
 * for an empty trail.
 */
export const Breadcrumb: React.FC<BreadcrumbProps> = ({
  items,
  className,
  linkClassName,
  currentClassName,
  separator = "/",
  ariaLabel,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const trail = visibleBreadcrumbItems(items);
  if (!trail.length) return null;
  return (
    <nav
      aria-label={ariaLabel || t("courseCatalog.breadcrumbAriaLabel", "Breadcrumb")}
      className={cn("text-sm text-catalogue-text-muted", className)}
    >
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {trail.map((item, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${i}-${item.label}`} className="inline-flex items-center gap-x-2">
              {last || !item.route ? (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(last && "text-catalogue-text-secondary", last && currentClassName)}
                >
                  {item.label}
                </span>
              ) : (
                <CatalogueLink
                  to={item.route}
                  target="_self"
                  className={cn("transition-colors hover:text-catalogue-text-primary", linkClassName)}
                >
                  {item.label}
                </CatalogueLink>
              )}
              {!last && <span aria-hidden="true">{separator}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
