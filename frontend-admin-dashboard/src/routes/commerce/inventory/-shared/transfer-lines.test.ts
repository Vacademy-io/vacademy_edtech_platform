/** Contract §7.5: every rule of the draft editor and the receive sheet, and the bodies in base units. */
import { describe, expect, it } from 'vitest';
import type { TransferView } from './inventory-types';
import {
    applyDraft,
    applyReceive,
    canReceive,
    type DraftItem,
    type DraftState,
    linesMissingReason,
    receiveFromView,
    toReceiveBody,
    toTransferLines,
} from './transfer-lines';

const bottle: DraftItem = {
    package_session_id: 'ps-bottle',
    sku: 'BOTTLE-1',
    product_name: 'Steel bottle',
    variant_name: null,
    stock_mode: 'QUANTITY',
    stock_policy: 'TRACKED',
    unit: 'PCS',
    qty_scale: 1,
    qty_step: 1,
};
const cloth: DraftItem = { ...bottle, package_session_id: 'ps-cloth', sku: 'CLOTH-1', unit: 'MTR', qty_scale: 10, qty_step: 5 };
const scarf: DraftItem = { ...bottle, package_session_id: 'ps-scarf', sku: 'SCARF-1', stock_mode: 'PIECE' };
const empty: DraftState = { fromLocationId: 'L2', lines: [] };

describe('draft lines', () => {
    it('ADD_VARIANT adds a line of one step, then a step more', () => {
        let state = applyDraft(empty, { type: 'ADD_VARIANT', item: cloth }).state;
        expect(state.lines[0]?.quantity).toBe(5);
        state = applyDraft(state, { type: 'ADD_VARIANT', item: cloth }).state;
        expect(state.lines).toHaveLength(1);
        expect(state.lines[0]?.quantity).toBe(10);
    });

    it('ADD_VARIANT refuses a piece item and an untracked item', () => {
        expect(applyDraft(empty, { type: 'ADD_VARIANT', item: scarf }).refusal).toBe('scanPieceLabel');
        expect(applyDraft(empty, { type: 'ADD_VARIANT', item: { ...bottle, stock_policy: 'UNTRACKED' } }).refusal).toBe('untracked');
    });

    it('ADD_PIECE takes a piece in stock at the source, once', () => {
        const piece = { id: 'pc-1', code: 'PABCDEFGH2', status: 'IN_STOCK', location_id: 'L2' };
        const added = applyDraft(empty, { type: 'ADD_PIECE', item: scarf, piece });
        expect(added.refusal).toBeNull();
        expect(added.state.lines[0]).toMatchObject({ piece_id: 'pc-1', piece_code: 'PABCDEFGH2', quantity: 1 });
        expect(applyDraft(added.state, { type: 'ADD_PIECE', item: scarf, piece }).refusal).toBe('alreadyOn');
    });

    it('ADD_PIECE refuses a piece elsewhere or not in stock', () => {
        const elsewhere = { id: 'pc-2', code: 'P2', status: 'IN_STOCK', location_id: 'L1' };
        const sold = { id: 'pc-3', code: 'P3', status: 'SOLD', location_id: 'L2' };
        expect(applyDraft(empty, { type: 'ADD_PIECE', item: scarf, piece: elsewhere }).refusal).toBe('notHere');
        expect(applyDraft(empty, { type: 'ADD_PIECE', item: scarf, piece: sold }).refusal).toBe('notHere');
    });

    it('SET_QUANTITY keeps to the step and the range; REMOVE drops the line', () => {
        const state = applyDraft(empty, { type: 'ADD_VARIANT', item: cloth }).state;
        const key = state.lines[0]?.key as string;
        expect(applyDraft(state, { type: 'SET_QUANTITY', key, quantity: 7 }).refusal).toBe('quantityStep');
        expect(applyDraft(state, { type: 'SET_QUANTITY', key, quantity: 0 }).refusal).toBe('quantityRange');
        expect(applyDraft(state, { type: 'SET_QUANTITY', key, quantity: 10_000_001 }).refusal).toBe('quantityRange');
        expect(applyDraft(state, { type: 'SET_QUANTITY', key, quantity: 25 }).state.lines[0]?.quantity).toBe(25);
        expect(applyDraft(state, { type: 'REMOVE', key }).state.lines).toEqual([]);
    });

    it('toTransferLines sends base units and every line once', () => {
        let state = applyDraft(empty, { type: 'ADD_VARIANT', item: cloth }).state;
        state = applyDraft(state, { type: 'SET_QUANTITY', key: 'v:ps-cloth', quantity: 25 }).state;
        state = applyDraft(state, {
            type: 'ADD_PIECE',
            item: scarf,
            piece: { id: 'pc-1', code: 'PABCDEFGH2', status: 'IN_STOCK', location_id: 'L2' },
        }).state;
        expect(toTransferLines(state)).toEqual([{ package_session_id: 'ps-cloth', quantity: 25 }, { piece_id: 'pc-1' }]);
    });
});

