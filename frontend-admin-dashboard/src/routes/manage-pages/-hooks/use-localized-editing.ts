/**
 * The builder's "Editing: English | हिन्दी" mode, at the PropertyPanel seam.
 *
 * The site is written in ONE base language; every other language is a
 * dictionary (globalSettings.i18n.strings[locale], keyed by the exact base
 * text — see -utils/catalogue-i18n.ts). In another language the panel and the
 * canvas show a LOCALIZED VIEW of the config, and every edit the ordinary
 * per-component editors hand back is split: a text change becomes a dictionary
 * entry, everything else (toggles, links, colours, added/removed/reordered
 * items) edits the shared base. None of the 40+ editors needs to know.
 *
 * Base language = strict passthrough: the hook returns the store's own config
 * and functions, so nothing about single-language editing changes.
 *
 * Guards for edits a dictionary cannot represent (each is blocked with a
 * notice instead of silently corrupting either language):
 *  - typing into a field whose base text is empty ("add the English text
 *    first"): there is no source string to hang the translation on. That
 *    holds for anything typed — digits and lowercase words too, which is how
 *    '2025 बैच' or 'naya batch' begin; only a link or colour may go to the base;
 *  - typing over a base value that looks like data (a code, a number): those
 *    are shared by every language;
 *  - changing a value typed to match real data (a course tag to filter by, a
 *    level filter value): retyped here it would be a translation that
 *    matches nothing, in every language. A value picked from a list (a sort,
 *    a button action, a blog category) is shared and simply changes;
 *  - one action rewriting several texts at once (a preset, "sync with pages",
 *    "move styles to CSS") over text that is already translated — splitting it
 *    would record wrong translations or delete good ones. When every text it
 *    touches is still untranslated, it is simply applied to the base.
 * A section-type swap (e.g. "switch to product page offer") always goes to the
 * base. New content an edit introduces (a duplicated item) takes the base text
 * of the item it copies (or, failing that, of an unambiguous dictionary
 * entry), so a copy of a translated item never writes the translation into
 * the base. After a refused edit the panel is rebuilt from the stored values
 * (useLocalizedPanelKey), so no editor keeps showing text that was not saved.
 */
import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import type { CatalogueConfig, Component, Page } from '../-types/editor-types';
import type { LocalizedEditCommit } from '../-stores/editor-store';
import {
    applyLocalizedEdit,
    baseLocaleOf,
    collectTranslatableStrings,
    isRenderKey,
    isTextKey,
    localesOf,
    localizeDeep,
    localizeRenderTexts,
    looksLikeData,
    objectChildKey,
    splitRenderEdit,
    type CatalogueI18nSettings,
    type CatalogueLocale,
    type TranslationDictionary,
} from '../-utils/catalogue-i18n';

/* ── which language is being edited ─────────────────────────────────── */

/** Languages the builder can switch between: only once the site offers 2+. */
export const editableLocalesOf = (
    i18n: CatalogueI18nSettings | undefined | null
): CatalogueLocale[] => {
    const stored = (i18n?.locales || []).filter(
        (l) => l && typeof l.code === 'string' && l.code.trim()
    );
    return stored.length >= 2 ? localesOf(i18n) : [];
};

/**
 * The non-base language actually in effect, or null for the base language.
 * A stale choice (the language was removed, or is the base) falls back to base.
 */
export const activeEditingLocale = (
    i18n: CatalogueI18nSettings | undefined | null,
    editingLocale: string | null | undefined
): string | null => {
    const code = (editingLocale || '').trim().toLowerCase();
    if (!code || code === baseLocaleOf(i18n)) return null;
    return editableLocalesOf(i18n).some((l) => l.code === code) ? code : null;
};

export { languageName } from '../-components/i18n/site-strings';

/** The editor reads the dictionary even before the site goes live (dictionaryFor would not). */
export const dictionaryForEditing = (
    config: CatalogueConfig | null | undefined,
    locale: string
): TranslationDictionary | undefined => {
    const dict = config?.globalSettings?.i18n?.strings?.[locale];
    return dict && typeof dict === 'object' ? dict : undefined;
};

/* ── the localized view ─────────────────────────────────────────────── */

const localizeComponents = (list: Component[], dict: TranslationDictionary): Component[] => {
    let changed = false;
    const out = list.map((c) => {
        const next = localizeComponent(c, dict);
        if (next !== c) changed = true;
        return next;
    });
    return changed ? out : list;
};

/**
 * A section's props localized; column children (props.slots, opaque to
 * localizeDeep) one by one, and the texts of a course grid's opaque `render`
 * (card labels, Load more…) so their fields read in the language edited.
 */
const localizeComponent = (c: Component, dict: TranslationDictionary): Component => {
    if (!c || typeof c !== 'object' || !c.props || typeof c.props !== 'object') return c;
    let props = localizeDeep(c.props, dict);
    const render = localizeRenderTexts(c.props.render, dict);
    if (render !== c.props.render) props = { ...props, render };
    let nextProps = props;
    const slots = c.props.slots;
    if (Array.isArray(slots)) {
        let changed = false;
        const nextSlots = slots.map((slot: unknown) => {
            if (!Array.isArray(slot)) return slot;
            const out = localizeComponents(slot as Component[], dict);
            if (out !== slot) changed = true;
            return out;
        });
        if (changed) nextProps = { ...props, slots: nextSlots };
    }
    return nextProps === c.props ? c : { ...c, props: nextProps };
};

