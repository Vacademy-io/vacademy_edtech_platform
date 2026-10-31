/**
 * Post-Submit Configuration for Audience campaigns.
 *
 * This is the audience-list twin of the enroll invite's
 * `postformfillConfiguration` block (see GenerateInviteLinkSchema.ts /
 * PostFormFillConfigurationCard.tsx). Same idea, different surface: it decides
 * what a respondent sees the moment an audience form is submitted — the
 * thank-you screen's artwork, copy, action buttons, and an optional redirect.
 *
 * Two storage locations, one shape:
 *
 *   • Per campaign  → `audience.setting_json` → `postSubmitConfiguration`.
 *     The backend already round-trips `setting_json` on create (Audience(dto)),
 *     update (AudienceService.updateCampaign) and both the admin and the public
 *     `open/v1/audience/campaign/{instituteId}/{audienceId}` GET, so no backend
 *     change is needed to carry it.
 *
 *   • Institute default → institute setting `AUDIENCE_FORM_SETTING` →
 *     `postSubmitConfiguration`. Configured once in Settings → Lead Settings →
 *     Forms and prefilled into every NEW campaign, so admins don't retype the
 *     same thank-you text for each list. Editing the default never rewrites
 *     campaigns that were already saved.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

// ─── Shape ───────────────────────────────────────────────────────────────────

export type PostSubmitButtonVariant = 'primary' | 'secondary';

export interface PostSubmitButton {
    /** Stable key for React lists and reordering. Not sent anywhere else. */
    id: string;
    text: string;
    url: string;
    variant: PostSubmitButtonVariant;
}

/** More than a handful of buttons is a menu, not a thank-you screen. */
export const MAX_POST_SUBMIT_BUTTONS = 4;

export interface AudiencePostSubmitConfiguration {
    /**
     * Master switch. OFF by default: until an admin deliberately turns this on,
     * every respondent-facing surface renders exactly what it rendered before
     * this feature existed, and no redirect ever fires.
     */
    enabled: boolean;

    // ── Copy ──
    /** Heading on the thank-you screen. Blank hides it. */
    successTitle: string;
    /** Plain-text body under the heading. Ignored when `content` is set. */
    successMessage: string;
    /** Optional rich-text/HTML body. When non-blank it replaces `successMessage`. */
    content: string;

    // ── Actions ──
    buttons: PostSubmitButton[];
    /** Offer a button that resets the form for another submission. */
    allowAnotherResponse: boolean;
    /** Label for that button. Blank falls back to the default wording. */
    anotherResponseText: string;

    // ── Redirect ──
    /** When set, the respondent is sent here instead of staying on the screen. */
    redirectUrl: string;
    /** Seconds to show the thank-you screen before redirecting. 0 = instant. */
    redirectDelaySeconds: number;
}

export const DEFAULT_POST_SUBMIT_CONFIGURATION: AudiencePostSubmitConfiguration = {
    enabled: false,
    successTitle: 'Registration Successful!',
    successMessage: 'Thank you for your response. Your form has been submitted successfully.',
    content: '',
    buttons: [],
    allowAnotherResponse: false,
    anotherResponseText: '',
    redirectUrl: '',
    redirectDelaySeconds: 0,
};

/** Key inside `setting_json` / the institute setting blob. */
export const POST_SUBMIT_CONFIG_KEY = 'postSubmitConfiguration';

/** Institute setting key holding audience-form-wide defaults. */
export const AUDIENCE_FORM_SETTING_KEY = 'AUDIENCE_FORM_SETTING';

/** Key inside that setting for the Form Appearance feature switch. */
export const FORM_APPEARANCE_ENABLED_KEY = 'formAppearanceEnabled';

/** Key inside that setting for the short-link feature switch. */
export const SHORT_LINKS_ENABLED_KEY = 'shortLinksEnabled';

/**
 * Everything the `AUDIENCE_FORM_SETTING` institute setting holds.
 *
 * Modelled as one object because the save is a single POST that REPLACES
 * `setting_data`: writing the post-submit defaults on their own would silently
 * wipe the appearance switch, and vice versa. Read and written together.
 */
export interface AudienceFormSettings {
    /** Thank-you screen prefilled into every NEW campaign. */
    postSubmit: AudiencePostSubmitConfiguration;
    /**
     * Whether campaigns may restyle their public form at all.
     *
     * OFF by default: Form Appearance is an advanced surface, and the campaign
     * create/edit dialog must look the way it always did for the institutes
     * that never asked for it. Turning this on in Settings → Lead Settings →
     * Forms is what reveals the editor.
     */
    formAppearanceEnabled: boolean;
    /**
     * Whether campaign share surfaces offer a short URL (u.<domain>/s/<code>)
     * next to the full form link.
     *
     * **ON by default** — the opposite of `formAppearanceEnabled` above, and
     * deliberately so. A short link is a convenience on a link the admin was
     * already going to share, not a new respondent-facing surface, so it is
     * useful to everyone from the moment it ships. Institutes that would rather
     * hand out only their own domain can switch it off in Settings → Lead
     * Settings → Forms.
     *
     * Because the default is ON, absence must read as ON: every institute
     * already has an `AUDIENCE_FORM_SETTING` row without this key, and treating
     * a missing key as OFF would ship the feature switched off for all of them.
     * See the `!== false` read in fetchAudienceFormSettings.
     */
    shortLinksEnabled: boolean;
}

