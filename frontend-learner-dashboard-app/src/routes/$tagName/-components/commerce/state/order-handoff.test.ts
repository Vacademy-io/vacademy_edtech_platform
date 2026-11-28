import { beforeEach, describe, expect, it } from 'vitest';
import type { KeyValueStorage } from './session';
import { ORDER_KEY_STATE, handOffOrder, markOrderPaid, orderHandoffKey, orderKeyFromState, readOrderHandoff, resetOrderHandoffMemory } from './order-handoff';

const memory = (): KeyValueStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

const TOKEN = 'v1.b3JkZXI.c2ln';

beforeEach(() => resetOrderHandoffMemory());

describe('order handoff', () => {
    it('puts only a random key in the history state and keeps the token in sessionStorage per institute', () => {
        const store = memory();
        const state = handOffOrder('inst-1', TOKEN, { paidAt: 1234, placedHere: true, phoneProved: true }, store);
        expect(Object.keys(state)).toEqual([ORDER_KEY_STATE]);
        expect(JSON.stringify(state)).not.toContain(TOKEN);
        const key = orderKeyFromState(state)!;
        expect(key).toMatch(/^[a-z0-9]{8,40}$/);
        expect(store.data.get(orderHandoffKey('inst-1'))).toContain(TOKEN);
        expect(store.data.get(orderHandoffKey('inst-2'))).toBeUndefined();
        expect(readOrderHandoff('inst-1', state, store)).toEqual({ key, token: TOKEN, paidAt: 1234, placedHere: true, phoneProved: true });
        // Another shop on the same host never reads it.
        expect(readOrderHandoff('inst-2', state, store)).toBeNull();
    });

    it('a state without the key (a language switch replaced it) finds the order this tab used last', () => {
        const store = memory();
        const a = handOffOrder('inst-1', 'v1.a.a', {}, store);
        handOffOrder('inst-1', 'v1.b.b', {}, store);
        expect(readOrderHandoff('inst-1', { key: 'x', __TSR_index: 3 }, store)?.token).toBe('v1.b.b');
        // Back to the first order's entry makes it the last one used.
        expect(readOrderHandoff('inst-1', a, store)?.token).toBe('v1.a.a');
        expect(readOrderHandoff('inst-1', null, store)?.token).toBe('v1.a.a');
        // An unknown key is not someone else's order.
        expect(readOrderHandoff('inst-1', { [ORDER_KEY_STATE]: 'ffffffffffffffff' }, store)).toBeNull();
    });

    it('survives a reload (a fresh read of the same storage) and records a payment from the order page', () => {
        const store = memory();
        const state = handOffOrder('inst-1', TOKEN, {}, store);
        resetOrderHandoffMemory();
        const opened = readOrderHandoff('inst-1', state, store)!;
        expect(opened).toMatchObject({ paidAt: null, placedHere: false, phoneProved: false });
        markOrderPaid('inst-1', opened.key, 5678, store);
        resetOrderHandoffMemory();
        expect(readOrderHandoff('inst-1', state, store)).toMatchObject({ paidAt: 5678, placedHere: true });
    });

    it('opening the same order again keeps what an earlier record said', () => {
        const store = memory();
        handOffOrder('inst-1', TOKEN, { paidAt: 99, placedHere: true }, store);
        const again = handOffOrder('inst-1', TOKEN, {}, store);
        expect(readOrderHandoff('inst-1', again, store)).toMatchObject({ paidAt: 99, placedHere: true, phoneProved: false });
    });

    it('refuses an unusable token, and works from memory when storage is blocked', () => {
        const store = memory();
        expect(handOffOrder('inst-1', null, {}, store)).toEqual({});
        expect(handOffOrder('inst-1', '<script>', {}, store)).toEqual({});
        const blocked: KeyValueStorage = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
            removeItem: () => undefined,
        };
        const state = handOffOrder('inst-1', TOKEN, {}, blocked);
        expect(readOrderHandoff('inst-1', state, blocked)?.token).toBe(TOKEN);
    });

    it('keeps at most ten orders', () => {
        const store = memory();
        const states = Array.from({ length: 12 }, (_, i) => handOffOrder('inst-1', `v1.t${i}.s`, {}, store));
        const stored = JSON.parse(store.data.get(orderHandoffKey('inst-1'))!) as { entries: Record<string, unknown> };
        expect(Object.keys(stored.entries).length).toBeLessThanOrEqual(10);
        expect(readOrderHandoff('inst-1', states[11], store)?.token).toBe('v1.t11.s');
    });
});
