/**
 * What the edge middleware (functions/_middleware.ts) needs for a shop: which paths are
 * product and collection pages, the head tags they get on EVERY request (title,
 * description, canonical, hreflang, Open Graph, Product / BreadcrumbList /
 * ItemList JSON-LD), and the old-site redirects (301 and 410).
 *
 * Pure and dependency-free (no React, no DOM, no fetch), so the middleware bundle stays small
 * and every rule here is unit-tested. The middleware does the fetching and fails open: when
 * anything is missing it serves the page exactly as it did before the shop existed.
 */
import { parseCommerceRoute, type CommerceRoute } from '../routes';
import { parseCommerceConfig } from '../config';
import { formatMoney, perUnitAmount } from '../logic/format';
import { imageSource, orderGallery } from '../logic/media';
import { activeVariant, initialSelection } from '../logic/options';
import { isMeasured } from '../logic/stock';
import type { Category, Media, ProductCard, ProductDetail } from '../api/types';

export interface EdgeShop {
    publishableKey: string;
    /** The language of the bare path: the site's own base language. */
    baseLocale: string;
    locales: string[];
    leadTag: string;
    /** Google Fonts families the shop's theme names, to start loading with the document. */
    fonts: string[];
    /** The site has old-site redirects to resolve. */
    redirects: boolean;
}

const LOCALE_SHAPE = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/;

/** The shop of a site from its global settings; null for a site without one (every course site). */
export const edgeShopOf = (globalSettings: unknown): EdgeShop | null => {
    const config = parseCommerceConfig(globalSettings);
    if (!config.enabled) return null;
    const i18n = (globalSettings as { i18n?: { defaultLocale?: unknown } } | null)?.i18n;
    const siteBase = typeof i18n?.defaultLocale === 'string' ? i18n.defaultLocale.trim().toLowerCase() : '';
    const baseLocale = LOCALE_SHAPE.test(siteBase) ? siteBase : config.baseLocale || config.locales[0] || 'hi';
    return {
        publishableKey: config.publishableKey,
        baseLocale,
        locales: Array.from(new Set([baseLocale, ...config.locales])),
        leadTag: config.media.leadTag,
        fonts: [config.theme.displayFont, config.theme.textFont].filter(Boolean),
        redirects: config.redirects,
    };
};

export interface EdgeTarget {
    /** Catalogue tag the path belongs to. */
    tag: string;
    rootMounted: boolean;
    route: CommerceRoute;
}

/**
 * The shop route a path names, in the two shapes a site has: "/p/<slug>" on a host whose
 * catalogue is mounted at the root, "/<tag>/p/<slug>" elsewhere. The root-mounted reading wins.
 * Only product and collection pages get head tags; search and cart are not indexed.
 */
export const edgeTargetOf = (segments: readonly string[], rootTag: string | null | undefined): EdgeTarget | null => {
    const wanted = (route: CommerceRoute | null) =>
        route && (route.kind === 'product' || route.kind === 'collection') ? route : null;
    if (rootTag) {
        const route = wanted(parseCommerceRoute(segments));
        if (route) return { tag: rootTag, rootMounted: true, route };
    }
    if (segments.length === 3 && segments[0]) {
        const route = wanted(parseCommerceRoute(segments.slice(1)));
        if (route) return { tag: segments[0], rootMounted: false, route };
    }
    return null;
};

/** Cheap first test, before any lookup: could this path be a product or collection page at all? */
export const looksLikeCommercePath = (segments: readonly string[]): boolean => {
    if (segments.length < 2 || segments.length > 3) return false;
    const marker = (segments[segments.length - 2] || '').toLowerCase();
    return marker === 'p' || marker === 'c';
};

/** The language a request is in: ?lang= when the shop offers it, else the base language. */
export const edgeLocale = (shop: EdgeShop, langParam: string | null | undefined): string => {
    const wanted = (langParam || '').trim().toLowerCase();
    return wanted && shop.locales.includes(wanted) ? wanted : shop.baseLocale;
};

/* ── tags ─────────────────────────────────────────────────────────── */

export const escapeAttr = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** JSON for a script element: "</" would end the element early, and U+2028/9 break older parsers. */
export const jsonLd = (data: unknown): string =>
    JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');

const clean = (value: string | null | undefined): string => (typeof value === 'string' ? value.trim() : '');

