/**
 * Which translation an issue uses. Server issues carry a code and an English
 * message but no numbers, so a sentence that needs a number ("at most {{max}}")
 * falls back to its plain form ("Too long.") instead of printing a blank.
 */
import type { CheckIssue } from '../-types/learner-home-types';

/** Codes whose sentence needs these params. */
const NEEDS: Record<string, string[]> = {
    TOO_LONG: ['max'],
    TOO_MANY: ['max'],
    TOO_FEW: ['min'],
    OUT_OF_RANGE: ['min', 'max'],
    IMAGE_LOW_RES: ['width', 'min'],
    MANY_SLIDES: ['count'],
    AUDIENCE_TOO_MANY: ['max'],
    AUDIENCE_TOO_MANY_IDS: ['max'],
    AUDIENCE_ID_MISSING: ['count'],
    LIMIT_BLOCKS: ['max'],
    LIMIT_CONTENT_BLOCKS: ['max'],
    LIMIT_TYPE: ['max'],
    PAYLOAD_TOO_LARGE: ['kb', 'max'],
};

export interface IssueTextKey {
    key: string;
    params: Record<string, string | number>;
}

/** The key to translate, or null to show the server's own message. */
export function issueTextKey(
    issue: CheckIssue,
    exists: (key: string) => boolean
): IssueTextKey | null {
    const params = issue.params ?? {};
    const full = `issues.${issue.code}`;
    const complete = (NEEDS[issue.code] ?? []).every((p) => params[p] !== undefined);
    if (complete && exists(full)) return { key: full, params };
    const plain = `issuesPlain.${issue.code}`;
    if (exists(plain)) return { key: plain, params };
    return null;
}

const FIELD_KEYS: Record<string, string> = {
    title: 'title',
    subtitle: 'subtitle',
    body: 'body',
    label: 'label',
    ack_label: 'ackLabel',
    admin_label: 'adminLabel',
    alt: 'alt',
    image: 'image',
    desktop_image: 'image',
    url: 'link',
    link: 'link',
    see_all: 'link',
    button: 'button',
    register_cta: 'button',
    join_cta: 'button',
    tags: 'tags',
    package_ids: 'courses',
    slides: 'slides',
    tiles: 'tiles',
    limit: 'limit',
    starts_at: 'schedule',
    ends_at: 'schedule',
    audience: 'audience',
    all_of: 'audience',
    icon: 'icon',
    live_session_id: 'session',
};

/**
 * The field a path names, as a `fields.*` key: "config.slides[0].image.alt" →
 * "fields.alt". Null for a block- or layout-level path.
 */
export function issueFieldKey(path: string | null | undefined): string | null {
    if (!path) return null;
    const parts = path.split('.').map((p) => p.replace(/\[\d+\]$/, ''));
    for (let i = parts.length - 1; i >= 0; i -= 1) {
        const key = FIELD_KEYS[parts[i]!];
        if (key) return `fields.${key}`;
    }
    return null;
}
