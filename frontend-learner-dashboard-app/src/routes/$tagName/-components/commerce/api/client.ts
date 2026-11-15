/**
 * Typed client of the public shop API:
 *
 *   GET  /admin-core-service/open/catalog/v1/products | /products/{slug} | /categories
 *   POST /admin-core-service/open/commerce/v1/cart/price
 *   GET  /admin-core-service/open/commerce/v1/pincode/{pin}
 *   GET  /admin-core-service/open/commerce/v1/q/{code}          (named by the design, not built yet)
 *
 * Plain fetch, no axios instance: these calls carry the site's publishable key and never the
 * learner's token or refresh cycle. The catalogue reads answer with Cache-Control max-age=60;
 * the browser cache honours that, and callers keep results for the same 60 seconds
 * (COMMERCE_STALE_MS), so a page never asks twice inside the window. A price is never cached.
 *
 * No price, total, tax or stock number is computed here: the server prices every line.
 */
import type {
    CartPrice,
    CartPriceRequest,
    CategoryTree,
    PincodeInfo,
    ProductDetail,
    ProductList,
    ProductListParams,
    ScanTarget,
    Suggestions,
} from './types';

export const COMMERCE_STALE_MS = 60_000;

/** Cart lines the server accepts in one request (CommerceOrderService caps the same number). */
export const MAX_CART_LINES = 50;

export type CommerceErrorKind =
    | 'not_found'
    | 'not_enabled'
    | 'unauthorized'
    | 'rate_limited'
    | 'invalid'
    | 'conflict'
    | 'server'
    | 'network'
    | 'aborted';

export class CommerceApiError extends Error {
    constructor(
        public readonly kind: CommerceErrorKind,
        public readonly status: number,
        /** The API's own code (not_found, rate_limited, commerce_not_enabled, cart_not_priceable...). */
        public readonly code: string,
        message: string,
        /** Seconds, from Retry-After, when the API sent one. */
        public readonly retryAfter: number | null = null
    ) {
        super(message || code || kind);
        this.name = 'CommerceApiError';
    }

    /** Worth offering "Try again" (a missing product or a bad request is not). */
    get retryable(): boolean {
        return this.kind === 'network' || this.kind === 'server' || this.kind === 'rate_limited';
    }
}

/** Status and API code to the handful of cases the pages tell apart. */
export const errorKindOf = (status: number, code: string): CommerceErrorKind => {
    if (code === 'commerce_not_enabled') return 'not_enabled';
    if (status === 404 || code === 'not_found') return 'not_found';
    if (status === 429 || code === 'rate_limited') return 'rate_limited';
    if (status === 401 || status === 403) return 'unauthorized';
    if (status === 409) return 'conflict';
    if (status >= 400 && status < 500) return 'invalid';
    return 'server';
};

/** The Catalogue API error envelope: {"error":{"code","message","request_id","details"?}}. */
export const errorFromBody = (status: number, body: unknown, retryAfterHeader?: string | null): CommerceApiError => {
    const envelope =
        body && typeof body === 'object' && 'error' in body
            ? ((body as { error?: unknown }).error as Record<string, unknown> | undefined)
            : undefined;
    const code = typeof envelope?.code === 'string' ? envelope.code : '';
    const message = typeof envelope?.message === 'string' ? envelope.message : '';
    const seconds = Number(retryAfterHeader);
    return new CommerceApiError(
        errorKindOf(status, code),
        status,
        code,
        message,
        Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 600) : null
    );
};

export interface CommerceClientOptions {
    /** Backend origin, without a trailing slash. */
    baseUrl: string;
    publishableKey: string;
    locale: string;
    fetchImpl?: typeof fetch;
}

