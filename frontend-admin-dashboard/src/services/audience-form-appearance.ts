/**
 * Form Appearance for Audience campaigns.
 *
 * The sibling of `audience-post-submit-settings.ts`: that one owns what a
 * respondent sees AFTER submitting, this one owns how the public form itself
 * LOOKS while they are filling it in — layout, width, background, accent, card
 * treatment, cover art, the hero and form-header copy, trust highlights and a
 * footer note.
 *
 * Storage: per campaign → `audience.setting_json` → `formAppearance`, the same
 * blob that already carries `postSubmitConfiguration`. The backend round-trips
 * `setting_json` on create, update and both the admin and the public
 * `open/v1/audience/campaign/{instituteId}/{audienceId}` GET, so no backend
 * change is needed to carry it.
 *
 * **Keep this file in sync with the learner app's
 * `src/routes/audience-response/-utils/form-appearance.ts`** — that is the
 * renderer, and it re-validates everything here. The two default objects must
 * stay byte-identical, or a campaign the admin never touched would render
 * differently from what this editor shows.
 *
 * Unlike the post-submit config there is deliberately **no master switch**: the
 * defaults ARE the design, and this block only describes deviations from it.
 */
import { isValidPostSubmitUrl } from '@/services/audience-post-submit-settings';

// ─── Shape ───────────────────────────────────────────────────────────────────

/**
 * A whole-page look picked from the template gallery. `standard` is the page
 * driven by the individual knobs below; every other template owns the layout,
 * background, card and width, while the text, fields and button colour still
 * come from the rest of this blob.
 */
export type AudienceFormTemplate =
    | 'standard'
    | 'banner'
    | 'split'
    | 'framed'
    | 'minimal'
    | 'gradient'
    | 'dark'
    | 'logo';
export type AudienceFormLayout = 'classic' | 'hero' | 'split';
export type AudienceFormWidth = 'narrow' | 'regular' | 'wide';
export type AudienceFormBackground = 'gradient' | 'plain' | 'muted';
export type AudienceFormAccent = 'primary' | 'success' | 'info' | 'warning' | 'neutral';
export type AudienceFormCardStyle = 'glass' | 'elevated' | 'outlined' | 'flat';
export type AudienceFormHighlightIcon = 'sparkle' | 'shield' | 'clock' | 'check' | 'users' | 'chat';
export type AudienceFormTextAlign = 'left' | 'center' | 'right';

export interface AudienceFormHighlight {
    /** Stable key for React lists. Also persisted, so reorders stay stable. */
    id: string;
    icon: AudienceFormHighlightIcon;
    text: string;
}

/** More than four reassurance chips is a feature list, not a form header. */
export const MAX_FORM_HIGHLIGHTS = 4;

/** Longest single string the renderer will draw, per field. */
const MAX_TEXT = 500;

/**
 * Cap for the fields that may hold rich text (`headline`, `formSubtitle`).
 * Markup is far longer than the words it wraps, and slicing it at MAX_TEXT
 * would cut a tag in half. Same value as the learner renderer.
 */
const MAX_RICH_TEXT = 5000;

export interface AudienceFormAppearance {
    // ── Shape ──
    template: AudienceFormTemplate;
    layout: AudienceFormLayout;
    width: AudienceFormWidth;
    background: AudienceFormBackground;
    accent: AudienceFormAccent;
    cardStyle: AudienceFormCardStyle;

    // ── Hero ──
    /** Banner image above the hero copy. Blank hides it. */
    coverImageUrl: string;
    /** Small label above the headline (e.g. "Admissions 2026"). Blank hides it. */
    eyebrow: string;
    /**
     * Overrides the campaign name as the page's h1. Plain text or rich text
     * from the editor. Blank keeps the name.
     */
    headline: string;
    /** Alignment of the heading block: eyebrow, headline, intro, highlights. */
    headingAlign: AudienceFormTextAlign;
    /** The institute logo + name bar at the top, on the form and the thank-you screen. */
    showHeader: boolean;
    /** The page heading — the `headline` override or the campaign name. */
    showHeadline: boolean;
    /** Overrides the campaign description. Blank keeps the description. */
    subheadline: string;
    showDescription: boolean;
    showObjective: boolean;

