/** Contract §7.2: held bills on this device, at most 10, oldest dropped, storage failures read as empty. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cartReducer, emptyCart } from './pos-cart';
import { MAX_HELD, dropHeld, holdBill, readHeld, takeHeld } from './pos-held-bills';
import { item } from './pos-test-fixtures';

const cart = (n: number) =>
    cartReducer(emptyCart(), { type: 'ADD_VARIANT', item: item({ variant_id: `ps-${n}`, sku: `S-${n}` }) });

afterEach(() => {
    vi.unstubAllGlobals();
    try {
        localStorage.clear();
    } catch {
        // stubbed storage
    }
});

describe('held bills', () => {
    it('holds, reads, takes and drops', () => {
        const held = holdBill('inst-1', 'reg-1', cart(1), new Date('2026-11-18T05:00:00Z'));
        expect(held).toHaveLength(1);
        const [bill] = readHeld('inst-1', 'reg-1');
        expect(bill?.held_at).toBe('2026-11-18T05:00:00.000Z');
        expect(bill?.cart.lines[0]?.variantId).toBe('ps-1');
        expect(readHeld('inst-1', 'reg-2')).toEqual([]);
        expect(takeHeld('inst-1', 'reg-1', bill?.id ?? '')?.id).toBe(bill?.id);
        expect(readHeld('inst-1', 'reg-1')).toEqual([]);
        holdBill('inst-1', 'reg-1', cart(2));
        const [second] = readHeld('inst-1', 'reg-1');
        expect(dropHeld('inst-1', 'reg-1', second?.id ?? '')).toEqual([]);
    });

    it('keeps at most 10; the oldest is dropped', () => {
        for (let n = 1; n <= MAX_HELD + 2; n += 1) holdBill('inst-1', 'reg-1', cart(n));
        const bills = readHeld('inst-1', 'reg-1');
        expect(bills).toHaveLength(MAX_HELD);
        expect(bills[0]?.cart.lines[0]?.variantId).toBe('ps-3');
        expect(bills[MAX_HELD - 1]?.cart.lines[0]?.variantId).toBe(`ps-${MAX_HELD + 2}`);
    });

    it('a storage that throws reads as nothing held and holding reports failure', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('full');
            },
        });
        expect(readHeld('inst-1', 'reg-1')).toEqual([]);
        expect(holdBill('inst-1', 'reg-1', cart(1))).toBeNull();
    });

    it('a corrupt copy reads as nothing held', () => {
        localStorage.setItem('commerce.pos.held.inst-1.reg-1', '{not json');
        expect(readHeld('inst-1', 'reg-1')).toEqual([]);
    });
});
