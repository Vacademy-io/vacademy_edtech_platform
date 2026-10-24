/**
 * Site content languages for catalogue (website-builder) sites — SHARED between
 * the admin page-builder and the learner renderer (kept byte-identical by
 * scripts/check-style-engine-sync.mjs). Pure: no imports, no React.
 *
 * MODEL: a site is authored in ONE base language (its JSON props, unchanged).
 * Every other language is a DICTIONARY in globalSettings.i18n.strings:
 *
 *     { hi: { "Learn the Indian way of learning.": "सीखने का भारतीय तरीका।" } }
 *
 * keyed by the base-language source string. At render time every component's
 * props are walked and each text value with a translation is swapped
 * (localizeDeep); anything untranslated falls back to the base text, so a
 * half-translated site never shows blanks.
 *
 * WHY A DICTIONARY, NOT A PER-COMPONENT COPY: the site's structure (sections,
 * items, links, colours, toggles) is shared by every language, so adding,
 * removing or reordering an item in the base language needs no second edit,
 * and live data that never lives in the page JSON (course names, folder names)
 * is translated by the very same table. The cost: one source string has one
 * translation per language, which is the right default for a website.
 *
 * The builder's Hindi editing mode goes through applyLocalizedEdit, which
 * routes text edits into the dictionary and every other edit into the shared
 * base props — so none of the per-component editors needs to know about it.
 */

export interface CatalogueLocale {
    /** BCP-47-ish code: 'en', 'hi', 'mr'… */
    code: string;
    /** What the switcher shows: 'EN', 'हिन्दी'. */
    label: string;
}

export interface CatalogueI18nSettings {
    /** Shows the language switcher and honours ?lang=. Off = single-language site. */
    enabled?: boolean;
    /** The language the site is authored in. Defaults to 'en'. */
    defaultLocale?: string;
    /** Languages offered, base language included. */
    locales?: CatalogueLocale[];
    /** locale → (base-language source string → translation). */
    strings?: Record<string, Record<string, string>>;
}

export type TranslationDictionary = Record<string, string>;

/** The URL parameter that carries the visitor's language (?lang=hi). */
export const LOCALE_PARAM = 'lang';

const DEFAULT_LOCALES: CatalogueLocale[] = [
    { code: 'en', label: 'EN' },
    { code: 'hi', label: 'हिन्दी' },
];

/* ── which strings are text ─────────────────────────────────────────── */

/** Keys whose string values are never prose: ids, links, colours, enums… */
const NON_TEXT_KEYS = new Set(
    [
        'id', 'type', 'variant', 'layout', 'align', 'alignment', 'size', 'scale', 'position', 'icon',
        'font', 'route', 'url', 'href', 'link', 'target', 'src', 'image', 'logo', 'avatar', 'video',
        'poster', 'email', 'phone', 'whatsapp', 'color', 'action', 'code', 'slug', 'tag', 'tags',
        'currency', 'css', 'html_css', 'prompt', 'preset', 'shape', 'pattern', 'mode', 'sort', 'field',
        'fields', 'source', 'status', 'format', 'locale', 'lang', 'width', 'height', 'fit', 'ratio',
        'aspect', 'easing', 'direction', 'orientation', 'kind', 'param', 'op', 'key', 'ref', 'columns',
        'gap', 'radius', 'platform', 'display', 'tile', 'anchor', 'date', 'compactness', 'audience',
        'provider', 'transition', 'padding', 'margin', 'version', 'category', 'tone', 'speed', 'weight',
        // Looked up by exact value (FEATURE_ICON_MAP[iconName]), or the cached name of a
        // picked campaign, library or product page: shown in the builder (a learning
        // path's fallback title puts productPageName through siteT itself).
        'iconname', 'audiencename', 'gateaudiencename', 'libraryname', 'productpagename',
        // Enum tokens (badges.types: 'bestseller', 'new'…) and the prefix of
        // detail-block anchor ids ('fees-'): never shown as text.
        'types', 'anchorprefix',
        // Course level names a customFilters option matches by ('eBook', 'Short Film'):
        // looked up raw, in every language.
        'levels',
        // A source 'tags' filter group's tag prefix ('for') and skipped tags: matched raw.
        'prefix', 'exclude',
        // The same in every language: a title shown in its own script
        // (spotlight titleNative), the sidebar's group order (legacy ids such
        // as 'priceRange') and a CTA rule's course-format keys.
        'titlenative', 'order', 'formats',
        // Course level / tag names the courses filter is ordered by: matched raw.
        'levelorder', 'tagorder',
    ].map((k) => k.toLowerCase())
);

