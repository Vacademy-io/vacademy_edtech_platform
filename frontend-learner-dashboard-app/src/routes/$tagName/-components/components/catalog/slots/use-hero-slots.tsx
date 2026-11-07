import { useMemo, useRef, type CSSProperties } from "react";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import type { CourseCatalogSortOption } from "../../../../-types/course-catalogue-types";
import { buildPaletteVars } from "../../../../-utils/catalogue-palette";
import { CatalogHero, type CatalogHeroChipView, type CatalogHeroStatView } from "../CatalogHero";
import { CatalogResultsHeader } from "../CatalogResultsHeader";
import { QuickFilterBar } from "../QuickFilterBar";
import { fillCount, resolveCatalogHero, type ResolvedPopularChip } from "../catalog-hero-config";
import { findStream, type CatalogCategory, type CatalogStream } from "../catalog-streams";
import { SORT_URL_TOKENS } from "../catalog-url";
import { NO_SLOTS, type CatalogSlotContext, type HeroSlotOutputs } from "./catalog-slot-types";

/**
 * Slot hook of FEATURE 'hero' (specs/courses-hero-results-header.json).
 *
 * courseCatalog.hero opts a section into (independently):
 *  - `enabled: true` → the cream page hero above the section (catalogHero,
 *    also while loading) and, when the section has no title, no title block;
 *  - `resultsHeader.enabled: true` (or the hero search) → "Showing N courses"
 *    + stream chip + boxed sort in place of the toolbar card;
 *  - `quickFilterBar` → the labelled / filled quick filters.
 * A section without `hero` gets NO_SLOTS: the original markup.
 */

