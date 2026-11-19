import { describe, expect, it } from 'vitest';
import { categoryBarOn, categoryBarPhotosOn, isCommerceEnabled, parseCommerceConfig, resolveCommerceLocale, stickyListingToolbar, templateSections } from './config';

const KEY = `vak_pub_${'a1'.repeat(24)}`;

describe('parseCommerceConfig', () => {
    it('is off for a site without the block, and for anything that is not an object', () => {
        for (const settings of [undefined, null, {}, { commerce: null }, { commerce: 'yes' }, { commerce: [] }, 'x', 7]) {
            expect(isCommerceEnabled(settings)).toBe(false);
        }
    });

    it('is off without a usable publishable key, even when enabled is true', () => {
        expect(isCommerceEnabled({ commerce: { enabled: true } })).toBe(false);
        expect(isCommerceEnabled({ commerce: { enabled: true, publishableKey: 'vak_pub_short' } })).toBe(false);
        expect(isCommerceEnabled({ commerce: { enabled: true, publishableKey: `vak_sec_${'a1'.repeat(24)}` } })).toBe(false);
        expect(isCommerceEnabled({ commerce: { enabled: 'true', publishableKey: KEY } })).toBe(false);
        expect(isCommerceEnabled({ commerce: { enabled: true, publishableKey: KEY } })).toBe(true);
    });

    it('takes defaults for missing values', () => {
        const config = parseCommerceConfig({ commerce: { enabled: true, publishableKey: KEY } });
        expect(config.locales).toEqual(['hi', 'en']);
        expect(config.theme.imageRatio).toBe('4:5');
        expect(config.pageSize).toBe(24);
        expect(config.checkout).toBe(false);
        expect(config.redirects).toBe(false);
        expect(config.reassurance).toEqual([]);
        // The server's default per-order maximum.
        expect(config.maxOrderQuantity).toBe(25);
    });

    it('reads the per-order maximum within the server bounds', () => {
        const read = (maxOrderQuantity: unknown) => parseCommerceConfig({ commerce: { enabled: true, publishableKey: KEY, maxOrderQuantity } }).maxOrderQuantity;
        expect(read(40)).toBe(40);
        expect(read(10000)).toBe(10000);
        for (const bad of [0, -3, 2.5, 10001, 'many', null]) expect(read(bad), String(bad)).toBe(25);
    });

    it('reads what a seller sets and drops what is malformed', () => {
        const config = parseCommerceConfig({
            commerce: {
                enabled: true,
                publishableKey: KEY,
                locales: ['HI', 'en', 'not a locale', 5],
                whatsappNumber: '+91 98765-43210',
                lengthPresets: [1, 2.5, -1, 'x', 5000],
                popularSearches: ['saree', '', 3],
                minInStock: 4,
                media: { leadTag: 'real', tagLabels: { render: 'Styled render', empty: '' } },
                theme: { imageRatio: '16:9', fonts: { display: 'Laila', text: 'Mukta' } },
                templates: { product: { pincode: false, gallery: 'no' }, bad: 3 },
                reassurance: [{ label: 'Ships in 2 days', text: 'T', route: 'policies/shipping' }, { text: 'no label' }, 'x'],
                pageSize: 500,
                redirects: true,
            },
        });
        expect(config.locales).toEqual(['hi', 'en']);
        expect(config.whatsappNumber).toBe('+919876543210');
        expect(config.lengthPresets).toEqual([1, 2.5]);
        expect(config.popularSearches).toEqual(['saree']);
        expect(config.minInStock).toBe(4);
        expect(config.media).toEqual({ leadTag: 'REAL', tagLabels: { RENDER: 'Styled render' } });
        expect(config.theme).toEqual({ imageRatio: '4:5', displayFont: 'Laila', textFont: 'Mukta', preset: '' });
        expect(config.templates).toEqual({ product: { pincode: false } });
        expect(config.reassurance).toHaveLength(1);
        expect(config.pageSize).toBe(24);
        expect(config.redirects).toBe(true);
    });
});

describe('templateSections', () => {
    it('keeps the built-in order and drops only what is switched off', () => {
        const builtIn = ['gallery', 'title', 'pincode', 'accordions'] as const;
        expect(templateSections({ templates: {} }, 'product', builtIn)).toEqual([...builtIn]);
        expect(templateSections({ templates: { product: { pincode: false, title: true } } }, 'product', builtIn)).toEqual([
            'gallery',
            'title',
            'accordions',
        ]);
        expect(templateSections({ templates: { collection: { gallery: false } } }, 'product', builtIn)).toEqual([...builtIn]);
    });
});

