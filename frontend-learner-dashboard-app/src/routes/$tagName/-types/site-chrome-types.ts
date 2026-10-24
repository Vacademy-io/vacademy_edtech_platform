/**
 * Opt-in site chrome props (feature "chrome"): header, footer "brand",
 * ctaBanner "band" and stepsProcess "cards". Every field is optional and
 * absent means the original look, so a site that sets none of them renders
 * exactly as before (chrome-default-golden.test.ts pins it).
 *
 * Key names follow catalogue-i18n's rules: copy lives under text keys
 * (heading, tagline, eyebrow, note, bottomTagline…) and is translated by
 * localizeComponentProps; enums and links use non-text names (…Size, …Width,
 * …Style, …Display, variant, logo, image, target, audienceId).
 */

/* ── header (globalSettings.layout.header.props) ───────────────────────── */

/** "compact" = a 64px bar at every width with a 48px logo (absent = 64/80px). */
export type HeaderBarSize = "default" | "compact";
/** "contained" = content in a 1280px container (80 + 64px gutters at xl), as in the design. */
export type HeaderContentWidth = "full" | "contained";
/**
 * "editorial" = text nav (13px, 32px apart, the current page bold in the
 * palette gold, the open mega menu underlined in the palette accent), a line
 * search icon in the palette olive, 13px auth links and 8px-radius buttons.
 */
export type HeaderNavStyle = "default" | "editorial";
/** "segmented" = a bordered two-part हिन्दी | EN control with the active half filled. */
export type HeaderLanguageSwitcherStyle = "pill" | "segmented";
/** "whenNotEmpty" = the site-cart icon shows only once the cart has an item (the drawer still opens). */
export type HeaderCartDisplay = "always" | "whenNotEmpty";
/** "editorial" = the streams mega menu panel of the design (120px stream tiles, cream detail box). */
export type HeaderMegaMenuStyle = "default" | "editorial";

export interface HeaderChromeProps {
  barSize?: HeaderBarSize;
  contentWidth?: HeaderContentWidth;
  navStyle?: HeaderNavStyle;
  /** Show the logo only: no site title / institute name next to it. */
  logoOnly?: boolean;
  languageSwitcherStyle?: HeaderLanguageSwitcherStyle;
  cartDisplay?: HeaderCartDisplay;
  megaMenuStyle?: HeaderMegaMenuStyle;
}

/* ── footer (globalSettings.layout.footer.props) ───────────────────────── */

export interface FooterLink {
  label: string;
  route: string;
  openInSameTab?: boolean;
}

export interface FooterLinkColumn {
  title: string;
  links: FooterLink[];
}

/** The newsletter inside the "brand" footer (absent or enabled:false = none). */
export interface FooterNewsletterConfig {
  enabled?: boolean;
  heading?: string;
  subheading?: string;
  placeholder?: string;
  buttonText?: string;
  /** Small print under the form. */
  note?: string;
  successMessage?: string;
  /** Lead campaign the address goes to. */
  audienceId?: string;
  /** Campaign name at the time it was picked (editor display only). */
  audienceName?: string;
}

export interface FooterBrandProps {
  /** "brand" = logo + wordmark + description + tagline, newsletter, socials, 4 link columns, bottom bar. */
  variant?: "brand";
  leftSection?: {
    /** Logo URL or file id (brand variant). */
    logo?: string;
    /** Line under the description (brand variant). */
    tagline?: string;
  };
  rightSection4?: FooterLinkColumn;
  newsletter?: FooterNewsletterConfig;
  /** Right end of the bottom bar (brand variant). */
  bottomTagline?: string;
  /** हिन्दी | EN in the bottom bar (brand variant; only on a site with languages). */
  showLanguageSwitcher?: boolean;
}

/* ── ctaBanner variant "band" ──────────────────────────────────────────── */

export type CtaBandButtonStyle = "primary" | "olive" | "outline-light" | "outline-dark";

export interface CtaBandButtonConfig {
  enabled?: boolean;
  text?: string;
  action?: "navigate" | "openForm";
  target?: string;
  audienceId?: string;
  formTitle?: string;
  /** Absent / unknown = "primary". */
  style?: CtaBandButtonStyle | string;
  /** "arrow" adds → after the text. */
  icon?: "arrow" | "none" | string;
}

export interface CtaBandMockup {
  kind?: "phone";
  /** Picture on the phone screen. */
  image?: string;
  alt?: string;
}

export interface CtaBannerBandProps {
  variant?: "band" | string;
  /** "lg" = 72px band padding and 16/26 subheading (the light institutions band); absent = 64px, 15/22. */
  bandSize?: "md" | "lg";
  eyebrow?: string;
  eyebrowColor?: string;
  heading?: string;
  subheading?: string;
  subheadingColor?: string;
  backgroundColor?: string;
  textColor?: string;
  button?: CtaBandButtonConfig;
  secondaryButton?: CtaBandButtonConfig;
  /** A phone showing `image` beside the copy (the app banner). */
  mockup?: CtaBandMockup;
  /** Google Play / App Store badges (https links) shown in place of the buttons. */
  appLinks?: { playStore?: string; appStore?: string };
}

/* ── stepsProcess variant "cards" ──────────────────────────────────────── */

export interface StepsCardsStep {
  number?: string;
  title?: string;
  description?: string;
}

export interface StepsCardsProps {
  variant?: "cards" | string;
  headerText?: string;
  subheading?: string;
  backgroundColor?: string;
  /** Heading colour (cards variant only). */
  textColor?: string;
  /** Number circle colour; absent = the palette primary. */
  accentColor?: string;
  steps?: StepsCardsStep[];
}
