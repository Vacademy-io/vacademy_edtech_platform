/**
 * courseCatalog.render extension — OWNED BY FEATURE 'cards'
 * (specs/course-cards-grid.json): cardStyle, card, pagination, gridHeading.
 * Merged into CourseCatalogProps.render. Every field is optional and only
 * read when set: a section without them renders the original card, the
 * numbered pagination and no grid heading.
 *
 * `render` is OPAQUE to localizeComponentProps, so every authored string
 * here is BASE-language text that the component shows through siteT().
 * Resolution and validation: components/catalog/catalog-card-view.ts.
 */

/** What a free card's CTA says, by course format ("Watch free →", "Read free →"). */
export type CatalogCardCtaKind = "start" | "watch" | "read" | "listen";

/** Hex overrides for the few editorial colours the site palette has no name for. */
export interface CatalogCardColors {
  /** Divider above the price row. Default: the palette border at 80%. */
  divider?: string;
  /** "Free" in the price row. Default: the palette muted ink. */
  freePrice?: string;
  /** "Load more" button border. Default: the palette muted2 ink at 80%. */
  loadMoreBorder?: string;
}

export interface CatalogEditorialCardConfig {
  /** Stream line above the title: the stream's subtitle (default), its title, or none. */
  streamLabel?: "subtitle" | "title" | "none";
  /** Round stream icon (the folder's image) before the stream line. Default true. */
  showStreamIcon?: boolean;
  /** Format pill (globalSettings.courseFormats) on the image. Default true. */
  showFormatPill?: boolean;
  /** "Free" pill on the image of a free card. Default true. */
  showFreePill?: boolean;
  /** Language chips (needs groupLanguageVersions). Default true. */
  showLanguageChips?: boolean;
  /** The other language version's title after the chips. Default false. */
  showOtherLanguageTitle?: boolean;
  /** Short pill text per format key ("ebook": "E-book"); default: the format's own label. */
  formatLabels?: Record<string, string>;
  /** CTA kind of a FREE card per format key ("animation": "watch"); default "start". */
  freeCtaByFormat?: Record<string, CatalogCardCtaKind>;
  /** Authored CTA text overrides (base language). Defaults are translated UI strings. */
  ctaLabels?: Partial<Record<"paid" | CatalogCardCtaKind | "comingSoon", string>>;
  /** "Free" text override for the pill and the price row. */
  freeLabel?: string;
  /** Short description per package id (base language); default: the course description. */
  descriptions?: Record<string, string>;
  colors?: CatalogCardColors;
}

export interface CatalogCardsPaginationConfig {
  /** "loadMore" = a Load more button + "Showing N of M". Default: the numbered pages. */
  mode?: "pages" | "loadMore";
  /** Cards per load (loadMore). Default 9; clamped 1..60. */
  pageSize?: number;
  /** Button text override (base language). */
  loadMoreLabel?: string;
  /** Count text override with {{shown}} / {{total}} (base language). */
  countLabel?: string;
}

export interface CatalogGridHeadingConfig {
  /** Heading text (base language). Default "All courses". */
  title?: string;
  /** The "Sorted by …" note, following the active sort. Default true. */
  showSort?: boolean;
  /** Note override per sort option value ("Popular": "Sorted by most popular"). */
  sortLabels?: Record<string, string>;
}

export interface CatalogCardsRenderExtension {
  /** "editorial" = the Figma course card. Absent / "default" = the original card. */
  cardStyle?: "default" | "editorial" | string;
  card?: CatalogEditorialCardConfig;
  pagination?: CatalogCardsPaginationConfig;
  gridHeading?: CatalogGridHeadingConfig;
}
