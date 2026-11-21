/**
 * Class maps for the whole-page templates (`formAppearance.template`).
 *
 * `standard` is absent on purpose: it is the page driven by the individual
 * layout / background / card knobs, exactly as it rendered before templates
 * existed. Every other template owns those three and keeps the rest — copy,
 * fields, accent, width — from the campaign's own blob.
 *
 * Colour comes from the institute's brand scale (`primary-*`), never a literal,
 * so one template looks native on every institute. The learner primary scale
 * has no `<alpha-value>`, so tints over it use white/black with opacity.
 *
 * Spelled out literally for the same reason as form-appearance-styles.ts:
 * Tailwind only compiles class names it can read.
 */
import type { ModernCardProps } from "@/components/design-system/modern-card";
import type { AudienceFormTemplate } from "./form-appearance";

export type ShellTemplate = Exclude<AudienceFormTemplate, "standard">;

export interface FormTemplateLook {
  /** Page background, on the form and the thank-you screen. */
  page: string;
  /** Extra classes for the sticky branding bar. */
  header: string;
  /** Content column width — templates own it, the `width` knob is ignored. */
  column: string;
  cardVariant: NonNullable<ModernCardProps["variant"]>;
  /** Replaces the card-style classes on the form card and the thank-you card. */
  card: string;
  /** `inverse` = white copy, for a heading that sits on a coloured surface. */
  heroTone: "default" | "inverse";
  /** Extra classes for the footer note, which may sit on a coloured page. */
  footer: string;
  /** Extra classes for the submit button. */
  submit: string;
}

/**
 * Card classes carry `!` where they fight `.card-base`: that rule sits outside
 * Tailwind's layers, so its border, radius and shadow beat plain utilities.
 *
 * `outlined` + `hover:bg-transparent` for the cards that should not look like
 * cards: the `default` variant carries a hover lift (`card-hover`), which on a
 * borderless form reads as the whole page jumping under the cursor.
 */
export const FORM_TEMPLATE_LOOK: Record<ShellTemplate, FormTemplateLook> = {
  // Brand-coloured band with the heading; the form card overlaps its edge.
  banner: {
    page: "bg-muted",
    header: "",
    column: "max-w-3xl",
    cardVariant: "elevated",
    card: "!rounded-2xl border border-border bg-card !shadow-xl hover:!shadow-xl",
    heroTone: "inverse",
    footer: "",
    submit: "",
  },
  // Full-height brand panel on the left, the form on plain white beside it.
  split: {
    page: "bg-background",
    header: "",
    column: "max-w-6xl",
    cardVariant: "outlined",
    card: "!border-0 p-0 !shadow-none hover:bg-transparent",
    heroTone: "inverse",
    footer: "",
    submit: "sm:w-full",
  },
  // One card: the heading in a brand-coloured strip, the fields under it.
  framed: {
    page: "bg-muted",
    header: "",
    column: "max-w-2xl",
    cardVariant: "outlined",
    card: "!rounded-none !border-0 bg-card !shadow-none hover:bg-card",
    heroTone: "inverse",
    footer: "",
    submit: "sm:w-full",
  },
  // White page, no card chrome, a narrow column and a full-width action.
  minimal: {
    page: "bg-background",
    header: "border-transparent",
    column: "max-w-xl",
    cardVariant: "outlined",
    card: "!border-0 p-0 !shadow-none hover:bg-transparent",
    heroTone: "default",
    footer: "",
    submit: "sm:w-full",
  },
  // Brand gradient behind everything, a frosted card centred on it.
  gradient: {
    page: "bg-gradient-to-br from-primary-500 via-primary-400 to-primary-300",
    header: "",
    column: "max-w-2xl",
    cardVariant: "elevated",
    card: "!rounded-2xl !border-white/40 !bg-white/95 !shadow-2xl backdrop-blur-md hover:!shadow-2xl",
    heroTone: "inverse",
    footer: "text-white/85 [&_a]:text-white",
    submit: "",
  },
  // Near-black page, the heading beside a white card under a brand glow.
  dark: {
    page: "bg-slate-950",
    header: "border-white/10 bg-slate-950 [&_h2]:text-white",
    column: "max-w-6xl",
    cardVariant: "elevated",
    card: "!rounded-2xl !border-white/10 bg-card !shadow-2xl hover:!shadow-2xl",
    heroTone: "inverse",
    footer: "text-white/70 [&_a]:text-white",
    submit: "",
  },
  // The institute logo, large and faded, behind a lightly frosted card.
  logo: {
    page: "bg-muted",
    header: "",
    column: "max-w-2xl",
    cardVariant: "elevated",
    card: "!rounded-2xl !border-white/60 !bg-white/60 !shadow-xl backdrop-blur-sm hover:!shadow-xl",
    heroTone: "default",
    footer: "",
    submit: "",
  },
};

/** Templates that paint the cover image behind the heading instead of above it. */
export const BACKDROP_TEMPLATES: readonly ShellTemplate[] = ["banner", "split", "framed"];

export const isShellTemplate = (
  template: AudienceFormTemplate
): template is ShellTemplate => template !== "standard";