const summary = (value: string, max: number): string => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    const cut = text.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
};

/** "/p/x" or "/p/x?lang=en": the address of one language version under the site's base path. */
export const localizedPath = (pathname: string, locale: string, baseLocale: string): string =>
    locale === baseLocale ? pathname : `${pathname}?lang=${encodeURIComponent(locale)}`;

const isImage = (media: Media | null | undefined): media is Media =>
    !!media && !!media.url && (media.kind || 'IMAGE').toUpperCase() === 'IMAGE';

/** The image a share card shows: the lead-tag photo where the seller set a lead tag, else the first. */
export const leadImageUrl = (media: readonly Media[] | null | undefined, leadTag: string): string => {
    const images = (media || []).filter(isImage).sort((a, b) => a.position - b.position);
    const lead = leadTag ? images.find((m) => (m.tag || '').toUpperCase() === leadTag.toUpperCase()) : undefined;
    return (lead || images[0])?.url || '';
};

const AVAILABILITY: Record<string, string> = {
    IN_STOCK: 'https://schema.org/InStock',
    LOW: 'https://schema.org/LimitedAvailability',
    OUT: 'https://schema.org/OutOfStock',
    MADE_TO_ORDER: 'https://schema.org/MadeToOrder',
};

export interface EdgeHead {
    title: string;
    description: string;
    /** Document language. */
    lang: string;
    /**
     * The page's own tags (canonical, hreflang, Open Graph, JSON-LD), each marked
     * data-commerce-edge: the app replaces them when the visitor moves to another shop page.
     */
    tags: string[];
    /**
     * Tags that belong to the document, not to one page: the font stylesheet, the image
     * preload and the page data. Unmarked, so the app never removes them.
     */
    resources: string[];
}

export interface EdgePageInput {
    /** "https://shop.example" */
    origin: string;
    /** "/p/<slug>" or "/<tag>/p/<slug>": the request path without a trailing slash. */
    pathname: string;
    /** "" for a root-mounted site, "/<tag>" otherwise. */
    basePath: string;
    shop: EdgeShop;
    locale: string;
    siteName: string;
    /** og:image, already proxied or resized by the middleware; "" for none. */
    ogImage: string;
}

const MARK = 'data-commerce-edge="1"';

/** Open Graph wants language_TERRITORY; the shop sells in India. */
export const ogLocale = (locale: string): string => {
    const [language = '', region = ''] = locale.split('-');
    if (region) return `${language}_${region.toUpperCase()}`;
    return /^[a-z]{2,3}$/.test(language) ? `${language}_IN` : locale;
};

/** What one unit of a measured product is called in a share card, and its UN/CEFACT code for search engines. */
const UNIT_NAMES: Record<string, { code: string; hi: string; en: string }> = {
    MTR: { code: 'MTR', hi: 'मीटर', en: 'metre' },
    M: { code: 'MTR', hi: 'मीटर', en: 'metre' },
    METER: { code: 'MTR', hi: 'मीटर', en: 'metre' },
    METRE: { code: 'MTR', hi: 'मीटर', en: 'metre' },
    KG: { code: 'KGM', hi: 'किलो', en: 'kg' },
    KGS: { code: 'KGM', hi: 'किलो', en: 'kg' },
};

/**
 * The price a shopper compares: the API prices ONE base unit (10 cm of cloth), so a product
 * sold by length or weight is shown per whole unit (a metre), never per base unit.
 */
export const shownPrice = (
    amount: number | null | undefined,
    qtyScale: number | null | undefined,
    unit: string | null | undefined,
    locale: string
): { amount: number | null; unitName: string; unitCode: string } => {
    const scale = Math.max(1, Math.floor(qtyScale || 1));
    if (typeof amount !== 'number') return { amount: null, unitName: '', unitCode: '' };
    if (!isMeasured(scale)) return { amount, unitName: '', unitCode: '' };
    const names = UNIT_NAMES[(unit || '').toUpperCase()];
    return {
        amount: perUnitAmount(amount, scale),
        unitName: names ? (locale.startsWith('hi') ? names.hi : names.en) : '',
        unitCode: names?.code || '',
    };
};

