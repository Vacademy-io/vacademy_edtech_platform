import type { CatalogSlotContext, CatalogSlotOutputs } from "./catalog-slot-types";
import { useCardsSlots } from "./use-cards-slots";
import { useHeroSlots } from "./use-hero-slots";
import { useSectionsSlots } from "./use-sections-slots";
import { useSidebarSlots } from "./use-sidebar-slots";
import { useTabsSlots } from "./use-tabs-slots";

/**
 * Every feature's slot outputs for one render of the Courses grid. The hooks
 * always run, in this fixed order (Rules of Hooks); each returns only the
 * keys its feature owns (typed), so the spread below never lets one feature
 * overwrite another's slot. Foundation file — features do not edit it.
 */
export const useCatalogSlots = (ctx: CatalogSlotContext): CatalogSlotOutputs => {
  const hero = useHeroSlots(ctx);
  const tabs = useTabsSlots(ctx);
  const sidebar = useSidebarSlots(ctx);
  const sections = useSectionsSlots(ctx);
  const cards = useCardsSlots(ctx);
  return { ...hero, ...tabs, ...sidebar, ...sections, ...cards };
};
