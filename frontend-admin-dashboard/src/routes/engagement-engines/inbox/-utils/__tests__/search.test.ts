import { describe, expect, it } from 'vitest';
import { hasInboxFilters, isIsoDay, normalizeInboxSearch } from '../search';

describe('inbox search params', () => {
    it('keeps a report deep link exactly as written', () => {
        expect(
            normalizeInboxSearch({
                filter: 'sent',
                engine: 'e1',
                date: '2026-10-30',
                channel: 'EMAIL',
                outcome: 'bounced',
            })
        ).toEqual({
            filter: 'sent',
            engine: 'e1',
            channel: 'EMAIL',
            kind: undefined,
            date: '2026-10-30',
            template: undefined,
            outcome: 'bounced',
        });
    });

    it('drops values it does not know', () => {
        const s = normalizeInboxSearch({
            filter: 'nope',
            channel: 'SMS',
            kind: 'WHATEVER',
            date: '30-10-2026',
            outcome: 'bounced',
        });
        expect(s).toMatchObject({ filter: undefined, channel: undefined, kind: undefined });
        // No valid day, so the outcome has nothing to look up and goes too.
        expect(s.date).toBeUndefined();
        expect(s.outcome).toBeUndefined();
    });

    it('rejects days that only look like days', () => {
        expect(isIsoDay('2026-10-30')).toBe(true);
        expect(isIsoDay('2026-02-31')).toBe(false);
        expect(isIsoDay('2026-10-3')).toBe(false);
        expect(isIsoDay(20261030)).toBe(false);
    });

    it('treats kind=NO_OP and the waited tab as the same thing', () => {
        expect(normalizeInboxSearch({ kind: 'NO_OP' })).toMatchObject({
            filter: 'waited',
            kind: undefined,
        });
        expect(normalizeInboxSearch({ filter: 'waited', kind: 'REPLY' })).toMatchObject({
            filter: 'waited',
            kind: undefined,
        });
        expect(normalizeInboxSearch({ filter: 'sent', kind: 'REPLY' }).kind).toBe('REPLY');
    });

    it('reads a numeric template name as text', () => {
        expect(normalizeInboxSearch({ template: 2024 }).template).toBe('2024');
        expect(normalizeInboxSearch({ template: '   ' }).template).toBeUndefined();
    });

    it('reports whether anything beyond the tab is set', () => {
        expect(hasInboxFilters(normalizeInboxSearch({ filter: 'failed' }))).toBe(false);
        expect(hasInboxFilters(normalizeInboxSearch({ filter: 'failed', engine: 'e1' }))).toBe(
            true
        );
    });
});
