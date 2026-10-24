// Updated to support layout configuration
import type { CatalogueI18nSettings } from "../-utils/catalogue-i18n";
import type { CourseLanguageSettings } from "../-utils/course-variants";
import type { SiteCartSettings } from "../-utils/site-cart";
import type { VisibleWhenRule } from "../-utils/catalogue-url-state";
import type { BadgeRules } from "../-utils/course-badges";
import type { CatalogueThemeSettings, SitePalette } from "../-utils/catalogue-palette";
import type { CourseFormatsSetting } from "../-utils/course-format";
import type { CatalogHeroConfig } from "./catalog-hero-types";
import type { CatalogStreamsTabsExtension } from "./catalog-tabs-types";
import type { CatalogCategoryFilterExtension, CatalogCustomFilterConfig, CatalogFilterSidebarConfig, CatalogPriceFilterExtension } from "./catalog-sidebar-types";
import type { CatalogColumnSectionConfig } from "./catalog-sections-types";
import type { CatalogCardsRenderExtension } from "./catalog-cards-types";
import type { FooterBrandProps, HeaderChromeProps } from "./site-chrome-types";

/**
 * A single tier in a quantity-based additional charge (e.g. shipping).
 * `maxQty: null` means unbounded (top tier — applies for all quantities >= minQty).
 * Each tier is backed by its own PaymentPlan in the DB so the backend can verify
 * `paid_amount == PaymentPlan.actualPrice`.
 */
export interface AdditionalChargeTier {
  minQty: number;
  maxQty: number | null;
  planId: string;
  amount: number;
}

/**
 * Charge added to checkout beyond the items themselves — e.g. shipping, security deposit.
 * Backed by a dedicated "internal" Package (`package_type` = `DELIVERY_CHARGE` /
 * `SECURITY_DEPOSIT`) so it flows through the same enroll/payment/invoice plumbing
 * as a regular purchase. Two pricing shapes:
 *   - `tiers[]` — quantity-dependent (cart picks the matching tier by total qty)
 *   - `planId + amount` — flat charge
 * `applicableTo` gates which cart mode the charge appears in: "COURSE" = buy mode,
 * "MEMBERSHIP" = rent mode. A charge can apply to one or both.
 */
export interface AdditionalCharge {
  key: string;
  label: string;
  applicableTo: ("COURSE" | "MEMBERSHIP")[];
  packageSessionId: string;
  enrollInviteId: string;
  paymentOptionId: string;
  tiers?: AdditionalChargeTier[];
  planId?: string;
  amount?: number;
  refundable?: boolean;
  description?: string;
}

