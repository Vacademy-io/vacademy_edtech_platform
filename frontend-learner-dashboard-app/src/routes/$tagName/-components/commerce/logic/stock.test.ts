import { describe, expect, it } from 'vitest';
import type { Stock } from '../api/types';
import { clampQuantity, isMeasured, lengthChoices, quantityRules, stockView } from './stock';

const stock = (over: Partial<Stock>): Stock => ({
    state: 'IN_STOCK',
    left: null,
    purchasable: true,
    single_piece: false,
    lead_time_days: null,
    ...over,
});

describe('stockView', () => {
    it('maps the API states to what the page shows', () => {
        expect(stockView(stock({})).kind).toBe('in');
        expect(stockView(stock({ state: 'LOW', left: 3 }))).toMatchObject({ kind: 'low', left: 3, purchasable: true });
        expect(stockView(stock({ state: 'LOW', left: 1, single_piece: true })).kind).toBe('single');
        expect(stockView(stock({ state: 'OUT', purchasable: false }))).toMatchObject({ kind: 'out', purchasable: false });
        expect(stockView(stock({ state: 'MADE_TO_ORDER', lead_time_days: 12 }))).toMatchObject({
            kind: 'made_to_order',
            purchasable: true,
            leadTimeDays: 12,
        });
    });

    it('shows a number only when the API sent one, and nothing can be bought without stock data', () => {
        expect(stockView(stock({})).left).toBeNull();
        expect(stockView(null)).toMatchObject({ kind: 'unknown', purchasable: false });
        expect(stockView(undefined).purchasable).toBe(false);
    });
});

describe('quantity rules', () => {
    it('has no ceiling while the API gives no number', () => {
        expect(quantityRules(1, stock({}))).toEqual({ step: 1, max: null });
        expect(quantityRules(0, stock({}))).toEqual({ step: 1, max: null });
    });

    it('caps at what is left, on the step grid', () => {
        expect(quantityRules(1, stock({ state: 'LOW', left: 3 }))).toEqual({ step: 1, max: 3 });
        // 27 base units left in steps of 5: at most 25.
        expect(quantityRules(5, stock({ state: 'LOW', left: 27 }))).toEqual({ step: 5, max: 25 });
        // Less than one step left: nothing can be bought.
        expect(quantityRules(5, stock({ state: 'LOW', left: 3 }))).toEqual({ step: 5, max: 0 });
    });

    it('caps at the most one order line may hold, floored to the step', () => {
        // 25 m an order at scale 10 is 250 base units.
        expect(quantityRules(1, stock({}), 250)).toEqual({ step: 1, max: 250 });
        // In steps of 3 m: 24 m.
        expect(quantityRules(30, stock({}), 250)).toEqual({ step: 30, max: 240 });
        // The lower of the two ceilings.
        expect(quantityRules(5, stock({ state: 'LOW', left: 27 }), 250)).toEqual({ step: 5, max: 25 });
        expect(quantityRules(5, stock({ state: 'LOW', left: 300 }), 250)).toEqual({ step: 5, max: 250 });
        // Only stock makes a product sold out; a line maximum under one step is left to the cart.
        expect(quantityRules(5, stock({ state: 'LOW', left: 3 }), 250)).toEqual({ step: 5, max: 0 });
        expect(quantityRules(30, stock({}), 25)).toEqual({ step: 30, max: null });
        expect(quantityRules(1, stock({}), null)).toEqual({ step: 1, max: null });
    });

    it('clamps a wanted quantity onto the grid and inside the limits', () => {
        const rules = { step: 5, max: 25 };
        expect(clampQuantity(12, rules)).toBe(10);
        expect(clampQuantity(13, rules)).toBe(15);
        expect(clampQuantity(0, rules)).toBe(5);
        expect(clampQuantity(-4, rules)).toBe(5);
        expect(clampQuantity(999, rules)).toBe(25);
        expect(clampQuantity(Number.NaN, rules)).toBe(5);
        expect(clampQuantity(7, { step: 1, max: null })).toBe(7);
        expect(clampQuantity(7, { step: 5, max: 0 })).toBe(0);
    });
});

describe('lengths of goods sold by length', () => {
    it('turns preset metres into quantities of the one variant', () => {
        // qty scale 10 (10 cm base unit), step 5 (half metres).
        expect(lengthChoices([1, 2.5, 5], 10, { step: 5, max: null })).toEqual([
            { quantity: 10, units: 1 },
            { quantity: 25, units: 2.5 },
            { quantity: 50, units: 5 },
        ]);
    });

    it('drops presets off the step grid, above the stock ceiling, or repeated', () => {
        expect(lengthChoices([5, 1, 1.2, 1, 0, -2], 10, { step: 5, max: 30 })).toEqual([{ quantity: 10, units: 1 }]);
    });

    it('knows a measured product by its scale', () => {
        expect(isMeasured(10)).toBe(true);
        expect(isMeasured(1)).toBe(false);
        expect(isMeasured(0)).toBe(false);
    });
});
