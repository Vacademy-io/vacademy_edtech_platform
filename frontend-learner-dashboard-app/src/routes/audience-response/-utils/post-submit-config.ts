/**
 * Post-Submit Configuration — the respondent-facing half.
 *
 * The admin authors this in Audience Manager → Create/Edit campaign → "Post
 * Submit Configuration" (or once for the whole institute in Settings → Lead
 * Settings → Forms). It arrives here inside the campaign's `setting_json`,
 * served by the anonymous `open/v1/audience/campaign/{instituteId}/{audienceId}`
 * endpoint, and decides what a visitor sees the instant they submit: the
 * copy (plain or rich text), any number of action buttons, a "submit another
 * response" button, and an optional redirect.
 *
 * Every field falls back to the previous hardcoded copy, so campaigns saved
 * before the feature existed render exactly as they did before.
 *
 * Keep in sync with the admin app's
 * `src/services/audience-post-submit-settings.ts`.
 */
import DOMPurify from "dompurify";

export type PostSubmitButtonVariant = "primary" | "secondary";

/**
 * Artwork the thank-you screen leads with. `none` drops the bubble entirely —
 * for campaigns that supply their own `imageUrl` and want nothing under it.
 */
export type PostSubmitIcon =
  | "check"
  | "confetti"
  | "heart"
  | "envelope"
  | "calendar"
  | "none";

/** Color family for the icon bubble and the primary action button. */
export type PostSubmitAccent =
  | "success"
  | "primary"
  | "info"
  | "warning"
  | "neutral";

export interface PostSubmitButton {
  id: string;
  text: string;
  url: string;
  variant: PostSubmitButtonVariant;
}

export const MAX_POST_SUBMIT_BUTTONS = 4;

export interface AudiencePostSubmitConfiguration {
  /**
   * Master switch. OFF unless an admin deliberately turned it on, in which case
   * every surface renders exactly what it rendered before this feature existed
   * and no redirect fires.
   */
  enabled: boolean;
  /** Blank hides the heading. */
  successTitle: string;
  /** Illustration above the heading. Blank renders the icon bubble alone. */
  imageUrl: string;
  icon: PostSubmitIcon;
  accent: PostSubmitAccent;
  successMessage: string;
  /** Optional rich-text/HTML body. When non-blank it replaces `successMessage`. */
  content: string;
  buttons: PostSubmitButton[];
  allowAnotherResponse: boolean;
  /** Blank falls back to the default wording. */
  anotherResponseText: string;
  redirectUrl: string;
  redirectDelaySeconds: number;
}

export const DEFAULT_POST_SUBMIT_CONFIGURATION: AudiencePostSubmitConfiguration =
  {
    enabled: false,
    successTitle: "Registration Successful!",
    // These three reproduce the screen this page rendered before the artwork
    // was configurable: a green check bubble, no image.
    imageUrl: "",
    icon: "check",
    accent: "success",
    successMessage:
      "Thank you for your response. Your form has been submitted successfully.",
    content: "",
    buttons: [],
    allowAnotherResponse: false,
    anotherResponseText: "",
    redirectUrl: "",
    redirectDelaySeconds: 0,
  };

const POST_SUBMIT_CONFIG_KEY = "postSubmitConfiguration";

const toStr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const toBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const toDelay = (value: unknown, fallback: number): number => {
  const n =
    typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.round(n), 60);
};

const toEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/**
 * Normalize the button list, and migrate the original single-button shape
 * (`showCtaButton` / `ctaButtonText` / `ctaButtonUrl`) so an early-saved
 * campaign keeps its button.
 */