    // ── Form card ──
    /** Overrides "Please fill in your details". */
    formTitle: string;
    /** Overrides "This information will be used to contact you…". Plain or rich text. */
    formSubtitle: string;
    /** Alignment of the form card's heading + sub-heading. */
    formHeaderAlign: AudienceFormTextAlign;
    /** Overrides "Submit Response". */
    submitLabel: string;
    /** "* Required field" line under the form header. Off by default. */
    showRequiredLegend: boolean;
    /** "3 of 5 required fields completed" meter. Off by default. */
    showProgress: boolean;

    // ── Extras ──
    highlights: AudienceFormHighlight[];
    /** Small print under the form card (privacy note, contact line, …). */
    footerNote: string;

    // ── Escape hatch ──
    /**
     * HTML that REPLACES the whole structured hero — cover, eyebrow, heading,
     * intro, objective and highlights. For campaigns that want a hand-built
     * pitch the fields above cannot express. The form card is never
     * replaceable: it is generated from the campaign's own custom fields.
     */
    heroHtml: string;
    /**
     * CSS applied to the response page only. With `heroHtml` this is the
     * "style the whole page yourself" hatch. Target the `vac-af-*` hook classes
     * the page puts on its landmarks — see AUDIENCE_FORM_HOOK_CLASSES.
     */
    customCss: string;
}

export const DEFAULT_FORM_APPEARANCE: AudienceFormAppearance = {
    template: 'standard',
    layout: 'hero',
    width: 'regular',
    // Neutral surface + white card + one brand-coloured action. Must match the
    // learner util's default exactly.
    background: 'muted',
    accent: 'primary',
    cardStyle: 'elevated',
    coverImageUrl: '',
    eyebrow: '',
    headline: '',
    headingAlign: 'left',
    showHeader: true,
    showHeadline: true,
    subheadline: '',
    showDescription: true,
    showObjective: true,
    formTitle: '',
    formSubtitle: '',
    formHeaderAlign: 'left',
    submitLabel: '',
    showRequiredLegend: false,
    showProgress: false,
    highlights: [],
    footerNote: '',
    heroHtml: '',
    customCss: '',
};

/**
 * The class names the learner page puts on its own landmarks, for admins
 * writing custom CSS. Kept in sync with AUDIENCE_FORM_HOOKS in the learner
 * app's form-appearance.ts; shown as a cheat sheet in the editor.
 */
export const AUDIENCE_FORM_HOOK_CLASSES: ReadonlyArray<{ name: string; what: string }> = [
    { name: 'vac-af-page', what: 'the whole page' },
    { name: 'vac-af-header', what: 'the branding bar' },
    { name: 'vac-af-hero', what: 'the heading block' },
    { name: 'vac-af-card', what: 'the form card' },
    { name: 'vac-af-card-header', what: 'the form heading + sub-heading' },
    { name: 'vac-af-fields', what: 'the list of fields' },
    { name: 'vac-af-submit', what: 'the submit button' },
    { name: 'vac-af-footer', what: 'the footer note' },
    { name: 'vac-af-success', what: 'the thank-you screen' },
];

/** Key inside `setting_json`. */
export const FORM_APPEARANCE_KEY = 'formAppearance';

// ─── Option lists (also drive the editor's dropdowns) ────────────────────────