// One view per (config, language): the canvas and the panel share it, and the
// objects an editor rendered from are exactly the ones its edit is diffed against.
const viewCache = new WeakMap<CatalogueConfig, Map<string, CatalogueConfig>>();

/**
 * The config as it reads in `locale`: page sections (column children
 * included), page SEO and the global header/footer. Never the rest of
 * globalSettings — values there (catalogue type, level groups, form fields)
 * are data. Unchanged parts keep their references.
 */
export const buildLocalizedView = (
    config: CatalogueConfig | null,
    locale: string | null
): CatalogueConfig | null => {
    if (!config || !locale) return config;
    const cached = viewCache.get(config)?.get(locale);
    if (cached) return cached;

    let view = config;
    const dict = dictionaryForEditing(config, locale);
    if (dict && Object.keys(dict).length > 0) {
        let pagesChanged = false;
        const pages = (config.pages || []).map((p) => {
            const components = Array.isArray(p.components)
                ? localizeComponents(p.components, dict)
                : p.components;
            const seo = p.seo ? localizeDeep(p.seo, dict) : p.seo;
            if (components === p.components && seo === p.seo) return p;
            pagesChanged = true;
            return { ...p, components, seo };
        });
        const layout = config.globalSettings?.layout;
        let nextLayout = layout;
        if (layout && typeof layout === 'object') {
            const header = layout.header ? localizeComponent(layout.header, dict) : layout.header;
            const footer = layout.footer ? localizeComponent(layout.footer, dict) : layout.footer;
            if (header !== layout.header || footer !== layout.footer) {
                nextLayout = { ...layout };
                if (header !== layout.header) nextLayout.header = header;
                if (footer !== layout.footer) nextLayout.footer = footer;
            }
        }
        if (pagesChanged || nextLayout !== layout) {
            view = {
                ...config,
                pages: pagesChanged ? pages : config.pages,
                globalSettings:
                    nextLayout !== layout
                        ? { ...config.globalSettings, layout: nextLayout }
                        : config.globalSettings,
            };
        }
    }

    let perLocale = viewCache.get(config);
    if (!perLocale) {
        perLocale = new Map();
        viewCache.set(config, perLocale);
    }
    perLocale.set(locale, view);
    return view;
};

/** Canvas-side: the config to render while editing `editingLocale` (the store config in the base language). */
export const useLocalizedView = (
    config: CatalogueConfig | null,
    editingLocale: string | null | undefined
): CatalogueConfig | null => {
    const locale = activeEditingLocale(config?.globalSettings?.i18n, editingLocale);
    return useMemo(() => (locale ? buildLocalizedView(config, locale) : config), [config, locale]);
};

/* ── splitting an edit ──────────────────────────────────────────────── */

export type LocalizedBlockReason = 'emptySource' | 'sharedData' | 'bulk' | 'structure';

export type LocalizedEditDecision<T> =
    | { kind: 'commit'; base: T; translations: Record<string, string> }
    | { kind: 'noop' }
    | { kind: 'blocked'; reason: LocalizedBlockReason };

type Key = string | number | undefined;
type Path = (string | number)[];