/** The query string of a listing call, in the names the controller reads. */
export const productListQuery = (params: ProductListParams, locale: string): string => {
    const search = new URLSearchParams();
    search.set('locale', locale);
    if (params.q && params.q.trim()) search.set('q', params.q.trim().slice(0, 120));
    if (params.collection) search.set('collection', params.collection);
    const filters = params.filters || {};
    for (const code of Object.keys(filters).sort()) {
        const values = (filters[code] || []).filter(Boolean);
        if (values.length) search.set(`filter.${code}`, values.join(','));
    }
    if (params.priceMin !== null && params.priceMin !== undefined) search.set('price_min', String(params.priceMin));
    if (params.priceMax !== null && params.priceMax !== undefined) search.set('price_max', String(params.priceMax));
    if (params.inStock !== undefined) search.set('in_stock', params.inStock ? 'true' : 'false');
    if (params.sort && params.sort !== 'recommended') search.set('sort', params.sort);
    if (params.page && params.page > 1) search.set('page', String(params.page));
    if (params.pageSize) search.set('page_size', String(params.pageSize));
    if (params.facets) search.set('facets', 'true');
    return search.toString();
};

export interface CommerceClient {
    readonly locale: string;
    listProducts(params: ProductListParams, signal?: AbortSignal): Promise<ProductList>;
    suggest(q: string, signal?: AbortSignal): Promise<Suggestions>;
    getProduct(slug: string, signal?: AbortSignal): Promise<ProductDetail>;
    getCategories(opts?: { kind?: string; minInStock?: number }, signal?: AbortSignal): Promise<CategoryTree>;
    priceCart(body: CartPriceRequest, signal?: AbortSignal): Promise<CartPrice>;
    getPincode(pin: string, signal?: AbortSignal): Promise<PincodeInfo>;
    resolveScan(code: string, signal?: AbortSignal): Promise<ScanTarget>;
}

export const createCommerceClient = (options: CommerceClientOptions): CommerceClient => {
    const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const catalog = `${options.baseUrl}/admin-core-service/open/catalog/v1`;
    const commerce = `${options.baseUrl}/admin-core-service/open/commerce/v1`;

    const call = async <T>(url: string, init: RequestInit): Promise<T> => {
        let res: Response;
        try {
            res = await doFetch(url, {
                ...init,
                credentials: 'omit',
                headers: {
                    accept: 'application/json',
                    'X-API-Key': options.publishableKey,
                    ...(init.body ? { 'content-type': 'application/json' } : {}),
                },
            });
        } catch (cause) {
            const aborted = (cause as { name?: string } | null)?.name === 'AbortError';
            throw new CommerceApiError(aborted ? 'aborted' : 'network', 0, '', aborted ? 'aborted' : 'network');
        }
        let body: unknown = null;
        try {
            body = await res.json();
        } catch {
            // Not JSON (a proxy page): the status decides.
        }
        if (!res.ok) throw errorFromBody(res.status, body, res.headers.get('retry-after'));
        if (body === null || typeof body !== 'object') {
            throw new CommerceApiError('server', res.status, '', 'empty response');
        }
        return body as T;
    };

    const get = <T>(url: string, signal?: AbortSignal) => call<T>(url, { method: 'GET', signal });

    return {
        locale: options.locale,
        listProducts: (params, signal) => get(`${catalog}/products?${productListQuery(params, options.locale)}`, signal),
        suggest: (q, signal) =>
            get(
                `${catalog}/products?${new URLSearchParams({
                    locale: options.locale,
                    suggest: '1',
                    q: q.trim().slice(0, 120),
                }).toString()}`,
                signal
            ),
        getProduct: (slug, signal) =>
            get(`${catalog}/products/${encodeURIComponent(slug)}?locale=${encodeURIComponent(options.locale)}`, signal),
        getCategories: (opts, signal) => {
            const search = new URLSearchParams({ locale: options.locale });
            if (opts?.kind) search.set('kind', opts.kind);
            if (opts?.minInStock) search.set('min_in_stock', String(opts.minInStock));
            return get(`${catalog}/categories?${search.toString()}`, signal);
        },
        priceCart: (body, signal) =>
            call(`${commerce}/cart/price`, {
                method: 'POST',
                signal,
                cache: 'no-store',
                body: JSON.stringify({ ...body, lines: body.lines.slice(0, MAX_CART_LINES), locale: options.locale }),
            }),
        getPincode: (pin, signal) =>
            get(`${commerce}/pincode/${encodeURIComponent(pin)}?locale=${encodeURIComponent(options.locale)}`, signal),
        resolveScan: (code, signal) => get(`${commerce}/q/${encodeURIComponent(code)}`, signal),
    };
};
