import { describe, expect, it } from 'vitest';
import { paymentReceivedAt } from '../paymentReceivedAt';

describe('paymentReceivedAt', () => {
    it('keeps the exact time when the payment date is the entry day', () => {
        const log = {
            created_at: '2026-10-15T12:00:18.600Z',
            date: '2026-10-15T00:00:00.000+00:00',
        };
        expect(paymentReceivedAt(log)).toEqual({ value: log.created_at, hasTime: true });
    });

    it('uses the payment date for a back-dated entry', () => {
        const log = {
            created_at: '2026-10-23T05:43:22.392Z',
            date: '2026-06-01T00:00:00.000+00:00',
        };
        expect(paymentReceivedAt(log)).toEqual({ value: log.date, hasTime: false });
    });

    it('accepts the next day, an IST entry just past midnight', () => {
        const log = {
            created_at: '2026-10-14T19:00:00.000Z',
            date: '2026-10-15T00:00:00.000+00:00',
        };
        expect(paymentReceivedAt(log).value).toBe(log.date);
    });

    it('ignores a typo year and a future date', () => {
        const created = '2026-09-29T08:18:21.486Z';
        expect(
            paymentReceivedAt({ created_at: created, date: '0026-04-01T00:00:00.000+00:00' }).value
        ).toBe(created);
        expect(
            paymentReceivedAt({ created_at: created, date: '2010-01-24T00:00:00.000+00:00' }).value
        ).toBe(created);
        expect(
            paymentReceivedAt({ created_at: created, date: '2026-10-05T00:00:00.000+00:00' }).value
        ).toBe(created);
    });

    it('falls back to whichever value exists', () => {
        expect(paymentReceivedAt({ created_at: null, date: '2026-06-01' })).toEqual({
            value: '2026-06-01',
            hasTime: false,
        });
        expect(paymentReceivedAt(null)).toEqual({ value: '', hasTime: false });
    });
});