const view = {
    lines: [
        { id: 'l1', package_session_id: 'ps-bottle', piece_id: null, piece_code: null, qty_sent: 10 },
        { id: 'l2', package_session_id: 'ps-scarf', piece_id: 'pc-1', piece_code: 'PABCDEFGH2', qty_sent: 1 },
    ],
} as unknown as TransferView;

describe('receive sheet', () => {
    it('quantity lines start at sent, piece lines at 0', () => {
        expect(receiveFromView(view).lines.map((l) => l.received)).toEqual([10, 0]);
    });

    it('RECEIVE_SCAN_PIECE ticks its line; another code is refused', () => {
        const state = receiveFromView(view);
        expect(applyReceive(state, { type: 'RECEIVE_SCAN_PIECE', code: 'pabcdefgh2' }).state.lines[1]?.received).toBe(1);
        expect(applyReceive(state, { type: 'RECEIVE_SCAN_PIECE', code: 'PZZZ' }).refusal).toBe('notOnTransfer');
    });

    it('RECEIVE_SCAN_VARIANT adds one up to sent', () => {
        let state = applyReceive(receiveFromView(view), { type: 'SET_RECEIVED', lineId: 'l1', quantity: 9 }).state;
        state = applyReceive(state, { type: 'RECEIVE_SCAN_VARIANT', packageSessionId: 'ps-bottle' }).state;
        expect(state.lines[0]?.received).toBe(10);
        expect(applyReceive(state, { type: 'RECEIVE_SCAN_VARIANT', packageSessionId: 'ps-bottle' }).refusal).toBe('allReceived');
        expect(applyReceive(state, { type: 'RECEIVE_SCAN_VARIANT', packageSessionId: 'ps-other' }).refusal).toBe('notOnTransfer');
    });

    it('a short line needs a reason before Receive; a full line drops it', () => {
        let state = applyReceive(receiveFromView(view), { type: 'SET_RECEIVED', lineId: 'l1', quantity: 7 }).state;
        state = applyReceive(state, { type: 'RECEIVE_SCAN_PIECE', code: 'PABCDEFGH2' }).state;
        expect(canReceive(state)).toBe(false);
        expect(linesMissingReason(state).map((l) => l.line_id)).toEqual(['l1']);
        state = applyReceive(state, { type: 'SET_REASON', lineId: 'l1', reason: 'LOST' }).state;
        expect(canReceive(state)).toBe(true);
        expect(toReceiveBody(state)).toEqual({
            lines: [
                { line_id: 'l1', qty_received: 7, shortfall_reason: 'LOST' },
                { line_id: 'l2', qty_received: 1 },
            ],
        });
        state = applyReceive(state, { type: 'SET_RECEIVED', lineId: 'l1', quantity: 10 }).state;
        expect(state.lines[0]?.reason).toBeNull();
    });

    it('SET_RECEIVED stays within 0..sent', () => {
        const state = receiveFromView(view);
        expect(applyReceive(state, { type: 'SET_RECEIVED', lineId: 'l1', quantity: 11 }).refusal).toBe('quantityRange');
        expect(applyReceive(state, { type: 'SET_RECEIVED', lineId: 'l1', quantity: -1 }).refusal).toBe('quantityRange');
    });
});
