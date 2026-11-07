import { describe, expect, it } from 'vitest';
import type { LeadCardVM } from '@/components/shared/leads';
import { bucketWindow, classify } from './follow-up-buckets';

// 14:30 local on 29 Oct 2026, whatever the test machine's zone.
const NOW = new Date(2026, 9, 29, 14, 30, 0);
const START_OF_TODAY = new Date(2026, 9, 29, 0, 0, 0, 0).toISOString();
const END_OF_TODAY = new Date(2026, 9, 29, 23, 59, 59, 999).toISOString();

const vm = (due: Date, flags: Partial<LeadCardVM> = {}) =>
    ({ followUpDueAt: due.toISOString(), ...flags }) as unknown as LeadCardVM;

describe('bucketWindow', () => {
    it('splits Overdue and Today at now by default, as before', () => {
        expect(bucketWindow('overdue', NOW)).toEqual({ to: NOW.toISOString() });
        expect(bucketWindow('today', NOW)).toEqual({ from: NOW.toISOString(), to: END_OF_TODAY });
    });

    it('with overdue-by-date, splits them at the start of today', () => {
        expect(bucketWindow('overdue', NOW, true)).toEqual({ to: START_OF_TODAY });
        expect(bucketWindow('today', NOW, true)).toEqual({
            from: START_OF_TODAY,
            to: END_OF_TODAY,
        });
    });

    it('leaves Upcoming and All alone either way', () => {
        expect(bucketWindow('upcoming', NOW, true)).toEqual(bucketWindow('upcoming', NOW));
        expect(bucketWindow('all', NOW, true)).toEqual({});
    });
});

describe('classify', () => {
    const thisMorning = new Date(2026, 9, 29, 9, 0, 0);
    const yesterdayNight = new Date(2026, 9, 28, 23, 0, 0);

    it('a follow-up due this morning is Today, and yesterday is Overdue', () => {
        expect(classify(vm(thisMorning), NOW, true)).toBe('today');
        expect(classify(vm(yesterdayNight), NOW, true)).toBe('overdue');
    });

    it('by default the time-based SLA flags still force Overdue, as before', () => {
        expect(classify(vm(thisMorning, { followUpOverdue: true }), NOW)).toBe('overdue');
    });

    it('with overdue-by-date the SLA flags do not override the date', () => {
        expect(
            classify(vm(thisMorning, { followUpOverdue: true, tatOverdue: true }), NOW, true)
        ).toBe('today');
    });
});
