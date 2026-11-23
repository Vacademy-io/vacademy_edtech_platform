/**
 * LinkTarget (spec 3.1, 6): the one link model every block uses.
 *
 * The picker edits a flat `LinkDraft` (kind + one value + the payment flag) and
 * serialises it with `toLinkTarget`. Only a COMPLETE, valid link is ever
 * stored: an incomplete one is stored as `null`, so a draft save never carries
 * a half-filled link and the publish checks report "link missing" instead.
 */
import {
    FEATURE_KEYS,
    type FeatureKey,
    type LinkKind,
    type LinkTarget,
} from '../-types/learner-home-types';

/** Kinds the picker offers. APP_PATH only arrives from imported cards (spec 11). */
export const PICKER_LINK_KINDS: readonly LinkKind[] = [
    'COURSE',
    'COURSE_LIST',
    'PRODUCT_PAGE',
    'LIVE_CLASS',
    'ASSESSMENT',
    'FEATURE',
    'URL',
];

/** When the learner app hides a feature link (spec 6.3); the picker explains it. */
export type FeatureCondition =
    | 'always'
    | 'sidebarTab'
    | 'notes'
    | 'doubts'
    | 'plan'
    | 'chatbot'
    | 'appOnly'
    | 'batch'
    | 'store';

export interface FeatureInfo {
    feature: FeatureKey;
    condition: FeatureCondition;
    /** Opens a store page: hidden in the iPhone/iPad app and the play look. */
    commerce: boolean;
}

const FEATURE_CONDITIONS: Record<FeatureKey, FeatureCondition> = {
    COURSES: 'always',
    LIVE_CLASSES: 'always',
    ASSESSMENTS: 'always',
    REPORTS: 'always',
    HOMEWORK: 'sidebarTab',
    ATTENDANCE: 'always',
    NOTEBOOK: 'notes',
    DOUBTS: 'doubts',
    REFERRAL: 'sidebarTab',
    MENTORS: 'always',
    DAILY_TASKS: 'plan',
    AI_CHAT: 'chatbot',
    DOWNLOADS: 'appOnly',
    MY_FILES: 'always',
    LEADERBOARD: 'batch',
    PROFILE: 'always',
    NOTIFICATIONS: 'always',
    STORE_MEMBERSHIPS: 'store',
    STORE_BOOKS: 'store',
};

export const FEATURE_INFO: Record<FeatureKey, FeatureInfo> = Object.fromEntries(
    FEATURE_KEYS.map((feature) => [
        feature,
        {
            feature,
            condition: FEATURE_CONDITIONS[feature],
            commerce: feature === 'STORE_MEMBERSHIPS' || feature === 'STORE_BOOKS',
        },
    ])
) as Record<FeatureKey, FeatureInfo>;

/** Features the picker offers. Store features need a store site (decision Q15). */
export function offeredFeatures(hasStoreSite: boolean): FeatureKey[] {
    return FEATURE_KEYS.filter((f) => hasStoreSite || FEATURE_INFO[f].condition !== 'store');
}

export const isFeatureKey = (v: unknown): v is FeatureKey =>
    typeof v === 'string' && (FEATURE_KEYS as readonly string[]).includes(v);

// ─── URLs ────────────────────────────────────────────────────────────────────

const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

export type UrlProblem = 'empty' | 'scheme' | 'invalid';

/**
 * Cleans what the admin typed: a bare domain gets `https://`. Returns the URL
 * to store, or the reason it cannot be stored. `javascript:` and `data:` are
 * refused, as the server refuses them.
 */
export function normalizeUrl(input: string): { url: string } | { problem: UrlProblem } {
    const raw = input.trim();
    if (!raw) return { problem: 'empty' };
    const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
    let candidate = raw;
    if (!schemeMatch) {
        if (raw.startsWith('//')) candidate = `https:${raw}`;
        else if (/^[^\s/]+\.[^\s/]+/.test(raw)) candidate = `https://${raw}`;
        else return { problem: 'invalid' };
    } else if (!ALLOWED_SCHEMES.includes(`${schemeMatch[1]!.toLowerCase()}:`)) {
        return { problem: 'scheme' };
    }
    try {
        const parsed = new URL(candidate);
        if (!ALLOWED_SCHEMES.includes(parsed.protocol)) return { problem: 'scheme' };
        if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
            return { problem: 'invalid' };
        }
        return { url: candidate };
    } catch {
        return { problem: 'invalid' };
    }
}

// ─── Picker draft ⇄ LinkTarget ───────────────────────────────────────────────

export interface LinkDraft {
    kind: LinkKind;
    /** package_id / tag / code / session_id / assessment_id / feature / url / path. */
    value: string;
    sellsSomething: boolean;
}

export const emptyLinkDraft = (kind: LinkKind = 'COURSE'): LinkDraft => ({
    kind,
    value: '',
    sellsSomething: false,
});