interface LeafChange {
    path: Path;
    key: Key;
    before: unknown;
    after: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
const isComposite = (v: unknown): boolean => !!v && typeof v === 'object';

// Keys whose whole value catalogue-i18n treats as opaque configuration
// (style, showCondition, slots…). Probed through the shared util itself rather
// than copied, so the two can never disagree.
const PROBE_SOURCE = 'Probe Text For Opaque Keys';
const opaqueCache = new Map<string, boolean>();
const isOpaqueKey = (key: Key): boolean => {
    if (typeof key !== 'string') return false;
    const cached = opaqueCache.get(key);
    if (cached !== undefined) return cached;
    const probe = { [key]: { text: PROBE_SOURCE } };
    const opaque = localizeDeep(probe, { [PROBE_SOURCE]: 'x' }) === probe;
    opaqueCache.set(key, opaque);
    return opaque;
};

/** The key array items are judged by — the same inheritance localizeDeep / applyLocalizedEdit use. */
const childKeyOf = (key: Key): Key =>
    typeof key === 'string' && !isTextKey(key) ? key : undefined;

/**
 * Walks view → edited. Returns false when the STRUCTURE changed (an item added,
 * removed or moved, an object appearing or disappearing); otherwise collects
 * every changed leaf value. Opaque values count as one leaf. Keys inside list
 * items are resolved the way catalogue-i18n judges them (objectChildKey), so an
 * announcement's tag pill is text here exactly as it is on the site.
 */
const diffShape = (
    before: unknown,
    after: unknown,
    key: Key,
    path: Path,
    out: LeafChange[],
    itemOf?: Key
): boolean => {
    if (after === before) return true;
    if (isOpaqueKey(key)) {
        out.push({ path, key, before, after });
        return true;
    }
    if (Array.isArray(before) && Array.isArray(after)) {
        if (after.length !== before.length) return false;
        const childKey = childKeyOf(key);
        for (let i = 0; i < after.length; i++) {
            const a = after[i];
            const b = before[i];
            if (a === b) continue;
            if (isComposite(a)) {
                const j = before.indexOf(a);
                if (j >= 0 && j !== i) return false; // moved
            }
            if (!diffShape(b, a, childKey, [...path, i], out, key)) return false;
        }
        return true;
    }
    if (isPlainObject(before) && isPlainObject(after)) {
        const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
        for (const k of keys) {
            if (after[k] === before[k]) continue;
            if (
                !diffShape(before[k], after[k], objectChildKey(k, key, itemOf), [...path, k], out)
            ) {
                return false;
            }
        }
        return true;
    }
    if (isComposite(before) || isComposite(after)) return false;
    out.push({ path, key, before, after });
    return true;
};

interface StructureChanges {
    /** Arrays whose items were added, removed or moved (item-level structure). */
    arrays: number;
    /** Object-valued keys that appeared / disappeared outside any changed array. */
    added: Path[];
    removed: Path[];
}

/** Where a structural edit changed the shape (diffShape only says THAT it did). */
const scanStructure = (
    before: unknown,
    after: unknown,
    key: Key,
    path: Path,
    info: StructureChanges
) => {
    if (after === before || isOpaqueKey(key)) return;
    if (Array.isArray(before) && Array.isArray(after)) {
        const moved =
            before.length === after.length &&
            after.some((a, i) => isComposite(a) && a !== before[i] && before.indexOf(a) >= 0);
        if (before.length !== after.length || moved) {
            info.arrays += 1;
            return;
        }
        const childKey = childKeyOf(key);
        after.forEach((a, i) => scanStructure(before[i], a, childKey, [...path, i], info));
        return;
    }
    if (isPlainObject(before) && isPlainObject(after)) {
        for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
            scanStructure(before[k], after[k], objectChildKey(k, key), [...path, k], info);
        }
        return;
    }
    // A list appearing or disappearing is item-level structure, like adding
    // the first item; a plain object appearing / vanishing is a field.
    if (Array.isArray(before) || Array.isArray(after)) {
        info.arrays += 1;
        return;
    }
    if (isComposite(after)) info.added.push(path);
    if (isComposite(before)) info.removed.push(path);
};

const getIn = (value: unknown, path: Path): unknown => {
    let cur: unknown = value;
    for (const step of path) {
        if (!isComposite(cur)) return undefined;
        cur = (cur as Record<string | number, unknown>)[step];
    }
    return cur;
};

/** Immutable set (undefined deletes an object key); shares every untouched branch. */
const setIn = <T>(value: T, path: Path, next: unknown): T => {
    if (path.length === 0) return next as T;
    const [head, ...rest] = path as [string | number, ...Path];
    if (Array.isArray(value)) {
        const copy = [...value];
        copy[head as number] = setIn(copy[head as number], rest, next);
        return copy as unknown as T;
    }
    const obj: Record<string, unknown> = isPlainObject(value) ? { ...value } : {};
    const child = setIn(obj[head as string], rest, next);
    if (child === undefined && rest.length === 0) delete obj[head as string];
    else obj[head as string] = child;
    return obj as T;
};

type LeafKind =
    | 'text'
    | 'textClear'
    | 'emptySource'
    | 'sharedData'
    | 'matchedValue'
    | 'structure'
    | 'other';

/**
 * The only values that may land in a text field that is EMPTY in the base
 * language while another language is edited: a link, an anchor or a colour —
 * shared by every language, never prose. Not the generic looksLikeData: typed
 * text starts out looking like data ('2' of '2025 बैच', 'n' of 'naya batch',
 * a lowercase brand name) and would leak into the base text keystroke by
 * keystroke. No whitespace, so prose that starts with '#' or '/' is not a link.
 */
