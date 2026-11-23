/** F3: the pack station reducer (contract §5.3.3), row by row. */
import { describe, expect, it } from 'vitest';
import { detailFixture } from './order-fixtures';
import type { ScanResult } from './order-types';
import {
    type PackSession,
    initPackSession,
    isComplete,
    lineNoFromServer,
    packReducer,
    toPackRequest,
} from './pack-session';

const variant = (packageSessionId: string, extra: Partial<ScanResult['variant']> = {}): ScanResult['variant'] => ({
    package_session_id: packageSessionId,
    package_id: null,
    sku: null,
    product_name: null,
    variant_name: null,
    stock_mode: null,
    stock_policy: null,
    unit: null,
    qty_scale: 1,
    ...extra,
});

const pieceScan = (
    packageSessionId: string,
    code: string,
    piece: Partial<NonNullable<ScanResult['piece']>> = {}
): ScanResult => ({
    kind: 'PIECE',
    variant: variant(packageSessionId),
    piece: { id: `id-${code}`, code, status: 'IN_STOCK', location_id: 'loc-1', ...piece },
});

const variantScan = (packageSessionId: string, extra: Partial<ScanResult['variant']> = {}): ScanResult => ({
    kind: 'VARIANT',
    variant: variant(packageSessionId, extra),
    piece: null,
});

const scan = (state: PackSession, result: ScanResult) => packReducer(state, { type: 'SCAN_RESULT', result });
const line = (state: PackSession, id: string) => state.lines.find((l) => l.lineId === id)!;
const refusal = (state: PackSession) => (state.last && !state.last.ok ? state.last.refusal : null);

/** line-1: 2 × Cotton scarf (piece item with B1), line-2: 1 × Steel bottle (quantity item with B1). */
const withFacts = () =>
    initPackSession(
        detailFixture(
            {
                lines: [
                    {
                        id: 'line-1',
                        line_no: 1,
                        line_type: 'ITEM',
                        package_session_id: 'ps-scarf',
                        name: 'Cotton scarf',
                        qty_scale: 1,
                        quantity: 2,
                        qty_cancelled: 0,
                        qty_shipped: 0,
                        stock_mode: 'PIECE',
                        stock_policy: 'TRACKED',
                    },
                    {
                        id: 'line-2',
                        line_no: 2,
                        line_type: 'ITEM',
                        package_session_id: 'ps-bottle',
                        name: 'Steel bottle',
                        qty_scale: 1,
                        quantity: 1,
                        qty_cancelled: 0,
                        qty_shipped: 0,
                        stock_mode: 'QUANTITY',
                        stock_policy: 'TRACKED',
                    },
                ],
            },
            { status: 'CONFIRMED' }
        )
    );

/** The same order from a backend without B1: both lines UNKNOWN. */
const withoutFacts = () => initPackSession(detailFixture({}, { status: 'CONFIRMED' }));

describe('initPackSession', () => {
    it('open item lines only, modes from B1 or UNKNOWN', () => {
        expect(withFacts().lines.map((l) => [l.lineId, l.mode, l.needed])).toEqual([
            ['line-1', 'PIECE', 2],
            ['line-2', 'QUANTITY', 1],
        ]);
        expect(withoutFacts().lines.map((l) => l.mode)).toEqual(['UNKNOWN', 'UNKNOWN']);
    });

    it('needed = quantity − cancelled − shipped; a fully handled line is left out', () => {
        const session = initPackSession(
            detailFixture({
                lines: [
                    { id: 'a', line_no: 1, line_type: 'ITEM', package_session_id: 'p', quantity: 5, qty_cancelled: 1, qty_shipped: 1 },
                    { id: 'b', line_no: 2, line_type: 'ITEM', package_session_id: 'q', quantity: 1, qty_cancelled: 1, qty_shipped: 0 },
                ],
            })
        );
        expect(session.lines.map((l) => [l.lineId, l.needed])).toEqual([['a', 3]]);
    });
});

