import { describe, expect, it } from 'vitest';
import { normalizeDiagnosis } from './engagement-diagnosis';

describe('normalizeDiagnosis', () => {
    it('fills every list of an empty or missing response', () => {
        for (const raw of [undefined, null, {}]) {
            const d = normalizeDiagnosis(raw);
            expect(d.problems).toEqual([]);
            expect(d.stages).toEqual([]);
            expect(d.dataGaps).toEqual([]);
            expect(d.moreProblems).toBe(0);
            expect(d.weekly).toBeNull();
            expect(d.errors).toEqual({});
            expect(d.engineId).toBeNull();
        }
    });

    it('keeps a problem as the contract sends it', () => {
        const d = normalizeDiagnosis({
            view: 'DAILY',
            from: '2026-11-04',
            to: '2026-11-04',
            days: 1,
            problems: [
                {
                    code: 'WHATSAPP_FAILED_HIGH',
                    stage: 'WHATSAPP',
                    severity: 'warning',
                    affected: 40,
                    numbers: { failed: 40, tried: 120, rate: 0.33 },
                    breakdown: [{ key: 'NOT_ON_WHATSAPP', count: 35 }],
                    names: [],
                    link: {
                        target: 'OUTCOMES',
                        channel: 'WHATSAPP',
                        outcome: 'failed',
                        kind: null,
                    },
                },
            ],
            moreProblems: 2,
        });
        expect(d.problems[0]).toEqual({
            code: 'WHATSAPP_FAILED_HIGH',
            stage: 'WHATSAPP',
            severity: 'warning',
            affected: 40,
            numbers: { failed: 40, tried: 120, rate: 0.33 },
            breakdown: [{ key: 'NOT_ON_WHATSAPP', count: 35 }],
            names: [],
            link: { target: 'OUTCOMES', channel: 'WHATSAPP', outcome: 'failed', kind: null },
        });
        expect(d.moreProblems).toBe(2);
    });

    it('treats a severity it does not know as a warning, and drops numbers that are not numbers', () => {
        const d = normalizeDiagnosis({
            problems: [
                {
                    code: 'X',
                    stage: 'EMAIL',
                    severity: 'catastrophic' as never,
                    affected: 1,
                    numbers: { good: 3, bad: null, worse: 'x' } as never,
                    breakdown: [{ key: 'A', count: 1 }, null as never],
                    names: ['a', 5 as never],
                    link: { target: 5 } as never,
                },
            ],
        });
        expect(d.problems[0]?.severity).toBe('warning');
        expect(d.problems[0]?.numbers).toEqual({ good: 3 });
        expect(d.problems[0]?.breakdown).toEqual([{ key: 'A', count: 1 }]);
        expect(d.problems[0]?.names).toEqual(['a']);
        expect(d.problems[0]?.link).toBeNull();
    });

    it('keeps stage statuses and data gaps as they come, unknown ones too', () => {
        const d = normalizeDiagnosis({
            stages: [
                { stage: 'LEADS', status: 'UNAVAILABLE' },
                { stage: 'BILLING', status: 'FUTURE_STATUS' },
            ],
            dataGaps: [{ code: 'EMAIL_REPLIES_NOT_TRACKED', names: ['hello@example.com'] }],
        });
        expect(d.stages).toEqual([
            { stage: 'LEADS', status: 'UNAVAILABLE' },
            { stage: 'BILLING', status: 'FUTURE_STATUS' },
        ]);
        expect(d.dataGaps).toEqual([
            { code: 'EMAIL_REPLIES_NOT_TRACKED', names: ['hello@example.com'] },
        ]);
    });

    it('keeps a rate the server could not work out as null, not 0%', () => {
        const d = normalizeDiagnosis({
            view: 'WEEKLY',
            weekly: {
                minimums: { leadsPerSource: 30, callsPerHour: 20, sendsPerRow: 100 },
                callHours: [{ hour: 9, placed: 0, connected: 0, connectRate: null, enough: false }],
            } as never,
        });
        expect(d.view).toBe('WEEKLY');
        expect(d.weekly?.callHours[0]?.connectRate).toBeNull();
        expect(d.weekly?.callHours[0]?.enough).toBe(false);
        // The lists the server left out are empty; the single blocks stay null.
        expect(d.weekly?.leadSources).toEqual([]);
        expect(d.weekly?.callLengths).toBeNull();
        expect(d.weekly?.callInsights).toBeNull();
        expect(d.weekly?.engineChecks).toBeNull();
        expect(d.weekly?.minimums).toEqual({
            leadsPerSource: 30,
            callsPerHour: 20,
            sendsPerRow: 100,
        });
    });

    it('keeps a count the server could not read as null, not 0', () => {
        const d = normalizeDiagnosis({
            weekly: {
                leadSources: [{ source: 'maps', leads: 40, contacted: null, responded: null }],
                emailSubjects: [{ name: 'Hello', sent: 120, replied: null }],
                promptChanges: [{ version: 2, sends: 80, replies: null, demosBooked: null }],
                engineChecks: { doubleContact: null, sentAfterReply: 3, stuckMembers: null },
            } as never,
        });
        expect(d.weekly?.leadSources[0]).toMatchObject({
            leads: 40,
            contacted: null,
            responded: null,
        });
        expect(d.weekly?.emailSubjects[0]?.replied).toBeNull();
        expect(d.weekly?.promptChanges[0]).toMatchObject({ replies: null, demosBooked: null });
        expect(d.weekly?.engineChecks).toEqual({
            doubleContact: null,
            sentAfterReply: 3,
            stuckMembers: null,
        });
    });

    it('treats `enough` as true only when it is true', () => {
        const d = normalizeDiagnosis({
            weekly: {
                leadSources: [
                    { source: 'a', enough: 'yes' },
                    { source: 'b', enough: true },
                ],
            } as never,
        });
        expect(d.weekly?.leadSources.map((s) => s.enough)).toEqual([false, true]);
    });
});