const SHARED_VALUE_RE =
    /^(?:(?:https?:|mailto:|tel:|www\.|\/)\S*|#[\w-]+|(?:rgba?|hsla?|var)\([^)\s]*\)?)$/i;

const isBlank = (v: unknown): boolean =>
    v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** A string typed into a text field (as opposed to a link/anchor/colour picked into it). */
const isTypedText = (value: string, key: Key): boolean =>
    isTextKey(key) && value !== '' && !SHARED_VALUE_RE.test(value.trim());

/** Every typed-text string under `value` (same key inheritance and opaque keys as localizeDeep). */
const collectTypedText = (value: unknown, key: Key, out: string[] = [], itemOf?: Key): string[] => {
    if (isOpaqueKey(key)) return out;
    if (typeof value === 'string') {
        if (isTypedText(value, key)) out.push(value);
    } else if (Array.isArray(value)) {
        const childKey = childKeyOf(key);
        value.forEach((v) => collectTypedText(v, childKey, out, key));
    } else if (isPlainObject(value)) {
        for (const [k, v] of Object.entries(value)) {
            collectTypedText(v, objectChildKey(k, key, itemOf), out);
        }
    }
    return out;
};

/**
 * Keys whose value an admin TYPES to match real data: a course tag to filter
 * by (courseShowcase.tag, a stream tab's tag, tags) or a level name
 * (levelFilterValue). Retyped in another language it would be a translation
 * that matches nothing, in every language, since the value is shared. Inside
 * announcements[] and blocks[] a tag is copy (keyInItemOf) and never gets
 * here. Values picked from a list (a sort, a source, a button action, a blog
 * category) are not on it: choosing another option is a shared change any
 * language may make.
 */
const MATCHED_VALUE_KEY_RE = /^(?:tags?|.+(?:Tags?|_tags?|FilterValue))$/;

/**
 * Does this leaf change a typed match value? Whatever is typed, from the first
 * keystroke: every keystroke let through is stored, so refusing only prose
 * would leave the 'J' of 'JEE' (or the '2 y' of '2 year old') as the filter
 * for every language. A toggle under such a key (showTag) is not a value, and
 * blank to blank is no change.
 */
const changesMatchedValue = (key: Key, baseValue: unknown, after: unknown): boolean =>
    typeof key === 'string' &&
    MATCHED_VALUE_KEY_RE.test(key) &&
    (typeof baseValue === 'string' || typeof after === 'string') &&
    after !== baseValue &&
    !(isBlank(baseValue) && isBlank(after));

const classifyLeaf = (leaf: LeafChange, baseValue: unknown): LeafKind => {
    const { key, before, after } = leaf;
    if (isRenderKey(key)) {
        // A course grid's settings: its texts (card labels, Load more…) are
        // translated like any field, everything else in it is shared.
        const split = splitRenderEdit(baseValue, before, after);
        if (split.problem) return split.problem;
        return Object.keys(split.translations).length > 0 ? 'text' : 'other';
    }
    if (isOpaqueKey(key)) return 'other';
    const translatableBase =
        typeof before === 'string' &&
        typeof baseValue === 'string' &&
        isTextKey(key) &&
        !looksLikeData(baseValue);
    if (translatableBase) {
        if (typeof after === 'string') return 'text';
        if (after === undefined || after === null) return 'textClear';
    }
    if (!isTextKey(key)) {
        // Shared data goes to the base (a sort, a source, an action, an icon,
        // a link) — except a value typed to match real data, which another
        // language cannot change at all.
        return changesMatchedValue(key, baseValue, after) ? 'matchedValue' : 'other';
    }
    if (typeof after !== 'string') return 'other';
    // Typing into a field that is empty in the base language: there is no
    // base text to hang a translation on ("add the English text first").
    if (isBlank(baseValue)) return isTypedText(after, key) ? 'emptySource' : 'other';
    // Prose typed over a base value that is data (a code, a number): shared.
    if (typeof baseValue === 'string' && !looksLikeData(after)) return 'sharedData';
    return 'other';
};

/**
 * translation → source, to map copied translated text back to the base. Only
 * translations that belong to exactly ONE source: when two base texts share a
 * translation ('Course' and 'Courses' → 'कोर्स') there is no telling which one
 * a copy came from, so neither is guessed.
 */
export const reverseDictionary = (dict: TranslationDictionary | undefined): Map<string, string> => {
    const reverse = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const [source, translation] of Object.entries(dict || {})) {
        if (!translation || translation === source || ambiguous.has(translation)) continue;
        const known = reverse.get(translation);
        if (known === undefined) reverse.set(translation, source);
        else if (known !== source) {
            reverse.delete(translation);
            ambiguous.add(translation);
        }
    }
    return reverse;
};

const collectStrings = (value: unknown, out: Set<string>) => {
    if (typeof value === 'string') out.add(value);
    else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
    else if (isPlainObject(value)) Object.values(value).forEach((v) => collectStrings(v, out));
};

/**
 * Text the edit put into the base that was not there before and is a known
 * translation (a duplicated translated item, a type swap carrying a title) is
 * replaced by its base source. Text already in the base is never touched.
 */
const delocalizeIntroduced = <T>(
    oldBase: unknown,
    nextBase: T,
    reverse: Map<string, string>
): T => {
    if (reverse.size === 0) return nextBase;
    const existing = new Set<string>();
    collectStrings(oldBase, existing);
    const walk = (value: unknown, key: Key, itemOf?: Key): unknown => {
        if (typeof value === 'string') {
            return isTextKey(key) && !existing.has(value) && reverse.has(value)
                ? reverse.get(value)
                : value;
        }
        if (isOpaqueKey(key)) return value;
        if (Array.isArray(value)) {
            let changed = false;
            const childKey = childKeyOf(key);
            const out = value.map((v) => {
                const n = walk(v, childKey, key);
                if (n !== v) changed = true;
                return n;
            });
            return changed ? out : value;
        }
        if (isPlainObject(value)) {
            let changed = false;
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value)) {
                const n = walk(v, objectChildKey(k, key, itemOf));
                if (n !== v) changed = true;
                out[k] = n;
            }
            return changed ? out : value;
        }
        return value;
    };
    return walk(nextBase, undefined) as T;
};

