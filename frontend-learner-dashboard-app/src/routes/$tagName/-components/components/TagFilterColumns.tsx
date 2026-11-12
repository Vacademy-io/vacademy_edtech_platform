import React from "react";
import { useTranslation } from "react-i18next";
import { useCatalogueSearchParams } from "../../-utils/catalogue-url-state";
import {
  TAG_FILTER_PARAM,
  columnMatchesFilter,
  normalizeFilterTag,
  resolveActiveFilterTag,
} from "../../-utils/tag-filter";

/** The chip row: "All" plus one chip per tag on the page. */
export const TagFilterBar: React.FC<{
  tags: string[];
  active: string | null;
  allLabel?: string;
  onPick: (tag: string | null) => void;
}> = ({ tags, active, allLabel, onPick }) => {
  const { t } = useTranslation("coursePlayerA");
  const activeKey = active ? normalizeFilterTag(active) : null;
  return (
    <div
      className="mx-auto mb-8 flex max-w-5xl flex-wrap justify-center gap-2 px-4"
      role="group"
      aria-label={t("jsonRenderer.tagFilterLabel")}
    >
      {[null, ...tags].map((tag) => {
        const isActive = tag === null ? activeKey === null : normalizeFilterTag(tag) === activeKey;
        return (
          <button
            key={tag ?? "__all"}
            type="button"
            aria-pressed={isActive}
            onClick={() => onPick(tag)}
            className={`catalogue-btn catalogue-btn-sm ${isActive ? "catalogue-btn-primary" : "catalogue-btn-secondary"}`}
          >
            {tag ?? (allLabel?.trim() || t("jsonRenderer.tagFilterAll"))}
          </button>
        );
      })}
    </div>
  );
};

/**
 * A column layout that takes part in the page's tag filter. The picked chip
 * is read from the URL, so every tagged layout on the page follows the same
 * chip; a layout with no matching column renders nothing (its filter bar, if
 * it hosts one, stays).
 */
export const FilterableColumnLayout: React.FC<{
  pageTags: string[];
  tagLists: string[][];
  showBar: boolean;
  allLabel?: string;
  renderGrid: (isVisible: (index: number) => boolean) => React.ReactNode;
}> = ({ pageTags, tagLists, showBar, allLabel, renderGrid }) => {
  const { get, update } = useCatalogueSearchParams();
  const active = resolveActiveFilterTag(get(TAG_FILTER_PARAM), pageTags);
  const isVisible = (index: number) => columnMatchesFilter(tagLists, index, active);
  const anyVisible = tagLists.length === 0 || tagLists.some((_, i) => isVisible(i));
  const bar = showBar && pageTags.length > 0 && (
    <TagFilterBar
      tags={pageTags}
      active={active}
      allLabel={allLabel}
      onPick={(tag) => update({ [TAG_FILTER_PARAM]: tag })}
    />
  );
  if (!bar && !anyVisible) return null;
  return (
    <>
      {bar}
      {anyVisible && renderGrid(isVisible)}
    </>
  );
};
