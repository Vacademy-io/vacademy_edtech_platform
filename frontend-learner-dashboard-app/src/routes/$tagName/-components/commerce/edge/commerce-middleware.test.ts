/**
 * The shop's branch of the Cloudflare edge middleware (functions/_middleware.ts), run against
 * mocked backends: product and collection pages get their head for EVERY visitor, the old
 * site's paths answer 301 and 410, and a site without a shop is served exactly as before.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type OnRequest = (context: {
    request: Request;
    env: unknown;
    params: Record<string, string>;
    next: () => Promise<Response>;
    passThroughOnException?: () => void;
}) => Promise<Response>;

// Imported by computed path: the middleware is not part of the app's TypeScript project.
const MIDDLEWARE = new URL('../../../../../../functions/_middleware.ts', import.meta.url).href;
let onRequest: OnRequest;

beforeAll(async () => {
    ({ onRequest } = (await import(/* @vite-ignore */ MIDDLEWARE)) as { onRequest: OnRequest });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const BROWSER = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta name="description" content="Learning Platform" />
    <title>Course Catalogue</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const PAGES = [
    { id: 'home', route: 'homepage', title: 'Home', components: [] },
    { id: 'about', route: 'about', title: 'About', components: [] },
];

const SHOP_SETTINGS = {
    i18n: { enabled: true, defaultLocale: 'hi', locales: [{ code: 'hi', label: 'हिन्दी' }, { code: 'en', label: 'EN' }], strings: {} },
    commerce: { enabled: true, publishableKey: KEY, redirects: true, media: { leadTag: 'REAL' } },
};

const product = (locale: string) => ({
    id: 'p1',
    slug: 'red-saree',
    path: locale === 'hi' ? '/p/red-saree' : '/p/red-saree?lang=en',
    locale,
    name: locale === 'hi' ? 'लाल साड़ी' : 'Red saree',
    short_description: locale === 'hi' ? 'सूती साड़ी' : 'Cotton saree',
    price: { amount: 4899, compare_at_amount: null, currency: 'INR', from: false },
    stock: { state: 'IN_STOCK', left: null, purchasable: true, single_piece: false },
    media: [
        {
            kind: 'IMAGE',
            url: 'https://cdn.example/real.jpg',
            tag: 'REAL',
            position: 0,
            width: 1600,
            height: 2000,
            renditions: [320, 640, 1600].map((width) => ({ width, url: `https://cdn.example/real-${width}.webp` })),
        },
    ],
    variants: [{ id: 'v1', sku: 'SAR-1', price: { amount: 4899, currency: 'INR' }, position: 0 }],
    collections: [{ slug: 'sarees', kind: 'CATEGORY', name: locale === 'hi' ? 'साड़ियाँ' : 'Sarees', path: '/c/sarees' }],
    seo: {
        title: locale === 'hi' ? 'लाल साड़ी' : 'Red saree',
        description: locale === 'hi' ? 'सूती साड़ी' : 'Cotton saree',
        alternates: [{ locale: 'en', path: '/p/red-saree?lang=en' }, { locale: 'hi', path: '/p/red-saree' }],
    },
});

interface Backend {
    globalSettings: Record<string, unknown>;
    rootTag?: string | null;
    redirects?: Record<string, unknown>;
    apiDown?: boolean;
    /** The Pages variable COMMERCE_SHOP_HOSTS: hosts whose old-site redirects are resolved. */
    shopHosts?: string;
    /** These lookups never answer (a saturated backend): only an abort ends them. */
    hang?: Array<'branding' | 'catalogue'>;
}

/** A request that only its abort signal can end, as against a backend that has stopped answering. */
const never = (signal: AbortSignal | null | undefined): Promise<Response> =>
    new Promise((_resolve, reject) => {
        const fail = () => reject(new DOMException('aborted', 'AbortError'));
        // As fetch does: a signal that has already fired rejects at once.
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail);
    });

