import { describe, expect, it } from 'vitest';
import {
    bestCallWindow,
    buildCrmWindow,
    buildInsights,
    callsMatrix,
    formatMinutes,
    humanizeKey,
    pctChange,
    pipelineStages,
} from './crm-dashboard';
import { CRM_DASHBOARD_WIDGET_IDS } from './crm-widgets';

describe('buildCrmWindow', () => {
    it('starts at local midnight N-1 days back and ends now, rounded to the minute', () => {
        const at = new Date(2026, 9, 16, 14, 37, 42);
        const w = buildCrmWindow(7, at);
        const from = new Date(w.from);
        expect(from.getDate()).toBe(10);
        expect(from.getHours()).toBe(0);
        expect(new Date(w.now).getSeconds()).toBe(0);
        expect(w.fromDay).toBe('2026-10-10');
        expect(w.toDay).toBe('2026-10-16');
        const end = new Date(w.todayEnd);
        expect(end.getHours()).toBe(23);
        expect(end.getMinutes()).toBe(59);
    });
});

describe('pctChange', () => {
    it('compares with the previous period', () => {
        expect(pctChange(120, 100)).toBe(20);
        expect(pctChange(80, 100)).toBe(-20);
    });
    it('has no change to show without a previous period or from zero', () => {
        expect(pctChange(5, undefined)).toBeNull();
        expect(pctChange(5, 0)).toBeNull();
        expect(pctChange(0, 0)).toBe(0);
    });
});

describe('formatting', () => {
    it('formats minutes', () => {
        expect(formatMinutes(38)).toBe('38m');
        expect(formatMinutes(135)).toBe('2h 15m');
        expect(formatMinutes(2900)).toBe('2d 0h');
        expect(formatMinutes(null)).toBe('—');
    });
    it('humanizes keys', () => {
        expect(humanizeKey('GOOGLE_ADS')).toBe('Google Ads');
        expect(humanizeKey(null)).toBe('—');
    });
});

describe('pipelineStages', () => {
    it('keeps the institute status order and names, with unknown and no-status last', () => {
        const stages = pipelineStages(
            {
                statuses: [
                    { status_key: 'NEW', label: 'New', color: null, display_order: 1 },
                    {
                        status_key: 'INTERESTED',
                        label: 'Interested',
                        color: null,
                        display_order: 2,
                    },
                ],
                counts: [
                    { status_key: 'INTERESTED', n: 4 },
                    { status_key: 'OLD_KEY', n: 2 },
                    { status_key: '__NO_STATUS__', n: 3 },
                ],
            },
            'No status'
        );
        expect(stages.map((s) => [s.label, s.count])).toEqual([
            ['New', 0],
            ['Interested', 4],
            ['Old Key', 2],
            ['No status', 3],
        ]);
    });
});

describe('calls heatmap', () => {
    it('maps ISO weekday + hour into a 7×24 grid and finds the busiest 3 hours', () => {
        const m = callsMatrix({
            heatmap: [
                { dow: 1, hour: 10, n: 5 },
                { dow: 1, hour: 11, n: 6 },
                { dow: 7, hour: 12, n: 4 },
            ],
        });
        expect(m[0]![10]).toBe(5);
        expect(m[6]![12]).toBe(4);
        expect(bestCallWindow(m)).toEqual({ from: 10, to: 13 });
        expect(bestCallWindow(callsMatrix({ heatmap: [] }))).toBeNull();
    });
});

describe('buildInsights', () => {
    it('puts the most overdue counsellor first and caps at four', () => {
        const out = buildInsights({
            summary: {
                new_leads: 100,
                converted: 10,
                contacted: 80,
                median_first_response_minutes: 30,
                daily: [],
            },
            followups: { overdue: 5, today: 3, upcoming: 9 },
            sources: [{ source: 'GOOGLE_ADS', leads: 50, converted: 8 }],
            counsellors: [
                {
                    owner_id: 'a',
                    name: 'A',
                    assigned: 40,
                    contacted: 30,
                    converted: 6,
                    overdue: 1,
                    median_minutes: 20,
                },
                {
                    owner_id: 'b',
                    name: 'B',
                    assigned: 30,
                    contacted: 20,
                    converted: 2,
                    overdue: 4,
                    median_minutes: 50,
                },
            ],
        });
        expect(out[0]!.id).toBe('overdueCounsellor');
        expect(out[0]!.values.name).toBe('B');
        expect(out.length).toBeLessThanOrEqual(4);
    });
});

describe('CRM Dashboard cards', () => {
    it('lists every card once', () => {
        expect(new Set(CRM_DASHBOARD_WIDGET_IDS).size).toBe(CRM_DASHBOARD_WIDGET_IDS.length);
        expect(CRM_DASHBOARD_WIDGET_IDS[0]).toBe('quickActions');
    });
});
