/**
 * The shop's fixed routes. Pure: no React, no DOM, so the route
 * files, the root-mount resolver and the edge middleware share one reading of a path.
 *
 * Paths are given as the segments AFTER the site's base: ["p", "<slug>"] for "/p/<slug>" on a
 * root-mounted site and for "/<tag>/p/<slug>" on a shared host.
 */

/** First segments a shop owns. Not usable as page slugs or catalogue tags on a site with a shop. */
export const COMMERCE_RESERVED_SEGMENTS = [
    'p',
    'c',
    'q',
    'shop',
    'search',
    'cart',
    'checkout',
    'order',
    'track-order',
    'account',
] as const;

const RESERVED = new Set<string>(COMMERCE_RESERVED_SEGMENTS);

export const isCommerceReservedSegment = (segment: string | null | undefined): boolean =>
    !!segment && RESERVED.has(segment.toLowerCase());

export type CommerceRoute =
    | { kind: 'product'; slug: string }
    | { kind: 'collection'; slug: string }
    | { kind: 'search' }
    | { kind: 'cart' }
    | { kind: 'scan'; code: string }
    | { kind: 'checkout' }
    | { kind: 'order' }
    | { kind: 'track' }
    | { kind: 'account' };

/** The buying routes: one segment each, no record in the path (tokens travel elsewhere). */
const BUYING: Record<string, CommerceRoute> = {
    checkout: { kind: 'checkout' },
    order: { kind: 'order' },
    'track-order': { kind: 'track' },
    account: { kind: 'account' },
};

/** Checkout, order, track order and account: pages only a shop with checkout switched on answers. */
export const isBuyingRoute = (route: CommerceRoute): boolean =>
    route.kind === 'checkout' || route.kind === 'order' || route.kind === 'track' || route.kind === 'account';

const decode = (segment: string): string => {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
};

/** Slugs are lowercase Latin, digits and hyphens (one per record, shared by both languages). */
const SLUG = /^[a-z0-9][a-z0-9-]{0,159}$/;
/** A label code: letters, digits and a few separators, as printed on a label. */
const SCAN_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Which shop route the segments name; null for everything else (an authored page, a course,
 * another catalogue). "shop" is an authored page. The buying routes (checkout, order,
 * track-order, account) are one segment each: "account/orders" is not one of them.
 */
export const parseCommerceRoute = (segments: readonly string[]): CommerceRoute | null => {
    const parts = segments.filter((s) => s !== '');
    const first = (parts[0] || '').toLowerCase();
    if (parts.length === 1) {
        if (first === 'search') return { kind: 'search' };
        if (first === 'cart') return { kind: 'cart' };
        return Object.prototype.hasOwnProperty.call(BUYING, first) ? BUYING[first]! : null;
    }
    if (parts.length !== 2) return null;
    const second = decode(parts[1] || '');
    if (first === 'p' || first === 'c') {
        const slug = second.toLowerCase();
        if (!SLUG.test(slug)) return null;
        return first === 'p' ? { kind: 'product', slug } : { kind: 'collection', slug };
    }
    if (first === 'q') {
        return SCAN_CODE.test(second) ? { kind: 'scan', code: second } : null;
    }
    return null;
};

/** The route as a site-relative address ("p/<slug>"), the form CatalogueLink and pagePath take. */
export const commerceRouteTo = (route: CommerceRoute): string => {
    switch (route.kind) {
        case 'product':
            return `p/${encodeURIComponent(route.slug)}`;
        case 'collection':
            return `c/${encodeURIComponent(route.slug)}`;
        case 'search':
            return 'search';
        case 'cart':
            return 'cart';
        case 'scan':
            return `q/${encodeURIComponent(route.code)}`;
        case 'checkout':
            return 'checkout';
        case 'order':
            return 'order';
        case 'track':
            return 'track-order';
        case 'account':
            return 'account';
    }
};

/**
 * A path the public API returned ("/p/<slug>" or "/p/<slug>?lang=en") as a site-relative
 * address without its language: the site's own links carry the visitor's language themselves.
 */
export const apiPathTo = (path: string | null | undefined): string => {
    const raw = (path || '').trim();
    const [pathname, query = ''] = raw.split('?');
    const params = new URLSearchParams(query);
    params.delete('lang');
    const rest = params.toString();
    return `${(pathname || '').replace(/^\/+/, '')}${rest ? `?${rest}` : ''}`;
};

/** Adds query parameters to a site-relative address; null and empty values are left out. */
export const withQuery = (to: string, params: Record<string, string | null | undefined>): string => {
    const [pathname, query = ''] = to.split('?');
    const search = new URLSearchParams(query);
    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === '') search.delete(key);
        else search.set(key, value);
    }
    const rest = search.toString();
    return `${pathname}${rest ? `?${rest}` : ''}`;
};

/**
 * The page key the category bar is switched on by: "home" for the site's root, the fixed
 * route's kind ("collection", "product", "search", "cart", "scan", "checkout"…), else the
 * authored page's route ("shop", "our-story").
 */
export const commercePageKey = (segments: readonly string[]): string => {
    const parts = segments.filter((s) => s !== '');
    if (parts.length === 0) return 'home';
    const route = parseCommerceRoute(parts);
    if (route) return route.kind;
    const first = decode(parts[0] || '').toLowerCase();
    return first === 'homepage' ? 'home' : first;
};

/**
 * A browser path as the segments after the site's base ("/<tag>" on a shared host, "" on a
 * root-mounted one). A root-mounted site still answers on its tagged address, so a leading
 * tag segment is dropped as well.
 */
export const siteSegments = (pathname: string, basePath: string, tagName?: string | null): string[] => {
    let parts = (pathname || '').split('/').filter(Boolean);
    const base = (basePath || '').split('/').filter(Boolean);
    if (base.length > 0 && base.every((segment, i) => (parts[i] || '').toLowerCase() === segment.toLowerCase())) {
        parts = parts.slice(base.length);
    } else if (base.length === 0 && tagName && (parts[0] || '').toLowerCase() === tagName.toLowerCase()) {
        parts = parts.slice(1);
    }
    return parts;
};
