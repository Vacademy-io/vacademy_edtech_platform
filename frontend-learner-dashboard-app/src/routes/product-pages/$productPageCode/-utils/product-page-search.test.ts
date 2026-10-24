import { describe, expect, it } from 'vitest';
import { productPageSearchSchema } from './product-page-search';

/**
 * The router JSON-parses search values, so a hand-made or copied link can hand
 * this schema a number, a boolean or null where a string is expected. `lang`
 * is only carried along — it must never turn the page into an error screen.
 */
describe('product page search params', () => {
    it.each([
        ['?lang=1', 1],
        ['?lang=true', true],
        ['?lang=null', null],
        ['?lang={}', {}],
    ])('drops a non-string language (%s) instead of failing the page', (_: string, lang: unknown) => {
        const parsed = productPageSearchSchema.parse({ lang, courseIds: 'ps-1', defaultTab: 'CART' });
        expect(parsed.lang).toBeUndefined();
        // Everything else on the link still arrives.
        expect(parsed.courseIds).toBe('ps-1');
        expect(parsed.defaultTab).toBe('CART');
    });

    it('keeps a real language code', () => {
        expect(productPageSearchSchema.parse({ lang: 'hi' }).lang).toBe('hi');
        expect(productPageSearchSchema.parse({}).lang).toBeUndefined();
    });

    it('still ignores an unrelated source', () => {
        expect(productPageSearchSchema.parse({ source: 7 }).source).toBeUndefined();
        expect(productPageSearchSchema.parse({ source: 'siteCart' }).source).toBe('siteCart');
    });
});
