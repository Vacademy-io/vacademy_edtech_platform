import { readFileSync } from 'node:fs';
import path from 'node:path';
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    DEMO_FILTERS,
    isOutcomeTab,
    itemsQueryFor,
    listFilter,
    listIdOf,
    normalizeOutcomeFilter,
} from '../outcomes-params';
import { INBOX_PATH, makeReportLinks, OUTCOMES_PATH } from '../report-links';

describe('report links', () => {
    it('always carries the day and leaves the engine out for all engines', () => {
        const links = makeReportLinks(null, '2026-10-30');
        expect(links.inbox({ filter: 'sent' })).toEqual({
            to: INBOX_PATH,
            search: { filter: 'sent', date: '2026-10-30' },
        });
        expect(links.outcomes('conversions')).toEqual({
            to: OUTCOMES_PATH,
            search: { tab: 'conversions', date: '2026-10-30' },
        });
    });

    it('adds the engine, channel, outcome and template when given', () => {
        const links = makeReportLinks('eng-1', '2026-10-30');
        expect(
            links.inbox({
                filter: 'sent',
                channel: 'EMAIL',
                outcome: 'complained',
                template: 'Welcome offer',
            })
        ).toEqual({
            to: INBOX_PATH,
            search: {
                filter: 'sent',
                channel: 'EMAIL',
                outcome: 'complained',
                template: 'Welcome offer',
                engine: 'eng-1',
                date: '2026-10-30',
            },
        });
        expect(links.inbox({ filter: 'waited' })?.search).toMatchObject({
            filter: 'waited',
            engine: 'eng-1',
        });
    });

    it('lets a row of the per-engine table name its own engine', () => {
        const links = makeReportLinks(null, '2026-10-30');
        expect(links.inbox({ filter: 'sent', engineId: 'eng-2' })?.search.engine).toBe('eng-2');
        expect(links.outcomes('leads', undefined, 'eng-2')?.search.engine).toBe('eng-2');
        // An explicit null is "all engines", even on a report for one engine.
        expect(
            makeReportLinks('eng-1', '2026-10-30').inbox({ filter: 'sent', engineId: null })?.search
                .engine
        ).toBeUndefined();
    });

    it('drops a channel the inbox does not filter by, and makes no link without a day', () => {
        const links = makeReportLinks(null, '2026-10-30');
        expect(links.inbox({ filter: 'sent', channel: 'SMS' })?.search.channel).toBeUndefined();
        expect(makeReportLinks(null, '').inbox({ filter: 'sent' })).toBeNull();
        expect(makeReportLinks(null, '').outcomes('leads')).toBeNull();
    });

    it('carries from and to, and no date, for a range', () => {
        const links = makeReportLinks(null, { from: '2026-10-23', to: '2026-10-29' });
        expect(links.inbox({ filter: 'sent' })).toEqual({
            to: INBOX_PATH,
            search: { filter: 'sent', from: '2026-10-23', to: '2026-10-29' },
        });
        expect(links.outcomes('demos', 'scheduled')).toEqual({
            to: OUTCOMES_PATH,
            search: { tab: 'demos', filter: 'scheduled', from: '2026-10-23', to: '2026-10-29' },
        });
        expect(links.inbox({ filter: 'sent' })?.search).not.toHaveProperty('date');
        // The engine, channel and outcome ride along as before.
        expect(
            makeReportLinks('eng-1', { from: '2026-10-23', to: '2026-10-29' }).inbox({
                filter: 'sent',
                channel: 'EMAIL',
                outcome: 'bounced',
            })?.search
        ).toEqual({
            filter: 'sent',
            channel: 'EMAIL',
            outcome: 'bounced',
            engine: 'eng-1',
            from: '2026-10-23',
            to: '2026-10-29',
        });
    });

    it('uses date for a period of one day, however it is given', () => {
        const asRange = makeReportLinks(null, { from: '2026-10-29', to: '2026-10-29' });
        const asDay = makeReportLinks(null, '2026-10-29');
        expect(asRange.inbox({ filter: 'failed' })).toEqual(asDay.inbox({ filter: 'failed' }));
        expect(asRange.outcomes('leads')?.search).toEqual({ tab: 'leads', date: '2026-10-29' });
    });

    it('makes no link for a period with no days', () => {
        const links = makeReportLinks(null, { from: '', to: '' });
        expect(links.inbox({ filter: 'sent' })).toBeNull();
        expect(links.outcomes('leads')).toBeNull();
        expect(makeReportLinks(null, { from: '2026-10-23', to: '' }).outcomes('leads')).toBeNull();
    });

    it('points a list row at the leads of that list', () => {
        const links = makeReportLinks(null, '2026-10-30');
        expect(links.outcomes('leads', listFilter('list-9'))?.search).toEqual({
            tab: 'leads',
            filter: 'list:list-9',
            date: '2026-10-30',
        });
    });
});