/** Structural equality of two JSON-like values (the config is JSON). */
const sameValue = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        return (
            Array.isArray(a) &&
            Array.isArray(b) &&
            a.length === b.length &&
            a.every((v, i) => sameValue(v, b[i]))
        );
    }
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keys = Object.keys(a);
    return (
        keys.length === Object.keys(b).length &&
        keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]))
    );
};

const cloneJson = <V>(value: V): V => JSON.parse(JSON.stringify(value)) as V;

/**
 * The base item `item` (at position `i` of the edited list) is a copy of: the
 * base counterpart of the view item it equals. When several view items are
 * equal, the one at its own position wins, then the one just before it (a
 * duplicate is inserted right after its original); failing both, they must
 * all have the same base item. Otherwise (two base texts sharing one
 * translation, no telling which was copied) undefined: never guessed.
 */
const duplicatedBaseItem = (
    item: unknown,
    i: number,
    view: unknown[],
    baseArr: unknown[]
): unknown => {
    const matches: number[] = [];
    view.forEach((v, j) => {
        if (j < baseArr.length && isComposite(v) && isComposite(baseArr[j]) && sameValue(v, item))
            matches.push(j);
    });
    if (matches.length === 0) return undefined;
    if (matches.includes(i)) return baseArr[i];
    if (matches.includes(i - 1)) return baseArr[i - 1];
    const first = baseArr[matches[0]!];
    return matches.every((j) => sameValue(baseArr[j], first)) ? first : undefined;
};

/**
 * A duplicated item (a copy of an item the editor rendered: equal to it, but
 * not that object) is replaced by a copy of the matching BASE item, so the
 * copy carries the base text whatever its translation — even one shared by
 * several base texts, which the reverse dictionary cannot map back. Walks the
 * edit alongside the view and the base the way applyLocalizedEdit pairs them.
 */
const baseCopiesOfDuplicates = (
    base: unknown,
    view: unknown,
    edited: unknown,
    key: Key
): unknown => {
    if (edited === view || isOpaqueKey(key)) return edited;
    if (Array.isArray(edited) && Array.isArray(view)) {
        const baseArr = Array.isArray(base) ? base : [];
        const childKey = childKeyOf(key);
        let changed = false;
        const out = edited.map((item, i) => {
            if (view.includes(item)) return item; // kept as is: paired by identity
            if (isComposite(item)) {
                const source = duplicatedBaseItem(item, i, view, baseArr);
                if (source !== undefined) {
                    changed = true;
                    return cloneJson(source);
                }
            }
            // A modified item: compare it with the item that sat at its position.
            if (i < view.length && !edited.includes(view[i])) {
                const next = baseCopiesOfDuplicates(baseArr[i], view[i], item, childKey);
                if (next !== item) changed = true;
                return next;
            }
            return item;
        });
        return changed ? out : edited;
    }
    if (isPlainObject(edited) && isPlainObject(view)) {
        const baseObj = isPlainObject(base) ? base : {};
        let changed = false;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(edited)) {
            const next = baseCopiesOfDuplicates(baseObj[k], view[k], v, objectChildKey(k, key));
            if (next !== v) changed = true;
            out[k] = next;
        }
        return changed ? out : edited;
    }
    return edited;
};

/**
 * Splits one edit made in another language. `view` must be the exact object
 * the editor rendered from (items are matched by reference). Pure.
 */
