/**
 * courseCatalog.filterSidebar / courseCatalog.customFilters and the opt-in
 * extensions of priceFilter / categoryFilter — OWNED BY FEATURE 'sidebar'
 * (specs/filter-sidebar.json). Every field is optional; a section that sets
 * none of them renders the original sidebar.
 *
 * i18n: the section's props pass through localizeComponentProps, so text keys
 * (title, label, …Label, eyebrow, text) arrive in the visitor's language.
 * Keys ending in Color / Image / Mode, `levels`, `tags`, `id`, `order`
 * values (lower-case tokens) and `target` are never translated.
 */

/** The dark app promo card under the filter card (Figma "App CTA"). */
export interface CatalogSidebarPromoConfig {
  /** Default false: nothing renders until a site switches it on. */
  enabled?: boolean;
  /** A ready illustration (http(s) or site path) shown INSTEAD of the drawn phone mock-up. */
  image?: string;
  imageAlt?: string;
  /** The photo inside the drawn phone mock-up's screen (http(s) or site path). */
  screenImage?: string;
  eyebrow?: string;
  title?: string;
  text?: string;
  button?: {
    text?: string;
    /** Site route ("/login") or an https URL. */
    target?: string;
    openInNewTab?: boolean;
  };
  /** Hex colours; unset → the site palette (text / accent / olive) or white. */
  backgroundColor?: string;
  eyebrowColor?: string;
  titleColor?: string;
  textColor?: string;
  buttonColor?: string;
  buttonTextColor?: string;
}

export interface CatalogFilterSidebarConfig {
  /** 'editorial' = the Figma card; anything else (or absent) = the original sidebar. */
  variant?: "default" | "editorial" | string;
  /** Sidebar column width in px at lg+ (220-360, default 280). */
  width?: number;
  /** Stick under the header while the grid scrolls (default false for editorial). */
  sticky?: boolean;
  /** Sections fold with a −/+ toggle (default true). */
  collapsible?: boolean;
  /** Card heading (default "Filters"). */
  title?: string;
  /** Header link (default "Clear all"). */
  clearAllLabel?: string;
  /** Show-more link when a group sets no showAllLabel (default "+ Show more"). */
  showMoreLabel?: string;
  /** Collapse link (default "− Show less"). */
  showLessLabel?: string;
  /**
   * Group order: 'price', 'language', 'category', customFilters ids, and the
   * legacy 'level' | 'session' | 'tags' | 'instructor' | 'priceRange'.
   * Unlisted groups follow in the original order.
   */
  order?: string[];
  /** Hex colours the site palette lacks (Figma: the section divider, the checkbox border, the lighter box of count-less groups). */
  dividerColor?: string;
  checkboxColor?: string;
  /** Checkbox border in groups that show no counts (Figma's FOR group). Defaults to checkboxColor. */
  checkboxSoftColor?: string;
  promo?: CatalogSidebarPromoConfig;
}

/** One authored option of a custom group. */
export interface CatalogCustomFilterOptionConfig {
  /** URL value (slug). */
  id: string;
  label: string;
  /** Course tags (case-insensitive) — any version of the course. */
  tags?: string[];
  /** Course level names (case-insensitive) — any version of the course. */
  levels?: string[];
}

/** An authored option group (FORMAT, FOR…) — also the ?<id>= URL parameter. */
export interface CatalogCustomFilterConfig {
  id: string;
  label: string;
  /** Default true. */
  enabled?: boolean;
  /**
   * 'courseFormats' = the options are globalSettings.courseFormats (shared format helper).
   * 'tags' = the authored options, then every course tag starting with `prefix` ("for parents" → Parents).
   */
  source?: "courseFormats" | "options" | "tags" | string;
  /** source 'tags': the leading word(s) of the group's tags ("for"). */
  prefix?: string;
  /** source 'tags': tags never listed (the whole tag "for everyone" or the rest "everyone"). */
  exclude?: string[];
  /** Default: the section's showFilterCounts. */
  showCounts?: boolean;
  /** Default true: zero-count options are listed, greyed and disabled. */
  showEmpty?: boolean;
  /** Rows before the show-more link (default: all). */
  visibleCount?: number;
  /** Show-more text; '{count}' becomes the number of options. */
  showAllLabel?: string;
  options?: CatalogCustomFilterOptionConfig[];
}

/** Extra fields of courseCatalog.priceFilter. */
export interface CatalogPriceFilterExtension {
  /** 'checkbox' = Free / Paid checkboxes (at most one on) with no "Any price" row. Editorial sidebar. Default 'radio'. */
  control?: "radio" | "checkbox";
}

/** Extra fields of courseCatalog.categoryFilter. */
export interface CatalogCategoryFilterExtension {
  /** 'all' = on "All courses" list every stream's categories. Default 'stream'. */
  scope?: "stream" | "all";
  /** 'both' = folder title + subtitle ("वैदिक पेरेंटिंग  Holistic Parenting"). Default 'title'. Editorial sidebar. */
  labelMode?: "title" | "subtitle" | "both";
  /** 'count' = by total course count (stable while filtering). Default 'folder'. Editorial sidebar. */
  sort?: "folder" | "count";
  /** Leave coming-soon categories out of the list. Editorial sidebar. */
  hideComingSoon?: boolean;
  /** Rows before "+ Show all {count} categories". Editorial sidebar. */
  visibleCount?: number;
  showAllLabel?: string;
}
