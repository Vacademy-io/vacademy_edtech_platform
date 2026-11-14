/**
 * Pure helpers for the courses-page design editors (page header, rows, sidebar,
 * card texts). Section props are hand- or AI-written JSON, so everything is read
 * as unknown and narrowed; every write returns a new value that keeps the keys
 * it does not manage. The learner reads these props in
 * catalog-hero-config.ts, catalog-column-sections.ts, catalog-sidebar-config.ts
 * and catalog-card-view.ts.
 */
import type { FolderNode } from '../../-services/folder-library-service';
import { effectiveFolderSlug } from '../folders/folder-node-advanced';

export type Props = Record<string, unknown>;

export const isObject = (v: unknown): v is Props =>
    !!v && typeof v === 'object' && !Array.isArray(v);
export const objectOf = (v: unknown): Props => (isObject(v) ? v : {});
export const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');
/** The object items of a list (anything else is skipped by the site too). */
export const objectsOf = (v: unknown): Props[] => (Array.isArray(v) ? v.filter(isObject) : []);
export const stringsOf = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

/** `map` with `key` set to `value`; an empty value removes the key, so the built-in text applies again. */
export const setOrDelete = (map: unknown, key: string, value: string): Props => {
    const next = { ...objectOf(map) };
    if (value === '') delete next[key];
    else next[key] = value;
    return next;
};

/*
 * Lists edited in place. The editors number a list's object items the way
 * objectsOf reads them; these writers take the raw list and that number, so an
 * entry the editor skips (not an object) stays where it was.
 */
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rawIndexOf = (list: unknown[], n: number): number => {
    let seen = -1;
    return list.findIndex((x) => isObject(x) && ++seen === n);
};

/** Object item `n` of `raw` replaced by `item`. */
export const replaceObject = (raw: unknown, n: number, item: Props): unknown[] => {
    const list = listOf(raw);
    const at = rawIndexOf(list, n);
    return list.map((x, i) => (i === at ? item : x));
};

/** Object item `n` of `raw` merged with `next`. */
export const patchObject = (raw: unknown, n: number, next: Props): unknown[] => {
    const list = listOf(raw);
    const at = rawIndexOf(list, n);
    return list.map((x, i) => (i === at ? { ...objectOf(x), ...next } : x));
};

/** `raw` without object item `n`. */
export const removeObject = (raw: unknown, n: number): unknown[] => {
    const list = listOf(raw);
    const at = rawIndexOf(list, n);
    return list.filter((_, i) => i !== at);
};

/** Object item `n` of `raw` swapped with the object item `delta` places away. */
export const moveObject = (raw: unknown, n: number, delta: number): unknown[] => {
    const list = listOf(raw);
    const from = rawIndexOf(list, n);
    const to = rawIndexOf(list, n + delta);
    if (from < 0 || to < 0) return list;
    const next = [...list];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
};

/** `raw` with `item` added at the end. */
export const appendObject = (raw: unknown, item: Props): unknown[] => [...listOf(raw), item];

/** `raw` with `item` added just before object item `n` (at the end when there is none). */
export const insertObject = (raw: unknown, n: number, item: Props): unknown[] => {
    const list = [...listOf(raw)];
    const at = rawIndexOf(list, n);
    list.splice(at < 0 ? list.length : at, 0, item);
    return list;
};

/* ── streams and categories, for the pickers ───────────────────────── */

export interface StreamOption {
    slug: string;
    label: string;
    /** `comingSoon`: flagged coming soon with a notify form, so the coming-soon row can list it. */
    categories: { slug: string; label: string; comingSoon?: boolean }[];
}

const folderName = (n: FolderNode): string => {
    const title = (n.title || '').trim();
    const subtitle = (n.subtitle || '').trim();
    return title && subtitle && title !== subtitle ? `${title} · ${subtitle}` : title || subtitle;
};