/**
 * Keys that are data in general but visitor-facing copy inside the items of
 * one list: an announcement's 'tag' is the pill it shows ('News') and a
 * detail block's 'tag' its eyebrow ('Flagship Program'), while
 * courseShowcase.tag or streams.items[].tag name a course tag to filter by.
 * List key → those keys.
 */
const TEXT_KEYS_IN_ITEMS_OF = new Map<string, ReadonlySet<string>>([
    ['announcements', new Set(['tag'])],
    ['blocks', new Set(['tag'])],
]);

/**
 * Text keys whose NAME looks like data (a suffix rule would catch them) but
 * whose value is visitor-facing copy — e.g. the mega menu's 'Explore {stream}'.
 */
const TEXT_KEY_EXCEPTIONS = new Set(['ctalabelpattern', 'categoriesheading'].map((k) => k.toLowerCase()));

/**
 * Maps whose every value is visitor-facing copy, whatever its key: format
 * labels ({ video: 'Video', animation: 'Animation' }), CTA labels, sort notes
 * and per-course descriptions. Their keys are format, sort or package ids that
 * would otherwise be judged as names ('video' is a link-like key,
 * 'animation' an opaque one).
 */
const TEXT_MAP_KEYS = new Set(['formatlabels', 'ctalabels', 'sortlabels', 'descriptions']);

/**
 * Keys whose whole VALUE is configuration, never shown as text — not even the
 * strings nested inside it (a style object, a visibility rule whose 'true'
 * must not become 'सत्य', nested slot sections that are localized on their own).
 */
const OPAQUE_KEYS = new Set(
    ['style', 'styles', 'showcondition', 'visiblewhen', 'animation', 'motion', 'slots', 'slot', 'render', 'theme', 'decorations', 'decoration'].map((k) =>
        k.toLowerCase()
    )
);

/** camelCase / snake_case endings that mark a non-text key (backgroundColor, productPageCode, image_url, defaultSort…). */
const NON_TEXT_SUFFIX =
    /(Id|Ids|Url|URL|Uri|Href|Route|Routes|Color|Colour|Code|Src|Slug|Slugs|Key|Css|Class|ClassName|Image|Images|Logo|Icon|Font|Mode|Type|Style|Layout|Align|Position|Width|Widths|Height|Size|Variant|Target|Action|Email|Phone|Date|Time|Pattern|Preset|Shape|Animation|Ratio|Fit|Format|Currency|Locale|Lang|Tag|Tags|Param|Path|Sort|Tone|Speed|Scale|Radius|Effect|Fr|Fields|Value|Weight|Family|Platform|Category|Anchor|Display|Padding|Margin|Gap|Columns)$|_(id|ids|url|uri|href|route|color|colour|code|src|slug|slugs|key|css|class|image|logo|icon|font|mode|type|style|layout|align|date|time|currency|locale|lang|tag|tags|path|sort|value|fields|category)$/;

/** Is a string stored under `key` prose (worth translating)? */
export const isTextKey = (key: string | number | undefined): boolean => {
    if (key === undefined || typeof key === 'number') return true; // array items inherit their parent's verdict
    if (TEXT_KEY_EXCEPTIONS.has(key.toLowerCase())) return true;
    if (NON_TEXT_KEYS.has(key.toLowerCase())) return false;
    if (OPAQUE_KEYS.has(key.toLowerCase())) return false;
    if (NON_TEXT_SUFFIX.test(key)) return false;
    return true;
};

/**
 * The key a value is judged by when it sits under `key` in an ITEM of the
 * list stored under `itemOf` (announcements[0].tag: key 'tag', itemOf
 * 'announcements'). A key that is copy only there reads as plain text —
 * undefined, the verdict a text list passes to its items; any other key
 * stays itself. Every walker below (and the builder's) resolves object keys
 * through this, so the renderer, the collector and the editor always agree.
 */
