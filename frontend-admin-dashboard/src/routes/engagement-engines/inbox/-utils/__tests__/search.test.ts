import { describe, expect, it } from 'vitest';
import { hasInboxFilters, hasInboxPeriod, isIsoDay, normalizeInboxSearch } from '../search';

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
            from: undefined,
            to: undefined,
            template: undefined,
            outcome: 'bounced',
        });
    });

    it('keeps a period deep link, and lets it win over a day', () => {
        const range = { from: '2026-10-12', to: '2026-10-29' };
        expect(
            normalizeInboxSearch({ filter: 'sent', channel: 'EMAIL', outcome: 'bounced', ...range })
        ).toMatchObject({ filter: 'sent', channel: 'EMAIL', outcome: 'bounced', ...range });
        // The server lets from/to win over date, so the state keeps only the period.
        const both = normalizeInboxSearch({ date: '2026-10-30', ...range });
        expect(both).toMatchObject(range);
        expect(both.date).toBeUndefined();
        // One day is a valid period.
        expect(normalizeInboxSearch({ from: '2026-10-29', to: '2026-10-29' })).toMatchObject({
            from: '2026-10-29',
            to: '2026-10-29',
        });
    });

    it('ignores a period that is half given, reversed or not real days', () => {
        const ignored = { from: undefined, to: undefined };
        expect(normalizeInboxSearch({ from: '2026-10-12' })).toMatchObject(ignored);
        expect(normalizeInboxSearch({ to: '2026-10-29' })).toMatchObject(ignored);
        expect(normalizeInboxSearch({ from: '2026-10-29', to: '2026-10-12' })).toMatchObject(
            ignored
        );
        expect(normalizeInboxSearch({ from: '2026-02-31', to: '2026-10-29' })).toMatchObject(
            ignored
        );
        expect(normalizeInboxSearch({ from: '12-10-2026', to: 20261029 })).toMatchObject(ignored);
    });

    it('falls back to the day when the period is ignored', () => {
        const s = normalizeInboxSearch({
            date: '2026-10-30',
            from: '2026-10-29',
            to: '2026-10-12',
        });
        expect(s).toMatchObject({ date: '2026-10-30', from: undefined, to: undefined });
    });

    it('allows an outcome with a day or a period, and drops it with neither', () => {
        expect(normalizeInboxSearch({ outcome: 'opened', date: '2026-10-30' }).outcome).toBe(
            'opened'
        );
        expect(
            normalizeInboxSearch({ outcome: 'opened', from: '2026-10-12', to: '2026-10-29' })
                .outcome
        ).toBe('opened');
        expect(normalizeInboxSearch({ outcome: 'opened' }).outcome).toBeUndefined();
        // A period that is ignored is no period.
        expect(
            normalizeInboxSearch({ outcome: 'opened', from: '2026-10-29', to: '2026-10-12' })
                .outcome
        ).toBeUndefined();
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

    it('opens the approvals tab from a link and takes no kind on it (it is CRM actions)', () => {
        expect(
            normalizeInboxSearch({ filter: 'approvals', engine: 'e1', kind: 'REPLY' })
        ).toMatchObject({
            filter: 'approvals',
            engine: 'e1',
            kind: undefined,
        });
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
        // A period counts, so "Clear filters" shows for it and removes it.
        expect(
            hasInboxFilters(normalizeInboxSearch({ from: '2026-10-12', to: '2026-10-29' }))
        ).toBe(true);
    });

    it('knows when the list is narrowed to a day or a period', () => {
        expect(hasInboxPeriod(normalizeInboxSearch({}))).toBe(false);
        expect(hasInboxPeriod(normalizeInboxSearch({ date: '2026-10-30' }))).toBe(true);
        expect(hasInboxPeriod(normalizeInboxSearch({ from: '2026-10-12', to: '2026-10-29' }))).toBe(
            true
        );
        expect(hasInboxPeriod(normalizeInboxSearch({ from: '2026-10-12' }))).toBe(false);
    });
});
