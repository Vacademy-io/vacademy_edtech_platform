import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import {
    normalizeDailyReport,
    type EngagementDailyReport,
} from '@/services/engagement-daily-report';
import { buildFunnelSteps } from '../report-funnel';
import { buildKpis } from '../report-kpis';
import { makeReportLinks } from '../report-links';
import { partFailed } from '../report-errors';
import { buildExportTables, buildReportModel, type ReportCtx } from '../report-tables';
import type { ReportTerms } from '../report-terms';

// Keys stand in for the words: only where each figure leads is under test.
const t = ((key: string) => key) as unknown as TFunction;
const terms = {
    list: 'List',
    lists: 'Lists',
    batch: 'Batch',
    learner: 'Learner',
    learners: 'Learners',
} as unknown as ReportTerms;

const DAY = '2026-10-30';

const report = (patch: Partial<EngagementDailyReport> = {}): EngagementDailyReport =>
    normalizeDailyReport({
        date: DAY,
        timezone: 'Asia/Dubai',
        engineId: null,
        summary: {
            leadsAdded: 12,
            newLeads: 5,
            existingLeads: 7,
            emailsSent: 30,
            whatsappSent: 10,
            inAppSent: 0,
            callsPlaced: 1,
            callsConnected: 0,
            replies: 4,
            demosBooked: 2,
            demosScheduled: 3,
            conversions: 0,
            statusChanges: 0,
            creditsSpent: 8,
        } as EngagementDailyReport['summary'],
        funnel: [
            { stage: 'CONTACTED', count: 40 },
            { stage: 'DELIVERED', count: 30 },
            { stage: 'REPLIED', count: 4 },
            { stage: 'DEMO_BOOKED', count: 2 },
            { stage: 'CONVERTED', count: 0 },
        ],
        email: {
            sent: 30,
            delivered: 28,
            opened: 0,
            clicked: 0,
            bounced: 2,
            complained: 0,
            bounceRate: 0.06,
            tracked: true,
            repliesTracked: false,
        },
        calls: {
            placed: 1,
            notDialled: 0,
            connected: 0,
            noAnswer: 1,
            busy: 0,
            failed: 0,
            inProgress: 0,
            totalMinutes: 0,
            avgDurationSec: 0,
            credits: 0,
        },
        channels: [
            {
                channel: 'EMAIL',
                sent: 30,
                delivered: 28,
                read: 5,
                replied: 0,
                failed: 1,
                replyRate: 0,
                credits: 3,
            },
            {
                channel: 'IN_APP',
                sent: 2,
                delivered: 2,
                read: 0,
                replied: 0,
                failed: 0,
                replyRate: null,
                credits: 0,
            },
            {
                channel: 'AI_CALL',
                sent: 1,
                delivered: 1,
                read: 0,
                replied: 0,
                failed: 0,
                replyRate: null,
                credits: 1,
            },
        ],
        templates: [
            {
                channel: 'WHATSAPP',
                name: 'welcome_v2',
                sent: 10,
                delivered: 9,
                read: 6,
                replied: 2,
                replyRate: 0.2,
                bounced: 0,
                cost: 1,
                currency: 'INR',
            },
            {
                channel: 'EMAIL',
                name: 'Your seat is held',
                sent: 5,
                delivered: 5,
                read: 2,
                replied: 0,
                replyRate: 0,
                bounced: 1,
                cost: null,
                currency: null,
            },
            {
                channel: 'EMAIL',
                name: '(no subject)',
                sent: 3,
                delivered: 3,
                read: 0,
                replied: 0,
                replyRate: 0,
                bounced: 0,
                cost: null,
                currency: null,
            },
            {
                channel: 'EMAIL',
                name: '(other)',
                sent: 9,
                delivered: 9,
                read: 0,
                replied: 0,
                replyRate: 0,
                bounced: 0,
                cost: null,
                currency: null,
            },
        ],
        lists: [
            {
                listId: 'list-1',
                name: 'Open day',
                kind: 'LIST',
                leadsAdded: 9,
                newLeads: 4,
                existingLeads: 5,
                leadAgent: null,
            },
            {
                listId: 'BATCH',
                name: 'Batch',
                kind: 'BATCH',
                leadsAdded: 3,
                newLeads: 1,
                existingLeads: 2,
                leadAgent: null,
            },
            {
                listId: 'list-2',
                name: 'Empty',
                kind: 'LIST',
                leadsAdded: 0,
                newLeads: 0,
                existingLeads: 0,
                leadAgent: null,
            },
        ],
        runs: {
            decisions: 12,
            membersEvaluated: 12,
            byKind: { SEND: 8, NO_OP: 3, TASK: 1 },
            failed: 2,
            expired: 0,
            topErrors: [],
        },
        outcomes: {
            demosBooked: 2,
            demosScheduled: 3,
            demosDone: 1,
            demosNoShow: 0,
            demosNotMarked: 2,
            conversions: 0,
            statusChanges: [
                { from: 'New', to: 'Qualified', byEngine: 4, byTeam: 0, byAutomation: 1 },
            ],
        },
        ...patch,
    });

