/**
 * Pure helpers for Global Settings → Course formats
 * (globalSettings.courseFormats + globalSettings.courseFormatOrder).
 *
 * Mirrors the learner's reading of the setting (-utils/course-format.ts):
 * keys match case-insensitively, the order list goes first and unlisted
 * formats follow in authoring order, and a course gets a format from its
 * `format-<id>` tag. Each edit returns only the keys it changes, so the
 * card's onChange never touches anything else.
 */

/** globalSettings.courseFormats as stored: { [id]: { label, levels?, tags?, … } }. */
export type CourseFormats = Record<string, unknown>;

export interface CourseFormatsEdit {
    courseFormats?: CourseFormats;
    courseFormatOrder?: string[];
    /** globalSettings.i18n, when a rename carries the name's translations along. */
    i18n?: Record<string, unknown>;
}

/**
 * The learner reads at most this many formats. The card counts every stored
 * entry (a malformed or unnamed one too), so it may stop a little earlier.
 */
export const MAX_COURSE_FORMATS = 30;
export const FORMAT_TAG_PREFIX = 'format-';

const norm = (s: string) => s.trim().toLowerCase();
const isObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

/** A format definition as an object (a malformed entry reads as empty, and is kept as is until edited). */
export const formatDef = (formats: CourseFormats, id: string): Record<string, unknown> =>
    isObject(formats[id]) ? (formats[id] as Record<string, unknown>) : {};

export const formatLabel = (formats: CourseFormats, id: string): string => {
    const label = formatDef(formats, id).label;
    return typeof label === 'string' ? label : '';
};

/** Stored ids in display order: the order list first, the rest in authoring order. */
export const orderedFormatIds = (formats: CourseFormats, order: string[] | undefined): string[] => {
    const ranks = (order || []).filter((k) => typeof k === 'string').map(norm);
    const rank = (id: string) => {
        const i = ranks.indexOf(norm(id));
        return i === -1 ? ranks.length : i;
    };
    return Object.keys(formats)
        .map((id, i) => ({ id, i }))
        .sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i)
        .map(({ id }) => id);
};

export const setFormatLabel = (
    formats: CourseFormats,
    id: string,
    label: string
): CourseFormatsEdit => ({
    courseFormats: { ...formats, [id]: { ...formatDef(formats, id), label } },
});

/** Moves one format up (-1) or down (+1); the order list keeps any entry that names no format. */
export const moveFormat = (
    formats: CourseFormats,
    order: string[] | undefined,
    id: string,
    delta: -1 | 1
): CourseFormatsEdit | null => {
    const ids = orderedFormatIds(formats, order);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return null;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, id);
    const known = new Set(ids.map(norm));
    const stale = (order || []).filter((k) => typeof k === 'string' && !known.has(norm(k)));
    return { courseFormatOrder: [...next, ...stale] };
};

export const removeFormat = (
    formats: CourseFormats,
    order: string[] | undefined,
    id: string
): CourseFormatsEdit => {
    const rest = { ...formats };
    delete rest[id];
    const edit: CourseFormatsEdit = { courseFormats: rest };
    if (order?.some((k) => typeof k === 'string' && norm(k) === norm(id))) {
        edit.courseFormatOrder = order.filter((k) => typeof k !== 'string' || norm(k) !== norm(id));
    }
    return edit;
};

/** An id for a new format from its name: "Audio Book" → "audio-book" ('' when nothing Latin is left). */
export const suggestFormatId = (label: string): string =>
    label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);

/** Lower-case letters, digits and dashes, as the id is typed. */
export const sanitizeFormatId = (raw: string): string =>
    raw.toLowerCase().replace(/[^a-z0-9-]/g, '');

export type NewFormatIssue = 'noName' | 'noId' | 'badId' | 'taken' | 'tooMany';

export const newFormatIssue = (
    formats: CourseFormats,
    id: string,
    label: string
): NewFormatIssue | null => {
    if (Object.keys(formats).length >= MAX_COURSE_FORMATS) return 'tooMany';
    if (!label.trim()) return 'noName';
    if (!id) return 'noId';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return 'badId';
    if (Object.keys(formats).some((k) => norm(k) === id)) return 'taken';
    return null;
};

/** Adds a format last; an existing order list gets it last too (a stale entry for the same id is dropped). */
export const addFormat = (
    formats: CourseFormats,
    order: string[] | undefined,
    id: string,
    label: string
): CourseFormatsEdit => {
    const edit: CourseFormatsEdit = {
        courseFormats: { ...formats, [id]: { label: label.trim() } },
    };
    if (order) {
        edit.courseFormatOrder = [
            ...order.filter((k) => typeof k !== 'string' || norm(k) !== norm(id)),
            id,
        ];
    }
    return edit;
};

/**
 * After a rename: the site shows a format's name in another language by
 * looking up the exact base name, so each language's translation of the old
 * name is copied to the new one (unless it already has its own). The old
 * entry stays, as other text may use it. Null when nothing changes.
 */
export const carryLabelTranslations = (
    i18n: unknown,
    oldLabel: string,
    newLabel: string
): Record<string, unknown> | null => {
    const from = oldLabel.trim();
    const to = newLabel.trim();
    if (!from || !to || from === to || !isObject(i18n) || !isObject(i18n.strings)) return null;
    const strings: Record<string, unknown> = { ...i18n.strings };
    let changed = false;
    for (const [locale, dict] of Object.entries(i18n.strings)) {
        if (!isObject(dict)) continue;
        const translation = dict[from];
        if (typeof translation !== 'string' || !translation || dict[to]) continue;
        strings[locale] = { ...dict, [to]: translation };
        changed = true;
    }
    return changed ? { ...i18n, strings } : null;
};