describe('resolveCommerceLocale', () => {
    const config = { locales: ['hi', 'en'], baseLocale: null };

    it('defaults to Hindi', () => {
        expect(resolveCommerceLocale({ config })).toEqual({ locale: 'hi', baseLocale: 'hi', locales: ['hi', 'en'] });
    });

    it('prefers ?lang=, then the remembered choice, then the base language', () => {
        expect(resolveCommerceLocale({ config, urlLocale: 'en', storedLocale: 'hi' }).locale).toBe('en');
        expect(resolveCommerceLocale({ config, storedLocale: 'en' }).locale).toBe('en');
        expect(resolveCommerceLocale({ config, urlLocale: 'EN' }).locale).toBe('en');
    });

    it('ignores a language the shop does not offer', () => {
        expect(resolveCommerceLocale({ config, urlLocale: 'fr', storedLocale: 'de' }).locale).toBe('hi');
        expect(resolveCommerceLocale({ config, urlLocale: '<x>' }).locale).toBe('hi');
    });

    it("takes the site's base language first, so the bare path is the language the API serves there", () => {
        const out = resolveCommerceLocale({ config, siteDefaultLocale: 'en' });
        expect(out.baseLocale).toBe('en');
        expect(out.locale).toBe('en');
        expect(out.locales).toEqual(['en', 'hi']);
        expect(resolveCommerceLocale({ config: { locales: ['hi', 'en'], baseLocale: 'en' } }).baseLocale).toBe('en');
    });
});

describe('theme preset, announcement and floating WhatsApp', () => {
    const KEY_OK = `vak_pub_${'ab'.repeat(24)}`;
    const shop = (extra: Record<string, unknown>) => parseCommerceConfig({ commerce: { enabled: true, publishableKey: KEY_OK, ...extra } });

    it('takes a known preset and its default fonts, keeping fonts the site names', () => {
        expect(shop({ theme: { preset: 'Heritage' } }).theme).toMatchObject({ preset: 'heritage', displayFont: 'Laila', textFont: 'Mukta' });
        expect(shop({ theme: { preset: 'heritage', fonts: { display: 'Tiro Devanagari Hindi' } } }).theme).toMatchObject({
            displayFont: 'Tiro Devanagari Hindi',
            textFont: 'Mukta',
        });
    });

    it('ignores an unknown preset and adds no fonts', () => {
        expect(shop({ theme: { preset: 'neon' } }).theme).toMatchObject({ preset: '', displayFont: '', textFont: '' });
        expect(shop({}).theme.preset).toBe('');
    });

    it('reads the announcement only when it has text', () => {
        expect(shop({ announcement: { text: ' Free delivery above ₹999 ', route: 'policies', endDate: '2026-12-31' } }).announcement).toEqual({
            text: 'Free delivery above ₹999',
            route: 'policies',
            startDate: '',
            endDate: '2026-12-31',
        });
        expect(shop({ announcement: { route: 'policies' } }).announcement).toBeNull();
        expect(shop({ announcement: 'text' }).announcement).toBeNull();
    });

    it('shows the floating WhatsApp button only when switched on', () => {
        expect(shop({ floatingWhatsApp: true }).floatingWhatsApp).toBe(true);
        expect(shop({ floatingWhatsApp: 'yes' }).floatingWhatsApp).toBe(false);
        expect(parseCommerceConfig({}).floatingWhatsApp).toBe(false);
    });
});

