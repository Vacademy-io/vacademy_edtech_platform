/** Contract §7.5: every rule of the draft editor and the receive sheet, and the bodies in base units. */
import { describe, expect, it } from 'vitest';
import type { TransferView } from './inventory-types';
import {
    applyDraft,
    applyReceive,
    badDraftBox,
    badReceiveBox,
    canReceive,
    type DraftItem,
    type DraftState,
    linesMissingReason,
    linesWithoutLength,
    promisedOnlineText,
    receiveFromView,
    toReceiveBody,
    toTransferLines,
    transferRowQuantity,
} from './transfer-lines';
import { localeT } from '@/routes/commerce/-shared/en-t';
import { readInventoryError } from './inventory-errors';
import { serverError } from './inventory-test-fixtures';

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
/** A counted item sold in packs of 5: the sale step does not apply to a transfer (W10). */
const packs: DraftItem = { ...bottle, package_session_id: 'ps-pack', sku: 'PACK-1', qty_step: 5 };
const scarf: DraftItem = { ...bottle, package_session_id: 'ps-scarf', sku: 'SCARF-1', stock_mode: 'PIECE' };
const empty: DraftState = { fromLocationId: 'L2', lines: [] };

describe('draft lines', () => {
    it('W10: the sale step never applies to a transfer: a pack item adds one at a time and takes 7', () => {
        let state = applyDraft(empty, { type: 'ADD_VARIANT', item: packs }).state;
        expect(state.lines[0]).toMatchObject({ quantity: 1, qty_step: 1 });
        state = applyDraft(state, { type: 'ADD_VARIANT', item: packs }).state;
        expect(state.lines).toHaveLength(1);
        expect(state.lines[0]?.quantity).toBe(2);
        const seven = applyDraft(state, { type: 'SET_QUANTITY', key: 'v:ps-pack', quantity: 7 });
        expect(seven.refusal).toBeNull();
        expect(seven.state.lines[0]?.quantity).toBe(7);
    });

    it('a scanned roll waits at 0 for its typed length; a repeat scan only asks again (WP-44 FA6)', () => {
        const first = applyDraft(empty, { type: 'ADD_VARIANT', item: cloth });
        expect(first.refusal).toBe('typeLength');
        expect(first.state.lines[0]).toMatchObject({ key: 'v:ps-cloth', quantity: 0, qty_step: 1 });
        expect(linesWithoutLength(first.state)).toHaveLength(1);
        const again = applyDraft(first.state, { type: 'ADD_VARIANT', item: cloth });
        expect(again.refusal).toBe('typeLength');
        expect(again.state).toBe(first.state);
    });

    it('a roll moves in any whole tenth: 23.7 m at a 0.5 m sale step is 237 (D3)', () => {
        const state = applyDraft(empty, { type: 'ADD_VARIANT', item: cloth }).state;
        const set = applyDraft(state, { type: 'SET_QUANTITY', key: 'v:ps-cloth', quantity: 237 });
        expect(set.refusal).toBeNull();
        expect(set.state.lines[0]?.quantity).toBe(237);
        expect(linesWithoutLength(set.state)).toEqual([]);
        expect(toTransferLines(set.state)).toEqual([{ package_session_id: 'ps-cloth', quantity: 237 }]);
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

    it('SET_QUANTITY keeps to the range; REMOVE drops the line', () => {
        const state = applyDraft(empty, { type: 'ADD_VARIANT', item: packs }).state;
        const key = state.lines[0]?.key as string;
        expect(applyDraft(state, { type: 'SET_QUANTITY', key, quantity: 0 }).refusal).toBe('quantityRange');
        expect(applyDraft(state, { type: 'SET_QUANTITY', key, quantity: 10_000_001 }).refusal).toBe('quantityRange');
        expect(applyDraft(state, { type: 'SET_QUANTITY', key, quantity: 25 }).state.lines[0]?.quantity).toBe(25);
        expect(applyDraft(state, { type: 'REMOVE', key }).state.lines).toEqual([]);
    });

    it('W5: a blank, refused or zero typed box stops Save; an untouched or good box does not', () => {
        const state = applyDraft(applyDraft(empty, { type: 'ADD_VARIANT', item: cloth }).state, {
            type: 'SET_QUANTITY',
            key: 'v:ps-cloth',
            quantity: 237,
        }).state;
        expect(badDraftBox(state, {})).toBeNull();
        expect(badDraftBox(state, { 'v:ps-cloth': '23.7' })).toBeNull();
        // "23.75" was typed one key at a time: the line holds 237 from "23.7" but the box is refused.
        expect(badDraftBox(state, { 'v:ps-cloth': '23.75' })).toBe('v:ps-cloth');
        expect(badDraftBox(state, { 'v:ps-cloth': '' })).toBe('v:ps-cloth');
        expect(badDraftBox(state, { 'v:ps-cloth': '0' })).toBe('v:ps-cloth');
        expect(badDraftBox(state, { 'v:ps-cloth': '2,5' })).toBe('v:ps-cloth');
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
        { id: 'l1', package_session_id: 'ps-bottle', piece_id: null, piece_code: null, qty_sent: 10, qty_scale: 1 },
        { id: 'l2', package_session_id: 'ps-scarf', piece_id: 'pc-1', piece_code: 'PABCDEFGH2', qty_sent: 1, qty_scale: 1 },
        { id: 'l3', package_session_id: 'ps-cloth', piece_id: null, piece_code: null, qty_sent: 30, qty_scale: 10 },
    ],
} as unknown as TransferView;

describe('receive sheet', () => {
    it('quantity lines start at sent, piece lines at 0', () => {
        expect(receiveFromView(view).lines.map((l) => l.received)).toEqual([10, 0, 30]);
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

    it('K M5: scanning a roll asks for its typed length and never adds 0.1 m', () => {
        let state = applyReceive(receiveFromView(view), { type: 'SET_RECEIVED', lineId: 'l3', quantity: 20 }).state;
        const scanned = applyReceive(state, { type: 'RECEIVE_SCAN_VARIANT', packageSessionId: 'ps-cloth' });
        expect(scanned.refusal).toBe('typeLength');
        state = scanned.state;
        expect(state.lines[2]?.received).toBe(20);
    });

    it('W5: a blank received box is never the full sent length; refused or above sent stops Receive', () => {
        const state = receiveFromView(view);
        expect(badReceiveBox(state, {})).toBeNull();
        expect(badReceiveBox(state, { l3: '2' })).toBeNull();
        expect(badReceiveBox(state, { l3: '0' })).toBeNull();
        expect(badReceiveBox(state, { l3: '' })).toBe('l3');
        expect(badReceiveBox(state, { l3: '2.55' })).toBe('l3');
        expect(badReceiveBox(state, { l3: '3.1' })).toBe('l3');
        expect(badReceiveBox(state, { l1: '11' })).toBe('l1');
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
                { line_id: 'l3', qty_received: 30 },
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

describe('round 2: the transfers list and the dispatch question in metres', () => {
    const en = localeT('en');
    const hi = localeT('hi');

    it('a list row sums in the unit its lines share, and says "Mixed units" otherwise', () => {
        expect(transferRowQuantity({ qty_sent: 237, unit: 'MTR', qty_scale: 10 }, en)).toBe('23.7 m');
        expect(transferRowQuantity({ qty_sent: 237, unit: 'MTR', qty_scale: 10 }, hi)).toBe('23.7 मीटर');
        expect(transferRowQuantity({ qty_sent: 2500, unit: 'KGS', qty_scale: 1000 }, en)).toBe('2.5 kg');
        expect(transferRowQuantity({ qty_sent: 12, unit: null, qty_scale: 1 }, en)).toBe('12');
        expect(transferRowQuantity({ qty_sent: 12 }, en)).toBe('12');
        expect(transferRowQuantity({ qty_sent: 242, mixed_units: true }, en)).toBe('Mixed units');
        expect(transferRowQuantity({ qty_sent: 242, mixed_units: true }, hi)).toBe('अलग-अलग इकाइयाँ');
    });

    it('PROMISED_ONLINE for a cloth reads "2.5 m", not "25 units"; pieces keep the count', () => {
        const cloth = readInventoryError(
            serverError(
                409,
                'PROMISED_ONLINE: 25 unit(s) of COTTON-1 are held or sold online (qty_scale 10, unit MTR); a manager may send them anyway'
            )
        ).values;
        expect(cloth).toEqual({ count: '25', sku: 'COTTON-1', qty_scale: '10', unit: 'MTR' });
        expect(promisedOnlineText(cloth, en)).toBe('2.5 m is kept for online orders. Send it anyway?');
        expect(promisedOnlineText(cloth, hi)).toContain('2.5 मीटर');
        expect(promisedOnlineText(cloth, en)).not.toContain('25');

        const bottles = readInventoryError(serverError(409, 'PROMISED_ONLINE: 3 unit(s) of BOTTLE-1 are held or sold online'))
            .values;
        expect(promisedOnlineText(bottles, en)).toBe('3 units are kept for online orders. Send them anyway?');
        expect(promisedOnlineText({ count: '' }, en)).toBeNull();
    });
});