describe('piece scans', () => {
    it('match by package_session_id, then refuse a duplicate', () => {
        let state = scan(withFacts(), pieceScan('ps-scarf', 'P-1'));
        expect(line(state, 'line-1')).toMatchObject({ packed: 1, pieceCodes: ['P-1'], pieceIds: ['id-P-1'] });
        state = scan(state, pieceScan('ps-scarf', 'p-1'));
        expect(refusal(state)).toBe('alreadyScanned');
        expect(line(state, 'line-1').packed).toBe(1);
    });

    it('refuses a piece not in stock, elsewhere, or of another product', () => {
        expect(refusal(scan(withFacts(), pieceScan('ps-scarf', 'P-2', { status: 'SOLD' })))).toBe('pieceNotInStock');
        const notInStock = scan(withFacts(), pieceScan('ps-scarf', 'P-2', { status: 'SOLD' }));
        expect(notInStock.last).toMatchObject({ ok: false, status: 'SOLD' });
        expect(refusal(scan(withFacts(), pieceScan('ps-scarf', 'P-3', { location_id: 'loc-9' })))).toBe('pieceElsewhere');
        expect(refusal(scan(withFacts(), pieceScan('ps-other', 'P-4')))).toBe('notInOrder');
    });

    it('refuses more pieces than the order needs', () => {
        let state = scan(withFacts(), pieceScan('ps-scarf', 'P-1'));
        state = scan(state, pieceScan('ps-scarf', 'P-2'));
        expect(line(state, 'line-1').packed).toBe(2);
        expect(refusal(scan(state, pieceScan('ps-scarf', 'P-3')))).toBe('enoughAlready');
    });

    it('a piece label on a quantity line counts as one unit and sends no code', () => {
        const state = scan(withFacts(), pieceScan('ps-bottle', 'P-9'));
        expect(line(state, 'line-2')).toMatchObject({ packed: 1, pieceCodes: [], mode: 'QUANTITY' });
    });

    it('an UNKNOWN line learns PIECE from a piece scan', () => {
        const state = scan(withoutFacts(), pieceScan('ps-scarf', 'P-1'));
        expect(line(state, 'line-1')).toMatchObject({ mode: 'PIECE', packed: 1, pieceCodes: ['P-1'] });
    });
});

describe('variant scans', () => {
    it('refuses a product label on a piece line', () => {
        expect(refusal(scan(withFacts(), variantScan('ps-scarf')))).toBe('scanPieceLabel');
    });

    it('counts a quantity line, then refuses over-count, and refuses a product not in the order', () => {
        let state = scan(withFacts(), variantScan('ps-bottle'));
        expect(line(state, 'line-2').packed).toBe(1);
        state = scan(state, variantScan('ps-bottle'));
        expect(refusal(state)).toBe('enoughAlready');
        expect(refusal(scan(withFacts(), variantScan('ps-other')))).toBe('notInOrder');
    });

    it('UNKNOWN becomes QUANTITY on a product label', () => {
        const state = scan(withoutFacts(), variantScan('ps-bottle'));
        expect(line(state, 'line-2')).toMatchObject({ mode: 'QUANTITY', packed: 1 });
    });

    it('UNKNOWN learns PIECE when the scan answer says the product is one-of-a-kind', () => {
        const state = scan(withoutFacts(), variantScan('ps-scarf', { stock_mode: 'PIECE', stock_policy: 'TRACKED' }));
        expect(refusal(state)).toBe('scanPieceLabel');
        expect(line(state, 'line-1').mode).toBe('PIECE');
    });

    it('a measured line fills on one scan', () => {
        const session = initPackSession(
            detailFixture({
                lines: [
                    {
                        id: 'cloth',
                        line_no: 1,
                        line_type: 'ITEM',
                        package_session_id: 'ps-cloth',
                        quantity: 25,
                        qty_scale: 10,
                        unit: 'm',
                        qty_cancelled: 0,
                        qty_shipped: 0,
                        stock_mode: 'QUANTITY',
                        stock_policy: 'TRACKED',
                    },
                ],
            })
        );
        const state = scan(session, variantScan('ps-cloth', { qty_scale: 10 }));
        expect(line(state, 'cloth')).toMatchObject({ packed: 25, needed: 25 });
        expect(isComplete(state)).toBe(true);
    });

    it('two lines of one variant fill in line order', () => {
        const session = initPackSession(
            detailFixture({
                lines: [
                    { id: 'x1', line_no: 1, line_type: 'ITEM', package_session_id: 'ps-bottle', quantity: 1, qty_cancelled: 0, qty_shipped: 0 },
                    { id: 'x2', line_no: 2, line_type: 'ITEM', package_session_id: 'ps-bottle', quantity: 1, qty_cancelled: 0, qty_shipped: 0 },
                ],
            })
        );
        let state = scan(session, variantScan('ps-bottle'));
        expect([line(state, 'x1').packed, line(state, 'x2').packed]).toEqual([1, 0]);
        state = scan(state, variantScan('ps-bottle'));
        expect([line(state, 'x1').packed, line(state, 'x2').packed]).toEqual([1, 1]);
    });
});