export const keyInItemOf = (key: string, itemOf: string | number | undefined): string | undefined =>
    typeof itemOf === 'string' && TEXT_KEYS_IN_ITEMS_OF.get(itemOf.toLowerCase())?.has(key.toLowerCase())
        ? undefined
        : key;

/**
 * The key a value stored under `k` of an object is judged by. `parentKey` is
 * the object's own key, `itemOf` the list the object is an item of. Children
 * of a text map (formatLabels…) are plain text; everything else goes through
 * keyInItemOf. Every walker resolves object keys through this.
 */
export const objectChildKey = (
    k: string,
    parentKey: string | number | undefined,
    itemOf?: string | number
): string | undefined =>
    typeof parentKey === 'string' && TEXT_MAP_KEYS.has(parentKey.toLowerCase())
        ? undefined
        : keyInItemOf(k, itemOf);

/** A course grid's `render` settings: opaque, except for the texts listed in RENDER_TEXTS. */
export const isRenderKey = (key: string | number | undefined): boolean =>
    typeof key === 'string' && key.toLowerCase() === 'render';

/** A value under `key` that must be left exactly as is, nested strings included. */
const isOpaqueKey = (key: string | number | undefined): boolean =>
    typeof key === 'string' && OPAQUE_KEYS.has(key.toLowerCase());

/**
 * Values that are never prose even under a text key: links, colours, pure
 * numbers/prices, and lowercase code tokens ('email', 'package_name', 'true',
 * 'grid') — the shape enum values and form field names take, while real copy
 * starts with a capital, has spaces or is not Latin.
 */
