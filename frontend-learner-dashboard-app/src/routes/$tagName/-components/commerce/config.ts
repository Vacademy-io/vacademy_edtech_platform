/**
 * globalSettings.commerce of a hosted site: what the shop needs that is not served by the
 * public API. Pure, and tolerant of anything: a missing or
 * malformed value takes its default, and a site without the block has no shop at all.
 *
 * Shipping charges, the free-delivery amount and COD rules are NOT here: they come from the
 * server through /cart/price.
 */

export type CommerceImageRatio = '1:1' | '4:5' | '3:4';

export interface CommerceReassuranceItem {
    icon: string;
    label: string;
    text: string;
    /** Authored page that holds the full policy ("policies/returns"). */
    route: string;
}

export interface CommerceTemplateSwitches {
    [section: string]: boolean;
}

export interface CommerceConfig {
    enabled: boolean;
    /** Publishable Catalogue API key (vak_pub_...). Meant to be visible in page source. */
    publishableKey: string;
    /** Languages the shop offers; the first is the base language when the site names none. */
    locales: string[];
    baseLocale: string | null;
    whatsappNumber: string;
    dispatchPromise: string;
    reassurance: CommerceReassuranceItem[];
    /** Preset lengths for goods sold by length, in whole units (metres). */
    lengthPresets: number[];
    popularSearches: string[];
    /** A category shows in the menu only with at least this many products in stock. */
    minInStock: number;
    media: { leadTag: string; tagLabels: Record<string, string> };
    theme: {
        imageRatio: CommerceImageRatio;
        displayFont: string;
        textFont: string;
    };
    /** Per template, sections switched off ({ product: { pincode: false } }). */
    templates: Record<string, CommerceTemplateSwitches>;
    /** The checkout pages exist for this site (a later package turns it on). */
    checkout: boolean;
    /** The site has old-site redirects (site_redirect rows); the edge asks the resolver only then. */
    redirects: boolean;
    pageSize: number;
}

const KEY_SHAPE = /^vak_pub_[0-9a-f]{48}$/;
const LOCALE_SHAPE = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown, max = 400): string =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const locale = (value: unknown): string | null => {
    const raw = text(value, 20).replace('_', '-').toLowerCase();
    return LOCALE_SHAPE.test(raw) ? raw : null;
};

const RATIOS: CommerceImageRatio[] = ['1:1', '4:5', '3:4'];

export const DEFAULT_COMMERCE_LOCALES = ['hi', 'en'];
export const DEFAULT_PAGE_SIZE = 24;

const disabled = (): CommerceConfig => ({
    enabled: false,
    publishableKey: '',
    locales: DEFAULT_COMMERCE_LOCALES,
    baseLocale: null,
    whatsappNumber: '',
    dispatchPromise: '',
    reassurance: [],
    lengthPresets: [],
    popularSearches: [],
    minInStock: 0,
    media: { leadTag: '', tagLabels: {} },
    theme: { imageRatio: '4:5', displayFont: '', textFont: '' },
    templates: {},
    checkout: false,
    redirects: false,
    pageSize: DEFAULT_PAGE_SIZE,
});

