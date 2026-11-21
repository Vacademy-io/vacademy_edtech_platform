/** Contract §7.6: pending saves coalesce, pieces count once, Post needs the choice, review grouping. */
import { describe, expect, it } from 'vitest';
import { canPost, groupReview, lineKey, mergeLines, opBody, pieceScan, queueOp, shownQuantity } from './count-sheet';
import type { CountLine, CountReview } from './inventory-types';

describe('pending saves', () => {
    it('ADDs add up into one ADD; the latest SET wins; ADD after SET adds to it', () => {
        expect(queueOp({ kind: 'ADD', quantity: 1 }, { kind: 'ADD', quantity: 2 })).toEqual({ kind: 'ADD', quantity: 3 });
        expect(queueOp({ kind: 'ADD', quantity: 4 }, { kind: 'SET', quantity: 9 })).toEqual({ kind: 'SET', quantity: 9 });
        expect(queueOp({ kind: 'SET', quantity: 9 }, { kind: 'ADD', quantity: 1 })).toEqual({ kind: 'SET', quantity: 10 });
        expect(queueOp(undefined, { kind: 'ADD', quantity: 1 })).toEqual({ kind: 'ADD', quantity: 1 });
    });

    it('the shown quantity includes what is on its way and what waits', () => {
        expect(shownQuantity(5, { kind: 'ADD', quantity: 1 }, { kind: 'ADD', quantity: 2 })).toBe(8);
        expect(shownQuantity(5, { kind: 'ADD', quantity: 1 }, { kind: 'SET', quantity: 2 })).toBe(2);
        expect(shownQuantity(null, undefined, undefined)).toBe(0);
    });

    it('the request line of a change', () => {
        expect(opBody('v:ps-1', { kind: 'ADD', quantity: 3 })).toEqual({ package_session_id: 'ps-1', mode: 'ADD', quantity: 3 });
        expect(opBody('p:PABCDEFGH2', { kind: 'PIECE', code: 'PABCDEFGH2' })).toEqual({ piece_code: 'PABCDEFGH2' });
    });
});

describe('pieces', () => {
    it('a piece already counted or waiting is refused, in any letter case', () => {
        expect(pieceScan(new Set(['p:PABCDEFGH2']), new Set(), 'pabcdefgh2').refusal).toBe('alreadyCounted');
        expect(pieceScan(new Set(), new Set(['p:PABCDEFGH2']), 'PABCDEFGH2').refusal).toBe('alreadyCounted');
        expect(pieceScan(new Set(), new Set(), 'PABCDEFGH2')).toEqual({ key: 'p:PABCDEFGH2', refusal: null });
    });

    it('a server answer replaces its own line', () => {
        const line = (id: string, psid: string, qty: number, code: string | null = null) =>
            ({ id, package_session_id: psid, piece_id: code ? `pc-${id}` : null, piece_code: code, counted_qty: qty }) as CountLine;
        const merged = mergeLines([line('a', 'ps-1', 2), line('b', 'ps-2', 1, 'P2')], [line('a', 'ps-1', 5), line('c', 'ps-3', 1)]);
        expect(merged.map((l) => [lineKey(l), l.counted_qty])).toEqual([
            ['v:ps-1', 5],
            ['p:P2', 1],
            ['v:ps-3', 1],
        ]);
    });
});

describe('post and review', () => {
    it('Post needs the uncounted choice: there is no default', () => {
        expect(canPost(null)).toBe(false);
        expect(canPost('')).toBe(false);
        expect(canPost('MAYBE')).toBe(false);
        expect(canPost('SKIP')).toBe(true);
        expect(canPost('ZERO')).toBe(true);
    });

    it('groups in reading order, empty groups left out', () => {
        const empty = { missing_pieces: [], found_pieces: [], misplaced_pieces: [], not_in_stock_pieces: [], reserved_not_counted: [], arrived_during_count: [] };
        const review = {
            lines: [
                { line_id: 'a', adjustment: 0, piece_code: null },
                { line_id: 'b', adjustment: -2, piece_code: null },
                // A scanned piece line: shown in the piece groups, not in the quantity table.
                { line_id: 'p', adjustment: 1, piece_code: 'P9' },
            ],
            uncounted: [{ package_session_id: 'ps-9', sku: 'X', item_name: null, on_hand_now: 3 }],
            pieces: { ...empty, missing_pieces: [{ piece_id: 'pc-1' }], arrived_during_count: [{ piece_id: 'pc-2' }] },
        } as unknown as CountReview;
        expect(groupReview(review).map((g) => g.id)).toEqual([
            'differences',
            'uncounted',
            'missing_pieces',
            'arrived_during_count',
            'agreeing',
        ]);
        const table = groupReview(review).flatMap((g) => ('lines' in g ? g.lines.map((l) => l.line_id) : []));
        expect(table).toEqual(['b', 'a']);
    });
});
