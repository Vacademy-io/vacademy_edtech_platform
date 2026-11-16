import { describe, expect, it } from 'vitest';
import { CommerceApiError, MAX_CART_LINES, createCommerceClient, errorFromBody, errorKindOf, productListQuery } from './client';

const KEY = `vak_pub_${'a1'.repeat(24)}`;

const stub = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init || {} });
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json', ...headers },
        });
    }) as typeof fetch;
    const client = createCommerceClient({ baseUrl: 'https://api.example', publishableKey: KEY, locale: 'hi', fetchImpl });
    return { client, calls };
};

describe('requests', () => {
    it('reads a product with the publishable key and the locale, without cookies', async () => {
        const { client, calls } = stub(200, { id: 'p1', slug: 'red-saree' });
        const product = await client.getProduct('red-saree');
        expect(product.slug).toBe('red-saree');
        expect(calls[0]!.url).toBe('https://api.example/admin-core-service/open/catalog/v1/products/red-saree?locale=hi');
        expect(calls[0]!.init.method).toBe('GET');
        expect(calls[0]!.init.credentials).toBe('omit');
        expect((calls[0]!.init.headers as Record<string, string>)['X-API-Key']).toBe(KEY);
        expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it('asks for suggestions and categories on the catalogue base', async () => {
        const { client, calls } = stub(200, { products: [], collections: [], total: 0, data: [] });
        await client.suggest('  साड़ी ');
        await client.getCategories({ kind: 'CATEGORY', minInStock: 4 });
        expect(calls[0]!.url).toBe(
            `https://api.example/admin-core-service/open/catalog/v1/products?locale=hi&suggest=1&q=${encodeURIComponent('साड़ी')}`
        );
        expect(calls[1]!.url).toBe('https://api.example/admin-core-service/open/catalog/v1/categories?locale=hi&kind=CATEGORY&min_in_stock=4');
    });

    it('prices a cart with POST, never from a cache, and caps the lines', async () => {
        const { client, calls } = stub(200, { lines: [], totals: { total: 0 } });
        const lines = Array.from({ length: MAX_CART_LINES + 10 }, (_, i) => ({ line_ref: `v${i}`, variant_id: `v${i}`, quantity: 1 }));
        await client.priceCart({ lines, pincode: '482001', payment_method: 'PREPAID' });
        const call = calls[0]!;
        expect(call.url).toBe('https://api.example/admin-core-service/open/commerce/v1/cart/price');
        expect(call.init.method).toBe('POST');
        expect(call.init.cache).toBe('no-store');
        const sent = JSON.parse(call.init.body as string) as { lines: unknown[]; locale: string; pincode: string };
        expect(sent.lines).toHaveLength(MAX_CART_LINES);
        expect(sent.locale).toBe('hi');
        expect(sent.pincode).toBe('482001');
        expect((call.init.headers as Record<string, string>)['content-type']).toBe('application/json');
    });

    it('escapes what goes into a path', async () => {
        const { client, calls } = stub(200, { pincode: '482001' });
        await client.getPincode('48 2001/x');
        await client.resolveScan('PC-1?x');
        expect(calls[0]!.url).toContain('/open/commerce/v1/pincode/48%202001%2Fx?locale=hi');
        expect(calls[1]!.url).toBe('https://api.example/admin-core-service/open/commerce/v1/q/PC-1%3Fx');
    });

    it('trims and caps the search text of a listing', () => {
        const query = new URLSearchParams(productListQuery({ q: `  ${'x'.repeat(300)}  `, page: 3 }, 'en'));
        expect(query.get('q')).toHaveLength(120);
        expect(query.get('page')).toBe('3');
        expect(new URLSearchParams(productListQuery({ page: 1, sort: 'recommended' }, 'en')).has('page')).toBe(false);
    });
});

describe('errors', () => {
    it('maps the API envelope to the cases the pages tell apart', async () => {
        const cases: Array<[number, string, string]> = [
            [404, 'not_found', 'not_found'],
            [403, 'commerce_not_enabled', 'not_enabled'],
            [401, 'missing_api_key', 'unauthorized'],
            [403, 'origin_not_allowed', 'unauthorized'],
            [429, 'rate_limited', 'rate_limited'],
            [400, 'invalid_request', 'invalid'],
            [409, 'cart_not_priceable', 'conflict'],
            [500, '', 'server'],
            [503, '', 'server'],
        ];
        for (const [status, code, kind] of cases) {
            expect(errorKindOf(status, code)).toBe(kind);
        }
        const { client } = stub(404, { error: { code: 'not_found', message: 'Product not found.', request_id: 'r1' } });
        const error = await client.getProduct('x').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CommerceApiError);
        expect(error).toMatchObject({ kind: 'not_found', status: 404, code: 'not_found', message: 'Product not found.', retryable: false });
    });

    it('reads Retry-After on a rate limit and offers a retry', () => {
        const error = errorFromBody(429, { error: { code: 'rate_limited', message: 'Too many requests' } }, '30');
        expect(error).toMatchObject({ kind: 'rate_limited', retryAfter: 30, retryable: true });
        expect(errorFromBody(429, null, 'soon').retryAfter).toBeNull();
        expect(errorFromBody(429, null, '99999').retryAfter).toBe(600);
    });

    it('treats a body that is not the envelope by its status', async () => {
        const { client } = stub(502, '<html>Bad gateway</html>');
        await expect(client.getCategories()).rejects.toMatchObject({ kind: 'server', status: 502, retryable: true });
        const ok = stub(200, 'not json');
        await expect(ok.client.getCategories()).rejects.toMatchObject({ kind: 'server' });
    });

    it('reports a failed connection and an aborted call apart', async () => {
        const offline = createCommerceClient({
            baseUrl: 'https://api.example',
            publishableKey: KEY,
            locale: 'hi',
            fetchImpl: (async () => {
                throw new TypeError('Failed to fetch');
            }) as typeof fetch,
        });
        await expect(offline.getProduct('x')).rejects.toMatchObject({ kind: 'network', retryable: true });
        const aborted = createCommerceClient({
            baseUrl: 'https://api.example',
            publishableKey: KEY,
            locale: 'hi',
            fetchImpl: (async () => {
                throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            }) as typeof fetch,
        });
        await expect(aborted.getProduct('x')).rejects.toMatchObject({ kind: 'aborted', retryable: false });
    });
});
