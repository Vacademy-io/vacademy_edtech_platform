/**
 * Audience form appearance — the respondent-facing half.
 *
 * Everything a campaign can change about how its public response page LOOKS,
 * without a code change: layout, width, background, accent, card treatment,
 * cover art, the copy in the hero and the form header, the trust highlights,
 * and the footer note. It arrives inside the campaign's `setting_json` under
 * the `formAppearance` key, served by the anonymous
 * `open/v1/audience/campaign/{instituteId}/{audienceId}` endpoint — the same
 * blob that already carries `postSubmitConfiguration`.
 *
 * Two rules govern this module:
 *
 *  1. **Never throw.** A missing, empty, malformed or future-versioned blob
 *     resolves to the defaults. A public form must render for an anonymous
 *     visitor no matter what an admin saved.
 *  2. **The defaults ARE the design.** Unlike the post-submit config there is
 *     no master switch: a campaign that has never been styled gets the full
 *     default treatment. `formAppearance` only *deviates* from it.
 *
 * Anything visual that is NOT here on purpose: brand color, corner radius,
 * density and skin. Those are institute-wide axes (`data-ui-*` on `<html>`,
 * see docs/design-system/09-learner-app.md) and are already applied to this
 * page — a campaign should not be able to fight its own institute's brand.
 *
 * Keep in sync with the admin app's editor when one is built. Until then this
 * is edited by writing the key into the campaign's `setting_json`, alongside
 * `postSubmitConfiguration`. Every key is optional; the full shape is:
 *
 * ```json
 * {
 *   "formAppearance": {
 *     "template": "standard",      // standard | banner | split | framed | minimal | gradient | dark | logo
 *     "layout": "hero",            // classic | hero | split
 *     "width": "regular",          // narrow | regular | wide
 *     "background": "muted",       // muted | plain | gradient
 *     "accent": "primary",         // primary | success | info | warning | neutral
 *     "cardStyle": "elevated",     // glass | elevated | outlined | flat
 *     "coverImageUrl": "https://…/banner.png",
 *     "eyebrow": "Admissions 2026",
 *     "headline": "<p>Talk to <strong>our team</strong></p>",
 *     "headingAlign": "left",      // left | center | right
 *     "showHeader": true,          // institute logo + name bar at the top
 *     "showHeadline": true,        // the page heading (campaign name / headline)
 *     "subheadline": "<p>Rich text is allowed and sanitized.</p>",
 *     "showDescription": true,
 *     "showObjective": true,
 *     "formTitle": "Your details",
 *     "formSubtitle": "<p>We only use this to get back to you.</p>",
 *     "formHeaderAlign": "left",   // left | center | right
 *     "submitLabel": "Request a callback",
 *     "showRequiredLegend": false,
 *     "showProgress": false,
 *     "highlights": [
 *       { "icon": "shield", "text": "We never share your details" }
 *     ],
 *     "footerNote": "<p>Questions? hello@example.com</p>"
 *   }
 * }
 * ```
 *
 * `headline` and `formSubtitle` take plain text OR rich text (sanitized HTML from
 * the admin's editor); plain values saved before rich text existed render
 * exactly as they did.
 *
 * `icon` is one of sparkle | shield | clock | check | users | chat. An
 * unrecognised value anywhere falls back to the default rather than breaking
 * the page, so a typo costs a style, never a submission.
 */
import {
  resolvePostSubmitUrl,
  sanitizePostSubmitHtml,
} from "./post-submit-config";

/**
 * A whole-page look, picked from a gallery in the admin's campaign form.
 * `standard` is the page as it has always rendered and is driven by the
 * individual knobs below. Every other template owns the page shell — layout,
 * background and card — while the copy, fields, accent and width still come
 * from the rest of the blob. See form-template-styles.ts.
 */
export type AudienceFormTemplate =
  | "standard"
  | "banner"
  | "split"
  | "framed"
  | "minimal"
  | "gradient"
  | "dark"
  | "logo";
