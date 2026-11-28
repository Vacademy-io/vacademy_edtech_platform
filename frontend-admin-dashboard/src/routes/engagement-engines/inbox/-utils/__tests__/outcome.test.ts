import { describe, expect, it } from 'vitest';
import type { TaskOutcome } from '../../../-types';
import { formatCallDuration, hasBeenDispatched, outcomeBadges } from '../outcome';

const base: TaskOutcome = {
    actionId: 'a1',
    channel: 'EMAIL',
    tracked: true,
    deliveryStatus: null,
    delivered: false,
    opened: false,
    clicked: false,
    bounced: false,
    complained: false,
};
const keys = (o: TaskOutcome) => outcomeBadges(o, (iso) => `at ${iso}`).map((b) => b.key);

describe('outcome badges', () => {
    it('shows how far an email got, most engaged first', () => {
        expect(keys({ ...base, delivered: true })).toEqual(['delivered']);
        expect(keys({ ...base, delivered: true, opened: true })).toEqual(['opened']);
        expect(keys({ ...base, delivered: true, opened: true, clicked: true })).toEqual([
            'clicked',
        ]);
        expect(keys({ ...base, bounced: true })).toEqual(['bounced']);
        expect(keys({ ...base, delivered: true, complained: true })).toEqual(['delivered', 'spam']);
        expect(keys(base)).toEqual(['sent']);
        expect(keys({ ...base, tracked: false })).toEqual(['notTracked']);
    });

    it('shows WhatsApp as read, delivered or failed with the reason, never email flags', () => {
        const wa = { ...base, channel: 'WHATSAPP' as const };
        expect(keys({ ...wa, deliveryStatus: 'READ', delivered: true })).toEqual(['read']);
        expect(keys({ ...wa, deliveryStatus: 'DELIVERED' })).toEqual(['delivered']);
        // Opened / bounced flags mean nothing on WhatsApp.
        expect(keys({ ...wa, opened: true, bounced: true })).toEqual(['sent']);
        expect(
            outcomeBadges({ ...wa, deliveryStatus: 'FAILED', errorCode: '131026' }, String)[0]
        ).toMatchObject({
            key: 'failed',
            detail: '131026',
        });
    });

    it('shows an AI call only as a call result, with its length when connected', () => {
        const call = { ...base, channel: 'AI_CALL' as const, delivered: true, opened: true };
        const connected = outcomeBadges(
            { ...call, call: { status: 'COMPLETED', connected: true, durationSeconds: 81 } },
            String
        );
        expect(connected).toEqual([{ key: 'connected', tone: 'success', detail: '1:21' }]);
        expect(keys({ ...call, call: { status: 'NO_ANSWER', connected: false } })).toEqual([
            'noAnswer',
        ]);
        expect(keys({ ...call, call: { status: 'BUSY', connected: false } })).toEqual(['busy']);
        expect(keys({ ...call, call: { status: 'FAILED', connected: false } })).toEqual([
            'callFailed',
        ]);
        expect(keys({ ...call, call: { status: 'NOT_DIALLED', connected: false } })).toEqual([
            'notDialled',
        ]);
        expect(keys({ ...call, call: null })).toEqual(['notDialled']);
    });

    it('never tracks in-app, and shows a reply on any channel', () => {
        expect(keys({ ...base, channel: 'IN_APP', tracked: false })).toEqual(['notTracked']);
        expect(
            keys({ ...base, channel: 'IN_APP', tracked: false, repliedAt: '2026-10-30T10:15:00Z' })
        ).toEqual(['replied']);
        const replied = outcomeBadges(
            { ...base, delivered: true, repliedAt: '2026-10-30T10:15:00Z' },
            (iso) => `at ${iso}`
        );
        expect(replied.map((b) => b.key)).toEqual(['delivered', 'replied']);
        expect(replied[1]?.detail).toBe('at 2026-10-30T10:15:00Z');
    });
});

describe('call length', () => {
    it('formats minutes and hours, and nothing for no length', () => {
        expect(formatCallDuration(81)).toBe('1:21');
        expect(formatCallDuration(9)).toBe('0:09');
        expect(formatCallDuration(3725)).toBe('1:02:05');
        expect(formatCallDuration(0)).toBe('');
        expect(formatCallDuration(null)).toBe('');
    });
});

describe('which tasks have an outcome to look up', () => {
    it('is only what actually went out', () => {
        expect(hasBeenDispatched({ kind: 'SEND', status: 'SENT' })).toBe(true);
        expect(hasBeenDispatched({ kind: 'TASK', status: 'FAILED' })).toBe(true);
        expect(
            hasBeenDispatched({
                kind: 'TASK',
                status: 'DONE',
                dispatchedAt: '2026-10-30T10:00:00Z',
            })
        ).toBe(true);
        expect(hasBeenDispatched({ kind: 'TASK', status: 'OPEN' })).toBe(false);
        expect(hasBeenDispatched({ kind: 'TASK', status: 'DONE' })).toBe(false);
        expect(
            hasBeenDispatched({
                kind: 'NO_OP',
                status: 'DONE',
                dispatchedAt: '2026-10-30T10:00:00Z',
            })
        ).toBe(false);
    });
});