/** The shop block of a site's global settings, or a disabled config when there is none. */
export const parseCommerceConfig = (globalSettings: unknown): CommerceConfig => {
    const raw = isRecord(globalSettings) ? globalSettings.commerce : undefined;
    if (!isRecord(raw)) return disabled();
    const publishableKey = text(raw.publishableKey, 80);
    const keyOk = KEY_SHAPE.test(publishableKey);
    const locales = list(raw.locales)
        .map(locale)
        .filter((l): l is string => !!l);
    const media = isRecord(raw.media) ? raw.media : {};
    const theme = isRecord(raw.theme) ? raw.theme : {};
    const fonts = isRecord(theme.fonts) ? theme.fonts : {};
    const ratio = text(theme.imageRatio, 5) as CommerceImageRatio;
    const tagLabels: Record<string, string> = {};
    if (isRecord(media.tagLabels)) {
        for (const [tag, label] of Object.entries(media.tagLabels)) {
            if (text(label, 60)) tagLabels[tag.toUpperCase()] = text(label, 60);
        }
    }
    const templates: Record<string, CommerceTemplateSwitches> = {};
    if (isRecord(raw.templates)) {
        for (const [name, switches] of Object.entries(raw.templates)) {
            if (!isRecord(switches)) continue;
            const out: CommerceTemplateSwitches = {};
            for (const [section, on] of Object.entries(switches)) {
                if (typeof on === 'boolean') out[section] = on;
            }
            templates[name] = out;
        }
    }
    const pageSize = Number(raw.pageSize);
    const minInStock = Number(raw.minInStock);
    return {
        // A shop without a usable key cannot call the API, so it is off, not half on.
        enabled: raw.enabled === true && keyOk,
        publishableKey: keyOk ? publishableKey : '',
        locales: locales.length ? Array.from(new Set(locales)) : DEFAULT_COMMERCE_LOCALES,
        baseLocale: locale(raw.baseLocale),
        whatsappNumber: text(raw.whatsappNumber, 20).replace(/[^\d+]/g, ''),
        dispatchPromise: text(raw.dispatchPromise, 200),
        reassurance: list(raw.reassurance)
            .filter(isRecord)
            .map((item) => ({
                icon: text(item.icon, 40),
                label: text(item.label, 80),
                text: text(item.text, 600),
                route: text(item.route, 120),
            }))
            .filter((item) => item.label)
            .slice(0, 6),
        lengthPresets: list(raw.lengthPresets)
            .map(Number)
            .filter((n) => Number.isFinite(n) && n > 0 && n <= 1000)
            .slice(0, 8),
        popularSearches: list(raw.popularSearches)
            .map((s) => text(s, 40))
            .filter(Boolean)
            .slice(0, 8),
        minInStock: Number.isInteger(minInStock) && minInStock >= 0 && minInStock <= 1000 ? minInStock : 0,
        media: { leadTag: text(media.leadTag, 40).toUpperCase(), tagLabels },
        theme: {
            imageRatio: RATIOS.includes(ratio) ? ratio : '4:5',
            displayFont: text(fonts.display, 60),
            textFont: text(fonts.text, 60),
        },
        templates,
        checkout: raw.checkout === true,
        redirects: raw.redirects === true,
        pageSize: Number.isInteger(pageSize) && pageSize >= 4 && pageSize <= 48 ? pageSize : DEFAULT_PAGE_SIZE,
    };
};

/** The one question the route files and the header ask before loading the shop's code. */
export const isCommerceEnabled = (globalSettings: unknown): boolean =>
    parseCommerceConfig(globalSettings).enabled;

/** Built-in sections of a template in order, minus the ones the site switched off. */
export const templateSections = <T extends string>(
    config: Pick<CommerceConfig, 'templates'>,
    template: string,
    builtIn: readonly T[]
): T[] => {
    const switches = config.templates[template] || {};
    return builtIn.filter((section) => switches[section] !== false);
};

/**
 * The shop's languages and the one a visitor gets: ?lang= when offered, then the remembered
 * choice, then the base language. The base is the site's own (globalSettings.i18n.defaultLocale,
 * which the API also uses for the bare path), then commerce.baseLocale, then Hindi.
 */
export const resolveCommerceLocale = (opts: {
    config: Pick<CommerceConfig, 'locales' | 'baseLocale'>;
    siteDefaultLocale?: string | null;
    urlLocale?: string | null;
    storedLocale?: string | null;
}): { locale: string; baseLocale: string; locales: string[] } => {
    const baseLocale = locale(opts.siteDefaultLocale) || opts.config.baseLocale || opts.config.locales[0] || 'hi';
    const locales = Array.from(new Set([baseLocale, ...opts.config.locales]));
    for (const candidate of [opts.urlLocale, opts.storedLocale]) {
        const wanted = locale(candidate);
        if (wanted && locales.includes(wanted)) return { locale: wanted, baseLocale, locales };
    }
    return { locale: baseLocale, baseLocale, locales };
};
