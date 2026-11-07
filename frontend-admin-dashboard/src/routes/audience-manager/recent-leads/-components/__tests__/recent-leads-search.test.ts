import { describe, expect, it } from 'vitest';
import { RecentLeadsSearchSchema } from '../recent-leads-search';

/**
 * TanStack Router JSON-parses each search value before validateSearch sees it, so a
 * hand-written URL hands numbers to a schema that expects strings. An institute's
 * sidebar sub-tab IS a hand-written URL, and "Processed (Touched) Leads"
 * (?statusExclude=1) took the whole page down on the error boundary because of it.
 */
describe('RecentLeadsSearchSchema', () => {
    it('accepts the numeric values a hand-written sub-tab URL produces', () => {
        // Exactly what the router passed in for I2CAN's Processed (Touched) Leads.
        const parsed = RecentLeadsSearchSchema.parse({
            range: 'ALL',
            status: 'LEAD',
            statusExclude: 1,
            lock: 'range,status,statusExclude',
        });
        expect(parsed.statusExclude).toBe('1');
        expect(parsed.status).toBe('LEAD');
    });

    it.each([
        ['range', 7],
        ['calledCount', 3],
        ['calledWithin', 24],
        ['workedWithin', 720],
    ])('coerces a numeric %s to a string', (key, value) => {
        const parsed = RecentLeadsSearchSchema.parse({ [key]: value });
        expect(parsed[key as 'range']).toBe(String(value));
    });

    it('still rejects a date that is not yyyy-MM-dd', () => {
        expect(() => RecentLeadsSearchSchema.parse({ from: 20261001 })).toThrow();
        expect(RecentLeadsSearchSchema.parse({ from: '2026-10-01' }).from).toBe('2026-10-01');
    });

    it('leaves an absent param absent', () => {
        expect(RecentLeadsSearchSchema.parse({}).statusExclude).toBeUndefined();
    });
});
