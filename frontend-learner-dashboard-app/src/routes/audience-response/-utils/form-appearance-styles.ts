/**
 * Design-token class maps for the audience response page.
 *
 * Tailwind only sees class names it can read literally, so every combination is
 * spelled out here rather than built with `bg-${accent}-100` interpolation —
 * an interpolated class is simply absent from the compiled stylesheet and the
 * element renders unstyled. (See project note: "Tailwind class existence
 * check".)
 *
 * Lives in its own module, not alongside the page component: exporting
 * constants from a component file breaks React Fast Refresh, and both the page
 * and its sub-blocks need these.
 *
 * Reminder for editors — the learner app's primary scale stops at `500`.
 * `primary-600` compiles to nothing here, so accent hovers step to `400`.
 */
import type { ModernCardProps } from "@/components/design-system/modern-card";
import type {
  AudienceFormAccent,
  AudienceFormBackground,
  AudienceFormCardStyle,
  AudienceFormTextAlign,
  AudienceFormWidth,
} from "./form-appearance";

/**
 * Page background.
 *
 * `muted` is the default and the one to reach for: a neutral surface behind a
 * white card is what every serious public form does (Stripe, Linear, Typeform,
 * HubSpot), because the only job of the page behind a form is to separate the
 * card from the browser and stay out of the way. Colour belongs on the one
 * primary action, not under the fields people are trying to read.
 *
 * `gradient` is kept for campaigns that deliberately want a branded marketing
 * page. It uses `bg-app-page-wash`, not `bg-app-gradient`: the latter is a
 * single `to bottom right` linear gradient, so all its colour lands in the
 * top-left corner and has washed out by the middle of the page — precisely
 * where the form card sits.
 */
export const FORM_BACKGROUND_CLASS: Record<AudienceFormBackground, string> = {
  gradient: "bg-app-page-wash",
  plain: "bg-background",
  muted: "bg-muted",
};

/** Content column width. */
export const FORM_WIDTH_CLASS: Record<AudienceFormWidth, string> = {
  narrow: "max-w-2xl",
  regular: "max-w-4xl",
  wide: "max-w-6xl",
};

/** Card treatment, split into the ModernCard variant and its trim. */
export const FORM_CARD_VARIANT: Record<
  AudienceFormCardStyle,
  NonNullable<ModernCardProps["variant"]>
> = {
  glass: "glass",
  elevated: "elevated",
  outlined: "outlined",
  flat: "default",
};

export const FORM_CARD_CLASS: Record<AudienceFormCardStyle, string> = {
  glass: "border border-white/40 bg-white/90 backdrop-blur-md shadow-lg",
  // shadow-sm, not shadow-lg: a hairline border plus a barely-there shadow is
  // the standard treatment. A heavy drop shadow makes a form look like a modal
  // that failed to open.
  elevated: "border border-border bg-card shadow-sm",
  outlined: "border border-border bg-card shadow-none",
  flat: "border-0 bg-card shadow-none",
};

/** Tinted bubble: background + matching foreground (icons, badges). */
export const FORM_ACCENT_SOFT_CLASS: Record<AudienceFormAccent, string> = {
  primary: "bg-primary-100 text-primary-500",
  success: "bg-success-100 text-success-600",
  info: "bg-info-100 text-info-600",
  warning: "bg-warning-100 text-warning-600",
  neutral: "bg-neutral-100 text-neutral-600",
};

/** Accent-colored text on the page background. */
export const FORM_ACCENT_TEXT_CLASS: Record<AudienceFormAccent, string> = {
  primary: "text-primary-500",
  success: "text-success-600",
  info: "text-info-600",
  warning: "text-warning-600",
  neutral: "text-neutral-600",
};

/** Solid action button in the campaign's accent. */
export const FORM_ACCENT_BUTTON_CLASS: Record<AudienceFormAccent, string> = {
  primary: "bg-primary-500 text-white hover:bg-primary-400",
  success: "bg-success-600 text-white hover:bg-success-700",
  info: "bg-info-600 text-white hover:bg-info-700",
  warning: "bg-warning-600 text-white hover:bg-warning-700",
  neutral: "bg-neutral-700 text-white hover:bg-neutral-800",
};

/** Fill of the completion meter in the form header. */
export const FORM_ACCENT_METER_CLASS: Record<AudienceFormAccent, string> = {
  primary: "bg-primary-500",
  success: "bg-success-600",
  info: "bg-info-600",
  warning: "bg-warning-600",
  neutral: "bg-neutral-600",
};

/**
 * Rich-text container for admin-authored HTML (hero body, footer note).
 * Sanitized upstream; this only decides how the surviving tags look.
 */
export const FORM_RICH_TEXT_CLASS =
  "[&_a]:text-primary-500 [&_a]:underline [&_h1]:text-h3 [&_h2]:text-h3 [&_h3]:text-title [&_img]:mx-auto [&_img]:max-w-full [&_img]:rounded-lg [&_li]:list-inside [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4";

/**
 * Alignment of a text block (the heading block, the form card's header).
 * Three maps because a block mixes three kinds of children: text inherits
 * `text-align`; a `w-fit` chip in a flex column needs `align-self`; a wrapping
 * row of chips needs `justify-content`.
 *
 * `left` — the default — adds NO class, so an untouched campaign renders the
 * exact markup it always did. That matters for RTL: the page sets
 * `dir="rtl"` for Arabic, where the inherited start edge is the right, and a
 * physical `text-left` would flip every existing Arabic form.
 */
export const FORM_TEXT_ALIGN_CLASS: Record<AudienceFormTextAlign, string> = {
  left: "",
  center: "text-center",
  right: "text-right",
};

export const FORM_SELF_ALIGN_CLASS: Record<AudienceFormTextAlign, string> = {
  left: "",
  center: "self-center",
  right: "self-end",
};

export const FORM_JUSTIFY_CLASS: Record<AudienceFormTextAlign, string> = {
  left: "",
  center: "justify-center",
  right: "justify-end",
};