const run = async (url: string, backend: Backend, userAgent = BROWSER) => {
    const calls: Array<{ url: string; key: string | null; origin: string | null; hasDeadline: boolean }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = new URL(String(input));
        const headers = new Headers(init?.headers);
        calls.push({ url: target.toString(), key: headers.get('X-API-Key'), origin: headers.get('Origin'), hasDeadline: !!init?.signal });
        if (backend.hang?.includes('branding') && target.pathname.endsWith('/domain-routing/v1/resolve')) return never(init?.signal);
        if (backend.hang?.includes('catalogue') && target.pathname.endsWith('/course-catalogue/v1/institute/get/by-tag')) return never(init?.signal);
        const json = (body: unknown, status = 200) =>
            new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (target.pathname.endsWith('/domain-routing/v1/resolve')) {
            return json({
                instituteId: 'inst-1',
                instituteName: 'Example Brand',
                instituteLogoFileId: '',
                rootCatalogueTag: backend.rootTag === undefined ? 'shop' : backend.rootTag,
            });
        }
        if (target.pathname.endsWith('/course-catalogue/v1/institute/get/by-tag')) {
            if (target.searchParams.get('tagName') !== 'shop') return json({}, 404);
            return json({ catalogue_json: JSON.stringify({ pages: PAGES, globalSettings: backend.globalSettings }) });
        }
        if (target.pathname.includes('/open/')) {
            if (backend.apiDown) return json({ error: { code: 'internal' } }, 500);
            if (target.pathname.endsWith('/open/catalog/v1/products/red-saree')) return json(product(target.searchParams.get('locale') || 'hi'));
            if (target.pathname.includes('/open/catalog/v1/products/')) return json({ error: { code: 'not_found', message: 'Product not found.' } }, 404);
            if (target.pathname.endsWith('/open/catalog/v1/categories')) {
                return json({ data: [{ slug: 'sarees', name: 'साड़ियाँ', description: 'हाथ से बुनी साड़ियाँ', image_url: null, children: [] }] });
            }
            if (target.pathname.endsWith('/open/catalog/v1/products')) {
                if (target.searchParams.get('collection') !== 'sarees') return json({ error: { code: 'not_found' } }, 404);
                return json({
                    data: [
                        {
                            id: 'p1',
                            slug: 'red-saree',
                            name: 'लाल साड़ी',
                            image: { kind: 'IMAGE', url: 'https://cdn.example/card.jpg', position: 0, renditions: [{ width: 320, url: 'https://cdn.example/card-320.webp' }, { width: 640, url: 'https://cdn.example/card-640.webp' }] },
                        },
                    ],
                    total: 1,
                });
            }
            if (target.pathname.endsWith('/open/commerce/v1/redirects/resolve')) {
                const row = (backend.redirects || {})[target.searchParams.get('path') || ''];
                return row ? json(row) : json({ error: { code: 'not_found' } }, 404);
            }
        }
        // The image-resize probe and anything else: not available.
        return new Response('', { status: 404 });
    });
    let shellServed = 0;
    let passThrough = 0;
    const response = await onRequest({
        request: new Request(url, { headers: { 'user-agent': userAgent } }),
        env: backend.shopHosts === undefined ? {} : { COMMERCE_SHOP_HOSTS: backend.shopHosts },
        params: {},
        passThroughOnException: () => {
            passThrough += 1;
        },
        next: async () => {
            shellServed += 1;
            return new Response(INDEX_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        },
    });
    return { response, html: response.status === 301 ? '' : await response.text(), calls, shellServed, passThrough };
};

/** Only the lookups that reach the backend to learn about the site (not the shop API). */
const lookups = (calls: Array<{ url: string }>) =>
    calls.filter((c) => c.url.includes('/domain-routing/') || c.url.includes('/course-catalogue/'));

/** The deployment names the shop's host (Pages variable COMMERCE_SHOP_HOSTS). */
const SHOP_HOST = 'shop.example';

