import React from "react";
import { useTranslation } from "react-i18next";
import { Funnel, X } from "@phosphor-icons/react";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ThemedPortalSurface } from "./ThemedPortalSurface";

/**
 * Below lg the Courses page's filters live in a bottom sheet behind a
 * "Filters (n)" button; the sheet holds the very same filter groups as the
 * desktop sidebar, so both always agree.
 */
export const MobileFiltersButton: React.FC<{ count: number; onClick: () => void }> = ({ count, onClick }) => {
  const { t } = useTranslation("coursePlayerB");
  return (
    <button
      type="button"
      onClick={onClick}
      className="catalogue-btn catalogue-btn-secondary w-full sm:w-auto lg:hidden"
      aria-haspopup="dialog"
    >
      <Funnel size={16} aria-hidden="true" />
      {count > 0
        ? t("courseCatalog.filtersWithCount", { count, defaultValue: "Filters ({{count}})" })
        : t("courseCatalog.filters")}
    </button>
  );
};

export const MobileFilterSheet: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Any element inside the catalogue section (finds the theme for the sheet). */
  themeAnchor: React.RefObject<HTMLElement | null>;
  resultCount: number;
  canClear: boolean;
  onClearAll: () => void;
  children: React.ReactNode;
}> = ({ open, onOpenChange, themeAnchor, resultCount, canClear, onClearAll, children }) => {
  const { t } = useTranslation("coursePlayerB");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        aria-describedby={undefined}
        className="border-0 bg-transparent p-0 shadow-none"
      >
        <ThemedPortalSurface
          anchor={themeAnchor}
          className="flex max-h-screen-85 flex-col rounded-t-catalogue-xl bg-catalogue-bg text-catalogue-text-primary"
        >
          <div className="flex items-center justify-between border-b border-catalogue-border-subtle px-4 py-3">
            <SheetTitle className="text-base font-semibold text-catalogue-text-primary">
              {t("courseCatalog.filters")}
            </SheetTitle>
            <SheetClose
              className="catalogue-tap flex h-9 w-9 items-center justify-center rounded-catalogue-full text-catalogue-text-secondary hover:bg-catalogue-interactive-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              aria-label={t("courseCatalog.closeFilters", "Close filters")}
            >
              <X size={18} aria-hidden="true" />
            </SheetClose>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">{children}</div>
          <div className="catalogue-mobile-cta flex gap-2 border-t border-catalogue-border-subtle px-4 pt-3">
            <button
              type="button"
              onClick={onClearAll}
              disabled={!canClear}
              className="catalogue-btn catalogue-btn-secondary flex-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("courseCatalog.clearAll")}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="catalogue-btn catalogue-btn-primary flex-1"
            >
              {t("courseCatalog.showResultsCount", {
                count: resultCount,
                defaultValue: "Show results ({{count}})",
              })}
            </button>
          </div>
        </ThemedPortalSurface>
      </SheetContent>
    </Sheet>
  );
};