export const decideLocalizedEdit = <T>(
    base: T,
    view: T,
    edited: T,
    reverse: Map<string, string> = new Map()
): LocalizedEditDecision<T> => {
    if (edited === view) return { kind: 'noop' };
    const leaves: LeafChange[] = [];
    const sameShape = diffShape(view, edited, undefined, [], leaves);

    if (!sameShape) {
        const info: StructureChanges = { arrays: 0, added: [], removed: [] };
        scanStructure(view, edited, undefined, [], info);
        if (info.arrays === 0) {
            // No item was added or removed: an object appeared or vanished
            // because a field was typed into or cleared (e.g. a highlight
            // phrase). New text there has no base source — whatever it looks
            // like, the first keystrokes of '2025 बैच' included; a vanishing
            // object would delete the base text for every language.
            const known = new Set<string>();
            collectStrings(base, known);
            const typesNewText = info.added.some((p) =>
                collectTypedText(getIn(edited, p), undefined).some(
                    (s) => !known.has(s) && !reverse.has(s)
                )
            );
            if (typesNewText) return { kind: 'blocked', reason: 'emptySource' };
            const removesText = info.removed.some(
                (p) => collectTranslatableStrings(getIn(base, p)).length > 0
            );
            if (removesText) return { kind: 'blocked', reason: 'structure' };
        }
        // Added / removed / reordered items: structure is shared. A structural
        // edit that ALSO rewrites translated text cannot be split safely.
        // Duplicated items take their base item's text first.
        const prepared = baseCopiesOfDuplicates(base, view, edited, undefined) as T;
        const result = applyLocalizedEdit(base, view, prepared);
        // Text typed into a course grid's settings along with the new item
        // has no base text: it would land in the base as is.
        if (result.problem) return { kind: 'blocked', reason: result.problem };
        if (Object.keys(result.translations).length > 0) return { kind: 'blocked', reason: 'bulk' };
        return {
            kind: 'commit',
            base: delocalizeIntroduced(base, result.base, reverse),
            translations: {},
        };
    }
    if (leaves.length === 0) return { kind: 'noop' };

    let normalized = edited;
    const classified = leaves.map((leaf) => {
        const baseValue = getIn(base, leaf.path);
        let kind = classifyLeaf(leaf, baseValue);
        if (kind === 'textClear') {
            // Emptying a translated field clears the translation — it must not
            // delete the base text the way `undefined` would.
            normalized = setIn(normalized, leaf.path, '');
            kind = 'text';
        }
        return { leaf, baseValue, kind };
    });

    // A typed match value is refused even when the edit changes other values
    // with it (a stream tab's URL key follows its tag while it is typed).
    if (classified.some((c) => c.kind === 'matchedValue')) {
        return { kind: 'blocked', reason: 'sharedData' };
    }
    // Text typed into a course grid's settings with no base text (or over a
    // data value), or a label entry removed there, never reaches the base,
    // whatever else the edit changes.
    const renderProblem = classified.find(
        (c) =>
            isRenderKey(c.leaf.key) &&
            (c.kind === 'emptySource' || c.kind === 'sharedData' || c.kind === 'structure')
    );
    if (renderProblem) {
        return { kind: 'blocked', reason: renderProblem.kind as LocalizedBlockReason };
    }

    if (classified.length === 1) {
        const only = classified[0]!;
        if (only.kind === 'emptySource') return { kind: 'blocked', reason: 'emptySource' };
        if (only.kind === 'sharedData') return { kind: 'blocked', reason: 'sharedData' };
    }

    const texts = classified.filter((c) => c.kind === 'text');
    if (texts.length > 0 && classified.length > 1) {
        // One action, several values. If the admin was looking at untranslated
        // (base) text everywhere it touches, it is just a base edit.
        if (texts.every((c) => c.leaf.before === c.baseValue)) {
            let nextBase = base;
            for (const c of classified) {
                // Settings in a translated `render` keep its base texts.
                const value =
                    isRenderKey(c.leaf.key) && c.kind === 'other'
                        ? splitRenderEdit(c.baseValue, c.leaf.before, c.leaf.after).render
                        : c.leaf.after;
                nextBase = setIn(nextBase, c.leaf.path, value);
            }
            return {
                kind: 'commit',
                base: delocalizeIntroduced(base, nextBase, reverse),
                translations: {},
            };
        }
        return { kind: 'blocked', reason: 'bulk' };
    }

    const result = applyLocalizedEdit(base, view, normalized);
    return { kind: 'commit', base: result.base, translations: result.translations };
};

/** Column children an edit carries back are the localized ones: put the base children back, by id. */
export const restoreSlotsFromBase = (editedSlots: unknown, baseSlots: unknown): unknown => {
    if (!Array.isArray(editedSlots)) return editedSlots;
    const byId = new Map<string, Component>();
    const collect = (slots: unknown) => {
        if (!Array.isArray(slots)) return;
        for (const slot of slots) {
            if (!Array.isArray(slot)) continue;
            for (const child of slot as Component[]) {
                if (child && typeof child.id === 'string') {
                    byId.set(child.id, child);
                    collect(child.props?.slots);
                }
            }
        }
    };
    collect(baseSlots);
    return editedSlots.map((slot: unknown) =>
        Array.isArray(slot)
            ? (slot as Component[]).map((child) =>
                  child && typeof child.id === 'string' && byId.has(child.id)
                      ? byId.get(child.id)!
                      : child
              )
            : slot
    );
};

/** A whole-section swap goes to the base: values carried over from the localized view revert to their base text. */
export const delocalizeSwapProps = (
    baseProps: Record<string, unknown>,
    viewProps: Record<string, unknown>,
    nextProps: Record<string, unknown>,
    reverse: Map<string, string>
): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(nextProps || {})) {
        out[k] = viewProps && k in viewProps && v === viewProps[k] ? baseProps?.[k] : v;
    }
    return delocalizeIntroduced(baseProps, out, reverse);
};

const findComponentIn = (
    config: CatalogueConfig | null,
    pageId: string,
    componentId: string
): Component | null => {
    const page = config?.pages?.find((p) => p.id === pageId);
    if (!page) return null;
    const find = (list: Component[]): Component | null => {
        for (const c of list || []) {
            if (c?.id === componentId) return c;
            if (Array.isArray(c?.props?.slots)) {
                for (const slot of c.props.slots as Component[][]) {
                    const hit = find(slot);
                    if (hit) return hit;
                }
            }
        }
        return null;
    };
    return find(page.components);
};