describe('a product page', () => {
    it('gets its head for an ordinary browser, not only for crawlers', async () => {
        const { response, html, calls } = await run('https://shop.example/p/red-saree', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS });
        expect(response.status).toBe(200);
        expect(html).toContain('<html lang="hi">');
        expect(html).toContain('<title>लाल साड़ी | Example Brand</title>');
        expect(html).toContain('<meta name="description" content="सूती साड़ी" />');
        expect(html).toContain('<link rel="canonical" href="https://shop.example/p/red-saree" data-commerce-edge="1" />');
        expect(html).toContain('hreflang="en" href="https://shop.example/p/red-saree?lang=en"');
        expect(html).toContain('hreflang="x-default" href="https://shop.example/p/red-saree"');
        expect(html).toContain('property="og:title" content="लाल साड़ी · ₹4,899"');
        expect(html).toContain('property="og:image" content="https://cdn.example/real.jpg"');
        expect(html).toContain('"@type":"Product"');
        expect(html).toContain('"@type":"BreadcrumbList"');
        expect(html).toContain('"price":4899');
        expect(html).toContain('<div id="root"></div>');
        // Server-side call: the publishable key, no Origin, and the institute in the cache key.
        const api = calls.find((c) => c.url.includes('/open/catalog/v1/products/red-saree'))!;
        expect(api.key).toBe(KEY);
        expect(api.origin).toBeNull();
        expect(new URL(api.url).searchParams.get('_site')).toBe('inst-1');
        expect(new URL(api.url).searchParams.get('locale')).toBe('hi');
    });

    it('starts the lead image with the document and hands the product to the page', async () => {
        const { html } = await run('https://shop.example/p/red-saree', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS });
        // The same sources and sizes the gallery's first <img> uses.
        expect(html).toContain('<link rel="preload" as="image" href="https://cdn.example/real-640.webp" imagesrcset="https://cdn.example/real-320.webp 320w, https://cdn.example/real-640.webp 640w, https://cdn.example/real-1600.webp 1600w" imagesizes="(min-width: 1024px) 50vw, 100vw" fetchpriority="high" />');
        const seed = /<script type="application\/json" id="commerce-seed">(.*?)<\/script>/s.exec(html);
        expect(seed).toBeTruthy();
        const parsed = JSON.parse(seed![1]!);
        expect(parsed).toMatchObject({ kind: 'product', slug: 'red-saree', locale: 'hi' });
        expect(parsed.data.name).toBe('लाल साड़ी');
        expect(html.indexOf('commerce-seed')).toBeLessThan(html.indexOf('</head>'));
    });

    it('links the theme fonts without the mark the app removes page tags by', async () => {
        const settings = { ...SHOP_SETTINGS, commerce: { ...SHOP_SETTINGS.commerce, theme: { fonts: { display: 'Laila', text: 'Mukta' } } } };
        const { html } = await run('https://shop.example/p/red-saree', { shopHosts: SHOP_HOST, globalSettings: settings });
        const fontLink = /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/.exec(html);
        expect(fontLink).toBeTruthy();
        expect(fontLink![0]).not.toContain('data-commerce-edge');
        expect(html).toContain('<link rel="canonical" href="https://shop.example/p/red-saree" data-commerce-edge="1" />');
    });

    it('hands over the language the address asked for, so the page can tell whether it applies', async () => {
        const { html } = await run('https://shop.example/p/red-saree?lang=en', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS });
        const parsed = JSON.parse(/id="commerce-seed">(.*?)<\/script>/s.exec(html)![1]!);
        expect(parsed.locale).toBe('en');
        expect(parsed.data.name).toBe('Red saree');
    });

    it('switches text and canonical with ?lang=en', async () => {
        const { html } = await run('https://shop.example/p/red-saree?lang=en', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS });
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('<title>Red saree | Example Brand</title>');
        expect(html).toContain('<link rel="canonical" href="https://shop.example/p/red-saree?lang=en" data-commerce-edge="1" />');
        expect(html).toContain('property="og:title" content="Red saree · ₹4,899"');
    });

    it('gives a crawler the same head', async () => {
        const browser = await run('https://shop.example/p/red-saree', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS });
        const crawler = await run('https://shop.example/p/red-saree', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS }, 'Googlebot/2.1');
        expect(crawler.html).toBe(browser.html);
    });

    it('answers 404 with the shell and noindex for a product the API does not know', async () => {
        const { response, html } = await run('https://shop.example/p/gone-saree', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS });
        expect(response.status).toBe(404);
        expect(html).toContain('<meta name="robots" content="noindex"');
        expect(html).toContain('<div id="root"></div>');
        expect(html).not.toContain('application/ld+json');
    });

    it('fails open to the untouched shell when the API is down', async () => {
        const { response, html, shellServed } = await run('https://shop.example/p/red-saree', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS, apiDown: true });
        expect(response.status).toBe(200);
        expect(html).toBe(INDEX_HTML);
        expect(shellServed).toBe(1);
    });

    it('gets no head and makes no lookup on a host the deployment does not name', async () => {
        for (const hosts of [undefined, '', 'other.example']) {
            const { response, html, calls } = await run('https://shop.example/p/red-saree', { globalSettings: SHOP_SETTINGS, shopHosts: hosts });
            expect(response.status, String(hosts)).toBe(200);
            expect(html, String(hosts)).toBe(INDEX_HTML);
            expect(calls, String(hosts)).toEqual([]);
        }
    });

    it('works under a tag on a shared host', async () => {
        const { html } = await run('https://shop.example/shop/p/red-saree', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS, rootTag: null });
        expect(html).toContain('<link rel="canonical" href="https://shop.example/shop/p/red-saree" data-commerce-edge="1" />');
        expect(html).toContain('"item":"https://shop.example/shop/c/sarees"');
    });
});