export const looksLikeData = (s: string): boolean => {
    const t = s.trim();
    if (!t) return true;
    // Only placeholders ('{price}', '{{count}}'): filled in by the site.
    if (/^(\{\{?\s*[\w.]+\s*\}?\})+$/.test(t)) return true;
    if (/^(https?:|mailto:|tel:|data:|\/\/|\/|#[0-9a-f]{3,8}$|rgba?\(|hsla?\(|var\()/i.test(t)) return true;
    if (/^[a-z0-9]+([-_.][a-z0-9]+)*$/.test(t)) return true;
    return /^[\d\s.,:;%+\-–—/×x*₹$€£¥()]+$/.test(t);
};

/** Should this string, stored under `key`, ever be translated? */
const isTranslatable = (s: string, key: string | number | undefined): boolean => isTextKey(key) && !looksLikeData(s);

/* ── settings helpers ───────────────────────────────────────────────── */

export const baseLocaleOf = (settings: CatalogueI18nSettings | undefined | null): string =>
    (settings?.defaultLocale || 'en').toLowerCase();

/** Languages the switcher offers; always includes the base language first. */
export const localesOf = (settings: CatalogueI18nSettings | undefined | null): CatalogueLocale[] => {
    const base = baseLocaleOf(settings);
    const list = settings?.locales?.length ? settings.locales : DEFAULT_LOCALES;
    const cleaned = list
        .filter((l) => l && typeof l.code === 'string' && l.code.trim())
        .map((l) => ({ code: l.code.trim().toLowerCase(), label: (l.label || l.code).trim() }));
    const seen = new Set<string>();
    const out: CatalogueLocale[] = [];
    const baseEntry = cleaned.find((l) => l.code === base) || { code: base, label: base.toUpperCase() };
    for (const l of [baseEntry, ...cleaned]) {
        if (seen.has(l.code)) continue;
        seen.add(l.code);
        out.push(l);
    }
    return out;
};

/**
 * The language to render: an explicit ?lang= wins, then the visitor's remembered
 * choice, then the site's base language. Unknown codes and disabled sites
 * always resolve to the base language.
 */
export const resolveSiteLocale = (opts: {
    settings: CatalogueI18nSettings | undefined | null;
    urlLocale?: string | null;
    storedLocale?: string | null;
}): string => {
    const base = baseLocaleOf(opts.settings);
    if (!opts.settings?.enabled) return base;
    const allowed = new Set(localesOf(opts.settings).map((l) => l.code));
    for (const candidate of [opts.urlLocale, opts.storedLocale]) {
        const c = (candidate || '').trim().toLowerCase();
        if (c && allowed.has(c)) return c;
    }
    return base;
};

/** The dictionary for `locale`, or undefined when rendering the base language. */
export const dictionaryFor = (
    settings: CatalogueI18nSettings | undefined | null,
    locale: string
): TranslationDictionary | undefined => {
    if (!settings?.enabled) return undefined;
    if (locale === baseLocaleOf(settings)) return undefined;
    const dict = settings.strings?.[locale];
    return dict && Object.keys(dict).length ? dict : undefined;
};

/* ── rendering ──────────────────────────────────────────────────────── */

/** One string through the dictionary; untranslated (or missing) text comes back unchanged. */
export const translateText = (text: string, dict: TranslationDictionary | undefined): string => {
    if (!dict || !text) return text;
    const exact = dict[text];
    if (typeof exact === 'string' && exact !== '') return exact;
    const trimmed = text.trim();
    if (trimmed !== text) {
        const t = dict[trimmed];
        if (typeof t === 'string' && t !== '') return text.replace(trimmed, t);
    }
    return text;
};

/**
 * Walks props and swaps every translated text value. Returns the SAME
 * reference wherever nothing changed (whole tree included), so memoised
 * children and reference-equality checks keep working. `itemOf`: the key of
 * the list `value` is an item of (see keyInItemOf).
 */
export const localizeDeep = <T>(
    value: T,
    dict: TranslationDictionary | undefined,
    key?: string | number,
    itemOf?: string | number
): T => {
    if (!dict) return value;
    if (isOpaqueKey(key)) return value;
    if (typeof value === 'string') {
        if (!isTranslatable(value, key)) return value;
        return translateText(value, dict) as unknown as T;
    }
    if (Array.isArray(value)) {
        let changed = false;
        const out = value.map((item) => {
            const next = localizeDeep(item, dict, typeof key === 'string' && !isTextKey(key) ? key : undefined, key);
            if (next !== item) changed = true;
            return next;
        });
        return (changed ? out : value) as unknown as T;
    }
    if (value && typeof value === 'object') {
        let changed = false;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const next = localizeDeep(v, dict, objectChildKey(k, key, itemOf));
            if (next !== v) changed = true;
            out[k] = next;
        }
        return (changed ? out : value) as T;
    }
    return value;
};

type TextPath = (string | number)[];

/**
 * Calls `visit` with every translatable string under `value` and where it sits
 * (keys and indexes from `value`). The renderer, the collector and the editor
 * judge the same strings: opaque keys are skipped, keys resolve through
 * objectChildKey.
 */
export const visitTranslatableStrings = (
    value: unknown,
    visit: (text: string, path: TextPath) => void,
    key?: string | number,
    itemOf?: string | number,
    path: TextPath = []
): void => {
    if (isOpaqueKey(key)) return;
    if (typeof value === 'string') {
        if (isTranslatable(value, key)) visit(value, path);
        return;
    }
    if (Array.isArray(value)) {
        const inherited = typeof key === 'string' && !isTextKey(key) ? key : undefined;
        value.forEach((item, i) =>
            visitTranslatableStrings(item, visit, inherited, key, [...path, i])
        );
        return;
    }
    if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            visitTranslatableStrings(v, visit, objectChildKey(k, key, itemOf), undefined, [
                ...path,
                k,
            ]);
        }
    }
};

/** Every distinct translatable string under `value`, in first-seen order (for AI translation and coverage). */
export const collectTranslatableStrings = (
    value: unknown,
    out: string[] = [],
    seen = new Set<string>(),
    key?: string | number,
    itemOf?: string | number
): string[] => {
    visitTranslatableStrings(
        value,
        (text) => {
            if (seen.has(text)) return;
            seen.add(text);
            out.push(text);
        },
        key,
        itemOf
    );
    return out;
};

/* ── texts inside a catalogue's opaque `render` ─────────────────────── */

/**
 * `render` (a course grid's card, pagination and grid-heading settings) stays
 * opaque to localizeDeep: the site shows these few texts through its
 * dictionary itself. They are listed here so the builder can still collect,
 * show and translate them. Map entries (formatLabels.video) are one text each.
 */