export interface GlobalSettings {
  /**
   * This catalogue's own words for a course / level / session. Seeded into the
   * terminology store so authored copy and terminology-driven UI agree without
   * editing the institute record, which every other surface shares.
   */
  naming?: {
    course?: string;
    coursePlural?: string;
    level?: string;
    levelPlural?: string;
    session?: string;
    sessionPlural?: string;
  };
  courseCatalogeType: {
    enabled: boolean;
    value: string
  };
  mode: "light" | "dark";
  fonts?: {
    enabled?: boolean,
    family?: string
  },
  compactness: "small" | "medium" | "large";
  audience: "children" | "adults" | "all";
  leadCollection: {
    enabled: boolean;
    mandatory: boolean;
    inviteLink: string | null;
    formStyle: {
      type: "single" | "multiStep";
      showProgress: boolean;
      progressType: "bar" | "dots" | "steps";
      transition: "slide" | "fade";
    };
    fields: Array<{
      name: string;
      label: string;
      type: "text" | "email" | "tel" | "chips" | "dropdown";
      required: boolean;
      step: number;
      options?: Array<{
        label: string;
        value: string;
        levelId?: string;
        packageSessionId?: string;
      }>;
      style?: {
        variant?: "filled" | "outlined";
        chipColor?: string;
        allowMultiple?: boolean;
      };
    }>;
  };
  enrquiry: {
    enabled: boolean;
    requirePayment: boolean;
  };
  /**
   * What each course opens when a visitor clicks "View course": the standard
   * details page (DETAILS, the default), a page authored in the catalogue
   * editor (PAGE + route), or the details page with the syllabus leading and
   * the marketing accordion dropped — as folder rows (OUTLINE) or artwork
   * cards (TILES). Keyed by course id or package
   * session id; a course with no entry keeps the details page, so this is
   * purely additive. See -utils/course-page-routing.ts.
   */
  coursePages?: {
    enabled: boolean;
    courses?: Record<
      string,
      { mode?: "DETAILS" | "PAGE" | "OUTLINE" | "TILES"; route?: string }
    >;
    /** Pre-modes shape: course id → page route, always meaning PAGE. */
    map?: Record<string, string>;
  };
  payment: {
    enabled: boolean;
    provider: "razorpay" | "stripe" | "paypal" | "PHONEPE";
    fields: string[];
    additionalCharges?: AdditionalCharge[];
  };
  /**
   * Step-by-step Level → Session → Tag picker shown on every visit to this
   * catalogue page, before any course grid is filtered. Not persisted across
   * page views: a refresh or a later return re-asks, since a returning
   * visitor is usually shopping for a different level/session than last time.
   * Options are sourced live from whichever `courseCatalog` block(s) are on
   * the page (via a `courseFinderOptionsReady` event) — never a separate
   * fetch — so a pick can never reference a level/session/tag that has zero
   * matching courses. `steps` controls which of the three are asked at all,
   * in that fixed order.
   */
  courseFinder?: {
    enabled: boolean;
    steps: Array<"level" | "session" | "tag">;
    mandatory: boolean;
    /**
     * Per-catalogue text override for a step's title, bypassing Naming
     * Settings. Stopgap for institutes whose Naming Settings rename hasn't
     * reached this pre-login page yet (see use-domain-routing.ts) — prefer
     * Naming Settings once that gap is closed, since a value set here won't
     * follow a later rename there.
     */
    stepLabels?: Partial<Record<"level" | "session" | "tag", string>>;
    /**
     * Institute-specific grouping for the Level step, e.g. this institute's
     * real level values are "Mathematics Class 5", "Science Class 5", etc.
     * (subject baked into the level name) — this maps a clean group label
     * ("Class 5") to every raw level value it should stand in for. The
     * wizard shows the group labels; picking one expands to every raw value
     * in its list before filtering, so CourseCatalogComponent's exact-match
     * level filter needs no changes. Falls back to the raw (ungrouped) level
     * list when absent.
     */
    levelGroups?: Record<string, string[]>;
  };
  communityJoinLink?: string;
  /**
   * Site content languages (हिन्दी / EN switcher). The site is authored in
   * `defaultLocale`; every other language is a dictionary of translations
   * keyed by the source text — see -utils/catalogue-i18n.ts. Absent = a
   * single-language site, rendered exactly as before.
   */
  i18n?: CatalogueI18nSettings;
  /**
   * How a course's language versions are told apart. Versions are LEVELS
   * ("Hindi", "Beginner English"); these rules read the language out of the
   * level name so the catalogue can show one card per course with EN / हिं
   * chips. See -utils/course-variants.ts.
   */
  courseLanguages?: CourseLanguageSettings;
  /**
   * One site-wide course cart whose checkout is the store product page's.
   * See -utils/site-cart.ts. Absent = the original catalogue cart.
   */
  siteCart?: SiteCartSettings;
  /**
   * Theme. Only the opt-in fields read by -utils/catalogue-palette.ts are
   * typed (palette, contentMaxWidth); the rest stays as loosely read as before.
   */
  theme?: CatalogueThemeSettings;
  /**
   * Course formats ("E-books", "Live sessions"…) by key, matched by the course
   * tag `format-<key>`, then a listed tag, then a listed level name. See
   * -utils/course-format.ts. Absent = no format anywhere (as before).
   */
  courseFormats?: CourseFormatsSetting;
  /** Display order of courseFormats keys (unlisted keys follow in authoring order). */
  courseFormatOrder?: string[];
  layout?: {
    header?: {
      id: string;
      type: string;
      enabled: boolean;
      styles?: {
        enabled?: boolean;
      };
      props: {
        logo?: string;
        title?: string;
        // When true, header login/signup buttons open the AuthModal in-place
        // instead of navigating to /login or /signup. Default: false (navigate).
        useAuthModal?: boolean;
        navigation?: HeaderNavItem[];
        authLinks?: HeaderAuthLink[];
        activeStyle?: HeaderActiveStyle;
        showSearch?: boolean;
        showLanguageSwitcher?: boolean;
      } & HeaderChromeProps;
    };
    footer?: {
      id: string;
      type: string;
      enabled: boolean;
      styles?: {
        enabled?: boolean;
      };
      props: {
        layout: "two-column" | "three-column" | "four-column";
        leftSection: {
          title: string;
          text: string;
        };
        rightSections: Array<{
          title: string;
          links: Array<{
            label: string;
            route: string;
          }>;
        }>;
        bottomNote: string;
      } & Omit<FooterBrandProps, "leftSection">;
    };
  };
}

