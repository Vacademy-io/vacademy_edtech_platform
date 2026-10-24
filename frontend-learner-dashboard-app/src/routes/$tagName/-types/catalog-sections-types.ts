/**
 * courseCatalog.columnSections — OWNED BY FEATURE 'sections'
 * (specs/in-results-sections.json).
 *
 * Authored blocks inside the Courses grid's results column (Figma "Courses"
 * page: "New here? Start free" 1:288, the flagship spotlight 1:298 and
 * "Coming soon" 1:405). A section without this prop renders nothing new.
 *
 * Key names follow the site-dictionary rules (catalogue-i18n.ts): prose keys
 * (title, subtitle, label, description, meta…) arrive already translated;
 * enum values are lower-case tokens and ids/slugs/colours use non-text key
 * names, so they are never translated.
 */

/** Where a section renders: before the grid (after the quick filters) or after the pagination. */
export type ColumnSectionPlacement = "before-grid" | "after-grid";

/**
 * When a section shows:
 *  - 'unfiltered': only on the plain "All" view (no stream, search or filter; first page);
 *  - 'always': in every view;
 *  - 'unfiltered-or-own-stream' (spotlight): every slide on the plain view, and on a stream
 *    tab (with nothing else narrowing it) only the slides authored for that stream.
 */
export type ColumnSectionShowWhen = "unfiltered" | "always" | "unfiltered-or-own-stream";

interface ColumnSectionBase {
  /** Unique per section (React key, aria ids). */
  id: string;
  placement?: ColumnSectionPlacement;
  showWhen?: ColumnSectionShowWhen;
  /** Heading (24px bold). */
  title?: string;
  /** Line under the heading. */
  subtitle?: string;
}

/** A CTA label for free cards of some formats ("Watch free" for film/animation). */
export interface FreeCoursesCtaRule {
  /** Course format keys (globalSettings.courseFormats, e.g. "animation", "video"). */
  formats?: string[];
  /** Raw course tags (lower-case). */
  tags?: string[];
  label: string;
}

/** "New here? Start free": a few free courses, rendered with the grid's own card. */
export interface FreeCoursesSectionConfig extends ColumnSectionBase {
  kind: "free-courses";
  /** "See all {count} free" — {count} = every free card; "" hides the link. */
  seeAllLabel?: string;
  /** Courses to show first, in this order (package id or package-session id). Then the rest by popularity. */
  courseIds?: string[];
  /** Cards shown (1-6, default 3). */
  limit?: number;
  /** Card CTA text (default "Start free"); the arrow is added. */
  ctaLabel?: string;
  /** Format/tag-specific CTA text; the first matching rule wins. */
  ctaRules?: FreeCoursesCtaRule[];
  /** Pill on the card image (default "Free"; "" = none). Editorial card only. */
  badgeText?: string;
}

/** What the spotlight button does. */
export interface SpotlightCtaConfig {
  /**
   * "Enrol for {price}" — {price} = the live price: the course's catalogue
   * row, else (a course not published to the catalogue) the plan of
   * `enrollInviteId` for `packageSessionId`. A live price of 0 drops
   * "for {price}". Without a live price, `price`; without that, no price.
   */
  label: string;
  /** Authored price text, used only when no live price can be read ("₹1,001"). */
  price?: string;
  /** 'course' opens the course like a card; 'product-page' a product page; 'navigate' a site route; 'open-form' an audience form. */
  action: "course" | "product-page" | "navigate" | "open-form";
  /** 'course': the package (course) id. A placeholder such as "<id>" is ignored (no button). */
  courseId?: string;
  enrollInviteId?: string;
  packageSessionId?: string;
  /**
   * 'product-page': the page to open. With 'course': a product page that
   * sells the course — a course not published to the catalogue opens through
   * it (its details page only shows such a course for a product page that sells it).
   */
  productPageCode?: string;
  route?: string;
  audienceId?: string;
  /** Title of the audience form ('open-form'); default: the slide title. */
  formTitle?: string;
}

/** One numbered step card under the spotlight text. */
export interface SpotlightStepConfig {
  title: string;
  /** "Free", "₹251", "Included" — may use {price}. */
  meta?: string;
  /** 'accent' = filled circle (step 1 in Figma). */
  tone?: "accent" | "default";
  /** A site route: the step becomes a link. */
  route?: string;
  /** An audience form: the step becomes a button that opens it. */
  audienceId?: string;
}

export interface SpotlightSlideConfig {
  id: string;
  /** "Flagship program" (shown upper-case). */
  eyebrow?: string;
  /** A stream (folder slug): adds " · <its subtitle>" to the eyebrow and its accent colour to step 1. */
  streamSlug?: string;
  /** Text after the eyebrow when no stream is set. */
  eyebrowSuffix?: string;
  title: string;
  /** The Devanagari title shown beside it (once, when the translated title is the same). */
  titleNative?: string;
  description?: string;
  cta?: SpotlightCtaConfig;
  /** Up to 4. */
  steps?: SpotlightStepConfig[];
}

/**
 * Colours the site palette has no name for (hex, inline style). Every one is
 * optional and falls back to a palette/catalogue token.
 */
export interface SpotlightColors {
  /** Panel background (default: palette sand). */
  panelColor?: string;
  /** Step-circle border, previous-button border (Figma hex a08a5c; default: palette border-strong). */
  ringColor?: string;
  /** Inactive carousel dot (Figma hex c9b78e; default: palette border-strong). */
  dotColor?: string;
  /** Meta text of the accent step (Figma hex 3f4a26; default: palette text). */
  accentInkColor?: string;
  /** Fill of the accent step circle (default: the stream's accent, else palette olive). */
  accentColor?: string;
}

/** Flagship programme panel; a carousel when it has more than one slide. */
export interface SpotlightSectionConfig extends ColumnSectionBase {
  kind: "spotlight";
  slides: SpotlightSlideConfig[];
  /** Auto-advance every n ms (0/absent = off); pauses on hover and focus. */
  autoplayMs?: number;
  colors?: SpotlightColors;
}

export interface ComingSoonColors {
  /** The bell icon (Figma uses the gold 🔔 emoji; default: palette gold). */
  iconColor?: string;
}

/** Folder-library categories flagged coming soon, each with a "Notify me" button. */
export interface ComingSoonSectionConfig extends ColumnSectionBase {
  kind: "coming-soon";
  /** Button text (default: the translated "Notify me"). */
  notifyLabel?: string;
  /** 'active-stream' (default): on a stream tab only that stream's categories; 'all': always every stream. */
  scope?: "all" | "active-stream";
  /** Only these categories (folder slugs), in this order. */
  categorySlugs?: string[];
  /** Cards shown (1-12, default 4). */
  limit?: number;
  colors?: ComingSoonColors;
}

export type CatalogColumnSectionConfig =
  | FreeCoursesSectionConfig
  | SpotlightSectionConfig
  | ComingSoonSectionConfig;
