import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { RecentLeadDetail } from '@/routes/audience-manager/list/-services/get-recent-leads';
import { daysOverdue, responseMinutes, slaStage, tatStatus } from '../per-lead-exports';

// Keys come back as-is, so the assertions read the rule, not a translation.
const t = ((key: string) => key) as unknown as TFunction;
const lead = (fields: Partial<RecentLeadDetail>) => fields as RecentLeadDetail;

describe('tatStatus — the same rule the TAT-met KPI counts', () => {
    it('met when the first response came on or before the TAT deadline', () => {
        expect(
            tatStatus(
                t,
                lead({
                    first_response_at: '2026-10-10T10:00:00Z',
                    tat_due_at: '2026-10-10T10:00:00Z',
                })
            )
        ).toBe('values.met');
    });

    it('breached when the first response came after it', () => {
        expect(
            tatStatus(
                t,
                lead({
                    first_response_at: '2026-10-10T10:01:00Z',
                    tat_due_at: '2026-10-10T10:00:00Z',
                })
            )
        ).toBe('values.breached');
    });

    it('no response yet: judged on the TAT deadline itself, not the current SLA stage', () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        const future = new Date(Date.now() + 60_000).toISOString();
        // tat_overdue is false once the lead moves to a follow-up stage — must not read as pending.
        expect(tatStatus(t, lead({ tat_due_at: past, tat_overdue: false }))).toBe(
            'values.breachedNoResponse'
        );
        expect(tatStatus(t, lead({ tat_due_at: future }))).toBe('values.pending');
        expect(tatStatus(t, lead({}))).toBe('values.pending');
        expect(tatStatus(t, lead({ sla_closed: true, tat_due_at: past }))).toBe('values.closed');
    });

    it('a repeat lead whose earlier activity predates this enquiry is not counted as met', () => {
        expect(
            tatStatus(
                t,
                lead({
                    submitted_at_local: '2026-10-10T10:00:00Z',
                    first_response_at: '2026-09-01T10:00:00Z',
                    tat_due_at: '2026-10-10T10:10:00Z',
                })
            )
        ).toBe('values.priorActivity');
        expect(
            responseMinutes(
                lead({
                    submitted_at_local: '2026-10-10T10:00:00Z',
                    first_response_at: '2026-09-01T10:00:00Z',
                })
            )
        ).toBe('');
    });

    it('responded with no TAT configured is just "responded"', () => {
        expect(tatStatus(t, lead({ first_response_at: '2026-10-10T10:00:00Z' }))).toBe(
            'values.responded'
        );
    });
});

describe('responseMinutes / daysOverdue', () => {
    it('minutes from enquiry to first response, blank when either is missing', () => {
        expect(
            responseMinutes(
                lead({
                    submitted_at_local: '2026-10-10T10:00:00Z',
                    first_response_at: '2026-10-10T10:45:30Z',
                })
            )
        ).toBe(46);
        expect(responseMinutes(lead({ submitted_at_local: '2026-10-10T10:00:00Z' }))).toBe('');
    });

    it('whole days past due, 0 when not yet due, blank with no due date', () => {
        const threeDaysAgo = new Date(Date.now() - 3.5 * 86_400_000).toISOString();
        expect(daysOverdue(threeDaysAgo)).toBe(3);
        expect(daysOverdue(new Date(Date.now() + 86_400_000).toISOString())).toBe(0);
        expect(daysOverdue(null)).toBe('');
    });
});

describe('slaStage', () => {
    it('reads the stage as words, on track when none, off the clock when closed', () => {
        expect(slaStage(t, lead({ tat_reminder_stage: 'FOLLOW_UP_OVERDUE' }))).toBe(
            'stages.followUpOverdue'
        );
        expect(slaStage(t, lead({ tat_reminder_stage: 'TAT_BEFORE' }))).toBe('stages.tatDueSoon');
        expect(slaStage(t, lead({}))).toBe('stages.onTrack');
        expect(slaStage(t, lead({ sla_closed: true, tat_reminder_stage: 'TAT_OVERDUE' }))).toBe(
            'stages.offClock'
        );
    });
});