const formatNumber = (n: number, locale: string): string => {
  try {
    return new Intl.NumberFormat(locale || undefined).format(n);
  } catch {
    return String(n);
  }
};

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export const useHeroSlots = (ctx: CatalogSlotContext): HeroSlotOutputs => {
  const heroProp = ctx.props.hero;
  const cfg = useMemo(() => resolveCatalogHero(heroProp), [heroProp]);
  const headerRef = useRef<HTMLDivElement | null>(null);
  if (!cfg) return NO_SLOTS;

  const { t, siteT } = ctx;
  const coursesTerm = () => getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase();
  const courseTerm = () => getTerminology(ContentTerms.Course, SystemTerms.Course).toLowerCase();

  // "Search" / a shortcut: bring the results (their header) into view.
  const scrollToResults = () => {
    const el = headerRef.current ?? ctx.resultsRef.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const out: HeroSlotOutputs = {};

  if (cfg.band) {
    const band = cfg.band;
    if (!String(ctx.props.title ?? "").trim()) out.hideTitleBlock = true;

    out.catalogHero = () => {
      // courseCatalog.palette only reaches the section root; the hero renders
      // outside it, so it carries the same vars itself (none = undefined).
      const sectionPalette = buildPaletteVars(ctx.props.palette, { mode: ctx.globalSettings?.mode });
      const paletteStyle = Object.keys(sectionPalette).length ? (sectionPalette as CSSProperties) : undefined;
      const categoriesCount = ctx.streamList.reduce((sum, s) => sum + s.categories.length, 0);
      const statValue = (kind: string): number =>
        kind === "courses" ? ctx.allCards.length : kind === "streams" ? ctx.streamList.length : categoriesCount;
      const statLabel = (kind: string): string =>
        kind === "courses"
          ? t("catalogHero.statCourses", { courses: coursesTerm(), defaultValue: "{{courses}}" })
          : kind === "streams"
            ? t("catalogHero.statStreams", "streams")
            : t("catalogHero.statCategories", "categories");
      const stats: CatalogHeroStatView[] = band.stats.map((s, i) => ({
        key: `${s.kind}-${i}`,
        value: ctx.isLoading ? null : formatNumber(statValue(s.kind), ctx.siteLocale),
        label: s.label || statLabel(s.kind),
      }));

      const chips = band.popular
        .map((chip, i) => chipView(chip, i))
        .filter((c): c is CatalogHeroChipView => !!c);

      return (
        <CatalogHero
          backgroundColor={band.backgroundColor}
          breadcrumb={band.breadcrumb}
          title={band.title}
          lead={band.lead}
          stats={stats}
          search={
            band.search
              ? {
                  value: ctx.searchTerm,
                  placeholder:
                    band.search.placeholder ||
                    t("catalogHero.searchPlaceholder", {
                      courses: coursesTerm(),
                      defaultValue: "Search {{courses}}, topics or teachers",
                    }),
                  buttonText: band.search.buttonText || t("catalogHero.searchButton", "Search"),
                  onChange: ctx.setSearchTerm,
                  onSubmit: (value) => {
                    ctx.commitSearch(value.trim());
                    scrollToResults();
                  },
                  onClear: () => ctx.commitSearch(""),
                }
              : null
          }
          popularLabel={band.popularLabel || t("catalogHero.popularLabel", "Popular:")}
          chips={chips}
          shellStyle={ctx.shellStyle}
          tagName={ctx.tagName}
          paletteStyle={paletteStyle}
        />
      );
    };
  }

  // One shortcut chip → its view, or null when it cannot act here (an unknown
  // stream/category/quick filter once the data has loaded).
  function chipView(chip: ResolvedPopularChip, i: number): CatalogHeroChipView | null {
    const key = `${chip.kind}-${i}`;
    switch (chip.kind) {
      case "search": {
        const active = ctx.searchTerm.trim().toLowerCase() === chip.value.toLowerCase();
        return {
          key,
          label: chip.label,
          type: "toggle",
          active,
          onClick: () => {
            if (active) ctx.commitSearch("");
            else {
              ctx.commitSearch(chip.value);
              scrollToResults();
            }
          },
        };
      }
      case "stream": {
        const stream = findStream(ctx.streamList, chip.streamSlug);
        if (!ctx.isLoading) {
          if (!stream) return null;
          if (chip.categorySlug && !stream.categories.some((c) => c.slug === chip.categorySlug)) return null;
        }
        const wanted = chip.categorySlug ? [chip.categorySlug] : [];
        const active =
          ctx.discoveryState.stream === chip.streamSlug && sameList(ctx.discoveryState.categories, wanted);
        return {
          key,
          label: chip.label,
          type: "toggle",
          active,
          onClick: () => {
            if (active) ctx.setDiscoveryState({ stream: null, categories: [] }, { push: true });
            else {
              ctx.setDiscoveryState({ stream: chip.streamSlug, categories: wanted }, { push: true });
              scrollToResults();
            }
          },
        };
      }
      case "quick": {
        const quick = ctx.quickChips.find((q) => q.id === chip.quickFilterId);
        if (!quick) return null;
        return {
          key,
          label: chip.label,
          type: "toggle",
          active: quick.active,
          onClick: () => {
            ctx.toggleQuick(quick.id);
            if (!quick.active) scrollToResults();
          },
        };
      }
      case "route":
        return { key, label: chip.label, type: "link", route: chip.route };
    }
  }

  if (cfg.resultsHeader) {
    const rh = cfg.resultsHeader;
    out.resultsHeader = () => {
      const count = ctx.filteredCards.length;
      const authored = count === 1 ? rh.countTextOne : rh.countText;
      const countLabel = authored
        ? fillCount(authored, formatNumber(count, ctx.siteLocale))
        : t("catalogHero.showingCount", {
            count,
            courses: coursesTerm(),
            course: courseTerm(),
            defaultValue: count === 1 ? "Showing {{count}} {{course}}" : "Showing {{count}} {{courses}}",
          });

      const folderText = (f: CatalogStream | CatalogCategory) =>
        siteT((rh.streamChipMode === "subtitle" && f.subtitle) || f.title);
      const category = ctx.activeStream && ctx.activeCategories.length === 1 ? ctx.activeCategories[0] : null;
      const chipLabel = !rh.showStreamChip
        ? null
        : category
          ? folderText(category)
          : ctx.activeStream
            ? folderText(ctx.activeStream)
            : rh.allStreamsLabel || t("catalogHero.allStreams", "All streams");

      const optionLabel = (option: CourseCatalogSortOption) =>
        rh.sortLabels[SORT_URL_TOKENS[option] as keyof typeof rh.sortLabels] || ctx.sortLabel(option);
      const prefix = rh.sortPrefix || t("catalogHero.sortPrefix", "Sort:");

      return (
        <CatalogResultsHeader
          ref={headerRef}
          countLabel={countLabel}
          chipLabel={chipLabel}
          sort={{
            value: ctx.effectiveSort,
            options: ctx.sortOptions.map((o) => ({ value: o, label: optionLabel(o) })),
            display: `${prefix} ${optionLabel(ctx.effectiveSort)}`,
            ariaLabel: t("catalogHero.sortAriaLabel", "Sort by"),
            onChange: (value) => ctx.changeSort(value as CourseCatalogSortOption),
          }}
          filters={
            ctx.mobileFilterSheet && ctx.showFiltersPanel
              ? { count: ctx.filterBadgeCount, onOpen: ctx.openFilterSheet }
              : null
          }
          search={
            cfg.band?.search
              ? null
              : {
                  value: ctx.searchTerm,
                  placeholder: t("courseCatalog.searchPlaceholder", { courses: coursesTerm() }),
                  onChange: ctx.setSearchTerm,
                }
          }
        />
      );
    };
  }

  if (cfg.quickFilterBar) {
    const qf = cfg.quickFilterBar;
    out.quickFilterBar = () => (
      <QuickFilterBar
        chips={ctx.quickChips}
        onToggle={ctx.toggleQuick}
        label={qf.label || undefined}
        variant={qf.variant}
      />
    );
  }

  return out;
};
