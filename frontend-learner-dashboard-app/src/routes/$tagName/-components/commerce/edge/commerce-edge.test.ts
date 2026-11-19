import { describe, expect, it } from 'vitest';
import type { Category, ProductCard, ProductDetail } from '../api/types';
import {
    asciiLocation,
    collectionHead,
    edgeLocale,
    edgeShopOf,
    edgeTargetOf,
    findCategory,
    firstGalleryImage,
    fontTags,
    injectHead,
    jsonLd,
    leadImageUrl,
    localizedPath,
    looksLikeCommercePath,
    normalizeRedirectPath,
    ogLocale,
    preloadImageTag,
    productHead,
    redirectDecision,
    redirectLookupPath,
    seedTag,
    shownPrice,
    type EdgeShop,
} from './commerce-edge';

const KEY = `vak_pub_${'a1'.repeat(24)}`;

const SHOP: EdgeShop = { publishableKey: KEY, baseLocale: 'hi', locales: ['hi', 'en'], leadTag: 'REAL', fonts: [], redirects: false };

const PRODUCT = {
    id: 'p1',
    slug: 'palak-pink-cotton-saree',
    path: '/p/palak-pink-cotton-saree',
    locale: 'hi',
    name: 'पलक गुलाबी सूती साड़ी',
    short_description: 'हाथ से बुनी सूती साड़ी।',
    brand: null,
    price: { amount: 4899, compare_at_amount: 5999, currency: 'INR', from: false },
    stock: { state: 'LOW', left: 2, purchasable: true, single_piece: false, lead_time_days: null },
    media: [
        { kind: 'IMAGE', url: 'https://cdn.example/render.jpg', tag: 'RENDER', position: 0 },
        { kind: 'IMAGE', url: 'https://cdn.example/real.jpg', tag: 'REAL', position: 1 },
        { kind: 'VIDEO', url: 'https://cdn.example/clip.mp4', tag: null, position: 2 },
    ],
    variants: [{ id: 'v1', sku: 'SAR-001', price: { amount: 4899, currency: 'INR' }, stock: { state: 'LOW' }, position: 0 }],
    collections: [{ slug: 'sarees', kind: 'CATEGORY', name: 'साड़ियाँ', path: '/c/sarees' }],
    seo: {
        title: 'पलक गुलाबी सूती साड़ी',
        description: 'हाथ से बुनी सूती साड़ी, वाराणसी में बनी।',
        canonical_path: '/p/palak-pink-cotton-saree',
        alternates: [
            { locale: 'en', path: '/p/palak-pink-cotton-saree?lang=en' },
            { locale: 'hi', path: '/p/palak-pink-cotton-saree' },
        ],
    },
} as unknown as ProductDetail;

const page = (over: Record<string, unknown> = {}) => ({
    origin: 'https://shop.example',
    pathname: '/p/palak-pink-cotton-saree',
    basePath: '',
    shop: SHOP,
    locale: 'hi',
    siteName: 'Example Brand',
    ogImage: 'https://shop.example/og.jpg',
    ...over,
});

interface Ld {
    '@type': string;
    name?: string;
    sku?: string;
    image?: string[];
    brand?: unknown;
    offers?: Record<string, unknown> | Array<Record<string, unknown>>;
    numberOfItems?: number;
    itemListElement: Array<{ name: string; item: string; position: number; url: string }>;
}

