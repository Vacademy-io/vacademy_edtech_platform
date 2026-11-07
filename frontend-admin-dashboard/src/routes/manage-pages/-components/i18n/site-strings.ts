/**
 * What a site's languages have to cover — pure helpers shared by the
 * Languages card, the Translations panel and the publish checks.
 *
 * Authored text = every translatable string a visitor can see in the page
 * sections (column children and a course grid's card texts included), page
 * titles and SEO, the global header/footer and the site settings the public
 * site translates (course languages and formats, catalogue words, intro
 * captions, WhatsApp, Course Finder, lead popup). It is exactly the set the
 * learner localizes, so "100%" means the whole page reads in that language.
 */
import {
    localesOf,
    mergeTranslations,
    renderTextEntries,
    translationCoverage,
    visitTranslatableStrings,
    type CatalogueLocale,
    type TranslationDictionary,
} from '../../-utils/catalogue-i18n';
import type { CatalogueConfig, Component } from '../../-types/editor-types';
import { effectiveCourseLanguages } from '../settings/course-languages';
import { componentLabel } from '../../-utils/component-labels';
import { LOCALE_LABELS } from '@/i18n/locales';

type SiteConfig =
    | Pick<CatalogueConfig, 'pages' | 'globalSettings' | 'introPage'>
    | null
    | undefined;

/** What a language is called in the builder: its own name ('English', 'हिन्दी'). */
export const languageName = (code: string, fallbackLabel?: string): string =>
    (LOCALE_LABELS as Record<string, string>)[code] || fallbackLabel || code.toUpperCase();

/**
 * Props whose values look like text but are never shown to visitors: the
 * cached name of a picked lead campaign or folder library (the site uses the
 * id) and icon identifiers ('GraduationCap' — the renderer looks the icon up
 * by that exact name, so a translation would remove the icon). The shared
 * classifier (catalogue-i18n isTextKey) still calls them text, so they are
 * left out of coverage, the publish check and AI translation here.
 */
const INTERNAL_TEXT_KEYS = new Set(['audienceName', 'gateAudienceName', 'libraryName', 'iconName']);

/** `value` without the internal keys, at any depth (shares untouched branches). */
const withoutInternalKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        let changed = false;
        const out = value.map((v) => {
            const next = withoutInternalKeys(v);
            if (next !== v) changed = true;
            return next;
        });
        return changed ? out : value;
    }
    if (value && typeof value === 'object') {
        let changed = false;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (INTERNAL_TEXT_KEYS.has(k)) {
                changed = true;
                continue;
            }
            const next = withoutInternalKeys(v);
            if (next !== v) changed = true;
            out[k] = next;
        }
        return changed ? out : value;
    }
    return value;
};

/**
 * A contact form's props without its field names: the keys answers are
 * submitted under. The site shows each field's label only and submits under
 * the authored name in every language, so a name ('fullName', 'City') is
 * never read by a visitor. Names stay text elsewhere (team members, plans).
 */
const withoutFieldNames = (c: Component): unknown => {
    const fields = c.props.fields;
    if (c.type !== 'contactForm' || !Array.isArray(fields)) return c.props;
    return {
        ...c.props,
        fields: fields.map((f: unknown) =>
            f && typeof f === 'object' && !Array.isArray(f) && 'name' in f
                ? Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'name'))
                : f
        ),
    };
};

/** Where a text of the site is shown, for the Translations panel. */
export interface SiteStringLocation {
    area: 'header' | 'footer' | 'page' | 'pageTitle' | 'seo' | 'settings';
    /** The page's title (or route): page, pageTitle and seo texts. */
    page?: string;
    /** The section's name ('Course Catalog', or 'CTA Banner #2' when a page has several). */
    section?: string;
    /** A course grid's card text: what it is, named by the panel ('Format label'). */
    cardText?: CardTextKind;
    /** The field inside the section or the settings ('hero › stats #2 › label'); with cardText, its key ('video'). */
    field?: string;
}

export type CardTextKind =
    | 'formatLabel'
    | 'buttonLabel'
    | 'freeLabel'
    | 'courseDescription'
    | 'loadMore'
    | 'courseCount'
    | 'gridHeading'
    | 'sortLabel';

export interface SiteString {
    text: string;
    /** The first place the text is shown. */
    location: SiteStringLocation;
}