describe('the category bar setting (commerce.categoryBar)', () => {
    const shop = (categoryBar: unknown, extra: Record<string, unknown> = {}) =>
        parseCommerceConfig({ commerce: { enabled: true, publishableKey: KEY, categoryBar, ...extra } });

    it('is off by default, and off unless enabled is exactly true', () => {
        expect(parseCommerceConfig({ commerce: { enabled: true, publishableKey: KEY } }).categoryBar).toBeNull();
        for (const value of [undefined, null, true, 'yes', [], {}, { enabled: 'true' }, { enabled: 1 }]) {
            expect(shop(value).categoryBar).toBeNull();
        }
        expect(categoryBarOn(shop(undefined), 'home')).toBe(false);
    });

    it('takes the pages, style, items, All chip and fold, and defaults the rest', () => {
        const bar = shop({ enabled: true }).categoryBar!;
        expect(bar).toEqual({
            pages: ['home', 'shop', 'collection', 'search', 'product'],
            style: 'tabs',
            imagePages: null,
            items: 'auto',
            showAll: false,
            collapseHeaderOnScroll: false,
        });
        const custom = shop({
            enabled: true,
            pages: ['Collection', 'our-story', 'bad page', 7, 'collection'],
            style: 'chips',
            items: [{ label: 'सब', route: '/shop' }, { label: '₹999 तक', route: 'c/gifts-under-999' }, { label: 'x', route: 'javascript:alert(1)' }, { label: '', route: 'c/a' }],
            showAll: true,
            collapseHeaderOnScroll: true,
        }).categoryBar!;
        expect(custom.pages).toEqual(['collection', 'our-story']);
        expect(custom.style).toBe('chips');
        expect(custom.items).toEqual([{ label: 'सब', route: 'shop' }, { label: '₹999 तक', route: 'c/gifts-under-999' }]);
        expect(custom.showAll).toBe(true);
        expect(custom.collapseHeaderOnScroll).toBe(true);
    });

    it('takes the "image" style; anything else unknown is the text default', () => {
        expect(shop({ enabled: true, style: 'image' }).categoryBar!.style).toBe('image');
        expect(shop({ enabled: true, style: 'photos' }).categoryBar!.style).toBe('tabs');
        expect(shop({ enabled: true, style: 'IMAGE' }).categoryBar!.style).toBe('tabs');
    });

    it('takes imagePages: the pages that open the photo row (all of the bar by default)', () => {
        const bar = shop({ enabled: true, style: 'image', imagePages: ['Home', 'collection', 'bad page', 'home'] });
        expect(bar.categoryBar!.imagePages).toEqual(['home', 'collection']);
        expect(categoryBarPhotosOn(bar, 'home')).toBe(true);
        expect(categoryBarPhotosOn(bar, 'collection')).toBe(true);
        expect(categoryBarPhotosOn(bar, 'product')).toBe(false);
        expect(categoryBarPhotosOn(bar, 'checkout')).toBe(false);
        const all = shop({ enabled: true, style: 'image' });
        expect(all.categoryBar!.imagePages).toBeNull();
        expect(categoryBarPhotosOn(all, 'product')).toBe(true);
        expect(categoryBarPhotosOn(shop({ enabled: true, style: 'chips', imagePages: ['home'] }), 'home')).toBe(false);
        expect(categoryBarPhotosOn(shop(undefined), 'home')).toBe(false);
    });

    it('shows only on the listed pages and never on the buying pages, nor on a shop that is off', () => {
        const config = shop({ enabled: true, pages: ['home', 'collection', 'product', 'checkout', 'order', 'track', 'account', 'cart'] });
        expect(categoryBarOn(config, 'home')).toBe(true);
        expect(categoryBarOn(config, 'collection')).toBe(true);
        expect(categoryBarOn(config, 'PRODUCT')).toBe(true);
        expect(categoryBarOn(config, 'cart')).toBe(true);
        expect(categoryBarOn(config, 'shop')).toBe(false);
        expect(categoryBarOn(config, 'our-story')).toBe(false);
        for (const buying of ['checkout', 'order', 'track', 'track-order', 'account']) expect(categoryBarOn(config, buying)).toBe(false);
        expect(categoryBarOn(config, '')).toBe(false);
        expect(categoryBarOn(config, null)).toBe(false);
        const off = parseCommerceConfig({ commerce: { enabled: false, publishableKey: KEY, categoryBar: { enabled: true } } });
        expect(categoryBarOn(off, 'home')).toBe(false);
    });

    it('pins the listing toolbar only when templates.collection.stickyToolbar is true', () => {
        expect(stickyListingToolbar(shop(undefined))).toBe(false);
        expect(stickyListingToolbar(shop(undefined, { templates: { collection: { stickyToolbar: 'yes' } } }))).toBe(false);
        expect(stickyListingToolbar(shop(undefined, { templates: { collection: { stickyToolbar: true } } }))).toBe(true);
        // The switch is not a section: the collection template keeps all its sections.
        const config = shop(undefined, { templates: { collection: { stickyToolbar: true } } });
        expect(templateSections(config, 'collection', ['header', 'grid'])).toEqual(['header', 'grid']);
    });
});
