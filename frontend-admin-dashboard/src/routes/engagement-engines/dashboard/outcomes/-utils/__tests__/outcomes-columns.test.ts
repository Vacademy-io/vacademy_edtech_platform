import { readFileSync } from 'node:fs';
import path from 'node:path';
import i18next, { type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ReportItemRow } from '@/services/engagement-daily-report';
import type { ReportTerms } from '../../../-utils/report-terms';
import { buildOutcomeColumns, leadLabel, type OutcomeColumnsCtx } from '../outcomes-columns';
import { outcomesFileName } from '../outcomes-export';

const terms = {
    list: 'Audience',
    lists: 'Audiences',
    batch: 'Cohort',
} as unknown as ReportTerms;

let t: TFunction;
const ctx = (patch: Partial<OutcomeColumnsCtx> = {}): OutcomeColumnsCtx => ({
    t,
    terms,
    timeZone: 'Asia/Dubai',
    showEngine: true,
    openLead: () => undefined,
    ...patch,
});

/** The text and the Excel value of every column, keyed by column id. */
const cells = (tab: Parameters<typeof buildOutcomeColumns>[0], row: ReportItemRow, c = ctx()) =>
    Object.fromEntries(
        buildOutcomeColumns(tab, c).map((col) => [
            col.id,
            { text: col.text(row), value: col.value ? col.value(row) : col.text(row) },
        ])
    );

