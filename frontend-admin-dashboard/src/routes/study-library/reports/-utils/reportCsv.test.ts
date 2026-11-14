import { describe, expect, it } from 'vitest';
import { buildReportCsv, csvFileName, num, csvDate } from './reportCsv';

describe('buildReportCsv', () => {
    it('writes titled sections separated by a blank line', () => {
        const csv = buildReportCsv([
            { title: 'Summary', headers: ['Batch', 'Score'], rows: [['A', 1]] },
            { headers: ['Date', 'Minutes'], rows: [['2026-09-01', 12.5]] },
        ]);
        expect(csv.split('\r\n')).toEqual([
            'Summary',
            'Batch,Score',
            'A,1',
            '',
            'Date,Minutes',
            '2026-09-01,12.5',
        ]);
    });

    it('quotes commas, quotes and newlines', () => {
        const csv = buildReportCsv([
            { headers: ['Name'], rows: [['Doe, Jane'], ['Say "hi"'], ['two\nlines']] },
        ]);
        expect(csv).toBe('Name\r\n"Doe, Jane"\r\n"Say ""hi"""\r\n"two\nlines"');
    });

    it('neutralises spreadsheet formula injection', () => {
        const csv = buildReportCsv([{ headers: ['v'], rows: [['=SUM(A1)'], ['+1'], ['@cmd']] }]);
        expect(csv.split('\r\n').slice(1)).toEqual(["'=SUM(A1)", "'+1", "'@cmd"]);
    });

    it('writes null/undefined as empty cells', () => {
        expect(buildReportCsv([{ headers: ['a', 'b'], rows: [[null, undefined]] }])).toBe(
            'a,b\r\n,'
        );
    });
});

describe('num', () => {
    it('rounds to 2 dp and never emits NaN', () => {
        expect(num(12.3456)).toBe(12.35);
        expect(num('7.1')).toBe(7.1);
        expect(num('abc')).toBe('');
        expect(num(null)).toBe('');
        expect(num(undefined)).toBe('');
    });
});

describe('csvDate', () => {
    it('normalises to YYYY-MM-DD and blanks invalid input', () => {
        expect(csvDate('2026-09-01T00:00:00Z')).toBe('2026-09-01');
        expect(csvDate('nope')).toBe('');
        expect(csvDate(null)).toBe('');
    });
});

describe('csvFileName', () => {
    it('slugs the parts, drops empties and appends the date', () => {
        const name = csvFileName('Learning Timeline', '', undefined, 'Batch A · 2026');
        expect(name).toMatch(/^learning-timeline_batch-a-2026_\d{4}-\d{2}-\d{2}\.csv$/);
    });
});