type AddText = (text: string, location: SiteStringLocation) => void;

/** Prop keys and list positions as one readable field name: ['stats', 1, 'label'] → 'stats #2 › label'. */
const fieldName = (path: (string | number)[]): string =>
    path
        .reduce<string[]>((parts, step) => {
            if (typeof step === 'number' && parts.length > 0) {
                parts[parts.length - 1] = `${parts[parts.length - 1]} #${step + 1}`;
            } else {
                parts.push(String(step));
            }
            return parts;
        }, [])
        .join(' › ');

/** The texts of a course grid's `render` (see renderTextEntries), by path. */
const CARD_TEXT_KINDS: Record<string, CardTextKind> = {
    'card.formatLabels': 'formatLabel',
    'card.ctaLabels': 'buttonLabel',
    'card.freeLabel': 'freeLabel',
    'card.descriptions': 'courseDescription',
    'pagination.loadMoreLabel': 'loadMore',
    'pagination.countLabel': 'courseCount',
    'gridHeading.title': 'gridHeading',
    'gridHeading.sortLabels': 'sortLabel',
};

/** Where a card text sits, in words: { cardText: 'formatLabel', field: 'video' }. Course ids are left out. */
const cardTextLocation = (path: string[]): Pick<SiteStringLocation, 'cardText' | 'field'> => {
    const cardText = CARD_TEXT_KINDS[path.slice(0, 2).join('.')];
    if (!cardText) return { field: fieldName(path) };
    const key = path[2];
    return key && cardText !== 'courseDescription' ? { cardText, field: key } : { cardText };
};

const visitComponent = (
    c: Component | null | undefined,
    add: AddText,
    where: SiteStringLocation,
    includeHidden = false,
    section = componentLabel(c?.type ?? '')
): void => {
    if (!c || typeof c !== 'object' || (c.enabled === false && !includeHidden)) return;
    if (!c.props || typeof c.props !== 'object') return;
    visitTranslatableStrings(withoutInternalKeys(withoutFieldNames(c)), (text, path) =>
        add(text, { ...where, section, field: fieldName(path) })
    );
    // A course grid's card labels, Load more and grid heading sit under the
    // opaque `render`; the site still shows them through the dictionary.
    for (const { path, text } of renderTextEntries(c.props.render)) {
        add(text, { ...where, section, ...cardTextLocation(path) });
    }
    // Column children sit under the opaque `slots` key: walk them as sections.
    const slots = c.props.slots;
    if (Array.isArray(slots)) {
        for (const slot of slots) {
            if (!Array.isArray(slot)) continue;
            for (const child of slot) {
                visitComponent(child as Component, add, where, includeHidden);
            }
        }
    }
};

/**
 * Site-settings texts the public site translates at display time (WhatsApp
 * button, Course Finder step labels, intro screen and lead popup labels).
 * Only label-like keys are read — never `value`, which is submitted data.
 */
const SETTINGS_TEXT_KEYS = new Set(['label', 'caption', 'message', 'placeholder', 'title']);
const collectSettingsTexts = (node: unknown, add: AddText, field: string, depth = 0): void => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) {
        for (const item of node) collectSettingsTexts(item, add, field, depth + 1);
        return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (typeof v === 'string') {
            if (SETTINGS_TEXT_KEYS.has(k) && v.trim()) add(v, { area: 'settings', field });
        } else {
            collectSettingsTexts(v, add, field, depth + 1);
        }
    }
};

/**
 * One text the site shows through its dictionary as is (a page title, a
 * language chip, a slide caption), stored trimmed: the learner looks a
 * text up exactly and then trimmed, so the trimmed key serves both. Blanks,
 * links and bare numbers are skipped.
 */