export type AudienceFormLayout = "classic" | "hero" | "split";
export type AudienceFormWidth = "narrow" | "regular" | "wide";
export type AudienceFormBackground = "gradient" | "plain" | "muted";
export type AudienceFormAccent =
  | "primary"
  | "success"
  | "info"
  | "warning"
  | "neutral";
export type AudienceFormCardStyle =
  | "glass"
  | "elevated"
  | "outlined"
  | "flat";
export type AudienceFormHighlightIcon =
  | "sparkle"
  | "shield"
  | "clock"
  | "check"
  | "users"
  | "chat";
export type AudienceFormTextAlign = "left" | "center" | "right";

export interface AudienceFormHighlight {
  id: string;
  icon: AudienceFormHighlightIcon;
  text: string;
}

/** Hard cap so a malformed blob cannot render an unbounded list. */
export const MAX_FORM_HIGHLIGHTS = 4;

export interface AudienceFormAppearance {
  template: AudienceFormTemplate;
  layout: AudienceFormLayout;
  width: AudienceFormWidth;
  background: AudienceFormBackground;
  accent: AudienceFormAccent;
  cardStyle: AudienceFormCardStyle;
  /** Banner image above the hero copy. Blank hides it. */
  coverImageUrl: string;
  /** Small label above the headline (e.g. "Admissions 2026"). Blank hides it. */
  eyebrow: string;
  /**
   * Overrides `campaign_name` as the page's h1. Plain text or rich text
   * (sanitized at render). Blank — including an empty editor's `<p></p>` —
   * keeps the campaign name.
   */
  headline: string;
  /** Alignment of the heading block: eyebrow, headline, intro, highlights. */
  headingAlign: AudienceFormTextAlign;
  /** The sticky institute branding bar, on the form and the thank-you screen. */
  showHeader: boolean;
  /** The page heading — the `headline` override or the campaign name. */
  showHeadline: boolean;
  /** Overrides the campaign `description` HTML. Blank keeps the description. */
  subheadline: string;
  showDescription: boolean;
  showObjective: boolean;
  /** Overrides the "Please fill in your details" card heading. */
  formTitle: string;
  /** Overrides the line under the card heading. Plain text or rich text. */
  formSubtitle: string;
  /** Alignment of the form card's heading + sub-heading. */
  formHeaderAlign: AudienceFormTextAlign;
  /** Overrides the submit button label. */
  submitLabel: string;
  /** "* Required field" line under the form header. Off by default. */
  showRequiredLegend: boolean;
  /** "3 of 5 required fields completed" meter in the form header. Off by default. */
  showProgress: boolean;
  highlights: AudienceFormHighlight[];
  /** Sanitized HTML under the form card (privacy note, contact line, …). */
  footerNote: string;

  // ── Escape hatch ──
  /**
   * Sanitized HTML that REPLACES the whole structured hero — cover, eyebrow,
   * headline, intro, objective and highlights. For campaigns that want a
   * hand-built pitch the structured fields cannot express. The form card is
   * never replaceable: it is generated from the campaign's custom fields.
   */
  heroHtml: string;
  /**
   * Sanitized CSS applied to this page only. Together with `heroHtml` this is
   * the "style the whole page yourself" hatch. Target the `vac-af-*` hook
   * classes the page puts on its own landmarks — see AUDIENCE_FORM_HOOKS.
   */
  customCss: string;
}

export const DEFAULT_FORM_APPEARANCE: AudienceFormAppearance = {
  template: "standard",
  layout: "hero",
  width: "regular",
  // Neutral surface + white card + one brand-coloured action. A gradient behind
  // a form competes with the fields for attention; `gradient` stays available
  // for campaigns that deliberately want a marketing page.
  background: "muted",
  accent: "primary",
  cardStyle: "elevated",
  coverImageUrl: "",
  eyebrow: "",
  headline: "",
  headingAlign: "left",
  showHeader: true,
  showHeadline: true,
  subheadline: "",
  showDescription: true,
  showObjective: true,
  formTitle: "",
  formSubtitle: "",
  formHeaderAlign: "left",
  submitLabel: "",
  // Both off: every required field already carries a red asterisk, so the
  // legend restates it, and a meter over a five-field form is noise. Left as
  // switches rather than deleted — a long multi-section form is the case they
  // were written for.
  showRequiredLegend: false,
  showProgress: false,
  highlights: [],
  footerNote: "",
  heroHtml: "",
  customCss: "",
};

