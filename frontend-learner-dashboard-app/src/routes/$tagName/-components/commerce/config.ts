/**
 * globalSettings.commerce of a hosted site: what the shop needs that is not served by the
 * public API. Pure, and tolerant of anything: a missing or
 * malformed value takes its default, and a site without the block has no shop at all.
 *
 * Shipping charges, the free-delivery amount and COD rules are NOT here: they come from the
 * server through /cart/price.
 */

export type CommerceImageRatio = '1:1' | '4:5' | '3:4';

/**
 * Named looks a shop can wear (theme/commerce.css: .cmx-preset-<name>). A preset sets the shop's
 * colour tokens and default fonts; the site's own palette still drives everything outside the shop.
 */
export const COMMERCE_THEME_PRESETS = ['heritage'] as const;
export type CommerceThemePreset = (typeof COMMERCE_THEME_PRESETS)[number];

/** Default display and text fonts of each preset, used when the site names none. */
const PRESET_FONTS: Record<CommerceThemePreset, { display: string; text: string }> = {
    heritage: { display: 'Laila', text: 'Mukta' },
};

/** A strip above the shop pages (an offer, a delivery note), shown only between its dates. */
export interface CommerceAnnouncement {
    text: string;
    /** Site-relative address it links to ("policies/shipping"); "" for plain text. */
    route: string;
    startDate: string;
    endDate: string;
}

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

/** One chip of the category bar when a site names them itself ("सब" → shop, "₹999 तक उपहार" → c/gifts-under-999). */
export interface CommerceCategoryBarItem {
    label: string;
    /** Site-relative address ("shop", "c/<slug>"). */
    route: string;
}

/**
 * The category bar in the site header (globalSettings.commerce.categoryBar). Off unless a site
 * sets enabled: true; then it shows on the listed pages only, never on the buying pages.
 */
export interface CommerceCategoryBar {
    /** Page keys: "home", an authored page's route ("shop"), or a fixed route ("collection", "product", "search", "cart", "scan"). */
    pages: string[];
    /**
     * "tabs" = underlined text links (the shop's in-page bar); "chips" = pills; "image" = a round
     * photo of each category with its name under it at the top of the page, folding into the
     * chip row once the page scrolls (a category without a photo shows as a chip).
     */
    style: 'chips' | 'tabs' | 'image';
    /**
     * With style "image": the page keys that open the photo row; the bar's other pages show the
     * chip row only (a product page keeps its buy button high). null = every page of the bar.
     */
    imagePages: string[] | null;
    /** "auto" = the menu categories; otherwise the site's own list. */
    items: 'auto' | CommerceCategoryBarItem[];
    /** A leading "All" chip that opens the shop page. */
    showAll: boolean;
    /** Phones and tablets: the logo row folds away on scroll-down; the bar stays. */
    collapseHeaderOnScroll: boolean;
}

/** Pages that never show the category bar, whatever the site lists: the shopper stays on the form. */
export const CATEGORY_BAR_NEVER = ['checkout', 'order', 'track', 'track-order', 'account'] as const;

export const DEFAULT_CATEGORY_BAR_PAGES = ['home', 'shop', 'collection', 'search', 'product'];

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
        /** "" = the site's own palette. */
        preset: CommerceThemePreset | '';
    };
    /** Strip above the shop's fixed pages; authored pages place a commerceAnnouncementBar instead. */
    announcement: CommerceAnnouncement | null;
    /** A floating WhatsApp button on the shop's fixed pages (never on checkout). */
    floatingWhatsApp: boolean;
    /** The category bar in the site header; null = off (the default). */
    categoryBar: CommerceCategoryBar | null;
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

const PAGE_KEY = /^[a-z0-9][a-z0-9-]{0,59}$/;