describe('a collection page', () => {
    it('gets title, canonical on the bare listing, BreadcrumbList and ItemList', async () => {
        const { response, html } = await run('https://shop.example/c/sarees?filter.colour=red&sort=newest', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS });
        expect(response.status).toBe(200);
        expect(html).toContain('<title>साड़ियाँ | Example Brand</title>');
        expect(html).toContain('<link rel="canonical" href="https://shop.example/c/sarees" data-commerce-edge="1" />');
        expect(html).toContain('"@type":"ItemList"');
        expect(html).toContain('"url":"https://shop.example/p/red-saree"');
        // A filtered view may open on another product: no image is preloaded for it.
        expect(html).not.toContain('rel="preload"');
    });

    it('preloads the first card of the plain listing', async () => {
        const { html } = await run('https://shop.example/c/sarees?utm_source=wa', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS });
        expect(html).toContain('<link rel="preload" as="image" href="https://cdn.example/card-640.webp" imagesrcset="https://cdn.example/card-320.webp 320w, https://cdn.example/card-640.webp 640w"');
    });

    it('answers 404 for a collection the API does not know', async () => {
        const { response } = await run('https://shop.example/c/nothing', { shopHosts: SHOP_HOST, globalSettings: SHOP_SETTINGS });
        expect(response.status).toBe(404);
    });
});

