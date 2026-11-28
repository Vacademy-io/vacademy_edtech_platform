import type { CampaignTags } from '../-services/campaign-tags';

/**
 * Lead list tags: key -> value pairs (one value per key) that CRM reports group leads by.
 * These rules mirror the backend's AudienceTagsUtil so the form can explain a problem before
 * the save round-trip; the backend stays the authority.
 */
export const MAX_CAMPAIGN_TAGS = 10;
export const MAX_TAG_KEY_LENGTH = 40;
export const MAX_TAG_VALUE_LENGTH = 60;

/** Rows always shown in the form, in this order, with a fixed key. */
export const SUGGESTED_TAG_KEYS = ['state', 'course', 'channel'] as const;
export type SuggestedTagKey = (typeof SUGGESTED_TAG_KEYS)[number];

const KEY_PATTERN = new RegExp(`^[a-z0-9_]{1,${MAX_TAG_KEY_LENGTH}}$`);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export interface TagRow {
    /** Stable React key; not sent anywhere. */
    id: string;
    key: string;
    value: string;
    /** One of SUGGESTED_TAG_KEYS: the key is fixed and the row cannot be removed, only cleared. */
    suggested: boolean;
}

export type TagRowsError =
    | { code: 'invalidKey'; key: string }
    | { code: 'duplicateKey'; key: string }
    | { code: 'valueTooLong'; key: string }
    | { code: 'invalidValue'; key: string }
    | { code: 'tooMany' };

/** Same canonical spelling as the backend: trimmed, lower-case, spaces / hyphens as `_`. */
export const normalizeTagKey = (raw: string): string =>
    raw.trim().toLowerCase().replace(/[\s-]+/g, '_');

export const isSuggestedTagKey = (key: string): key is SuggestedTagKey =>
    (SUGGESTED_TAG_KEYS as readonly string[]).includes(key);

let rowSeq = 0;
export const newTagRowId = () => `tag-${Date.now().toString(36)}-${(rowSeq += 1)}`;

/** Form rows for a list's saved tags: the suggested keys first, then the rest by key. */
export const rowsFromTags = (tags?: CampaignTags | null): TagRow[] => {
    const saved = tags ?? {};
    const suggested: TagRow[] = SUGGESTED_TAG_KEYS.map((key) => ({
        id: `suggested-${key}`,
        key,
        value: saved[key] ?? '',
        suggested: true,
    }));
    const custom: TagRow[] = Object.keys(saved)
        .filter((key) => !isSuggestedTagKey(key))
        .sort()
        .map((key) => ({ id: newTagRowId(), key, value: saved[key] ?? '', suggested: false }));
    return [...suggested, ...custom];
};

/**
 * The tags map to send for these rows, or the first problem found. Rows with a blank value
 * are left out (that is how a tag is removed); a custom row with a value needs a valid key.
 */
export const tagsFromRows = (
    rows: TagRow[]
): { tags: CampaignTags; error?: undefined } | { tags?: undefined; error: TagRowsError } => {
    const tags: CampaignTags = {};
    for (const row of rows) {
        const value = row.value.trim();
        if (!value) continue;
        const key = normalizeTagKey(row.key);
        if (!KEY_PATTERN.test(key)) return { error: { code: 'invalidKey', key: row.key.trim() } };
        if (key in tags) return { error: { code: 'duplicateKey', key } };
        if (Array.from(value).length > MAX_TAG_VALUE_LENGTH) {
            return { error: { code: 'valueTooLong', key } };
        }
        if (CONTROL_CHARS.test(value)) return { error: { code: 'invalidValue', key } };
        tags[key] = value;
    }
    if (Object.keys(tags).length > MAX_CAMPAIGN_TAGS) return { error: { code: 'tooMany' } };
    return { tags };
};

/** Saved tags as `[key, value]` pairs for display, suggested keys first. */
export const orderedTagEntries = (tags?: CampaignTags | null): Array<[string, string]> => {
    if (!tags) return [];
    const keys = Object.keys(tags).filter((key) => (tags[key] ?? '').trim() !== '');
    const rank = (key: string) => {
        const index = (SUGGESTED_TAG_KEYS as readonly string[]).indexOf(key);
        return index === -1 ? SUGGESTED_TAG_KEYS.length : index;
    };
    return keys
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
        .map((key): [string, string] => [key, tags[key] ?? '']);
};