const parseCategoryBar = (value: unknown): CommerceCategoryBar | null => {
    if (!isRecord(value) || value.enabled !== true) return null;
    const pages = Array.isArray(value.pages)
        ? value.pages.map((p) => text(p, 60).toLowerCase()).filter((p) => PAGE_KEY.test(p))
        : DEFAULT_CATEGORY_BAR_PAGES;
    const items = Array.isArray(value.items)
        ? value.items
              .filter(isRecord)
              .map((item) => ({ label: text(item.label, 60), route: text(item.route, 120).replace(/^\/+/, '') }))
              .filter((item) => item.label && item.route && !/^[a-z][a-z0-9+.-]*:/i.test(item.route))
              .slice(0, 16)
        : [];
    return {
        pages: Array.from(new Set(pages)),
        style: value.style === 'chips' || value.style === 'image' ? value.style : 'tabs',
        imagePages: Array.isArray(value.imagePages)
            ? Array.from(new Set(value.imagePages.map((p) => text(p, 60).toLowerCase()).filter((p) => PAGE_KEY.test(p))))
            : null,
        items: items.length > 0 ? items : 'auto',
        showAll: value.showAll === true,
        collapseHeaderOnScroll: value.collapseHeaderOnScroll === true,
    };
};

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
    theme: { imageRatio: '4:5', displayFont: '', textFont: '', preset: '' },
    announcement: null,
    floatingWhatsApp: false,
    categoryBar: null,
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
    const presetName = text(theme.preset, 20).toLowerCase();
    const preset = (COMMERCE_THEME_PRESETS as readonly string[]).includes(presetName) ? (presetName as CommerceThemePreset) : '';
    const announcement = isRecord(raw.announcement) ? raw.announcement : null;
    const announcementText = announcement ? text(announcement.text, 200) : '';
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
            displayFont: text(fonts.display, 60) || (preset ? PRESET_FONTS[preset].display : ''),
            textFont: text(fonts.text, 60) || (preset ? PRESET_FONTS[preset].text : ''),
            preset,
        },
        announcement:
            announcement && announcementText
                ? {
                      text: announcementText,
                      route: text(announcement.route, 120),
                      startDate: text(announcement.startDate, 30),
                      endDate: text(announcement.endDate, 30),
                  }
                : null,
        floatingWhatsApp: raw.floatingWhatsApp === true,
        categoryBar: parseCategoryBar(raw.categoryBar),
        templates,
        checkout: raw.checkout === true,
        redirects: raw.redirects === true,
        pageSize: Number.isInteger(pageSize) && pageSize >= 4 && pageSize <= 48 ? pageSize : DEFAULT_PAGE_SIZE,
    };
};

/** The one question the route files and the header ask before loading the shop's code. */
export const isCommerceEnabled = (globalSettings: unknown): boolean =>
    parseCommerceConfig(globalSettings).enabled;

/**
 * True when the site's category bar shows on this page ("home", "shop", "collection"…). Never on
 * the buying pages, never on a site whose shop is off.
 */
export const categoryBarOn = (config: Pick<CommerceConfig, 'enabled' | 'categoryBar'>, pageKey: string | null | undefined): boolean => {
    const key = (pageKey || '').toLowerCase();
    if (!config.enabled || !config.categoryBar || !key) return false;
    if ((CATEGORY_BAR_NEVER as readonly string[]).includes(key)) return false;
    return config.categoryBar.pages.includes(key);
};

/**
 * True when the bar on this page opens its photo row: style "image", the bar on here, and the
 * page among imagePages when the site lists them. Elsewhere an "image" bar is the chip row.
 */
export const categoryBarPhotosOn = (config: Pick<CommerceConfig, 'enabled' | 'categoryBar'>, pageKey: string | null | undefined): boolean => {
    const bar = config.categoryBar;
    if (!bar || bar.style !== 'image' || !categoryBarOn(config, pageKey)) return false;
    return bar.imagePages === null || bar.imagePages.includes((pageKey || '').toLowerCase());
};

/** Listings keep Filter·Sort pinned under the header (templates.collection.stickyToolbar). Off by default. */
export const stickyListingToolbar = (config: Pick<CommerceConfig, 'templates'>): boolean =>
    config.templates.collection?.stickyToolbar === true;

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