describe('redirects from the old site', () => {
    // The deployment names the hosts whose old addresses are resolved (Pages variable).
    const HOSTS = 'other.example, Shop.Example';
    const redirects = {
        '/product/red-saree': { status_code: 301, to_path: '/p/red-saree?lang=en' },
        '/hi/dummy': { status_code: 410, to_path: null },
        '/evil': { status_code: 301, to_path: 'https://evil.example/' },
    };

    it('answers 301 to the new address, query string included', async () => {
        const { response, shellServed } = await run('https://shop.example/product/red-saree/', { globalSettings: SHOP_SETTINGS, redirects, shopHosts: HOSTS });
        expect(response.status).toBe(301);
        expect(response.headers.get('location')).toBe('https://shop.example/p/red-saree?lang=en');
        expect(shellServed).toBe(0);
    });

    it('answers 410 Gone for a junk page', async () => {
        const { response, html } = await run('https://shop.example/hi/dummy/', { globalSettings: SHOP_SETTINGS, redirects, shopHosts: HOSTS });
        expect(response.status).toBe(410);
        expect(response.headers.get('x-robots-tag')).toBe('noindex');
        // In the shop's base language, not English.
        expect(html).toContain('<html lang="hi">');
        expect(html).toContain('यह पेज अब उपलब्ध नहीं है।');
    });

    it('makes no lookup at all on a shop host the deployment does not name', async () => {
        for (const hosts of [undefined, '', 'other.example']) {
            const { response, html, calls } = await run('https://shop.example/product/red-saree/', { globalSettings: SHOP_SETTINGS, redirects, shopHosts: hosts });
            expect(response.status, String(hosts)).toBe(200);
            expect(html, String(hosts)).toBe(INDEX_HTML);
            expect(calls, String(hosts)).toEqual([]);
        }
    });

    it('reads www and the bare host as the same shop', async () => {
        const { response } = await run('https://www.shop.example/product/red-saree/', { globalSettings: SHOP_SETTINGS, redirects, shopHosts: 'shop.example' });
        expect(response.status).toBe(301);
    });

    it('never looks up an app route, a dot folder, the manifest or the iOS association file', async () => {
        for (const path of ['/go/riya', '/companion/x', '/engagement/a/b', '/notebook/1', '/.well-known/assetlinks.json', '/.well-known/acme-challenge/tok', '/apple-app-site-association', '/x/site.webmanifest']) {
            const { html, calls } = await run(`https://shop.example${path}`, { globalSettings: SHOP_SETTINGS, redirects, shopHosts: HOSTS });
            expect(html, path).toBe(INDEX_HTML);
            expect(calls, path).toEqual([]);
        }
    });

    it('never redirects off the site', async () => {
        const { response, html } = await run('https://shop.example/evil', { globalSettings: SHOP_SETTINGS, redirects, shopHosts: HOSTS });
        expect(response.status).toBe(200);
        expect(html).toBe(INDEX_HTML);
    });

    it("does not ask the resolver for the site's own pages, the home page, app routes or assets", async () => {
        for (const path of ['/', '/about', '/about/team', '/login', '/dashboard/x', '/assets/app.js', '/search', '/cart', '/checkout', '/account/orders']) {
            const { response, html, calls } = await run(`https://shop.example${path}`, { globalSettings: SHOP_SETTINGS, redirects, shopHosts: HOSTS });
            expect(response.status, path).toBe(200);
            expect(html, path).toBe(INDEX_HTML);
            expect(calls.some((c) => c.url.includes('/redirects/resolve')), path).toBe(false);
        }
    });

    it('serves the page as before when no row matches', async () => {
        const { response, html } = await run('https://shop.example/some/unknown/path', { globalSettings: SHOP_SETTINGS, redirects, shopHosts: HOSTS });
        expect(response.status).toBe(200);
        expect(html).toBe(INDEX_HTML);
    });

    it('sends a Devanagari target as an ASCII Location that reads back as the same path', async () => {
        const slug = 'लाल-साड़ी';
        const rows = { '/hi/product/old': { status_code: 301, to_path: `/p/${slug}` } };
        const { response, shellServed } = await run('https://shop.example/hi/product/old/', { globalSettings: SHOP_SETTINGS, redirects: rows, shopHosts: HOSTS });
        expect(response.status).toBe(301);
        const location = response.headers.get('location')!;
        expect(location).toMatch(/^[\x21-\x7e]+$/);
        expect(location).toBe(`https://shop.example/p/${encodeURIComponent(slug)}`);
        expect(decodeURIComponent(new URL(location).pathname)).toBe(`/p/${slug}`);
        expect(shellServed).toBe(0);
    });

    it('does not encode an already encoded target a second time', async () => {
        const encoded = `/p/${encodeURIComponent('साड़ी')}?lang=en`;
        const rows = { '/product/old': { status_code: 301, to_path: encoded } };
        const { response } = await run('https://shop.example/product/old', { globalSettings: SHOP_SETTINGS, redirects: rows, shopHosts: HOSTS });
        expect(response.status).toBe(301);
        expect(response.headers.get('location')).toBe(`https://shop.example${encoded}`);
    });

    it('is not asked at all by a shop that has no redirects', async () => {
        const settings = { ...SHOP_SETTINGS, commerce: { ...SHOP_SETTINGS.commerce, redirects: false } };
        const { calls, html } = await run('https://shop.example/product/red-saree/', { globalSettings: settings, redirects, shopHosts: HOSTS });
        expect(html).toBe(INDEX_HTML);
        expect(calls.some((c) => c.url.includes('/redirects/resolve'))).toBe(false);
    });
});

