import React, { useId, useMemo } from "react";
import { usePopularityRanks } from "../../../../-services/popularity-service";
import { useCourseFormats } from "../../../../-utils/course-format";
import { ComingSoonCategoryRow } from "../ComingSoonCategoryRow";
import { FreeCoursesStrip } from "../FreeCoursesStrip";
import { SpotlightCarousel } from "../SpotlightCarousel";
import {
  comingSoonItems,
  pickFreeCards,
  resolveColumnSections,
  sectionShown,
  spotlightSlidesFor,
  type ColumnView,
  type ResolvedColumnSection,
} from "../catalog-column-sections";
import { NO_SLOTS, type CatalogCardModel, type CatalogSlotContext, type SectionsSlotOutputs } from "./catalog-slot-types";

type FormatKeysOf = (card: CatalogCardModel) => string[];

/**
 * Slot hook of FEATURE 'sections' (specs/in-results-sections.json): the
 * authored courseCatalog.columnSections render in the results column —
 * before the grid ("New here? Start free", the flagship spotlight) and after
 * the pagination ("Coming soon"). A section without columnSections gets
 * NO_SLOTS, so its markup is the original.
 */
export const useSectionsSlots = (ctx: CatalogSlotContext): SectionsSlotOutputs => {
  const raw = ctx.props.columnSections;
  const sections = useMemo(() => resolveColumnSections(raw), [raw]);
  const wantsRanks = sections.some((s) => s.kind === "free-courses");
  // Same react-query key as the grid's own ranks: one request, and none at all without a free strip.
  const { ranks } = usePopularityRanks(ctx.instituteId, wantsRanks);
  const { cardKeysOf } = useCourseFormats(ctx.globalSettings);

  if (!sections.length) return NO_SLOTS;
  const before = sections.filter((s) => s.placement === "before-grid");
  const after = sections.filter((s) => s.placement === "after-grid");
  const formatKeysOf: FormatKeysOf = (card) => cardKeysOf(card.rows);
  const out: SectionsSlotOutputs = {};
  if (before.length) {
    out.beforeGrid = () => (
      <ColumnSections sections={before} placement="before-grid" ctx={ctx} ranks={ranks} formatKeysOf={formatKeysOf} />
    );
  }
  if (after.length) {
    out.afterGrid = () => (
      <ColumnSections sections={after} placement="after-grid" ctx={ctx} ranks={ranks} formatKeysOf={formatKeysOf} />
    );
  }
  return out;
};

/** Figma: blocks in the results column sit 28px apart (24px on phones). */
const STACK = {
  "before-grid": "mb-6 flex flex-col gap-6 sm:mb-7 sm:gap-7",
  "after-grid": "mt-6 flex flex-col gap-6 sm:mt-7 sm:gap-7",
} as const;

const ColumnSections: React.FC<{
  sections: ResolvedColumnSection[];
  placement: keyof typeof STACK;
  ctx: CatalogSlotContext;
  ranks: Map<string, number>;
  formatKeysOf: FormatKeysOf;
}> = ({ sections, placement, ctx, ranks, formatKeysOf }) => {
  const baseId = useId();
  const view: ColumnView = {
    activeStreamSlug: ctx.activeStream?.slug ?? null,
    searchTerm: ctx.searchTerm,
    filterBadgeCount: ctx.filterBadgeCount,
    currentPage: ctx.currentPage,
  };
  const allCards = ctx.allCards;
  const freePicks = useMemo(
    () =>
      new Map(
        sections.flatMap((s) =>
          s.kind === "free-courses"
            ? [[s.id, pickFreeCards(allCards, s, { ranks, titleOf: (card) => card.primary.title })] as const]
            : [],
        ),
      ),
    [sections, allCards, ranks],
  );

  // Work out what each block shows first, so an empty block (no free course,
  // no coming-soon category) leaves no gap behind.
  const blocks = sections.flatMap((section) => {
    if (!sectionShown(section, view)) return [];
    const headingId = `${baseId}-${section.id}`;
    if (section.kind === "free-courses") {
      const pick = freePicks.get(section.id);
      if (!pick?.cards.length) return [];
      return [
        <FreeCoursesStrip
          key={section.id}
          section={section}
          headingId={headingId}
          cards={pick.cards}
          total={pick.total}
          ctx={ctx}
          formatKeysOf={formatKeysOf}
        />,
      ];
    }
    if (section.kind === "spotlight") {
      const slides = spotlightSlidesFor(section, view);
      if (!slides.length) return [];
      return [<SpotlightCarousel key={section.id} section={section} slides={slides} ctx={ctx} />];
    }
    const items = comingSoonItems(ctx.streamList, section, view.activeStreamSlug);
    if (!items.length) return [];
    return [<ComingSoonCategoryRow key={section.id} section={section} headingId={headingId} items={items} ctx={ctx} />];
  });

  if (!blocks.length) return null;
  return <div className={STACK[placement]}>{blocks}</div>;
};