const commonTags = (input: EdgePageInput, title: string, description: string, locales: string[], type: string): string[] => {
    const { origin, pathname, shop, locale } = input;
    const canonical = `${origin}${localizedPath(pathname, locale, shop.baseLocale)}`;
    const tags = [
        `<link rel="canonical" href="${escapeAttr(canonical)}" ${MARK} />`,
        // Alternates pair the language versions; a page in one language has none.
        ...(locales.length > 1
            ? [
                  ...locales.map(
                      (l) =>
                          `<link rel="alternate" hreflang="${escapeAttr(l)}" href="${escapeAttr(
                              `${origin}${localizedPath(pathname, l, shop.baseLocale)}`
                          )}" ${MARK} />`
                  ),
                  `<link rel="alternate" hreflang="x-default" href="${escapeAttr(`${origin}${pathname}`)}" ${MARK} />`,
              ]
            : []),
        `<meta property="og:title" content="${escapeAttr(title)}" ${MARK} />`,
        `<meta property="og:description" content="${escapeAttr(description)}" ${MARK} />`,
        `<meta property="og:type" content="${type}" ${MARK} />`,
        `<meta property="og:url" content="${escapeAttr(canonical)}" ${MARK} />`,
        `<meta property="og:locale" content="${escapeAttr(ogLocale(locale))}" ${MARK} />`,
        ...(input.siteName ? [`<meta property="og:site_name" content="${escapeAttr(input.siteName)}" ${MARK} />`] : []),
        ...(input.ogImage
            ? [
                  `<meta property="og:image" content="${escapeAttr(input.ogImage)}" ${MARK} />`,
                  `<meta name="twitter:image" content="${escapeAttr(input.ogImage)}" ${MARK} />`,
              ]
            : []),
        `<meta name="twitter:card" content="${input.ogImage ? 'summary_large_image' : 'summary'}" ${MARK} />`,
        `<meta name="twitter:title" content="${escapeAttr(title)}" ${MARK} />`,
        `<meta name="twitter:description" content="${escapeAttr(description)}" ${MARK} />`,
    ];
    return tags;
};

/** Google Fonts for the shop's theme, linked from the document so text does not wait for the app. */
export const fontTags = (families: readonly string[]): string[] => {
    const names = Array.from(new Set(families.map((f) => f.trim()).filter((f) => /^[A-Za-z0-9 ]{2,40}$/.test(f))));
    if (!names.length) return [];
    const query = names.map((n) => `family=${n.replace(/ /g, '+')}:wght@400;600`).join('&');
    // Not marked: the stylesheet stays for the whole visit (the app looks for it by address).
    return [
        '<link rel="preconnect" href="https://fonts.googleapis.com" />',
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
        `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${query}&amp;display=swap" />`,
    ];
};

/**
 * Starts the page's largest image with the document instead of after the app, the catalogue,
 * the shop's code and the product have loaded. Same sources and sizes as the <img> the page
 * draws, so the browser reuses the download.
 */
export const preloadImageTag = (media: Media | null | undefined, sizes: string): string | null => {
    const source = imageSource(media);
    if (!source) return null;
    return (
        `<link rel="preload" as="image" href="${escapeAttr(source.src)}"` +
        (source.srcSet ? ` imagesrcset="${escapeAttr(source.srcSet)}" imagesizes="${escapeAttr(sizes)}"` : '') +
        ' fetchpriority="high" />'
    );
};

/** The first picture of a product page as the page itself orders the gallery (variant from ?v=, lead tag). */
export const firstGalleryImage = (product: ProductDetail, leadTag: string, wantedSku?: string | null): Media | null => {
    const options = product.options || [];
    const variants = [...(product.variants || [])].sort((a, b) => a.position - b.position);
    const variant = options.length > 0 ? activeVariant(options, variants, initialSelection(options, variants, wantedSku || null)) : null;
    const first = orderGallery(product.media || [], leadTag, variant?.id)[0];
    return first && (first.kind || 'IMAGE').toUpperCase() === 'IMAGE' ? first : null;
};

export const SEED_ELEMENT_ID = 'commerce-seed';

export interface EdgeSeed {
    kind: 'product';
    slug: string;
    locale: string;
    data: ProductDetail;
}

/**
 * The product response the edge already holds, written into the document so the page does not
 * ask for it again. Data, not code: type application/json, and "<" is escaped.
 */