describe('a platform host the deployment names', () => {
    // A staging copy of a shop on a platform subdomain, listed by name in the Pages variable.
    const REVIEW = 'shop-review.vacademy.io';
    const redirects = { '/product/red-saree': { status_code: 301, to_path: '/p/red-saree?lang=en' } };

    it('gets product heads when it is listed', async () => {
        const { response, html } = await run(`https://${REVIEW}/p/red-saree`, { shopHosts: `shop.example, ${REVIEW}`, globalSettings: SHOP_SETTINGS });
        expect(response.status).toBe(200);
        expect(html).toContain(`<link rel="canonical" href="https://${REVIEW}/p/red-saree" data-commerce-edge="1" />`);
        expect(html).toContain('<title>लाल साड़ी | Example Brand</title>');
    });

    it('gets old-site redirects when it is listed', async () => {
        const { response } = await run(`https://${REVIEW}/product/red-saree/`, { shopHosts: REVIEW, globalSettings: SHOP_SETTINGS, redirects });
        expect(response.status).toBe(301);
        expect(response.headers.get('location')).toBe(`https://${REVIEW}/p/red-saree?lang=en`);
    });

    it('answers 404 for an unknown product when it is listed', async () => {
        const { response, html } = await run(`https://${REVIEW}/p/nope`, { shopHosts: REVIEW, globalSettings: SHOP_SETTINGS });
        expect(response.status).toBe(404);
        expect(html).toContain('<meta name="robots" content="noindex"');
    });

    it('is left alone, with no backend call, when it is not listed', async () => {
        for (const hosts of [undefined, '', 'shop.example', 'other-review.vacademy.io', 'vacademy.io']) {
            for (const path of ['/p/red-saree', '/product/red-saree/']) {
                const { response, html, calls } = await run(`https://${REVIEW}${path}`, { shopHosts: hosts, globalSettings: SHOP_SETTINGS, redirects });
                expect(response.status, `${hosts} ${path}`).toBe(200);
                expect(html, `${hosts} ${path}`).toBe(INDEX_HTML);
                expect(calls, `${hosts} ${path}`).toEqual([]);
            }
        }
    });

    it('leaves the learner host unchanged when another platform host is listed', async () => {
        for (const path of ['/p/red-saree', '/product/red-saree/', '/some-tag/about']) {
            const { response, html, calls } = await run(`https://learner.vacademy.io${path}`, { shopHosts: REVIEW, globalSettings: SHOP_SETTINGS, redirects });
            expect(response.status, path).toBe(200);
            expect(html, path).toBe(INDEX_HTML);
            expect(calls, path).toEqual([]);
        }
    });
});

