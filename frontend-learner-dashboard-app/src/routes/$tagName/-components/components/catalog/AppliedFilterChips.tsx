import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "@phosphor-icons/react";
import type { AppliedChip } from "./catalog-filters";

/** Toolbar row: one removable chip per applied filter, then "Clear all". */
export const AppliedFilterChips: React.FC<{
  chips: AppliedChip[];
  onRemove: (chip: AppliedChip) => void;
  onClearAll: () => void;
}> = ({ chips, onRemove, onClearAll }) => {
  const { t } = useTranslation("coursePlayerB");
  if (!chips.length) return null;
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2"
      role="group"
      aria-label={t("courseCatalog.appliedFilters", "Applied filters")}
    >
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex max-w-full items-center gap-1 rounded-catalogue-full border border-primary-200 bg-primary-50 py-1 pe-1 ps-3 text-xs font-medium text-catalogue-brand-ink"
        >
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            onClick={() => onRemove(chip)}
            aria-label={t("courseCatalog.removeFilter", {
              label: chip.label,
              defaultValue: "Remove filter: {{label}}",
            })}
            className="catalogue-tap flex h-5 w-5 shrink-0 items-center justify-center rounded-catalogue-full hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <X size={12} weight="bold" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="catalogue-link text-xs font-semibold"
      >
        {t("courseCatalog.clearAll")}
      </button>
    </div>
  );
};
