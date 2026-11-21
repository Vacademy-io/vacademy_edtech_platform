/**
 * UTM link building — the one place that knows how a campaign URL is shaped.
 *
 * Every share surface (audience form, live session, assessment, enrol invite,
 * product page, catalogue site) hands out a URL that already carries its own
 * query string — `?instituteId=…&audienceId=…`, `?sessionId=…`, `?code=…`.
 * Naively appending `?utm_source=…` produces a URL with two `?` that silently
 * drops the institute id, so appending is done through URL/URLSearchParams
 * here rather than by string concatenation at six call sites.
 */

export const UTM_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];

export type UtmValues = Partial<Record<UtmKey, string>>;

/** Where a generated link points — recorded with the lead for reporting. */
export type UtmSourceType =
    /** Not a share surface — any other page (login, sign-up, a landing page). */
    | 'CUSTOM'
    | 'AUDIENCE'
    | 'LIVE_SESSION'
    | 'ASSESSMENT'
    | 'ENROLL_INVITE'
    | 'PRODUCT_PAGE'
    | 'CATALOGUE';

/**
 * Google's own tools reject spaces and uppercase in reports by silently
 * splitting them into separate rows ("Google Ads" ≠ "google ads" ≠
 * "google+ads"), which is how one campaign ends up as four lines in a report.
 * Normalising on the way out is the only reliable fix — an admin cannot be
 * expected to remember the convention on every link they ever build.
 */
export const normalizeUtmValue = (value: string): string =>
    normalizeUtmValueLive(value.trim())
        // Strip edge hyphens too. A leading or trailing SPACE becomes a hyphen
        // in the live pass, and trimming whitespace afterwards cannot remove
        // it — so "  Diwali Sale  " typed into the box would finalise as
        // "-diwali-sale-", a different report row from the pasted "diwali-sale".
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);

/**
 * Keystroke-safe normalisation: everything {@link normalizeUtmValue} does
 * EXCEPT trimming.
 *
 * The trim is what makes the full version unusable while someone is typing.
 * "Black Friday" is entered a character at a time, and the moment the space is
 * typed the value is still "black " — a trailing space, which trim() deletes.
 * The next character then lands flush against the previous word and the user
 * silently gets "blackfriday" instead of "black-friday", with no way to type
 * the hyphen themselves (the charset filter would have to allow it, and they
 * would have to know to). Keeping the space here lets it become a hyphen on the
 * next keystroke; the trim happens once, when the value is finalised.
 */
export const normalizeUtmValueLive = (value: string): string =>
    value
        .toLowerCase()
        .replace(/\s+/g, '-')
        // Keep the characters GA treats as safe; drop the rest rather than
        // percent-encoding them into unreadable report rows.
        .replace(/[^a-z0-9._\-+/]/g, '')
        .slice(0, 120);

/** Strip empties so a blank field never emits `utm_term=`. */
export const cleanUtmValues = (values: UtmValues): UtmValues => {
    const out: UtmValues = {};
    for (const key of UTM_KEYS) {
        const raw = values[key];
        if (typeof raw === 'string' && raw.trim() !== '') out[key] = raw.trim();
    }
    return out;
};

/**
 * Append (or replace) UTM parameters on an existing shareable URL.
 *
 * Returns '' for an unusable base rather than a half-built string — callers
 * disable their copy button on the empty value.
 */
export const buildUtmUrl = (baseUrl: string, values: UtmValues): string => {
    const base = (baseUrl || '').trim();
    if (!base) return '';

    const cleaned = cleanUtmValues(values);

    try {
        // A relative or scheme-less base would throw; every share surface hands
        // us an absolute learner-portal URL, but be defensive rather than crash
        // a dropdown.
        const url = new URL(base);
        for (const key of UTM_KEYS) {
            const value = cleaned[key];
            if (value) url.searchParams.set(key, value);
            else url.searchParams.delete(key);
        }
        return url.toString();
    } catch {
        const params = new URLSearchParams();
        for (const key of UTM_KEYS) {
            const value = cleaned[key];
            if (value) params.set(key, value);
        }
        const qs = params.toString();
        if (!qs) return base;
        return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
    }
};

/** Read whatever UTM values a URL already carries, for pre-filling the builder. */
export const readUtmFromUrl = (url: string): UtmValues => {
    try {
        const parsed = new URL(url);
        const out: UtmValues = {};
        for (const key of UTM_KEYS) {
            const value = parsed.searchParams.get(key);
            if (value) out[key] = value;
        }
        return out;
    } catch {
        return {};
    }
};

/** The base URL with any pre-existing UTM parameters removed. */
export const stripUtmFromUrl = (url: string): string => {
    try {
        const parsed = new URL(url);
        for (const key of UTM_KEYS) parsed.searchParams.delete(key);
        return parsed.toString();
    } catch {
        return url;
    }
};

/* ── Recently used values ───────────────────────────────────────────────────
 * Campaign attribution is only worth anything when the SAME string is used
 * across every link in a campaign. Typing "diwali-2026" by hand on six
 * surfaces produces "diwali2026", "Diwali-2026" and "diwali-26" — three rows
 * in a report that should have been one. These suggestions are per-browser
 * convenience on top of the institute-wide pick lists in Settings. */

const RECENT_KEY = 'vacademy_utm_recent';
const RECENT_LIMIT = 8;

type RecentStore = Partial<Record<UtmKey, string[]>>;

const readRecentStore = (): RecentStore => {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        return raw ? (JSON.parse(raw) as RecentStore) : {};
    } catch {
        return {};
    }
};

export const getRecentUtmValues = (key: UtmKey): string[] => readRecentStore()[key] ?? [];

export const rememberUtmValues = (values: UtmValues): void => {
    try {
        const store = readRecentStore();
        for (const key of UTM_KEYS) {
            const value = values[key];
            if (!value) continue;
            const existing = store[key] ?? [];
            store[key] = [value, ...existing.filter((v) => v !== value)].slice(0, RECENT_LIMIT);
        }
        localStorage.setItem(RECENT_KEY, JSON.stringify(store));
    } catch {
        /* private mode — suggestions are a convenience, never a requirement */
    }
};

/**
 * Suggested defaults per source type, used only to seed `utm_medium` when the
 * institute has set no default of its own. Deliberately conventional values —
 * these are the strings GA4's default channel grouping already understands.
 */
export const SUGGESTED_SOURCES = [
    'whatsapp',
    'facebook',
    'instagram',
    'google',
    'youtube',
    'linkedin',
    'telegram',
    'email',
    'sms',
    'newsletter',
    'referral',
] as const;

export const SUGGESTED_MEDIUMS = [
    'social',
    'cpc',
    'organic',
    'email',
    'sms',
    'whatsapp',
    'referral',
    'affiliate',
    'display',
    'qr',
] as const;