const ctxFor = (data: EngagementDailyReport): ReportCtx => ({
    t,
    channelLabel: (c) => c,
    terms,
    links: makeReportLinks(data.engineId, data.date),
});

type Cell<R> = { id: string; link?: (row: R) => unknown };
const linkOf = <R>(columns: Cell<R>[], id: string, row: R | undefined) =>
    row === undefined ? null : columns.find((c) => c.id === id)?.link?.(row) ?? null;

describe('where the report numbers lead', () => {
    const data = report();
    const ctx = ctxFor(data);
    const model = buildReportModel(data, ctx);

    it('opens a channel figure in the inbox, with the channel and what happened', () => {
        const [email, inApp, call] = model.channels.rows;
        const cols = model.channels.columns;
        expect(linkOf(cols, 'sent', email)).toMatchObject({
            search: { filter: 'sent', channel: 'EMAIL', date: DAY },
        });
        expect(linkOf(cols, 'delivered', email)).toMatchObject({
            search: { outcome: 'delivered', channel: 'EMAIL' },
        });
        // Read is "opened" for email, and "connected" is what delivered means for a call.
        expect(linkOf(cols, 'read', email)).toMatchObject({ search: { outcome: 'opened' } });
        expect(linkOf(cols, 'delivered', call)).toMatchObject({
            search: { outcome: 'connected', channel: 'AI_CALL' },
        });
        expect(linkOf(cols, 'failed', email)).toMatchObject({
            search: { filter: 'failed', channel: 'EMAIL' },
        });
        // In-app messages have no receipts; email replies are not tracked; zero is no link.
        expect(linkOf(cols, 'delivered', inApp)).toBeNull();
        expect(linkOf(cols, 'replied', email)).toBeNull();
        expect(linkOf(cols, 'failed', inApp)).toBeNull();
    });

    it('links a template row by its name, but not the stand-ins for "no name"', () => {
        const [whatsapp, email, noSubject, other] = model.templates.rows;
        const cols = model.templates.columns;
        expect(linkOf(cols, 'name', whatsapp)).toMatchObject({
            search: { filter: 'sent', channel: 'WHATSAPP', template: 'welcome_v2' },
        });
        expect(linkOf(cols, 'read', whatsapp)).toMatchObject({ search: { outcome: 'read' } });
        expect(linkOf(cols, 'read', email)).toMatchObject({
            search: { outcome: 'opened', template: 'Your seat is held' },
        });
        expect(linkOf(cols, 'bounced', email)).toMatchObject({ search: { outcome: 'bounced' } });
        expect(linkOf(cols, 'sent', noSubject)).toBeNull();
        expect(linkOf(cols, 'sent', other)).toBeNull();
    });

    it('links the lists that added leads to their own people', () => {
        const [list, batch, empty] = model.lists.rows;
        const cols = model.lists.columns;
        expect(linkOf(cols, 'leadsAdded', list)).toMatchObject({
            to: '/engagement-engines/dashboard/outcomes',
            search: { tab: 'leads', filter: 'list:list-1', date: DAY },
        });
        expect(linkOf(cols, 'name', batch)).toMatchObject({ search: { filter: 'list:BATCH' } });
        expect(linkOf(cols, 'leadsAdded', empty)).toBeNull();
        expect(linkOf(cols, 'name', empty)).toBeNull();
    });

    it('opens the email and call figures, and leaves out the zeros', () => {
        const email = Object.fromEntries((model.email?.stats ?? []).map((s) => [s.key, s.link]));
        expect(email.sent).toMatchObject({ search: { channel: 'EMAIL', filter: 'sent' } });
        expect(email.bounced).toMatchObject({ search: { outcome: 'bounced' } });
        expect(email.opened).toBeNull();
        expect(email.complained).toBeNull();
        const calls = Object.fromEntries((model.calls?.stats ?? []).map((s) => [s.key, s.link]));
        expect(calls.noAnswer).toMatchObject({
            search: { channel: 'AI_CALL', outcome: 'no_answer' },
        });
        expect(calls.connected).toBeNull();
    });

    it('opens runs, demos and status changes', () => {
        const runs = Object.fromEntries((model.runsStats?.stats ?? []).map((s) => [s.key, s.link]));
        expect(runs.failed).toMatchObject({ search: { filter: 'failed' } });
        const kinds = model.runsByKind?.rows ?? [];
        const kindCols = model.runsByKind?.columns ?? [];
        const noOp = kinds.find((r) => r.kind === 'NO_OP');
        const send = kinds.find((r) => r.kind === 'SEND');
        expect(noOp && linkOf(kindCols, 'count', noOp)).toMatchObject({
            search: { filter: 'waited' },
        });
        expect(send && linkOf(kindCols, 'count', send)).toBeNull();

        const demos = Object.fromEntries((model.outcomes?.stats ?? []).map((s) => [s.key, s.link]));
        expect(demos.demosBooked).toMatchObject({ search: { tab: 'demos' } });
        expect(
            demos.demosBooked && (demos.demosBooked as { search: object }).search
        ).not.toHaveProperty('filter');
        expect(demos.demosScheduled).toMatchObject({
            search: { tab: 'demos', filter: 'scheduled' },
        });
        expect(demos.demosNotMarked).toMatchObject({ search: { filter: 'not_marked' } });
        expect(demos.conversions).toBeNull();

        const status = model.statusChanges;
        const row = status?.rows[0];
        const cols = status?.columns ?? [];
        expect(row && linkOf(cols, 'byEngine', row)).toMatchObject({
            search: { tab: 'status', filter: 'engine' },
        });
        expect(row && linkOf(cols, 'byAutomation', row)).toMatchObject({
            search: { filter: 'automation' },
        });
        expect(row && linkOf(cols, 'byTeam', row)).toBeNull();
        expect(row && linkOf(cols, 'total', row)).toMatchObject({ search: { tab: 'status' } });
    });

    it('opens each KPI card and funnel step that has something behind it', () => {
        const kpis = buildKpis(data, t, ctx.channelLabel, ctx.links);
        const byKey = Object.fromEntries(kpis.map((k) => [k.key, k.link]));
        expect(byKey.peopleAdded).toMatchObject({ search: { tab: 'leads' } });
        expect(byKey.messagesSent).toMatchObject({ search: { filter: 'sent' } });
        expect(byKey.replies).toMatchObject({ search: { filter: 'sent', outcome: 'replied' } });
        expect(byKey.demosBooked).toMatchObject({ search: { tab: 'demos' } });
        // Nothing behind these: no calls connected, no conversions, credits are not a list.
        expect(byKey.callsConnected).toBeNull();
        expect(byKey.conversions).toBeNull();
        expect(byKey.creditsSpent).toBeUndefined();

        const steps = buildFunnelSteps(data, t, ctx.links);
        expect(steps.map((s) => s.link?.to ?? null)).toEqual([
            '/engagement-engines/inbox',
            '/engagement-engines/inbox',
            '/engagement-engines/inbox',
            '/engagement-engines/dashboard/outcomes',
            null,
        ]);
        expect(steps[1]?.link?.search.outcome).toBe('delivered');
    });

    it('names the engine in every link when the report is for one engine', () => {
        const one = report({ engineId: 'eng-7' });
        const kpis = buildKpis(one, t, (c) => c, makeReportLinks(one.engineId, one.date));
        expect(kpis.find((k) => k.key === 'messagesSent')?.link?.search.engine).toBe('eng-7');
    });
});