const pushShownText = (value: unknown, add: AddText, location: SiteStringLocation): void => {
    if (typeof value !== 'string') return;
    const text = value.trim();
    if (!text) return;
    if (/^(https?:|mailto:|tel:|\/\/|www\.)/i.test(text)) return;
    if (/^[\d\s.,:;%+\-–—/×x*₹$€£¥()]+$/.test(text)) return;
    add(text, location);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

export interface CollectOptions {
    /**
     * Also the texts the site does not show right now: hidden sections,
     * unpublished page titles and switched-off settings (WhatsApp, Course
     * Finder…). Their translations are parked, not unused — they come back
     * with the section or setting.
     */
    includeHidden?: boolean;
}

/** Distinct translatable texts of the site in reading order (header, pages, footer, settings), each with where it is first shown. Hidden sections are skipped unless `includeHidden`. */
export const collectSiteStringEntries = (
    config: SiteConfig,
    { includeHidden = false }: CollectOptions = {}
): SiteString[] => {
    const out: SiteString[] = [];
    const seen = new Set<string>();
    const add: AddText = (text, location) => {
        if (seen.has(text)) return;
        seen.add(text);
        out.push({ text, location });
    };
    if (!config) return out;
    const gs = config.globalSettings as Record<string, any> | undefined;
    const layout = gs?.layout;
    const shown = (enabled: unknown) => includeHidden || !!enabled;
    visitComponent(layout?.header, add, { area: 'header' }, includeHidden);
    for (const page of config.pages || []) {
        const name = page?.title?.trim() || page?.route || page?.id;
        // The title band of a page and the header's site search show the
        // title of every published page.
        if (page && (page.published !== false || includeHidden)) {
            pushShownText(page.title, add, { area: 'pageTitle', page: name });
        }
        // A page with three CTA Banners names them 'CTA Banner #1', '#2', '#3'.
        const sections = (page?.components || []).filter(
            (c) => c && (includeHidden || c.enabled !== false)
        );
        const labels = sections.map((c) => componentLabel(c.type));
        const seenLabels = new Map<string, number>();
        sections.forEach((c, i) => {
            const label = labels[i]!;
            const n = (seenLabels.get(label) ?? 0) + 1;
            seenLabels.set(label, n);
            const repeated = labels.indexOf(label) !== labels.lastIndexOf(label);
            visitComponent(
                c,
                add,
                { area: 'page', page: name },
                includeHidden,
                repeated ? `${label} #${n}` : label
            );
        });
        if (page?.seo) {
            visitTranslatableStrings(page.seo, (text, path) =>
                add(text, { area: 'seo', page: name, field: fieldName(path) })
            );
        }
    }
    visitComponent(layout?.footer, add, { area: 'footer' }, includeHidden);
    // Course language names and chips: the language filter, card chips,
    // course page picker and cart lines (the built-in English / Hindi pair
    // when the site keeps no list of its own).
    if (shown(gs?.courseLanguages?.enabled)) {
        for (const lang of effectiveCourseLanguages(gs?.courseLanguages)) {
            const field = 'courseLanguages';
            pushShownText(lang?.label, add, { area: 'settings', field });
            pushShownText(lang?.chip, add, { area: 'settings', field });
        }
    }
    // Course formats: the Format filter, the card's format pill and a
    // learning path's step formats show each label through the dictionary.
    // Their levels and tags are matched raw and stay out.
    if (isRecord(gs?.courseFormats)) {
        for (const [key, format] of Object.entries(gs.courseFormats)) {
            if (isRecord(format)) {
                pushShownText(format.label, add, {
                    area: 'settings',
                    field: `courseFormats › ${key}`,
                });
            }
        }
    }
    // The catalogue's own words for a course and its filters ('Format').
    if (isRecord(gs?.naming)) {
        for (const [key, word] of Object.entries(gs.naming)) {
            pushShownText(word, add, { area: 'settings', field: `naming › ${key}` });
        }
    }
    if (shown(gs?.whatsapp?.enabled !== false)) collectSettingsTexts(gs?.whatsapp, add, 'whatsapp');
    const stepLabels = gs?.courseFinder?.stepLabels;
    if (shown(gs?.courseFinder?.enabled) && stepLabels) {
        for (const [key, v] of Object.entries(stepLabels)) {
            if (typeof v === 'string' && v.trim()) {
                add(v, { area: 'settings', field: `courseFinder › ${key}` });
            }
        }
    }
    // The intro screen lives at the top of the config (the learner reads
    // catalogue.introPage); only its slide captions are translated there —
    // its buttons show the app's own labels.
    const intro = config.introPage ?? gs?.introPage;
    if (shown(intro?.enabled) && Array.isArray(intro?.imageSlider?.images)) {
        for (const image of intro.imageSlider.images) {
            pushShownText(image?.caption, add, { area: 'settings', field: 'introPage' });
        }
    }
    if (shown(gs?.leadCollection?.enabled)) {
        collectSettingsTexts(gs?.leadCollection?.fields, add, 'leadCollection');
    }
    return out;
};

/** Distinct translatable texts of the site, in reading order (header, pages, footer). Hidden sections are skipped unless `includeHidden`. */
export const collectSiteStrings = (config: SiteConfig, options?: CollectOptions): string[] =>
    collectSiteStringEntries(config, options).map((entry) => entry.text);

export interface Coverage {
    total: number;
    translated: number;
    missing: string[];
    /** Rounded DOWN, so 99.6% never reads as done. */
    percent: number;
}

export const coverageOf = (
    sources: string[],
    dict: TranslationDictionary | undefined
): Coverage => {
    const c = translationCoverage(sources, dict);
    return { ...c, percent: c.total ? Math.floor((c.translated / c.total) * 100) : 100 };
};

export interface LocaleCoverage extends CatalogueLocale, Coverage {}

/** Coverage of the site's authored text for every offered language except the base. */
export const siteCoverage = (config: SiteConfig): LocaleCoverage[] => {
    const i18n = config?.globalSettings?.i18n;
    const sources = collectSiteStrings(config);
    return localesOf(i18n)
        .slice(1)
        .map((locale) => ({ ...locale, ...coverageOf(sources, i18n?.strings?.[locale.code]) }));
};

/**
 * "Same as the base language" (a brand name, 'NEET'): stored as an identity
 * entry. translateText renders it unchanged and translationCoverage counts it
 * as translated, so it stops showing up as missing. (mergeTranslations drops
 * identity values, so this is written directly.)
 */
export const keepAsBase = (
    dict: TranslationDictionary | undefined,
    sources: string[]
): TranslationDictionary => {
    const next: TranslationDictionary = { ...(dict || {}) };
    for (const s of sources) next[s] = s;
    return next;
};

export const isKeptAsBase = (dict: TranslationDictionary | undefined, source: string): boolean =>
    !!dict && dict[source] === source;

/** One inline edit: '' (or the base text itself) removes the entry. */
export const setTranslation = (
    dict: TranslationDictionary | undefined,
    source: string,
    value: string
): TranslationDictionary => mergeTranslations(dict, { [source]: value });

/**
 * Merges AI results. Results equal to their source are not stored (they would
 * read as "kept" without anyone deciding so) — they come back in `unchanged`
 * for the admin to confirm.
 */
export const mergeAiTranslations = (
    dict: TranslationDictionary | undefined,
    results: Record<string, string>
): { dict: TranslationDictionary; unchanged: string[] } => {
    const changes: Record<string, string> = {};
    const unchanged: string[] = [];
    for (const [source, value] of Object.entries(results || {})) {
        if (typeof value !== 'string' || !value.trim()) continue;
        if (value === source) unchanged.push(source);
        else changes[source] = value;
    }
    return { dict: mergeTranslations(dict, changes), unchanged };
};

export interface BatchLimits {
    /** Strings per request. */
    maxItems: number;
    /** Characters per request. */
    maxChars: number;
    /** A string this long goes in a request of its own. */
    longChars: number;
    /** Longer than this is not sent at all (whole pasted pages): translate by hand. */
    maxStringChars: number;
}

export const DEFAULT_BATCH_LIMITS: BatchLimits = {
    maxItems: 40,
    maxChars: 6000,
    longChars: 3000,
    maxStringChars: 30000,
};

/** Splits texts into AI requests that stay well inside the endpoint's limits and the browser timeout. */
export const batchForTranslation = (
    sources: string[],
    limits: BatchLimits = DEFAULT_BATCH_LIMITS
): { batches: string[][]; tooLong: string[] } => {
    const batches: string[][] = [];
    const tooLong: string[] = [];
    let current: string[] = [];
    let chars = 0;
    for (const s of sources) {
        if (s.length > limits.maxStringChars) {
            tooLong.push(s);
            continue;
        }
        if (s.length >= limits.longChars) {
            batches.push([s]);
            continue;
        }
        if (
            current.length > 0 &&
            (current.length >= limits.maxItems || chars + s.length > limits.maxChars)
        ) {
            batches.push(current);
            current = [];
            chars = 0;
        }
        current.push(s);
        chars += s.length;
    }
    if (current.length > 0) batches.push(current);
    return { batches, tooLong };
};
