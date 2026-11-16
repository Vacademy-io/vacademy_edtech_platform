/**
 * Typed client of the public shop API:
 *
 *   GET  /admin-core-service/open/catalog/v1/products | /products/{slug} | /categories
 *   POST /admin-core-service/open/commerce/v1/cart/price
 *   GET  /admin-core-service/open/commerce/v1/pincode/{pin}
 *   GET  /admin-core-service/open/commerce/v1/q/{code}          (named by the design, not built yet)
 *   The buying routes of /open/commerce/v1 (checkout, otp, orders, me) and the stock-hold release.
 *
 * Tokens (session, verified phone, order access) travel in headers or JSON bodies only, never in
 * a URL, and the learner's own token is never sent: these are not learner calls.
 *
 * Plain fetch, no axios instance: these calls carry the site's publishable key and never the
 * learner's token or refresh cycle. The catalogue reads answer with Cache-Control max-age=60;
 * the browser cache honours that, and callers keep results for the same 60 seconds
 * (COMMERCE_STALE_MS), so a page never asks twice inside the window. A price is never cached.
 *
 * No price, total, tax or stock number is computed here: the server prices every line.
 */
import type {
    AddressView,
    CartPrice,
    CartPriceRequest,
    CategoryTree,
    CheckoutAddress,
    CheckoutConfig,
    CheckoutRequestBody,
    OrderPage,
    OrderView,
    OtpPurpose,
    OtpSent,
    OtpVerified,
    PincodeInfo,
    Placed,
    ProductDetail,
    ProductList,
    ProductListParams,
    ScanTarget,
    ShopperAuth,
    ShopperMe,
    Suggestions,
} from './types';

/** Header names of the buying routes (contract P2 §4). */
export const SESSION_HEADER = 'X-Commerce-Session';
export const PHONE_TOKEN_HEADER = 'X-Commerce-Phone-Token';
export const ORDER_TOKEN_HEADER = 'X-Commerce-Order-Token';

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
        public readonly retryAfter: number | null = null,
        /** The envelope's `details` object (`otp_allowed`, `reason`, `price`...), when sent. */
        public readonly details: Record<string, unknown> | null = null
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
    const details =
        envelope && envelope.details && typeof envelope.details === 'object' && !Array.isArray(envelope.details)
            ? (envelope.details as Record<string, unknown>)
            : null;
    return new CommerceApiError(
        errorKindOf(status, code),
        status,
        code,
        message,
        Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 600) : null,
        details
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

    /* buying */
    getCheckoutConfig(signal?: AbortSignal): Promise<CheckoutConfig>;
    requestOtp(body: { phone: string; purpose: OtpPurpose; challenge_token?: string | null }): Promise<OtpSent>;
    verifyOtp(body: { phone: string; code: string; purpose: OtpPurpose }): Promise<OtpVerified>;
    /** `session` is sent as X-Commerce-Session (proof of the phone for a prepaid order). */
    placeOrder(body: CheckoutRequestBody, opts?: { session?: string | null }): Promise<Placed>;
    confirmPayment(
        orderId: string,
        body: { gateway_order_id: string; gateway_payment_id: string; signature: string }
    ): Promise<Placed>;
    retryPayment(orderId: string, orderToken: string): Promise<Placed>;
    releaseHold(body: { payment_log_id: string; release_token: string }): Promise<{ released: number }>;
    viewOrder(orderToken: string, signal?: AbortSignal): Promise<OrderView>;
    trackOrder(body: { order_number: string; phone_token: string }): Promise<OrderView>;
    getMe(auth: ShopperAuth, signal?: AbortSignal): Promise<ShopperMe>;
    myOrders(auth: ShopperAuth, page: number, pageSize?: number, signal?: AbortSignal): Promise<OrderPage>;
    myAddresses(auth: ShopperAuth, signal?: AbortSignal): Promise<AddressView[]>;
    addAddress(auth: ShopperAuth, address: CheckoutAddress): Promise<AddressView>;
    updateAddress(auth: ShopperAuth, id: string, address: CheckoutAddress): Promise<AddressView>;
    deleteAddress(auth: ShopperAuth, id: string): Promise<void>;
    setConsent(auth: ShopperAuth, marketingConsent: boolean): Promise<ShopperMe>;
    /** Ends every session of this phone in this shop. */
    logout(auth: ShopperAuth): Promise<void>;
}

/** The header that proves the shopper on a /me call: the session wins when there is one. */
export const shopperAuthHeaders = (auth: ShopperAuth): Record<string, string> =>
    'session' in auth ? { [SESSION_HEADER]: auth.session } : { [PHONE_TOKEN_HEADER]: auth.phoneToken };