describe('ticks, server answers and the request', () => {
    it('tick only for non-piece lines; untick undoes', () => {
        let state = packReducer(withFacts(), { type: 'TICK', lineId: 'line-2' });
        expect(line(state, 'line-2').packed).toBe(1);
        state = packReducer(state, { type: 'TICK', lineId: 'line-1' });
        expect(refusal(state)).toBe('tickNotAllowed');
        expect(line(state, 'line-1').packed).toBe(0);
        state = packReducer(state, { type: 'UNTICK', lineId: 'line-2' });
        expect(line(state, 'line-2').packed).toBe(0);
    });

    it('scanning off (no Stock feature): every line may be ticked and the order is complete', () => {
        let state = packReducer(withFacts(), { type: 'SCAN_UNAVAILABLE' });
        state = packReducer(state, { type: 'TICK', lineId: 'line-1' });
        state = packReducer(state, { type: 'TICK', lineId: 'line-2' });
        expect(isComplete(state)).toBe(true);
    });

    it('UNKNOWN learns PIECE from 409 PIECE_SCAN_REQUIRED: line 2 …, and its tick is undone', () => {
        let state = packReducer(withoutFacts(), { type: 'TICK', lineId: 'line-1' });
        state = packReducer(state, { type: 'TICK', lineId: 'line-2' });
        expect(isComplete(state)).toBe(true);
        const lineNo = lineNoFromServer('line 2 needs a piece for every unit');
        expect(lineNo).toBe(2);
        state = packReducer(state, { type: 'SERVER_PIECE_SCAN_REQUIRED', lineNo: lineNo! });
        expect(line(state, 'line-2')).toMatchObject({ mode: 'PIECE', packed: 0 });
        expect(isComplete(state)).toBe(false);
    });

    it('a piece the server says is not available is removed', () => {
        let state = scan(withFacts(), pieceScan('ps-scarf', 'P-1'));
        state = packReducer(state, { type: 'SERVER_PIECE_NOT_AVAILABLE', code: 'P-1' });
        expect(line(state, 'line-1')).toMatchObject({ packed: 0, pieceCodes: [], pieceIds: [] });
        const kept = packReducer(state, { type: 'SERVER_PIECE_NOT_AVAILABLE', code: null });
        expect(kept).toBe(state);
    });

    it('complete only when every line is full; the request sends piece codes only for piece lines', () => {
        let state = scan(withFacts(), pieceScan('ps-scarf', 'P-1'));
        expect(isComplete(state)).toBe(false);
        state = scan(state, pieceScan('ps-scarf', 'P-2'));
        expect(isComplete(state)).toBe(false);
        state = scan(state, variantScan('ps-bottle'));
        expect(isComplete(state)).toBe(true);
        expect(toPackRequest(state, 'w-req-123456', 750)).toEqual({
            client_request_id: 'w-req-123456',
            order_id: 'ord-1',
            from_status: 'CONFIRMED',
            lines: [
                { order_line_id: 'line-1', quantity: 2, piece_codes: ['P-1', 'P-2'] },
                { order_line_id: 'line-2', quantity: 1 },
            ],
            weight_grams: 750,
        });
    });

    it('a code the server does not know is refused', () => {
        expect(refusal(packReducer(withFacts(), { type: 'SCAN_NOT_FOUND' }))).toBe('codeNotFound');
    });
});