/** Top-level folders are the streams and their sub-folders the categories, keyed by the site's link key. */
export const streamOptionsFromTree = (roots: FolderNode[] | null | undefined): StreamOption[] =>
    (roots || [])
        .filter((n) => n && n.node_type === 'FOLDER')
        .map((n) => ({
            slug: effectiveFolderSlug(n),
            label: folderName(n) || effectiveFolderSlug(n),
            categories: (n.children || [])
                .filter((c) => c && c.node_type === 'FOLDER')
                .map((c) => ({
                    slug: effectiveFolderSlug(c),
                    label: folderName(c) || effectiveFolderSlug(c),
                    ...(c.coming_soon && c.audience_id ? { comingSoon: true } : {}),
                })),
        }));

/** Stream tabs written as course tags (streams.source 'tags'): no categories. Keyed like the site's resolveStreamItems. */
export const streamOptionsFromItems = (items: unknown): StreamOption[] => {
    const seen = new Set<string>();
    return objectsOf(items).flatMap((it) => {
        const label = textOf(it.label).trim();
        const tag = textOf(it.tag).trim();
        const slug = optionIdFrom(textOf(it.slug).trim() || tag || label);
        if (!slug || seen.has(slug)) return [];
        seen.add(slug);
        return [{ slug, label: label || tag || slug, categories: [] }];
    });
};

/* ── page header: Popular chips ────────────────────────────────────── */

/** What a chip does. The site uses the first that is set: search > stream > quick filter > link. */
export type ChipAction = 'search' | 'stream' | 'quickFilter' | 'link';
const CHIP_ACTION_KEY: Record<ChipAction, string> = {
    search: 'searchValue',
    stream: 'streamSlug',
    quickFilter: 'quickFilterId',
    link: 'route',
};
const CHIP_ACTIONS = Object.keys(CHIP_ACTION_KEY) as ChipAction[];

/** The action the site runs (the first one set), else the one just picked (its key is still empty). */
export const chipActionOf = (chip: Props): ChipAction =>
    CHIP_ACTIONS.find((a) => textOf(chip[CHIP_ACTION_KEY[a]])) ??
    CHIP_ACTIONS.find((a) => typeof chip[CHIP_ACTION_KEY[a]] === 'string') ??
    'stream';

/** The chip switched to another action: the old action's keys go (they would win), the rest stay. */
export const withChipAction = (chip: Props, action: ChipAction): Props => {
    const next = { ...chip };
    for (const key of [...Object.values(CHIP_ACTION_KEY), 'categorySlug']) delete next[key];
    next[CHIP_ACTION_KEY[action]] = '';
    return next;
};

/* ── rows above / below the grid ───────────────────────────────────── */

/** Whether `list` has `slug`, ignoring case (the site lower-cases category slugs). */
export const hasSlug = (list: string[], slug: string): boolean =>
    list.some((s) => s.toLowerCase() === slug.toLowerCase());

/** The coming-soon row's categories with `slug` ticked or unticked; the order of the others is kept. */
export const toggleSlug = (list: string[], slug: string): string[] =>
    hasSlug(list, slug)
        ? list.filter((s) => s.toLowerCase() !== slug.toLowerCase())
        : [...list, slug];

/* ── sidebar ───────────────────────────────────────────────────────── */

/** The site's own order when `filterSidebar.order` lists nothing (catalog-sidebar-config.ts). */
const BUILT_IN_GROUPS = [
    { id: 'category', key: 'categoryFilter' },
    { id: 'language', key: 'languageFilter' },
    { id: 'price', key: 'priceFilter' },
] as const;

export interface SidebarGroupRow {
    id: string;
    /** The built-in filter's prop ('priceFilter'…), or null for an extra filter. */
    filterKey: string | null;
    /** Index in customFilters, for an extra filter. */
    customIndex: number | null;
    label: string;
    shown: boolean;
}

/**
 * The sidebar's filter groups in display order, like the site lists them:
 * the authored order first (case-insensitive), then the rest in the original
 * order. A built-in group is listed once its filter object exists.
 */