export const DEFAULT_AUDIENCE_FORM_SETTINGS: AudienceFormSettings = {
    postSubmit: DEFAULT_POST_SUBMIT_CONFIGURATION,
    formAppearanceEnabled: false,
    shortLinksEnabled: true,
};

// ─── Parse / serialize ───────────────────────────────────────────────────────

const toStr = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value : fallback;

const toBool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

const toDelay = (value: unknown, fallback: number): number => {
    const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n < 0) return fallback;
    // A delay longer than a minute reads as "broken page" to a respondent.
    return Math.min(Math.round(n), 60);
};

const toEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : fallback;

export const createPostSubmitButton = (index = 0): PostSubmitButton => ({
    // Date.now() would collide when two buttons are added in the same tick.
    id: `btn-${index}-${Math.random().toString(36).slice(2, 8)}`,
    text: '',
    url: '',
    variant: index === 0 ? 'primary' : 'secondary',
});

/**
 * Normalize the button list, and migrate the original single-button shape
 * (`showCtaButton` / `ctaButtonText` / `ctaButtonUrl`) that the first cut of
 * this feature wrote, so an early-saved campaign keeps its button.
 */
const toButtons = (raw: unknown, legacy: Record<string, unknown>): PostSubmitButton[] => {
    if (Array.isArray(raw)) {
        return raw
            .slice(0, MAX_POST_SUBMIT_BUTTONS)
            .map((entry, index) => {
                const src = (entry ?? {}) as Partial<PostSubmitButton>;
                return {
                    id: toStr(src.id, '') || createPostSubmitButton(index).id,
                    text: toStr(src.text, ''),
                    url: toStr(src.url, ''),
                    variant: toEnum<PostSubmitButtonVariant>(
                        src.variant,
                        ['primary', 'secondary'],
                        index === 0 ? 'primary' : 'secondary'
                    ),
                };
            })
            .filter((button) => button.text.trim() || button.url.trim());
    }

    if (legacy.showCtaButton === true) {
        return [
            {
                ...createPostSubmitButton(0),
                text: toStr(legacy.ctaButtonText, ''),
                url: toStr(legacy.ctaButtonUrl, ''),
            },
        ];
    }

    return [];
};

/**
 * Coerce an arbitrary blob into a complete config. Every field falls back to
 * its default, so a partially-written or hand-edited `setting_json` can never
 * blank out the thank-you screen.
 */
export const normalizePostSubmitConfiguration = (
    raw: unknown,
    base: AudiencePostSubmitConfiguration = DEFAULT_POST_SUBMIT_CONFIGURATION
): AudiencePostSubmitConfiguration => {
    const src = (raw ?? {}) as Partial<AudiencePostSubmitConfiguration> & Record<string, unknown>;
    return {
        enabled: toBool(src.enabled, base.enabled),
        successTitle: toStr(src.successTitle, base.successTitle),
        successMessage: toStr(src.successMessage, base.successMessage),
        content: toStr(src.content, base.content),
        buttons: toButtons(src.buttons, src),
        allowAnotherResponse: toBool(src.allowAnotherResponse, base.allowAnotherResponse),
        anotherResponseText: toStr(src.anotherResponseText, base.anotherResponseText),
        redirectUrl: toStr(src.redirectUrl, base.redirectUrl),
        redirectDelaySeconds: toDelay(src.redirectDelaySeconds, base.redirectDelaySeconds),
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

/** Read the config out of a campaign's `setting_json`. */
export const parsePostSubmitConfiguration = (
    settingJson?: string | null,
    base: AudiencePostSubmitConfiguration = DEFAULT_POST_SUBMIT_CONFIGURATION
): AudiencePostSubmitConfiguration =>
    normalizePostSubmitConfiguration(safeParseJson(settingJson)[POST_SUBMIT_CONFIG_KEY], base);

/**
 * Merge the config back into a campaign's `setting_json`, preserving whatever
 * else already lives in that blob (the same spread-then-overwrite pattern the
 * invite helper uses for `setting_json`).
 */
export const applyPostSubmitConfiguration = (
    existingSettingJson: string | null | undefined,
    config: AudiencePostSubmitConfiguration
): string =>
    JSON.stringify({
        ...safeParseJson(existingSettingJson),
        [POST_SUBMIT_CONFIG_KEY]: normalizePostSubmitConfiguration(config),
    });

// ─── Institute-level defaults ────────────────────────────────────────────────

const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

interface AudienceFormSettingData {
    postSubmitConfiguration?: Partial<AudiencePostSubmitConfiguration>;
    formAppearanceEnabled?: boolean;
    shortLinksEnabled?: boolean;
}

/**
 * Institute-wide settings for audience forms. Resolves to the hardcoded
 * defaults when the institute has never saved the setting.
 */
export const fetchAudienceFormSettings = async (): Promise<AudienceFormSettings> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return DEFAULT_AUDIENCE_FORM_SETTINGS;
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: GET_INSITITUTE_SETTINGS,
            params: { instituteId, settingKey: AUDIENCE_FORM_SETTING_KEY },
        });
        // GET returns the SettingDto itself ({key, name, data}) — the payload we
        // saved is one level down at response.data.data (same as LeadSettings).
        const saved = response.data?.data as AudienceFormSettingData | undefined;
        return {
            postSubmit: normalizePostSubmitConfiguration(saved?.[POST_SUBMIT_CONFIG_KEY]),
            formAppearanceEnabled: saved?.[FORM_APPEARANCE_ENABLED_KEY] === true,
            // `!== false`, not `=== true`: this switch defaults ON, and every
            // institute that saved this setting before short links existed has
            // no such key. Only an explicit `false` turns it off.
            shortLinksEnabled: saved?.[SHORT_LINKS_ENABLED_KEY] !== false,
        };
    } catch {
        // No setting row yet (or a transient failure) — defaults are the right
        // answer either way; the create form must never block on this.
        return DEFAULT_AUDIENCE_FORM_SETTINGS;
    }
};