export interface Page {
  id: string;
  route: string;
  title?: string;
  components: Component[];
}

export type { VisibleWhenRule };

export interface Component {
  id: string;
  type: string;
  enabled: boolean;
  props: Record<string, any>;
  /**
   * Show the section only for certain query strings, e.g. the "Start free"
   * block on the unfiltered Courses view: [{ param: "stream", op: "empty" }].
   * Absent = always shown (see evaluateVisibleWhen).
   */
  visibleWhen?: VisibleWhenRule[];
}

export interface IntroPage {
  enabled: boolean;
  fullScreen: boolean;
  showHeader: boolean;
  logo?: {
    height: string;
    alignment: "left" | "center" | "right";
  };
  imageSlider: {
    autoPlay: boolean;
    interval: number;
    images: Array<{
      source: string;
      caption: string;
    }>;
    styles: {
      height: string;
      objectFit: "contain" | "cover" | "fill" | "none" | "scale-down";
      transitionEffect: "fade" | "slide" | "zoom";
    };
  };
  actions: {
    alignment: "top" | "center" | "bottom" | "right" | "left";
    buttons: Array<{
      label: string;
      action: "loadNextSection" | "navigateToLogin" | "openLeadCollection";
      style: "primary" | "outlined" | "text";
    }>;
  };
  afterIntro: {
    action: "loadAllSections" | "navigateToCatalogue";
    target: string;
  };
}

export interface CourseCatalogueData {
  globalSettings: GlobalSettings;
  introPage?: IntroPage;
  pages: Page[];
}

// Component-specific prop interfaces
export interface HeaderProps {
  logoUrl: string;
  menus: Array<{
    label: string;
    link: string;
  }>;
  actionButton: {
    label: string;
    link: string;
  };
}

/**
 * Header mega menu ("Knowledge Streams"): a panel of streams (the top-level
 * folders of a folder library) with each stream's categories (its child
 * folders). Every key is optional; the defaults below apply only once an
 * author has turned a nav item into a mega menu.
 *
 * Link patterns take {stream} / {category} = the folder's slug (folderSlug).
 * Text patterns take {stream} = the stream's name (its subtitle, else its
 * title — the English caption under a Hindi title) and {title} = its title.
 * A folder's own link_url / cta_label always wins over a pattern.
 */
export interface HeaderMegaMenuConfig {
  libraryId?: string;
  /** Library name at the time it was picked (editor display only). */
  libraryName?: string;
  /** Small caps line above the tiles, e.g. "Six streams of knowledge". */
  eyebrow?: string;
  /** "Not sure where to begin? Find your path" — shown with helpRoute. */
  helpLabel?: string;
  helpRoute?: string;
  /** Default '/courses?stream={stream}'. */
  streamLinkPattern?: string;
  /** Default '/courses?stream={stream}&category={category}'. */
  categoryLinkPattern?: string;
  /** Default 'Explore {stream}'. */
  ctaLabelPattern?: string;
  /** Default 'Categories in {stream}'. */
  categoriesHeading?: string;
  /** "● available ○ coming soon" above the category list. */
  showLegend?: boolean;
  /** Small print under the panel. */
  footnote?: string;
}