const FORM_APPEARANCE_KEY = "formAppearance";

const TEMPLATES: readonly AudienceFormTemplate[] = [
  "standard",
  "banner",
  "split",
  "framed",
  "minimal",
  "gradient",
  "dark",
  "logo",
];
const LAYOUTS: readonly AudienceFormLayout[] = ["classic", "hero", "split"];
const WIDTHS: readonly AudienceFormWidth[] = ["narrow", "regular", "wide"];
const BACKGROUNDS: readonly AudienceFormBackground[] = [
  "gradient",
  "plain",
  "muted",
];
const ACCENTS: readonly AudienceFormAccent[] = [
  "primary",
  "success",
  "info",
  "warning",
  "neutral",
];
const CARD_STYLES: readonly AudienceFormCardStyle[] = [
  "glass",
  "elevated",
  "outlined",
  "flat",
];
const TEXT_ALIGNS: readonly AudienceFormTextAlign[] = ["left", "center", "right"];
const HIGHLIGHT_ICONS: readonly AudienceFormHighlightIcon[] = [
  "sparkle",
  "shield",
  "clock",
  "check",
  "users",
  "chat",
];

/** Longest single string we will render from the blob, per field. */
const MAX_TEXT = 500;

/**
 * Cap for the fields that may hold rich text. Markup is far longer than the
 * words it wraps, and slicing it at MAX_TEXT would cut a tag in half.
 */
const MAX_RICH_TEXT = 5000;

const toStr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value.slice(0, MAX_TEXT) : fallback;

const toRichText = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value.slice(0, MAX_RICH_TEXT) : fallback;

const toBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const toEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/**
 * An image URL we are willing to point an `<img src>` at. Reuses the
 * post-submit URL guard, so `javascript:`, `data:` and protocol-relative
 * `//evil.com` all resolve to "no image" rather than rendering.
 */
const toImageUrl = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return resolvePostSubmitUrl(value, {}) ?? "";
};

const toHighlights = (raw: unknown): AudienceFormHighlight[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_FORM_HIGHLIGHTS)
    .map((entry, index) => {
      const src = (entry ?? {}) as Partial<AudienceFormHighlight>;
      return {
        id: toStr(src.id, "") || `highlight-${index}`,
        icon: toEnum<AudienceFormHighlightIcon>(
          src.icon,
          HIGHLIGHT_ICONS,
          "check"
        ),
        text: toStr(src.text, ""),
      };
    })
    // A highlight with no text is a bullet with nothing next to it.
    .filter((highlight) => highlight.text.trim().length > 0);
};

/**
 * Read the appearance out of a campaign's `setting_json`. Never throws.
 */
