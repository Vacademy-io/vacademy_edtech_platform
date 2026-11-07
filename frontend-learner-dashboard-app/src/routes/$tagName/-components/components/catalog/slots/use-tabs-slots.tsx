import { useMemo } from "react";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { countCardsByStream } from "../catalog-streams";
import { ROW_BLEED_DEFAULT, ROW_BLEED_SHELL, StreamIconTabs, StreamIconTabsSkeleton } from "../StreamIconTabs";
import { resolveStreamIconTabs } from "../stream-icon-tabs-config";
import { NO_SLOTS, type CatalogSlotContext, type TabsSlotOutputs } from "./catalog-slot-types";

/**
 * Section root with the icon band at its top: no top padding (the band sits
 * flush under the hero), the Figma canvas background below it, 96px under the
 * results on desktop.
 */
export const ICON_TABS_ROOT_CLASS = "pb-12 lg:pb-24 bg-palette-canvas w-full";

/**
 * Slot hook of FEATURE 'tabs' (specs/stream-tabs.json). OWNED BY THAT FEATURE.
 *
 * Opt-in: only a section whose streams say `variant: "icons"` gets the icon
 * band (full-bleed, at the top of the section root, content in the catalog's
 * own content column). Every other section returns NO_SLOTS and renders the
 * original pill tabs. So does an icons section whose streams came back empty
 * (tree request failed, wrong libraryId): no band, so the original padded
 * root. While loading, the skeleton gets the same root and a placeholder band.
 *
 * The icon band does NOT stick unless the section sets `sticky: true`
 * explicitly (the pill tabs' default-on `sticky` does not apply to it).
 */
export const useTabsSlots = (ctx: CatalogSlotContext): TabsSlotOutputs => {
  const config = ctx.discovery.streams ? resolveStreamIconTabs(ctx.props.streams) : null;
  const showCounts = !!config?.showCounts;
  // Catalogue totals: every card, before search, filters and paging.
  const counts = useMemo(
    () => (showCounts ? countCardsByStream(ctx.allCards, ctx.streamList) : null),
    [showCounts, ctx.allCards, ctx.streamList],
  );
  if (!config || (!ctx.isLoading && ctx.streamList.length === 0)) return NO_SLOTS;

  const shellOnly = ctx.contentMaxWidth !== null;
  const shellClassName = shellOnly ? "catalogue-shell" : "w-full px-4 sm:px-6 lg:px-8";
  const rowBleedClassName = shellOnly ? ROW_BLEED_SHELL : ROW_BLEED_DEFAULT;
  const sticky = ctx.props.streams?.sticky === true;
  return {
    streamTabsPlacement: "band",
    rootClassName: ICON_TABS_ROOT_CLASS,
    streamTabsSticky: sticky,
    loadingStreamTabs: () => (
      <StreamIconTabsSkeleton
        shellClassName={shellClassName}
        shellStyle={ctx.shellStyle}
        rowBleedClassName={rowBleedClassName}
      />
    ),
    streamTabs: (props) => (
      <StreamIconTabs
        {...props}
        sticky={sticky}
        counts={counts}
        allSubtitle={config.allSubtitle}
        shellClassName={shellClassName}
        shellStyle={ctx.shellStyle}
        rowBleedClassName={rowBleedClassName}
        courseTerm={getTerminology(ContentTerms.Course, SystemTerms.Course).toLowerCase()}
        coursesTerm={getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase()}
      />
    ),
  };
};