export const seedTag = (seed: EdgeSeed): string =>
    `<script type="application/json" id="${SEED_ELEMENT_ID}">${jsonLd(seed)}</script>`;

const breadcrumb = (items: Array<{ name: string; url: string }>) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: item.url,
    })),
});

const script = (data: unknown): string => `<script type="application/ld+json" ${MARK}>${jsonLd(data)}</script>`;

/** Head of a product page, from the same 60-second product response a shopper's page reads. */
export const productHead = (input: EdgePageInput, product: ProductDetail): EdgeHead => {
    const { origin, pathname, basePath, shop, locale, siteName } = input;
    const name = clean(product.name);
    const currency = clean(product.price?.currency) || 'INR';
    // Per metre for cloth, per piece otherwise: never the price of one base unit.
    const shown = shownPrice(product.price?.amount, product.qty_scale, product.unit, locale);
    const price = shown.amount;
    const money = formatMoney(price, currency);
    const priceText = money && shown.unitName ? `${money} / ${shown.unitName}` : money;
    const perUnit = (amount: number): number => shownPrice(amount, product.qty_scale, product.unit, locale).amount as number;
    const seoTitle = clean(product.seo?.title) || name;
    const title = siteName && !seoTitle.includes(siteName) ? `${seoTitle} | ${siteName}` : seoTitle;
    const description = summary(clean(product.seo?.description) || clean(product.short_description) || name, 200);
    const available = (product.seo?.alternates || []).map((a) => clean(a.locale).toLowerCase());
    // Only languages the product has text in AND the shop offers; the base language always.
    const locales = shop.locales.filter((l) => l === shop.baseLocale || available.includes(l));
    // A language the product has no text in is served in the base language: point at that page.
    const pageLocale = locales.includes(locale) ? locale : shop.baseLocale;
    const canonical = `${origin}${localizedPath(pathname, pageLocale, shop.baseLocale)}`;
    const ogTitle = priceText ? `${name} · ${priceText}` : name;
    const tags = commonTags({ ...input, locale: pageLocale }, ogTitle, description, locales, 'product');
    if (typeof price === 'number') {
        tags.push(
            `<meta property="product:price:amount" content="${escapeAttr(String(price))}" ${MARK} />`,
            `<meta property="product:price:currency" content="${escapeAttr(currency)}" ${MARK} />`
        );
    }
    const images = (product.media || [])
        .filter(isImage)
        .sort((a, b) => a.position - b.position)
        .map((m) => m.url as string)
        .slice(0, 8);
    const lead = leadImageUrl(product.media, shop.leadTag);
    const orderedImages = lead ? [lead, ...images.filter((u) => u !== lead)] : images;
    const variants = (product.variants || []).filter((v) => typeof v.price?.amount === 'number');
    const offerOf = (amount: number, state: string | undefined, sku?: string | null) => ({
        '@type': 'Offer',
        price: amount,
        priceCurrency: currency,
        // For goods sold by length or weight the price is for one unit: say which.
        ...(shown.unitCode
            ? {
                  priceSpecification: {
                      '@type': 'UnitPriceSpecification',
                      price: amount,
                      priceCurrency: currency,
                      referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: shown.unitCode },
                  },
              }
            : {}),
        availability: AVAILABILITY[state || ''] || AVAILABILITY.OUT,
        url: canonical,
        itemCondition: 'https://schema.org/NewCondition',
        ...(sku ? { sku } : {}),
    });
    const amounts = variants.map((v) => v.price!.amount as number);
    // Variants at different prices: one Offer each (an AggregateOffer is not eligible for
    // merchant listings), capped so a product with many sizes does not bloat the head.
    const offers =
        variants.length > 1 && Math.min(...amounts) !== Math.max(...amounts)
            ? variants.slice(0, 30).map((v) => offerOf(perUnit(v.price!.amount as number), v.stock?.state || product.stock?.state, v.sku))
            : typeof price === 'number'
              ? offerOf(price, product.stock?.state, variants.length === 1 ? variants[0]!.sku : undefined)
              : undefined;
    const productLd: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        '@id': `${origin}${pathname}#product`,
        name,
        description,
        url: canonical,
        inLanguage: pageLocale,
        ...(orderedImages.length ? { image: orderedImages } : {}),
        ...(variants.length === 1 && variants[0]!.sku ? { sku: variants[0]!.sku } : {}),
        ...(clean(product.brand) || siteName
            ? { brand: { '@type': 'Brand', name: clean(product.brand) || siteName } }
            : {}),
        ...(offers ? { offers } : {}),
    };
    tags.push(script(productLd));
    const category = (product.collections || []).find((c) => (c.kind || '').toUpperCase() === 'CATEGORY');
    const home = `${origin}${basePath || ''}/`.replace(/([^:])\/\/$/, '$1/');
    const crumbs = [{ name: siteName || 'Home', url: home }];
    if (category && clean(category.name)) {
        crumbs.push({
            name: clean(category.name),
            url: `${origin}${localizedPath(`${basePath}/c/${encodeURIComponent(category.slug)}`, pageLocale, shop.baseLocale)}`,
        });
    }
    crumbs.push({ name, url: canonical });
    tags.push(script(breadcrumb(crumbs)));
    return { title, description, lang: pageLocale, tags, resources: fontTags(shop.fonts) };
};