const ldOf = (tags: string[]): Ld[] =>
    tags
        .filter((tag) => tag.startsWith('<script type="application/ld+json"'))
        .map((tag) => JSON.parse(tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')));

describe('edgeShopOf', () => {
    it('is null for a site without a shop, so the middleware changes nothing for it', () => {
        expect(edgeShopOf(undefined)).toBeNull();
        expect(edgeShopOf({})).toBeNull();
        expect(edgeShopOf({ commerce: { enabled: true } })).toBeNull();
        expect(edgeShopOf({ commerce: { enabled: false, publishableKey: KEY } })).toBeNull();
    });

    it("takes the site's base language for the bare path", () => {
        const shop = edgeShopOf({
            i18n: { defaultLocale: 'en' },
            commerce: { enabled: true, publishableKey: KEY, redirects: true, theme: { fonts: { display: 'Laila', text: 'Mukta' } } },
        });
        expect(shop).toMatchObject({ baseLocale: 'en', locales: ['en', 'hi'], redirects: true, fonts: ['Laila', 'Mukta'] });
        expect(edgeShopOf({ commerce: { enabled: true, publishableKey: KEY } })?.baseLocale).toBe('hi');
    });

    it('resolves the request language', () => {
        expect(edgeLocale(SHOP, 'en')).toBe('en');
        expect(edgeLocale(SHOP, 'EN')).toBe('en');
        expect(edgeLocale(SHOP, 'fr')).toBe('hi');
        expect(edgeLocale(SHOP, null)).toBe('hi');
    });
});

describe('edgeTargetOf', () => {
    it('reads a root-mounted and a tagged address', () => {
        expect(edgeTargetOf(['p', 'red-saree'], 'shop')).toEqual({ tag: 'shop', rootMounted: true, route: { kind: 'product', slug: 'red-saree' } });
        expect(edgeTargetOf(['store', 'c', 'sarees'], null)).toEqual({ tag: 'store', rootMounted: false, route: { kind: 'collection', slug: 'sarees' } });
        expect(edgeTargetOf(['store', 'p', 'x'], 'shop')?.tag).toBe('store');
    });

    it('is null for everything that is not a product or collection page', () => {
        expect(edgeTargetOf(['p', 'red-saree'], null)).toBeNull();
        expect(edgeTargetOf(['search'], 'shop')).toBeNull();
        expect(edgeTargetOf(['cart'], 'shop')).toBeNull();
        expect(edgeTargetOf(['about'], 'shop')).toBeNull();
        expect(edgeTargetOf(['blog', 'my-post'], 'shop')).toBeNull();
        expect(edgeTargetOf(['a', 'b', 'c', 'd'], 'shop')).toBeNull();
    });

    it('has a cheap first test that never matches an ordinary page', () => {
        expect(looksLikeCommercePath(['p', 'x'])).toBe(true);
        expect(looksLikeCommercePath(['tag', 'c', 'x'])).toBe(true);
        for (const segs of [[], ['about'], ['p'], ['blog', 'post'], ['tag', 'blog', 'post'], ['p', 'a', 'b', 'c']]) {
            expect(looksLikeCommercePath(segs)).toBe(false);
        }
    });
});

describe('productHead', () => {
    const head = productHead(page(), PRODUCT);
    const joined = head.tags.join('\n');

    it('writes title, description and language', () => {
        expect(head.title).toBe('पलक गुलाबी सूती साड़ी | Example Brand');
        expect(head.description).toBe('हाथ से बुनी सूती साड़ी, वाराणसी में बनी।');
        expect(head.lang).toBe('hi');
    });

    it('writes the canonical of this language and one alternate per language, x-default on the bare path', () => {
        expect(joined).toContain('<link rel="canonical" href="https://shop.example/p/palak-pink-cotton-saree" data-commerce-edge="1" />');
        expect(joined).toContain('hreflang="hi" href="https://shop.example/p/palak-pink-cotton-saree"');
        expect(joined).toContain('hreflang="en" href="https://shop.example/p/palak-pink-cotton-saree?lang=en"');
        expect(joined).toContain('hreflang="x-default" href="https://shop.example/p/palak-pink-cotton-saree"');
        const english = productHead(page({ locale: 'en' }), PRODUCT).tags.join('\n');
        expect(english).toContain('<link rel="canonical" href="https://shop.example/p/palak-pink-cotton-saree?lang=en"');
    });

    it('offers only the languages the product has text in', () => {
        const hindiOnly = { ...PRODUCT, seo: { ...PRODUCT.seo, alternates: [{ locale: 'hi', path: '/p/x' }] } } as ProductDetail;
        const tags = productHead(page(), hindiOnly).tags.join('\n');
        expect(tags).not.toContain('hreflang=');
    });

    it('writes Open Graph with the price in the title', () => {
        expect(joined).toContain('<meta property="og:title" content="पलक गुलाबी सूती साड़ी · ₹4,899"');
        expect(joined).toContain('<meta property="og:type" content="product"');
        expect(joined).toContain('<meta property="og:image" content="https://shop.example/og.jpg"');
        expect(joined).toContain('<meta property="product:price:amount" content="4899"');
        expect(joined).toContain('<meta property="product:price:currency" content="INR"');
        expect(joined).toContain('name="twitter:card" content="summary_large_image"');
    });

    it('writes Product JSON-LD with the offer a shopper sees', () => {
        const product = ldOf(head.tags).find((ld) => ld['@type'] === 'Product')!;
        expect(product.name).toBe('पलक गुलाबी सूती साड़ी');
        expect(product.sku).toBe('SAR-001');
        // The lead-tag photo first, never the video.
        expect(product.image).toEqual(['https://cdn.example/real.jpg', 'https://cdn.example/render.jpg']);
        expect(product.brand).toEqual({ '@type': 'Brand', name: 'Example Brand' });
        expect(product.offers).toMatchObject({
            '@type': 'Offer',
            price: 4899,
            priceCurrency: 'INR',
            availability: 'https://schema.org/LimitedAvailability',
            url: 'https://shop.example/p/palak-pink-cotton-saree',
        });
    });

    it('writes one Offer per variant when they differ in price (eligible for merchant listings), each with its own stock', () => {
        const many = {
            ...PRODUCT,
            stock: { state: 'OUT' },
            variants: [
                { id: 'a', sku: 'A', price: { amount: 100 }, stock: { state: 'IN_STOCK' }, position: 0 },
                { id: 'b', sku: 'B', price: { amount: 250 }, position: 1 },
            ],
        } as unknown as ProductDetail;
        const product = ldOf(productHead(page(), many).tags).find((ld) => ld['@type'] === 'Product')!;
        expect(product.offers).toEqual([
            expect.objectContaining({ '@type': 'Offer', price: 100, sku: 'A', availability: 'https://schema.org/InStock' }),
            // A variant without a stock state of its own takes the product's.
            expect.objectContaining({ '@type': 'Offer', price: 250, sku: 'B', availability: 'https://schema.org/OutOfStock' }),
        ]);
        expect(product.sku).toBeUndefined();
    });

    describe('goods sold by length', () => {
        // Khadi at ₹450 a metre: the API prices ONE base unit (1 cm = ₹4.50), 100 to the metre.
        const CLOTH = {
            ...PRODUCT,
            name: 'खादी कपड़ा',
            unit: 'MTR',
            qty_scale: 100,
            qty_step: 10,
            price: { amount: 4.5, compare_at_amount: null, currency: 'INR', from: false },
            variants: [{ id: 'v1', sku: 'FAB-1', price: { amount: 4.5, currency: 'INR' }, stock: { state: 'IN_STOCK' }, position: 0 }],
        } as unknown as ProductDetail;

        it('shows the price of a metre, never of one base unit', () => {
            expect(shownPrice(4.5, 100, 'MTR', 'hi')).toEqual({ amount: 450, unitName: 'मीटर', unitCode: 'MTR' });
            expect(shownPrice(4.5, 100, 'MTR', 'en')).toEqual({ amount: 450, unitName: 'metre', unitCode: 'MTR' });
            expect(shownPrice(4899, 1, 'PCS', 'hi')).toEqual({ amount: 4899, unitName: '', unitCode: '' });
            expect(shownPrice(null, 100, 'MTR', 'hi').amount).toBeNull();
            // An unknown unit still gets the per-unit amount, without a name.
            expect(shownPrice(2, 10, 'BOLT', 'en')).toEqual({ amount: 20, unitName: '', unitCode: '' });
        });

        it('writes the per-metre price into the share card and the Offer, with the unit', () => {
            const cloth = productHead(page(), CLOTH);
            const all = cloth.tags.join('\n');
            expect(all).toContain('<meta property="og:title" content="खादी कपड़ा · ₹450 / मीटर"');
            expect(all).toContain('<meta property="product:price:amount" content="450"');
            expect(all).not.toContain('4.5');
            const product = ldOf(cloth.tags).find((ld) => ld['@type'] === 'Product')!;
            expect(product.offers).toMatchObject({
                '@type': 'Offer',
                price: 450,
                priceSpecification: {
                    '@type': 'UnitPriceSpecification',
                    price: 450,
                    referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MTR' },
                },
            });
        });

        it('leaves a piece product without a unit price specification', () => {
            const product = ldOf(head.tags).find((ld) => ld['@type'] === 'Product')!;
            expect(product.offers).not.toHaveProperty('priceSpecification');
        });
    });

    it('points ?lang=en of a product with no English text at the base-language page', () => {
        const hindiOnly = { ...PRODUCT, seo: { ...PRODUCT.seo, alternates: [{ locale: 'hi', path: '/p/x' }] } } as unknown as ProductDetail;
        const english = productHead(page({ locale: 'en' }), hindiOnly);
        expect(english.tags.join('\n')).toContain('<link rel="canonical" href="https://shop.example/p/palak-pink-cotton-saree" data-commerce-edge="1" />');
        expect(english.tags.join('\n')).not.toContain('hreflang');
        expect(english.lang).toBe('hi');
    });

    it('writes og:locale with a territory', () => {
        expect(ogLocale('hi')).toBe('hi_IN');
        expect(ogLocale('en')).toBe('en_IN');
        expect(ogLocale('en-gb')).toBe('en_GB');
        expect(joined).toContain('<meta property="og:locale" content="hi_IN"');
    });

    it('writes a BreadcrumbList through the category', () => {
        const crumbs = ldOf(head.tags).find((ld) => ld['@type'] === 'BreadcrumbList')!;
        expect(crumbs.itemListElement.map((i: { name: string; item: string }) => [i.name, i.item])).toEqual([
            ['Example Brand', 'https://shop.example/'],
            ['साड़ियाँ', 'https://shop.example/c/sarees'],
            ['पलक गुलाबी सूती साड़ी', 'https://shop.example/p/palak-pink-cotton-saree'],
        ]);
    });

    it('keeps the tag prefix of a shared host in every address', () => {
        const tagged = productHead(page({ pathname: '/store/p/palak-pink-cotton-saree', basePath: '/store', locale: 'en' }), PRODUCT);
        const crumbs = ldOf(tagged.tags).find((ld) => ld['@type'] === 'BreadcrumbList')!;
        expect(crumbs.itemListElement[0].item).toBe('https://shop.example/store/');
        expect(crumbs.itemListElement[1].item).toBe('https://shop.example/store/c/sarees?lang=en');
    });

    it('escapes product text in attributes and in JSON-LD', () => {
        const hostile = {
            ...PRODUCT,
            name: 'Saree "</script><script>alert(1)</script>',
            seo: { title: 'T "x" <b>', description: 'D & "q"', alternates: [] },
        } as unknown as ProductDetail;
        const out = productHead(page(), hostile);
        const tags = out.tags.join('\n');
        expect(tags).not.toContain('</script><script>alert(1)');
        expect(tags).toContain('&quot;');
        expect((tags.match(/<script /g) || []).length).toBe((tags.match(/<\/script>/g) || []).length);
        const product = ldOf(out.tags).find((ld) => ld['@type'] === 'Product')!;
        expect(product.name).toBe('Saree "</script><script>alert(1)</script>');
        expect(jsonLd({ a: '</script>\u2028' })).toBe('{"a":"\\u003c/script>\\u2028"}');
    });

    it('leaves the price out when the API sent none', () => {
        const unpriced = { ...PRODUCT, price: null, variants: [] } as unknown as ProductDetail;
        const out = productHead(page(), unpriced);
        expect(out.tags.join('\n')).not.toContain('product:price');
        expect(ldOf(out.tags).find((ld) => ld['@type'] === 'Product')!.offers).toBeUndefined();
    });
});

describe('collectionHead', () => {
    const tree = [
        {
            slug: 'clothing',
            name: 'वस्त्र',
            children: [{ slug: 'sarees', name: 'साड़ियाँ', description: 'हाथ से बुनी साड़ियाँ', image_url: null, children: [] }],
        },
    ] as unknown as Category[];
    const products = [
        { id: '1', slug: 'red-saree', name: 'Red saree' },
        { id: '2', slug: 'blue-saree', name: 'Blue saree' },
    ] as unknown as ProductCard[];

    it('finds a collection anywhere in the tree, with its parents', () => {
        expect(findCategory(tree, 'sarees')?.parents.map((p) => p.slug)).toEqual(['clothing']);
        expect(findCategory(tree, 'clothing')?.parents).toEqual([]);
        expect(findCategory(tree, 'nope')).toBeNull();
        expect(findCategory(undefined, 'x')).toBeNull();
    });

    it('writes the bare listing as canonical, BreadcrumbList and ItemList', () => {
        const head = collectionHead(page({ pathname: '/c/sarees', ogImage: '' }), findCategory(tree, 'sarees')!, products);
        expect(head.title).toBe('साड़ियाँ | Example Brand');
        expect(head.description).toBe('हाथ से बुनी साड़ियाँ');
        const joined = head.tags.join('\n');
        expect(joined).toContain('<link rel="canonical" href="https://shop.example/c/sarees" data-commerce-edge="1" />');
        expect(joined).toContain('hreflang="en" href="https://shop.example/c/sarees?lang=en"');
        expect(joined).toContain('name="twitter:card" content="summary"');
        const lds = ldOf(head.tags);
        expect(lds.find((ld) => ld['@type'] === 'BreadcrumbList')!.itemListElement.map((i: { name: string }) => i.name)).toEqual([
            'Example Brand',
            'वस्त्र',
            'साड़ियाँ',
        ]);
        const list = lds.find((ld) => ld['@type'] === 'ItemList')!;
        expect(list.numberOfItems).toBe(2);
        expect(list.itemListElement[1]).toMatchObject({ position: 2, name: 'Blue saree', url: 'https://shop.example/p/blue-saree' });
    });

    it('leaves the ItemList out of an empty collection', () => {
        const head = collectionHead(page({ pathname: '/c/sarees' }), findCategory(tree, 'sarees')!, []);
        expect(ldOf(head.tags).some((ld) => ld['@type'] === 'ItemList')).toBe(false);
    });
});

describe('injectHead', () => {
    const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta name="description" content="Learning Platform" />
    <title>Course Catalogue</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

    it('writes title, description, tags and language into the SPA shell', () => {
        const html = injectHead(SHELL, productHead(page(), PRODUCT));
        expect(html).toContain('<html lang="hi">');
        expect(html).toContain('<title>पलक गुलाबी सूती साड़ी | Example Brand</title>');
        expect(html).toContain('<meta name="description" content="हाथ से बुनी सूती साड़ी, वाराणसी में बनी।" />');
        expect(html).not.toContain('Learning Platform');
        expect(html.indexOf('application/ld+json')).toBeLessThan(html.indexOf('</head>'));
        expect(html).toContain('<div id="root"></div>');
        expect((html.match(/<title>/g) || []).length).toBe(1);
        expect((html.match(/rel="canonical"/g) || []).length).toBe(1);
    });

    it('adds noindex when asked and a description when the shell has none', () => {
        const html = injectHead('<html><head><title></title></head><body></body></html>', { title: 'T', description: 'D', lang: 'hi', tags: [], resources: [] }, { noindex: true });
        expect(html).toContain('<html lang="hi">');
        expect(html).toContain('<meta name="description" content="D" />');
        expect(html).toContain('<meta name="robots" content="noindex" data-commerce-edge="1" />');
    });

    it('links the theme fonts from the document, with font-display swap', () => {
        const tags = fontTags(['Laila', 'Mukta', 'Laila', 'bad"name']);
        expect(tags.join('\n')).toContain('family=Laila:wght@400;600&amp;family=Mukta:wght@400;600&amp;display=swap'.replace('&amp;family', '&family'));
        expect(tags.join('\n')).toContain('rel="preconnect" href="https://fonts.gstatic.com" crossorigin');
        expect(fontTags([])).toEqual([]);
    });

    it('keeps the font stylesheet out of the tags the app replaces', () => {
        const withFonts = productHead(page({ shop: { ...SHOP, fonts: ['Laila', 'Mukta'] } }), PRODUCT);
        // Page tags are marked, so the app can remove them when the visitor moves on.
        expect(withFonts.tags.every((tag) => tag.includes('data-commerce-edge="1"'))).toBe(true);
        expect(withFonts.tags.join('\n')).not.toContain('fonts.googleapis.com');
        // The stylesheet belongs to the document: unmarked, so nothing ever removes it.
        expect(withFonts.resources.join('\n')).toContain('rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Laila');
        expect(withFonts.resources.join('\n')).not.toContain('data-commerce-edge');
        const html = injectHead(SHELL, withFonts);
        expect(html).toContain('rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Laila');
    });

    it('treats product text as data: "$&" and "$\'" in a name or description are written literally', () => {
        const tricky = {
            ...PRODUCT,
            name: "Saree $& $' $` $1",
            seo: { ...PRODUCT.seo, title: "Saree $& $' $` $1", description: "Costs $' less $& more" },
        } as unknown as ProductDetail;
        const html = injectHead(SHELL, productHead(page(), tricky));
        expect(html).toContain("<title>Saree $&amp; $' $` $1 | Example Brand</title>");
        expect(html).toContain('<meta name="description" content="Costs $\' less $&amp; more" />');
        // Nothing of the shell was pasted into the head, and the page is intact.
        expect((html.match(/<div id="root"><\/div>/g) || []).length).toBe(1);
        expect((html.match(/<\/head>/g) || []).length).toBe(1);
        expect((html.match(/<title>/g) || []).length).toBe(1);
    });
});

describe('what the edge hands to the page', () => {
    const renditions = [320, 640, 960, 1600].map((width) => ({ width, url: `https://cdn.example/real-${width}.webp` }));
    const WITH_RENDITIONS = {
        ...PRODUCT,
        media: [
            { kind: 'IMAGE', url: 'https://cdn.example/render.jpg', tag: 'RENDER', position: 0, renditions: [] },
            { kind: 'IMAGE', url: 'https://cdn.example/real.jpg', tag: 'REAL', position: 1, width: 1600, height: 2000, renditions },
        ],
    } as unknown as ProductDetail;

    it('preloads the picture the gallery opens on, with the sources and sizes the page uses', () => {
        const first = firstGalleryImage(WITH_RENDITIONS, 'REAL');
        expect(first?.url).toBe('https://cdn.example/real.jpg');
        const tag = preloadImageTag(first, '(min-width: 1024px) 50vw, 100vw')!;
        expect(tag).toContain('<link rel="preload" as="image" href="https://cdn.example/real-640.webp"');
        expect(tag).toContain('imagesrcset="https://cdn.example/real-320.webp 320w, https://cdn.example/real-640.webp 640w, https://cdn.example/real-960.webp 960w, https://cdn.example/real-1600.webp 1600w"');
        expect(tag).toContain('imagesizes="(min-width: 1024px) 50vw, 100vw"');
        expect(tag).toContain('fetchpriority="high"');
        expect(tag).not.toContain('data-commerce-edge');
    });

    it('preloads nothing for a product without a picture or one that opens on a video', () => {
        expect(preloadImageTag(null, '100vw')).toBeNull();
        const videoOnly = { ...PRODUCT, media: [{ kind: 'VIDEO', url: 'https://cdn.example/clip.mp4', position: 0 }] } as unknown as ProductDetail;
        expect(firstGalleryImage(videoOnly, 'REAL')).toBeNull();
    });

    it('follows ?v=<sku> to the pictures of that variant', () => {
        const withVariants = {
            ...PRODUCT,
            options: [{ code: 'colour', name: 'Colour', kind: 'SWATCH', values: [{ code: 'red', label: 'Red', position: 0 }, { code: 'blue', label: 'Blue', position: 1 }] }],
            variants: [
                { id: 'v-red', sku: 'RED', option_values: { colour: 'red' }, stock: { state: 'IN_STOCK', purchasable: true }, position: 0 },
                { id: 'v-blue', sku: 'BLUE', option_values: { colour: 'blue' }, stock: { state: 'IN_STOCK', purchasable: true }, position: 1 },
            ],
            media: [
                { kind: 'IMAGE', url: 'https://cdn.example/red.jpg', variant_id: 'v-red', position: 0 },
                { kind: 'IMAGE', url: 'https://cdn.example/blue.jpg', variant_id: 'v-blue', position: 1 },
            ],
        } as unknown as ProductDetail;
        expect(firstGalleryImage(withVariants, '', 'BLUE')?.url).toBe('https://cdn.example/blue.jpg');
        expect(firstGalleryImage(withVariants, '')?.url).toBe('https://cdn.example/red.jpg');
    });

    it('writes the product as data that cannot close its own script element', () => {
        const nasty = { ...PRODUCT, name: '</script><script>alert(1)</script>' } as unknown as ProductDetail;
        const tag = seedTag({ kind: 'product', slug: nasty.slug, locale: 'hi', data: nasty });
        expect(tag.startsWith('<script type="application/json" id="commerce-seed">')).toBe(true);
        expect((tag.match(/<\/script>/g) || []).length).toBe(1);
        const parsed = JSON.parse(tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
        expect(parsed.data.name).toBe('</script><script>alert(1)</script>');
        expect(parsed.slug).toBe('palak-pink-cotton-saree');
    });
});

describe('small helpers', () => {
    it('writes the address of a language version', () => {
        expect(localizedPath('/p/x', 'hi', 'hi')).toBe('/p/x');
        expect(localizedPath('/p/x', 'en', 'hi')).toBe('/p/x?lang=en');
    });

    it('picks the lead-tag image for sharing', () => {
        expect(leadImageUrl(PRODUCT.media, 'REAL')).toBe('https://cdn.example/real.jpg');
        expect(leadImageUrl(PRODUCT.media, '')).toBe('https://cdn.example/render.jpg');
        expect(leadImageUrl([], 'REAL')).toBe('');
        expect(leadImageUrl(null, 'REAL')).toBe('');
    });
});

describe('redirects from the old site', () => {
    it('normalises a path the way site_redirect stores it', () => {
        expect(normalizeRedirectPath('/Product/Red-Saree/')).toBe('/product/red-saree');
        expect(normalizeRedirectPath('/hi/product/%E0%A4%B8%E0%A4%BE%E0%A4%A1%E0%A4%BC%E0%A5%80/')).toBe('/hi/product/साड़ी'.normalize('NFC'));
        // Upper- and lower-case hex decode alike.
        expect(normalizeRedirectPath('/hi/%e0%a4%b8')).toBe(normalizeRedirectPath('/hi/%E0%A4%B8'));
        // NFD input compares equal to NFC.
        expect(normalizeRedirectPath('/caf\u0065\u0301')).toBe('/caf\u00e9');
        expect(normalizeRedirectPath('/')).toBe('/');
        expect(normalizeRedirectPath('//shop-en//')).toBe('/shop-en');
        expect(normalizeRedirectPath('/bad%E0%A4')).toBe('/bad%e0%a4');
    });

    it('keeps the query string, for PREFIX rows that match on it', () => {
        expect(normalizeRedirectPath('/product/x/', '?attribute_pa_color=red')).toBe('/product/x?attribute_pa_color=red');
        expect(normalizeRedirectPath('/product/x/', '?')).toBe('/product/x');
    });

    it('answers 301 with a target on this site, which may carry a query string', () => {
        expect(redirectDecision({ status_code: 301, to_path: '/p/red-saree?lang=en' }, '/product/red-saree/')).toEqual({
            status: 301,
            location: '/p/red-saree?lang=en',
        });
        expect(redirectDecision({ statusCode: 301, toPath: '/shop' }, '/shop-en/')).toEqual({ status: 301, location: '/shop' });
    });

    it('makes the Location ASCII: a Devanagari target is percent-encoded and reads back the same', () => {
        const slug = 'लाल-साड़ी'.normalize('NFC');
        const decision = redirectDecision({ status_code: 301, to_path: `/p/${slug}?lang=en` }, '/hi/product/old/');
        expect(decision).toEqual({ status: 301, location: `/p/${encodeURIComponent(slug)}?lang=en` });
        const location = (decision as { location: string }).location;
        expect(location).toMatch(/^[\x21-\x7e]+$/);
        expect(decodeURIComponent(location.split('?')[0]!)).toBe(`/p/${slug}`);
        // A non-ASCII query value is encoded too; the query's own signs keep their meaning.
        expect(redirectDecision({ status_code: 301, to_path: '/shop?filter.colour=लाल&lang=en' }, '/x')).toEqual({
            status: 301,
            location: `/shop?filter.colour=${encodeURIComponent('लाल')}&lang=en`,
        });
    });

    it('never encodes an encoded target a second time', () => {
        const encoded = `/p/${encodeURIComponent('साड़ी')}`;
        expect(asciiLocation(encoded)).toBe(encoded);
        expect(asciiLocation(`/p/${encodeURIComponent('साड़ी').toLowerCase()}`)).toBe(`/p/${encodeURIComponent('साड़ी').toLowerCase()}`);
        expect(asciiLocation('/news#about-us')).toBe('/news#about-us');
        expect(asciiLocation('/p/a b')).toBe('/p/a%20b');
        expect(asciiLocation('/p/100%')).toBe('/p/100%25');
        expect(asciiLocation('/p/50%zz')).toBe('/p/50%25zz');
        expect(asciiLocation('/p/\uD800x')).toBe('/p/%EF%BF%BDx');
        expect(asciiLocation('/p/caf\u00e9')).toBe('/p/caf%C3%A9');
    });

    it('encodes a tab or another control character, so the header never carries one', () => {
        expect(asciiLocation('/p/a\tb')).toBe('/p/a%09b');
        expect(asciiLocation('/p/a\u0000b\u007f')).toBe('/p/a%00b%7F');
        expect(redirectDecision({ status_code: 301, to_path: '/p/a\tb' }, '/old')).toEqual({ status: 301, location: '/p/a%09b' });
    });

    it('asks the resolver with the percent signs of the decoded path written as %25', () => {
        expect(redirectLookupPath('/X%2541/')).toBe('/x%2541');
        expect(redirectLookupPath('/hi/%E0%A4%B2/', '?a=%E0%A4%B2')).toBe('/hi/ल?a=%E0%A4%B2');
        expect(redirectLookupPath('/100%25', '?')).toBe('/100%25');
        // A malformed escape is kept as sent, and its percent sign written as %25.
        expect(redirectLookupPath('/a%zz')).toBe('/a%25zz');
        expect(redirectLookupPath('/product/red-saree/')).toBe('/product/red-saree');
    });

    it('still finds a loop when the target is written in Devanagari and the request is encoded', () => {
        const slug = 'साड़ी';
        expect(redirectDecision({ status_code: 301, to_path: `/hi/${slug}/` }, `/hi/${encodeURIComponent(slug)}`)).toBeNull();
        expect(redirectDecision({ status_code: 301, to_path: `/hi/${encodeURIComponent(slug)}` }, `/hi/${slug}`)).toBeNull();
        expect(redirectDecision({ status_code: 301, to_path: `/hi/${slug}#top` }, `/hi/${slug}`)).toBeNull();
    });

    it('answers 410 for a row with no target', () => {
        expect(redirectDecision({ status_code: 410, to_path: null }, '/hi/dummy/')).toEqual({ status: 410 });
    });

    it('never follows a target that leaves the site or loops', () => {
        for (const to of ['https://evil.example/', '//evil.example/x', 'p/x', '/\\evil', '/p/x\r\nSet-Cookie: a=b', '', null]) {
            expect(redirectDecision({ status_code: 301, to_path: to }, '/old')).toBeNull();
        }
        expect(redirectDecision({ status_code: 301, to_path: '/Old/' }, '/old')).toBeNull();
    });

    it('does nothing for no row, another status or a malformed answer', () => {
        expect(redirectDecision(null, '/x')).toBeNull();
        expect(redirectDecision({ error: { code: 'not_found' } }, '/x')).toBeNull();
        expect(redirectDecision({ status_code: 302, to_path: '/p/x' }, '/x')).toBeNull();
        expect(redirectDecision('x', '/x')).toBeNull();
    });
});