export const FORM_TEMPLATES: readonly AudienceFormTemplate[] = [
    'standard',
    'banner',
    'split',
    'framed',
    'minimal',
    'gradient',
    'dark',
    'logo',
];
export const FORM_LAYOUTS: readonly AudienceFormLayout[] = ['classic', 'hero', 'split'];
export const FORM_WIDTHS: readonly AudienceFormWidth[] = ['narrow', 'regular', 'wide'];
// Ordered by how often they are the right answer, since this drives the editor's
// dropdown: neutral first, the branded wash last.
export const FORM_BACKGROUNDS: readonly AudienceFormBackground[] = ['muted', 'plain', 'gradient'];
export const FORM_ACCENTS: readonly AudienceFormAccent[] = [
    'primary',
    'success',
    'info',
    'warning',
    'neutral',
];
export const FORM_CARD_STYLES: readonly AudienceFormCardStyle[] = [
    'glass',
    'elevated',
    'outlined',
    'flat',
];
export const FORM_TEXT_ALIGNS: readonly AudienceFormTextAlign[] = ['left', 'center', 'right'];
export const FORM_HIGHLIGHT_ICONS: readonly AudienceFormHighlightIcon[] = [
    'sparkle',
    'shield',
    'clock',
    'check',
    'users',
    'chat',
];

// ─── Parse / serialize ───────────────────────────────────────────────────────

const toStr = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value.slice(0, MAX_TEXT) : fallback;

const toRichText = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value.slice(0, MAX_RICH_TEXT) : fallback;

const toBool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

const toEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : fallback;

export const createFormHighlight = (index = 0): AudienceFormHighlight => ({
    // Date.now() would collide when two rows are added in the same tick.
    id: `hl-${index}-${Math.random().toString(36).slice(2, 8)}`,
    icon: 'check',
    text: '',
});

const toHighlights = (raw: unknown): AudienceFormHighlight[] => {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_FORM_HIGHLIGHTS).map((entry, index) => {
        const src = (entry ?? {}) as Partial<AudienceFormHighlight>;
        return {
            id: toStr(src.id, '') || createFormHighlight(index).id,
            icon: toEnum<AudienceFormHighlightIcon>(src.icon, FORM_HIGHLIGHT_ICONS, 'check'),
            text: toStr(src.text, ''),
        };
    });
};

/**
 * Coerce an arbitrary blob into a complete appearance. Every field falls back
 * to its default, so a partially-written or hand-edited `setting_json` can
 * never leave the editor half-populated.
 *
 * Note this keeps text-less highlight rows, unlike the learner renderer which
 * drops them — here a blank row is one the admin is still typing into.
 */
export const normalizeFormAppearance = (
    raw: unknown,
    base: AudienceFormAppearance = DEFAULT_FORM_APPEARANCE
): AudienceFormAppearance => {
    const src = (raw ?? {}) as Partial<AudienceFormAppearance> & Record<string, unknown>;
    return {
        template: toEnum(src.template, FORM_TEMPLATES, base.template),
        layout: toEnum(src.layout, FORM_LAYOUTS, base.layout),
        width: toEnum(src.width, FORM_WIDTHS, base.width),
        background: toEnum(src.background, FORM_BACKGROUNDS, base.background),
        accent: toEnum(src.accent, FORM_ACCENTS, base.accent),
        cardStyle: toEnum(src.cardStyle, FORM_CARD_STYLES, base.cardStyle),
        coverImageUrl: toStr(src.coverImageUrl, base.coverImageUrl),
        eyebrow: toStr(src.eyebrow, base.eyebrow),
        headline: toRichText(src.headline, base.headline),
        headingAlign: toEnum(src.headingAlign, FORM_TEXT_ALIGNS, base.headingAlign),
        showHeader: toBool(src.showHeader, base.showHeader),
        showHeadline: toBool(src.showHeadline, base.showHeadline),
        subheadline: toStr(src.subheadline, base.subheadline),
        showDescription: toBool(src.showDescription, base.showDescription),
        showObjective: toBool(src.showObjective, base.showObjective),
        formTitle: toStr(src.formTitle, base.formTitle),
        formSubtitle: toRichText(src.formSubtitle, base.formSubtitle),
        formHeaderAlign: toEnum(src.formHeaderAlign, FORM_TEXT_ALIGNS, base.formHeaderAlign),
        submitLabel: toStr(src.submitLabel, base.submitLabel),
        showRequiredLegend: toBool(src.showRequiredLegend, base.showRequiredLegend),
        showProgress: toBool(src.showProgress, base.showProgress),
        highlights: toHighlights(src.highlights),
        footerNote: toStr(src.footerNote, base.footerNote),
        // Markup, not a label — capped where it is rendered, not at MAX_TEXT.
        heroHtml: typeof src.heroHtml === 'string' ? src.heroHtml : base.heroHtml,
        customCss: typeof src.customCss === 'string' ? src.customCss : base.customCss,
    };
};