const RENDER_TEXTS: Array<{ path: string[]; map?: boolean }> = [
    { path: ['card', 'formatLabels'], map: true },
    { path: ['card', 'ctaLabels'], map: true },
    { path: ['card', 'freeLabel'] },
    { path: ['card', 'descriptions'], map: true },
    { path: ['pagination', 'loadMoreLabel'] },
    { path: ['pagination', 'countLabel'] },
    { path: ['gridHeading', 'title'] },
    { path: ['gridHeading', 'sortLabels'], map: true },
];

const valueAt = (value: unknown, path: TextPath): unknown => {
    let cur = value;
    for (const step of path) {
        if (!cur || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string | number, unknown>)[step];
    }
    return cur;
};

/** Immutable set; `undefined` deletes the key. Creates objects on the way. */
const withValueAt = (value: unknown, path: TextPath, next: unknown): unknown => {
    if (path.length === 0) return next;
    const [head, ...rest] = path as [string | number, ...TextPath];
    const obj: Record<string | number, unknown> =
        value && typeof value === 'object' && !Array.isArray(value)
            ? { ...(value as Record<string, unknown>) }
            : {};
    const child = withValueAt(obj[head], rest, next);
    if (child === undefined) delete obj[head];
    else obj[head] = child;
    return obj;
};

/** A text of `render`; `entry` marks one entry of a map (formatLabels.video). */
type RenderText = { path: string[]; text: string; entry?: boolean };

/** Every string (translatable or not) at a text position of `render`. */
const renderStrings = (render: unknown): RenderText[] => {
    const out: RenderText[] = [];
    for (const { path, map } of RENDER_TEXTS) {
        const value = valueAt(render, path);
        if (map) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                if (typeof v === 'string') out.push({ path: [...path, k], text: v, entry: true });
            }
        } else if (typeof value === 'string') {
            out.push({ path, text: value });
        }
    }
    return out;
};

/** The translatable texts of a course grid's `render` (card labels, Load more, grid heading), with their paths. */
export const renderTextEntries = (render: unknown): Array<{ path: string[]; text: string }> =>
    renderStrings(render)
        .filter((e) => isTranslatable(e.text, undefined))
        .map(({ path, text }) => ({ path, text }));

/** `render` with its texts translated; the same reference when nothing changes. */
export const localizeRenderTexts = <T>(render: T, dict: TranslationDictionary | undefined): T => {
    if (!dict) return render;
    let out: unknown = render;
    for (const { path, text } of renderTextEntries(render)) {
        const shown = translateText(text, dict);
        if (shown !== text) out = withValueAt(out, path, shown);
    }
    return out as T;
};

export type RenderEditProblem = 'emptySource' | 'sharedData' | 'structure';

/**
 * Splits an edit of `render` made in another language (see applyLocalizedEdit):
 * a changed text becomes a translation of its base text, which stays; every
 * other setting is applied as edited. `problem` names an edit the dictionary
 * cannot hold (text typed where the base has none, prose over a data value, a
 * map entry removed — its text is a dictionary key other fields share, and
 * the entry is gone in every language); the builder refuses those.
 */
export const splitRenderEdit = (
    base: unknown,
    localized: unknown,
    edited: unknown
): { render: unknown; translations: Record<string, string>; problem?: RenderEditProblem } => {
    const translations: Record<string, string> = {};
    if (!edited || typeof edited !== 'object') return { render: edited, translations };
    let problem: RenderEditProblem | undefined;
    let render: unknown = edited;
    const put = (path: string[], value: unknown) => {
        if (valueAt(render, path) !== value) render = withValueAt(render, path, value);
    };
    const paths = new Map<string, RenderText>();
    for (const value of [base, localized, edited]) {
        for (const text of renderStrings(value)) paths.set(text.path.join('\u0000'), text);
    }
    for (const { path, entry } of paths.values()) {
        const after = valueAt(edited, path);
        const before = valueAt(localized, path);
        const baseText = valueAt(base, path);
        if (after === before) {
            put(path, baseText);
        } else if (entry && after === undefined && typeof baseText === 'string') {
            problem = 'structure';
        } else if (typeof baseText === 'string' && isTranslatable(baseText, undefined)) {
            translations[baseText] = typeof after === 'string' && after !== baseText ? after : '';
            put(path, baseText);
        } else if (typeof after === 'string' && after.trim()) {
            if (typeof baseText !== 'string' || !baseText.trim()) problem = 'emptySource';
            else if (!looksLikeData(after)) problem = 'sharedData';
        }
    }
    return { render, translations, problem };
};