/* ── blocked-edit notices (read by the bar above the panel) ─────────── */

/** A refused edit rebuilds the property panel at most this often (see `refusals`). */
export const REFUSAL_RESYNC_MIN_MS = 400;

interface LocalizedEditNoticeState {
    notice: { id: number; reason: LocalizedBlockReason } | null;
    /**
     * Counts refused edits; the property panel is keyed by it. An editor that
     * keeps its own draft (the rich-text box, list drafts) still shows what
     * was typed after a refusal — the stored value never changed, so nothing
     * tells it to resync. Rebuilding the panel does. Clearing the notice
     * leaves it alone. Bumped at most once per REFUSAL_RESYNC_MIN_MS, so an
     * editor that writes from a mount effect cannot remount the panel forever.
     */
    refusals: number;
    lastRefusalAt: number;
    show: (reason: LocalizedBlockReason) => void;
    clear: () => void;
}

export const useLocalizedEditNotice = create<LocalizedEditNoticeState>((set) => ({
    notice: null,
    refusals: 0,
    lastRefusalAt: 0,
    show: (reason) =>
        set((s) => {
            const now = Date.now();
            const resync = now - s.lastRefusalAt >= REFUSAL_RESYNC_MIN_MS;
            return {
                notice: { id: (s.notice?.id ?? 0) + 1, reason },
                ...(resync ? { refusals: s.refusals + 1, lastRefusalAt: now } : {}),
            };
        }),
    clear: () => set({ notice: null }),
}));

/**
 * The key for the property panel: changes on a language flip (editors keep
 * state that belongs to one language) and after a refused edit (editors with
 * a local draft must show the stored text again).
 */
export const useLocalizedPanelKey = (locale: string | null): string => {
    const refusals = useLocalizedEditNotice((s) => s.refusals);
    return `${locale ?? 'base'}:${refusals}`;
};

export const localizedBlockMessage = (reason: LocalizedBlockReason, baseName: string): string => {
    switch (reason) {
        case 'emptySource':
            return `Add the ${baseName} text first. This has no ${baseName} text yet, so there is nothing to translate.`;
        case 'sharedData':
            return `This value (a code, number, link, tag or filter value) is shared by every language. Change it while editing ${baseName}.`;
        case 'structure':
            return `This would remove content from every language. Switch to ${baseName} to do it.`;
        default:
            return `This changes several texts at once. Switch to ${baseName} to do it, then translate the new texts.`;
    }
};

/* ── the hook ───────────────────────────────────────────────────────── */

type UpdateComponent = (pageId: string, componentId: string, updates: Partial<Component>) => void;
type UpdateGlobalSettings = (updates: Record<string, unknown>) => void;
type UpdatePageSeo = (pageId: string, seo: Page['seo']) => void;

export interface UseLocalizedEditingArgs {
    config: CatalogueConfig | null;
    editingLocale?: string | null;
    updateComponent: UpdateComponent;
    updateGlobalSettings: UpdateGlobalSettings;
    updatePageSeo: UpdatePageSeo;
    commitLocalizedEdit?: (edit: LocalizedEditCommit) => void;
    /**
     * Reads the store's config at edit time. An async committer (an editor
     * that writes after a network call, from a props ref) may fire after later
     * edits; its edit is then diffed against the latest state, whose localized
     * view is the very object a re-rendered editor holds (one view per config).
     * Without it, edits are diffed against this render's config.
     */
    getLatestConfig?: () => CatalogueConfig | null;
}

export interface LocalizedEditing {
    /** The non-base language being edited; null = base language (everything passes through). */
    locale: string | null;
    /** What editors render from: the localized view in another language. */
    config: CatalogueConfig | null;
    /** The shared base config (= config in the base language). */
    baseConfig: CatalogueConfig | null;
    updateComponent: UpdateComponent;
    /** Intercepts `layout` (the global header/footer) only; every other key is shared and passes through. */
    updateGlobalSettings: UpdateGlobalSettings;
    updatePageSeo: UpdatePageSeo;
}

const EMPTY_SEO: NonNullable<Page['seo']> = Object.freeze({}) as NonNullable<Page['seo']>;