describe('a site without a shop', () => {
    const COURSE_SITE = { i18n: SHOP_SETTINGS.i18n };

    it('is served exactly as before on every path, with no call to the shop API', async () => {
        for (const path of ['/', '/about', '/p/red-saree', '/c/sarees', '/product/red-saree/', '/shop/p/red-saree', '/x/y/z']) {
            const { response, html, calls, shellServed } = await run(`https://school.example${path}`, { globalSettings: COURSE_SITE });
            expect(response.status, path).toBe(200);
            expect(html, path).toBe(INDEX_HTML);
            expect(shellServed, path).toBe(1);
            expect(calls.some((c) => c.url.includes('/open/')), path).toBe(false);
        }
    });

    it('makes no backend call at all for an ordinary page of a custom domain', async () => {
        // Before the shop existed a human page load returned the shell at once. It still does:
        // not the shop API, not domain routing, not the catalogue.
        for (const path of ['/about', '/about/team', '/product/red-saree/', '/x/y/z', '/go/riya', '/some-course-page', '/blog/a-post']) {
            const { html, calls, shellServed } = await run(`https://school.example${path}`, { globalSettings: COURSE_SITE });
            expect(html, path).toBe(INDEX_HTML);
            expect(shellServed, path).toBe(1);
            expect(calls, path).toEqual([]);
        }
    });

    it('makes no call for an address shaped like a shop page on a host the deployment does not name', async () => {
        for (const path of ['/p/red-saree', '/c/sarees', '/shop/p/red-saree', '/P/X']) {
            const { html, calls } = await run(`https://school.example${path}`, { globalSettings: COURSE_SITE });
            expect(html, path).toBe(INDEX_HTML);
            expect(calls, path).toEqual([]);
        }
    });

    it('on a named host, asks only whether the site has a shop for an address shaped like a shop page, under a deadline', async () => {
        const { html, calls } = await run('https://school.example/p/red-saree', { globalSettings: COURSE_SITE, shopHosts: 'school.example' });
        expect(html).toBe(INDEX_HTML);
        expect(lookups(calls)).toHaveLength(2);
        expect(calls).toHaveLength(2);
        // Both lookups can be cut short.
        expect(calls.every((c) => c.hasDeadline)).toBe(true);
    });

    it('serves the shell when the backend stops answering, instead of hanging the page', async () => {
        vi.useFakeTimers();
        try {
            for (const hang of [['branding'], ['catalogue']] as Array<Array<'branding' | 'catalogue'>>) {
                const pending = run('https://school.example/p/red-saree', { globalSettings: SHOP_SETTINGS, hang, shopHosts: 'school.example' });
                let settled = false;
                void pending.then(() => (settled = true));
                await vi.advanceTimersByTimeAsync(1400);
                expect(settled, hang.join()).toBe(false);
                await vi.advanceTimersByTimeAsync(200);
                const { response, html, shellServed } = await pending;
                expect(response.status, hang.join()).toBe(200);
                expect(html, hang.join()).toBe(INDEX_HTML);
                expect(shellServed, hang.join()).toBe(1);
            }
        } finally {
            vi.useRealTimers();
        }
    });

    it('asks the runtime to serve the static asset if the worker itself fails', async () => {
        const { passThrough } = await run('https://school.example/about', { globalSettings: COURSE_SITE });
        expect(passThrough).toBe(1);
    });

    it('makes no lookup at all for an ordinary page of a Vacademy host', async () => {
        const { calls, html } = await run('https://learner.vacademy.io/some-tag/about', { globalSettings: COURSE_SITE });
        expect(html).toBe(INDEX_HTML);
        expect(calls).toEqual([]);
    });

    it('keeps the crawler branch of a course site untouched', async () => {
        const { html } = await run('https://school.example/about', { globalSettings: {} }, 'Googlebot/2.1');
        expect(html).toContain('<title>About</title>');
        expect(html).not.toContain('data-commerce-edge');
    });
});
