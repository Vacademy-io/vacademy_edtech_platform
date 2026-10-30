import { readFileSync } from 'node:fs';
import path from 'node:path';
import i18next from 'i18next';
import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { rangeT } from '../report-range-t';

const file = path.resolve(
    __dirname,
    '../../../../../../public/locales/en/engagementDailyReport.json'
);
const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

/** Every [dotted key, text] pair in the file. */
const entries = (node: unknown, prefix = ''): Array<[string, string]> =>
    node && typeof node === 'object'
        ? Object.entries(node).flatMap(([k, v]) => entries(v, prefix ? `${prefix}.${k}` : k))
        : [[prefix, String(node)]];

describe('the wording of a range', () => {
    let day: TFunction;
    let range: TFunction;
    beforeAll(async () => {
        await i18next.init({
            lng: 'en',
            resources: { en: { report: json } },
            ns: ['report'],
            defaultNS: 'report',
        });
        day = i18next.t.bind(i18next) as unknown as TFunction;
        range = rangeT(day, true);
    });

    it('says "this day" for one day and "this period" for a range', () => {
        expect(day('emptyDay.title')).toBe('No activity on this day');
        expect(range('emptyDay.title')).toBe('No activity in this period');
        expect(range('emptyDay.previous')).toBe('Go to the previous period');
        expect(range('kpi.messagesSent.hint')).toMatch(/sent in this period/);
        expect(range('outcomesPage.empty.leads')).toBe('No leads were added in this period.');
        expect(range('trend.title')).toBe('Day by day');
        expect(day('trend.title')).toBe('Last 7 days');
    });

    it('is the same for both where the words never mention the day', () => {
        expect(range('kpi.creditsSpent.label')).toBe(day('kpi.creditsSpent.label'));
        expect(range('retry')).toBe('Try again');
    });

    it('keeps plurals, values and defaults working with the range wording', () => {
        expect(day('kpi.demosBooked.scheduled', { count: 1 })).toBe('1 scheduled for this day');
        expect(range('kpi.demosBooked.scheduled', { count: 3 })).toBe(
            '3 scheduled for this period'
        );
        expect(range('lists.subtitle', { list: 'List' })).toMatch(/for that List\.$/);
        expect(range('no.such.key', 'fallback text')).toBe('fallback text');
        expect(range('whatsappCategory.marketing', { defaultValue: 'x' })).toBe('Marketing');
        expect(
            range('trend.miniAria', { name: 'Replies', total: '40', numDays: 7, average: '6' })
        ).toBe('Replies: 40 over 7 days, 6 a day on average');
    });

    it('names what the change was against', () => {
        expect(day('kpi.delta.label', { count: 1 })).toBe('vs previous day');
        expect(day('kpi.delta.label', { count: 30 })).toBe('vs previous 30 days');
        expect(day('kpi.delta.title', { count: 7, range: '16–22 Oct' })).toBe(
            'Compared with the previous 7 days (16–22 Oct)'
        );
        // The same words under the range wording: they never mention the day.
        expect(range('kpi.delta.label', { count: 7 })).toBe('vs previous 7 days');
    });

    it('has a one-day wording behind every range wording, and never says "this day" in one', () => {
        const all = entries(json);
        const keys = new Set(all.map(([k]) => k));
        const ranges = all.filter(([k]) => /_range(_one|_other)?$/.test(k));
        expect(ranges.length).toBeGreaterThan(40);
        for (const [key, text] of ranges) {
            const base = key.replace(/_range(_one|_other)?$/, (_, plural = '') => plural);
            expect(keys.has(base), `${key} has no ${base}`).toBe(true);
            expect(text, key).not.toMatch(/this day|on the day/i);
        }
    });

    it('has no token counts and no AI-usage block in the cost section', () => {
        expect(JSON.stringify(json)).not.toMatch(/token/i);
        expect(json.costs).not.toHaveProperty('ai');
        expect(day('groups.cost.subtitle')).toBe('Credits and WhatsApp charges.');
    });
});