export const useLocalizedEditing = ({
    config,
    editingLocale,
    updateComponent,
    updateGlobalSettings,
    updatePageSeo,
    commitLocalizedEdit,
    getLatestConfig,
}: UseLocalizedEditingArgs): LocalizedEditing => {
    const candidate = activeEditingLocale(config?.globalSettings?.i18n, editingLocale);
    const locale = candidate && config && commitLocalizedEdit ? candidate : null;

    const view = useMemo(
        () => (locale ? buildLocalizedView(config, locale) : config),
        [config, locale]
    );
    const dict = locale ? dictionaryForEditing(config, locale) : undefined;
    const renderReverse = useMemo(() => reverseDictionary(dict), [dict]);

    // The base / view / reverse dictionary an edit is diffed against.
    const current = useCallback(() => {
        const latest = (locale && getLatestConfig?.()) || config;
        if (latest === config || !locale) return { base: config, view, reverse: renderReverse };
        return {
            base: latest,
            view: buildLocalizedView(latest, locale),
            reverse: reverseDictionary(dictionaryForEditing(latest, locale)),
        };
    }, [locale, getLatestConfig, config, view, renderReverse]);

    const localizedUpdateComponent = useCallback<UpdateComponent>(
        (pageId, componentId, patch) => {
            if (!locale || !commitLocalizedEdit || !patch || patch.props === undefined) {
                updateComponent(pageId, componentId, patch);
                return;
            }
            const { base: baseConfig, view: viewConfig, reverse } = current();
            const baseComp = findComponentIn(baseConfig, pageId, componentId);
            const viewComp = findComponentIn(viewConfig, pageId, componentId);
            if (!baseComp || !viewComp) {
                updateComponent(pageId, componentId, patch);
                return;
            }
            if (patch.type !== undefined && patch.type !== baseComp.type) {
                commitLocalizedEdit({
                    locale,
                    component: {
                        pageId,
                        componentId,
                        updates: {
                            ...patch,
                            props: delocalizeSwapProps(
                                baseComp.props,
                                viewComp.props,
                                patch.props,
                                reverse
                            ),
                        },
                    },
                });
                return;
            }
            let edited = patch.props;
            if (Array.isArray(edited?.slots) && edited.slots !== viewComp.props?.slots) {
                edited = {
                    ...edited,
                    slots: restoreSlotsFromBase(edited.slots, baseComp.props?.slots),
                };
            }
            const decision = decideLocalizedEdit(baseComp.props, viewComp.props, edited, reverse);
            if (decision.kind === 'blocked') {
                useLocalizedEditNotice.getState().show(decision.reason);
                return;
            }
            const rest: Partial<Component> = { ...patch };
            delete rest.props;
            if (decision.kind === 'noop') {
                if (Object.keys(rest).length > 0) updateComponent(pageId, componentId, rest);
                return;
            }
            commitLocalizedEdit({
                locale,
                component: { pageId, componentId, updates: { ...rest, props: decision.base } },
                translations: decision.translations,
            });
        },
        [locale, commitLocalizedEdit, current, updateComponent]
    );

    const localizedUpdateGlobalSettings = useCallback<UpdateGlobalSettings>(
        (updates) => {
            if (
                !locale ||
                !commitLocalizedEdit ||
                !isPlainObject(updates) ||
                !isPlainObject(updates.layout)
            ) {
                updateGlobalSettings(updates);
                return;
            }
            const { layout, ...rest } = updates;
            const { base: baseConfig, view: viewConfig, reverse } = current();
            const baseLayout = (baseConfig?.globalSettings?.layout ?? {}) as Record<
                string,
                unknown
            >;
            const viewLayout = (viewConfig?.globalSettings?.layout ?? baseLayout) as Record<
                string,
                unknown
            >;
            const decision = decideLocalizedEdit(
                baseLayout,
                viewLayout,
                layout as Record<string, unknown>,
                reverse
            );
            if (decision.kind === 'blocked') {
                useLocalizedEditNotice.getState().show(decision.reason);
                return;
            }
            if (decision.kind === 'noop') {
                if (Object.keys(rest).length > 0) updateGlobalSettings(rest);
                return;
            }
            commitLocalizedEdit({
                locale,
                globalSettings: { ...rest, layout: decision.base },
                translations: decision.translations,
            });
        },
        [locale, commitLocalizedEdit, current, updateGlobalSettings]
    );

    const localizedUpdatePageSeo = useCallback<UpdatePageSeo>(
        (pageId, seo) => {
            const { base: baseConfig, view: viewConfig, reverse } = current();
            const basePage = baseConfig?.pages?.find((p) => p.id === pageId);
            const viewPage = viewConfig?.pages?.find((p) => p.id === pageId);
            if (!locale || !commitLocalizedEdit || !basePage || !viewPage) {
                updatePageSeo(pageId, seo);
                return;
            }
            const baseSeo = basePage.seo ?? EMPTY_SEO;
            const viewSeo = viewPage.seo ?? baseSeo;
            const decision = decideLocalizedEdit(
                baseSeo,
                viewSeo,
                { ...viewSeo, ...(seo || {}) },
                reverse
            );
            if (decision.kind === 'blocked') {
                useLocalizedEditNotice.getState().show(decision.reason);
                return;
            }
            if (decision.kind === 'noop') return;
            commitLocalizedEdit({
                locale,
                pageSeo: { pageId, seo: decision.base },
                translations: decision.translations,
            });
        },
        [locale, commitLocalizedEdit, current, updatePageSeo]
    );

    if (!locale) {
        return {
            locale: null,
            config,
            baseConfig: config,
            updateComponent,
            updateGlobalSettings,
            updatePageSeo,
        };
    }
    return {
        locale,
        config: view,
        baseConfig: config,
        updateComponent: localizedUpdateComponent,
        updateGlobalSettings: localizedUpdateGlobalSettings,
        updatePageSeo: localizedUpdatePageSeo,
    };
};