describe('Leads & outcomes columns', () => {
    beforeAll(async () => {
        const file = path.resolve(
            __dirname,
            '../../../../../../../public/locales/en/engagementDailyReport.json'
        );
        await i18next.init({
            lng: 'en',
            resources: { en: { report: JSON.parse(readFileSync(file, 'utf8')) } },
            ns: ['report'],
            defaultNS: 'report',
        });
        t = i18next.t.bind(i18next) as unknown as TFunction;
        i18next.setDefaultNamespace('report');
    });

    it('lists the people who joined, in the institute time zone', () => {
        const row: ReportItemRow = {
            leadName: 'Asha Rao',
            email: 'asha@example.com',
            phone: null,
            userId: 'u1',
            engineName: 'Spring push',
            listId: 'BATCH',
            isNew: false,
            joinedAt: '2026-10-30T22:30:00Z',
        };
        const c = cells('leads', row);
        expect(Object.keys(c)).toEqual([
            'lead',
            'email',
            'phone',
            'list',
            'type',
            'added',
            'engine',
        ]);
        expect(c.lead?.text).toBe('Asha Rao');
        expect(c.phone?.text).toBe('—');
        // Batch members are named with the institute's own word for a batch.
        expect(c.list?.text).toBe('Cohort members');
        expect(c.type?.text).toBe('Already in the CRM');
        // 22:30 UTC is 02:30 the next day in Dubai; Excel gets a sortable stamp.
        expect(c.added?.value).toBe('2026-10-31 02:30');
        expect(c.added?.text).toContain('31 Oct 2026');
    });

    it('leaves out the engine column for one engine, and always exports it', () => {
        const ids = (c: OutcomeColumnsCtx) => buildOutcomeColumns('status', c).map((x) => x.id);
        expect(ids(ctx({ showEngine: false }))).not.toContain('engine');
        expect(ids(ctx({ showEngine: false, forExport: true }))).toEqual(
            expect.arrayContaining(['engine', 'email', 'phone'])
        );
    });

    it('describes demos, including the ones nobody marked', () => {
        const c = cells('demos', {
            leadName: '  ',
            email: 'x@example.com',
            audienceResponseId: 'r1',
            scheduledStart: '2026-10-30T09:00:00Z',
            bookingStatus: 'CONFIRMED',
            outcome: null,
            hostName: 'Ravi',
        });
        expect(c.lead?.text).toBe('x@example.com');
        expect(c.bookingStatus?.text).toBe('Confirmed');
        expect(c.demoOutcome?.text).toBe('Not marked');
        expect(c.host?.text).toBe('Ravi');
        expect(cells('demos', { outcome: 'NO_SHOW' }).demoOutcome?.text).toBe('No-show');
    });

    it('says who changed a status', () => {
        const base: ReportItemRow = { fromStatus: null, toStatus: 'Qualified', source: 'MANUAL' };
        const team = cells('status', { ...base, actor: 'TEAM', changedByName: 'Meera' });
        expect(team.changedBy?.text).toBe('Your team (Meera)');
        expect(team.from?.text).toBe('No status');
        expect(team.source?.text).toBe('Manual');
        expect(cells('conversions', { ...base, actor: 'ENGINE' }).changedBy?.text).toBe('Engine');
        expect(cells('status', { ...base, actor: 'AUTOMATION' }).changedBy?.text).toBe(
            'Automation'
        );
    });

    it('describes new templates: category change, friendly status, rejection reason', () => {
        const row: ReportItemRow = {
            templateName: 'welcome_v2',
            language: 'en',
            engineName: 'Spring push',
            proposedCategory: 'UTILITY',
            metaCategory: 'MARKETING',
            templateStatus: 'META_RECATEGORISED',
            createdAt: '2026-10-30T22:30:00Z',
            submittedAt: null,
        };
        const c = cells('templates', row);
        expect(Object.keys(c)).toEqual([
            'templateName',
            'engine',
            'proposedCategory',
            'metaCategory',
            'status',
            'createdAt',
            'submittedAt',
        ]);
        expect(c.templateName?.text).toBe('welcome_v2');
        expect(c.proposedCategory?.text).toBe('Utility');
        // Meta's different choice is in the words, so Excel and screen readers get it too.
        expect(c.metaCategory?.text).toBe('Marketing (changed by Meta)');
        expect(c.metaCategory?.value).toBe('Marketing (changed by Meta)');
        expect(c.status?.text).toBe('Live');
        expect(c.createdAt?.value).toBe('2026-10-31 02:30');
        expect(c.submittedAt?.text).toBe('—');

        const same = cells('templates', { ...row, metaCategory: 'UTILITY' });
        expect(same.metaCategory?.text).toBe('Utility');
        // Meta has not decided yet.
        expect(cells('templates', { ...row, metaCategory: null }).metaCategory?.text).toBe('—');
    });

    it('shows why a template was turned down, but exports the status on its own', () => {
        const row: ReportItemRow = {
            templateName: 'offer',
            templateStatus: 'META_REJECTED',
            rejectionReason: 'Variables are not allowed at the start',
        };
        const c = cells('templates', row);
        expect(c.status?.text).toBe('Rejected: Variables are not allowed at the start');
        expect(c.status?.value).toBe('Rejected');
        const exported = cells('templates', row, ctx({ showEngine: false, forExport: true }));
        expect(Object.keys(exported)).toEqual(
            expect.arrayContaining(['engine', 'language', 'statusDetail', 'rejectionReason'])
        );
        expect(exported.statusDetail?.text).toBe('Meta Rejected');
        expect(exported.rejectionReason?.text).toBe('Variables are not allowed at the start');
        // One engine: no engine column on screen.
        expect(
            buildOutcomeColumns('templates', ctx({ showEngine: false })).map((x) => x.id)
        ).not.toContain('engine');
    });

    it('folds every raw template status into the six buckets the report counts', () => {
        const label = (templateStatus: string) =>
            cells('templates', { templateStatus }).status?.text;
        expect(['AI_PROPOSED', 'USER_REVIEW'].map(label)).toEqual(['In review', 'In review']);
        expect(label('USER_APPROVED')).toBe('Approved by you');
        expect(['SUBMITTED', 'META_PENDING'].map(label)).toEqual(['With Meta', 'With Meta']);
        expect(['META_APPROVED', 'META_RECATEGORISED'].map(label)).toEqual(['Live', 'Live']);
        expect(['META_REJECTED', 'META_DISABLED'].map(label)).toEqual(['Rejected', 'Rejected']);
        expect(['WITHDRAWN', 'SUPERSEDED'].map(label)).toEqual(['Withdrawn', 'Withdrawn']);
        // A status from a newer server still reads as words.
        expect(label('NEW_STATE')).toBe('New State');
    });

    it('names a lead by whatever identifies them', () => {
        expect(leadLabel({}, t)).toBe('Unknown lead');
        expect(leadLabel({ phone: '+971500000000' }, t)).toBe('+971500000000');
    });

    it('names the Excel file after the tab, the engine and the day', () => {
        const base = { tab: 'demos', period: { from: '2026-10-30', to: '2026-10-30' } };
        expect(outcomesFileName({ ...base, engineName: 'Spring Push!', engineId: 'e1' })).toBe(
            'engagement-demos-spring-push-2026-10-30.xlsx'
        );
        expect(outcomesFileName({ ...base, engineName: 'वसंत', engineId: 'abcdef12-0000' })).toBe(
            'engagement-demos-abcdef12-2026-10-30.xlsx'
        );
        expect(outcomesFileName({ ...base, engineName: 'All engines', engineId: null })).toBe(
            'engagement-demos-all-engines-2026-10-30.xlsx'
        );
    });

    it('names the Excel file after the whole period for a range', () => {
        const range = { from: '2026-10-12', to: '2026-10-29' };
        expect(
            outcomesFileName({
                tab: 'leads',
                period: range,
                engineName: 'Spring Push!',
                engineId: 'e1',
            })
        ).toBe('engagement-leads-spring-push-2026-10-12_to_2026-10-29.xlsx');
    });
});
