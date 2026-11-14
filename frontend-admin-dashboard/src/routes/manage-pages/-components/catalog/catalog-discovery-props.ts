/**
 * Pure helpers for the Courses-page discovery props of a courseCatalog /
 * productCourseGrid section (streams, filters, quick filters, badges).
 *
 * The learner renderer (frontend-learner-dashboard-app
 * …/-components/components/catalog/catalog-config.ts) validates the same
 * props; these helpers only make sure the editor writes well-formed values
 * and sensible defaults the first time a feature is switched on.
 */

export type QuickFilterKind = 'popular' | 'new' | 'free' | 'bestseller' | 'language' | 'priceMax';
export type CourseBadgeType = 'bestseller' | 'popular' | 'new' | 'free';

export interface QuickFilterProp {
    id: string;
    label: string;
    kind: QuickFilterKind;
    value?: string | number;
}

export interface StreamItemProp {
    label: string;
    slug: string;
    tag: string;
}

export interface CourseLanguageChoice {
    code: string;
    label: string;
}

export const QUICK_FILTER_KINDS: { value: QuickFilterKind; label: string; hint: string }[] = [
    { value: 'popular', label: 'Popular', hint: 'Sorts by enrolments' },
    { value: 'new', label: 'New', hint: 'Courses added recently' },
    { value: 'free', label: 'Free', hint: 'Free courses only' },
    { value: 'bestseller', label: 'Bestsellers', hint: 'The top paid courses' },
    { value: 'language', label: 'Language', hint: 'One course language' },
    { value: 'priceMax', label: 'Under an amount', hint: 'Price at most this amount' },
];

export const BADGE_TYPES: { value: CourseBadgeType; label: string; hint: string }[] = [
    { value: 'bestseller', label: 'Bestseller', hint: 'The top paid courses by enrolments' },
    { value: 'popular', label: 'Popular', hint: 'The most-enrolled course of each stream tab' },
    { value: 'new', label: 'New', hint: 'Added in the last few days (below)' },
    { value: 'free', label: 'Free', hint: 'Costs nothing' },
];

/** Same defaults the learner app falls back to. */
export const DEFAULT_COURSE_LANGUAGES: CourseLanguageChoice[] = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'Hindi' },
];

const isObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

/** "500, 1000 ₹2000" → [500, 1000, 2000]: positive, unique, ascending, at most 8. */
export const parseAmountList = (text: string): number[] => {
    const nums = text
        .split(/[\s,;]+/)
        .map((part) => part.replace(/^[₹$€£]/, ''))
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
    return [...new Set(nums)].sort((a, b) => a - b).slice(0, 8);
};

export const formatAmountList = (value: unknown): string =>
    Array.isArray(value) ? value.filter((n) => typeof n === 'number' && n > 0).join(', ') : '';

/** A URL key: lower-case letters, digits and dashes (≤ 120). */
export const toStreamKey = (text: string): string =>
    text
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120)
        .replace(/-+$/g, '');

/**
 * A URL key while it is being typed: like toStreamKey but a trailing dash
 * survives, so "vedic-maths" (or "vedic maths") can be typed one key at a
 * time. The full toStreamKey runs when the field loses focus.
 */
export const toStreamKeyDraft = (text: string): string =>
    text
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+/g, '')
        .slice(0, 120);

/**
 * The URL key a tag-list tab gets on the site — the learner's
 * resolveStreamItems reads `slug || tag || label` the same way. '' means the
 * tab is dropped there (e.g. a Devanagari-only tag with no key typed).
 */
export const streamItemKey = (item: Partial<StreamItemProp> | null | undefined): string => {
    const pick = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return toStreamKey(pick(item?.slug) || pick(item?.tag) || pick(item?.label));
};

export type StreamItemProblem = { kind: 'noKey' } | { kind: 'duplicate'; firstIndex: number };

/** Per tab: why the site would drop it (no usable URL key, or the same key as an earlier tab), else null. */
export const streamItemProblems = (
    items: (Partial<StreamItemProp> | null | undefined)[]
): (StreamItemProblem | null)[] => {
    const firstByKey = new Map<string, number>();
    return items.map((item, index) => {
        const key = streamItemKey(item);
        if (!key) return { kind: 'noKey' };
        const first = firstByKey.get(key);
        if (first !== undefined) return { kind: 'duplicate', firstIndex: first };
        firstByKey.set(key, index);
        return null;
    });
};