const toButtons = (
  raw: unknown,
  legacy: Record<string, unknown>
): PostSubmitButton[] => {
  if (Array.isArray(raw)) {
    return raw
      .slice(0, MAX_POST_SUBMIT_BUTTONS)
      .map((entry, index) => {
        const src = (entry ?? {}) as Partial<PostSubmitButton>;
        return {
          id: toStr(src.id, "") || `btn-${index}`,
          text: toStr(src.text, ""),
          url: toStr(src.url, ""),
          variant: toEnum<PostSubmitButtonVariant>(
            src.variant,
            ["primary", "secondary"],
            index === 0 ? "primary" : "secondary"
          ),
        };
      })
      // Stricter than the admin editor on purpose: there a half-filled row is
      // still being typed (and validation blocks the save), here it would be a
      // dead control on a public page.
      .filter((button) => button.text.trim() && button.url.trim());
  }

  if (legacy.showCtaButton === true) {
    const text = toStr(legacy.ctaButtonText, "");
    const url = toStr(legacy.ctaButtonUrl, "");
    return text.trim() && url.trim()
      ? [{ id: "btn-legacy", text, url, variant: "primary" }]
      : [];
  }

  return [];
};

/**
 * Read the config out of a campaign's `setting_json`. Never throws — a blob
 * that is missing, empty, malformed, or written by an older client resolves to
 * the defaults rather than breaking the public form.
 */
export const parsePostSubmitConfiguration = (
  settingJson?: string | null
): AudiencePostSubmitConfiguration => {
  let raw: unknown = undefined;
  if (settingJson && settingJson.trim()) {
    try {
      const parsed = JSON.parse(settingJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = (parsed as Record<string, unknown>)[POST_SUBMIT_CONFIG_KEY];
      }
    } catch {
      raw = undefined;
    }
  }
  const src = (raw ?? {}) as Partial<AudiencePostSubmitConfiguration> &
    Record<string, unknown>;
  const d = DEFAULT_POST_SUBMIT_CONFIGURATION;
  return {
    enabled: toBool(src.enabled, d.enabled),
    successTitle: toStr(src.successTitle, d.successTitle),
    // Guarded like a button URL: an image src is a live network reference on an
    // anonymous page, so `javascript:` / `data:` / `//evil.com` resolve to "no
    // image" rather than rendering.
    imageUrl: resolvePostSubmitUrl(toStr(src.imageUrl, ""), {}) ?? d.imageUrl,
    icon: toEnum<PostSubmitIcon>(
      src.icon,
      ["check", "confetti", "heart", "envelope", "calendar", "none"],
      d.icon
    ),
    accent: toEnum<PostSubmitAccent>(
      src.accent,
      ["success", "primary", "info", "warning", "neutral"],
      d.accent
    ),
    successMessage: toStr(src.successMessage, d.successMessage),
    content: toStr(src.content, d.content),
    buttons: toButtons(src.buttons, src),
    allowAnotherResponse: toBool(src.allowAnotherResponse, d.allowAnotherResponse),
    anotherResponseText: toStr(src.anotherResponseText, d.anotherResponseText),
    redirectUrl: toStr(src.redirectUrl, d.redirectUrl),
    redirectDelaySeconds: toDelay(src.redirectDelaySeconds, d.redirectDelaySeconds),
  };
};

/**
 * True when this campaign has nothing to render — either the master switch is
 * off (the default), or it is on but byte-for-byte the shipped defaults.
 * Renderers use this to keep exactly the thank-you block they showed before
 * this feature existed, rather than imposing default copy on pages that never
 * opted in.
 */
export const isDefaultPostSubmitConfiguration = (
  config: AudiencePostSubmitConfiguration
): boolean => {
  const d = DEFAULT_POST_SUBMIT_CONFIGURATION;
  if (!config.enabled) return true;
  return (
    config.successTitle === d.successTitle &&
    config.imageUrl === d.imageUrl &&
    config.icon === d.icon &&
    config.accent === d.accent &&
    config.successMessage === d.successMessage &&
    config.content === d.content &&
    config.buttons.length === 0 &&
    config.allowAnotherResponse === d.allowAnotherResponse &&
    config.anotherResponseText === d.anotherResponseText &&
    config.redirectUrl === d.redirectUrl &&
    config.redirectDelaySeconds === d.redirectDelaySeconds
  );
};