/** A header nav item. `type` absent = 'link', i.e. every header authored before mega menus. */
export interface HeaderNavItem {
  label: string;
  route: string;
  openInSameTab?: boolean;
  /** `false` hides the item without losing it; absent = visible. */
  enabled?: boolean;
  type?: "link" | "megaMenu" | "dropdown";
  megaMenu?: HeaderMegaMenuConfig;
  /** type "dropdown": the links it opens; a link may hold one more level of children. */
  children?: HeaderNavChild[];
}

/** A link inside a "dropdown" nav item (Exams → SSC → CGL). */
export interface HeaderNavChild {
  label: string;
  /** Page route, "blog/<slug>" or a full URL; empty on a pure group. */
  route?: string;
  openInSameTab?: boolean;
  enabled?: boolean;
  children?: HeaderNavChild[];
}

/** Look of a header auth/CTA button. Absent = the original rule (first filled, the rest outlined). */
export type HeaderAuthLinkStyle = "primary" | "outline" | "text";

export interface HeaderAuthLink {
  label: string;
  route: string;
  audienceId?: string;
  formTitle?: string;
  style?: HeaderAuthLinkStyle;
}

/** How the current page's nav item is marked. Absent = 'pill' (tinted background). */
export type HeaderActiveStyle = "pill" | "underline";

/** Authored props of the `header` section (globalSettings.layout.header.props or a page header). */
export interface HeaderSectionProps {
  logo?: string;
  title?: string;
  useAuthModal?: boolean;
  backgroundColor?: string;
  textColor?: string;
  navigation?: HeaderNavItem[];
  authLinks?: HeaderAuthLink[];
  activeStyle?: HeaderActiveStyle;
  /** Search icon that opens a site search (courses, pages, streams). */
  showSearch?: boolean;
  /** हिन्दी | EN switch; shows only when the site has more than one language. */
  showLanguageSwitcher?: boolean;
}

export interface BannerProps {
  title: string;
  media: {
    type: "image" | "video";
    url: string;
  };
  alignment: "left" | "center" | "right";
}

/** Sort modes offered by the catalogue's sort dropdown. The value stored in the
 *  catalogue JSON is the label itself, so what an admin picks in the page
 *  builder is exactly what a learner sees selected. "Popular" (enrolment rank)
 *  is only listed in the dropdown of a section that uses the discovery props
 *  below or pins it as defaultSort, so older grids keep their exact menu. */
export const COURSE_CATALOG_SORT_OPTIONS = [
  "Newest",
  "Oldest",
  "Price: Low to High",
  "Price: High to Low",
  "Rating",
  "Name A-Z",
  "Name Z-A",
  "Popular",
] as const;

export type CourseCatalogSortOption =
  (typeof COURSE_CATALOG_SORT_OPTIONS)[number];

/** Sort used when a catalogue does not pin one — preserves the historic order. */
export const DEFAULT_COURSE_CATALOG_SORT: CourseCatalogSortOption = "Newest";

export interface CourseCatalogProps {
  title: string;
  showFilters: boolean;
  /** Sort applied on first render. Set this to "Price: Low to High" to lead
   *  with free courses (price 0 sorts first) ahead of the cheapest paid ones.
   *  Unset or unrecognised falls back to DEFAULT_COURSE_CATALOG_SORT; either
   *  way the learner can still change the sort from the dropdown. */
  defaultSort?: CourseCatalogSortOption;
  /** Option order inside the Level / Popular Tags filter groups, by name.
   *  Listed names come first in this order; the rest follow naturally. */
  levelOrder?: string[];
  tagOrder?: string[];
  filtersConfig?: Array<{
    id: string;
    /** Built-in filters use Naming Settings for their label. */
    label?: string;
    type: "dropdown" | "checkbox" | "range";
    field: string;
    default?: {
      min?: number;
      max?: number;
    };
  }>;
  cartButtonConfig?: {
    enabled?: boolean;
    showAddToCartButton?: boolean;
    showQuantitySelector?: boolean;
    quantityMin?: number;
  };
  render: {
    layout: "grid" | "list";
    cardFields: string[];
    styles?: {
      hoverEffect?: 'scale' | 'shadow' | string;
      roundedEdges?: boolean;
      backgroundColor?: string;
    };
  } & CatalogCardsRenderExtension;

