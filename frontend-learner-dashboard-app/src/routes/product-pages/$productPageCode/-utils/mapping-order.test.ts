import { describe, expect, it } from 'vitest';
import { sortMappingsByDisplayOrder, withOrderedMappings } from './mapping-order';
import type { ProductPageData } from '../-types/product-page-types';

const m = (id: string, display_order?: number | null) => ({ id, display_order }) as { id: string; display_order?: number | null };

describe('sortMappingsByDisplayOrder', () => {
    it('orders by display_order', () => {
        expect(sortMappingsByDisplayOrder([m('c', 2), m('a', 0), m('b', 1)]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    });

    it("keeps the server's order for ties (stable), so all-zero pages do not move", () => {
        expect(sortMappingsByDisplayOrder([m('x', 0), m('y', 0), m('z', 0)]).map((x) => x.id)).toEqual(['x', 'y', 'z']);
        expect(sortMappingsByDisplayOrder([m('b2', 1), m('a', 0), m('b1', 1)]).map((x) => x.id)).toEqual(['a', 'b2', 'b1']);
    });

    it('treats a missing or invalid display_order as 0', () => {
        expect(
            sortMappingsByDisplayOrder([m('one', 1), m('none', null), m('nan', Number.NaN), m('undef')]).map((x) => x.id)
        ).toEqual(['none', 'nan', 'undef', 'one']);
    });

    it('does not mutate its input', () => {
        const input = [m('b', 1), m('a', 0)];
        sortMappingsByDisplayOrder(input);
        expect(input.map((x) => x.id)).toEqual(['b', 'a']);
    });
});

describe('withOrderedMappings', () => {
    const page = (mappings: unknown[]) => ({ id: 'p', mappings }) as unknown as ProductPageData;

    it('returns a page with ordered mappings', () => {
        const input = page([m('b', 1), m('a', 0)]);
        const out = withOrderedMappings(input);
        expect(out.mappings.map((x) => x.id)).toEqual(['a', 'b']);
        expect(input.mappings.map((x) => x.id)).toEqual(['b', 'a']);
    });

    it('returns the same object when already ordered (stable select result)', () => {
        const input = page([m('a', 0), m('b', 1)]);
        expect(withOrderedMappings(input)).toBe(input);
        const empty = page([]);
        expect(withOrderedMappings(empty)).toBe(empty);
    });

    it('leaves a page without a mappings array untouched', () => {
        const odd = { id: 'p', mappings: null } as unknown as ProductPageData;
        expect(withOrderedMappings(odd)).toBe(odd);
    });
});