export const saveAudienceFormSettings = async (settings: AudienceFormSettings): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        {
            setting_name: 'Audience Form Settings',
            setting_data: {
                [POST_SUBMIT_CONFIG_KEY]: normalizePostSubmitConfiguration(settings.postSubmit),
                [FORM_APPEARANCE_ENABLED_KEY]: settings.formAppearanceEnabled,
                // Must be written here too: this POST REPLACES setting_data, so
                // omitting the key would wipe an institute's opt-out the next
                // time anything else on this page is saved.
                [SHORT_LINKS_ENABLED_KEY]: settings.shortLinksEnabled,
            } satisfies AudienceFormSettingData,
        },
        { params: { instituteId, settingKey: AUDIENCE_FORM_SETTING_KEY } }
    );
};

// ─── Validation (shared by the campaign form and the settings page) ──────────

/**
 * A destination is safe if it is a same-origin path or an absolute http(s) URL.
 * Anything else (`javascript:`, `data:`) is rejected outright — this string is
 * handed to `window.location` on a public page.
 */
export const isValidPostSubmitUrl = (url: string): boolean => {
    const trimmed = url.trim();
    if (!trimmed) return true; // empty = feature off
    if (trimmed.startsWith('/')) return !trimmed.startsWith('//');
    return /^https?:\/\/\S+$/i.test(trimmed);
};

/**
 * True when nothing has been authored — the config is byte-for-byte the
 * shipped default. Renderers use this to keep whatever they showed before this
 * feature existed, instead of imposing default copy on pages that never opted
 * in. Compared field-by-field rather than by JSON string, so key order can't
 * make an untouched config look customised.
 */
export const isDefaultPostSubmitConfiguration = (
    config: AudiencePostSubmitConfiguration
): boolean => {
    const d = DEFAULT_POST_SUBMIT_CONFIGURATION;
    if (!config.enabled) return true;
    return (
        config.successTitle === d.successTitle &&
        config.successMessage === d.successMessage &&
        config.content === d.content &&
        config.buttons.length === 0 &&
        config.allowAnotherResponse === d.allowAnotherResponse &&
        config.anotherResponseText === d.anotherResponseText &&
        config.redirectUrl === d.redirectUrl &&
        config.redirectDelaySeconds === d.redirectDelaySeconds
    );
};

/** Returns a user-facing error, or null when the config is savable. */
export const validatePostSubmitConfiguration = (
    config: AudiencePostSubmitConfiguration
): string | null => {
    // Switched off means nothing here reaches a respondent, so half-finished
    // content must never stand between the admin and saving the campaign.
    if (!config.enabled) return null;
    if (!isValidPostSubmitUrl(config.redirectUrl)) {
        return 'Redirect URL must be a relative path (/thank-you) or an http(s) URL.';
    }
    for (const [index, button] of config.buttons.entries()) {
        // A row the admin added and then left completely blank is a change of
        // mind, not an error — `normalizePostSubmitConfiguration` drops it on
        // the way out. Only half-filled rows are worth blocking the save for.
        if (!button.text.trim() && !button.url.trim()) continue;
        const position = config.buttons.length > 1 ? ` ${index + 1}` : '';
        if (!button.text.trim()) return `Button${position} needs text.`;
        if (!button.url.trim()) return `Button${position} needs a link.`;
        if (!isValidPostSubmitUrl(button.url)) {
            return `Button${position} link must be a relative path (/courses) or an http(s) URL.`;
        }
    }
    return null;
};
