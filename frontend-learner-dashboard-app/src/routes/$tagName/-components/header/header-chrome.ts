/**
 * Opt-in header looks (HeaderChromeProps): which ones a header turned on, and
 * the exact class strings of the design (Figma node 1:37 / 73:325 and the
 * mega menu 0:20). Pure, so header-chrome.test.ts pins both the strings and
 * that a header without the props gets none of them.
 *
 * Colours come from the site palette classes (text-palette-*), which fall
 * back to catalogue tokens on a site without a palette.
 */

import type { HeaderChromeProps } from "../../-types/site-chrome-types";
import type { AuthLinkVariant } from "./header-variants";

export interface ResolvedHeaderChrome {
  compact: boolean;
  contained: boolean;
  editorialNav: boolean;
  logoOnly: boolean;
  segmentedSwitcher: boolean;
  cartWhenNotEmpty: boolean;
  editorialMega: boolean;
}

export const resolveHeaderChrome = (props: HeaderChromeProps | null | undefined): ResolvedHeaderChrome => ({
  compact: props?.barSize === "compact",
  contained: props?.contentWidth === "contained",
  editorialNav: props?.navStyle === "editorial",
  logoOnly: props?.logoOnly === true,
  segmentedSwitcher: props?.languageSwitcherStyle === "segmented",
  cartWhenNotEmpty: props?.cartDisplay === "whenNotEmpty",
  editorialMega: props?.megaMenuStyle === "editorial",
});

/** True when the header turned on any of the looks above. */
export const hasHeaderChrome = (c: ResolvedHeaderChrome): boolean => Object.values(c).some(Boolean);

/**
 * The page offset under the fixed header: the original `pt-16 md:pt-20`
 * (64 / 80px), or 64px everywhere for a compact bar. `legacy` is the caller's
 * own original class (CourseSubPage has always used `pt-20`).
 */
export const headerOffsetClass = (
  headerProps: HeaderChromeProps | null | undefined,
  legacy = "pt-16 md:pt-20",
): string => (headerProps?.barSize === "compact" ? "pt-16" : legacy);

/* ── exact design values ─────────────────────────────────────────────────── */

/** 1280px container: 80px page gutter + 64px inner gutter at xl (logo at x=144 on a 1440 frame). */
export const HEADER_CONTAINED_OUTER = "w-full px-4 sm:px-6 lg:px-8 xl:px-20";
export const HEADER_CONTAINED_INNER = "mx-auto w-full max-w-screen-xl xl:px-16";

/** The 48px logo of the compact bar. */
export const HEADER_COMPACT_LOGO = "h-12 max-h-12";

/** Editorial nav: the row stretches to the bar height so the open underline sits on its bottom edge. */
export const EDITORIAL_NAV = "items-stretch gap-8 self-stretch";
const EDITORIAL_NAV_TEXT = "text-[13px] leading-[18.57px]"; // design-lint-ignore: Figma nav 13/18.57
export const editorialNavItemClasses = (active: boolean): string =>
  `relative inline-flex h-full items-center whitespace-nowrap ${EDITORIAL_NAV_TEXT} transition-colors duration-200 ${
    active ? "font-bold text-palette-gold" : "font-normal text-palette-text hover:text-palette-gold"
  }`;
/** 2px accent bar under the open mega menu's label, on the bar's bottom edge (Figma y 62.7–64.7 of 65). */
export const EDITORIAL_OPEN_UNDERLINE = "pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-palette-accent";

/**
 * The mega menu trigger's chevron: 10×6, 1.6px round stroke, 6px after the
 * label (Figma 0:29 / chevron-up fd3d5.svg). Points down while closed; open,
 * it turns up and takes the accent, as in the design.
 */
export const EDITORIAL_CHEVRON = "h-1.5 w-2.5 shrink-0 transition-transform duration-200";
export const editorialChevronClasses = (open: boolean): string =>
  `${EDITORIAL_CHEVRON}${open ? " rotate-180 text-palette-accent" : ""}`;

/** Right cluster: 16px apart. */
export const EDITORIAL_RIGHT_GROUP = "flex items-center gap-4 flex-shrink-0";

/** 18px line search icon in the palette olive, with a 30px hit area that takes no extra room. */
export const EDITORIAL_SEARCH_BUTTON =
  "-m-1.5 p-1.5 rounded-catalogue-sm text-palette-olive hover:text-palette-gold hover:bg-transparent";
export const EDITORIAL_SEARCH_ICON = "size-[18px]"; // design-lint-ignore: Figma search icon 18px

const EDITORIAL_AUTH_BUTTON = "rounded-[8px] px-4 py-2 text-[13px] leading-[18.57px] font-normal transition-colors duration-200"; // design-lint-ignore: Figma button 8px radius, 13/18.57
export const EDITORIAL_AUTH_CLASSES: Record<AuthLinkVariant, string> = {
  primary: `${EDITORIAL_AUTH_BUTTON} bg-palette-primary text-white hover:bg-palette-primary/90`,
  outline: `${EDITORIAL_AUTH_BUTTON} border border-palette-primary text-palette-primary hover:bg-palette-sand`,
  text: `${EDITORIAL_NAV_TEXT} font-normal text-palette-text transition-colors duration-200 hover:text-palette-gold`,
};

/* ── language switch ─────────────────────────────────────────────────────── */

/**
 * Header: 86×30, 8px radius, 1px border, the active half (43×28) filled sand
 * with primary text. (Figma strokes sit inside the box, so the CSS border
 * replaces Figma's 1px inset.)
 */
const SEGMENT_GROUP = "inline-flex shrink-0 items-center gap-1 overflow-hidden rounded-[8px] border border-palette-border"; // design-lint-ignore: Figma toggle radius 8
const SEGMENT_BUTTON = "px-2.5 py-1.5 text-xs font-normal leading-4 transition-colors duration-200";
/**
 * Footer: 84×28 (43 + 4 + 37) with the border inside, no fill; both halves in
 * the body colour. The 1px CSS border is taken back from the outer padding
 * (9px) and the vertical padding (5px), so the box stays 84×28.
 */
const FOOTER_SEGMENT_GROUP = "inline-flex shrink-0 items-center gap-1 overflow-hidden rounded-[8px] border border-palette-border"; // design-lint-ignore: Figma toggle radius 8
const FOOTER_SEGMENT_BUTTON = "px-2.5 py-[5px] first:ps-[9px] last:pe-[9px] text-xs font-normal leading-4 transition-colors duration-200"; // design-lint-ignore: Figma 84×28 toggle incl. border

export type LanguageSwitcherVariant = "pill" | "segmented" | "footer";

export const languageSwitcherClasses = (
  variant: Exclude<LanguageSwitcherVariant, "pill">,
): { group: string; button: (active: boolean) => string } =>
  variant === "segmented"
    ? {
        group: SEGMENT_GROUP,
        button: (active) =>
          `${SEGMENT_BUTTON} ${active ? "bg-palette-sand text-palette-primary" : "text-palette-muted hover:text-palette-text"}`,
      }
    : {
        group: FOOTER_SEGMENT_GROUP,
        button: (active) =>
          `${FOOTER_SEGMENT_BUTTON} text-palette-body ${active ? "" : "hover:text-palette-primary"}`.trim(),
      };