export function toLinkDraft(link: LinkTarget | null | undefined): LinkDraft | null {
    if (!link) return null;
    switch (link.kind) {
        case 'COURSE':
            return { kind: link.kind, value: link.package_id, sellsSomething: false };
        case 'COURSE_LIST':
            return { kind: link.kind, value: link.tag ?? '', sellsSomething: false };
        case 'PRODUCT_PAGE':
            return { kind: link.kind, value: link.code, sellsSomething: false };
        case 'LIVE_CLASS':
            return { kind: link.kind, value: link.session_id, sellsSomething: false };
        case 'ASSESSMENT':
            return { kind: link.kind, value: link.assessment_id, sellsSomething: false };
        case 'FEATURE':
            return { kind: link.kind, value: link.feature, sellsSomething: false };
        case 'URL':
            return { kind: link.kind, value: link.url, sellsSomething: link.sells_something };
        case 'APP_PATH':
            return { kind: link.kind, value: link.path, sellsSomething: false };
    }
}

/** The LinkTarget to store, or null while the draft is incomplete or invalid. */
export function toLinkTarget(draft: LinkDraft | null | undefined): LinkTarget | null {
    if (!draft) return null;
    const value = draft.value.trim();
    switch (draft.kind) {
        case 'COURSE':
            return value ? { kind: 'COURSE', package_id: value } : null;
        case 'COURSE_LIST':
            // An empty tag is "all courses", which is complete.
            return value ? { kind: 'COURSE_LIST', tag: value } : { kind: 'COURSE_LIST' };
        case 'PRODUCT_PAGE':
            return value ? { kind: 'PRODUCT_PAGE', code: value } : null;
        case 'LIVE_CLASS':
            return value ? { kind: 'LIVE_CLASS', session_id: value } : null;
        case 'ASSESSMENT':
            return value ? { kind: 'ASSESSMENT', assessment_id: value } : null;
        case 'FEATURE':
            return isFeatureKey(value) ? { kind: 'FEATURE', feature: value } : null;
        case 'URL': {
            const res = normalizeUrl(value);
            return 'url' in res
                ? { kind: 'URL', url: res.url, sells_something: draft.sellsSomething }
                : null;
        }
        case 'APP_PATH':
            return value.startsWith('/') ? { kind: 'APP_PATH', path: value } : null;
    }
}

/**
 * Reads a link from stored JSON. Unknown kinds and missing fields give null;
 * extra keys are dropped, since the server rejects unknown keys.
 */
export function normalizeLinkTarget(raw: unknown): LinkTarget | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
    switch (r.kind) {
        case 'COURSE':
            return s('package_id') ? { kind: 'COURSE', package_id: s('package_id') } : null;
        case 'COURSE_LIST':
            return s('tag') ? { kind: 'COURSE_LIST', tag: s('tag') } : { kind: 'COURSE_LIST' };
        case 'PRODUCT_PAGE':
            return s('code') ? { kind: 'PRODUCT_PAGE', code: s('code') } : null;
        case 'LIVE_CLASS':
            return s('session_id') ? { kind: 'LIVE_CLASS', session_id: s('session_id') } : null;
        case 'ASSESSMENT':
            return s('assessment_id')
                ? { kind: 'ASSESSMENT', assessment_id: s('assessment_id') }
                : null;
        case 'FEATURE':
            return isFeatureKey(r.feature) ? { kind: 'FEATURE', feature: r.feature } : null;
        case 'URL':
            return s('url')
                ? { kind: 'URL', url: s('url'), sells_something: r.sells_something === true }
                : null;
        case 'APP_PATH':
            return s('path') ? { kind: 'APP_PATH', path: s('path') } : null;
        default:
            return null;
    }
}

/**
 * How the iPhone/iPad app (reader mode, spec 6.4) treats a link:
 * - `hidden`: always removed there (store pages, marked payment URLs);
 * - `hiddenIfNotOwned`: a course link, removed for learners who do not own it;
 * - `hiddenIfPaid`: a live class, removed when the class is paid;
 * - `none`: shown.
 */
export type ReaderModeEffect = 'none' | 'hidden' | 'hiddenIfNotOwned' | 'hiddenIfPaid';

export function readerModeEffect(link: LinkTarget | null | undefined): ReaderModeEffect {
    if (!link) return 'none';
    switch (link.kind) {
        case 'PRODUCT_PAGE':
            return 'hidden';
        case 'FEATURE':
            return FEATURE_INFO[link.feature].commerce ? 'hidden' : 'none';
        case 'URL':
            return link.sells_something ? 'hidden' : 'none';
        case 'COURSE':
            return 'hiddenIfNotOwned';
        case 'LIVE_CLASS':
            return 'hiddenIfPaid';
        default:
            return 'none';
    }
}

/** True when a FEATURE link only shows for some learners (publish warning). */
export function isConditionalFeature(link: LinkTarget | null | undefined): boolean {
    return link?.kind === 'FEATURE' && FEATURE_INFO[link.feature].condition !== 'always';
}