/** The node of a collection in the category tree, with the names of the nodes above it. */
export const findCategory = (
    tree: readonly Category[] | null | undefined,
    slug: string,
    trail: Category[] = []
): { node: Category; parents: Category[] } | null => {
    for (const node of tree || []) {
        if (!node) continue;
        if (node.slug === slug) return { node, parents: trail };
        const below = findCategory(node.children, slug, [...trail, node]);
        if (below) return below;
    }
    return null;
};

/**
 * Head of a collection page. The canonical is always the bare listing: a filtered or sorted
 * view (query string) points at it, so filters never fork the page into indexed copies.
 */
export const collectionHead = (
    input: EdgePageInput,
    found: { node: Category; parents: Category[] },
    products: readonly ProductCard[]
): EdgeHead => {
    const { origin, pathname, basePath, shop, locale, siteName } = input;
    const name = clean(found.node.name) || found.node.slug;
    const title = siteName ? `${name} | ${siteName}` : name;
    const description = summary(clean(found.node.description) || name, 200);
    const canonical = `${origin}${localizedPath(pathname, locale, shop.baseLocale)}`;
    const tags = commonTags(input, name, description, shop.locales, 'website');
    const urlOf = (path: string) => `${origin}${localizedPath(`${basePath}${path}`, locale, shop.baseLocale)}`;
    const home = `${origin}${basePath || ''}/`.replace(/([^:])\/\/$/, '$1/');
    tags.push(
        script(
            breadcrumb([
                { name: siteName || 'Home', url: home },
                ...found.parents.map((p) => ({
                    name: clean(p.name) || p.slug,
                    url: urlOf(`/c/${encodeURIComponent(p.slug)}`),
                })),
                { name, url: canonical },
            ])
        )
    );
    if (products.length) {
        tags.push(
            script({
                '@context': 'https://schema.org',
                '@type': 'ItemList',
                name,
                numberOfItems: products.length,
                itemListElement: products.slice(0, 24).map((p, index) => ({
                    '@type': 'ListItem',
                    position: index + 1,
                    name: clean(p.name),
                    url: urlOf(`/p/${encodeURIComponent(p.slug)}`),
                })),
            })
        );
    }
    return { title, description, lang: locale, tags, resources: fontTags(shop.fonts) };
};

/**
 * Writes a head into the SPA shell: title, description, the tags before </head>, and the
 * document language. Idempotent markers (data-commerce-edge) let the app remove these tags
 * when it takes over the head after a client-side navigation.
 */
