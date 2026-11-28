/** WP-44 FA2: the product list reads a measured product's price per metre (B8 sends unit and scale). */
import { describe, expect, it } from 'vitest';
import type { ProductSummary } from './commerce-types';
import { localeT } from './en-t';
import { priceRange } from './product-list';

const row = (over: Partial<ProductSummary> = {}): ProductSummary => ({
    package_id: 'p-1',
    external_ref: null,
    slug: 'cotton-cloth',
    status: 'ACTIVE',
    brand: null,
    names: { en: 'Cotton cloth' },
    variant_count: 1,
    min_price: 12.34,
    max_price: 12.34,
    currency: 'INR',
    updated_at: null,
    ...over,
});

describe('priceRange', () => {
    it('measured: "₹123.40 / m", a range once with the unit', () => {
        expect(priceRange(row({ unit: 'MTR', qty_scale: 10 }), localeT('en'))).toBe('₹123.40 / m');
        expect(priceRange(row({ unit: 'MTR', qty_scale: 10, max_price: 20 }), localeT('en'))).toBe('₹123.40 – ₹200.00 / m');
        expect(priceRange(row({ unit: 'MTR', qty_scale: 10 }), localeT('hi'))).toBe('₹123.40 / मीटर');
    });

    it('pieces and older servers without the unit fields read as before', () => {
        expect(priceRange(row({ min_price: 450, max_price: 450 }))).toBe('₹450.00');
        expect(priceRange(row({ min_price: 450, max_price: 900, qty_scale: 1 }))).toBe('₹450.00 – ₹900.00');
        expect(priceRange(row({ min_price: null }))).toBe('—');
    });
});
