/**
 * POS review follow-ups: the request id of a counter write is kept until the
 * server answers for sure (a timeout or a 5xx may come after the commit), and
 * an exchange credit stays on the till until used.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readPosError } from './pos-errors';
import {
    attemptKey,
    nextAttempt,
    outcomeOf,
    readAttempt,
    readExchange,
    useAttemptStore,
    writeExchange,
} from './pos-session-store';
import { networkError, serverError } from './pos-test-fixtures';

afterEach(() => sessionStorage.clear());

let n = 0;
const makeId = () => `id-${(n += 1)}`;

describe('nextAttempt (pure)', () => {
    it('a new body gets a new id; the same body keeps it', () => {
        const a = nextAttempt(null, { x: 1 }, makeId).attempt;
        expect(nextAttempt({ ...a, uncertain: false }, { x: 1 }, makeId).attempt.id).toBe(a.id);
        expect(nextAttempt({ ...a, uncertain: false }, { x: 2 }, makeId).attempt.id).not.toBe(a.id);
    });

    it('an unanswered attempt keeps its id whatever the body is now, and says so', () => {
        const a = nextAttempt(null, { tenders: 'cash' }, makeId).attempt;
        const next = nextAttempt(a, { tenders: 'upi' }, makeId);
        expect(next.attempt.id).toBe(a.id);
        expect(next.carried).toBe(true);
        expect(next.attempt.body).toBe(JSON.stringify({ tenders: 'upi' }));
    });
});

describe('outcomeOf', () => {
    it('reads timeouts, 408, 429 and every 5xx as unknown; other 4xx as a refusal', () => {
        expect(outcomeOf(null)).toBe('saved');
        expect(outcomeOf(readPosError(networkError()))).toBe('unknown');
        [408, 429, 500, 502, 503, 504].forEach((status) =>
            expect(outcomeOf(readPosError(serverError(status, 'x')))).toBe('unknown')
        );
        expect(outcomeOf(readPosError(serverError(409, 'NOT_IN_STOCK: line l1')))).toBe('refused');
        expect(outcomeOf(readPosError(serverError(409, 'IDEMPOTENCY_MISMATCH: used')))).toBe('mismatch');
    });
});

describe('useAttemptStore', () => {
    it('keeps an unanswered id across a reload (a new store reads this tab’s copy)', () => {
        const first = renderHook(() => useAttemptStore('inst-1', 'sess-1', 'pos'));
        let id = '';
        act(() => {
            id = first.result.current.begin('cash', { amount: '100.00' }).id;
        });
        act(() => {
            first.result.current.settle('cash', readPosError(serverError(503, 'Service Unavailable')), false);
        });
        expect(readAttempt('inst-1', 'sess-1', 'cash')?.id).toBe(id);
        first.unmount();

        const second = renderHook(() => useAttemptStore('inst-1', 'sess-1', 'pos'));
        expect(second.result.current.isUncertain('cash')).toBe(true);
        let again = { id: '', carried: false };
        act(() => {
            again = second.result.current.begin('cash', { amount: '200.00' });
        });
        expect(again).toEqual({ id, carried: true });
        // Saved under the other body: the screen is told, the id is kept.
        let probablySaved = false;
        act(() => {
            probablySaved = second.result.current.settle(
                'cash',
                readPosError(serverError(409, 'IDEMPOTENCY_MISMATCH: used')),
                true
            );
        });
        expect(probablySaved).toBe(true);
        expect(second.result.current.isUncertain('cash')).toBe(true);
        act(() => second.result.current.clear('cash'));
        expect(sessionStorage.getItem(attemptKey('inst-1', 'sess-1', 'cash'))).toBeNull();
    });

    it('a definite answer ends the attempt; another session has its own', () => {
        const store = renderHook(() => useAttemptStore('inst-1', 'sess-1', 'pos'));
        let id = '';
        act(() => {
            id = store.result.current.begin('sale', { a: 1 }).id;
        });
        expect(readAttempt('inst-1', 'sess-1', 'sale')?.uncertain).toBe(true); // on its way = unknown
        expect(readAttempt('inst-1', 'sess-2', 'sale')).toBeNull();
        act(() => {
            store.result.current.settle('sale', null, false);
        });
        expect(readAttempt('inst-1', 'sess-1', 'sale')).toBeNull();
        let next = '';
        act(() => {
            next = store.result.current.begin('sale', { a: 1 }).id;
        });
        expect(next).not.toBe(id);
    });
});

describe('exchange credit store', () => {
    it('is kept per session until removed; junk reads as none', () => {
        writeExchange('inst-1', 'sess-1', { returnId: 'r-1', number: 'RET-1', credit: 300 });
        expect(readExchange('inst-1', 'sess-1')).toEqual({ returnId: 'r-1', number: 'RET-1', credit: 300 });
        expect(readExchange('inst-1', 'sess-2')).toBeNull();
        writeExchange('inst-1', 'sess-1', null);
        expect(readExchange('inst-1', 'sess-1')).toBeNull();
        sessionStorage.setItem('commerce.pos.exchange.inst-1.sess-1', '{bad');
        expect(readExchange('inst-1', 'sess-1')).toBeNull();
    });
});