/** qf-1, qf-2… — the first id not already used. */
export const nextQuickFilterId = (list: { id?: unknown }[]): string => {
    const used = new Set(list.map((q) => String(q.id ?? '')));
    let n = list.length + 1;
    while (used.has(`qf-${n}`)) n += 1;
    return `qf-${n}`;
};

/** A new quick filter: the first kind not on the list yet (language/amount need a value). */
export const newQuickFilter = (list: QuickFilterProp[]): QuickFilterProp => {
    const usedKinds = new Set(list.map((q) => q.kind));
    const kind =
        (['popular', 'new', 'free', 'bestseller'] as QuickFilterKind[]).find(
            (k) => !usedKinds.has(k)
        ) ?? 'priceMax';
    return {
        id: nextQuickFilterId(list),
        label: '',
        kind,
        ...(kind === 'priceMax' ? { value: 1000 } : {}),
    };
};

/** Switching a quick filter's kind keeps its id and label, and gives it a valid value. */
export const withQuickFilterKind = (
    qf: QuickFilterProp,
    kind: QuickFilterKind,
    languages: CourseLanguageChoice[]
): QuickFilterProp => {
    const base = { id: qf.id, label: qf.label, kind };
    if (kind === 'language') return { ...base, value: languages[0]?.code ?? 'hi' };
    if (kind === 'priceMax')
        return { ...base, value: typeof qf.value === 'number' && qf.value > 0 ? qf.value : 1000 };
    return base;
};

export const moveItem = <T>(list: T[], index: number, delta: number): T[] => {
    const target = index + delta;
    if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item as T);
    return next;
};

/** Streams as first switched on: folder-library tabs, sticky, folder titles. */
export const enableStreams = (current: unknown): Record<string, unknown> => ({
    source: 'folderLibrary',
    sticky: true,
    labelMode: 'title',
    ...(isObject(current) ? current : {}),
    enabled: true,
});

const ALL_BADGE_TYPES = BADGE_TYPES.map((b) => b.value);

/** The badge types a stored `badges.types` value ticks, in priority order (absent = all four). */
export const badgeTypesOf = (types: unknown): CourseBadgeType[] => {
    if (!Array.isArray(types)) return [...ALL_BADGE_TYPES];
    return ALL_BADGE_TYPES.filter((t) => types.includes(t));
};

/**
 * Badges as first switched on: all four, New = 60 days, top 3 bestsellers, 2
 * per card. Earlier choices are kept — except a type list with nothing valid
 * left in it, which would mean "no badges" and is reset to all four.
 */
export const enableBadges = (current: unknown): Record<string, unknown> => {
    const kept = isObject(current) ? current : {};
    const types = badgeTypesOf(kept.types);
    return {
        newDays: 60,
        bestsellerTop: 3,
        max: 2,
        ...kept,
        types: types.length ? types : [...ALL_BADGE_TYPES],
        enabled: true,
    };
};

/**
 * Toggle one badge type, keeping the fixed priority order. The last ticked
 * type cannot be unticked (the list is returned unchanged): an empty list
 * would show no badges at all, which is what the "Badges on cards" switch is
 * for.
 */
export const toggleBadgeType = (types: unknown, type: CourseBadgeType): CourseBadgeType[] => {
    const current = badgeTypesOf(types);
    const next = current.includes(type)
        ? current.filter((t) => t !== type)
        : ALL_BADGE_TYPES.filter((t) => t === type || current.includes(t));
    return next.length ? next : current;
};

/** The site's course-language settings (globalSettings.courseLanguages), with the learner app's defaults. */
export const readCourseLanguages = (
    globalSettings: unknown
): { enabled: boolean; languages: CourseLanguageChoice[] } => {
    const raw = isObject(globalSettings) ? globalSettings.courseLanguages : undefined;
    const settings = isObject(raw) ? raw : {};
    const list = Array.isArray(settings.languages)
        ? settings.languages
              .filter(isObject)
              .map((l) => ({
                  code: String(l.code ?? '')
                      .trim()
                      .toLowerCase(),
                  label: String(l.label ?? l.code ?? '').trim(),
              }))
              .filter((l) => l.code)
        : [];
    return {
        enabled: settings.enabled === true,
        languages: list.length ? list : DEFAULT_COURSE_LANGUAGES,
    };
};

/** A positive whole number from an input, or undefined to fall back to the default. */
export const positiveIntOrUndefined = (text: string): number | undefined => {
    const n = Math.floor(Number(text));
    return Number.isFinite(n) && n > 0 ? n : undefined;
};
