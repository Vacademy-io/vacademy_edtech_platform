import { describe, expect, it } from 'vitest';
import type { ProductOption, Stock, Variant } from '../api/types';
import { activeVariant, findVariant, initialSelection, optionAvailability, selectValue } from './options';

const stock = (state: Stock['state']): Stock => ({
    state,
    left: state === 'LOW' ? 1 : null,
    purchasable: state !== 'OUT',
    single_piece: false,
    lead_time_days: null,
});

const variant = (id: string, colour: string, size: string, state: Stock['state'], position: number): Variant => ({
    id,
    sku: `SKU-${id}`,
    label: `${colour} / ${size}`,
    option_values: { colour, size },
    price: { amount: 100, compare_at_amount: null, currency: 'INR', from: false },
    stock: stock(state),
    weight_grams: null,
    length_mm: null,
    width_mm: null,
    height_mm: null,
    image: null,
    position,
});

const value = (code: string, position: number) => ({ code, label: code, swatch_hex: null, position });

const OPTIONS: ProductOption[] = [
    { code: 'colour', name: 'Colour', kind: 'SWATCH', values: [value('red', 0), value('blue', 1), value('green', 2)] },
    { code: 'size', name: 'Size', kind: 'SIZE', values: [value('s', 0), value('m', 1), value('l', 2)] },
];

// red: S in stock, M sold out, no L. blue: M and L in stock, no S. green: only S, sold out.
const VARIANTS: Variant[] = [
    variant('1', 'red', 's', 'IN_STOCK', 0),
    variant('2', 'red', 'm', 'OUT', 1),
    variant('3', 'blue', 'm', 'IN_STOCK', 2),
    variant('4', 'blue', 'l', 'LOW', 3),
    variant('5', 'green', 's', 'OUT', 4),
];

describe('findVariant', () => {
    it('finds the variant every picked value names', () => {
        expect(findVariant(OPTIONS, VARIANTS, { colour: 'blue', size: 'l' })?.id).toBe('4');
    });

    it('is null while a value is missing or the combination has no variant', () => {
        expect(findVariant(OPTIONS, VARIANTS, { colour: 'blue' })).toBeNull();
        expect(findVariant(OPTIONS, VARIANTS, { colour: 'red', size: 'l' })).toBeNull();
        expect(findVariant(OPTIONS, [], {})).toBeNull();
    });

    it('gives the one variant of a product without options', () => {
        expect(findVariant([], [VARIANTS[0]!], {})?.id).toBe('1');
        expect(activeVariant([], [VARIANTS[0]!], {})?.id).toBe('1');
    });
});

describe('optionAvailability', () => {
    it('marks each value against the other picked values', () => {
        const matrix = optionAvailability(OPTIONS, VARIANTS, { colour: 'red', size: 's' });
        // Sizes for red.
        expect(matrix.size).toEqual({ s: 'available', m: 'sold_out', l: 'missing' });
        // Colours for size S.
        expect(matrix.colour).toEqual({ red: 'available', blue: 'missing', green: 'sold_out' });
    });

    it('follows the selection', () => {
        const matrix = optionAvailability(OPTIONS, VARIANTS, { colour: 'blue', size: 'm' });
        expect(matrix.size).toEqual({ s: 'missing', m: 'available', l: 'available' });
        expect(matrix.colour).toEqual({ red: 'sold_out', blue: 'available', green: 'missing' });
    });

    it('with nothing picked, a value is available when any of its variants can be bought', () => {
        const matrix = optionAvailability(OPTIONS, VARIANTS, {});
        expect(matrix.colour).toEqual({ red: 'available', blue: 'available', green: 'sold_out' });
        expect(matrix.size).toEqual({ s: 'available', m: 'available', l: 'available' });
    });

    it('treats a made-to-order variant as available', () => {
        const mto = [variant('9', 'red', 's', 'MADE_TO_ORDER', 0)];
        expect(optionAvailability(OPTIONS, mto, {}).colour?.red).toBe('available');
    });
});

describe('initialSelection', () => {
    it('opens on the first variant that can be bought', () => {
        const soldOutFirst = [variant('a', 'red', 's', 'OUT', 0), variant('b', 'blue', 'm', 'IN_STOCK', 1)];
        expect(initialSelection(OPTIONS, soldOutFirst)).toEqual({ colour: 'blue', size: 'm' });
    });

    it('opens on the first variant when none can be bought', () => {
        const all = [variant('a', 'red', 's', 'OUT', 1), variant('b', 'blue', 'm', 'OUT', 0)];
        expect(initialSelection(OPTIONS, all)).toEqual({ colour: 'blue', size: 'm' });
    });

    it('honours ?v=<sku>, by SKU or by id, in any case, even when that variant is sold out', () => {
        expect(initialSelection(OPTIONS, VARIANTS, 'sku-2')).toEqual({ colour: 'red', size: 'm' });
        expect(initialSelection(OPTIONS, VARIANTS, '4')).toEqual({ colour: 'blue', size: 'l' });
        expect(initialSelection(OPTIONS, VARIANTS, 'unknown')).toEqual({ colour: 'red', size: 's' });
    });

    it('is empty for a product without options', () => {
        expect(initialSelection([], VARIANTS)).toEqual({});
    });
});

describe('selectValue', () => {
    it('keeps the other values when the combination exists', () => {
        expect(selectValue(OPTIONS, VARIANTS, { colour: 'red', size: 's' }, 'size', 'm')).toEqual({ colour: 'red', size: 'm' });
    });

    it('moves the other values to a variant that exists, preferring one that can be bought', () => {
        // red has no L: picking L moves the colour to blue.
        expect(selectValue(OPTIONS, VARIANTS, { colour: 'red', size: 's' }, 'size', 'l')).toEqual({ colour: 'blue', size: 'l' });
        // blue has no S: picking blue from red/S lands on blue/M (in stock, first).
        expect(selectValue(OPTIONS, VARIANTS, { colour: 'red', size: 's' }, 'colour', 'blue')).toEqual({ colour: 'blue', size: 'm' });
    });

    it('never lands on a combination with no variant', () => {
        for (const option of OPTIONS) {
            for (const v of option.values) {
                for (const start of VARIANTS) {
                    const next = selectValue(OPTIONS, VARIANTS, start.option_values!, option.code, v.code);
                    expect(findVariant(OPTIONS, VARIANTS, next)).not.toBeNull();
                }
            }
        }
    });

    it('leaves the selection alone for a value no variant has', () => {
        const selection = { colour: 'red', size: 's' };
        expect(selectValue(OPTIONS, VARIANTS, selection, 'size', 'xxl')).toBe(selection);
    });
});