  /* ── Courses-page discovery (all optional; absent = the original grid) ──
   * Used by courseCatalog and productCourseGrid alike. See
   * -components/components/catalog/catalog-config.ts for how each is read. */

  /** Stream tabs across the top of the grid. */
  streams?: CatalogStreamsConfig;
  /** Mirror tabs, filters, sort and search in the URL. Default: on when streams are on. */
  syncUrl?: boolean;
  /** Live result counts next to every filter option. */
  showFilterCounts?: boolean;
  /** Removable chips for every applied filter, plus "Clear all". */
  showAppliedChips?: boolean;
  /** One-tap shortcuts to the same filters / sort. */
  quickFilters?: CatalogQuickFilter[];
  /** Filter by course language (globalSettings.courseLanguages must be on). */
  languageFilter?: { enabled?: boolean; label?: string };
  /** Free / Paid / Under an amount. */
  priceFilter?: { enabled?: boolean; label?: string; showFree?: boolean; maxOptions?: number[] } & CatalogPriceFilterExtension;
  /** Sub-folders of the selected stream (folder-library streams only). */
  categoryFilter?: { enabled?: boolean; label?: string } & CatalogCategoryFilterExtension;
  /** One card per course with EN / हिं chips (globalSettings.courseLanguages must be on). */
  groupLanguageVersions?: boolean;
  /** Bestseller / Popular / New / Free badges on cards. */
  badges?: BadgeRules;
  /** Below lg, filters open in a bottom sheet behind a "Filters (n)" button. */
  mobileFilterSheet?: boolean;

  /* ── Figma-fidelity opt-ins (absent = the grid above, byte-identical) ──
   * One field per feature; each feature owns its type file and only edits
   * that file (see scratchpad specs/CONTRACT.md). Do not add fields here. */

  /** Content column width in px (gutters excluded); else globalSettings.theme.contentMaxWidth. Foundation. */
  contentMaxWidth?: number;

  /** Section-level palette (CSS vars on the catalog root only). Foundation. */
  palette?: SitePalette;

  /** Cream hero above the stream tabs + results header. Feature 'hero' (./catalog-hero-types.ts). */
  hero?: CatalogHeroConfig;

  /** Editorial filter sidebar + promo card. Feature 'sidebar' (./catalog-sidebar-types.ts). */
  filterSidebar?: CatalogFilterSidebarConfig;

  /** Authored FORMAT / FOR option groups. Feature 'sidebar' (./catalog-sidebar-types.ts). */
  customFilters?: CatalogCustomFilterConfig[];

  /** Start-free row, spotlight, coming soon inside the results column. Feature 'sections' (./catalog-sections-types.ts). */
  columnSections?: CatalogColumnSectionConfig[];
}

/** One tab when streams come from a hand-written tag list. */
export interface CatalogStreamItem {
  /** Tab text. */
  label: string;
  /** URL key (?stream=<slug>). */
  slug: string;
  /** The course tag the tab filters by. */
  tag: string;
  /** Tab icon (http(s) URL or site path); anything else is dropped. */
  imageUrl?: string;
}

export type CatalogStreamsConfig = CatalogStreamsBaseConfig & CatalogStreamsTabsExtension;

