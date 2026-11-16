import { describe, expect, it } from 'vitest';
import {
    COMMERCE_RESERVED_SEGMENTS,
    apiPathTo,
    commerceRouteTo,
    isCommerceReservedSegment,
    parseCommerceRoute,
    withQuery,
} from './routes';

describe('parseCommerceRoute', () => {
    it('reads the fixed shop routes', () => {
        expect(parseCommerceRoute(['p', 'palak-pink-cotton-saree'])).toEqual({ kind: 'product', slug: 'palak-pink-cotton-saree' });
        expect(parseCommerceRoute(['c', 'sarees'])).toEqual({ kind: 'collection', slug: 'sarees' });
        expect(parseCommerceRoute(['search'])).toEqual({ kind: 'search' });
        expect(parseCommerceRoute(['cart'])).toEqual({ kind: 'cart' });
        expect(parseCommerceRoute(['q', 'PC-000123'])).toEqual({ kind: 'scan', code: 'PC-000123' });
    });

    it('reads the four buying routes, on a root mount and after a tag alike', () => {
        expect(parseCommerceRoute(['checkout'])).toEqual({ kind: 'checkout' });
        expect(parseCommerceRoute(['order'])).toEqual({ kind: 'order' });
        expect(parseCommerceRoute(['track-order'])).toEqual({ kind: 'track' });
        expect(parseCommerceRoute(['account'])).toEqual({ kind: 'account' });
        expect(parseCommerceRoute(['Checkout', ''])).toEqual({ kind: 'checkout' });
        // "/<tag>/account" reaches the parser as the segments after the tag.
        expect(parseCommerceRoute('/shop/account'.split('/').filter(Boolean).slice(1))).toEqual({ kind: 'account' });
    });

    it('is case-insensitive on the marker and lower-cases a slug, but keeps a label code as printed', () => {
        expect(parseCommerceRoute(['P', 'Red-Saree'])).toEqual({ kind: 'product', slug: 'red-saree' });
        expect(parseCommerceRoute(['Q', 'Ab-12'])).toEqual({ kind: 'scan', code: 'Ab-12' });
    });

    it('leaves every other address to the pages, courses and catalogues that own it', () => {
        expect(parseCommerceRoute([])).toBeNull();
        expect(parseCommerceRoute(['about'])).toBeNull();
        expect(parseCommerceRoute(['shop'])).toBeNull();
        expect(parseCommerceRoute(['p'])).toBeNull();
        expect(parseCommerceRoute(['c'])).toBeNull();
        expect(parseCommerceRoute(['blog', 'my-post'])).toBeNull();
        expect(parseCommerceRoute(['p', 'a', 'b'])).toBeNull();
        expect(parseCommerceRoute(['search', 'x'])).toBeNull();
        expect(parseCommerceRoute(['0b9d6a6e-9c0a-4a53-9a39-0d6b1f0b7a11'])).toBeNull();
        // The buying routes are one segment each.
        expect(parseCommerceRoute(['account', 'orders'])).toBeNull();
        expect(parseCommerceRoute(['checkout', 'x'])).toBeNull();
        expect(parseCommerceRoute(['order', 'ORD-000123'])).toBeNull();
        expect(parseCommerceRoute(['track'])).toBeNull();
        expect(parseCommerceRoute(['toString'])).toBeNull();
    });

    it('refuses a slug or code that is not one', () => {
        expect(parseCommerceRoute(['p', '../etc'])).toBeNull();
        expect(parseCommerceRoute(['p', 'साड़ी'])).toBeNull();
        expect(parseCommerceRoute(['p', '%E0%A4%'])).toBeNull();
        expect(parseCommerceRoute(['q', '<script>'])).toBeNull();
        expect(parseCommerceRoute(['c', 'a'.repeat(200)])).toBeNull();
    });

    it('decodes an escaped segment', () => {
        expect(parseCommerceRoute(['p', 'red%2Dsaree'])).toEqual({ kind: 'product', slug: 'red-saree' });
    });
});

describe('reserved segments', () => {
    it('names the reserved words', () => {
        expect([...COMMERCE_RESERVED_SEGMENTS].sort()).toEqual(
            ['account', 'c', 'cart', 'checkout', 'order', 'p', 'q', 'search', 'shop', 'track-order'].sort()
        );
        expect(isCommerceReservedSegment('Cart')).toBe(true);
        expect(isCommerceReservedSegment('about')).toBe(false);
        expect(isCommerceReservedSegment('')).toBe(false);
        expect(isCommerceReservedSegment(null)).toBe(false);
    });
});

describe('addresses', () => {
    it('round-trips a route through its address', () => {
        for (const route of [
            { kind: 'product', slug: 'x-1' },
            { kind: 'collection', slug: 'sarees' },
            { kind: 'search' },
            { kind: 'cart' },
            { kind: 'scan', code: 'PC-1' },
            { kind: 'checkout' },
            { kind: 'order' },
            { kind: 'track' },
            { kind: 'account' },
        ] as const) {
            expect(parseCommerceRoute(commerceRouteTo(route).split('/'))).toEqual(route);
        }
    });

    it('drops the language of an API path and keeps the rest', () => {
        expect(apiPathTo('/p/red-saree')).toBe('p/red-saree');
        expect(apiPathTo('/p/red-saree?lang=en')).toBe('p/red-saree');
        expect(apiPathTo('/p/red-saree?v=SKU1&lang=en')).toBe('p/red-saree?v=SKU1');
        expect(apiPathTo(null)).toBe('');
    });

    it('adds and removes query parameters', () => {
        expect(withQuery('search', { q: 'saree' })).toBe('search?q=saree');
        expect(withQuery('search?q=old', { q: 'साड़ी' })).toBe(`search?q=${encodeURIComponent('साड़ी')}`);
        expect(withQuery('p/x?v=1', { v: null })).toBe('p/x');
    });
});
