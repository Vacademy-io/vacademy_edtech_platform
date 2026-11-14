/**
 * The "editorial" streams mega menu (header megaMenuStyle "editorial"): exact
 * classes of the design's panel (Figma node 0:20, see megamenu notes). Only
 * MegaMenuNavItem reads these, and only when the header opts in; the default
 * panel keeps its own classes.
 *
 * Colours are palette classes (fall back to catalogue tokens elsewhere).
 */

/** Full width under the bar; white, a 1px top line, rounded 24px bottom corners, soft shadow. */
export const EDITORIAL_PANEL = "absolute start-0 end-0 top-full z-catalogue-dropdown max-h-screen-80 overflow-y-auto overscroll-contain rounded-b-3xl border-t border-palette-border bg-catalogue-bg-elevated shadow-[0_16px_40px_rgba(26,20,5,0.16)] [clip-path:inset(0_-64px_-64px_-64px)] animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none"; // design-lint-ignore: Figma panel shadow 0 16 40 rgba(26,20,5,.16), clipped so it never shades the bar
/** The page under the open panel is dimmed (rgba(26,18,8,.35) = the palette text colour at 35%). */
export const EDITORIAL_DIM = "absolute start-0 end-0 top-full h-screen bg-palette-text/35 motion-safe:animate-in motion-safe:fade-in-0";
/** Same 1280px container as the contained header: content at x=144 on a 1440 frame. */
export const EDITORIAL_PANEL_OUTER = "w-full px-4 sm:px-6 lg:px-8 xl:px-20";
export const EDITORIAL_PANEL_INNER = "mx-auto w-full max-w-screen-xl pb-10 pt-9 xl:px-16";

export const EDITORIAL_TOP_ROW = "flex flex-wrap items-center justify-between gap-3";
export const EDITORIAL_EYEBROW = "flex items-center gap-4 text-xs font-normal uppercase leading-4 tracking-[1.3px] text-palette-gold"; // design-lint-ignore: Figma eyebrow tracking 1.3px
export const EDITORIAL_EYEBROW_RULE = "h-px w-6 shrink-0 bg-palette-accent";
export const EDITORIAL_HELP_LINK = "inline-flex items-center gap-2 text-[13px] font-bold leading-5 text-palette-primary hover:underline underline-offset-4"; // design-lint-ignore: Figma help link 13/20

export const EDITORIAL_TILES = "mt-7 grid grid-cols-3 gap-4";
export const editorialTileClass = (selected: boolean): string =>
  `flex h-full w-full flex-col items-center gap-3 rounded-[20px] border-[1.5px] px-2 pb-[18px] pt-5 text-center transition-colors duration-200 ${ // design-lint-ignore: Figma tile radius 20, 1.5px border, 20/18 padding
    selected ? "border-palette-accent bg-palette-cream" : "border-transparent hover:bg-palette-cream/60"
  }`;
export const EDITORIAL_TILE_ICON = "size-[120px]"; // design-lint-ignore: Figma stream icon 120px
export const editorialTileName = (selected: boolean): string =>
  `text-[21px] font-bold leading-8 ${selected ? "text-palette-primary" : "text-palette-text"}`; // design-lint-ignore: Figma stream name 21/32
export const editorialTileSub = (selected: boolean): string =>
  `text-[11px] font-bold uppercase leading-4 tracking-[1.1px] ${selected ? "text-palette-gold" : "text-palette-muted"}`; // design-lint-ignore: Figma stream caption 11/16, tracking 1.1px

export const EDITORIAL_DETAIL = "mt-7 flex flex-col gap-10 rounded-[20px] bg-palette-cream p-8 lg:flex-row"; // design-lint-ignore: Figma detail box radius 20
export const EDITORIAL_DETAIL_LEFT = "flex w-full flex-col items-start gap-3.5 lg:w-[340px] lg:shrink-0"; // design-lint-ignore: Figma detail column 340px
export const EDITORIAL_DETAIL_TITLE = "flex flex-wrap items-center gap-x-2 text-lg font-bold leading-7 text-palette-primary";
export const EDITORIAL_DETAIL_ICON = "size-14";
export const EDITORIAL_DETAIL_TAGLINE = "text-[22px] font-bold leading-[30px] text-palette-text"; // design-lint-ignore: Figma 22/30
export const EDITORIAL_DETAIL_TEXT = "text-sm leading-[22px] text-palette-body"; // design-lint-ignore: Figma 14/22
export const EDITORIAL_DETAIL_CTA = "inline-flex items-center gap-2 rounded-[8px] bg-palette-primary px-[22px] py-3 text-sm font-normal leading-5 text-white transition-colors duration-200 hover:bg-palette-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-primary/40 focus-visible:ring-offset-2"; // design-lint-ignore: Figma button radius 8, px 22

export const EDITORIAL_DETAIL_RIGHT = "min-w-0 flex-1";
export const EDITORIAL_CATEGORIES_HEADING = "text-[11px] font-bold uppercase leading-4 tracking-[1.3px] text-palette-muted"; // design-lint-ignore: Figma 11/16, tracking 1.3px
export const EDITORIAL_CATEGORY_LIST = "mt-3 grid gap-0.5";
export const editorialRowClass = (interactive: boolean): string =>
  `group flex w-full items-center gap-3 rounded-[10px] py-2 pe-3 ps-2.5 text-start transition-colors duration-200${ // design-lint-ignore: Figma row radius 10
    interactive ? " hover:bg-catalogue-bg-elevated focus-visible:bg-catalogue-bg-elevated" : ""
  }`;
export const EDITORIAL_ROW_ICON = "size-8";
export const editorialRowTitle = (comingSoon: boolean): string =>
  `text-sm font-bold leading-5 ${comingSoon ? "text-palette-muted" : "text-palette-primary"}`;
export const editorialRowSubtitle = (comingSoon: boolean): string =>
  `text-sm font-bold leading-5 ${comingSoon ? "text-palette-muted" : "text-palette-text"}`;
export const EDITORIAL_ROW_TEXT = "mt-0.5 block truncate text-xs leading-[17px] text-palette-muted"; // design-lint-ignore: Figma 12/17
export const EDITORIAL_ROW_ARROW =
  "size-3.5 shrink-0 text-palette-outline transition duration-200 group-hover:translate-x-0.5 group-hover:text-palette-gold rtl:rotate-180 rtl:group-hover:-translate-x-0.5";

export const EDITORIAL_FOOTNOTE = "mt-7 text-[13px] leading-5 text-palette-muted"; // design-lint-ignore: Figma 13/20
