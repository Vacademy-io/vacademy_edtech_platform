/** Fix round: the server's next_actions decide (L3), typed lengths of measured goods (L7), changed lines (L4). */
import { describe, expect, it } from 'vitest';
import { countActions, isMeasured, needsRecount, opBody, queueOp } from './count-sheet';

const open = { status: 'OPEN', kind: 'RECOUNT', started_by: 'u-other' };

describe('countActions (L3)', () => {
    it('an empty next_actions from the server means no buttons (a main counter on a blind recount)', () => {
        expect([...countActions({ ...open, next_actions: [] }, 'u-me', true)]).toEqual([]);
    });

    it("the server's list is followed as sent", () => {
        expect([...countActions({ ...open, next_actions: ['COUNT', 'POST'] }, 'u-me', false)]).toEqual(['COUNT', 'POST']);
    });

    it('only an answer without next_actions falls back to status and starter', () => {
        expect(countActions({ ...open, kind: 'COUNT', next_actions: null }, 'u-me', false).has('POST')).toBe(true);
    });
});

describe('measured goods (L7)', () => {
    it('a typed length goes as an explicit ADD; lengths waiting add up and stay explicit', () => {
        expect(isMeasured({ qty_scale: 10 })).toBe(true);
        expect(isMeasured({ qty_scale: 1 })).toBe(false);
        const op = queueOp({ kind: 'ADD', quantity: 25, explicit: true }, { kind: 'ADD', quantity: 12, explicit: true });
        expect(op).toEqual({ kind: 'ADD', quantity: 37, explicit: true });
        expect(opBody('v:ps-cloth', op)).toEqual({
            package_session_id: 'ps-cloth',
            mode: 'ADD',
            quantity: 37,
            explicit_quantity: true,
        });
        expect(opBody('v:ps-cup', { kind: 'ADD', quantity: 1 })).toEqual({ package_session_id: 'ps-cup', mode: 'ADD', quantity: 1 });
    });
});

describe('lines changed while counted (L4)', () => {
    it('flagged and not accepted blocks the post; accepted does not', () => {
        expect(needsRecount({ flags: ['NEEDS_RECOUNT'] })).toBe(true);
        expect(needsRecount({ flags: ['NEEDS_RECOUNT', 'RECOUNT_ACCEPTED'] })).toBe(false);
        expect(needsRecount({ flags: [] })).toBe(false);
    });
});
