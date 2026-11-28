import { describe, expect, it } from 'vitest';
import { sparseTicks, summarizeTrend } from '../report-trend';

const labels = (n: number) => Array.from({ length: n }, (_, i) => `d${i + 1}`);

describe('x-axis labels of the small charts', () => {
    it('names the first and last day of a week or less', () => {
        expect(sparseTicks(labels(7))).toEqual(['d1', 'd7']);
        expect(sparseTicks(labels(3))).toEqual(['d1', 'd3']);
        expect(sparseTicks(labels(2))).toEqual(['d1', 'd2']);
    });

    it('lets the chart decide for a single bar', () => {
        expect(sparseTicks(labels(1))).toBeUndefined();
        expect(sparseTicks([])).toBeUndefined();
    });

    it('names three days up to a month and four beyond, always including both ends', () => {
        expect(sparseTicks(labels(14))).toEqual(['d1', 'd8', 'd14']);
        expect(sparseTicks(labels(31))).toEqual(['d1', 'd16', 'd31']);
        const quarter = sparseTicks(labels(90));
        expect(quarter).toEqual(['d1', 'd31', 'd60', 'd90']);
        expect(quarter?.[0]).toBe('d1');
        expect(quarter?.[quarter.length - 1]).toBe('d90');
    });

    it('never repeats a label', () => {
        const ticks = sparseTicks(labels(8)) ?? [];
        expect(new Set(ticks).size).toBe(ticks.length);
    });
});

describe('numbers above the small charts', () => {
    const week = [1, 2, 3, 4, 5, 6, 7].map((value, i) => ({ value, selected: i === 6 }));

    it('shows the day and the week it sits in for a single day', () => {
        const s = summarizeTrend(week);
        expect(s.headline).toBe(7);
        expect(s.note).toEqual({ kind: 'window', value: 28 });
    });

    it('shows the total and the daily average for a range', () => {
        const days = Array.from({ length: 30 }, () => ({ value: 10, selected: true }));
        const s = summarizeTrend(days);
        expect(s.headline).toBe(300);
        expect(s.note).toEqual({ kind: 'average', value: 10 });
        expect(s.total).toBe(300);
    });

    it('counts only the days of the period when earlier days come along for context', () => {
        const days = [
            { value: 100, selected: false },
            { value: 100, selected: false },
            { value: 4, selected: true },
            { value: 6, selected: true },
        ];
        const s = summarizeTrend(days);
        expect(s.headline).toBe(10);
        expect(s.average).toBe(5);
    });

    it('copes with no days at all', () => {
        expect(summarizeTrend([]).headline).toBe(0);
    });
});
