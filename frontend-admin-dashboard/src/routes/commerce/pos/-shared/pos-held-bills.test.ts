/** Contract §7.2: held bills on this device, at most 10, oldest dropped, storage failures read as empty. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cartReducer, emptyCart } from './pos-cart';
import {
    HELD_MAX_AGE_MS,
    MAX_HELD,
    clearHeld,
    dropHeld,
    holdBill,
    readHeld,
    refreshHeldItem,
    takeHeld,
} from './pos-held-bills';
import { hose, item } from './pos-test-fixtures';

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
        const at = new Date('2026-11-18T05:00:00Z');
        const held = holdBill('inst-1', 'reg-1', cart(1), at);
        expect(held).toHaveLength(1);
        const [bill] = readHeld('inst-1', 'reg-1', { now: at });
        expect(bill?.held_at).toBe('2026-11-18T05:00:00.000Z');
        expect(bill?.cart.lines[0]?.variantId).toBe('ps-1');
        expect(readHeld('inst-1', 'reg-2')).toEqual([]);
        expect(takeHeld('inst-1', 'reg-1', bill?.id ?? '', { now: at })?.id).toBe(bill?.id);
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

    it('a held bill expires after 12 hours and is removed from the device', () => {
        const at = new Date('2026-11-18T05:00:00Z');
        holdBill('inst-1', 'reg-1', cart(1), at, 'sess-1');
        const later = new Date(at.getTime() + HELD_MAX_AGE_MS - 1000);
        expect(readHeld('inst-1', 'reg-1', { sessionId: 'sess-1', now: later })).toHaveLength(1);
        const expired = new Date(at.getTime() + HELD_MAX_AGE_MS + 1000);
        expect(readHeld('inst-1', 'reg-1', { sessionId: 'sess-1', now: expired })).toEqual([]);
        expect(localStorage.getItem('commerce.pos.held.inst-1.reg-1')).toBe('[]');
    });

    it('a bill held in a closed session is not offered in the next one; closing clears the register', () => {
        const at = new Date('2026-11-18T05:00:00Z');
        holdBill('inst-1', 'reg-1', cart(1), at, 'sess-old');
        expect(readHeld('inst-1', 'reg-1', { sessionId: 'sess-new', now: at })).toEqual([]);
        holdBill('inst-1', 'reg-1', cart(2), at, 'sess-new');
        expect(readHeld('inst-1', 'reg-1', { sessionId: 'sess-new', now: at })).toHaveLength(1);
        clearHeld('inst-1', 'reg-1');
        expect(localStorage.getItem('commerce.pos.held.inst-1.reg-1')).toBeNull();
    });

    it('an exchange credit is never held (it stays on the till)', () => {
        const at = new Date('2026-11-18T05:00:00Z');
        const withCredit = { ...cart(1), exchange: { returnId: 'r-1', number: 'RET-1', credit: 300 } };
        const [bill] = holdBill('inst-1', 'reg-1', withCredit, at, 'sess-1') ?? [];
        expect(bill?.cart.exchange).toBeNull();
    });

    it('a corrupt copy reads as nothing held', () => {
        localStorage.setItem('commerce.pos.held.inst-1.reg-1', '{not json');
        expect(readHeld('inst-1', 'reg-1')).toEqual([]);
    });
});

describe('refreshHeldItem (round 2)', () => {
    it("a held bill's line of the item takes its current step; nothing is written when no bill has it", () => {
        const roll = cartReducer(emptyCart(), { type: 'ADD_VARIANT', item: hose({ qty_step: 1 }) });
        holdBill('inst-1', 'reg-1', roll);
        holdBill('inst-1', 'reg-1', cart(1));
        expect(refreshHeldItem('inst-1', 'reg-1', hose())).toBe(true);
        const bills = readHeld('inst-1', 'reg-1');
        expect(bills[0]?.cart.lines[0]?.qtyStep).toBe(5);
        expect(bills[1]?.cart.lines[0]?.qtyStep).toBe(1);
        expect(refreshHeldItem('inst-1', 'reg-1', hose())).toBe(false);
    });
});