export const injectHead = (html: string, head: EdgeHead, opts: { noindex?: boolean } = {}): string => {
    // Function replacers throughout: product text is data, and "$&" or "$'" in a replacement
    // STRING would paste parts of the page into the head.
    const title = `<title>${escapeAttr(head.title)}</title>`;
    let out = html.replace(/<title>[^<]*<\/title>/, () => title);
    const description = `<meta name="description" content="${escapeAttr(head.description)}" />`;
    out = /<meta name="description"[^>]*>/.test(out)
        ? out.replace(/<meta name="description"[^>]*>/, () => description)
        : out.replace('</head>', () => `    ${description}\n  </head>`);
    const tags = [
        ...(head.resources || []),
        ...head.tags,
        ...(opts.noindex ? [`<meta name="robots" content="noindex" ${MARK} />`] : []),
    ];
    if (tags.length) out = out.replace('</head>', () => `    ${tags.join('\n    ')}\n  </head>`);
    return out.replace(/<html([^>]*)>/, (_match, attrs: string) => {
        const lang = `lang="${escapeAttr(head.lang)}"`;
        return /\slang="[^"]*"/.test(attrs) ? `<html${attrs.replace(/\slang="[^"]*"/, ` ${lang}`)}>` : `<html ${lang}${attrs}>`;
    });
};

/* ── redirects from the old site ──────────────────────────────────── */

/**
 * A path as `site_redirect.from_path` stores it: percent-decoded
 * (either hex case), Unicode NFC, ASCII lower-cased, without a trailing slash. The query
 * string is kept as sent, for PREFIX rows that match on it.
 */
export const normalizeRedirectPath = (pathname: string, search = ''): string => {
    let path = pathname;
    try {
        path = decodeURIComponent(pathname);
    } catch {
        // A malformed escape: compare the raw path.
    }
    path = path.normalize('NFC').replace(/[A-Z]/g, (c) => c.toLowerCase());
    path = path.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
    return `${path}${search && search !== '?' ? search : ''}`;
};

/**
 * The `path` the edge asks the resolver for: the request in the stored normal form, with each `%`
 * of the decoded path written as `%25`. The resolver decodes the path once more; without this, a
 * path that holds a literal `%41` once decoded (the request `/%2541`) would be decoded twice and
 * looked up as `/a`. The query string is passed as the browser sent it.
 */
export const redirectLookupPath = (pathname: string, search = ''): string => {
    const normal = normalizeRedirectPath(pathname);
    return `${normal.replace(/%/g, '%25')}${search && search !== '?' ? search : ''}`;
};

export type RedirectDecision = { status: 301; location: string } | { status: 410 } | null;

const UTF8 = new TextEncoder();

/**
 * A redirect target as a `Location` header can carry it: every character outside printable
 * ASCII (a Devanagari slug, a space) is percent-encoded as UTF-8, so the header is always
 * ASCII. What is already ASCII is left as it is: an existing `%XX` escape is not encoded again
 * and the query string's `?`, `&` and `=` keep their meaning. A `%` that starts no escape
 * becomes `%25`. A header value with a non-ASCII character is refused by the runtime, so
 * without this the visitor would get no redirect at all.
 */
export const asciiLocation = (target: string): string => {
    let out = '';
    for (let i = 0; i < target.length; ) {
        const code = target.codePointAt(i) ?? 0;
        const char = String.fromCodePoint(code);
        i += char.length;
        if (code === 0x25) {
            out += /^[0-9a-f]{2}$/i.test(target.slice(i, i + 2)) ? '%' : '%25';
        } else if (code > 0x20 && code < 0x7f) {
            out += char;
        } else {
            // A lone surrogate is encoded as U+FFFD, as TextEncoder does.
            for (const byte of UTF8.encode(char)) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
        }
    }
    return out;
};

/**
 * The answer of GET /open/commerce/v1/redirects/resolve?path= turned into what the edge does.
 * The endpoint answers 200 with
 * {"status_code": 301, "to_path": "/p/x?lang=en"} or {"status_code": 410}; 404 when no row
 * matches. A target is followed only when it is a path on this site: an absolute URL, a
 * protocol-relative one or a target equal to the request would be an open redirect or a loop.
 */
export const redirectDecision = (body: unknown, requestPath: string, basePath = ''): RedirectDecision => {
    if (!body || typeof body !== 'object') return null;
    const data = body as { status_code?: unknown; statusCode?: unknown; to_path?: unknown; toPath?: unknown };
    const status = Number(data.status_code ?? data.statusCode);
    if (status === 410) return { status: 410 };
    if (status !== 301) return null;
    const raw = data.to_path ?? data.toPath;
    const target = typeof raw === 'string' ? raw.trim() : '';
    if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\') || /[\r\n]/.test(target)) return null;
    const location = asciiLocation(`${basePath}${target}`);
    if (normalizeRedirectPath(location.split(/[?#]/)[0] || '/') === normalizeRedirectPath(requestPath)) return null;
    return { status: 301, location };
};
