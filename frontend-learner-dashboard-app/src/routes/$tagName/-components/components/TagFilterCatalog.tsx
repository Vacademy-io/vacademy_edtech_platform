import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown, Funnel } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCatalogueSearchParams } from "../../-utils/catalogue-url-state";
import {
  TAG_FILTER_PARAM,
  filterOptionCounts,
  itemMatchesSelection,
  normalizeFilterTag,
  resolveFilterGroups,
  resolveSelectedTags,
  type FilterItem,
} from "../../-utils/tag-filter";
import { FilterSection } from "./CourseCatalogComponent";
import { TagFilterBar } from "./TagFilterColumns";

/** Literal class lists so Tailwind keeps them (cards per row on large screens). */
const GRID_CLASS: Record<number, string> = {
  2: "grid grid-cols-2 gap-4 sm:gap-6",
  3: "grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6",
  4: "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6",
};

/**
 * The page's tag filter, at the place of the column layout that hosts it:
 * every tagged column of the page in ONE grid, filtered by the chips
 * (single pick) or by the Courses-page style sidebar (checkbox groups, OR
 * inside a group, AND across groups). The picks live in ?tag=, comma list.
 */
export const TagFilterCatalog: React.FC<{
  items: FilterItem[];
  pageTags: string[];
  style?: "chips" | "sidebar";
  groups?: unknown;
  columns?: number;
  allLabel?: string;
  renderItem: (item: FilterItem) => React.ReactNode;
}> = ({ items, pageTags, style = "chips", groups: rawGroups, columns, allLabel, renderItem }) => {
  const { t } = useTranslation("coursePlayerA");
  const { t: tCatalog } = useTranslation("coursePlayerB");
  const { getList, update } = useCatalogueSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebar = style === "sidebar";

  const picked = resolveSelectedTags(getList(TAG_FILTER_PARAM), pageTags);
  // Chips pick one tag; a shared link with several keeps the first.
  const selected = sidebar ? picked : picked.slice(0, 1);
  const groups = sidebar
    ? resolveFilterGroups(rawGroups, pageTags, t("jsonRenderer.tagFilterOtherGroup"))
    : [{ label: "", tags: pageTags }];
  const shown = items.filter((it) => itemMatchesSelection(it.tags, selected, groups));
  const counts = sidebar ? filterOptionCounts(items, selected, groups) : undefined;
  const setSelected = (next: string[]) => update({ [TAG_FILTER_PARAM]: next.length ? next : null });
  const toggle = (key: string) => {
    const tag = pageTags.find((x) => normalizeFilterTag(x) === key);
    if (!tag) return;
    const on = selected.some((s) => normalizeFilterTag(s) === key);
    setSelected(on ? selected.filter((s) => normalizeFilterTag(s) !== key) : [...selected, tag]);
  };

  const perRow = columns === 2 || columns === 3 || columns === 4 ? columns : sidebar ? 3 : 4;
  const grid = shown.length ? (
    <div className={GRID_CLASS[perRow]}>
      {shown.map((it) => (
        <div key={`${it.layoutId}:${it.slotIndex}`} className="min-w-0">
          {renderItem(it)}
        </div>
      ))}
    </div>
  ) : (
    <div className="rounded-catalogue-lg border border-dashed border-catalogue-border px-6 py-12 text-center">
      <p className="text-sm text-catalogue-text-secondary">{t("jsonRenderer.tagFilterNoMatch")}</p>
      <button type="button" className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm mt-4" onClick={() => setSelected([])}>
        {tCatalog("courseCatalog.clearAll")}
      </button>
    </div>
  );

  if (!sidebar) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        {pageTags.length > 0 && (
          <TagFilterBar
            tags={pageTags}
            active={selected[0] ?? null}
            allLabel={allLabel}
            onPick={(tag) => setSelected(tag ? [tag] : [])}
          />
        )}
        {grid}
      </div>
    );
  }

  const panel = (
    <div className="catalogue-surface rounded-catalogue-lg border border-catalogue-border-subtle p-4 shadow-sm sm:p-5">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-catalogue-text-primary">{tCatalog("courseCatalog.filters")}</h2>
        <Button onClick={() => setSelected([])} disabled={!selected.length} className="mt-px h-fit px-2 py-1 text-xs transition">
          {tCatalog("courseCatalog.clearAll")}
        </Button>
      </div>
      {groups.map((g) => (
        <FilterSection
          key={g.label}
          title={g.label}
          items={g.tags.map((tag) => ({ id: normalizeFilterTag(tag), name: tag }))}
          selectedItems={selected.map(normalizeFilterTag)}
          handleChange={toggle}
          counts={counts}
        />
      ))}
    </div>
  );

  return (
    // Full width with side padding, as the Courses page grid (books keep their size).
    <div className="flex w-full flex-col gap-4 px-4 sm:px-6 lg:flex-row lg:gap-6 lg:px-8">
      <aside className="w-full lg:w-64 lg:flex-shrink-0" aria-label={t("jsonRenderer.tagFilterLabel")}>
        {/* Phones: a Filters button opens the panel; large screens: always open, sticky. */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          className="flex w-full items-center justify-between rounded-catalogue-sm bg-catalogue-bg-subtle p-2 transition-colors hover:bg-catalogue-interactive-hover lg:hidden"
        >
          <span className="flex items-center gap-2">
            <Funnel size={16} className="text-catalogue-text-secondary" />
            <span className="text-sm font-medium text-catalogue-text-primary">{tCatalog("courseCatalog.filters")}</span>
            {selected.length > 0 && <span className="catalogue-badge catalogue-badge-primary rounded-full">{selected.length}</span>}
          </span>
          <CaretDown size={14} className={`text-catalogue-text-muted transition-transform ${mobileOpen ? "rotate-180" : ""}`} />
        </button>
        <div className={`${mobileOpen ? "mt-3 block" : "hidden"} lg:sticky lg:top-24 lg:mt-0 lg:block`}>{panel}</div>
      </aside>
      <div className="min-w-0 flex-1">{grid}</div>
    </div>
  );
};