export const createCommerceClient = (options: CommerceClientOptions): CommerceClient => {
    const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const catalog = `${options.baseUrl}/admin-core-service/open/catalog/v1`;
    const commerce = `${options.baseUrl}/admin-core-service/open/commerce/v1`;

    const call = async <T>(
        url: string,
        init: RequestInit,
        extra: { headers?: Record<string, string>; empty?: boolean; noKey?: boolean } = {}
    ): Promise<T> => {
        let res: Response;
        try {
            res = await doFetch(url, {
                ...init,
                credentials: 'omit',
                headers: {
                    accept: 'application/json',
                    ...(extra.noKey ? {} : { 'X-API-Key': options.publishableKey }),
                    ...(init.body ? { 'content-type': 'application/json' } : {}),
                    ...(extra.headers || {}),
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
        // 204 (logout, delete): nothing to read.
        if (extra.empty) return undefined as T;
        if (body === null || typeof body !== 'object') {
            throw new CommerceApiError('server', res.status, '', 'empty response');
        }
        return body as T;
    };

    const get = <T>(url: string, signal?: AbortSignal) => call<T>(url, { method: 'GET', signal });
    /** A buying call: never cached, a JSON body when given, and the extra headers. */
    const send = <T>(
        method: string,
        url: string,
        body?: unknown,
        extra: { headers?: Record<string, string>; empty?: boolean; noKey?: boolean; signal?: AbortSignal } = {}
    ) =>
        call<T>(
            url,
            { method, cache: 'no-store', signal: extra.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
            extra
        );
    const me = `${commerce}/me`;

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

        // The answer is kept by the browser for 60 s (Cache-Control from the server).
        getCheckoutConfig: (signal) => get(`${commerce}/checkout/config`, signal),
        requestOtp: (body) => send('POST', `${commerce}/otp/request`, body),
        verifyOtp: (body) => send('POST', `${commerce}/otp/verify`, body),
        placeOrder: (body, opts) =>
            send('POST', `${commerce}/checkout`, { ...body, lines: body.lines.slice(0, MAX_CART_LINES), locale: options.locale }, {
                headers: opts?.session ? { [SESSION_HEADER]: opts.session } : undefined,
            }),
        confirmPayment: (orderId, body) => send('POST', `${commerce}/checkout/${encodeURIComponent(orderId)}/confirm-payment`, body),
        retryPayment: (orderId, orderToken) =>
            send('POST', `${commerce}/checkout/${encodeURIComponent(orderId)}/retry-payment`, {}, {
                headers: { [ORDER_TOKEN_HEADER]: orderToken },
            }),
        // Not a shop route: the stock-hold service takes no key.
        releaseHold: (body) => send('POST', `${options.baseUrl}/admin-core-service/open/v1/stock-hold/release`, body, { noKey: true }),
        viewOrder: (orderToken, signal) =>
            send('GET', `${commerce}/orders/view`, undefined, { headers: { [ORDER_TOKEN_HEADER]: orderToken }, signal }),
        trackOrder: (body) => send('POST', `${commerce}/orders/track`, body),
        getMe: (auth, signal) => send('GET', me, undefined, { headers: shopperAuthHeaders(auth), signal }),
        myOrders: (auth, page, pageSize = 20, signal) =>
            send('GET', `${me}/orders?page=${Math.max(0, Math.floor(page))}&page_size=${pageSize}`, undefined, {
                headers: shopperAuthHeaders(auth),
                signal,
            }),
        myAddresses: (auth, signal) => send('GET', `${me}/addresses`, undefined, { headers: shopperAuthHeaders(auth), signal }),
        addAddress: (auth, address) => send('POST', `${me}/addresses`, address, { headers: shopperAuthHeaders(auth) }),
        updateAddress: (auth, id, address) =>
            send('PUT', `${me}/addresses/${encodeURIComponent(id)}`, address, { headers: shopperAuthHeaders(auth) }),
        deleteAddress: (auth, id) =>
            send('DELETE', `${me}/addresses/${encodeURIComponent(id)}`, undefined, { headers: shopperAuthHeaders(auth), empty: true }),
        setConsent: (auth, marketingConsent) =>
            send('PUT', `${me}/consent`, { marketing_consent: marketingConsent }, { headers: shopperAuthHeaders(auth) }),
        logout: (auth) => send('POST', `${me}/logout`, {}, { headers: shopperAuthHeaders(auth), empty: true }),
    };
};