export const parseAudienceFormAppearance = (
  settingJson?: string | null
): AudienceFormAppearance => {
  let raw: unknown = undefined;
  if (settingJson && settingJson.trim()) {
    try {
      const parsed = JSON.parse(settingJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = (parsed as Record<string, unknown>)[FORM_APPEARANCE_KEY];
      }
    } catch {
      raw = undefined;
    }
  }
  const src = (raw ?? {}) as Partial<AudienceFormAppearance> &
    Record<string, unknown>;
  const d = DEFAULT_FORM_APPEARANCE;
  return {
    template: toEnum(src.template, TEMPLATES, d.template),
    layout: toEnum(src.layout, LAYOUTS, d.layout),
    width: toEnum(src.width, WIDTHS, d.width),
    background: toEnum(src.background, BACKGROUNDS, d.background),
    accent: toEnum(src.accent, ACCENTS, d.accent),
    cardStyle: toEnum(src.cardStyle, CARD_STYLES, d.cardStyle),
    coverImageUrl: toImageUrl(src.coverImageUrl),
    eyebrow: toStr(src.eyebrow, d.eyebrow),
    headline: toRichText(src.headline, d.headline),
    headingAlign: toEnum(src.headingAlign, TEXT_ALIGNS, d.headingAlign),
    showHeader: toBool(src.showHeader, d.showHeader),
    showHeadline: toBool(src.showHeadline, d.showHeadline),
    subheadline: toStr(src.subheadline, d.subheadline),
    showDescription: toBool(src.showDescription, d.showDescription),
    showObjective: toBool(src.showObjective, d.showObjective),
    formTitle: toStr(src.formTitle, d.formTitle),
    formSubtitle: toRichText(src.formSubtitle, d.formSubtitle),
    formHeaderAlign: toEnum(src.formHeaderAlign, TEXT_ALIGNS, d.formHeaderAlign),
    submitLabel: toStr(src.submitLabel, d.submitLabel),
    showRequiredLegend: toBool(src.showRequiredLegend, d.showRequiredLegend),
    showProgress: toBool(src.showProgress, d.showProgress),
    highlights: toHighlights(src.highlights),
    footerNote: toStr(src.footerNote, d.footerNote),
    // The two escape-hatch fields carry markup, so they are capped and
    // sanitized at render rather than sliced to MAX_TEXT like a label.
    heroHtml: typeof src.heroHtml === "string" ? src.heroHtml : d.heroHtml,
    customCss: typeof src.customCss === "string" ? src.customCss : d.customCss,
  };
};

// ─── Escape hatch: custom HTML + CSS ─────────────────────────────────────────

/**
 * Stable class names the page puts on its own landmarks so admin-authored CSS
 * has something to target that survives a refactor. Everything else on the page
 * is Tailwind, whose class names are an implementation detail.
 */
export const AUDIENCE_FORM_HOOKS = {
  page: "vac-af-page",
  header: "vac-af-header",
  hero: "vac-af-hero",
  card: "vac-af-card",
  cardHeader: "vac-af-card-header",
  fields: "vac-af-fields",
  field: "vac-af-field",
  submit: "vac-af-submit",
  footer: "vac-af-footer",
  success: "vac-af-success",
} as const;

const MAX_CSS = 20000;

/**
 * Make admin-authored CSS safe to drop into a `<style>` element on an anonymous
 * page.
 *
 * CSS cannot execute script in any browser this app supports, so the risks are
 * narrower than for HTML and each gets its own rule:
 *
 *  - `</` — the ONLY way out of a `<style>` element is the literal `</style`.
 *    Stripping every `</` closes that door without touching the child
 *    combinator (`a > b`), which is ordinary CSS people actually write.
 *  - `@import` — a same-page stylesheet must not pull in a third-party one.
 *  - `expression()` / `behavior:` / `-moz-binding:` — legacy script vectors.
 *  - `url(...)` — kept only for http(s), same-origin paths and inline images.
 *    Anything else (`javascript:`, a bare `data:text/html`) is dropped.
 *
 * Returns "" for blank input so callers can skip rendering the element rather
 * than emit an empty one.
 */
