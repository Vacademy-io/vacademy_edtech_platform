import { describe, expect, it } from 'vitest';
import {
    EMPTY_FACET_STATE,
    activeFacetCount,
    clearFacets,
    facetStateToParams,
    isFilteredView,
    parseFacetState,
    serializeFacetState,
    toggleFacetValue,
    togglePriceBand,
} from './facet-url';
import { productListQuery } from '../api/client';

describe('parseFacetState', () => {
    it('is the default listing for a bare address', () => {
        expect(parseFacetState('')).toEqual(EMPTY_FACET_STATE);
        expect(parseFacetState(null)).toEqual(EMPTY_FACET_STATE);
        expect(parseFacetState('?lang=en&utm_source=wa')).toEqual(EMPTY_FACET_STATE);
    });

    it('reads filters, price, availability, sort and the search text', () => {
        const state = parseFacetState('?filter.colour=red,blue&filter.fabric=cotton&price_min=500&price_max=2000&in_stock=0&sort=price_asc&q=saree');
        expect(state).toEqual({
            q: 'saree',
            filters: { colour: ['blue', 'red'], fabric: ['cotton'] },
            priceMin: 500,
            priceMax: 2000,
            inStockOnly: false,
            sort: 'price_asc',
        });
    });

    it('merges a repeated parameter and drops blanks and duplicates', () => {
        expect(parseFacetState('?filter.colour=red&filter.colour=blue,red,,').filters).toEqual({ colour: ['blue', 'red'] });
    });

    it('ignores what it does not understand instead of failing', () => {
        const state = parseFacetState('?sort=cheapest&price_min=abc&price_max=-5&in_stock=maybe&filter.=x&filter.bad%20code=y');
        expect(state).toEqual(EMPTY_FACET_STATE);
    });

    it('swaps a reversed price range', () => {
        expect(parseFacetState('?price_min=2000&price_max=500')).toMatchObject({ priceMin: 500, priceMax: 2000 });
    });

    it('reads Devanagari search text', () => {
        expect(parseFacetState(`?q=${encodeURIComponent('साड़ी')}`).q).toBe('साड़ी');
    });

    it('caps the number of values of a facet', () => {
        const many = Array.from({ length: 80 }, (_, i) => `v${i}`).join(',');
        expect(parseFacetState(`?filter.colour=${many}`).filters.colour).toHaveLength(50);
    });
});

describe('serializeFacetState', () => {
    it('writes nothing for the default listing', () => {
        expect(serializeFacetState(EMPTY_FACET_STATE)).toBe('');
    });

    it('writes a stable, readable query', () => {
        const state = { ...EMPTY_FACET_STATE, filters: { fabric: ['cotton'], colour: ['red', 'blue'] }, priceMax: 2000, sort: 'newest' as const };
        expect(serializeFacetState(state)).toBe('?filter.colour=blue,red&filter.fabric=cotton&price_max=2000&sort=newest');
    });

    it('keeps the parameters it does not own and replaces the ones it does', () => {
        const next = serializeFacetState(
            { ...EMPTY_FACET_STATE, filters: { colour: ['red'] } },
            '?lang=en&filter.size=m&sort=newest&page=3&utm_source=wa'
        );
        expect(next).toBe('?lang=en&utm_source=wa&filter.colour=red');
    });

    it('round-trips every state it can express', () => {
        const states = [
            EMPTY_FACET_STATE,
            { ...EMPTY_FACET_STATE, q: 'cotton saree' },
            { ...EMPTY_FACET_STATE, filters: { colour: ['blue', 'red'], size: ['m'] } },
            { ...EMPTY_FACET_STATE, priceMin: 0, priceMax: 999.5 },
            { ...EMPTY_FACET_STATE, priceMin: 5000, priceMax: null },
            { ...EMPTY_FACET_STATE, inStockOnly: false, sort: 'price_desc' as const },
            { q: 'साड़ी', filters: { fabric: ['cotton'] }, priceMin: 500, priceMax: 2000, inStockOnly: false, sort: 'newest' as const },
        ];
        for (const state of states) {
            expect(parseFacetState(serializeFacetState(state))).toEqual(state);
        }
    });
});

describe('changing the state', () => {
    it('toggles a value on and off (OR within a facet)', () => {
        const one = toggleFacetValue(EMPTY_FACET_STATE, 'colour', 'red');
        const two = toggleFacetValue(one, 'colour', 'blue');
        expect(two.filters).toEqual({ colour: ['blue', 'red'] });
        expect(toggleFacetValue(two, 'colour', 'red').filters).toEqual({ colour: ['blue'] });
        expect(toggleFacetValue(one, 'colour', 'red').filters).toEqual({});
        // The input is never mutated.
        expect(EMPTY_FACET_STATE.filters).toEqual({});
    });

    it('picks one price band at a time, and the same band again clears it', () => {
        const band = togglePriceBand(EMPTY_FACET_STATE, 500, 1000);
        expect(band).toMatchObject({ priceMin: 500, priceMax: 1000 });
        expect(togglePriceBand(band, 1000, null)).toMatchObject({ priceMin: 1000, priceMax: null });
        expect(togglePriceBand(band, 500, 1000)).toMatchObject({ priceMin: null, priceMax: null });
    });

    it('counts what is on and clears it, keeping the search text and the sort', () => {
        const state = { q: 'saree', filters: { colour: ['red', 'blue'], size: ['m'] }, priceMin: 500, priceMax: null, inStockOnly: false, sort: 'newest' as const };
        expect(activeFacetCount(state)).toBe(5);
        expect(clearFacets(state)).toEqual({ ...EMPTY_FACET_STATE, q: 'saree', sort: 'newest' });
        expect(activeFacetCount(EMPTY_FACET_STATE)).toBe(0);
        expect(isFilteredView(EMPTY_FACET_STATE)).toBe(false);
        expect(isFilteredView({ ...EMPTY_FACET_STATE, sort: 'newest' })).toBe(true);
    });
});

describe('the API call of a listing', () => {
    it('sends the names the controller reads', () => {
        const state = parseFacetState('?filter.colour=red,blue&price_min=500&sort=price_asc&q=saree');
        const query = productListQuery(facetStateToParams(state, { collection: 'sarees', pageSize: 24, facets: true }), 'hi');
        expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
            locale: 'hi',
            q: 'saree',
            collection: 'sarees',
            'filter.colour': 'blue,red',
            price_min: '500',
            in_stock: 'true',
            sort: 'price_asc',
            page_size: '24',
            facets: 'true',
        });
    });

    it('asks for everything when availability is switched off, and leaves defaults out', () => {
        const query = productListQuery(facetStateToParams({ ...EMPTY_FACET_STATE, inStockOnly: false }, {}), 'en');
        expect(query).toBe('locale=en');
    });
});