export interface CatalogStreamsBaseConfig {
  enabled?: boolean;
  /** 'folderLibrary': top-level folders are tabs, their sub-folders categories. 'tags': `items`. */
  source?: "folderLibrary" | "tags";
  libraryId?: string;
  items?: CatalogStreamItem[];
  /** First tab, no stream filter. Default "All courses". */
  allLabel?: string;
  /** Stick under the site header while scrolling. Default true. */
  sticky?: boolean;
  /** Which folder text the tab shows. Default 'title'. */
  labelMode?: "title" | "subtitle" | "both";
}

export type CatalogQuickFilterKind = "popular" | "new" | "free" | "bestseller" | "language" | "priceMax";

export interface CatalogQuickFilter {
  id: string;
  label: string;
  kind: CatalogQuickFilterKind;
  /** Language code for 'language'; amount for 'priceMax'. */
  value?: string | number;
}

export interface CourseDetailsProps {
  showEnroll: boolean;
  showPayment: boolean;
  showEnquiry: boolean;
  fields: {
    title: string;
    description: string;
    whyLearn: string;
    whoShouldLearn: string;
    duration: string;
    level: string;
    tags: string;
    previewImage: string;
    banner: string;
    rating: string;
    price: string;
  };
  leadCollection?: {
    enabled: boolean;
    mandatory: boolean;
    inviteLink: string | null;
    formStyle: {
      type: "single" | "multiStep";
      showProgress: boolean;
      progressType: "bar" | "dots" | "steps";
      transition: "slide" | "fade";
    };
    fields: Array<{
      name: string;
      label: string;
      type: "text" | "email" | "tel" | "chips" | "dropdown";
      required: boolean;
      step: number;
      options?: Array<{
        label: string;
        value: string;
        levelId?: string;
        packageSessionId?: string;
      }>;
      style?: {
        variant?: "filled" | "outlined";
        chipColor?: string;
        allowMultiple?: boolean;
      };
    }>;
  };
  instituteId?: string;
  courseId?: string;
  courseData?: any;
}

export interface CourseRecommendationsProps {
  title: string;
  limit: number;
}

export interface FooterProps {
  layout: "two-column" | "three-column" | "four-column";
  leftSection: {
    title: string;
    text: string;
    socials?: Array<{
      platform: string;
      icon: string;
      url: string;
      openInSameTab?: boolean;
    }>;
  };
  rightSection1?: {
    title: string;
    links: Array<{
      label: string;
      route: string;
      openInSameTab?: boolean;
    }>;
  };
  rightSection2?: {
    title: string;
    links: Array<{
      label: string;
      route: string;
      openInSameTab?: boolean;
    }>;
  };
  rightSection3?: {
    title: string;
    links: Array<{
      label: string;
      route: string;
      openInSameTab?: boolean;
    }>;
  };
  // Legacy support for backward compatibility
  rightSections?: Array<{
    title: string;
    links: Array<{
      label: string;
      route: string;
    }>;
  }>;
  rightSection?: {
    title: string;
    links: Array<{
      label: string;
      route: string;
    }>;
  };
  socialsSection?: {
    title: string;
    links: Array<{
      platform: string;
      icon: string;
      url: string;
    }>;
  };
  bottomNote: string;
}

export interface CartComponentProps {
  showItemImage?: boolean;
  showItemTitle?: boolean;
  showItemLevel?: boolean;
  showQuantitySelector?: boolean;
  quantityMin?: number;
  showRemoveButton?: boolean;
  showPrice?: boolean;
  showEmptyState?: boolean;
  emptyStateMessage?: string;
  instituteId?: string;
  globalSettings?: GlobalSettings;
  styles?: {
    padding?: string;
    roundedEdges?: boolean;
    backgroundColor?: string;
  };
  onlyLogic?: boolean;
  /** The page editor's preview: checkout and OTP never call the server. */
  isPreviewMode?: boolean;
}

export interface CartSummaryProps {
  showSubtotal?: boolean;
  showTaxes?: boolean;
  showTotal?: boolean;
  checkoutButtonEnabled?: boolean;
  checkoutButtonLabel?: string;
  styles?: {
    padding?: string;
    roundedEdges?: boolean;
    backgroundColor?: string;
  };
}
