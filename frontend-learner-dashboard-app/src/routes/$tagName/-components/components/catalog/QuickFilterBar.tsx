import React from "react";
import { useTranslation } from "react-i18next";
import { Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export interface QuickFilterChip {
  id: string;
  label: string;
  active: boolean;
}

// Figma (Brahm Varchas courses, node 1:274): 12px bold pills, 13px label. Exact sizes: design-lint-ignore.
const FILLED_ROW = "mb-5 flex min-w-0 items-center gap-2 sm:mb-7";
const FILLED_LABEL = "hidden shrink-0 whitespace-nowrap text-[13px] font-bold leading-[18px] text-palette-muted sm:inline"; // design-lint-ignore: Figma 13px/18px
const FILLED_CHIP =
  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400";

/** "Popular · New · Free · Hindi · Under ₹1,000" — toggle chips; one scrolling row on phones. */
export const QuickFilterBar: React.FC<{
  chips: QuickFilterChip[];
  onToggle: (id: string) => void;
  /** Opt-in (courseCatalog.hero.quickFilterBar.label): a visible label before the chips, also the group's name. */
  label?: string;
  /** Opt-in: 'filled' = solid active chip (primary fill, white text). Default 'tint' = the chips below. */
  variant?: "tint" | "filled";
}> = ({ chips, onToggle, label, variant = "tint" }) => {
  const { t } = useTranslation("coursePlayerB");
  if (!chips.length) return null;
  if (label || variant === "filled") {
    const groupLabel = label || t("courseCatalog.quickFiltersAriaLabel", "Quick filters");
    return (
      <div className={FILLED_ROW}>
        {label && (
          <span className={FILLED_LABEL} aria-hidden="true">
            {label}
          </span>
        )}
        <div
          className="catalogue-no-scrollbar flex min-w-0 gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible"
          role="group"
          aria-label={groupLabel}
        >
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={chip.active}
              onClick={() => onToggle(chip.id)}
              className={cn(
                variant === "filled" ? FILLED_CHIP : "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-catalogue-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
                chip.active
                  ? variant === "filled"
                    ? "border-palette-primary bg-palette-primary text-white"
                    : "border-primary-500 bg-primary-50 text-catalogue-brand-ink"
                  : variant === "filled"
                    ? "border-palette-border bg-catalogue-bg-elevated text-palette-body hover:border-palette-border-strong hover:text-palette-text"
                    : "border-catalogue-border bg-catalogue-bg-elevated text-catalogue-text-secondary hover:border-catalogue-border-strong hover:text-catalogue-text-primary",
              )}
            >
              {chip.active && <Check size={variant === "filled" ? 12 : 14} weight="bold" aria-hidden="true" />}
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div
      className="catalogue-no-scrollbar mb-4 flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible"
      role="group"
      aria-label={t("courseCatalog.quickFiltersAriaLabel", "Quick filters")}
    >
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          aria-pressed={chip.active}
          onClick={() => onToggle(chip.id)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-catalogue-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
            chip.active
              ? "border-primary-500 bg-primary-50 text-catalogue-brand-ink"
              : "border-catalogue-border bg-catalogue-bg-elevated text-catalogue-text-secondary hover:border-catalogue-border-strong hover:text-catalogue-text-primary",
          )}
        >
          {chip.active && <Check size={14} weight="bold" aria-hidden="true" />}
          {chip.label}
        </button>
      ))}
    </div>
  );
};
