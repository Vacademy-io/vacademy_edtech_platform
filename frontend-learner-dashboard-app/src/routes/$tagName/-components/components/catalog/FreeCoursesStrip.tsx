import React from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { COLUMN_SECTION_LINK, ColumnSectionHeader } from "./ColumnSectionHeader";
import { fillCount, freeCtaLabelFor, type ResolvedFreeSection } from "./catalog-column-sections";
import type { CatalogCardModel, CatalogSlotContext } from "./slots/catalog-slot-types";

/** Figma 1:294: three cards, 20px apart; same breakpoints as the course grid. */
const FREE_GRID = "grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3";

export interface FreeCoursesStripProps {
  section: ResolvedFreeSection;
  headingId: string;
  /** The cards to show (pickFreeCards). */
  cards: CatalogCardModel[];
  /** Every free card ("See all {count} free"). */
  total: number;
  ctx: CatalogSlotContext;
  /** Format keys of a card's versions (useCourseFormats().cardKeysOf). */
  formatKeysOf: (card: CatalogCardModel) => string[];
}

/**
 * "New here? Start free" (Figma 1:288): free cards drawn by the grid's own
 * card renderer (the editorial card applies the "Free" pill and the CTA text),
 * and a "See all N free →" link that switches the Free filter on.
 */
export const FreeCoursesStrip: React.FC<FreeCoursesStripProps> = ({
  section,
  headingId,
  cards,
  total,
  ctx,
  formatKeysOf,
}) => {
  const { t, discovery } = ctx;
  // The link must land on a filter the visitor can see and undo; otherwise the
  // URL scope would drop ?price=free and the click would do nothing.
  const freeQuick = discovery.quickFilters.find((q) => q.kind === "free");
  const priceControl =
    discovery.showAppliedChips ||
    (ctx.showFiltersPanel && discovery.priceFilter.enabled && discovery.priceFilter.showFree);
  const showLink = section.seeAllLabel !== "" && total > cards.length && (!!freeQuick || priceControl);
  const linkText =
    section.seeAllLabel === null
      ? t("catalogSections.seeAllFree", { count: total, defaultValue: "See all {{count}} free" })
      : fillCount(section.seeAllLabel, total);

  const seeAll = () => {
    if (freeQuick) {
      const chip = ctx.quickChips.find((c) => c.id === freeQuick.id);
      if (!chip?.active) ctx.toggleQuick(freeQuick.id);
    } else {
      ctx.setDiscoveryState({ price: { kind: "free" } });
    }
    const target = ctx.resultsRef.current;
    if (target && typeof target.scrollIntoView === "function") {
      requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const defaultCta = t("catalogSections.startFree", "Start free");
  const badge =
    section.badgeText === null ? t("catalogSections.freeBadge", "Free") : section.badgeText || undefined;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4" data-column-section={section.id}>
      <ColumnSectionHeader
        headingId={headingId}
        title={section.title || t("catalogSections.freeTitle", "New here? Start free")}
        subtitle={section.subtitle}
        aside={
          showLink ? (
            <button type="button" onClick={seeAll} className={COLUMN_SECTION_LINK}>
              {linkText}
              <ArrowRight size={13} aria-hidden="true" className="rtl:-scale-x-100" />
            </button>
          ) : null
        }
      />
      <div className={FREE_GRID}>
        {cards.map((card, index) =>
          ctx.renderCourseCard(card, index, {
            keyPrefix: "free-",
            // No trailing arrow: the editorial card draws its own "→" after the label.
            ctaLabel: freeCtaLabelFor(section, card, formatKeysOf(card)) || defaultCta,
            imageBadge: badge,
          }),
        )}
      </div>
    </section>
  );
};