const safeParseJson = (value?: string | null): Record<string, unknown> => {
    if (!value || !value.trim()) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        // A campaign saved before this feature (or by an older client) can hold
        // anything here — never let a bad blob break the edit form.
        return {};
    }
};

/** Read the appearance out of a campaign's `setting_json`. */
export const parseFormAppearance = (
    settingJson?: string | null,
    base: AudienceFormAppearance = DEFAULT_FORM_APPEARANCE
): AudienceFormAppearance =>
    normalizeFormAppearance(safeParseJson(settingJson)[FORM_APPEARANCE_KEY], base);

/**
 * Merge the appearance back into a campaign's `setting_json`, preserving
 * whatever else lives in that blob — `postSubmitConfiguration` above all, which
 * is written by the same save. Safe to chain with
 * `applyPostSubmitConfiguration` in either order.
 *
 * Blank highlight rows are dropped here rather than in the editor, so an admin
 * can add a row, tab away and come back to it without it vanishing mid-edit.
 */
export const applyFormAppearance = (
    existingSettingJson: string | null | undefined,
    config: AudienceFormAppearance
): string => {
    const normalized = normalizeFormAppearance(config);
    return JSON.stringify({
        ...safeParseJson(existingSettingJson),
        [FORM_APPEARANCE_KEY]: {
            ...normalized,
            highlights: normalized.highlights.filter((highlight) => highlight.text.trim()),
        },
    });
};

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * True when nothing has been authored — the appearance is byte-for-byte the
 * shipped default. Compared field-by-field rather than by JSON string, so key
 * order can't make an untouched config look customised.
 */
export const isDefaultFormAppearance = (config: AudienceFormAppearance): boolean => {
    const d = DEFAULT_FORM_APPEARANCE;
    return (
        config.template === d.template &&
        config.layout === d.layout &&
        config.width === d.width &&
        config.background === d.background &&
        config.accent === d.accent &&
        config.cardStyle === d.cardStyle &&
        config.coverImageUrl === d.coverImageUrl &&
        config.eyebrow === d.eyebrow &&
        config.headline === d.headline &&
        config.headingAlign === d.headingAlign &&
        config.showHeader === d.showHeader &&
        config.showHeadline === d.showHeadline &&
        config.subheadline === d.subheadline &&
        config.showDescription === d.showDescription &&
        config.showObjective === d.showObjective &&
        config.formTitle === d.formTitle &&
        config.formSubtitle === d.formSubtitle &&
        config.formHeaderAlign === d.formHeaderAlign &&
        config.submitLabel === d.submitLabel &&
        config.showRequiredLegend === d.showRequiredLegend &&
        config.showProgress === d.showProgress &&
        config.highlights.filter((highlight) => highlight.text.trim()).length === 0 &&
        config.footerNote === d.footerNote &&
        config.heroHtml.trim() === '' &&
        config.customCss.trim() === ''
    );
};

/**
 * Returns a user-facing error, or null when the appearance is savable.
 *
 * Only the cover image can actually fail: it is the one field handed to the
 * browser as a live URL. Everything else is copy or a closed enum, and
 * `normalizeFormAppearance` already coerces those — blocking a save over them
 * would be a dead button with nothing on screen to explain it.
 */
export const validateFormAppearance = (config: AudienceFormAppearance): string | null => {
    if (config.coverImageUrl.trim() && !isValidPostSubmitUrl(config.coverImageUrl)) {
        return 'Cover image must be a relative path (/banner.png) or an http(s) URL.';
    }
    return null;
};