describe('leads & outcomes filters', () => {
    it('keeps only the filters a tab understands', () => {
        expect(normalizeOutcomeFilter('leads', 'new')).toBe('new');
        expect(normalizeOutcomeFilter('leads', 'list:abc')).toBe('list:abc');
        expect(normalizeOutcomeFilter('leads', 'list:')).toBeUndefined();
        expect(normalizeOutcomeFilter('leads', 'team')).toBeUndefined();
        expect(normalizeOutcomeFilter('status', 'automation')).toBe('automation');
        expect(normalizeOutcomeFilter('status', 'new')).toBeUndefined();
        expect(normalizeOutcomeFilter('conversions', 'new')).toBeUndefined();
        // "Booked" is what the demos tab shows with no filter.
        expect(normalizeOutcomeFilter('demos', 'booked')).toBeUndefined();
        for (const f of DEMO_FILTERS.filter((x) => x !== 'booked')) {
            expect(normalizeOutcomeFilter('demos', f)).toBe(f);
        }
    });

    it('maps a tab and its filter to what the items endpoint takes', () => {
        expect(itemsQueryFor('leads', 'list:abc')).toEqual({
            kind: 'LEADS_ADDED',
            filter: 'list:abc',
        });
        expect(itemsQueryFor('demos', undefined)).toEqual({ kind: 'DEMOS_BOOKED' });
        expect(itemsQueryFor('demos', 'scheduled')).toEqual({
            kind: 'DEMOS_SCHEDULED',
            filter: undefined,
        });
        expect(itemsQueryFor('demos', 'no_show')).toEqual({
            kind: 'DEMOS_SCHEDULED',
            filter: 'no_show',
        });
        expect(itemsQueryFor('status', 'team')).toEqual({ kind: 'STATUS_CHANGES', filter: 'team' });
        expect(itemsQueryFor('conversions', 'new')).toEqual({ kind: 'CONVERSIONS' });
    });

    it('keeps only the template filters, and asks for the templates list', () => {
        for (const f of ['marketing', 'in_review', 'approved_by_you', 'moved_to_marketing']) {
            expect(normalizeOutcomeFilter('templates', f)).toBe(f);
        }
        expect(normalizeOutcomeFilter('templates', 'new')).toBeUndefined();
        expect(normalizeOutcomeFilter('templates', 'list:abc')).toBeUndefined();
        expect(normalizeOutcomeFilter('leads', 'live')).toBeUndefined();
        expect(itemsQueryFor('templates', 'rejected')).toEqual({
            kind: 'TEMPLATES_CREATED',
            filter: 'rejected',
        });
        expect(itemsQueryFor('templates', 'bogus')).toEqual({
            kind: 'TEMPLATES_CREATED',
            filter: undefined,
        });
        expect(isOutcomeTab('templates')).toBe(true);
        expect(isOutcomeTab('template')).toBe(false);
    });

    it('reads a list id back out of its filter', () => {
        expect(listIdOf('list:BATCH')).toBe('BATCH');
        expect(listIdOf('new')).toBeNull();
        expect(listIdOf(undefined)).toBeNull();
    });
});

describe('calls placed wording', () => {
    beforeAll(async () => {
        const file = path.resolve(
            __dirname,
            '../../../../../../public/locales/en/engagementDailyReport.json'
        );
        await i18next.init({
            lng: 'en',
            resources: { en: { report: JSON.parse(readFileSync(file, 'utf8')) } },
            ns: ['report'],
            defaultNS: 'report',
        });
    });

    it('says "1 call placed" and "5 calls placed"', () => {
        const key = 'kpi.callsConnected.detail';
        expect(i18next.t(key, { count: 1, placed: '1' })).toBe('1 call placed');
        expect(i18next.t(key, { count: 5, placed: '5' })).toBe('5 calls placed');
        expect(i18next.t(key, { count: 1200, placed: '1,200' })).toBe('1,200 calls placed');
    });
});