/** How much of `sources` has a translation in `dict`. */
export const translationCoverage = (
    sources: string[],
    dict: TranslationDictionary | undefined
): { total: number; translated: number; missing: string[] } => {
    const missing = sources.filter((s) => !dict || !dict[s]);
    return { total: sources.length, translated: sources.length - missing.length, missing };
};

/* ── editing in a non-base language ─────────────────────────────────── */

export interface LocalizedEditResult<T> {
    /** The base-language props to store (text untouched; structure/toggles from the edit). */
    base: T;
    /** Dictionary changes: source → translation ('' = remove the translation). */
    translations: Record<string, string>;
    /** Set when a course grid's `render` edit cannot be split (see splitRenderEdit): do not save it. */
    problem?: RenderEditProblem;
}

/**
 * The builder's non-base-language editing mode. The admin edits `localized`
 * (= localizeDeep(base, dict)) through the ordinary per-component editors,
 * which hand back `edited`. This splits that edit:
 *
 *  - a text value that existed in the base (same position) → a dictionary
 *    entry for its base source; the base text stays as it was;
 *  - anything else (toggles, colours, links, a NEW item, a removed or
 *    reordered item) → applied to the base, shared by every language.
 *
 * Items are matched by reference first (unchanged items keep their identity
 * through the editors' spread/filter/splice), then by position.
 */
export const applyLocalizedEdit = <T>(base: T, localized: T, edited: T): LocalizedEditResult<T> => {
    const translations: Record<string, string> = {};
    let problem: RenderEditProblem | undefined;

    const rebuild = (
        b: unknown,
        before: unknown,
        after: unknown,
        key?: string | number,
        itemOf?: string | number
    ): unknown => {
        if (after === before) return b === undefined ? after : b;
        if (isRenderKey(key)) {
            const split = splitRenderEdit(b, before, after);
            Object.assign(translations, split.translations);
            problem = problem ?? split.problem;
            return split.render;
        }
        if (isOpaqueKey(key)) return after;
        if (typeof after === 'string') {
            if (typeof before === 'string' && typeof b === 'string' && isTranslatable(b, key)) {
                translations[b] = after === b ? '' : after;
                return b;
            }
            return after;
        }
        if (Array.isArray(after)) {
            const bArr = Array.isArray(b) ? b : [];
            const beforeArr = Array.isArray(before) ? before : [];
            const childKey = typeof key === 'string' && !isTextKey(key) ? key : undefined;
            return after.map((item, i) => {
                const j = beforeArr.indexOf(item);
                if (j >= 0) return j < bArr.length ? bArr[j] : item;
                // A modified item: pair it with the item that sat at the same
                // position, unless that one survived elsewhere in the list.
                if (i < beforeArr.length && !after.includes(beforeArr[i])) {
                    return rebuild(bArr[i], beforeArr[i], item, childKey, key);
                }
                return item;
            });
        }
        if (after && typeof after === 'object') {
            const bObj = b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
            const beforeObj =
                before && typeof before === 'object' && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(after as Record<string, unknown>)) {
                out[k] = rebuild(bObj[k], beforeObj[k], v, objectChildKey(k, key, itemOf));
            }
            return out;
        }
        return after;
    };

    const next = rebuild(base, localized, edited) as T;
    return problem ? { base: next, translations, problem } : { base: next, translations };
};

/** Applies translation changes from applyLocalizedEdit ('' removes an entry). */
export const mergeTranslations = (
    dict: TranslationDictionary | undefined,
    changes: Record<string, string>
): TranslationDictionary => {
    const next: TranslationDictionary = { ...(dict || {}) };
    for (const [source, value] of Object.entries(changes)) {
        if (!value || value === source) delete next[source];
        else next[source] = value;
    }
    return next;
};
