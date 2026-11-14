import { describe, expect, it } from 'vitest';
import { formatInboxPeriod, movePeriodEnd } from '../period';

describe('inbox period', () => {
    it('prints a period the way the day picker prints a day', () => {
        expect(formatInboxPeriod('2026-10-12', '2026-10-29')).toBe('12 Oct – 29 Oct 2026');
        expect(formatInboxPeriod('2026-10-29', '2026-10-29')).toBe('29 Oct 2026');
        // The year shows on both ends only when they differ.
        expect(formatInboxPeriod('2025-12-20', '2026-01-05')).toBe('20 Dec 2025 – 5 Jan 2026');
    });

    it('gives a first pick as a one-day period', () => {
        expect(movePeriodEnd({}, 'from', '2026-10-12')).toEqual({
            from: '2026-10-12',
            to: '2026-10-12',
        });
        expect(movePeriodEnd({}, 'to', '2026-10-29')).toEqual({
            from: '2026-10-29',
            to: '2026-10-29',
        });
    });

    it('moves one end and keeps the other while the pair stays valid', () => {
        const current = { from: '2026-10-12', to: '2026-10-29' };
        expect(movePeriodEnd(current, 'from', '2026-10-20')).toEqual({
            from: '2026-10-20',
            to: '2026-10-29',
        });
        expect(movePeriodEnd(current, 'to', '2026-10-15')).toEqual({
            from: '2026-10-12',
            to: '2026-10-15',
        });
    });

    it('drags the other end along when a move would cross it', () => {
        const current = { from: '2026-10-12', to: '2026-10-29' };
        expect(movePeriodEnd(current, 'from', '2026-11-02')).toEqual({
            from: '2026-11-02',
            to: '2026-11-02',
        });
        expect(movePeriodEnd(current, 'to', '2026-10-05')).toEqual({
            from: '2026-10-05',
            to: '2026-10-05',
        });
    });
});