describe('new WhatsApp templates', () => {
    const newTemplates = {
        created: 3,
        byCategory: [
            { category: 'MARKETING', count: 2 },
            { category: 'UTILITY', count: 1 },
        ],
        inReview: 1,
        approvedByYou: 0,
        withMeta: 0,
        live: 1,
        rejected: 0,
        withdrawn: 1,
        movedToMarketing: 1,
    };
    const build = (patch: Partial<EngagementDailyReport> = {}) => {
        const data = report({ newTemplates, ...patch });
        return { data, model: buildReportModel(data, ctxFor(data)) };
    };
    const byKey = <S extends { key: string }>(stats: S[] | undefined): Record<string, S> =>
        Object.fromEntries((stats ?? []).map((s) => [s.key, s]));

    it('counts the total and the categories, and links only the figures above zero', () => {
        const { model } = build();
        const cats = byKey(model.newTemplates?.categories);
        expect(cats.created?.text).toBe('3');
        expect(cats.marketing?.text).toBe('2');
        expect(cats.authentication?.text).toBe('0');
        expect(cats.created?.link).toMatchObject({
            to: '/engagement-engines/dashboard/outcomes',
            search: { tab: 'templates', date: DAY },
        });
        expect(cats.marketing?.link).toMatchObject({
            search: { tab: 'templates', filter: 'marketing', date: DAY },
        });
        expect(cats.authentication?.link).toBeNull();
    });

    it('links each status to its own filter and names the engine when one is picked', () => {
        const { model } = build({ engineId: 'eng-7' });
        const statuses = byKey(model.newTemplates?.statuses);
        expect(statuses.in_review?.link).toMatchObject({
            search: { tab: 'templates', filter: 'in_review', engine: 'eng-7', date: DAY },
        });
        expect(statuses.live?.link).toMatchObject({ search: { filter: 'live' } });
        expect(statuses.withdrawn?.link).toMatchObject({ search: { filter: 'withdrawn' } });
        expect(statuses.approved_by_you?.link).toBeNull();
        expect(statuses.rejected?.link).toBeNull();
    });

    it('warns about utility templates Meta made marketing, with a link to them', () => {
        const { model } = build();
        expect(model.newTemplates?.moved?.count).toBe(1);
        expect(model.newTemplates?.moved?.link).toMatchObject({
            search: { tab: 'templates', filter: 'moved_to_marketing' },
        });
        expect(
            build({ newTemplates: { ...newTemplates, movedToMarketing: 0 } }).model.newTemplates
                ?.moved
        ).toBeNull();
    });

    it('is absent on an older server, and a failed section is not an empty one', () => {
        const old = build({ newTemplates: undefined });
        expect(old.model.newTemplates).toBeNull();
        expect(old.data.newTemplates).toBeNull();
        expect(partFailed({ newTemplates: 'boom' }, 'newTemplates')).toBe(true);
        expect(partFailed({ email: 'boom' }, 'newTemplates')).toBe(false);
    });

    it('treats missing figures as zero', () => {
        const partial = build({
            newTemplates: { created: 2 } as EngagementDailyReport['newTemplates'],
        });
        expect(partial.data.newTemplates?.live).toBe(0);
        expect(partial.data.newTemplates?.byCategory).toEqual([]);
        expect(partial.model.newTemplates?.moved).toBeNull();
    });

    it('is in the exports, labelled so each row reads on its own, unless it failed', () => {
        const { data, model } = build();
        const table = buildExportTables(model, data, t).find((x) => x.key === 'newTemplates');
        expect(table?.sheetName).toBe('sheet.newTemplates');
        expect(table?.body.map((r) => r[1])).toEqual([3, 2, 1, 0, 1, 0, 0, 1, 0, 1, 1]);
        expect(table?.body[1]?.[0]).toBe('newTemplates.export.category');
        const failed = { ...data, errors: { newTemplates: 'boom' } };
        expect(buildExportTables(model, failed, t).some((x) => x.key === 'newTemplates')).toBe(
            false
        );
    });
});