export const sanitizeCustomCss = (css: string): string => {
  if (!css || !css.trim()) return "";
  return (
    css
      .slice(0, MAX_CSS)
      // Break out of <style> — the one thing that turns CSS into HTML.
      .replace(/<\//g, "")
      .replace(/@import[^;{}]*;?/gi, "")
      .replace(/expression\s*\(/gi, "")
      .replace(/behavior\s*:/gi, "")
      .replace(/-moz-binding\s*:/gi, "")
      .replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (match, _quote, target: string) => {
        const value = target.trim();
        return /^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(value) ? match : "none";
      })
      .trim()
  );
};

/**
 * The admin's hand-built hero, sanitized. Blank means "use the structured
 * hero", which is what every campaign that never opened the advanced panel
 * gets.
 */
export const resolveHeroHtml = (appearance: AudienceFormAppearance): string =>
  appearance.heroHtml.trim() ? sanitizePostSubmitHtml(appearance.heroHtml) : "";

/**
 * The hero body, as sanitized HTML. `subheadline` (admin-authored, plain text
 * is fine but rich text is allowed) wins over the campaign's own description;
 * `showDescription: false` suppresses both.
 *
 * Returns "" when there is nothing to render, so callers can skip the block
 * rather than emit an empty div that still takes up margin.
 */
export const resolveHeroBodyHtml = (
  appearance: AudienceFormAppearance,
  campaignDescription?: string | null
): string => {
  if (!appearance.showDescription) return "";
  const source = appearance.subheadline.trim() || (campaignDescription ?? "");
  if (!source.trim()) return "";
  return sanitizePostSubmitHtml(source);
};

// ─── Plain-or-rich text fields ───────────────────────────────────────────────

const HTML_TAG = /<[a-z][^>]*>/i;

/**
 * The words in a plain-or-rich value, with markup and entities flattened.
 * Plain text is only trimmed, so "Ages <5 & >3" survives as typed.
 */
const richTextToPlain = (value: string): string => {
  if (!HTML_TAG.test(value)) return value.trim();
  // Flatten the SANITIZED markup: a raw <script> or <style> body is text to a
  // tag-stripping regex, and would surface as words in the heading.
  return sanitizePostSubmitHtml(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Sanitized HTML for a plain-or-rich field, or "" when the value is plain text
 * (render it as text) or has no visible words — an emptied editor saves
 * `<p></p>`, and that must fall back to the default copy, not render nothing.
 */
export const resolveRichTextHtml = (value: string): string => {
  if (!HTML_TAG.test(value) || !richTextToPlain(value)) return "";
  return sanitizePostSubmitHtml(value);
};

/**
 * The page's h1 as plain text — the admin's override, else the campaign's own
 * name. A rich-text override comes back with its markup stripped; render
 * `resolveHeadlineHtml` instead when it is non-empty.
 */
export const resolveHeadline = (
  appearance: AudienceFormAppearance,
  campaignName?: string | null
): string =>
  richTextToPlain(appearance.headline) || (campaignName ?? "").trim();

/** The admin's rich-text headline, sanitized. "" for plain text or blank. */
export const resolveHeadlineHtml = (appearance: AudienceFormAppearance): string =>
  resolveRichTextHtml(appearance.headline);

/**
 * True when the structured hero would render at least one block. With the
 * heading, intro and objective all switched off and nothing else authored, the
 * hero is empty — and the classic layout would wrap that nothing in a card.
 */
export const hasStructuredHeroContent = (
  appearance: AudienceFormAppearance,
  campaign: {
    name?: string | null;
    description?: string | null;
    objective?: string | null;
  }
): boolean =>
  Boolean(appearance.coverImageUrl) ||
  appearance.eyebrow.trim().length > 0 ||
  (appearance.showHeadline &&
    (resolveHeadlineHtml(appearance) !== "" ||
      resolveHeadline(appearance, campaign.name) !== "")) ||
  resolveHeroBodyHtml(appearance, campaign.description) !== "" ||
  (appearance.showObjective && (campaign.objective ?? "").trim().length > 0) ||
  appearance.highlights.length > 0;


/**
 * The form card's sub-heading as plain text, "" when unset (the caller then
 * shows the translated default). Render `resolveFormSubtitleHtml` instead when
 * that is non-empty.
 */
export const resolveFormSubtitle = (appearance: AudienceFormAppearance): string =>
  richTextToPlain(appearance.formSubtitle);

/** The admin's rich-text sub-heading, sanitized. "" for plain text or blank. */
export const resolveFormSubtitleHtml = (
  appearance: AudienceFormAppearance
): string => resolveRichTextHtml(appearance.formSubtitle);