export const sidebarGroupRows = (props: Props): SidebarGroupRow[] => {
    const rows: SidebarGroupRow[] = [];
    for (const g of BUILT_IN_GROUPS) {
        if (!isObject(props[g.key])) continue;
        const filter = objectOf(props[g.key]);
        rows.push({
            id: g.id,
            filterKey: g.key,
            customIndex: null,
            label: textOf(filter.label),
            shown: filter.enabled === true,
        });
    }
    objectsOf(props.customFilters).forEach((f) => {
        const id = textOf(f.id).trim();
        if (!id || rows.some((r) => r.id.toLowerCase() === id.toLowerCase())) return;
        const customIndex = (props.customFilters as unknown[]).indexOf(f);
        rows.push({
            id,
            filterKey: null,
            customIndex,
            label: textOf(f.label),
            shown: f.enabled !== false,
        });
    });
    const order = stringsOf(objectOf(props.filterSidebar).order);
    const listed: SidebarGroupRow[] = [];
    for (const raw of order) {
        const row = rows.find((r) => r.id.toLowerCase() === raw.toLowerCase());
        if (row && !listed.includes(row)) listed.push(row);
    }
    return [...listed, ...rows.filter((r) => !listed.includes(r))];
};

/**
 * The new `filterSidebar.order` after moving row `index` by `delta`: every
 * listed group in its new place, and the ids the editor does not show (legacy
 * groups such as 'level') back at their old positions, so none is lost or moved.
 */
export const movedGroupOrder = (
    rows: SidebarGroupRow[],
    index: number,
    delta: number,
    order: unknown
): string[] => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return stringsOf(order);
    const ids = rows.map((r) => r.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved!);
    stringsOf(order).forEach((id, at) => {
        if (!ids.some((r) => r.toLowerCase() === id.toLowerCase())) ids.splice(at, 0, id);
    });
    return ids;
};

/** A URL-safe id from a label ("Women's health" → "women-s-health"), as the site's toSlug makes it. */
export const optionIdFrom = (label: string): string =>
    label
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120)
        .replace(/-+$/g, '');

/** An id not used by `taken` yet: `base`, else base-2, base-3… */
export const uniqueId = (base: string, taken: string[]): string => {
    const used = new Set(taken.map((t) => t.toLowerCase()));
    if (!used.has(base.toLowerCase())) return base;
    let n = 2;
    while (used.has(`${base}-${n}`.toLowerCase())) n += 1;
    return `${base}-${n}`;
};

/**
 * URL keys an extra filter group can never use: the ones other catalogue
 * features read (the site's RESERVED_FILTER_IDS, catalog-custom-filters.ts)
 * and the legacy filter groups. The site also skips keys starting with 'utm'.
 */
const RESERVED_GROUP_IDS = [
    'stream',
    'category',
    'language',
    'price',
    'sort',
    'q',
    'quick',
    'path',
    'badge',
    'lang',
    'page',
    'goal',
    'folder',
    'level',
    'session',
    'tags',
    'instructor',
    'priceRange',
];

/** Whether the site drops a filter group with this URL key. */
export const isReservedGroupId = (id: string): boolean => {
    const key = id.toLowerCase();
    return key.startsWith('utm') || RESERVED_GROUP_IDS.some((r) => r.toLowerCase() === key);
};

/** A new filter group's URL key from its heading; `fallback` when the heading has no Latin letters. */
export const groupIdFrom = (label: string, taken: string[], fallback: string): string => {
    const base = optionIdFrom(label) || fallback;
    return uniqueId(base.startsWith('utm') ? `filter-${base}` : base, [
        ...RESERVED_GROUP_IDS,
        ...taken,
    ]);
};

/** "for-parents, parents" → ['for-parents', 'parents'] (lower-case, as the site matches tags). */
export const parseTagList = (text: string): string[] => [
    ...new Set(
        text
            .split(',')
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
    ),
];