// ─── Tokens ──────────────────────────────────────────────────────────────────

export interface PostSubmitTokens {
  name?: string;
  email?: string;
  campaignName?: string;
}

const TOKEN_RE = /\{\{\s*(name|email|campaignName)\s*\}\}/g;

/**
 * Replace `{{name}}` / `{{email}}` / `{{campaignName}}` with what the visitor
 * just submitted. `encode` is for URLs, where the value lands in a query string.
 */
export const applyPostSubmitTokens = (
  text: string,
  tokens: PostSubmitTokens,
  options?: { encode?: boolean }
): string => {
  if (!text) return "";
  return text.replace(TOKEN_RE, (_match, key: keyof PostSubmitTokens) => {
    const value = tokens[key] ?? "";
    return options?.encode ? encodeURIComponent(value) : value;
  });
};

// ─── Safety ──────────────────────────────────────────────────────────────────

const MAX_HTML = 20000;

/**
 * Admin-authored HTML renders on an anonymous public page, so it is sanitized
 * at render time regardless of what the admin pasted or the editor produced:
 * structural/text tags only — no script, style, iframe, svg or form controls.
 *
 * The allow-list covers everything the admin's TipTap toolbar can emit
 * (headings, lists, links, images, blockquote, code, alignment via `style`).
 */
export const sanitizePostSubmitHtml = (html: string): string =>
  DOMPurify.sanitize(html.slice(0, MAX_HTML), {
    ALLOWED_TAGS: [
      "a", "b", "blockquote", "br", "code", "div", "em", "figcaption",
      "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li",
      "mark", "ol", "p", "pre", "s", "small", "span", "strong", "sub", "sup",
      "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
    ],
    ALLOWED_ATTR: [
      "class", "style", "title", "role", "aria-label", "aria-hidden",
      "href", "target", "rel", "src", "alt", "width", "height", "loading",
      "colspan", "rowspan", "scope", "start", "type",
    ],
    ALLOW_DATA_ATTR: false,
  });

/**
 * Resolve an admin-supplied destination to something safe to hand to
 * `window.location` / an anchor href. Returns null for blank or unsafe input
 * (`javascript:`, `data:`, protocol-relative `//evil.com`) — callers treat null
 * as "no destination configured" and simply stay on the thank-you screen.
 */
export const resolvePostSubmitUrl = (
  url: string,
  tokens: PostSubmitTokens
): string | null => {
  const raw = (url || "").trim();
  if (!raw) return null;
  const resolved = applyPostSubmitTokens(raw, tokens, { encode: true }).trim();
  if (!resolved) return null;
  if (resolved.startsWith("//")) return null;
  if (resolved.startsWith("/")) return resolved;
  return /^https?:\/\/\S+$/i.test(resolved) ? resolved : null;
};

/** External links open in a new tab; same-site paths navigate in place. */
export const isExternalPostSubmitUrl = (url: string): boolean =>
  /^https?:\/\//i.test(url);

/**
 * Buttons that survived URL validation, with tokens already applied. Anything
 * pointing somewhere unsafe is dropped rather than rendered as a dead control.
 */
export const resolvePostSubmitButtons = (
  config: AudiencePostSubmitConfiguration,
  tokens: PostSubmitTokens
): Array<{ id: string; text: string; href: string; variant: PostSubmitButtonVariant }> =>
  config.buttons
    .map((button) => {
      const href = resolvePostSubmitUrl(button.url, tokens);
      if (!href) return null;
      return {
        id: button.id,
        text: applyPostSubmitTokens(button.text, tokens) || "Continue",
        href,
        variant: button.variant,
      };
    })
    .filter(
      (button): button is {
        id: string;
        text: string;
        href: string;
        variant: PostSubmitButtonVariant;
      } => button !== null
    );
